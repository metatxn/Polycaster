/**
 * Transient per-wallet trade loader. Full trade histories are intentionally
 * never retained at module scope: the live route caches the much smaller
 * derived WalletEdge instead.
 */

import { POLYMARKET_API } from "@/constants/polymarket";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export interface WalletTradeRecord {
  conditionId: string;
  side: "BUY" | "SELL";
  outcomeIndex: number;
  price: number;
  size: number;
  timestamp: number;
}

export interface WalletActivitySnapshot {
  trades: WalletTradeRecord[];
  earliestTradeTimestamp: number | null;
  totalTrades: number;
}

const MAX_PAGES = 5;
const PAGE_SIZE = 100;

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

async function fetchWalletTradesPage(
  address: string,
  offset: number,
  signal?: AbortSignal
): Promise<RawActivityTrade[]> {
  try {
    const url = `${POLYMARKET_API.DATA.BASE}/activity?user=${address.toLowerCase()}&limit=${PAGE_SIZE}&offset=${offset}`;
    const response = await fetchWithTimeout(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
      signal,
    });
    if (!response.ok) return [];
    const data = (await response.json()) as RawActivityTrade[];
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
}

/**
 * Walk up to 500 activities while deriving the lean history summary and,
 * optionally, the records needed for WalletEdge calculation in one pass.
 */
export async function fetchWalletActivitySnapshot(
  rawAddress: string,
  collectTrades = true,
  signal?: AbortSignal
): Promise<WalletActivitySnapshot> {
  const address = rawAddress.toLowerCase();
  const trades: WalletTradeRecord[] = [];
  let earliestTradeTimestamp = Number.POSITIVE_INFINITY;
  let totalTrades = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetchWalletTradesPage(address, page * PAGE_SIZE, signal);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.type !== "TRADE") continue;
      totalTrades += 1;
      if (
        typeof r.timestamp === "number" &&
        r.timestamp < earliestTradeTimestamp
      ) {
        earliestTradeTimestamp = r.timestamp;
      }
      if (!collectTrades) continue;
      if (
        !(
          r.conditionId &&
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
        side: r.side,
        outcomeIndex: r.outcomeIndex,
        price: r.price,
        size: r.size,
        timestamp: r.timestamp,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return {
    trades,
    earliestTradeTimestamp: Number.isFinite(earliestTradeTimestamp)
      ? earliestTradeTimestamp
      : null,
    totalTrades,
  };
}

export async function getWalletTrades(
  rawAddress: string,
  signal?: AbortSignal
): Promise<WalletTradeRecord[]> {
  return (await fetchWalletActivitySnapshot(rawAddress, true, signal)).trades;
}

export async function getWalletTradesBatch(
  addresses: string[],
  concurrency = 6,
  signal?: AbortSignal
): Promise<Map<string, WalletTradeRecord[]>> {
  const results = new Map<string, WalletTradeRecord[]>();
  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency);
    const entries = await Promise.all(
      batch.map(
        async (a) =>
          [a.toLowerCase(), await getWalletTrades(a, signal)] as const
      )
    );
    for (const [addr, trades] of entries) results.set(addr, trades);
  }
  return results;
}
