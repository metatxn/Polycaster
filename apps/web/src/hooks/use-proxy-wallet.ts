"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useConnection } from "wagmi";
import { deriveProxyAddress } from "@/lib/derive-proxy-address";
import {
  clearBalanceCache,
  clearDeploymentCache,
  checkIsDeployed as rpcCheckIsDeployed,
  fetchUsdcBalance as rpcFetchUsdcBalance,
} from "@/lib/rpc";

/**
 * Polymarket Proxy Wallet Hook
 */

// Polymarket Data API
// const DATA_API_BASE = "https://data-api.polymarket.com";

// Query key for proxy wallet data
export const PROXY_WALLET_QUERY_KEY = "proxy-wallet";

export interface ProxyWalletData {
  proxyAddress: string | null;
  isDeployed: boolean;
  usdcBalance: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch wallet data helper
 * @param eoaAddress - The EOA address to derive the proxy wallet from
 * @param skipCache - If true, bypass the RPC cache for fresh data
 */
async function fetchWalletData(eoaAddress: string, skipCache = false) {
  const proxyAddress = await deriveProxyAddress(eoaAddress);

  // Step 2: Check if the derived Safe is actually deployed on-chain
  const isDeployed = await rpcCheckIsDeployed(proxyAddress);

  if (!isDeployed) {
    return {
      proxyAddress,
      isDeployed: false,
      usdcBalance: 0,
    };
  }

  // Step 3: Safe is deployed - fetch USDC balance
  // Pass skipCache to bypass RPC cache when needed (e.g., after placing an order)
  const usdcBalance = await rpcFetchUsdcBalance(proxyAddress, { skipCache });

  return {
    proxyAddress,
    isDeployed: true,
    usdcBalance,
  };
}

export function useProxyWallet() {
  const { address, isConnected } = useConnection();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [PROXY_WALLET_QUERY_KEY, address],
    queryFn: async () => {
      if (!address) throw new Error("No address");
      return fetchWalletData(address);
    },
    enabled: !!address && isConnected,
    // Shorter stale time for more responsive balance updates after transactions
    staleTime: 10000, // 10 seconds
    // Refetch in background to keep balance fresh
    refetchInterval: 15000, // 15 seconds
  });

  /**
   * Refresh proxy wallet data - clears RPC cache and refetches
   * This should be called after any transaction that changes the balance
   */
  const refresh = useCallback(async () => {
    // Clear the RPC-level cache first
    if (query.data?.proxyAddress) {
      clearBalanceCache(query.data.proxyAddress);
    }

    // Then invalidate and refetch the React Query cache
    await queryClient.invalidateQueries({
      queryKey: [PROXY_WALLET_QUERY_KEY, address],
    });

    // Force a refetch to get fresh data
    return queryClient.refetchQueries({
      queryKey: [PROXY_WALLET_QUERY_KEY, address],
    });
  }, [queryClient, address, query.data?.proxyAddress]);

  /**
   * Force refresh with full cache clearing (deployment + balance)
   */
  const forceRefresh = useCallback(async () => {
    if (query.data?.proxyAddress) {
      clearDeploymentCache(query.data.proxyAddress);
      clearBalanceCache(query.data.proxyAddress);
    }

    // Invalidate and refetch
    await queryClient.invalidateQueries({
      queryKey: [PROXY_WALLET_QUERY_KEY, address],
    });

    return queryClient.refetchQueries({
      queryKey: [PROXY_WALLET_QUERY_KEY, address],
    });
  }, [queryClient, address, query.data?.proxyAddress]);

  return {
    proxyAddress: query.data?.proxyAddress ?? null,
    isDeployed: query.data?.isDeployed ?? false,
    usdcBalance: query.data?.usdcBalance ?? 0,
    isLoading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    refresh,
    forceRefresh,
  };
}
