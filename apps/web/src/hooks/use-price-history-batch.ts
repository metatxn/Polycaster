import { useQuery } from "@tanstack/react-query";

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
  history: PriceHistoryPoint[];
}

interface BatchResponse {
  success: boolean;
  histories: BatchEntry[];
  error?: string;
}

/** Number of days of history to fetch. Matches the "30D" column label. */
const DEFAULT_LOOKBACK_DAYS = 30;
/** Sampling resolution in minutes. 60 = one point per hour = ~720
 *  points per 30 days, which renders smoothly at sparkline scale. */
const DEFAULT_FIDELITY_MINUTES = 60;
/** Refetch the whole batch every 5 minutes so sparklines stay fresh
 *  without hammering the upstream CLOB API. */
const STALE_TIME_MS = 5 * 60 * 1000;

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
    queryKey: ["price-history-batch", normalized, lookbackDays, fidelity],
    enabled: enabled && normalized.length > 0,
    staleTime: STALE_TIME_MS,
    queryFn: async () => {
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
        if (entry.tokenId) {
          map.set(entry.tokenId, entry.history);
        }
      }
      return map;
    },
  });
}
