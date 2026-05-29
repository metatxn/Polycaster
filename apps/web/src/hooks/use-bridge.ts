"use client";

import {
  type BridgeRequestOptions,
  CHAIN_METADATA,
  createDepositAddresses as createSharedDepositAddresses,
  type DepositAddress,
  type DepositTransaction,
  fetchDepositStatus as fetchSharedDepositStatus,
  fetchQuote as fetchSharedQuote,
  fetchSupportedAssets as fetchSharedSupportedAssets,
  fetchWithdrawalAddresses as fetchSharedWithdrawalAddresses,
  type QuoteRequest,
  type QuoteResponse,
  type SupportedAsset,
  type WithdrawalAddressesResponse,
  type WithdrawalRequest,
} from "@knoww/shared-types/bridge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { qk } from "@/lib/query-keys";
import { useProxyWallet } from "./use-proxy-wallet";

export type {
  DepositAddress,
  DepositStatus,
  DepositTransaction,
  FeeBreakdown,
  QuoteRequest,
  QuoteResponse,
  SupportedAsset,
  WithdrawalAddressesResponse,
  WithdrawalRequest,
} from "@knoww/shared-types/bridge";
export { CHAIN_METADATA };

function getBridgeOptions(): BridgeRequestOptions {
  return {
    builderCode: process.env.NEXT_PUBLIC_POLY_BUILDER_CODE,
  };
}

async function fetchSupportedAssets(): Promise<SupportedAsset[]> {
  return fetchSharedSupportedAssets(getBridgeOptions());
}

export async function fetchBridgeQuote(
  params: QuoteRequest
): Promise<QuoteResponse> {
  return fetchSharedQuote(params, getBridgeOptions());
}

async function fetchDepositStatus(
  depositAddress: string
): Promise<DepositTransaction[]> {
  return fetchSharedDepositStatus(depositAddress, getBridgeOptions());
}

async function fetchWithdrawalAddresses(
  params: WithdrawalRequest
): Promise<WithdrawalAddressesResponse> {
  return fetchSharedWithdrawalAddresses(params, getBridgeOptions());
}

async function createDepositAddresses(
  walletAddress: string
): Promise<DepositAddress[]> {
  return createSharedDepositAddresses(walletAddress, getBridgeOptions());
}

/**
 * Hook for interacting with Polymarket Bridge API
 *
 * This hook provides methods to:
 * 1. Get supported assets for deposits
 * 2. Create deposit addresses for bridging assets to Polymarket
 * 3. Get quotes for deposits (fees, estimated output, checkout time)
 * 4. Track deposit status
 *
 * Uses React Query for automatic caching, deduplication, and refetching.
 *
 * @see https://docs.polymarket.com/api-reference/bridge
 */
export function useBridge() {
  const { proxyAddress } = useProxyWallet();
  const queryClient = useQueryClient();

  // Query for supported assets (auto-fetches, cached globally)
  const supportedAssetsQuery = useQuery({
    queryKey: qk.bridge.supportedAssets(),
    queryFn: fetchSupportedAssets,
    staleTime: 5 * 60 * 1000, // 5 minutes - supported assets don't change often
  });

  // Query for deposit addresses (cached per address)
  const depositAddressesQuery = useQuery({
    queryKey: qk.bridge.depositAddresses(proxyAddress || ""),
    queryFn: () => {
      if (!proxyAddress) {
        throw new Error(
          "No wallet address provided. Please complete trading setup first."
        );
      }
      return createDepositAddresses(proxyAddress);
    },
    enabled: !!proxyAddress,
    staleTime: 10 * 60 * 1000, // 10 minutes - deposit addresses are stable
  });

  // Mutation for creating deposit addresses (can be called with custom address)
  const createDepositMutation = useMutation({
    mutationFn: createDepositAddresses,
    onSuccess: (data, walletAddress) => {
      // Cache the result
      queryClient.setQueryData(qk.bridge.depositAddresses(walletAddress), data);
    },
  });

  // Mutation for fetching quotes
  const quoteMutation = useMutation({
    mutationFn: fetchBridgeQuote,
  });

  // Mutation for fetching deposit status
  const depositStatusMutation = useMutation({
    mutationFn: fetchDepositStatus,
  });

  // Mutation for creating withdrawal (bridge) addresses
  const withdrawalAddressesMutation = useMutation({
    mutationFn: fetchWithdrawalAddresses,
  });

  const supportedAssetsQueryRef = useRef(supportedAssetsQuery);
  supportedAssetsQueryRef.current = supportedAssetsQuery;

  /**
   * Get supported assets for deposits
   *
   * Returns all supported chains and tokens that can be used for deposits.
   * Each asset includes minimum deposit amount in USD.
   *
   * Now uses React Query - automatically cached and deduplicated.
   */
  const getSupportedAssets = useCallback(async (): Promise<
    SupportedAsset[]
  > => {
    const query = supportedAssetsQueryRef.current;
    await query.refetch();
    return query.data || [];
  }, []);

  /**
   * Create deposit addresses for a wallet
   *
   * The API returns a single address object with addresses for different chain types:
   * - evm: For all EVM chains (Ethereum, Polygon, Arbitrum, Base, etc.)
   * - svm: For Solana
   * - btc: For Bitcoin
   *
   * Assets sent to these addresses are automatically bridged to pUSD on Polygon
   * (Polymarket's V2 trading token).
   *
   * @param walletAddress - Optional wallet address (defaults to proxy wallet)
   */
  const createDepositAddressesFn = useCallback(
    async (walletAddress?: string): Promise<DepositAddress[]> => {
      const targetAddress = walletAddress || proxyAddress;

      if (!targetAddress) {
        throw new Error(
          "No wallet address provided. Please complete trading setup first."
        );
      }

      // If we already have cached data for this address, return it
      const cached = queryClient.getQueryData<DepositAddress[]>(
        qk.bridge.depositAddresses(targetAddress)
      );
      if (cached) {
        return cached;
      }

      // Otherwise, use mutation to create new addresses
      return createDepositMutation.mutateAsync(targetAddress);
    },
    [proxyAddress, queryClient, createDepositMutation]
  );

  /**
   * Get chain metadata for display
   */
  const getChainMetadata = useCallback((chainId: string) => {
    return (
      CHAIN_METADATA[chainId] || {
        name: `Chain ${chainId}`,
        icon: "🔗",
        color: "#888888",
      }
    );
  }, []);

  /**
   * Clear deposit addresses (reset cache)
   */
  const clearDepositAddresses = useCallback(() => {
    if (proxyAddress) {
      queryClient.removeQueries({
        queryKey: qk.bridge.depositAddresses(proxyAddress),
      });
    }
  }, [proxyAddress, queryClient]);

  const quoteMutationRef = useRef(quoteMutation);
  quoteMutationRef.current = quoteMutation;

  /**
   * Get a quote for a deposit
   *
   * Returns estimated fees, output amount, and checkout time.
   * Useful for showing users what they'll receive before depositing.
   *
   * @see https://docs.polymarket.com/api-reference/bridge/get-a-quote
   */
  const getQuote = useCallback(
    async (params: QuoteRequest): Promise<QuoteResponse> => {
      return quoteMutationRef.current.mutateAsync(params);
    },
    []
  );

  /**
   * Get deposit status for an address
   *
   * Returns all transactions associated with a deposit address.
   * Use this to track the progress of deposits.
   *
   * Status values:
   * - DEPOSIT_DETECTED: Deposit detected but not yet processing
   * - PROCESSING: Transaction is being routed and swapped
   * - ORIGIN_TX_CONFIRMED: Origin transaction confirmed on source chain
   * - SUBMITTED: Transaction submitted to destination chain
   * - COMPLETED: Transaction completed successfully
   * - FAILED: Transaction failed
   *
   * @see https://docs.polymarket.com/api-reference/bridge/get-deposit-status
   */
  const depositStatusMutationRef = useRef(depositStatusMutation);
  depositStatusMutationRef.current = depositStatusMutation;

  const getDepositStatus = useCallback(
    async (depositAddress: string): Promise<DepositTransaction[]> => {
      return depositStatusMutationRef.current.mutateAsync(depositAddress);
    },
    []
  );

  /**
   * Create withdrawal addresses for cross-chain withdrawals
   *
   * Calls POST /withdraw on the Bridge API. Returns bridge deposit addresses
   * (evm, svm, btc) to which pUSD should be transferred from the proxy wallet.
   * The bridge handles converting and routing the funds to the recipient on the
   * destination chain.
   *
   * @see https://docs.polymarket.com/api-reference/bridge/create-withdrawal-addresses
   */
  const withdrawalAddressesMutationRef = useRef(withdrawalAddressesMutation);
  withdrawalAddressesMutationRef.current = withdrawalAddressesMutation;

  const getWithdrawalAddresses = useCallback(
    async (params: WithdrawalRequest): Promise<WithdrawalAddressesResponse> => {
      return withdrawalAddressesMutationRef.current.mutateAsync(params);
    },
    []
  );

  // Combine loading states
  const isLoading =
    supportedAssetsQuery.isLoading || createDepositMutation.isPending;

  // Combine error states (prioritize mutation error, then query error)
  const error =
    createDepositMutation.error?.message ||
    supportedAssetsQuery.error?.message ||
    null;

  return {
    // State (maintaining backward compatibility)
    isLoading,
    error,
    supportedAssets: supportedAssetsQuery.data || [],
    depositAddresses: depositAddressesQuery.data || [],
    proxyAddress,

    // Actions (maintaining backward compatibility)
    getSupportedAssets,
    createDepositAddresses: createDepositAddressesFn,
    getChainMetadata,
    clearDepositAddresses,

    // New: Quote API
    getQuote,
    isLoadingQuote: quoteMutation.isPending,
    quoteError: quoteMutation.error?.message || null,

    // New: Deposit Status API
    getDepositStatus,
    isLoadingDepositStatus: depositStatusMutation.isPending,
    depositStatusError: depositStatusMutation.error?.message || null,

    // Withdrawal (Bridge) API
    getWithdrawalAddresses,
    isLoadingWithdrawal: withdrawalAddressesMutation.isPending,
    withdrawalError: withdrawalAddressesMutation.error?.message || null,
  };
}
