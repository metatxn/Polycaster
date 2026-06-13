"use client";

import {
  derivePolymarketDepositWallet,
  derivePolymarketSafe,
} from "@knoww/shared-types/relayer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { type Address, getAddress } from "viem";
import { useConnection } from "wagmi";
import { qk } from "@/lib/query-keys";
import {
  clearBalanceCache,
  clearDeploymentCache,
  checkIsDeployed as rpcCheckIsDeployed,
  fetchUsdcBalance as rpcFetchUsdcBalance,
} from "@/lib/rpc";
import {
  type TradingWalletMode,
  useTradingWalletMode,
} from "./use-trading-wallet-mode";

/**
 * Polymarket Proxy Wallet Hook
 */

export interface ProxyWalletData {
  proxyAddress: string | null;
  isDeployed: boolean;
  usdcBalance: number;
  isLoading: boolean;
  error: string | null;
  walletMode: TradingWalletMode;
}

/**
 * Fetch wallet data helper
 * @param eoaAddress - The EOA address to derive the proxy wallet from
 * @param skipCache - If true, bypass the RPC cache for fresh data
 */
async function fetchWalletData(
  eoaAddress: string,
  mode: TradingWalletMode,
  skipCache = false
) {
  if (mode === "eoa") {
    const usdcBalance = await rpcFetchUsdcBalance(eoaAddress, { skipCache });
    return {
      proxyAddress: eoaAddress,
      isDeployed: true,
      usdcBalance,
      walletMode: mode,
    };
  }

  const ownerAddress = getAddress(eoaAddress) as Address;
  const proxyAddress =
    mode === "deposit"
      ? derivePolymarketDepositWallet(ownerAddress)
      : derivePolymarketSafe(ownerAddress);

  // Step 2: Check if the derived Safe is actually deployed on-chain
  const isDeployed = await rpcCheckIsDeployed(proxyAddress);

  if (!isDeployed) {
    return {
      proxyAddress,
      isDeployed: false,
      usdcBalance: 0,
      walletMode: mode,
    };
  }

  // Step 3: Safe is deployed - fetch USDC balance
  // Pass skipCache to bypass RPC cache when needed (e.g., after placing an order)
  const usdcBalance = await rpcFetchUsdcBalance(proxyAddress, { skipCache });

  return {
    proxyAddress,
    isDeployed: true,
    usdcBalance,
    walletMode: mode,
  };
}

export function useProxyWallet() {
  const { address, isConnected } = useConnection();
  const { mode } = useTradingWalletMode();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.proxyWallet.byAddressMode(address, mode),
    queryFn: async () => {
      if (!address) throw new Error("No address");
      return fetchWalletData(address, mode);
    },
    enabled: !!address && isConnected,
    // Proxy wallet data is shared by navbar, trading forms, portfolio chrome,
    // onboarding, etc. Polling here multiplies RPC traffic because each
    // mounted observer schedules its own interval. Balance-changing actions
    // already call `refresh()`, so keep this warm without background polling.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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
      queryKey: qk.proxyWallet.byAddress(address),
    });

    // Force a refetch to get fresh data
    return queryClient.refetchQueries({
      queryKey: qk.proxyWallet.byAddress(address),
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
      queryKey: qk.proxyWallet.byAddress(address),
    });

    return queryClient.refetchQueries({
      queryKey: qk.proxyWallet.byAddress(address),
    });
  }, [queryClient, address, query.data?.proxyAddress]);

  return {
    proxyAddress: query.data?.proxyAddress ?? null,
    isDeployed: query.data?.isDeployed ?? false,
    usdcBalance: query.data?.usdcBalance ?? 0,
    walletMode: query.data?.walletMode ?? mode,
    isSafeMode: mode === "safe",
    isDepositMode: mode === "deposit",
    isEoaMode: mode === "eoa",
    isLoading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    refresh,
    forceRefresh,
  };
}
