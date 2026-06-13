import Decimal from "decimal.js";
import type { EventMarket } from "./types";

// ── Formatting helpers ─────────────────────────────────────────────

export function normalizePrice(price: number): number {
  if (!Number.isFinite(price)) return 0;
  return Math.max(0, Math.min(1, price));
}

export function toDecimal(value: number | string | undefined): Decimal {
  try {
    return new Decimal(value ?? 0);
  } catch {
    return new Decimal(0);
  }
}

export function formatUsd(value: number | string | undefined): string {
  return `$${toDecimal(value).toFixed(2)}`;
}

export function formatSignedUsd(value: number | string | undefined): string {
  const decimal = toDecimal(value);
  // Owner rule: no "+" on gains (green already signals positive); losses keep "-".
  const sign = decimal.lt(0) ? "-" : "";
  return `${sign}$${decimal.abs().toFixed(2)}`;
}

export function formatPositionPercent(
  value: number | string | undefined
): string {
  const decimal = toDecimal(value);
  // Owner rule: no "+" on gains (green already signals positive); losses keep "-".
  const sign = decimal.lt(0) ? "-" : "";
  return `${sign}${decimal.abs().toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1)}%`;
}

export function resolveLivePrice(
  tokenId: string | undefined,
  fallbackPrice: number,
  orderBooks: Map<
    string,
    { midpoint: number | null; bestBid: number | null; bestAsk: number | null }
  >,
  lastTrades: Map<string, { price: number }>
): number {
  if (!tokenId) return fallbackPrice;
  const lastTrade = lastTrades.get(tokenId);
  const orderBook = orderBooks.get(tokenId);
  const livePrice =
    lastTrade?.price ??
    orderBook?.midpoint ??
    orderBook?.bestBid ??
    orderBook?.bestAsk;
  return normalizePrice(livePrice ?? fallbackPrice);
}

export function tokenIdForOutcome(
  market: EventMarket | null,
  outcomeIndex: number
): string {
  if (!market) return "";
  return market.clobTokenIds?.[outcomeIndex] || "";
}
