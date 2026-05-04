/**
 * Price-history helpers for the timing-cluster archetype.
 *
 * The CLOB exposes `/prices-history?market={tokenId}&startTs=...&fidelity=N`
 * which returns per-bucket mid prices as `[{t: unix_s, p: 0..1}, ...]`.
 * We use this to answer: "for a trade at time T, what was the mid
 * price at T, and where did the market go N minutes after?"
 */

import {
  type ClobPriceHistoryPoint,
  fetchClobPriceHistory,
} from "@knoww/shared-types/clob";

export type PriceBucket = ClobPriceHistoryPoint;

/** Fetch a market's price history. `tokenId` is the CLOB token id for
 *  the specific outcome side (from Gamma's `clobTokenIds`). */
export async function fetchPriceHistory(
  tokenId: string,
  startTs: number,
  endTs: number,
  fidelityMinutes = 5
): Promise<PriceBucket[]> {
  try {
    const data = await fetchClobPriceHistory(
      tokenId,
      {
        startTs: Math.floor(startTs),
        endTs: Math.floor(endTs),
        fidelity: fidelityMinutes,
      },
      {
        requestInit: { next: { revalidate: 300 } },
      }
    );
    return data.history ?? [];
  } catch {
    return [];
  }
}

/**
 * Binary search the bucket at (or just before) the given timestamp.
 * Returns null if no bucket exists before `ts`. Buckets must be sorted
 * by `t` ascending — which is how the endpoint returns them.
 */
export function priceAt(history: PriceBucket[], ts: number): number | null {
  if (history.length === 0) return null;
  if (ts < history[0].t) return null;
  if (ts >= history[history.length - 1].t) {
    return history[history.length - 1].p;
  }

  let lo = 0;
  let hi = history.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (history[mid].t <= ts) lo = mid;
    else hi = mid - 1;
  }
  return history[lo].p;
}
