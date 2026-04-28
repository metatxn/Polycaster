/**
 * Trade P&L computation for resolved Polymarket markets.
 *
 * Polymarket encodes the resolution as `outcomePrices` — a JSON-string
 * array of per-outcome payouts, where the winning outcome gets 1 and
 * losers get 0 (or 0.5/0.5 for "draws" the market couldn't break).
 *
 * For a trade (outcomeIndex=K, side, size, price):
 *   BUY  profit per share = outcomePrices[K] - price
 *   SELL profit per share = price - outcomePrices[K]
 * Dollar profit = profit-per-share × size.
 */

import Decimal from "decimal.js";
import type { TradeSide } from "./detector";

export interface ResolvedOutcomes {
  /** Parsed outcomePrices — e.g. [1, 0] for a Yes-wins resolution. */
  prices: number[];
  /** Index of the winning outcome, or null if the resolution is a draw
   *  (multiple 0.5 values) or malformed. */
  winnerIndex: number | null;
  /** True if the resolution is a 50/50 draw or otherwise indeterminate. */
  isDraw: boolean;
}

export interface TradeForPnl {
  outcomeIndex: number;
  side: TradeSide;
  /** Number of shares (Polymarket "size"). */
  size: number;
  /** Price per share at trade time, 0..1. */
  price: number;
}

export interface TradePnl {
  /** Dollar profit on this trade vs. hold-to-resolution. */
  profit: number;
  /** Per-share profit (profit / size). */
  profitPerShare: number;
  /** True if profit > 0. */
  isWin: boolean;
  /** True if profit < 0. */
  isLoss: boolean;
  /** True if |profit| is below the epsilon. */
  isPush: boolean;
}

/**
 * Parse Polymarket's `outcomePrices` field. It arrives as a JSON-string
 * like `"[\"1\", \"0\"]"` — string-encoded numbers inside a string.
 * Returns a normalized structure; never throws.
 */
export function parseOutcomes(outcomePricesJson: string): ResolvedOutcomes {
  let prices: number[] = [];
  try {
    const raw = JSON.parse(outcomePricesJson) as string[] | number[];
    prices = (raw as Array<string | number>).map((v) => Number(v));
  } catch {
    return { prices: [], winnerIndex: null, isDraw: false };
  }

  if (prices.length === 0 || prices.some((p) => Number.isNaN(p))) {
    return { prices: [], winnerIndex: null, isDraw: false };
  }

  // Draw: no outcome dominates (all ≤0.6 or all equal).
  const max = Math.max(...prices);
  const winners = prices.filter((p) => p >= 0.9);
  const isDraw = winners.length !== 1 || max < 0.9;
  if (isDraw) {
    return { prices, winnerIndex: null, isDraw: true };
  }

  return { prices, winnerIndex: prices.indexOf(max), isDraw: false };
}

/**
 * Compute P&L for a single trade given the market's resolution.
 * Returns null if the market is a draw — those are excluded from
 * backtest metrics since there's no meaningful winner.
 */
export function computeTradePnl(
  trade: TradeForPnl,
  outcomes: ResolvedOutcomes
): TradePnl | null {
  if (outcomes.isDraw || outcomes.prices.length === 0) return null;
  if (trade.outcomeIndex < 0 || trade.outcomeIndex >= outcomes.prices.length) {
    return null;
  }

  const finalPayout = new Decimal(outcomes.prices[trade.outcomeIndex]);
  const price = new Decimal(trade.price);
  const size = new Decimal(trade.size);
  const profitPerShare =
    trade.side === "BUY" ? finalPayout.minus(price) : price.minus(finalPayout);
  const profit = profitPerShare.mul(size);

  const EPS = new Decimal("0.000001");
  return {
    profit: profit.toNumber(),
    profitPerShare: profitPerShare.toNumber(),
    isWin: profit.gt(EPS),
    isLoss: profit.lt(EPS.neg()),
    isPush: profit.abs().lte(EPS),
  };
}

/**
 * Aggregate P&L stats over many trades. Used for both flagged and
 * baseline cohorts so the call sites can report win rates & mean P&L
 * in a single shape.
 */
export interface PnlAggregate {
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  totalProfit: number;
  meanProfit: number;
  /** Mean profit per share — dimensionless, comparable across sizes. */
  meanProfitPerShare: number;
  totalVolume: number;
}

export function aggregatePnl(entries: TradePnl[]): PnlAggregate {
  if (entries.length === 0) {
    return {
      count: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      winRate: 0,
      totalProfit: 0,
      meanProfit: 0,
      meanProfitPerShare: 0,
      totalVolume: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let totalProfit = new Decimal(0);
  let totalPps = new Decimal(0);
  for (const e of entries) {
    if (e.isWin) wins++;
    else if (e.isLoss) losses++;
    else pushes++;
    totalProfit = totalProfit.add(e.profit);
    totalPps = totalPps.add(e.profitPerShare);
  }

  // Win rate excludes pushes from the denominator. A trade that
  // clears at the resolved payout is a non-bet, not a loss.
  const decisive = wins + losses;

  return {
    count: entries.length,
    wins,
    losses,
    pushes,
    winRate: decisive > 0 ? wins / decisive : 0,
    totalProfit: totalProfit.toNumber(),
    meanProfit: totalProfit.div(entries.length).toNumber(),
    meanProfitPerShare: totalPps.div(entries.length).toNumber(),
    totalVolume: 0, // caller fills in from the underlying trade volume
  };
}
