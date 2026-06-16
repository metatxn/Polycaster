// ============================================
// STREAMING MARKETS — companion card for live-stream platforms
// ============================================
// On feed platforms the extension scans posts and runs a 3-level relevance
// pipeline (English check → context gate → AI score) before showing a market.
// Streaming platforms (Twitch/YouTube/…) have no feed: there is one stream,
// and the user wants *all* markets relevant to what's being streamed. So this
// module BYPASSES the entire pipeline — it reads the stream's game/category
// from the platform adapter, fetches markets for it directly via
// `searchAllMarkets` (a plain search; the gate/score live downstream in the
// feed scan, not here), and renders them into the existing notification stack
// via `KNOWW_UI.setStreamMarkets`.
//
// Refresh strategy (important): the search proxy (knoww.app/api/search) is
// rate-limited and returns `degraded`/empty under bursty load. A naive fast
// poll + retry-on-empty + per-SPA-navigation refetch fires a burst of searches
// that *causes* the degradation (more requests → more empties → more retries).
// Instead we use ONE self-scheduling timer with exponential backoff on empty
// results, a hard minimum gap between real fetches, and a slow refresh once
// markets are found. This keeps request volume low so the proxy stays healthy
// and markets appear quickly.
//
// Reuses, unchanged:
//   • the floating/minimizable notification stack (createNotificationStack)
//   • per-market cards + their click→TradingPanel flow (createNotificationItem)
//   • the unified market search (KNOWW_API.searchAllMarkets)
// ============================================

import { createLogger } from "@knoww/logger";
import type { InjectedMarketEntry, Market } from "../../types/market";
import type { StreamContext } from "../../types/platform";
import {
  buildMatchQuery,
  buildQuery,
  rankStreamMarkets,
} from "./stream-market-ranking";

const log = createLogger("extension.streaming");

const MAX_STREAM_MARKETS = 12;
// Backoff schedule for a game that keeps returning no markets (proxy degraded
// or simply no coverage yet). Gentle and increasing so we never burst.
const EMPTY_BACKOFF_MS = [3000, 6000, 12000, 20000, 30000];
// Once markets are shown, refresh prices on this cadence.
const REFRESH_OK_MS = 60000;
// When there's no game to query (offline channel / browse page), check this often.
const IDLE_CHECK_MS = 5000;
// How often to poll the URL for SPA navigations (channel/game switches).
const URL_WATCH_MS = 1000;
// Never fire two real searches for the same game closer than this.
const MIN_FETCH_GAP_MS = 2500;
// Sentinel renderedKey value for the "no game / idle" state.
const IDLE_KEY = "idle";

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let urlWatchTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let currentKey: string | null = null; // game we're currently attempting
let renderedKey: string | null = null; // game we've actually rendered (or IDLE_KEY)
let emptyAttempts = 0;
let lastFetchAt = 0;

/** A stable key for "what are we currently showing markets for". */
function contextKey(ctx: StreamContext | null): string {
  if (!ctx) return "";
  return (ctx.gameSlug || ctx.game || ctx.title || "").toLowerCase();
}

function readContext(): StreamContext | null {
  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  if (!platform || typeof platform.getStreamContext !== "function") return null;
  try {
    return platform.getStreamContext();
  } catch (e) {
    log.error("stream.context_read_failed", { error: String(e) });
    return null;
  }
}

/** Wrap fetched markets as postless stack entries (no DOM card to reference). */
function toEntries(markets: Market[]): InjectedMarketEntry[] {
  const now = Date.now();
  return markets.map((market, index) => ({
    market,
    // No injected post element on a stream surface — deref resolves to nothing.
    cardRef: { deref: () => undefined },
    // The stack sorts active entries by timestamp ascending then reverses for
    // display. Assign decreasing timestamps by index so this array's order IS
    // the display order — i.e. the first market (the watched match) renders on
    // top.
    timestamp: now - index,
    isInViewport: true,
    isStreamSurface: true,
  }));
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

/** Run one search for the current game; returns the rendered market count. */
async function fetchOnce(ctx: StreamContext): Promise<number> {
  const setMarkets = window.KNOWW_UI?.setStreamMarkets;
  const { searchAllMarkets } = window.KNOWW_API;
  if (!setMarkets || typeof searchAllMarkets !== "function") return 0;

  const gameQuery = buildQuery(ctx);
  const matchQuery = buildMatchQuery(ctx.title || "");

  inFlight = true;
  lastFetchAt = Date.now();
  try {
    log.info("stream.fetch", {
      game: ctx.game,
      match: matchQuery || null,
      live: ctx.isLive,
    });
    // Two searches: the specific match-up being watched (from the title) and
    // the broader game. The match-up market is the most relevant, so it's
    // pinned to the top; the game fills the rest, ordered by volume.
    // Both go through the SW's throttled search queue (serialized ~900ms apart),
    // so this doesn't burst the rate-limited proxy.
    // NOTE: don't pass the stream's tags as tag_slugs; they're Twitch tags
    // (English/FPS/…), not Polymarket tag slugs, and would over-filter to 0.
    const [matchFound, gameFound] = await Promise.all([
      matchQuery
        ? searchAllMarkets(matchQuery, []).catch(() => [] as Market[])
        : Promise.resolve([] as Market[]),
      gameQuery
        ? searchAllMarkets(gameQuery, []).catch(() => [] as Market[])
        : Promise.resolve([] as Market[]),
    ]);

    const ranked = rankStreamMarkets({
      ctx,
      matchFound,
      gameFound,
      maxMarkets: MAX_STREAM_MARKETS,
    });

    log.info("stream.fetched", {
      game: ctx.game,
      matchQuery: matchQuery || null,
      match: matchFound.length,
      total: ranked.length,
      shown: ranked.map((market) => market.title).slice(0, 5),
    });

    if (ranked.length > 0) {
      setMarkets(toEntries(ranked));
      return ranked.length;
    }
    // First empty attempt for a new game: clear any stale markets from the
    // previous game. Subsequent backoff retries leave the panel as-is.
    if (emptyAttempts === 0) setMarkets([]);
    return 0;
  } catch (e) {
    log.error("stream.fetch_failed", { query: ctx.game, error: String(e) });
    return 0;
  } finally {
    inFlight = false;
  }
}

/**
 * The single driver. Reads context, decides whether to fetch, renders, and
 * always re-schedules itself. All triggers (init, SPA nav, periodic) funnel
 * through here so request volume stays bounded.
 */
async function tick(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (inFlight) {
    schedule(1000);
    return;
  }

  const ctx = readContext() || { game: "", isLive: false };
  const key = contextKey(ctx);

  // Game changed (or first run) → reset attempt state.
  if (key !== currentKey) {
    const switchedGames = currentKey !== null && renderedKey !== null;
    currentKey = key;
    renderedKey = null;
    emptyAttempts = 0;
    lastFetchAt = 0;
    // Clear the previous game's markets immediately so the panel never keeps
    // showing e.g. Valorant after the user switched to a Dota stream while the
    // new game's markets are still loading.
    if (switchedGames) {
      window.KNOWW_UI?.setStreamMarkets?.([]);
    }
  }

  // No game to query (offline / browse): show idle once, then check slowly.
  if (!buildQuery(ctx)) {
    if (renderedKey !== IDLE_KEY) {
      window.KNOWW_UI?.setStreamMarkets?.([]);
      renderedKey = IDLE_KEY;
    }
    schedule(IDLE_CHECK_MS);
    return;
  }

  // Already showing markets for this game -> wait for the slow refresh interval,
  // then fall through to fetch fresh prices.
  if (renderedKey === key) {
    const sinceLast = Date.now() - lastFetchAt;
    if (lastFetchAt > 0 && sinceLast < REFRESH_OK_MS) {
      schedule(REFRESH_OK_MS - sinceLast);
      return;
    }
  }

  // Respect a minimum gap between real fetches for the same game.
  const sinceLast = Date.now() - lastFetchAt;
  if (lastFetchAt > 0 && sinceLast < MIN_FETCH_GAP_MS) {
    schedule(MIN_FETCH_GAP_MS - sinceLast);
    return;
  }

  const count = await fetchOnce(ctx);
  if (count > 0) {
    renderedKey = key;
    emptyAttempts = 0;
    schedule(REFRESH_OK_MS);
    return;
  }

  // Empty/degraded → back off and keep trying (the proxy recovers; markets
  // then appear without us having hammered it).
  const delay =
    EMPTY_BACKOFF_MS[Math.min(emptyAttempts, EMPTY_BACKOFF_MS.length - 1)];
  emptyAttempts += 1;
  schedule(delay);
}

/** Nudge the driver to run soon (debounced via schedule) on SPA navigation. */
function nudge(): void {
  if (inFlight) return;
  schedule(500);
}

/**
 * Start the streaming surface. Ensures the notification-stack shell exists,
 * kicks the driver, and wires SPA navigation detection.
 */
function initStreamingMarkets(): void {
  if (started) return;
  started = true;

  // Make sure the floating card shell exists even before the first markets.
  window.KNOWW_UI?.initNotificationStack?.();

  // Kick off immediately.
  schedule(0);

  // Twitch/YouTube are SPAs: channel/game change without a full reload.
  // These only *nudge* the driver — the tick() guards (game-key change,
  // min-fetch-gap, backoff) decide whether an actual search happens, so a
  // chatty SPA firing replaceState can't trigger a burst of searches.
  window.addEventListener("popstate", nudge);

  const histPatch = (type: "pushState" | "replaceState"): void => {
    const orig = history[type];
    history[type] = function patched(
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      const ret = orig.apply(this, args);
      nudge();
      return ret;
    } as History[typeof type];
  };
  histPatch("pushState");
  histPatch("replaceState");

  // Primary SPA-nav detector: poll the URL. Patching history.pushState from a
  // content script is unreliable — the page calls its own (unpatched) reference
  // in a separate JS world — so channel switches can be missed. A cheap 1s URL
  // poll catches every navigation regardless of how the SPA routes.
  let lastUrl = location.href;
  urlWatchTimer = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      nudge();
    }
  }, URL_WATCH_MS);

  window.addEventListener("pagehide", () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (urlWatchTimer) clearInterval(urlWatchTimer);
    urlWatchTimer = null;
  });
}

export const KNOWW_STREAMING = {
  initStreamingMarkets,
  refresh: (): void => {
    // Force a fresh fetch for the current game.
    renderedKey = null;
    emptyAttempts = 0;
    lastFetchAt = 0;
    schedule(0);
  },
};

window.KNOWW_STREAMING = KNOWW_STREAMING;
