/**
 * Fetch recently-resolved Polymarket markets suitable for backtesting
 * insider detection. "Suitable" means: binary, resolved (not disputed),
 * had meaningful trading volume, and ran long enough that an informed
 * trader could plausibly have accumulated a position.
 */

import { createLogger } from "@knoww/logger";
import { parseGammaStringArray } from "@knoww/shared-types/polymarket";
import { POLYMARKET_API } from "@/constants/polymarket";
import { parseOutcomes, type ResolvedOutcomes } from "./pnl";

const log = createLogger("insider.resolved-markets");

interface GammaClosedMarket {
  conditionId?: string;
  question?: string;
  slug?: string;
  outcomes?: string;
  outcomePrices?: string;
  closed?: boolean;
  closedTime?: string;
  startDate?: string;
  endDate?: string;
  umaEndDate?: string;
  umaResolutionStatus?: string;
  volumeNum?: number;
  liquidityNum?: number;
  negRisk?: boolean;
  clobTokenIds?: string;
  icon?: string;
  eventSlug?: string;
}

export interface ResolvedMarket {
  conditionId: string;
  question: string;
  slug: string;
  outcomes: string[];
  resolution: ResolvedOutcomes;
  closedAt: Date;
  startedAt: Date;
  durationHours: number;
  volumeUsd: number;
  negRisk: boolean;
  clobTokenIds: string[];
  icon?: string;
}

export interface FetchResolvedMarketsDiagnostics {
  pagesFetched: number;
  rawMarketsSeen: number;
  drops: {
    parse: number;
    tooOld: number;
    tooFresh: number;
    draw: number;
    dur: number;
    vol: number;
    uma: number;
    outcomes: number;
  };
}

export interface FetchResolvedMarketsOptions {
  /** Include markets that closed at most this many days ago. */
  maxDaysAgo: number;
  /** Exclude markets that closed within the last N days (buffer for
   *  Data API indexing — trades from a market that closed 30 min ago
   *  may not all be queryable yet). */
  minDaysAgo: number;
  /** Minimum trading duration in hours. Skips 5-minute crypto markets
   *  that resolve too fast for an insider pattern to form. */
  minDurationHours: number;
  /** Minimum lifetime volume in USD. */
  minVolumeUsd: number;
  /** Maximum number of markets to return after filtering. */
  limit: number;
}

const GAMMA_PAGE_SIZE = 500;
const MAX_PAGES_TO_SCAN = 40;

async function fetchClosedMarketsPage(
  offset: number,
  minVolumeUsd: number
): Promise<GammaClosedMarket[]> {
  const url = new URL(POLYMARKET_API.GAMMA.MARKETS);
  url.searchParams.set("closed", "true");
  url.searchParams.set("limit", GAMMA_PAGE_SIZE.toString());
  url.searchParams.set("offset", offset.toString());
  url.searchParams.set("order", "closedTime");
  url.searchParams.set("ascending", "false");
  // Push volume filtering server-side — dramatically cuts the number
  // of low-volume sports/crypto dust markets we'd otherwise paginate
  // through to reach our 2-30 day window.
  if (minVolumeUsd > 0) {
    url.searchParams.set("volume_num_min", minVolumeUsd.toString());
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      log.warn("gamma.page_fetch_failed", {
        status: response.status,
        url: url.toString(),
      });
      return [];
    }
    return (await response.json()) as GammaClosedMarket[];
  } catch (err) {
    log.warn("gamma.page_fetch_threw", { error: err });
    return [];
  }
}

function toResolvedMarket(raw: GammaClosedMarket): ResolvedMarket | null {
  if (
    !(
      raw.conditionId &&
      raw.outcomePrices &&
      raw.outcomes &&
      raw.closedTime &&
      raw.startDate &&
      raw.endDate
    )
  ) {
    return null;
  }

  const resolution = parseOutcomes(raw.outcomePrices);
  if (resolution.prices.length === 0) return null;

  const outcomes = parseGammaStringArray(raw.outcomes);
  if (outcomes.length === 0) return null;

  const clobTokenIds = parseGammaStringArray(raw.clobTokenIds);

  // Gamma returns closedTime like "2026-04-22 18:10:48+00" — a Postgres
  // timestamp with a bare `+00` offset. Replace the space with T and
  // expand `+00` to `+00:00` so the Date constructor parses it.
  const closedIso = raw.closedTime
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const closedAt = new Date(closedIso);
  const startedAt = new Date(raw.startDate);
  if (Number.isNaN(closedAt.getTime()) || Number.isNaN(startedAt.getTime())) {
    return null;
  }

  const durationHours =
    (closedAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60);

  return {
    conditionId: raw.conditionId,
    question: raw.question ?? "",
    slug: raw.slug ?? "",
    outcomes,
    resolution,
    closedAt,
    startedAt,
    durationHours,
    volumeUsd: Number(raw.volumeNum ?? 0),
    negRisk: Boolean(raw.negRisk),
    clobTokenIds,
    icon: raw.icon,
  };
}

/**
 * Fetch resolved markets matching the filter. Walks gamma pages until
 * either the requested limit is met or we've scanned enough pages.
 * Markets older than `maxDaysAgo` terminate the walk early since
 * results are in descending closedTime order.
 */
export async function fetchResolvedMarkets(
  opts: FetchResolvedMarketsOptions
): Promise<{
  markets: ResolvedMarket[];
  diagnostics: FetchResolvedMarketsDiagnostics;
}> {
  const { maxDaysAgo, minDaysAgo, minDurationHours, minVolumeUsd, limit } =
    opts;

  const now = Date.now();
  const maxAgoMs = maxDaysAgo * 24 * 60 * 60 * 1000;
  const minAgoMs = minDaysAgo * 24 * 60 * 60 * 1000;

  const results: ResolvedMarket[] = [];

  let pagesFetched = 0;
  let rawSeen = 0;
  const droppedReason = {
    parse: 0,
    tooOld: 0,
    tooFresh: 0,
    draw: 0,
    dur: 0,
    vol: 0,
    uma: 0,
    outcomes: 0,
  };

  for (let page = 0; page < MAX_PAGES_TO_SCAN; page++) {
    const rawMarkets = await fetchClosedMarketsPage(
      page * GAMMA_PAGE_SIZE,
      minVolumeUsd
    );
    pagesFetched++;
    if (rawMarkets.length === 0) break;
    rawSeen += rawMarkets.length;

    let sawOlderThanMax = false;

    for (const raw of rawMarkets) {
      const market = toResolvedMarket(raw);
      if (!market) {
        droppedReason.parse++;
        continue;
      }

      const ageMs = now - market.closedAt.getTime();
      if (ageMs > maxAgoMs) {
        sawOlderThanMax = true;
        continue;
      }
      if (ageMs < minAgoMs) {
        droppedReason.tooFresh++;
        continue;
      }
      if (market.resolution.isDraw) {
        droppedReason.draw++;
        continue;
      }
      if (market.durationHours < minDurationHours) {
        droppedReason.dur++;
        continue;
      }
      if (market.volumeUsd < minVolumeUsd) {
        droppedReason.vol++;
        continue;
      }
      if (raw.umaResolutionStatus !== "resolved") {
        droppedReason.uma++;
        continue;
      }
      if (market.outcomes.length !== 2) {
        droppedReason.outcomes++;
        continue;
      }

      results.push(market);
      if (results.length >= limit) {
        return {
          markets: results,
          diagnostics: {
            pagesFetched,
            rawMarketsSeen: rawSeen,
            drops: droppedReason,
          },
        };
      }
    }

    if (sawOlderThanMax) {
      droppedReason.tooOld++;
      break;
    }
  }

  return {
    markets: results,
    diagnostics: {
      pagesFetched,
      rawMarketsSeen: rawSeen,
      drops: droppedReason,
    },
  };
}
