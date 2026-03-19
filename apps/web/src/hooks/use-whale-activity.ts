"use client";

import { useQuery } from "@tanstack/react-query";

export interface WhaleTrader {
  address: string;
  name: string | null;
  profileImage: string | null;
  rank: number;
  totalPnl: number;
  totalVolume: number;
}

export interface WhaleTrade {
  side: "BUY" | "SELL";
  size: number;
  price: number;
  usdcAmount: number;
  outcome: string;
  outcomeIndex: number;
}

export interface WhaleMarket {
  conditionId: string;
  title: string;
  slug: string;
  eventSlug: string;
  image?: string;
  tokenId?: string;
}

export interface WhaleActivity {
  id: string;
  timestamp: string;
  trader: WhaleTrader;
  trade: WhaleTrade;
  market: WhaleMarket;
  source: "leaderboard" | "global_scan";
}

export interface WhaleActivityResponse {
  success: boolean;
  activities: WhaleActivity[];
  whaleCount: number;
  totalTrades: number;
  lastUpdated: string;
  dataAge: number;
  error?: string;
}

export interface UseWhaleActivityOptions {
  whaleCount?: number;
  minTradeSize?: number;
  tradesPerWhale?: number;
  timePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  enabled?: boolean;
  refetchInterval?: number;
}

async function fetchWhaleActivity(
  options: UseWhaleActivityOptions
): Promise<WhaleActivityResponse> {
  const params = new URLSearchParams();

  if (options.whaleCount !== undefined) {
    params.set("whaleCount", options.whaleCount.toString());
  }
  if (options.minTradeSize !== undefined) {
    params.set("minTradeSize", options.minTradeSize.toString());
  }
  if (options.tradesPerWhale !== undefined) {
    params.set("tradesPerWhale", options.tradesPerWhale.toString());
  }
  if (options.timePeriod) {
    params.set("timePeriod", options.timePeriod);
  }

  const response = await fetch(`/api/whales/activity?${params.toString()}`);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || "Failed to fetch whale activity");
  }

  return response.json();
}

export function useWhaleActivity(options: UseWhaleActivityOptions = {}) {
  const {
    whaleCount = 15,
    minTradeSize = 100,
    tradesPerWhale = 5,
    timePeriod = "WEEK",
    enabled = true,
    refetchInterval = 60 * 1000,
  } = options;

  return useQuery<WhaleActivityResponse, Error>({
    queryKey: [
      "whaleActivity",
      whaleCount,
      minTradeSize,
      tradesPerWhale,
      timePeriod,
    ],
    queryFn: () =>
      fetchWhaleActivity({
        whaleCount,
        minTradeSize,
        tradesPerWhale,
        timePeriod,
      }),
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval,
  });
}

export function useWhaleBigMoves() {
  return useWhaleActivity({
    whaleCount: 25,
    minTradeSize: 1000,
    tradesPerWhale: 10,
  });
}

export function useMarketWhaleActivity(
  conditionId: string | undefined,
  options: Omit<UseWhaleActivityOptions, "enabled"> = {}
) {
  const query = useWhaleActivity({
    ...options,
    enabled: !!conditionId,
  });

  const filteredActivities =
    query.data?.activities.filter(
      (activity) => activity.market.conditionId === conditionId
    ) || [];

  const filteredWhaleCount = new Set(
    filteredActivities.map((a) => a.trader.address)
  ).size;

  return {
    ...query,
    data: query.data
      ? {
          ...query.data,
          activities: filteredActivities,
          totalTrades: filteredActivities.length,
          whaleCount: filteredWhaleCount,
        }
      : undefined,
  };
}

export function getWhaleActivityStats(activities: WhaleActivity[]) {
  const buyActivities = activities.filter((a) => a.trade.side === "BUY");
  const sellActivities = activities.filter((a) => a.trade.side === "SELL");

  const totalBuyVolume = buyActivities.reduce(
    (sum, a) => sum + a.trade.usdcAmount,
    0
  );
  const totalSellVolume = sellActivities.reduce(
    (sum, a) => sum + a.trade.usdcAmount,
    0
  );

  const uniqueTraders = new Set(activities.map((a) => a.trader.address)).size;
  const uniqueMarkets = new Set(activities.map((a) => a.market.conditionId))
    .size;

  const leaderboardCount = activities.filter(
    (a) => a.source === "leaderboard"
  ).length;
  const globalScanCount = activities.filter(
    (a) => a.source === "global_scan"
  ).length;

  const buyRatio =
    totalBuyVolume + totalSellVolume > 0
      ? totalBuyVolume / (totalBuyVolume + totalSellVolume)
      : 0.5;

  return {
    totalTrades: activities.length,
    buyCount: buyActivities.length,
    sellCount: sellActivities.length,
    totalBuyVolume,
    totalSellVolume,
    totalVolume: totalBuyVolume + totalSellVolume,
    uniqueTraders,
    uniqueMarkets,
    buyRatio,
    leaderboardCount,
    globalScanCount,
    sentiment:
      buyRatio > 0.6 ? "bullish" : buyRatio < 0.4 ? "bearish" : "neutral",
  };
}
