/**
 * Per-wallet wallet-edge cache for the live insider feed.
 *
 * `computeWalletEdge` is a pure aggregation over the wallet's trade
 * history and the resolution KB, but the inputs to it — the wallet's
 * trades — are fetched from the Polymarket Data API at ~300-500ms
 * per wallet (paginated). On the live `/api/whales/suspicious`
 * route we may have 10-50 unique wallets per request; computing
 * edge from scratch for all of them per request is untenable.
 *
 * This module caches the computed `WalletEdge` record by wallet
 * address with a 1-hour TTL. Since a wallet's edge is stable over
 * minutes (new trades take hours to resolve), 1h is a safe staleness
 * bound. The underlying trade cache has its own 15m TTL, so edges
 * built from it will pick up recent trades roughly that quickly.
 *
 * On cache miss we fetch the wallet's trades and compute the edge
 * inline, which is the same cost as if the caller did it manually —
 * the cache is a pure optimization for repeat lookups.
 */

import type { ResolutionKnowledgeBase } from "./market-resolutions";
import { computeWalletEdge, type WalletEdge } from "./wallet-edge";
import { getWalletTrades, type WalletTradeRecord } from "./wallet-trades-cache";

const TTL_MS = 60 * 60 * 1000; // 1h
const MAX_ENTRIES = 1000;

interface CacheEntry {
  edge: WalletEdge;
  storedAt: number;
}

const cache = new Map<string, CacheEntry>();

function trimCache(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const excess = cache.size - MAX_ENTRIES;
  const iter = cache.keys();
  for (let i = 0; i < excess; i++) {
    const { value, done } = iter.next();
    if (done) break;
    cache.delete(value);
  }
}

/**
 * Look up or compute a wallet's edge. `kb` is passed in rather than
 * imported lazily so the caller controls cache key semantics — if
 * the KB changes (background refresh), callers can invalidate by
 * passing a different reference; in practice we treat the edge as
 * stable for the TTL window regardless.
 */
export async function getCachedWalletEdge(
  address: string,
  kb: ResolutionKnowledgeBase,
  preloadedTrades?: WalletTradeRecord[],
  signal?: AbortSignal
): Promise<WalletEdge> {
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.storedAt < TTL_MS) {
    return cached.edge;
  }

  const trades = preloadedTrades ?? (await getWalletTrades(address, signal));
  const edge = computeWalletEdge(address, trades, kb);
  cache.set(key, { edge, storedAt: Date.now() });
  trimCache();
  return edge;
}

/**
 * Batch version — computes edges for a list of addresses in parallel
 * with bounded concurrency. Returns a Map keyed by lowercased address.
 */
export async function getCachedWalletEdgesBatch(
  addresses: string[],
  kb: ResolutionKnowledgeBase,
  concurrency = 6,
  preloadedTradesByAddress: ReadonlyMap<
    string,
    WalletTradeRecord[]
  > = new Map(),
  signal?: AbortSignal
): Promise<Map<string, WalletEdge>> {
  const out = new Map<string, WalletEdge>();
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((addr) =>
        getCachedWalletEdge(
          addr,
          kb,
          preloadedTradesByAddress.get(addr),
          signal
        )
      )
    );
    for (let j = 0; j < batch.length; j++) {
      out.set(batch[j], results[j]);
    }
  }
  return out;
}
