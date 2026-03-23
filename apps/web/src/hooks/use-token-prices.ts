"use client";

import { useQuery } from "@tanstack/react-query";
import type { TokenPricesResponse } from "@/app/api/price/tokens/route";

/**
 * Default/fallback prices for when API is unavailable
 * These are conservative estimates
 */
const FALLBACK_PRICES: Record<string, number> = {
  POL: 0.5,
  MATIC: 0.5,
  WMATIC: 0.5,
  ETH: 3500,
  WETH: 3500,
  BTC: 100000,
  WBTC: 100000,
  USDC: 1,
  "USDC.e": 1,
  USDT: 1,
  DAI: 1,
};

/**
 * Query key for token prices
 */
export const TOKEN_PRICES_QUERY_KEY = ["token-prices"] as const;

/**
 * Fetch token prices from the API
 */
async function fetchTokenPrices(): Promise<TokenPricesResponse> {
  const response = await fetch("/api/price/tokens", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch token prices: ${response.status}`);
  }

  return response.json();
}

/**
 * Hook options
 */
export interface UseTokenPricesOptions {
  /**
   * Whether to enable the query
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook return type
 */
export interface UseTokenPricesReturn {
  /**
   * Get the price for a specific token symbol
   * Returns the fallback price if the real price is not available
   */
  getPrice: (symbol: string) => number;

  /**
   * All available prices as a record
   */
  prices: Record<string, number>;

  /**
   * Whether the prices are being loaded
   */
  isLoading: boolean;

  /**
   * Whether the prices are from cache
   */
  isCached: boolean;

  /**
   * Whether the prices are stale (expired cache or fallback)
   */
  isStale: boolean;

  /**
   * Error message if fetch failed
   */
  error: string | null;

  /**
   * Timestamp of when prices were last fetched
   */
  timestamp: number | null;

  /**
   * Refetch prices manually
   */
  refetch: () => void;
}

/**
 * Hook to fetch and cache token prices from CoinMarketCap
 *
 * Uses React Query for:
 * - Automatic caching (5 minute stale time to match API cache)
 * - Request deduplication across components
 * - Automatic refetch on window focus
 * - Error retry logic
 *
 * @example
 * ```tsx
 * const { getPrice, isLoading, isStale } = useTokenPrices();
 *
 * // Get price for a token
 * const ethPrice = getPrice("WETH"); // Returns ~3500 or fallback
 * const usdcPrice = getPrice("USDC"); // Returns ~1
 *
 * // Calculate USD value
 * const usdValue = tokenBalance * getPrice(token.symbol);
 * ```
 */
export function useTokenPrices(
  options?: UseTokenPricesOptions
): UseTokenPricesReturn {
  const { enabled = true } = options ?? {};

  const query = useQuery({
    queryKey: TOKEN_PRICES_QUERY_KEY,
    queryFn: fetchTokenPrices,
    enabled,
    // Match the server-side cache duration
    staleTime: 5 * 60 * 1000, // 5 minutes
    // Refetch in background every 5 minutes
    refetchInterval: 5 * 60 * 1000,
    // Don't refetch too aggressively
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Keep previous data while fetching new data
    placeholderData: (previousData) => previousData,
    // Retry on failure
    retry: 2,
    retryDelay: 1000,
  });

  /**
   * Get price for a specific token symbol
   * Falls back to default prices if API price not available
   */
  const getPrice = (symbol: string): number => {
    // First try to get from API response
    const apiPrice = query.data?.prices?.[symbol];
    if (apiPrice !== undefined && apiPrice > 0) {
      return apiPrice;
    }

    // Fall back to default prices
    return FALLBACK_PRICES[symbol] ?? 1; // Default to 1 (assume stablecoin) if unknown
  };

  return {
    getPrice,
    prices: query.data?.prices ?? FALLBACK_PRICES,
    isLoading: query.isLoading,
    isCached: query.data?.cached ?? false,
    isStale: query.data?.stale ?? !query.data,
    error: query.error?.message ?? null,
    timestamp: query.data?.timestamp ?? null,
    refetch: query.refetch,
  };
}

/**
 * Utility function to get a token price without the hook
 * Useful for one-off calculations outside of React components
 *
 * Note: This fetches directly from the API and doesn't use React Query cache
 * Prefer using the hook when possible
 */
export async function getTokenPrice(symbol: string): Promise<number> {
  try {
    const response = await fetch("/api/price/tokens");
    if (!response.ok) {
      throw new Error("Failed to fetch prices");
    }
    const data: TokenPricesResponse = await response.json();
    return data.prices[symbol] ?? FALLBACK_PRICES[symbol] ?? 1;
  } catch {
    return FALLBACK_PRICES[symbol] ?? 1;
  }
}
