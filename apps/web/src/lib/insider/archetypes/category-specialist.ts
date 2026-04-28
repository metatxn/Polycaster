/**
 * Category-specialist-with-edge archetype.
 *
 * Flags wallets whose lifetime resolved-trade record shows meaningful
 * out-performance in one specific Polymarket category — e.g., "85%
 * win rate on NHL totals across 14 resolved trades." This is the only
 * archetype that uses *historical wallet performance* rather than
 * just one trade's pattern, which is why it should find the long-tail
 * of aged-wallet insiders that Phase 2's archetypes miss.
 *
 * Input: the wallet's per-category edge stats (computed from their
 * trade history against our resolution knowledge base) plus the
 * category of the trade being scored. Score only applies when the
 * current trade is in the wallet's SPECIALTY — we don't want to flag
 * an NBA expert on their one-off political bet.
 */

import Decimal from "decimal.js";
import type { Category } from "../category";
import type { CategoryEdge, WalletEdge } from "../wallet-edge";
import type { ArchetypeScore, SuspicionFactor } from "./types";

export const CATEGORY_SPECIALIST_THRESHOLD = 40;

/** Minimum resolved-trade sample required in the specialty category
 *  before we trust the win-rate number. */
const MIN_RESOLVED_SAMPLE = 5;
/** Win rate below this is "no edge" — we don't flag. */
const MIN_WIN_RATE = 0.6;
/** Fraction of LIFETIME volume that must be in the specialty category
 *  for the wallet to count as a "specialist." */
const MIN_SPECIALIZATION = 0.4;

export interface CategorySpecialistInput {
  edge: WalletEdge;
  /** The category of the trade currently being scored. The archetype
   *  only fires if the wallet's specialty matches this category. */
  tradeCategory: Category;
}

export function scoreCategorySpecialist(
  input: CategorySpecialistInput
): ArchetypeScore {
  const { edge, tradeCategory } = input;
  const factors: SuspicionFactor[] = [];
  let score = 0;

  if (tradeCategory === "Other") {
    return zero();
  }

  // Find the wallet's category edge that matches the trade's category.
  const catEdge: CategoryEdge | undefined = edge.byCategory.find(
    (c) => c.category === tradeCategory
  );
  if (!catEdge) return zero();

  // Gating thresholds — no score if any are missed.
  if (catEdge.resolvedTrades < MIN_RESOLVED_SAMPLE) return zero();
  if (catEdge.winRate < MIN_WIN_RATE) return zero();

  const specialization = new Decimal(edge.totalVolumeUsd).gt(0)
    ? new Decimal(catEdge.totalVolumeUsd).div(edge.totalVolumeUsd).toNumber()
    : 0;
  if (specialization < MIN_SPECIALIZATION) return zero();

  // Factor 1: Specialization (max 20 points).
  if (specialization >= 0.9) {
    const pts = 20;
    score += pts;
    factors.push({
      name: "Specialization",
      points: pts,
      description: `${(specialization * 100).toFixed(0)}% of lifetime volume in ${tradeCategory}`,
    });
  } else if (specialization >= 0.7) {
    const pts = 14;
    score += pts;
    factors.push({
      name: "Specialization",
      points: pts,
      description: `${(specialization * 100).toFixed(0)}% of lifetime volume in ${tradeCategory}`,
    });
  } else {
    // 0.4–0.7
    const pts = 8;
    score += pts;
    factors.push({
      name: "Specialization",
      points: pts,
      description: `${(specialization * 100).toFixed(0)}% of lifetime volume in ${tradeCategory}`,
    });
  }

  // Factor 2: Sample depth (max 15 points).
  if (catEdge.resolvedTrades >= 30) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Sample Depth",
      points: pts,
      description: `${catEdge.resolvedTrades} resolved trades in ${tradeCategory}`,
    });
  } else if (catEdge.resolvedTrades >= 15) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Sample Depth",
      points: pts,
      description: `${catEdge.resolvedTrades} resolved trades in ${tradeCategory}`,
    });
  } else {
    // 5–14
    const pts = 5;
    score += pts;
    factors.push({
      name: "Sample Depth",
      points: pts,
      description: `${catEdge.resolvedTrades} resolved trades in ${tradeCategory}`,
    });
  }

  // Factor 3: Win-rate excess (max 40 points). The heart of the
  // archetype — how far above coin-flip (50%) is this wallet?
  const excess = catEdge.winRate - 0.5;
  if (excess >= 0.3) {
    const pts = 40;
    score += pts;
    factors.push({
      name: "Win-rate Excess",
      points: pts,
      description: `${(catEdge.winRate * 100).toFixed(0)}% win rate in ${tradeCategory} (baseline 50%)`,
    });
  } else if (excess >= 0.2) {
    const pts = 28;
    score += pts;
    factors.push({
      name: "Win-rate Excess",
      points: pts,
      description: `${(catEdge.winRate * 100).toFixed(0)}% win rate in ${tradeCategory}`,
    });
  } else {
    // 0.1–0.2 (we already filter <0.6 so excess is always ≥ 0.1)
    const pts = 18;
    score += pts;
    factors.push({
      name: "Win-rate Excess",
      points: pts,
      description: `${(catEdge.winRate * 100).toFixed(0)}% win rate in ${tradeCategory}`,
    });
  }

  // Factor 4: Profit signal (max 15 points) — edge in P&L per share,
  // not just win rate. A 60%-winner who only wins by a penny is less
  // impressive than a 60%-winner whose wins are 20c/share.
  if (catEdge.meanProfitPerShare >= 0.1) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Profit Edge",
      points: pts,
      description: `Average ${(catEdge.meanProfitPerShare * 100).toFixed(0)}¢/share profit in ${tradeCategory}`,
    });
  } else if (catEdge.meanProfitPerShare >= 0.05) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Profit Edge",
      points: pts,
      description: `Average ${(catEdge.meanProfitPerShare * 100).toFixed(0)}¢/share profit in ${tradeCategory}`,
    });
  } else if (catEdge.meanProfitPerShare > 0) {
    const pts = 5;
    score += pts;
    factors.push({
      name: "Profit Edge",
      points: pts,
      description: `Positive ${(catEdge.meanProfitPerShare * 100).toFixed(0)}¢/share in ${tradeCategory}`,
    });
  }

  return {
    archetype: "category_specialist",
    score: Math.min(score, 100),
    threshold: CATEGORY_SPECIALIST_THRESHOLD,
    factors,
  };
}

function zero(): ArchetypeScore {
  return {
    archetype: "category_specialist",
    score: 0,
    threshold: CATEGORY_SPECIALIST_THRESHOLD,
    factors: [],
  };
}
