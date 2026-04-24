/**
 * Funding-cluster archetype (Phase 4).
 *
 * Stacks on top of category-specialist — this archetype is a hard
 * selectivity gate, not a standalone detector. It fires ONLY when
 * category-specialist has already fired AND the wallet's on-chain
 * funding history carries a strong insider signature.
 *
 * The rationale:
 *  - A wallet with a measurable specialty edge (e.g. 80% win rate on
 *    NHL) is suspicious.
 *  - If that same wallet was ALSO funded by a self-custody EOA that
 *    funded other specialist wallets in the same backtest window,
 *    we're looking at one operator managing multiple edge accounts
 *    — the clearest structural insider pattern available.
 *  - Adding this gate on top of specialist promotes those stacked
 *    firings to the highest sort-priority tier (2 in the ensemble's
 *    specialist-first ranking).
 *
 * The archetype is pre-gated on `specialistFired` inside this file
 * rather than at the ensemble level so the scoring function stays
 * symmetric with other archetypes — the ensemble still calls it for
 * every trade; it simply returns zero when the gate isn't satisfied.
 */

import type { WalletFunding } from "../funding-source";
import type { ArchetypeScore, SuspicionFactor } from "./types";

export const FUNDING_CLUSTER_THRESHOLD = 40;

export interface FundingClusterInput {
  funding: WalletFunding;
  /** Number of OTHER specialist-firing wallets in this run that share
   *  this wallet's first-funder. ≥1 means a cluster is forming. Only
   *  counted within specialist-firing wallets — counting across all
   *  Polymarket wallets would mostly pick up popular funding hubs
   *  (DEX aggregators, multi-user relayers) that carry no insider
   *  signal. */
  sharedFunderCount: number;
  /** Whether category-specialist fired on the trade being scored.
   *  Hard prerequisite — this archetype is a stacking gate, not an
   *  independent classifier. */
  specialistFired: boolean;
  /** Trade timestamp in unix seconds. Used to compute funding age
   *  (dormant-then-active pattern is a strong insider fingerprint). */
  tradeTimestamp: number;
}

/**
 * Score the funding-cluster archetype. Returns zero unless the
 * specialist gate is active AND the funding classification is
 * "self_custody" or "bridge". CEX-funded or unknown wallets can't
 * fire this archetype — their funding pattern is too common to carry
 * signal.
 */
export function scoreFundingCluster(
  input: FundingClusterInput
): ArchetypeScore {
  const { funding, sharedFunderCount, specialistFired, tradeTimestamp } = input;
  const factors: SuspicionFactor[] = [];
  let score = 0;

  // Hard gate: specialist must fire. Phase 4 is a precision layer, not
  // a recall layer.
  if (!specialistFired) return zero();

  // Hard gate: funding must be traceable to a non-CEX source. CEX is
  // generic retail funding (millions of users share the same Binance
  // hot wallet as their first funder); it's not a clustering signal.
  if (funding.firstFunderCategory === "cex") return zero();
  if (funding.firstFunderCategory === "unknown") return zero();
  if (!funding.firstFunderAddress || !funding.firstFundingTimestamp) {
    return zero();
  }

  // Factor 1: Funder class (max 25 points). Self-custody (unknown EOA)
  // is the strongest; bridge is weaker because bridges multiplex
  // many users.
  if (funding.firstFunderCategory === "self_custody") {
    const pts = 25;
    score += pts;
    factors.push({
      name: "Self-custody Funder",
      points: pts,
      description: "First funded by a non-exchange wallet",
    });
  } else if (funding.firstFunderCategory === "bridge") {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Bridge Funder",
      points: pts,
      description: "First funded via a cross-chain bridge",
    });
  }

  // Factor 2: Shared-funder cluster (max 45 points). THE Phase 4
  // signal — same self-custody funder has seeded multiple specialist-
  // firing wallets, which is the structural fingerprint of one
  // operator running multiple edge accounts. Scored highly because
  // it's both rare AND extremely selective when it appears.
  if (sharedFunderCount >= 3) {
    const pts = 45;
    score += pts;
    factors.push({
      name: "Shared-funder Cluster",
      points: pts,
      description: `${sharedFunderCount + 1} specialist wallets funded by the same source`,
    });
  } else if (sharedFunderCount === 2) {
    const pts = 35;
    score += pts;
    factors.push({
      name: "Shared-funder Cluster",
      points: pts,
      description: `${sharedFunderCount + 1} specialist wallets funded by the same source`,
    });
  } else if (sharedFunderCount === 1) {
    const pts = 25;
    score += pts;
    factors.push({
      name: "Shared-funder Cluster",
      points: pts,
      description: "2 specialist wallets funded by the same source",
    });
  }

  // Factor 3: Dormant-then-active (max 15 points). A wallet that was
  // funded long before the trade, sat dormant, and then made a
  // specialty bet is more insider-like than a freshly-funded wallet
  // betting immediately (which is closer to "retail reacting to
  // news"). 30d+ is the knee where we stop treating the wallet as
  // "warmed up for this bet."
  const fundingAgeDays = Math.max(
    0,
    (tradeTimestamp - funding.firstFundingTimestamp) / (24 * 60 * 60)
  );
  if (fundingAgeDays >= 180) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Long-dormant Wallet",
      points: pts,
      description: `Wallet first funded ${fundingAgeDays.toFixed(0)}d before the trade`,
    });
  } else if (fundingAgeDays >= 30) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Aged Wallet",
      points: pts,
      description: `Wallet first funded ${fundingAgeDays.toFixed(0)}d before the trade`,
    });
  } else if (fundingAgeDays >= 7) {
    const pts = 5;
    score += pts;
    factors.push({
      name: "Aged Wallet",
      points: pts,
      description: `Wallet first funded ${fundingAgeDays.toFixed(0)}d before the trade`,
    });
  }

  return {
    archetype: "funding_cluster",
    score: Math.min(score, 100),
    threshold: FUNDING_CLUSTER_THRESHOLD,
    factors,
  };
}

function zero(): ArchetypeScore {
  return {
    archetype: "funding_cluster",
    score: 0,
    threshold: FUNDING_CLUSTER_THRESHOLD,
    factors: [],
  };
}
