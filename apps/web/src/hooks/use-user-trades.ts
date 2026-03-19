"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";

/**
 * Trade data structure
 */
export interface Trade {
  id: string;
  timestamp: string;
  type: "TRADE" | "REDEEM" | "MERGE" | "SPLIT";
  side: "BUY" | "SELL";
  size: number;
  price: number;
  usdcAmount: number;
  outcomeIndex: number;
  outcome: string;
  transactionHash: string;
  market: {
    conditionId: string;
    title: string;
    slug: string;
    eventSlug: string;
    icon: string;
    asset: string;
  };
}

/**
 * Trades summary data
 */
export interface TradesSummary {
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  tradeCount: number;
  uniqueMarkets: number;
}

/**
 * Daily summary data
 */
export interface DailySummary {
  [date: string]: {
    count: number;
    volume: number;
  };
}

/**
 * API response structure
 */
interface TradesResponse {
  success: boolean;
  user: string;
  trades: Trade[];
  summary: TradesSummary;
  dailySummary: DailySummary;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  error?: string;
}

/**
 * Query options for fetching trades
 */
export interface UseUserTradesOptions {
  /** Number of trades to fetch (default: 50) */
  limit?: number;
  /** Pagination offset (default: 0) */
  offset?: number;
  /** Filter by market/condition ID */
  market?: string;
  /** Filter by activity type */
  type?: "TRADE" | "REDEEM" | "MERGE" | "SPLIT" | "ALL";
  /** Filter trades after this date (ISO string) */
  startDate?: string;
  /** Filter trades before this date (ISO string) */
  endDate?: string;
  /** Enable/disable the query */
  enabled?: boolean;
  /** Override the user address (e.g., use proxy wallet) */
  userAddress?: string;
}

/**
 * Fetch trades from the API
 */
async function fetchTrades(
  userAddress: string,
  options: UseUserTradesOptions
): Promise<TradesResponse> {
  const params = new URLSearchParams({
    user: userAddress,
    limit: (options.limit || 50).toString(),
    offset: (options.offset || 0).toString(),
  });

  if (options.market) {
    params.set("market", options.market);
  }

  if (options.type) {
    params.set("type", options.type);
  }

  if (options.startDate) {
    params.set("startDate", options.startDate);
  }

  if (options.endDate) {
    params.set("endDate", options.endDate);
  }

  const response = await fetch(`/api/user/trades?${params.toString()}`);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || "Failed to fetch trades");
  }

  return response.json() as Promise<TradesResponse>;
}

/**
 * Hook to fetch user trade history
 *
 * Automatically uses the connected wallet address.
 * Returns trades, summary, and pagination info.
 *
 * @param options - Query options
 * @returns Query result with trades data
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useUserTrades();
 *
 * if (isLoading) return <Loading />;
 * if (error) return <Error message={error.message} />;
 *
 * return (
 *   <div>
 *     <p>Total Volume: ${data.summary.totalVolume}</p>
 *     {data.trades.map(trade => (
 *       <TradeRow key={trade.id} trade={trade} />
 *     ))}
 *   </div>
 * );
 * ```
 */
export function useUserTrades(options: UseUserTradesOptions = {}) {
  const { address, isConnected } = useConnection();

  // Use provided address or fall back to connected wallet
  const userAddress = options.userAddress || address;

  return useQuery<TradesResponse, Error>({
    queryKey: [
      "userTrades",
      userAddress,
      options.limit,
      options.offset,
      options.market,
      options.type,
      options.startDate,
      options.endDate,
    ],
    queryFn: () => {
      if (!userAddress) throw new Error("Address not available");
      return fetchTrades(userAddress, options);
    },
    enabled: isConnected && !!userAddress && options.enabled !== false,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

/**
 * Hook to fetch user trades with infinite scrolling
 *
 * @param options - Query options (limit is used as page size)
 * @returns Infinite query result with trades data
 */
export function useUserTradesInfinite(
  options: Omit<UseUserTradesOptions, "offset"> = {}
) {
  const { address, isConnected } = useConnection();
  const pageSize = options.limit || 50;

  return useInfiniteQuery<TradesResponse, Error>({
    queryKey: [
      "userTradesInfinite",
      address,
      pageSize,
      options.market,
      options.type,
      options.startDate,
      options.endDate,
    ],
    queryFn: ({ pageParam }) => {
      if (!address) throw new Error("Address not available");
      return fetchTrades(address, {
        ...options,
        limit: pageSize,
        offset: pageParam as number,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return (lastPageParam as number) + pageSize;
    },
    enabled: isConnected && !!address && options.enabled !== false,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to fetch recent trades (last 24 hours)
 *
 * @returns Query result with recent trades
 */
export function useRecentTrades() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  return useUserTrades({
    startDate: yesterday,
    type: "TRADE",
    limit: 20,
  });
}
