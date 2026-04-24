/**
 * Price-history helpers for the timing-cluster archetype.
 *
 * The CLOB exposes `/prices-history?market={tokenId}&startTs=...&fidelity=N`
 * which returns per-bucket mid prices as `[{t: unix_s, p: 0..1}, ...]`.
 * We use this to answer: "for a trade at time T, what was the mid
 * price at T, and where did the market go N minutes after?"
 */

import { POLYMARKET_API } from "@/constants/polymarket";

export interface PriceBucket {
  /** Bucket start timestamp in unix seconds. */
  t: number;
  /** Mid price at the bucket, 0..1. */
  p: number;
}

interface PriceHistoryResponse {
  history?: PriceBucket[];
}

/** Fetch a market's price history. `tokenId` is the CLOB token id for
 *  the specific outcome side (from Gamma's `clobTokenIds`). */
export async function fetchPriceHistory(
  tokenId: string,
  startTs: number,
  endTs: number,
  fidelityMinutes = 5
): Promise<PriceBucket[]> {
  const url = new URL(`${POLYMARKET_API.CLOB.BASE}/prices-history`);
  url.searchParams.set("market", tokenId);
  url.searchParams.set("startTs", Math.floor(startTs).toString());
  url.searchParams.set("endTs", Math.floor(endTs).toString());
  url.searchParams.set("fidelity", fidelityMinutes.toString());

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as PriceHistoryResponse;
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
