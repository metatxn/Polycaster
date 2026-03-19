/**
 * Slippage calculation utilities for Polymarket orders.
 *
 * Pure utility — no framework or runtime dependencies.
 * Used by both the web app and the Chrome extension.
 */

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface SlippageResult {
  canFill: boolean;
  avgFillPrice: number;
  bestPrice: number;
  worstPrice: number;
  slippage: number;
  slippagePercent: number;
  totalNotional: number;
  fills: Array<{ price: number; size: number; notional: number }>;
  unfilledSize: number;
  filledSize: number;
}

export interface MarketOrderPriceResult {
  limitPrice: number;
  expectedSlippage: SlippageResult;
  priceExceedsMaxSlippage: boolean;
}

const MARKET_BUFFER = 0.005;

function parseLevel(
  level: OrderBookLevel
): { price: number; size: number } | null {
  const price = parseFloat(level.price);
  const size = parseFloat(level.size);
  if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) {
    return null;
  }
  return { price, size };
}

export function roundUpToTick(price: number, tickSize: number): number {
  return Math.ceil(price / tickSize) * tickSize;
}

export function roundDownToTick(price: number, tickSize: number): number {
  return Math.floor(price / tickSize) * tickSize;
}

export function roundToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

function createEmptyResult(size: number): SlippageResult {
  return {
    canFill: false,
    avgFillPrice: 0,
    bestPrice: 0,
    worstPrice: 0,
    slippage: 0,
    slippagePercent: 0,
    totalNotional: 0,
    fills: [],
    unfilledSize: size,
    filledSize: 0,
  };
}

export function calculateBuySlippage(
  orderBook: OrderBook,
  size: number
): SlippageResult {
  if (size <= 0) return createEmptyResult(0);

  const sortedAsks = (orderBook.asks || [])
    .map(parseLevel)
    .filter((l): l is { price: number; size: number } => l !== null)
    .sort((a, b) => a.price - b.price);

  if (sortedAsks.length === 0) return createEmptyResult(size);

  const bestPrice = sortedAsks[0].price;
  let remaining = size;
  let totalCost = 0;
  let worstPrice = bestPrice;
  const fills: SlippageResult["fills"] = [];

  for (const level of sortedAsks) {
    if (remaining <= 0) break;
    const fillSize = Math.min(remaining, level.size);
    const fillCost = fillSize * level.price;
    fills.push({ price: level.price, size: fillSize, notional: fillCost });
    totalCost += fillCost;
    remaining -= fillSize;
    worstPrice = level.price;
  }

  const filledSize = size - remaining;
  const avgFillPrice = filledSize > 0 ? totalCost / filledSize : 0;
  const slippage = avgFillPrice - bestPrice;
  const slippagePercent = bestPrice > 0 ? (slippage / bestPrice) * 100 : 0;

  return {
    canFill: remaining === 0,
    avgFillPrice,
    bestPrice,
    worstPrice,
    slippage,
    slippagePercent,
    totalNotional: totalCost,
    fills,
    unfilledSize: remaining,
    filledSize,
  };
}

export function calculateSellSlippage(
  orderBook: OrderBook,
  size: number
): SlippageResult {
  if (size <= 0) return createEmptyResult(0);

  const sortedBids = (orderBook.bids || [])
    .map(parseLevel)
    .filter((l): l is { price: number; size: number } => l !== null)
    .sort((a, b) => b.price - a.price);

  if (sortedBids.length === 0) return createEmptyResult(size);

  const bestPrice = sortedBids[0].price;
  let remaining = size;
  let totalProceeds = 0;
  let worstPrice = bestPrice;
  const fills: SlippageResult["fills"] = [];

  for (const level of sortedBids) {
    if (remaining <= 0) break;
    const fillSize = Math.min(remaining, level.size);
    const fillProceeds = fillSize * level.price;
    fills.push({ price: level.price, size: fillSize, notional: fillProceeds });
    totalProceeds += fillProceeds;
    remaining -= fillSize;
    worstPrice = level.price;
  }

  const filledSize = size - remaining;
  const avgFillPrice = filledSize > 0 ? totalProceeds / filledSize : 0;
  const slippage = bestPrice - avgFillPrice;
  const slippagePercent = bestPrice > 0 ? (slippage / bestPrice) * 100 : 0;

  return {
    canFill: remaining === 0,
    avgFillPrice,
    bestPrice,
    worstPrice,
    slippage,
    slippagePercent,
    totalNotional: totalProceeds,
    fills,
    unfilledSize: remaining,
    filledSize,
  };
}

export function calculateSlippage(
  orderBook: OrderBook,
  side: "BUY" | "SELL",
  size: number
): SlippageResult {
  return side === "BUY"
    ? calculateBuySlippage(orderBook, size)
    : calculateSellSlippage(orderBook, size);
}

export function calculateMarketOrderPrice(
  orderBook: OrderBook,
  side: "BUY" | "SELL",
  size: number,
  maxSlippagePercent: number = 2,
  tickSize: number = 0.01,
  requireFullFill: boolean = true
): MarketOrderPriceResult | null {
  if (size <= 0) return null;

  const slippageResult = calculateSlippage(orderBook, side, size);

  if (slippageResult.fills.length === 0) return null;

  if (requireFullFill && !slippageResult.canFill) return null;

  const maxFrac = maxSlippagePercent / 100;
  let limitPrice: number;
  let priceExceedsMaxSlippage = false;

  if (side === "BUY") {
    const maxPrice = slippageResult.bestPrice * (1 + maxFrac);
    if (slippageResult.worstPrice > maxPrice) {
      limitPrice = roundUpToTick(maxPrice, tickSize);
      priceExceedsMaxSlippage = true;
    } else {
      limitPrice = roundUpToTick(
        slippageResult.worstPrice * (1 + MARKET_BUFFER),
        tickSize
      );
    }
    limitPrice = Math.min(maxPrice, limitPrice);
    limitPrice = Math.min(0.99, limitPrice);
  } else {
    const minPrice = slippageResult.bestPrice * (1 - maxFrac);
    if (slippageResult.worstPrice < minPrice) {
      limitPrice = roundDownToTick(minPrice, tickSize);
      priceExceedsMaxSlippage = true;
    } else {
      limitPrice = roundDownToTick(
        slippageResult.worstPrice * (1 - MARKET_BUFFER),
        tickSize
      );
    }
    limitPrice = Math.max(minPrice, limitPrice);
    limitPrice = Math.max(0.01, limitPrice);
  }

  return {
    limitPrice,
    expectedSlippage: slippageResult,
    priceExceedsMaxSlippage,
  };
}

export function formatSlippageDisplay(
  slippage: SlippageResult,
  side?: "BUY" | "SELL"
): {
  avgPrice: string;
  bestPrice: string;
  worstPrice: string;
  slippageAmount: string;
  slippagePercent: string;
  totalLabel: string;
  totalNotional: string;
  fillsDescription: string;
  filledSize: string;
  unfilledSize: string;
} {
  const formatPrice = (p: number) => `${(p * 100).toFixed(1)}¢`;
  const formatNotional = (n: number) => `$${n.toFixed(2)}`;

  return {
    avgPrice: formatPrice(slippage.avgFillPrice),
    bestPrice: formatPrice(slippage.bestPrice),
    worstPrice: formatPrice(slippage.worstPrice),
    slippageAmount: formatPrice(slippage.slippage),
    slippagePercent: `${slippage.slippagePercent.toFixed(2)}%`,
    totalLabel: side === "SELL" ? "Total Proceeds" : "Total Cost",
    totalNotional: formatNotional(slippage.totalNotional),
    fillsDescription: slippage.fills
      .map((f) => `${f.size.toFixed(0)} @ ${formatPrice(f.price)}`)
      .join(", "),
    filledSize: slippage.filledSize.toFixed(0),
    unfilledSize: slippage.unfilledSize.toFixed(0),
  };
}
