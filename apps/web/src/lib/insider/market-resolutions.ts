/**
 * Resolved-market knowledge base — a bulk fetch of recently-closed
 * Polymarket markets indexed by `conditionId`, used by the
 * category-specialist archetype to look up the outcome of a wallet's
 * historical trades.
 *
 * Gamma does not support batched `condition_ids` filtering; the only
 * way to learn a market's resolution is to see it in a wholesale
 * list. We fetch a broad window once per backtest (5000+ markets,
 * minimum $1K volume) and treat everything outside that pool as
 * "unknown resolution" — those trades just don't contribute to
 * wallet-edge stats.
 */

import { createLogger } from "@knoww/logger";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { POLYMARKET_API } from "@/constants/polymarket";
import { type Category, categorize } from "./category";
import { parseOutcomes, type ResolvedOutcomes } from "./pnl";

const log = createLogger("insider.market-resolutions");

export interface KnownResolution {
  conditionId: string;
  slug: string;
  eventSlug: string;
  category: Category;
  resolution: ResolvedOutcomes;
  /** Unix seconds when the market closed. Used to filter wallet trades
   *  that happened before resolution from ones happening after (post-
   *  resolution trades can't be insider bets). */
  closedAtMs: number;
  volumeUsd: number;
}

interface GammaRaw {
  conditionId?: string;
  slug?: string;
  eventSlug?: string;
  outcomePrices?: string;
  outcomes?: string;
  closedTime?: string;
  umaResolutionStatus?: string;
  volumeNum?: number;
}

const GAMMA_PAGE_SIZE = 500;

async function fetchPage(
  offset: number,
  minVolumeUsd: number
): Promise<GammaRaw[]> {
  const url = new URL(POLYMARKET_API.GAMMA.MARKETS);
  url.searchParams.set("closed", "true");
  url.searchParams.set("limit", GAMMA_PAGE_SIZE.toString());
  url.searchParams.set("offset", offset.toString());
  url.searchParams.set("order", "closedTime");
  url.searchParams.set("ascending", "false");
  if (minVolumeUsd > 0) {
    url.searchParams.set("volume_num_min", minVolumeUsd.toString());
  }
  try {
    const r = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!r.ok) return [];
    return (await r.json()) as GammaRaw[];
  } catch {
    return [];
  }
}

function toKnownResolution(raw: GammaRaw): KnownResolution | null {
  if (
    !(
      raw.conditionId &&
      raw.outcomePrices &&
      raw.slug &&
      raw.closedTime &&
      raw.umaResolutionStatus === "resolved"
    )
  ) {
    return null;
  }
  const resolution = parseOutcomes(raw.outcomePrices);
  if (resolution.prices.length === 0) return null;

  // Same Postgres-timestamp quirk as resolved-markets.ts
  const closedIso = raw.closedTime
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const closedAtMs = new Date(closedIso).getTime();
  if (Number.isNaN(closedAtMs)) return null;

  return {
    conditionId: raw.conditionId,
    slug: raw.slug,
    eventSlug: raw.eventSlug ?? raw.slug,
    category: categorize(raw.slug),
    resolution,
    closedAtMs,
    volumeUsd: Number(raw.volumeNum ?? 0),
  };
}

export interface ResolutionKnowledgeBase {
  /** conditionId → resolution record. */
  byConditionId: Map<string, KnownResolution>;
  /** Raw count of markets fetched (pre-filter). */
  fetched: number;
  /** Count after filter passes. */
  indexed: number;
}

/**
 * Fetch a broad pool of recently-resolved markets. Call once per
 * backtest run; the result is a closed-over lookup table.
 */
export async function buildResolutionKnowledgeBase(
  opts: {
    minVolumeUsd?: number;
    /** Hard cap on how many pages to walk — each page is 500 markets. */
    maxPages?: number;
  } = {}
): Promise<ResolutionKnowledgeBase> {
  const minVolumeUsd = opts.minVolumeUsd ?? 1000;
  const maxPages = opts.maxPages ?? 10;

  const byConditionId = new Map<string, KnownResolution>();
  let fetched = 0;

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(page * GAMMA_PAGE_SIZE, minVolumeUsd);
    if (rows.length === 0) break;
    fetched += rows.length;

    for (const raw of rows) {
      const kr = toKnownResolution(raw);
      if (!kr) continue;
      byConditionId.set(kr.conditionId, kr);
    }

    if (rows.length < GAMMA_PAGE_SIZE) break;
  }

  return {
    byConditionId,
    fetched,
    indexed: byConditionId.size,
  };
}

// ──────────────────────────────────────────────────────────────────
// Module-level cache for live-route consumption.
//
// Building the KB takes 30-60s (10 pages × Gamma API). Running that
// per-request is unworkable on the live insider feed. Instead: cache
// the KB for 6 hours at module level, and refresh it in the
// background when expired. The live route reads the cached value
// synchronously; if it's not yet built, the caller falls back to
// Phase 2 detectors only and picks up Phase 3/4 data on the next
// React Query refetch (typically 2 minutes later).
//
// On Cloudflare/Vercel edge runtime, module state persists across
// requests within a warm worker. On cold start, the first request
// pays Phase 2 only while the background build runs; subsequent
// requests get the full Phase 3/4 ensemble.
// ──────────────────────────────────────────────────────────────────

const KB_TTL_MS = 6 * 60 * 60 * 1000; // 6h

interface KBCacheEntry {
  kb: ResolutionKnowledgeBase;
  fetchedAt: number;
}

let kbCache: KBCacheEntry | null = null;
let kbBuildPromise: Promise<ResolutionKnowledgeBase> | null = null;

/** Return only a fresh in-memory KB without starting background work. */
export function peekCachedKB(): ResolutionKnowledgeBase | null {
  if (!kbCache || Date.now() - kbCache.fetchedAt > KB_TTL_MS) return null;
  return kbCache.kb;
}

/**
 * Keep a background promise alive past the response on Cloudflare Workers.
 * Without waitUntil, detached work is killed when the response is sent —
 * the KB build would be cancelled mid-crawl and re-triggered on every
 * request without ever completing.
 */
function registerBackgroundWork(promise: Promise<unknown>): void {
  try {
    const { ctx } = getCloudflareContext();
    ctx.waitUntil(promise);
  } catch {
    // Outside a Cloudflare request context (vitest, plain node): the
    // promise still runs, it just isn't protected from teardown.
  }
}

function triggerBackgroundBuild(opts: {
  minVolumeUsd?: number;
  maxPages?: number;
}): void {
  if (kbBuildPromise) return;
  kbBuildPromise = buildResolutionKnowledgeBase(opts)
    .then((kb) => {
      kbCache = { kb, fetchedAt: Date.now() };
      return kb;
    })
    .catch((err) => {
      log.error("kb.build_failed", { error: err });
      throw err;
    })
    .finally(() => {
      kbBuildPromise = null;
    });
  // Swallow the rejection on the waitUntil copy — kb.build_failed is
  // already logged above; waitUntil must not surface a second error.
  registerBackgroundWork(kbBuildPromise.catch(() => undefined));
}

/**
 * Return the cached KB synchronously. If the cache is empty or stale,
 * fire a background build and return the stale value (or null if
 * none exists yet). Callers should treat `null` as "Phase 3/4
 * signals not available this request" and fall back to Phase 2.
 */
export function getCachedKB(
  opts: { minVolumeUsd?: number; maxPages?: number } = {}
): ResolutionKnowledgeBase | null {
  const now = Date.now();
  const needsBuild = !kbCache || now - kbCache.fetchedAt > KB_TTL_MS;

  if (needsBuild) {
    triggerBackgroundBuild(opts);
  }

  // Return whatever we have — stale is fine for live-feed purposes.
  return kbCache?.kb ?? null;
}
