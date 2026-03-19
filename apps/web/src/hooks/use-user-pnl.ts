"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";

/**
 * P&L data structure
 */
export interface PnLData {
  realized: number;
  unrealized: number;
  total: number;
  roi: number;
}

/**
 * Portfolio data structure
 */
export interface PortfolioData {
  currentValue: number;
  initialInvestment: number;
  positionCount: number;
}

/**
 * Trading data structure
 */
export interface TradingData {
  totalBuyValue: number;
  totalSellValue: number;
  netFlow: number;
  tradeCount: number;
  uniqueMarkets: number;
}

/**
 * Performance data structure
 */
export interface PerformanceData {
  winRate: number;
  winningPositions: number;
  losingPositions: number;
  bestPerformer: {
    title: string;
    slug: string;
    outcome: string;
    pnl: number;
    pnlPercent: number;
  } | null;
  worstPerformer: {
    title: string;
    slug: string;
    outcome: string;
    pnl: number;
    pnlPercent: number;
  } | null;
}

/**
 * Daily history data
 */
export interface DailyHistory {
  [date: string]: {
    realized: number;
    trades: number;
    volume: number;
  };
}

/**
 * API response structure
 */
interface PnLResponse {
  success: boolean;
  user: string;
  period: string;
  pnl: PnLData;
  portfolio: PortfolioData;
  trading: TradingData;
  performance: PerformanceData;
  history?: DailyHistory;
  error?: string;
}

/**
 * Time period options
 */
export type PnLPeriod = "1d" | "7d" | "30d" | "90d" | "365d" | "all";

/**
 * Query options for fetching P&L
 */
export interface UseUserPnLOptions {
  /** Time period for P&L calculation (default: all) */
  period?: PnLPeriod;
  /** Include daily P&L history (default: false) */
  includeHistory?: boolean;
  /** Enable/disable the query */
  enabled?: boolean;
  /** Override the user address (e.g., use proxy wallet) */
  userAddress?: string;
}

/**
 * Fetch P&L from the API
 */
async function fetchPnL(
  userAddress: string,
  options: UseUserPnLOptions
): Promise<PnLResponse> {
  const params = new URLSearchParams({
    user: userAddress,
    period: options.period || "all",
    includeHistory: (options.includeHistory || false).toString(),
  });

  const response = await fetch(`/api/user/pnl?${params.toString()}`);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || "Failed to fetch P&L");
  }

  return response.json() as Promise<PnLResponse>;
}

/**
 * Hook to fetch user P&L data
 *
 * Automatically uses the connected wallet address.
 * Returns comprehensive P&L, portfolio, trading, and performance data.
 *
 * @param options - Query options
 * @returns Query result with P&L data
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useUserPnL({ period: '30d' });
 *
 * if (isLoading) return <Loading />;
 * if (error) return <Error message={error.message} />;
 *
 * return (
 *   <div>
 *     <p>Total P&L: ${data.pnl.total}</p>
 *     <p>ROI: {data.pnl.roi.toFixed(2)}%</p>
 *     <p>Win Rate: {data.performance.winRate.toFixed(1)}%</p>
 *   </div>
 * );
 * ```
 */
export function useUserPnL(options: UseUserPnLOptions = {}) {
  const { address, isConnected } = useConnection();

  // Use provided address or fall back to connected wallet
  const userAddress = options.userAddress || address;

  return useQuery<PnLResponse, Error>({
    queryKey: ["userPnL", userAddress, options.period, options.includeHistory],
    queryFn: () => {
      if (!userAddress) throw new Error("Address not available");
      return fetchPnL(userAddress, options);
    },
    enabled: isConnected && !!userAddress && options.enabled !== false,
    staleTime: 60 * 1000, // 1 minute (P&L doesn't change as frequently)
    refetchInterval: 2 * 60 * 1000, // Refetch every 2 minutes
  });
}

/**
 * Hook to fetch P&L with history for charting
 *
 * @param period - Time period for P&L calculation
 * @returns Query result with P&L data including history
 */
export function useUserPnLWithHistory(period: PnLPeriod = "30d") {
  return useUserPnL({
    period,
    includeHistory: true,
  });
}

/**
 * Hook to fetch quick P&L summary (no history, optimized for sidebar)
 *
 * @returns Query result with basic P&L summary
 */
export function useUserPnLSummary() {
  const { address, isConnected } = useConnection();

  return useQuery<PnLResponse, Error>({
    queryKey: ["userPnLSummary", address],
    queryFn: () => {
      if (!address) throw new Error("Address not available");
      return fetchPnL(address, { period: "all", includeHistory: false });
    },
    enabled: isConnected && !!address,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}
