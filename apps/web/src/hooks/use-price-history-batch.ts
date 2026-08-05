import { useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";

/**
 * Hook: useBatchPriceHistory
 *
 * Fetches 30D price history for a set of CLOB token IDs in a single
 * POST to `/api/markets/price-history/batch`. Returns a map keyed by
 * token id with the history array; consumers use this to draw small
 * sparklines and compute a "move since last point" cents delta.
 *
 * Behaviour notes:
 * - Empty/undefined `tokenIds` short-circuits to a disabled query.
 * - Token IDs are deduped + sorted client-side so the query key is
 *   stable across re-renders with the same logical set.
 * - The backend caps at 40 token IDs per request — we slice down at
 *   the call site, not here.
 * - 30D fidelity is hourly (60 min) by default — matches the design's
 *   smooth sparkline shape without being chatty.
 */

export interface PriceHistoryPoint {
  /** UTC timestamp in seconds. */
  t: number;
  /** Price 0..1. */
  p: number;
}

interface BatchEntry {
  tokenId: string;
  status?: "ok" | "not_found" | "timeout" | "upstream_error";
  history: PriceHistoryPoint[];
}

interface BatchResponse {
  success: boolean;
  partial?: boolean;
  histories: BatchEntry[];
  error?: string;
}

interface BatchQueryData {
  histories: Map<string, PriceHistoryPoint[]>;
  partial: boolean;
}

/** Number of days of history to fetch. Matches the "30D" column label. */
const DEFAULT_LOOKBACK_DAYS = 30;
/** Sampling resolution in minutes. 60 = one point per hour = ~720
 *  points per 30 days, which renders smoothly at sparkline scale. */
const DEFAULT_FIDELITY_MINUTES = 60;
/** Refetch the whole batch every 5 minutes so sparklines stay fresh
 *  without hammering the upstream CLOB API. */
const STALE_TIME_MS = 5 * 60 * 1000;
/** A partial batch (some tokens timed out / errored upstream) goes stale
 *  quickly so the missing sparklines recover without a page reload. */
const PARTIAL_STALE_TIME_MS = 30 * 1000;

export function useBatchPriceHistory(
  tokenIds: string[],
  options: { enabled?: boolean; lookbackDays?: number; fidelity?: number } = {}
) {
  const {
    enabled = true,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    fidelity = DEFAULT_FIDELITY_MINUTES,
  } = options;

  // Stable, deduped, sorted list — keeps the query key invariant under
  // reorderings of the input.
  const normalized = Array.from(new Set(tokenIds.filter(Boolean))).sort();
  const startTs = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;

  return useQuery({
    queryKey: qk.market.priceHistoryBatch(normalized, lookbackDays, fidelity),
    enabled: enabled && normalized.length > 0,
    // Partial batches go stale fast (and re-poll) so failed tokens recover;
    // complete batches keep the normal 5-minute cadence.
    staleTime: (query) =>
      query.state.data?.partial ? PARTIAL_STALE_TIME_MS : STALE_TIME_MS,
    refetchInterval: (query) =>
      query.state.data?.partial ? PARTIAL_STALE_TIME_MS : false,
    queryFn: async (): Promise<BatchQueryData> => {
      const res = await fetch("/api/markets/price-history/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenIds: normalized,
          startTs,
          fidelity,
        }),
      });
      if (!res.ok) {
        throw new Error(`Price-history batch failed: ${res.status}`);
      }
      const data = (await res.json()) as BatchResponse;
      const map = new Map<string, PriceHistoryPoint[]>();
      for (const entry of data.histories ?? []) {
        if (!entry.tokenId) continue;
        // Skip transient failures instead of caching them as empty arrays —
        // consumers then render their "no data" placeholder and the next
        // (fast) refetch can fill the gap. `not_found` stays: it is a real,
        // stable "this token has no history" answer.
        if (entry.status === "timeout" || entry.status === "upstream_error") {
          continue;
        }
        map.set(entry.tokenId, entry.history);
      }
      return { histories: map, partial: data.partial === true };
    },
    // Consumers only ever read the map; `partial` exists for the
    // staleTime/refetchInterval callbacks above.
    select: (data) => data.histories,
  });
}
