import {
  fetchClobOrderBook,
  fetchClobOrderBooks,
} from "@knoww/shared-types/clob";
import { CLOB_BASE_URL } from "@/constants/polymarket";

// Cap list-row REST quote hydration so large events do not fan out hundreds of
// CLOB /book requests on first paint.
export const MAX_MARKETS_WITH_REST_QUOTES = 20;

export type BookSnapshot = {
  market?: string;
  asset_id?: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  min_order_size?: string;
  tick_size?: string;
};

export type PriceHistoryPoint = {
  t: number;
  p: number;
};

export type PriceHistoryBatchResponse = {
  success: boolean;
  /** True when the server could not fetch every requested token. */
  partial?: boolean;
  histories: Array<{
    tokenId: string;
    history: PriceHistoryPoint[];
  }>;
};

// Dedicated trading-panel order book snapshot shape.
// Keep this separate from other ["orderBook", tokenId] query consumers so the
// trading form never reads an incompatible cached payload and waits for staleness.
export interface TradingPanelOrderBookSnapshot {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  min_order_size: string;
  tick_size: string;
}

export async function fetchBookSnapshot(
  tokenId: string
): Promise<BookSnapshot | null> {
  try {
    return await fetchClobOrderBook(tokenId, { host: CLOB_BASE_URL });
  } catch {
    return null;
  }
}

export async function fetchBookSnapshots(
  tokenIds: string[]
): Promise<BookSnapshot[]> {
  if (tokenIds.length === 0) return [];

  try {
    return await fetchClobOrderBooks(tokenIds, { host: CLOB_BASE_URL });
  } catch {
    return [];
  }
}

export async function fetchPriceHistoryBatch(
  tokenIds: readonly string[],
  startTs: number,
  fidelity: number
): Promise<{
  histories: PriceHistoryBatchResponse["histories"];
  partial: boolean;
}> {
  if (tokenIds.length === 0) return { histories: [], partial: false };

  const response = await fetch("/api/markets/price-history/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenIds, startTs, fidelity }),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch price history");
  }

  const data = (await response.json()) as PriceHistoryBatchResponse;
  if (!data.success) return { histories: [], partial: true };
  return { histories: data.histories, partial: data.partial === true };
}
