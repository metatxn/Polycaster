/**
 * Slippage calculation utilities for Polymarket orders.
 *
 * Pure utility — no framework or runtime dependencies.
 * Used by both the web app and the Chrome extension.
 *
 * All internal arithmetic uses Decimal.js to avoid IEEE 754 rounding errors
 * on monetary values. Public interfaces return plain `number` so callers
 * don't need to depend on Decimal directly.
 */

import { Decimal } from "decimal.js";

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

const MARKET_BUFFER = new Decimal("0.005");
const HUNDRED = new Decimal(100);
const ONE = new Decimal(1);
const PRICE_CEIL = new Decimal("0.99");
const PRICE_FLOOR = new Decimal("0.01");

interface ParsedLevel {
  price: Decimal;
  size: Decimal;
}

function parseLevel(level: OrderBookLevel): ParsedLevel | null {
  try {
    const price = new Decimal(level.price);
    const size = new Decimal(level.size);
    if (!price.isFinite() || !size.isFinite() || size.lte(0)) return null;
    return { price, size };
  } catch {
    return null;
  }
}

export function roundUpToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) throw new Error("tickSize must be positive");
  const p = new Decimal(price);
  const t = new Decimal(tickSize);
  return p.div(t).ceil().mul(t).toNumber();
}

export function roundDownToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) throw new Error("tickSize must be positive");
  const p = new Decimal(price);
  const t = new Decimal(tickSize);
  return p.div(t).floor().mul(t).toNumber();
}

export function roundToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) throw new Error("tickSize must be positive");
  const p = new Decimal(price);
  const t = new Decimal(tickSize);
  return p.div(t).round().mul(t).toNumber();
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
    .filter((l): l is ParsedLevel => l !== null)
    .sort((a, b) => a.price.cmp(b.price));

  if (sortedAsks.length === 0) return createEmptyResult(size);

  const bestPrice = sortedAsks[0].price;
  let remaining = new Decimal(size);
  let totalCost = new Decimal(0);
  let worstPrice = bestPrice;
  const fills: SlippageResult["fills"] = [];

  for (const level of sortedAsks) {
    if (remaining.lte(0)) break;
    const fillSize = Decimal.min(remaining, level.size);
    const fillCost = fillSize.mul(level.price);
    fills.push({
      price: level.price.toNumber(),
      size: fillSize.toNumber(),
      notional: fillCost.toNumber(),
    });
    totalCost = totalCost.add(fillCost);
    remaining = remaining.sub(fillSize);
    worstPrice = level.price;
  }

  const filledSize = new Decimal(size).sub(remaining);
  const avgFillPrice = filledSize.gt(0)
    ? totalCost.div(filledSize)
    : new Decimal(0);
  const slippage = avgFillPrice.sub(bestPrice);
  const slippagePercent = bestPrice.gt(0)
    ? slippage.div(bestPrice).mul(HUNDRED)
    : new Decimal(0);

  return {
    canFill: remaining.isZero(),
    avgFillPrice: avgFillPrice.toNumber(),
    bestPrice: bestPrice.toNumber(),
    worstPrice: worstPrice.toNumber(),
    slippage: slippage.toNumber(),
    slippagePercent: slippagePercent.toNumber(),
    totalNotional: totalCost.toNumber(),
    fills,
    unfilledSize: remaining.toNumber(),
    filledSize: filledSize.toNumber(),
  };
}

export function calculateSellSlippage(
  orderBook: OrderBook,
  size: number
): SlippageResult {
  if (size <= 0) return createEmptyResult(0);

  const sortedBids = (orderBook.bids || [])
    .map(parseLevel)
    .filter((l): l is ParsedLevel => l !== null)
    .sort((a, b) => b.price.cmp(a.price));

  if (sortedBids.length === 0) return createEmptyResult(size);

  const bestPrice = sortedBids[0].price;
  let remaining = new Decimal(size);
  let totalProceeds = new Decimal(0);
  let worstPrice = bestPrice;
  const fills: SlippageResult["fills"] = [];

  for (const level of sortedBids) {
    if (remaining.lte(0)) break;
    const fillSize = Decimal.min(remaining, level.size);
    const fillProceeds = fillSize.mul(level.price);
    fills.push({
      price: level.price.toNumber(),
      size: fillSize.toNumber(),
      notional: fillProceeds.toNumber(),
    });
    totalProceeds = totalProceeds.add(fillProceeds);
    remaining = remaining.sub(fillSize);
    worstPrice = level.price;
  }

  const filledSize = new Decimal(size).sub(remaining);
  const avgFillPrice = filledSize.gt(0)
    ? totalProceeds.div(filledSize)
    : new Decimal(0);
  const slippage = bestPrice.sub(avgFillPrice);
  const slippagePercent = bestPrice.gt(0)
    ? slippage.div(bestPrice).mul(HUNDRED)
    : new Decimal(0);

  return {
    canFill: remaining.isZero(),
    avgFillPrice: avgFillPrice.toNumber(),
    bestPrice: bestPrice.toNumber(),
    worstPrice: worstPrice.toNumber(),
    slippage: slippage.toNumber(),
    slippagePercent: slippagePercent.toNumber(),
    totalNotional: totalProceeds.toNumber(),
    fills,
    unfilledSize: remaining.toNumber(),
    filledSize: filledSize.toNumber(),
  };
}

/**
 * Slippage for a MARKET BUY expressed as a USD budget rather than a share
 * count. Walks the ask side spending `amount` dollars, partial-filling the
 * final level with whatever budget remains.
 *
 * This mirrors how Polymarket's `createMarketOrder` consumes a BUY — it takes a
 * notional USDC `amount`, not a `size` — so a ticket that lets the user spend
 * "$X" maps 1:1 to what is actually submitted on-chain. (SELL market orders
 * stay size-based; use `calculateSellSlippage` for those.)
 *
 * `filledSize` is the (possibly fractional) number of shares the budget buys,
 * and `totalNotional` is what is actually spent. `canFill` is true when the
 * book had enough depth to deploy the whole budget; false means the amount
 * exceeds available liquidity (surfaced as "Insufficient liquidity" upstream,
 * exactly like the size-based path's `canFill`).
 */
export function calculateBuySlippageForAmount(
  orderBook: OrderBook,
  amount: number
): SlippageResult {
  if (!(amount > 0)) return createEmptyResult(0);

  const sortedAsks = (orderBook.asks || [])
    .map(parseLevel)
    .filter((l): l is ParsedLevel => l !== null)
    .sort((a, b) => a.price.cmp(b.price));

  if (sortedAsks.length === 0) return createEmptyResult(0);

  const bestPrice = sortedAsks[0].price;
  let remainingBudget = new Decimal(amount);
  let totalCost = new Decimal(0);
  let totalShares = new Decimal(0);
  let worstPrice = bestPrice;
  const fills: SlippageResult["fills"] = [];

  for (const level of sortedAsks) {
    if (remainingBudget.lte(0)) break;
    const levelCost = level.price.mul(level.size);
    if (levelCost.lte(remainingBudget)) {
      // Budget clears this entire level — take all of it.
      fills.push({
        price: level.price.toNumber(),
        size: level.size.toNumber(),
        notional: levelCost.toNumber(),
      });
      totalShares = totalShares.add(level.size);
      totalCost = totalCost.add(levelCost);
      remainingBudget = remainingBudget.sub(levelCost);
      worstPrice = level.price;
    } else {
      // Final, partial level — buy as many shares as the remaining budget
      // affords at this price, then stop.
      const affordableShares = remainingBudget.div(level.price);
      fills.push({
        price: level.price.toNumber(),
        size: affordableShares.toNumber(),
        notional: remainingBudget.toNumber(),
      });
      totalShares = totalShares.add(affordableShares);
      totalCost = totalCost.add(remainingBudget);
      worstPrice = level.price;
      remainingBudget = new Decimal(0);
      break;
    }
  }

  const avgFillPrice = totalShares.gt(0)
    ? totalCost.div(totalShares)
    : new Decimal(0);
  const slippage = avgFillPrice.sub(bestPrice);
  const slippagePercent = bestPrice.gt(0)
    ? slippage.div(bestPrice).mul(HUNDRED)
    : new Decimal(0);

  return {
    canFill: remainingBudget.lte(0),
    avgFillPrice: avgFillPrice.toNumber(),
    bestPrice: bestPrice.toNumber(),
    worstPrice: worstPrice.toNumber(),
    slippage: slippage.toNumber(),
    slippagePercent: slippagePercent.toNumber(),
    totalNotional: totalCost.toNumber(),
    fills,
    unfilledSize: 0,
    filledSize: totalShares.toNumber(),
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

  const maxFrac = new Decimal(maxSlippagePercent).div(HUNDRED);
  const best = new Decimal(slippageResult.bestPrice);
  const worst = new Decimal(slippageResult.worstPrice);
  let limitPrice: Decimal;
  let priceExceedsMaxSlippage = false;

  if (side === "BUY") {
    const maxPrice = best.mul(ONE.add(maxFrac));
    if (worst.gt(maxPrice)) {
      limitPrice = new Decimal(roundUpToTick(maxPrice.toNumber(), tickSize));
      priceExceedsMaxSlippage = true;
    } else {
      limitPrice = new Decimal(
        roundUpToTick(worst.mul(ONE.add(MARKET_BUFFER)).toNumber(), tickSize)
      );
    }
    limitPrice = Decimal.min(maxPrice, limitPrice);
    limitPrice = Decimal.min(PRICE_CEIL, limitPrice);
  } else {
    const minPrice = best.mul(ONE.sub(maxFrac));
    if (worst.lt(minPrice)) {
      limitPrice = new Decimal(roundDownToTick(minPrice.toNumber(), tickSize));
      priceExceedsMaxSlippage = true;
    } else {
      limitPrice = new Decimal(
        roundDownToTick(worst.mul(ONE.sub(MARKET_BUFFER)).toNumber(), tickSize)
      );
    }
    limitPrice = Decimal.max(minPrice, limitPrice);
    limitPrice = Decimal.max(PRICE_FLOOR, limitPrice);
  }

  return {
    limitPrice: limitPrice.toNumber(),
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
  const formatPrice = (p: number) =>
    `${new Decimal(p).mul(HUNDRED).toFixed(1)}¢`;
  const formatNotional = (n: number) => `$${new Decimal(n).toFixed(2)}`;

  return {
    avgPrice: formatPrice(slippage.avgFillPrice),
    bestPrice: formatPrice(slippage.bestPrice),
    worstPrice: formatPrice(slippage.worstPrice),
    slippageAmount: formatPrice(slippage.slippage),
    slippagePercent: `${new Decimal(slippage.slippagePercent).toFixed(2)}%`,
    totalLabel: side === "SELL" ? "Total Proceeds" : "Total Cost",
    totalNotional: formatNotional(slippage.totalNotional),
    fillsDescription: slippage.fills
      .map((f) => `${new Decimal(f.size).toFixed(0)} @ ${formatPrice(f.price)}`)
      .join(", "),
    filledSize: new Decimal(slippage.filledSize).toFixed(0),
    unfilledSize: new Decimal(slippage.unfilledSize).toFixed(0),
  };
}
