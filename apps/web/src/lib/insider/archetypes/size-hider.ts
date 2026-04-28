/**
 * Size-hiding accumulator archetype.
 *
 * Catches wallets that split a large conviction bet into many smaller
 * trades on one market, one direction, within a compressed time window.
 * The goal of a size-hider is to avoid triggering size-based filters
 * ("whale alert!") while still building the position they want before
 * a catalyst hits.
 *
 * Input is not per-trade but per-(wallet, market, side) — the caller
 * aggregates raw trades into an `AccumulatorContext` first, then we
 * score the pattern. The same score is attributed to every individual
 * trade in the accumulation, so the ensemble can fire on each of them.
 *
 * Unlike account-loader this archetype is account-AGE blind. The
 * sophisticated insider we're after has an aged wallet; that's
 * precisely why account-loader misses them.
 */

import Decimal from "decimal.js";
import type { ArchetypeScore, SuspicionFactor } from "./types";

export type TradeSide = "BUY" | "SELL";

export interface AccumulatedTrade {
  timestamp: number;
  usdValue: number;
  price: number;
  size: number;
}

/**
 * Per-(wallet, market, side) accumulation context. The caller builds
 * one of these per distinct (wallet, market, side) triple by grouping
 * raw trades.
 */
export interface AccumulatorContext {
  /** Number of distinct trades in this wallet/market/side accumulation. */
  tradeCount: number;
  /** Aggregate USD across all trades. */
  totalUsdValue: number;
  /** Earliest trade timestamp (unix seconds). */
  firstTimestamp: number;
  /** Latest trade timestamp (unix seconds). */
  lastTimestamp: number;
  /** Volume-weighted average fill price across the accumulation, 0..1. */
  vwapPrice: number;
  /** Trades in timestamp-ascending order; used for window-density stats. */
  trades: AccumulatedTrade[];
}

export const SIZE_HIDER_THRESHOLD = 40;

/** Minimum number of trades in one direction on one market to qualify. */
const MIN_TRADE_COUNT = 3;
/** Minimum aggregate USD to score at all. */
const MIN_AGGREGATE_USD = 5_000;
/** Window (hours) inside which splitting is considered "fast" accumulation. */
const FAST_ACCUMULATION_WINDOW_HOURS = 24;

/**
 * Score a (wallet, market, side) accumulation. Returns a null-equivalent
 * ArchetypeScore (score=0) when the pattern doesn't apply, so callers
 * can always attribute some archetype result to a trade even if the
 * size-hider didn't fire for that wallet/market/side.
 */
export function scoreSizeHider(ctx: AccumulatorContext): ArchetypeScore {
  const factors: SuspicionFactor[] = [];
  let score = 0;
  const totalUsd = new Decimal(ctx.totalUsdValue);

  if (ctx.tradeCount < MIN_TRADE_COUNT) {
    return {
      archetype: "size_hider",
      score: 0,
      threshold: SIZE_HIDER_THRESHOLD,
      factors: [],
    };
  }
  if (totalUsd.lt(MIN_AGGREGATE_USD)) {
    return {
      archetype: "size_hider",
      score: 0,
      threshold: SIZE_HIDER_THRESHOLD,
      factors: [],
    };
  }

  // Factor 1: Trade count — more splits = more effortful hiding (max 25 points)
  if (ctx.tradeCount >= 15) {
    const pts = 25;
    score += pts;
    factors.push({
      name: "Split Depth",
      points: pts,
      description: `Accumulated via ${ctx.tradeCount} separate trades`,
    });
  } else if (ctx.tradeCount >= 8) {
    const pts = 18;
    score += pts;
    factors.push({
      name: "Split Depth",
      points: pts,
      description: `Accumulated via ${ctx.tradeCount} separate trades`,
    });
  } else if (ctx.tradeCount >= 5) {
    const pts = 12;
    score += pts;
    factors.push({
      name: "Split Depth",
      points: pts,
      description: `Accumulated via ${ctx.tradeCount} separate trades`,
    });
  } else {
    // tradeCount === 3 or 4
    const pts = 6;
    score += pts;
    factors.push({
      name: "Split Depth",
      points: pts,
      description: `Accumulated via ${ctx.tradeCount} separate trades`,
    });
  }

  // Factor 2: Aggregate size (max 30 points) — bigger position = more conviction
  if (totalUsd.gte(100_000)) {
    const pts = 30;
    score += pts;
    factors.push({
      name: "Aggregate Size",
      points: pts,
      description: `$${formatK(totalUsd)} accumulated on one side`,
    });
  } else if (totalUsd.gte(50_000)) {
    const pts = 22;
    score += pts;
    factors.push({
      name: "Aggregate Size",
      points: pts,
      description: `$${formatK(totalUsd)} accumulated on one side`,
    });
  } else if (totalUsd.gte(20_000)) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Aggregate Size",
      points: pts,
      description: `$${formatK(totalUsd)} accumulated on one side`,
    });
  } else if (totalUsd.gte(10_000)) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Aggregate Size",
      points: pts,
      description: `$${formatK(totalUsd)} accumulated on one side`,
    });
  } else {
    const pts = 5;
    score += pts;
    factors.push({
      name: "Aggregate Size",
      points: pts,
      description: `$${formatK(totalUsd)} accumulated on one side`,
    });
  }

  // Factor 3: Compression — a tight window suggests urgency (max 20 points).
  const windowHours =
    Math.max(0, ctx.lastTimestamp - ctx.firstTimestamp) / 3600;
  if (windowHours <= 1) {
    const pts = 20;
    score += pts;
    factors.push({
      name: "Accumulation Window",
      points: pts,
      description: `All trades within ${formatDuration(windowHours)}`,
    });
  } else if (windowHours <= 6) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Accumulation Window",
      points: pts,
      description: `All trades within ${formatDuration(windowHours)}`,
    });
  } else if (windowHours <= FAST_ACCUMULATION_WINDOW_HOURS) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Accumulation Window",
      points: pts,
      description: `Accumulated over ${formatDuration(windowHours)}`,
    });
  } else if (windowHours <= 72) {
    const pts = 5;
    score += pts;
    factors.push({
      name: "Accumulation Window",
      points: pts,
      description: `Accumulated over ${formatDuration(windowHours)}`,
    });
  }

  // Factor 4: Uniform sizing (max 15 points).
  // Insiders often break a position into similarly-sized trades so no
  // single one trips a whale filter. Detect by coefficient-of-variation
  // of USD values: low CV ⇒ suspiciously uniform.
  if (ctx.trades.length >= 4) {
    const mean = totalUsd.div(ctx.trades.length);
    const variance = ctx.trades
      .reduce(
        (sum, trade) => sum.add(new Decimal(trade.usdValue).minus(mean).pow(2)),
        new Decimal(0)
      )
      .div(ctx.trades.length);
    const stdev = variance.sqrt();
    const cv = mean.gt(0) ? stdev.div(mean) : new Decimal(0);

    if (cv.lt(0.1)) {
      const pts = 15;
      score += pts;
      factors.push({
        name: "Uniform Sizing",
        points: pts,
        description: `Trades were near-identical in size (CV ${cv.mul(100).toFixed(0)}%)`,
      });
    } else if (cv.lt(0.25)) {
      const pts = 8;
      score += pts;
      factors.push({
        name: "Uniform Sizing",
        points: pts,
        description: `Trades were similarly sized (CV ${cv.mul(100).toFixed(0)}%)`,
      });
    }
  }

  // Factor 5: Price drift — building a position while price is against
  // you is a stronger conviction signal than buying into momentum.
  // We check if the VWAP is "worse" than the last trade's price, meaning
  // the insider was paying a premium to keep accumulating. (max 10 points)
  if (ctx.trades.length >= 3) {
    const lastPrice = ctx.trades[ctx.trades.length - 1].price;
    const firstPrice = ctx.trades[0].price;
    const drift = Math.abs(lastPrice - firstPrice);
    if (drift > 0.08) {
      const pts = 10;
      score += pts;
      factors.push({
        name: "Price Drift",
        points: pts,
        description: `Price moved ${(drift * 100).toFixed(0)}¢ during accumulation`,
      });
    } else if (drift > 0.03) {
      const pts = 5;
      score += pts;
      factors.push({
        name: "Price Drift",
        points: pts,
        description: `Price moved ${(drift * 100).toFixed(0)}¢ during accumulation`,
      });
    }
  }

  return {
    archetype: "size_hider",
    score: Math.min(score, 100),
    threshold: SIZE_HIDER_THRESHOLD,
    factors,
  };
}

function formatK(value: Decimal): string {
  if (value.gte(1_000_000)) return `${value.div(1_000_000).toFixed(1)}M`;
  if (value.gte(1_000)) return `${value.div(1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
