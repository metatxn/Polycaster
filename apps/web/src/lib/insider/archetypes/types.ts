/**
 * Shared types for insider archetype detectors.
 *
 * Each archetype is an independent scorer. The ensemble runs them all
 * and flags a trade if any archetype scores above its own threshold.
 * This is an OR-style ensemble rather than a weighted sum because the
 * patterns catch structurally different populations (fresh-account
 * loaders vs. size-hiding accumulators vs. timing clusters) — combining
 * them into one score would dilute clean signals.
 */

export type ArchetypeId =
  | "account_loader"
  | "size_hider"
  | "timing_cluster"
  | "category_specialist"
  | "funding_cluster"
  | "owner_cluster";

export const ARCHETYPE_LABELS: Record<ArchetypeId, string> = {
  account_loader: "Fresh-account loader",
  size_hider: "Size-hiding accumulator",
  timing_cluster: "Timing cluster",
  category_specialist: "Category specialist with edge",
  funding_cluster: "On-chain funding cluster",
  owner_cluster: "Shared Safe-owner cluster",
};

/** Tight description of a single contributing factor within an archetype. */
export interface SuspicionFactor {
  name: string;
  points: number;
  description: string;
}

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Output of a single archetype scorer. */
export interface ArchetypeScore {
  archetype: ArchetypeId;
  /** 0..100 — higher = more consistent with this archetype's pattern. */
  score: number;
  /** The threshold above which this archetype considers a trade flagged.
   *  Thresholds live per-archetype because the patterns are different. */
  threshold: number;
  factors: SuspicionFactor[];
}

/** Output of the ensemble: all archetype scores + a merged summary. */
export interface EnsembleResult {
  /** All archetype scores, whether they fired or not. Useful for
   *  introspection and per-archetype threshold tuning. */
  archetypes: ArchetypeScore[];
  /** Highest score across all archetypes. */
  maxScore: number;
  /** Confidence level derived from maxScore. */
  confidence: ConfidenceLevel;
  /** True if at least one archetype scored above its threshold. */
  anyFired: boolean;
  /** Archetype IDs that fired (score >= their threshold). */
  firedArchetypes: ArchetypeId[];
  /** Combined reason string — one segment per archetype that fired. */
  reason: string;
  /** Sort priority — higher surfaces first in ranked lists. The
   *  priority tiers stack corroborating structural signals:
   *    3 → specialist + funding + owner all fire (Phase 5 platinum)
   *    2 → specialist + (funding OR owner) fire (Phase 4 gold)
   *    1 → specialist fired alone, OR owner-cluster fired alone
   *        (Phase 3-½ / Phase 5 silver)
   *    0 → other archetypes fired (baseline)
   *
   *  Owner-cluster and funding-cluster are treated as equivalent
   *  second-tier structural signals: both bump silver→gold when
   *  stacking with specialist, both together bump gold→platinum.
   *  Owner-cluster alone (without specialist) still reaches silver
   *  because shared-owner overlap is itself a strong operator
   *  fingerprint. */
  sortPriority: number;
}

export function deriveConfidence(score: number): ConfidenceLevel {
  if (score >= 75) return "CRITICAL";
  if (score >= 55) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}
