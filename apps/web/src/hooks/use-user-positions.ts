"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";

/**
 * Position data structure
 */
export interface Position {
  id: string;
  asset: string;
  conditionId: string;
  outcomeIndex: number;
  outcome: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  initialValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  market: {
    title: string;
    slug: string;
    eventSlug: string;
    icon: string;
    question?: string;
    outcomes?: string[];
    endDate?: string;
  };
}

export interface LostPosition {
  id: string;
  asset: string;
  conditionId: string;
  outcomeIndex: number;
  outcome: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  endDate: string;
  market: {
    title: string;
    slug: string;
    eventSlug: string;
    eventId: string;
    icon: string;
  };
}

/**
 * Positions summary data
 */
export interface PositionsSummary {
  totalValue: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalPnl: number;
  positionCount: number;
}

/**
 * API response structure
 */
interface PositionsResponse {
  success: boolean;
  user: string;
  positions: Position[];
  lostPositions: LostPosition[];
  summary: PositionsSummary;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  error?: string;
}

/**
 * Query options for fetching positions
 */
export interface UseUserPositionsOptions {
  /** Number of positions to fetch (default: 50) */
  limit?: number;
  /** Pagination offset (default: 0) */
  offset?: number;
  /** Filter by market/condition ID */
  market?: string;
  /** Only return active positions (default: true) */
  active?: boolean;
  /** Enable/disable the query */
  enabled?: boolean;
  /** Override the user address (e.g., use proxy wallet) */
  userAddress?: string;
}

/**
 * Fetch positions from the API
 */
async function fetchPositions(
  userAddress: string,
  options: UseUserPositionsOptions
): Promise<PositionsResponse> {
  const params = new URLSearchParams({
    user: userAddress,
    limit: (options.limit || 50).toString(),
    offset: (options.offset || 0).toString(),
    active: (options.active !== false).toString(),
  });

  if (options.market) {
    params.set("market", options.market);
  }

  const response = await fetch(`/api/user/positions?${params.toString()}`);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || "Failed to fetch positions");
  }

  return response.json() as Promise<PositionsResponse>;
}

/**
 * Hook to fetch user positions
 *
 * Automatically uses the connected wallet address.
 * Returns positions, summary, and pagination info.
 *
 * @param options - Query options
 * @returns Query result with positions data
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useUserPositions();
 *
 * if (isLoading) return <Loading />;
 * if (error) return <Error message={error.message} />;
 *
 * return (
 *   <div>
 *     <p>Total Value: ${data.summary.totalValue}</p>
 *     {data.positions.map(position => (
 *       <PositionCard key={position.id} position={position} />
 *     ))}
 *   </div>
 * );
 * ```
 */
export function useUserPositions(options: UseUserPositionsOptions = {}) {
  const { address, isConnected } = useConnection();

  // Use provided address or fall back to connected wallet
  const userAddress = options.userAddress || address;

  return useQuery<PositionsResponse, Error>({
    queryKey: [
      "userPositions",
      userAddress,
      options.limit,
      options.offset,
      options.market,
      options.active,
    ],
    queryFn: () => {
      if (!userAddress) throw new Error("Address not available");
      return fetchPositions(userAddress, options);
    },
    enabled: isConnected && !!userAddress && options.enabled !== false,
    staleTime: 10 * 1000, // 5 seconds - more responsive after trades
    refetchInterval: 30 * 1000, // Refetch every 15 seconds
  });
}

/**
 * Hook to fetch positions for a specific market
 *
 * @param marketId - Market/condition ID to filter by
 * @returns Query result with positions for the market
 */
export function useMarketPositions(marketId: string) {
  const { address, isConnected } = useConnection();

  return useQuery<PositionsResponse, Error>({
    queryKey: ["marketPositions", address, marketId],
    queryFn: () => {
      if (!address) throw new Error("Address not available");
      return fetchPositions(address, { market: marketId, active: true });
    },
    enabled: isConnected && !!address && !!marketId,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000, // More frequent for active trading
  });
}
