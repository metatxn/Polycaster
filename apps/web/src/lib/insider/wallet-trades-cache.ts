/**
 * Per-wallet trade history cache — enriched with the fields needed
 * to compute the category-specialist archetype (slug for categorization,
 * conditionId for market-resolution lookup, side/outcomeIndex/price/size
 * for P&L).
 *
 * Separate from `trader-history-cache.ts` to avoid bloating the lean
 * entry shape that the live `/api/whales/suspicious` route depends on.
 * That cache answers "how old is this wallet" fast; this one answers
 * "what did this wallet actually do."
 */

import { POLYMARKET_API } from "@/constants/polymarket";

export interface WalletTradeRecord {
  conditionId: string;
  slug: string;
  eventSlug: string;
  side: "BUY" | "SELL";
  outcomeIndex: number;
  price: number;
  size: number;
  timestamp: number;
}

interface CacheEntry {
  trades: WalletTradeRecord[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 500;
const MAX_PAGES = 5;
const PAGE_SIZE = 100;

const cache = new Map<string, CacheEntry>();

interface RawActivityTrade {
  type?: string;
  conditionId?: string;
  slug?: string;
  eventSlug?: string;
  side?: "BUY" | "SELL";
  outcomeIndex?: number;
  price?: number;
  size?: number;
  timestamp?: number;
}

function evictStale() {
  const now = Date.now();
  const stale: string[] = [];
  for (const [k, v] of cache) {
    if (now - v.fetchedAt > CACHE_TTL_MS) stale.push(k);
  }
  for (const k of stale) cache.delete(k);
  if (cache.size > MAX_CACHE_SIZE) {
    const sorted = [...cache.entries()].sort(
      (a, b) => a[1].fetchedAt - b[1].fetchedAt
    );
    for (let i = 0; i < sorted.length - MAX_CACHE_SIZE; i++) {
      cache.delete(sorted[i][0]);
    }
  }
}

async function fetchWalletTradesPage(
  address: string,
  offset: number
): Promise<RawActivityTrade[]> {
  try {
    const url = `${POLYMARKET_API.DATA.BASE}/activity?user=${address.toLowerCase()}&limit=${PAGE_SIZE}&offset=${offset}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as RawActivityTrade[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Fetch (or return cached) per-wallet trade history, filtered to only
 * TRADE activities. Walks up to 500 activities (5 pages × 100); beyond
 * that we'd be looking at a power-user whose specialty signal is
 * strong regardless of tail.
 */
export async function getWalletTrades(
  rawAddress: string
): Promise<WalletTradeRecord[]> {
  const address = rawAddress.toLowerCase();
  const now = Date.now();

  const cached = cache.get(address);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.trades;
  }

  const trades: WalletTradeRecord[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetchWalletTradesPage(address, page * PAGE_SIZE);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.type !== "TRADE") continue;
      if (
        !(
          r.conditionId &&
          r.slug &&
          r.side &&
          typeof r.outcomeIndex === "number" &&
          typeof r.price === "number" &&
          typeof r.size === "number" &&
          typeof r.timestamp === "number"
        )
      ) {
        continue;
      }
      trades.push({
        conditionId: r.conditionId,
        slug: r.slug,
        eventSlug: r.eventSlug ?? r.slug,
        side: r.side,
        outcomeIndex: r.outcomeIndex,
        price: r.price,
        size: r.size,
        timestamp: r.timestamp,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  evictStale();
  cache.set(address, { trades, fetchedAt: now });
  return trades;
}

export async function getWalletTradesBatch(
  addresses: string[],
  concurrency = 6
): Promise<Map<string, WalletTradeRecord[]>> {
  const results = new Map<string, WalletTradeRecord[]>();
  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency);
    const entries = await Promise.all(
      batch.map(
        async (a) => [a.toLowerCase(), await getWalletTrades(a)] as const
      )
    );
    for (const [addr, trades] of entries) results.set(addr, trades);
  }
  return results;
}
