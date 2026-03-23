"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";

/**
 * P&L data point
 */
export interface PnLDataPoint {
  timestamp: string;
  date: string;
  pnl: number;
}

/**
 * P&L summary statistics
 */
export interface PnLSummary {
  startPnl: number;
  endPnl: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  dataPoints: number;
}

/**
 * API response structure
 */
interface PnLHistoryResponse {
  success: boolean;
  user: string;
  interval: string;
  fidelity: string;
  data: PnLDataPoint[];
  summary: PnLSummary;
  error?: string;
}

/**
 * Time interval options
 * Supported by Polymarket API: 'max', 'all', '1m', '1w', '1d', '12h', '6h'
 */
export type PnLInterval = "6h" | "12h" | "1d" | "1w" | "1m" | "all" | "max";

/**
 * Data fidelity options
 */
export type PnLFidelity = "1h" | "1d" | "1w";

/**
 * Query options for fetching P&L history
 */
export interface UsePnLHistoryOptions {
  /** Time range for P&L data (default: 1m) */
  interval?: PnLInterval;
  /** Data point granularity (default: 1d) */
  fidelity?: PnLFidelity;
  /** Enable/disable the query */
  enabled?: boolean;
  /** Override the user address (e.g., use proxy wallet) */
  userAddress?: string;
}

/**
 * Fetch P&L history from the API
 */
async function fetchPnLHistory(
  userAddress: string,
  options: UsePnLHistoryOptions
): Promise<PnLHistoryResponse> {
  const params = new URLSearchParams({
    user: userAddress,
    interval: options.interval || "1m",
    fidelity: options.fidelity || "1d",
  });

  const response = await fetch(`/api/user/pnl-history?${params.toString()}`);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || "Failed to fetch P&L history");
  }

  return response.json() as Promise<PnLHistoryResponse>;
}

/**
 * Hook to fetch P&L history for charting
 *
 * @param options - Query options
 * @returns Query result with P&L history data
 *
 * @example
 * ```tsx
 * const { data, isLoading } = usePnLHistory({ interval: '1m' });
 *
 * return (
 *   <PnLChart data={data?.data || []} />
 * );
 * ```
 */
export function usePnLHistory(options: UsePnLHistoryOptions = {}) {
  const { address, isConnected } = useConnection();

  // Use provided address or fall back to connected wallet
  const userAddress = options.userAddress || address;

  return useQuery<PnLHistoryResponse, Error>({
    queryKey: ["pnlHistory", userAddress, options.interval, options.fidelity],
    queryFn: () => {
      if (!userAddress) throw new Error("Address not available");
      return fetchPnLHistory(userAddress, options);
    },
    enabled: isConnected && !!userAddress && options.enabled !== false,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}
