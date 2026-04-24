/**
 * Fresh-account loader archetype.
 *
 * Catches the classic "new wallet funded from a CEX makes one big
 * concentrated bet right before a catalyst" pattern. The original v1
 * detector was essentially just this archetype — here we keep its
 * logic identical so the ensemble has a clean, isolated scoring
 * contribution instead of a load-bearing monolith.
 *
 * Phase 1 baseline showed this archetype has ANTI-signal in production
 * (9.1% win rate vs 42.3% baseline) — fresh wallets making big bets
 * are overwhelmingly retail gamblers, not insiders. It stays in the
 * ensemble only so existing flagging behaviour is preserved; the real
 * value comes from the other archetypes compensating for its noise.
 */

import type { ArchetypeScore, SuspicionFactor } from "./types";

export type TradeSide = "BUY" | "SELL";

export interface AccountLoaderInput {
  accountAgeHours: number;
  totalTrades: number;
  tradeSide: TradeSide;
  tradeUsdValue: number;
  /** Market mid-price at (or near) the time of the trade. Backtest
   *  replays feed the trade's own price; live scoring feeds the
   *  current market price. */
  referencePrice: number;
  isRepeatOffender: boolean;
  marketsInvolved: number;
}

export const ACCOUNT_LOADER_THRESHOLD = 30;

function checkIfContrarian(side: TradeSide, referencePrice: number): boolean {
  if (side === "BUY" && referencePrice < 0.3) return true;
  if (side === "SELL" && referencePrice > 0.7) return true;
  return false;
}

export function scoreAccountLoader(input: AccountLoaderInput): ArchetypeScore {
  const {
    accountAgeHours,
    totalTrades,
    tradeSide,
    tradeUsdValue,
    referencePrice,
    isRepeatOffender,
    marketsInvolved,
  } = input;

  let score = 0;
  const factors: SuspicionFactor[] = [];

  // Factor 1: Account age (max 35 points)
  if (accountAgeHours < 6) {
    const pts = 35;
    score += pts;
    factors.push({
      name: "Account Age",
      points: pts,
      description: `Very new account (${accountAgeHours.toFixed(1)}h old)`,
    });
  } else if (accountAgeHours < 24) {
    const pts = 25;
    score += pts;
    factors.push({
      name: "Account Age",
      points: pts,
      description: `New account (${accountAgeHours.toFixed(1)}h old)`,
    });
  } else if (accountAgeHours < 48) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Account Age",
      points: pts,
      description: `Recent account (${accountAgeHours.toFixed(1)}h old)`,
    });
  } else if (accountAgeHours < 72) {
    const pts = 8;
    score += pts;
    factors.push({
      name: "Account Age",
      points: pts,
      description: `Fairly new account (${(accountAgeHours / 24).toFixed(1)}d old)`,
    });
  }

  // Factor 2: Trade count — fewer trades = more suspicious (max 15 points)
  if (totalTrades <= 2) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Trade History",
      points: pts,
      description: `Only ${totalTrades} total trade(s) — almost no history`,
    });
  } else if (totalTrades <= 5) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Trade History",
      points: pts,
      description: `Very few trades (${totalTrades})`,
    });
  } else if (totalTrades <= 15) {
    const pts = 5;
    score += pts;
    factors.push({
      name: "Trade History",
      points: pts,
      description: `Low trade count (${totalTrades})`,
    });
  }

  // Factor 3: Contrarian position (max 25 points)
  const isContrarian = checkIfContrarian(tradeSide, referencePrice);

  if (isContrarian) {
    const contrarianDegree =
      tradeSide === "BUY" ? 1 - referencePrice : referencePrice;

    if (contrarianDegree > 0.7) {
      const pts = 25;
      score += pts;
      factors.push({
        name: "Contrarian Position",
        points: pts,
        description: `Highly contrarian — market at ${(referencePrice * 100).toFixed(0)}%, ${tradeSide === "BUY" ? "buying YES" : "selling YES"}`,
      });
    } else if (contrarianDegree > 0.5) {
      const pts = 15;
      score += pts;
      factors.push({
        name: "Contrarian Position",
        points: pts,
        description: `Contrarian — market at ${(referencePrice * 100).toFixed(0)}%`,
      });
    } else {
      const pts = 8;
      score += pts;
      factors.push({
        name: "Contrarian Position",
        points: pts,
        description: "Slightly contrarian position",
      });
    }
  }

  // Factor 4: Trade size (max 10 points)
  if (tradeUsdValue > 10000) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Trade Size",
      points: pts,
      description: `Very large trade ($${tradeUsdValue.toFixed(0)})`,
    });
  } else if (tradeUsdValue > 5000) {
    const pts = 7;
    score += pts;
    factors.push({
      name: "Trade Size",
      points: pts,
      description: `Large trade ($${tradeUsdValue.toFixed(0)})`,
    });
  } else if (tradeUsdValue > 1000) {
    const pts = 3;
    score += pts;
    factors.push({
      name: "Trade Size",
      points: pts,
      description: `Significant trade ($${tradeUsdValue.toFixed(0)})`,
    });
  }

  // Factor 5: Repeat offender bonus (max 10 points)
  if (isRepeatOffender) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Repeat Pattern",
      points: pts,
      description: `Suspicious activity across ${marketsInvolved} different markets`,
    });
  }

  // Factor 6: Size-to-age ratio (max 5 points) — large trade from very new account
  if (accountAgeHours < 24 && tradeUsdValue > 5000) {
    const pts = 5;
    score += pts;
    factors.push({
      name: "Size/Age Ratio",
      points: pts,
      description: `$${tradeUsdValue.toFixed(0)} trade from an account less than 24h old`,
    });
  }

  return {
    archetype: "account_loader",
    score: Math.min(score, 100),
    threshold: ACCOUNT_LOADER_THRESHOLD,
    factors,
  };
}
