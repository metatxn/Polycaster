import Decimal from "decimal.js";
import type { WhaleActivity } from "@/hooks/use-whale-activity";

/**
 * Row shape for the whale ledger — one per unique trader address,
 * aggregating their in-window activity.
 *
 * The ledger categorizes traders along two orthogonal axes, surfaced
 * as inline chips:
 *   - "BIG BET" (single-trade whale): placed at least one trade
 *     whose USDC notional ≥ BIG_BET_THRESHOLD. Captures the outlier
 *     one-shot bets a pure volume leaderboard misses.
 *   - "DIRECTIONAL" (conviction whale): their net flow in the window
 *     is both sizeable (≥ DIRECTIONAL_MIN_NET) and concentrated on
 *     one side (convictionRatio ≥ DIRECTIONAL_MIN_CONVICTION).
 *     Filters out churners / market-maker-like balanced flow.
 * A trader can qualify for both, either, or neither (in which case
 * they're just a volume whale — present because they're in the top
 * leaderboard, not tagged).
 */
export interface WhaleRow {
  address: string;
  name: string | null;
  profileImage: string | null;
  rank: number;
  totalPnl: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  buyRatio: number;
  tradeCount: number;
  marketCount: number;
  lastActiveTimestamp: string;
  /** Absolute value of (buyVolume − sellVolume) — directional size. */
  netVolume: number;
  /** "buy" if net buyer, "sell" if net seller, "neutral" if near-even. */
  netDirection: "buy" | "sell" | "neutral";
  /** USDC amount of this trader's single biggest trade in the window. */
  biggestTrade: number;
  /** netVolume / totalVolume — 1 = all one side, 0 = perfectly balanced. */
  convictionRatio: number;
}

/** Single-trade cutoff for the "BIG BET" tag (USDC). */
export const BIG_BET_THRESHOLD = 5_000;
/** Minimum |net flow| for the "DIRECTIONAL" tag (USDC). */
export const DIRECTIONAL_MIN_NET = 2_000;
/** Minimum conviction ratio for the "DIRECTIONAL" tag. */
export const DIRECTIONAL_MIN_CONVICTION = 0.6;

function addMoney(left: number, right: number): number {
  return new Decimal(left).add(right).toNumber();
}

function compareMoneyDesc(left: number, right: number): number {
  return new Decimal(right).cmp(left);
}

function ratio(
  numerator: Decimal,
  denominator: Decimal,
  fallback: number
): number {
  return denominator.gt(0) ? numerator.div(denominator).toNumber() : fallback;
}

export function isBigBetWhale(row: WhaleRow): boolean {
  return new Decimal(row.biggestTrade).gte(BIG_BET_THRESHOLD);
}

export function isDirectionalWhale(row: WhaleRow): boolean {
  return (
    new Decimal(row.netVolume).gte(DIRECTIONAL_MIN_NET) &&
    row.convictionRatio >= DIRECTIONAL_MIN_CONVICTION
  );
}

interface WhaleAccumulator {
  address: string;
  name: string | null;
  profileImage: string | null;
  rank: number;
  totalPnl: number;
  buyVolume: number;
  sellVolume: number;
  tradeCount: number;
  markets: Set<string>;
  lastActiveTimestamp: string;
  biggestTrade: number;
}

export function aggregateWhales(activities: WhaleActivity[]): WhaleRow[] {
  const map = new Map<string, WhaleAccumulator>();

  for (const a of activities) {
    const existing = map.get(a.trader.address);
    if (existing) {
      if (a.trade.side === "BUY") {
        existing.buyVolume = addMoney(existing.buyVolume, a.trade.usdcAmount);
      } else {
        existing.sellVolume = addMoney(existing.sellVolume, a.trade.usdcAmount);
      }
      existing.tradeCount += 1;
      existing.markets.add(a.market.conditionId);
      if (new Decimal(a.trade.usdcAmount).gt(existing.biggestTrade)) {
        existing.biggestTrade = a.trade.usdcAmount;
      }
      if (
        new Date(a.timestamp).getTime() >
        new Date(existing.lastActiveTimestamp).getTime()
      ) {
        existing.lastActiveTimestamp = a.timestamp;
      }
    } else {
      const markets = new Set<string>();
      markets.add(a.market.conditionId);
      map.set(a.trader.address, {
        address: a.trader.address,
        name: a.trader.name,
        profileImage: a.trader.profileImage,
        rank: a.trader.rank,
        totalPnl: a.trader.totalPnl,
        buyVolume: a.trade.side === "BUY" ? a.trade.usdcAmount : 0,
        sellVolume: a.trade.side === "SELL" ? a.trade.usdcAmount : 0,
        tradeCount: 1,
        markets,
        lastActiveTimestamp: a.timestamp,
        biggestTrade: a.trade.usdcAmount,
      });
    }
  }

  return Array.from(map.values()).map((v) => {
    const buyVolume = new Decimal(v.buyVolume);
    const sellVolume = new Decimal(v.sellVolume);
    const totalVolume = buyVolume.add(sellVolume);
    const signedNet = buyVolume.minus(sellVolume);
    const netVolume = signedNet.abs();
    const convictionRatio = ratio(netVolume, totalVolume, 0);
    const netDirection: WhaleRow["netDirection"] =
      convictionRatio < 0.2 ? "neutral" : signedNet.gt(0) ? "buy" : "sell";
    return {
      address: v.address,
      name: v.name,
      profileImage: v.profileImage,
      rank: v.rank,
      totalPnl: v.totalPnl,
      buyVolume: v.buyVolume,
      sellVolume: v.sellVolume,
      totalVolume: totalVolume.toNumber(),
      buyRatio: ratio(buyVolume, totalVolume, 0.5),
      tradeCount: v.tradeCount,
      marketCount: v.markets.size,
      lastActiveTimestamp: v.lastActiveTimestamp,
      netVolume: netVolume.toNumber(),
      netDirection,
      biggestTrade: v.biggestTrade,
      convictionRatio,
    };
  });
}

/**
 * Row shape for the hot-markets list — one per unique market,
 * summing in-window whale flow.
 */
export interface HotMarketRow {
  conditionId: string;
  title: string;
  slug: string;
  eventSlug: string;
  image?: string;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  buyRatio: number;
  whaleCount: number;
  tradeCount: number;
}

export function aggregateHotMarkets(
  activities: WhaleActivity[],
  limit = 12
): HotMarketRow[] {
  const map = new Map<
    string,
    Omit<HotMarketRow, "totalVolume" | "buyRatio" | "whaleCount"> & {
      whales: Set<string>;
    }
  >();

  for (const a of activities) {
    const key = a.market.conditionId || a.market.slug;
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      if (a.trade.side === "BUY") {
        existing.buyVolume = addMoney(existing.buyVolume, a.trade.usdcAmount);
      } else {
        existing.sellVolume = addMoney(existing.sellVolume, a.trade.usdcAmount);
      }
      existing.tradeCount += 1;
      existing.whales.add(a.trader.address);
    } else {
      const whales = new Set<string>();
      whales.add(a.trader.address);
      map.set(key, {
        conditionId: a.market.conditionId,
        title: a.market.title,
        slug: a.market.slug,
        eventSlug: a.market.eventSlug,
        image: a.market.image,
        buyVolume: a.trade.side === "BUY" ? a.trade.usdcAmount : 0,
        sellVolume: a.trade.side === "SELL" ? a.trade.usdcAmount : 0,
        tradeCount: 1,
        whales,
      });
    }
  }

  return Array.from(map.values())
    .map((v) => {
      const buyVolume = new Decimal(v.buyVolume);
      const sellVolume = new Decimal(v.sellVolume);
      const totalVolume = buyVolume.add(sellVolume);
      return {
        conditionId: v.conditionId,
        title: v.title,
        slug: v.slug,
        eventSlug: v.eventSlug,
        image: v.image,
        buyVolume: v.buyVolume,
        sellVolume: v.sellVolume,
        totalVolume: totalVolume.toNumber(),
        buyRatio: ratio(buyVolume, totalVolume, 0.5),
        tradeCount: v.tradeCount,
        whaleCount: v.whales.size,
      };
    })
    .sort((a, b) => compareMoneyDesc(a.totalVolume, b.totalVolume))
    .slice(0, limit);
}

/**
 * Build a buy/sell pressure series for the whale chart. Each bucket
 * carries three values so the chart can render:
 *   - `bucketBuy` / `bucketSell` — per-bucket volumes, drawn as diverging
 *     bars around a zero centerline (rhythm + side dominance).
 *   - `net` — running cumulative (buy - sell) up to this bucket, drawn
 *     as a single line that shows directional bias at a glance.
 *
 * The diverging-bar approach replaces the older dual-monotonic design
 * where both curves always climbed up — it was hard to read which side
 * dominated or when pressure shifted.
 */
export interface PressurePoint {
  t: number; // normalized 0..1 across window
  bucketBuy: number;
  bucketSell: number;
  net: number; // cumulative buy - sell through this bucket
}

export function buildPressureSeries(
  activities: WhaleActivity[],
  buckets = 32
): PressurePoint[] {
  if (activities.length === 0) return [];
  const times = activities.map((a) => new Date(a.timestamp).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(1, max - min);

  const bins: { buy: number; sell: number }[] = Array.from(
    { length: buckets },
    () => ({ buy: 0, sell: 0 })
  );

  for (const a of activities) {
    const t = new Date(a.timestamp).getTime();
    const idx = Math.min(buckets - 1, Math.floor(((t - min) / span) * buckets));
    if (a.trade.side === "BUY") {
      bins[idx].buy = addMoney(bins[idx].buy, a.trade.usdcAmount);
    } else {
      bins[idx].sell = addMoney(bins[idx].sell, a.trade.usdcAmount);
    }
  }

  let net = new Decimal(0);
  return bins.map((bin, i) => {
    net = net.add(bin.buy).sub(bin.sell);
    return {
      t: i / Math.max(1, buckets - 1),
      bucketBuy: bin.buy,
      bucketSell: bin.sell,
      net: net.toNumber(),
    };
  });
}
