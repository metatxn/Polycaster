"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useProxyWallet } from "./use-proxy-wallet";

/**
 * Polymarket Bridge API base URL
 * @see https://docs.polymarket.com/api-reference/bridge
 */
const BRIDGE_API_URL = "https://bridge.polymarket.com";

/**
 * Supported asset from the Bridge API
 */
export interface SupportedAsset {
  chainId: string;
  chainName: string;
  token: {
    name: string;
    symbol: string;
    address: string;
    decimals: number;
  };
  minCheckoutUsd: number;
}

/**
 * Deposit address for a specific chain/token
 */
export interface DepositAddress {
  chainId: string;
  chainName: string;
  tokenAddress: string;
  tokenSymbol: string;
  depositAddress: string;
}

/**
 * Response from the create deposit endpoint
 * The API returns a single address object with addresses for different chains
 */
export interface CreateDepositResponse {
  address: {
    evm: string; // For EVM chains (Ethereum, Polygon, Arbitrum, etc.)
    svm: string; // For Solana
    btc: string; // For Bitcoin
  };
  note?: string;
}

/**
 * Response from the supported assets endpoint
 */
export interface SupportedAssetsResponse {
  supportedAssets: SupportedAsset[];
}

/**
 * Quote request parameters
 * @see https://docs.polymarket.com/api-reference/bridge/get-a-quote
 */
export interface QuoteRequest {
  fromAmountBaseUnit: string;
  fromChainId: string;
  fromTokenAddress: string;
  recipientAddress: string;
  toChainId: string;
  toTokenAddress: string;
}

/**
 * Fee breakdown from quote response
 */
export interface FeeBreakdown {
  appFeeLabel: string;
  appFeePercent: number;
  appFeeUsd: number;
  fillCostPercent: number;
  fillCostUsd: number;
  gasUsd: number;
  maxSlippage: number;
  minReceived: number;
  swapImpact: number;
  swapImpactUsd: number;
  totalImpact: number;
  totalImpactUsd: number;
}

/**
 * Quote response from the Bridge API
 */
export interface QuoteResponse {
  estCheckoutTimeMs: number;
  estFeeBreakdown: FeeBreakdown;
  estInputUsd: number;
  estOutputUsd: number;
  estToTokenBaseUnit: string;
  quoteId: string;
}

/**
 * Deposit transaction status
 * @see https://docs.polymarket.com/api-reference/bridge/get-deposit-status
 */
export type DepositStatus =
  | "DEPOSIT_DETECTED"
  | "PROCESSING"
  | "ORIGIN_TX_CONFIRMED"
  | "SUBMITTED"
  | "COMPLETED"
  | "FAILED";

/**
 * Single deposit transaction from status API
 */
export interface DepositTransaction {
  fromChainId: string;
  fromTokenAddress: string;
  fromAmountBaseUnit: string;
  toChainId: string;
  toTokenAddress: string;
  status: DepositStatus;
  txHash?: string;
  createdTimeMs?: number;
}

/**
 * Response from deposit status endpoint
 */
export interface DepositStatusResponse {
  transactions: DepositTransaction[];
}

/**
 * Chain metadata for display
 */
export const CHAIN_METADATA: Record<
  string,
  { name: string; icon: string; color: string }
> = {
  "1": { name: "Ethereum", icon: "⟠", color: "#627EEA" },
  "137": { name: "Polygon", icon: "⬡", color: "#8247E5" },
  "42161": { name: "Arbitrum", icon: "🔷", color: "#28A0F0" },
  "10": { name: "Optimism", icon: "🔴", color: "#FF0420" },
  "8453": { name: "Base", icon: "🔵", color: "#0052FF" },
  "43114": { name: "Avalanche", icon: "🔺", color: "#E84142" },
  "56": { name: "BNB Chain", icon: "⛓️", color: "#F0B90B" },
  "324": { name: "zkSync", icon: "⚡", color: "#8C8DFC" },
};

/**
 * Query keys for React Query
 */
export const BRIDGE_QUERY_KEYS = {
  supportedAssets: ["bridge-supported-assets"] as const,
  depositAddresses: (address: string) =>
    ["bridge-deposit-addresses", address] as const,
  // TODO: Reserved for future query-based caching/polling of deposit status.
  // Currently, getDepositStatus() uses a mutation (depositStatusMutation) for on-demand fetching.
  // Convert to useQuery with this key if automatic polling or cache invalidation is needed.
  depositStatus: (address: string) =>
    ["bridge-deposit-status", address] as const,
  // TODO: Reserved for future query-based caching of quotes.
  // Currently, getQuote() uses a mutation (quoteMutation) for on-demand fetching.
  // Convert to useQuery with this key if quote caching or deduplication is needed.
  quote: (params: QuoteRequest) =>
    [
      "bridge-quote",
      params.fromChainId,
      params.fromTokenAddress,
      params.fromAmountBaseUnit,
      params.recipientAddress,
      params.toChainId,
      params.toTokenAddress,
    ] as const,
};

/**
 * Fetch supported assets from Bridge API
 */
async function fetchSupportedAssets(): Promise<SupportedAsset[]> {
  const response = await fetch(`${BRIDGE_API_URL}/supported-assets`);

  if (!response.ok) {
    throw new Error(`Failed to fetch supported assets: ${response.status}`);
  }

  const data: SupportedAssetsResponse = await response.json();
  return data.supportedAssets;
}

/**
 * Fetch a quote for a deposit
 * @see https://docs.polymarket.com/api-reference/bridge/get-a-quote
 */
async function fetchQuote(params: QuoteRequest): Promise<QuoteResponse> {
  const response = await fetch(`${BRIDGE_API_URL}/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      errorData.error || `Failed to fetch quote: ${response.status}`
    );
  }

  return response.json();
}

/**
 * Fetch deposit status for an address
 * @see https://docs.polymarket.com/api-reference/bridge/get-deposit-status
 */
async function fetchDepositStatus(
  depositAddress: string
): Promise<DepositTransaction[]> {
  const response = await fetch(
    `${BRIDGE_API_URL}/status/${encodeURIComponent(depositAddress)}`
  );

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      errorData.error || `Failed to fetch deposit status: ${response.status}`
    );
  }

  const data: DepositStatusResponse = await response.json();
  return data.transactions;
}

/**
 * Convert API response to DepositAddress format
 */
function convertToDepositAddresses(
  data: CreateDepositResponse
): DepositAddress[] {
  // Convert the API response to our DepositAddress format
  // The EVM address is used for all EVM chains (Polygon, Ethereum, Arbitrum, etc.)
  return [
    // Polygon (primary for Polymarket)
    {
      chainId: "137",
      chainName: "Polygon",
      tokenAddress: "", // Any supported token
      tokenSymbol: "USDC", // Default to USDC
      depositAddress: data.address.evm,
    },
    // Ethereum
    {
      chainId: "1",
      chainName: "Ethereum",
      tokenAddress: "",
      tokenSymbol: "USDC",
      depositAddress: data.address.evm,
    },
    // Arbitrum
    {
      chainId: "42161",
      chainName: "Arbitrum",
      tokenAddress: "",
      tokenSymbol: "USDC",
      depositAddress: data.address.evm,
    },
    // Base
    {
      chainId: "8453",
      chainName: "Base",
      tokenAddress: "",
      tokenSymbol: "USDC",
      depositAddress: data.address.evm,
    },
    // Optimism
    {
      chainId: "10",
      chainName: "Optimism",
      tokenAddress: "",
      tokenSymbol: "USDC",
      depositAddress: data.address.evm,
    },
  ];
}

/**
 * Create deposit addresses for a wallet
 */
async function createDepositAddresses(
  walletAddress: string
): Promise<DepositAddress[]> {
  const response = await fetch(`${BRIDGE_API_URL}/deposit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      address: walletAddress,
    }),
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(
      errorData.message ||
        `Failed to create deposit addresses: ${response.status}`
    );
  }

  const data: CreateDepositResponse = await response.json();
  return convertToDepositAddresses(data);
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
    queryKey: BRIDGE_QUERY_KEYS.supportedAssets,
    queryFn: fetchSupportedAssets,
    staleTime: 5 * 60 * 1000, // 5 minutes - supported assets don't change often
  });

  // Query for deposit addresses (cached per address)
  const depositAddressesQuery = useQuery({
    queryKey: BRIDGE_QUERY_KEYS.depositAddresses(proxyAddress || ""),
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
      queryClient.setQueryData(
        BRIDGE_QUERY_KEYS.depositAddresses(walletAddress),
        data
      );
    },
  });

  // Mutation for fetching quotes
  const quoteMutation = useMutation({
    mutationFn: fetchQuote,
  });

  // Mutation for fetching deposit status
  const depositStatusMutation = useMutation({
    mutationFn: fetchDepositStatus,
  });

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
    // Refetch if needed, otherwise return cached data
    await supportedAssetsQuery.refetch();
    return supportedAssetsQuery.data || [];
  }, [supportedAssetsQuery]);

  /**
   * Create deposit addresses for a wallet
   *
   * The API returns a single address object with addresses for different chain types:
   * - evm: For all EVM chains (Ethereum, Polygon, Arbitrum, Base, etc.)
   * - svm: For Solana
   * - btc: For Bitcoin
   *
   * Assets sent to these addresses are automatically bridged to USDC.e on Polygon.
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
        BRIDGE_QUERY_KEYS.depositAddresses(targetAddress)
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
        queryKey: BRIDGE_QUERY_KEYS.depositAddresses(proxyAddress),
      });
    }
  }, [proxyAddress, queryClient]);

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
      return quoteMutation.mutateAsync(params);
    },
    [quoteMutation]
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
  const getDepositStatus = useCallback(
    async (depositAddress: string): Promise<DepositTransaction[]> => {
      return depositStatusMutation.mutateAsync(depositAddress);
    },
    [depositStatusMutation]
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
  };
}
