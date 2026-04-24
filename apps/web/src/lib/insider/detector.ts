/**
 * Insider detection — ensemble of archetype scorers.
 *
 * Each archetype is an independent, pure scorer. The ensemble runs
 * them all on a given trade context and flags the trade if any
 * archetype scores above its own threshold. This OR-style merge
 * preserves clean signals from each pattern (fresh-account loader /
 * size-hiding accumulator / timing cluster) without the dilution a
 * weighted sum would cause.
 *
 * Phase 1 baseline (docs/insider-detection-baseline.md) established
 * that the original fresh-account heuristic has anti-signal on its
 * own; the real value comes from the new archetypes compensating for
 * that noise.
 */

import {
  ACCOUNT_LOADER_THRESHOLD,
  type AccountLoaderInput,
  scoreAccountLoader,
} from "./archetypes/account-loader";
import {
  CATEGORY_SPECIALIST_THRESHOLD,
  type CategorySpecialistInput,
  scoreCategorySpecialist,
} from "./archetypes/category-specialist";
import {
  FUNDING_CLUSTER_THRESHOLD,
  type FundingClusterInput,
  scoreFundingCluster,
} from "./archetypes/funding-cluster";
import {
  OWNER_CLUSTER_THRESHOLD,
  type OwnerClusterInput,
  scoreOwnerCluster,
} from "./archetypes/owner-cluster";
import {
  type AccumulatorContext,
  SIZE_HIDER_THRESHOLD,
  scoreSizeHider,
} from "./archetypes/size-hider";
import {
  scoreTimingCluster,
  TIMING_CLUSTER_THRESHOLD,
  type TimingClusterContext,
} from "./archetypes/timing-cluster";
import {
  ARCHETYPE_LABELS,
  type ArchetypeId,
  type ArchetypeScore,
  deriveConfidence,
  type EnsembleResult,
} from "./archetypes/types";

// Re-export the shared types so routes can import everything from one place.
export type {
  ArchetypeId,
  ArchetypeScore,
  ConfidenceLevel,
  EnsembleResult,
  SuspicionFactor,
} from "./archetypes/types";
export type TradeSide = "BUY" | "SELL";

export {
  ACCOUNT_LOADER_THRESHOLD,
  ARCHETYPE_LABELS,
  CATEGORY_SPECIALIST_THRESHOLD,
  FUNDING_CLUSTER_THRESHOLD,
  OWNER_CLUSTER_THRESHOLD,
  SIZE_HIDER_THRESHOLD,
  TIMING_CLUSTER_THRESHOLD,
};

/**
 * Full context for scoring a single trade with the ensemble. The
 * caller is responsible for aggregating the per-archetype inputs
 * upstream — backtest builds them from historical data, the live
 * route from recent trades.
 */
export interface TradeContext {
  accountLoader: AccountLoaderInput;
  /** Matching (wallet, market, side) accumulation for this trade, or
   *  null if the wallet has <3 same-side trades on this market. */
  sizeHider: AccumulatorContext | null;
  /** Matching timing cluster for this trade, or null if the trade is
   *  not part of a qualifying cluster. */
  timingCluster: {
    ctx: TimingClusterContext;
    side: TradeSide;
  } | null;
  /** Wallet-edge stats + the category of the current trade. Null when
   *  the wallet has no meaningful resolved history (we don't try to
   *  judge specialists without a sample). */
  categorySpecialist: CategorySpecialistInput | null;
  /** Phase 4 stacking archetype — only populated when the caller has
   *  already fetched funding data AND knows whether specialist fired
   *  (so the orchestrator can pre-gate before paying for Alchemy
   *  calls). Null on the live route (no wallet-edge there) and in
   *  the backtest's first pass. */
  fundingCluster: FundingClusterInput | null;
  /** Phase 5 owner-cluster archetype — populated in a post-pass
   *  after all flagged wallets are known, since the sharedOwnerCount
   *  is a function of the full flagged cohort. Null on the first
   *  scoring pass. */
  ownerCluster: OwnerClusterInput | null;
}

/**
 * Run every archetype on the given context, merge, and return the
 * ensemble result. Any archetype whose context is null contributes a
 * zero-score entry so callers can still see the full archetype
 * landscape for introspection.
 */
export function scoreTrade(input: TradeContext): EnsembleResult {
  const scores: ArchetypeScore[] = [
    scoreAccountLoader(input.accountLoader),
    input.sizeHider
      ? scoreSizeHider(input.sizeHider)
      : zero("size_hider", SIZE_HIDER_THRESHOLD),
    input.timingCluster
      ? scoreTimingCluster(input.timingCluster.ctx, input.timingCluster.side)
      : zero("timing_cluster", TIMING_CLUSTER_THRESHOLD),
    input.categorySpecialist
      ? scoreCategorySpecialist(input.categorySpecialist)
      : zero("category_specialist", CATEGORY_SPECIALIST_THRESHOLD),
    input.fundingCluster
      ? scoreFundingCluster(input.fundingCluster)
      : zero("funding_cluster", FUNDING_CLUSTER_THRESHOLD),
    input.ownerCluster
      ? scoreOwnerCluster(input.ownerCluster)
      : zero("owner_cluster", OWNER_CLUSTER_THRESHOLD),
  ];

  const firedArchetypes = scores
    .filter((s) => s.score >= s.threshold)
    .map((s) => s.archetype);
  const maxScore = scores.reduce((m, s) => Math.max(m, s.score), 0);

  const reason = firedArchetypes
    .map((id) => {
      const s = scores.find((x) => x.archetype === id);
      if (!s) return "";
      const desc = s.factors.map((f) => f.description).join("; ");
      return `[${ARCHETYPE_LABELS[id]}] ${desc}`;
    })
    .filter(Boolean)
    .join(" · ");

  // Sort priority, four tiers (Phase 3-½ + Phase 4 + Phase 5):
  //   3 — specialist + funding + owner-cluster all fire (platinum).
  //       Specialty edge, on-chain funding fingerprint, AND shared
  //       Safe ownership with another flagged wallet — the strongest
  //       stack of structural signals available.
  //   2 — specialist + (funding OR owner) (gold). Specialty edge
  //       corroborated by one additional structural signal.
  //   1 — specialist alone OR owner-cluster alone (silver). Either
  //       signal standing on its own meets the silver bar.
  //   0 — other archetypes fired (baseline).
  const specialistFired = firedArchetypes.includes("category_specialist");
  const fundingFired = firedArchetypes.includes("funding_cluster");
  const ownerFired = firedArchetypes.includes("owner_cluster");
  let sortPriority = 0;
  if (specialistFired && fundingFired && ownerFired) sortPriority = 3;
  else if (specialistFired && (fundingFired || ownerFired)) sortPriority = 2;
  else if (specialistFired || ownerFired) sortPriority = 1;

  return {
    archetypes: scores,
    maxScore,
    confidence: deriveConfidence(maxScore),
    anyFired: firedArchetypes.length > 0,
    firedArchetypes,
    reason,
    sortPriority,
  };
}

function zero(archetype: ArchetypeId, threshold: number): ArchetypeScore {
  return { archetype, score: 0, threshold, factors: [] };
}
