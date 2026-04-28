/**
 * Wallet-edge aggregator — for a given wallet, compute per-category
 * resolved-trade statistics used by the category-specialist archetype.
 *
 * The "edge" of a wallet in a category is their hold-to-resolution
 * win rate on that category's resolved markets. Simple, imperfect
 * (ignores close-before-resolution behavior), but comparable across
 * wallets and robust enough for a backtest signal.
 */

import Decimal from "decimal.js";
import type { Category } from "./category";
import type { ResolutionKnowledgeBase } from "./market-resolutions";
import { computeTradePnl } from "./pnl";
import type { WalletTradeRecord } from "./wallet-trades-cache";

export interface CategoryEdge {
  category: Category;
  /** Number of resolved trades in this category. */
  resolvedTrades: number;
  /** Hold-to-resolution wins (profit > 0). */
  wins: number;
  /** Hold-to-resolution losses (profit < 0). */
  losses: number;
  /** Pushes (profit ≈ 0 — usually closed at resolution price). */
  pushes: number;
  /** USD volume across resolved trades in this category. */
  resolvedVolumeUsd: number;
  /** Total lifetime USD across ALL trades in this category (including
   *  unresolved/unknown) — the denominator for specialization. */
  totalVolumeUsd: number;
  /** wins / (wins + losses). 0 when there are no decisive trades. */
  winRate: number;
  /** Mean hold-to-resolution profit per share. */
  meanProfitPerShare: number;
}

export interface WalletEdge {
  address: string;
  /** All the wallet's trades we could score (in our resolution KB). */
  scoredTrades: number;
  /** Total wallet lifetime volume across every trade in history. */
  totalVolumeUsd: number;
  /** Sum of volume across resolved-and-known categories. */
  resolvedVolumeUsd: number;
  /** Per-category breakdown, sorted by total volume descending. */
  byCategory: CategoryEdge[];
}

function empty(category: Category): CategoryEdge {
  return {
    category,
    resolvedTrades: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    resolvedVolumeUsd: 0,
    totalVolumeUsd: 0,
    winRate: 0,
    meanProfitPerShare: 0,
  };
}

/**
 * Compute a wallet's per-category edge, given its trade history and a
 * resolution knowledge base. Trades in markets the KB doesn't know
 * about still contribute to `totalVolumeUsd` but not to resolved
 * stats — they're the wallet's history we can't score.
 */
export function computeWalletEdge(
  address: string,
  trades: WalletTradeRecord[],
  kb: ResolutionKnowledgeBase
): WalletEdge {
  const byCategory = new Map<Category, CategoryEdge>();
  let totalVolumeUsd = new Decimal(0);
  let resolvedVolumeUsd = new Decimal(0);
  let scoredTrades = 0;

  // Running profit-per-share sums per category, folded into mean at the end.
  const ppsSum = new Map<Category, Decimal>();

  for (const trade of trades) {
    const usd = new Decimal(trade.size).mul(trade.price);
    totalVolumeUsd = totalVolumeUsd.add(usd);

    const known = kb.byConditionId.get(trade.conditionId);
    if (!known) {
      // Still count toward totalVolume in the trade's category so
      // specialization denominators are honest.
      const cat = empty("Other");
      cat.totalVolumeUsd = usd.toNumber();
      const existing = byCategory.get(cat.category);
      if (existing) {
        existing.totalVolumeUsd = new Decimal(existing.totalVolumeUsd)
          .add(usd)
          .toNumber();
      } else {
        byCategory.set(cat.category, cat);
      }
      continue;
    }

    if (known.resolution.isDraw) continue;
    // Skip trades that happened AFTER the market resolved — those are
    // mechanical close-outs, not predictions.
    const tradeMs = trade.timestamp * 1000;
    if (tradeMs > known.closedAtMs) continue;

    const category = known.category;
    let entry = byCategory.get(category);
    if (!entry) {
      entry = empty(category);
      byCategory.set(category, entry);
    }

    entry.totalVolumeUsd = new Decimal(entry.totalVolumeUsd)
      .add(usd)
      .toNumber();

    const pnl = computeTradePnl(
      {
        outcomeIndex: trade.outcomeIndex,
        side: trade.side,
        size: trade.size,
        price: trade.price,
      },
      known.resolution
    );
    if (!pnl) continue;

    scoredTrades++;
    resolvedVolumeUsd = resolvedVolumeUsd.add(usd);
    entry.resolvedTrades++;
    entry.resolvedVolumeUsd = new Decimal(entry.resolvedVolumeUsd)
      .add(usd)
      .toNumber();
    if (pnl.isWin) entry.wins++;
    else if (pnl.isLoss) entry.losses++;
    else entry.pushes++;
    ppsSum.set(
      category,
      (ppsSum.get(category) ?? new Decimal(0)).add(pnl.profitPerShare)
    );
  }

  // Finalize: win rate + mean pps per category
  for (const [cat, e] of byCategory) {
    const decisive = e.wins + e.losses;
    e.winRate = decisive > 0 ? e.wins / decisive : 0;
    e.meanProfitPerShare =
      e.resolvedTrades > 0
        ? (ppsSum.get(cat) ?? new Decimal(0)).div(e.resolvedTrades).toNumber()
        : 0;
  }

  const sorted = [...byCategory.values()].sort(
    (a, b) => b.totalVolumeUsd - a.totalVolumeUsd
  );

  return {
    address,
    scoredTrades,
    totalVolumeUsd: totalVolumeUsd.toNumber(),
    resolvedVolumeUsd: resolvedVolumeUsd.toNumber(),
    byCategory: sorted,
  };
}
