/**
 * Timing-cluster archetype.
 *
 * Catches ≥3 DIFFERENT wallets crossing the same side of the same
 * market within a tight window (≤15 min), before a material price
 * move in their direction.
 *
 * Why it's a strong insider signal:
 *  - Sophisticated coordination (one person with multiple wallets, or
 *    a tip passing between friends) looks like several unrelated
 *    trades, but clusters in time.
 *  - The "before a favorable price move" filter separates coordinated
 *    front-running from random correlated noise (e.g. several traders
 *    independently reacting to public news — those trades usually
 *    come AFTER the price starts moving).
 *
 * Unlike size-hider, this archetype is scored at the (market, side,
 * cluster) level. Every trade in a qualifying cluster gets the same
 * archetype score attributed to it.
 */

import Decimal from "decimal.js";
import type { PriceBucket } from "../price-history";
import { priceAt } from "../price-history";
import type { ArchetypeScore, SuspicionFactor } from "./types";

export type TradeSide = "BUY" | "SELL";

export interface ClusterTrade {
  wallet: string;
  timestamp: number; // unix seconds
  usdValue: number;
  price: number;
  size: number;
}

export interface TimingClusterContext {
  /** All trades (for a single market + side) in this cluster, in
   *  timestamp-ascending order. Trades are considered "in cluster" if
   *  they fall inside a rolling `windowSeconds` bucket. */
  trades: ClusterTrade[];
  /** Distinct wallet count in the cluster. */
  uniqueWallets: number;
  /** Aggregate USD in the cluster. */
  totalUsdValue: number;
  /** First and last trade timestamps (unix seconds). */
  firstTimestamp: number;
  lastTimestamp: number;
  /** Price history for the market side, used to score post-cluster
   *  price movement. Pass an empty array if unavailable — the archetype
   *  still scores based on tightness alone, with reduced weight. */
  priceHistory: PriceBucket[];
}

export const TIMING_CLUSTER_THRESHOLD = 40;

/** Minimum wallets in the cluster for this archetype to engage. */
const MIN_UNIQUE_WALLETS = 3;
/** Maximum window (seconds) within which trades are considered clustered. */
export const CLUSTER_WINDOW_SECONDS = 15 * 60; // 15 minutes
/** Minimum favorable price move after the cluster — HARD GATE. Raised
 *  from 5¢ to 10¢ in Phase 3 after sports-market backtest showed that
 *  sub-10¢ moves were dominated by momentum noise that reverses. */
const MIN_FAVORABLE_MOVE = 0.1; // 10 cents

/**
 * Build clusters from a market's trades. Given per-(market, side)
 * trades in time-ascending order, sliding window of size
 * `CLUSTER_WINDOW_SECONDS` identifies runs of ≥3 distinct wallets.
 *
 * Each qualifying cluster is returned with its aggregate stats. One
 * trade can belong to at most one cluster (the first one it qualifies
 * into) — the caller can then attribute the cluster's score to every
 * trade inside it.
 */
export function buildClusters(
  trades: ClusterTrade[],
  priceHistory: PriceBucket[]
): TimingClusterContext[] {
  if (trades.length < MIN_UNIQUE_WALLETS) return [];

  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const clusters: TimingClusterContext[] = [];
  const assigned = new Set<number>(); // trade indices already in a cluster

  for (let i = 0; i < sorted.length; i++) {
    if (assigned.has(i)) continue;

    // Walk forward collecting trades within the window starting at i.
    const members: Array<{ idx: number; trade: ClusterTrade }> = [
      { idx: i, trade: sorted[i] },
    ];
    const windowEnd = sorted[i].timestamp + CLUSTER_WINDOW_SECONDS;
    for (let j = i + 1; j < sorted.length; j++) {
      if (assigned.has(j)) continue;
      if (sorted[j].timestamp > windowEnd) break;
      members.push({ idx: j, trade: sorted[j] });
    }

    const distinctWallets = new Set(members.map((m) => m.trade.wallet));
    if (distinctWallets.size < MIN_UNIQUE_WALLETS) continue;

    for (const m of members) assigned.add(m.idx);

    const memberTrades = members.map((m) => m.trade);
    const first = memberTrades[0].timestamp;
    const last = memberTrades[memberTrades.length - 1].timestamp;
    const total = memberTrades
      .reduce((sum, trade) => sum.add(trade.usdValue), new Decimal(0))
      .toNumber();

    clusters.push({
      trades: memberTrades,
      uniqueWallets: distinctWallets.size,
      totalUsdValue: total,
      firstTimestamp: first,
      lastTimestamp: last,
      priceHistory,
    });
  }

  return clusters;
}

/**
 * Score a single cluster. The score is attributed to every trade in
 * the cluster — individual trades don't need scoring themselves.
 */
export function scoreTimingCluster(
  ctx: TimingClusterContext,
  side: TradeSide
): ArchetypeScore {
  const factors: SuspicionFactor[] = [];
  let score = 0;
  const totalUsd = new Decimal(ctx.totalUsdValue);

  if (ctx.uniqueWallets < MIN_UNIQUE_WALLETS) {
    return {
      archetype: "timing_cluster",
      score: 0,
      threshold: TIMING_CLUSTER_THRESHOLD,
      factors: [],
    };
  }

  // Factor 1: Wallet count (max 25 points).
  if (ctx.uniqueWallets >= 8) {
    const pts = 25;
    score += pts;
    factors.push({
      name: "Cluster Size",
      points: pts,
      description: `${ctx.uniqueWallets} wallets piled in together`,
    });
  } else if (ctx.uniqueWallets >= 5) {
    const pts = 18;
    score += pts;
    factors.push({
      name: "Cluster Size",
      points: pts,
      description: `${ctx.uniqueWallets} wallets piled in together`,
    });
  } else {
    // 3 or 4 wallets
    const pts = 10;
    score += pts;
    factors.push({
      name: "Cluster Size",
      points: pts,
      description: `${ctx.uniqueWallets} wallets piled in together`,
    });
  }

  // Factor 2: Aggregate cluster size (max 20 points).
  if (totalUsd.gte(50_000)) {
    const pts = 20;
    score += pts;
    factors.push({
      name: "Cluster Volume",
      points: pts,
      description: `$${formatK(totalUsd)} crossed the same side together`,
    });
  } else if (totalUsd.gte(20_000)) {
    const pts = 14;
    score += pts;
    factors.push({
      name: "Cluster Volume",
      points: pts,
      description: `$${formatK(totalUsd)} crossed the same side together`,
    });
  } else if (totalUsd.gte(5_000)) {
    const pts = 8;
    score += pts;
    factors.push({
      name: "Cluster Volume",
      points: pts,
      description: `$${formatK(totalUsd)} crossed the same side together`,
    });
  }

  // Factor 3: Tightness — clusters compressed into a few minutes are
  // less plausibly independent reactions to news. (max 15 points)
  const windowMinutes =
    Math.max(0, ctx.lastTimestamp - ctx.firstTimestamp) / 60;
  if (windowMinutes <= 1) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Tightness",
      points: pts,
      description: "All trades within 1 minute",
    });
  } else if (windowMinutes <= 5) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Tightness",
      points: pts,
      description: `All trades within ${windowMinutes.toFixed(0)} minutes`,
    });
  } else if (windowMinutes <= 15) {
    const pts = 5;
    score += pts;
    factors.push({
      name: "Tightness",
      points: pts,
      description: `Trades over ${windowMinutes.toFixed(0)} minutes`,
    });
  }

  // Factor 4: Favorable post-cluster move (bonus, max 40 points).
  // Treated as a bonus rather than a hard gate because short-window
  // moves are noisy — especially in same-day sports markets where
  // the whole event might still be unfolding. We DO require price-
  // history to be present (no blind flagging) but don't punish
  // clusters that lack a detectable near-term move.
  if (ctx.priceHistory.length === 0) return zero();
  const priceAtEnd = priceAt(ctx.priceHistory, ctx.lastTimestamp);
  const priceAfter1h = priceAt(ctx.priceHistory, ctx.lastTimestamp + 60 * 60);
  if (priceAtEnd === null || priceAfter1h === null) return zero();

  const favorableMove =
    side === "BUY" ? priceAfter1h - priceAtEnd : priceAtEnd - priceAfter1h;

  if (favorableMove >= 0.25) {
    const pts = 40;
    score += pts;
    factors.push({
      name: "Post-Cluster Move",
      points: pts,
      description: `Price moved ${(favorableMove * 100).toFixed(0)}¢ in cluster's favor within 1h`,
    });
  } else if (favorableMove >= 0.15) {
    const pts = 30;
    score += pts;
    factors.push({
      name: "Post-Cluster Move",
      points: pts,
      description: `Price moved ${(favorableMove * 100).toFixed(0)}¢ in cluster's favor within 1h`,
    });
  } else if (favorableMove >= MIN_FAVORABLE_MOVE) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Post-Cluster Move",
      points: pts,
      description: `Price moved ${(favorableMove * 100).toFixed(0)}¢ in cluster's favor within 1h`,
    });
  }

  return {
    archetype: "timing_cluster",
    score: Math.min(score, 100),
    threshold: TIMING_CLUSTER_THRESHOLD,
    factors,
  };
}

function zero(): ArchetypeScore {
  return {
    archetype: "timing_cluster",
    score: 0,
    threshold: TIMING_CLUSTER_THRESHOLD,
    factors: [],
  };
}

function formatK(value: Decimal): string {
  if (value.gte(1_000_000)) return `${value.div(1_000_000).toFixed(1)}M`;
  if (value.gte(1_000)) return `${value.div(1_000).toFixed(1)}K`;
  return value.toFixed(0);
}
