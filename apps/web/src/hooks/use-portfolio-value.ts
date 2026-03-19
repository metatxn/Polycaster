"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { useProxyWallet } from "./use-proxy-wallet";

/**
 * Portfolio Value Response
 */
interface PortfolioValueResponse {
  success: boolean;
  user: string;
  portfolioValue: number;
  description: string;
  includes: string[];
  excludes: string[];
  error?: string;
}

/**
 * Options for the usePortfolioValue hook
 */
interface UsePortfolioValueOptions {
  /** Override the user address (defaults to connected proxy wallet) */
  userAddress?: string;
  /** Whether to enable the query */
  enabled?: boolean;
}

/**
 * Hook to fetch the user's portfolio value from Polymarket
 *
 * Portfolio value represents "everything you currently own, marked to market"
 *
 * Includes:
 * - Value of YES/NO tokens you hold (positions)
 * - Value of any fully matched trades
 * - Unrealized P/L included
 *
 * Does NOT include:
 * - Open order collateral waiting in the book
 * - Amount still sitting as unused USDC
 *
 * @param options - Configuration options
 * @returns Query result with portfolio value data
 */
export function usePortfolioValue(options: UsePortfolioValueOptions = {}) {
  useConnection(); // Used to trigger re-renders when connection changes
  const { proxyAddress, isDeployed } = useProxyWallet();

  // Use provided address or fall back to proxy wallet (which is what Polymarket uses)
  const userAddress = options.userAddress || proxyAddress;

  return useQuery({
    queryKey: ["portfolio-value", userAddress],
    queryFn: async (): Promise<PortfolioValueResponse> => {
      if (!userAddress) {
        throw new Error("No wallet address available");
      }

      const response = await fetch(
        `/api/user/portfolio-value?user=${userAddress}`
      );

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || "Failed to fetch portfolio value");
      }

      return response.json();
    },
    enabled:
      options.enabled !== false &&
      !!userAddress &&
      (options.userAddress ? true : isDeployed),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}
