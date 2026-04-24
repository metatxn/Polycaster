/**
 * Safe-owner cluster archetype (Phase 5).
 *
 * Polymarket user wallets are Gnosis Safes on Polygon, and each Safe
 * has a primary owner EOA stored on-chain. If two or more flagged
 * Safes share the same primary owner, they're almost certainly
 * operated by the same person — the clearest structural fingerprint
 * of an "operator running multiple accounts" insider pattern.
 *
 * Unlike funding-cluster (Phase 4), this archetype is NOT gated on
 * specialist firing. Owner overlap is a strong enough standalone
 * signal that we want it to surface even when the specialty-edge
 * detector misses. A wallet that shares an owner with another
 * flagged wallet — whether specialist fired or not — is suspicious
 * on its own.
 *
 * The archetype combines with funding-cluster additively in the
 * ensemble's sortPriority tiers:
 *
 *   3 (platinum) — specialist + funding + owner all fire
 *   2 (gold)     — specialist + (funding OR owner) fire
 *   1 (silver)   — specialist alone OR owner-cluster alone
 *   0 (baseline) — other archetypes only
 */

import type { ArchetypeScore, SuspicionFactor } from "./types";

export const OWNER_CLUSTER_THRESHOLD = 25;

export interface OwnerClusterInput {
  /** Primary owner EOA of the wallet being scored (lowercased), or
   *  null if the address isn't a Safe. */
  ownerAddress: string | null;
  /** Number of OTHER flagged wallets in this run that share the same
   *  primary owner. Zero means "lone Safe" and the archetype doesn't
   *  fire — the clustering is the whole signal. */
  sharedOwnerCount: number;
}

export function scoreOwnerCluster(input: OwnerClusterInput): ArchetypeScore {
  const factors: SuspicionFactor[] = [];
  let score = 0;

  if (!input.ownerAddress) return zero();
  if (input.sharedOwnerCount < 1) return zero();

  // Factor 1: Cluster size (max 45 points). Same-owner wallets are
  // essentially proof of common operatorship — a 3-wallet cluster is
  // dramatically more damning than a 2-wallet one, and scaling falls
  // off after that because the signal saturates.
  if (input.sharedOwnerCount >= 4) {
    const pts = 45;
    score += pts;
    factors.push({
      name: "Owner Cluster",
      points: pts,
      description: `${input.sharedOwnerCount + 1} flagged Safes share the same owner EOA`,
    });
  } else if (input.sharedOwnerCount === 3) {
    const pts = 40;
    score += pts;
    factors.push({
      name: "Owner Cluster",
      points: pts,
      description: `${input.sharedOwnerCount + 1} flagged Safes share the same owner EOA`,
    });
  } else if (input.sharedOwnerCount === 2) {
    const pts = 32;
    score += pts;
    factors.push({
      name: "Owner Cluster",
      points: pts,
      description: `${input.sharedOwnerCount + 1} flagged Safes share the same owner EOA`,
    });
  } else {
    // sharedOwnerCount === 1: exactly 2 Safes with same owner
    const pts = 25;
    score += pts;
    factors.push({
      name: "Owner Cluster",
      points: pts,
      description: "2 flagged Safes share the same owner EOA",
    });
  }

  return {
    archetype: "owner_cluster",
    score: Math.min(score, 100),
    threshold: OWNER_CLUSTER_THRESHOLD,
    factors,
  };
}

function zero(): ArchetypeScore {
  return {
    archetype: "owner_cluster",
    score: 0,
    threshold: OWNER_CLUSTER_THRESHOLD,
    factors: [],
  };
}
