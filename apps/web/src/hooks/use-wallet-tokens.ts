"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useConnection } from "wagmi";
import { useTokenPrices } from "./use-token-prices";

/**
 * Token balance information
 */
export interface TokenBalance {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  balance: number;
  balanceRaw: string;
  usdValue: number;
  logoUrl?: string;
}

/**
 * Wallet tokens query result
 */
interface WalletTokensResult {
  tokens: TokenBalance[];
  nativeBalance: number;
}

/**
 * Common tokens on Polygon with their contract addresses
 */
const POLYGON_TOKENS: Array<{
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoUrl?: string;
}> = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Native USDC on Polygon
    decimals: 6,
    logoUrl: "/usdc-token.webp",
  },
  {
    symbol: "USDC.e",
    name: "Bridged USDC",
    address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // Bridged USDC.e
    decimals: 6,
    logoUrl: "/usdc-token.webp",
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    decimals: 18,
    logoUrl: "https://cryptologos.cc/logos/multi-collateral-dai-dai-logo.png",
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    decimals: 6,
    logoUrl: "https://cryptologos.cc/logos/tether-usdt-logo.png",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    decimals: 18,
    logoUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png",
  },
  {
    symbol: "WMATIC",
    name: "Wrapped Matic",
    address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    decimals: 18,
    logoUrl: "https://cryptologos.cc/logos/polygon-matic-logo.png",
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    decimals: 8,
    logoUrl: "https://cryptologos.cc/logos/wrapped-bitcoin-wbtc-logo.png",
  },
];

// ERC20 ABI for balanceOf
const ERC20_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Get the best Polygon RPC URL.
 * Uses proxy on client-side to hide API keys.
 */
function getPolygonRpcUrl(): string {
  const isClient = typeof window !== "undefined";

  if (isClient) {
    // On client: Use the proxy (handles RPC selection server-side)
    return "/api/rpc/polygon";
  }

  // On server: Use Alchemy directly
  const alchemyKey =
    process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  if (alchemyKey) {
    return `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  const customRpcUrl =
    process.env.POLYGON_RPC_URL || process.env.NEXT_PUBLIC_POLYGON_RPC_URL;
  if (customRpcUrl) {
    return customRpcUrl;
  }

  return "https://polygon-rpc.com";
}

/**
 * Create a viem client - uses single RPC endpoint (proxy on client)
 * No fallback needed since proxy handles RPC selection server-side.
 */
async function createClient() {
  const { createPublicClient, http } = await import("viem");
  const { polygon } = await import("viem/chains");

  return createPublicClient({
    chain: polygon,
    transport: http(getPolygonRpcUrl(), {
      timeout: 15_000, // 15 second timeout
      retryCount: 2,
      retryDelay: 1000,
    }),
    batch: {
      multicall: true, // Enable automatic multicall batching
    },
  });
}

// Singleton client promise (shared across all hook instances)
// createClient returns Promise<PublicClient>, so clientPromise is Promise<PublicClient>
let clientPromise: ReturnType<typeof createClient> | null = null;

/**
 * Get or create the singleton client
 */
async function getClient() {
  if (!clientPromise) {
    clientPromise = createClient();
  }
  return clientPromise;
}

/**
 * Price getter function type
 */
type PriceGetter = (symbol: string) => number;

/**
 * Fetch all token balances for a wallet using multicall
 *
 * @param address - The wallet address to fetch balances for
 * @param getPrice - Function to get the current price for a token symbol
 */
async function fetchWalletTokens(
  address: string,
  getPrice: PriceGetter
): Promise<WalletTokensResult> {
  const { formatUnits } = await import("viem");
  const client = await getClient();

  // Use multicall to batch all balance requests into a single RPC call
  // This dramatically reduces the number of requests and avoids rate limiting
  const multicallContracts = POLYGON_TOKENS.map((token) => ({
    address: token.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf" as const,
    args: [address as `0x${string}`],
  }));

  // Execute multicall - all balance requests in ONE RPC call
  const [nativeBal, multicallResults] = await Promise.all([
    client.getBalance({ address: address as `0x${string}` }),
    client.multicall({
      contracts: multicallContracts,
      allowFailure: true, // Don't fail if one token fails
    }),
  ]);

  const nativeBalFormatted = Number(formatUnits(nativeBal, 18));

  // Process multicall results
  const tokenBalances: TokenBalance[] = [];

  multicallResults.forEach(
    (result: { status: string; result?: bigint }, index: number) => {
      const token = POLYGON_TOKENS[index];

      if (result.status === "success" && result.result !== undefined) {
        const balance = result.result as bigint;
        const balanceFormatted = Number(formatUnits(balance, token.decimals));

        if (balanceFormatted > 0.000001) {
          // Get live price from CoinMarketCap API
          const tokenPrice = getPrice(token.symbol);
          const usdValue = balanceFormatted * tokenPrice;

          tokenBalances.push({
            symbol: token.symbol,
            name: token.name,
            address: token.address,
            decimals: token.decimals,
            balance: balanceFormatted,
            balanceRaw: balance.toString(),
            usdValue,
            logoUrl: token.logoUrl,
          });
        }
      }
    }
  );

  // Add native POL if balance > 0
  if (nativeBalFormatted > 0.000001) {
    // Get live POL price from CoinMarketCap API
    const polPrice = getPrice("POL");

    tokenBalances.push({
      symbol: "POL",
      name: "Polygon",
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
      balance: nativeBalFormatted,
      balanceRaw: nativeBal.toString(),
      usdValue: nativeBalFormatted * polPrice,
      logoUrl: "https://cryptologos.cc/logos/polygon-matic-logo.png",
    });
  }

  // Sort by USD value descending
  tokenBalances.sort((a, b) => b.usdValue - a.usdValue);

  return {
    tokens: tokenBalances,
    nativeBalance: nativeBalFormatted,
  };
}

export interface UseWalletTokensOptions {
  /**
   * When false, do not auto-fetch token balances.
   * This prevents background RPC spam because `DepositModal` is rendered in multiple places.
   */
  enabled?: boolean;
}

/**
 * Hook to fetch user's token balances from their Polygon wallet
 *
 * This fetches balances for common tokens that can be used for deposits.
 * Uses multicall to batch all balance requests into a single RPC call,
 * avoiding rate limiting issues.
 *
 * Now uses React Query for automatic caching, deduplication, and refetching.
 * React Query handles:
 * - Request deduplication (multiple components calling this hook share one request)
 * - Automatic caching (data fetched once, used everywhere)
 * - Automatic refetch on window focus
 * - Built-in error retry logic
 * - No manual debouncing needed (React Query handles it)
 *
 * USD values are calculated using live prices from CoinMarketCap API.
 */
export function useWalletTokens(options?: UseWalletTokensOptions) {
  const { address, isConnected } = useConnection();
  const enabled = options?.enabled ?? true;

  // Get live token prices from CoinMarketCap
  const {
    getPrice,
    isLoading: isPricesLoading,
    isStale: isPricesStale,
  } = useTokenPrices({ enabled });

  const query = useQuery({
    queryKey: ["wallet-tokens", address],
    queryFn: () => {
      if (!address) {
        throw new Error("No address provided");
      }
      return fetchWalletTokens(address, getPrice);
    },
    enabled: enabled && !!address && isConnected,
    staleTime: 30 * 1000, // 30 seconds - balances can change frequently
    refetchInterval: 60 * 1000, // Refetch every minute
    // React Query automatically deduplicates requests, so no manual debouncing needed
  });

  /**
   * Recalculate token USD values when prices update
   * This ensures the UI reflects the latest prices without refetching balances
   */
  const tokensWithUpdatedPrices = useMemo(() => {
    if (!query.data?.tokens) return [];

    return query.data.tokens.map((token) => ({
      ...token,
      usdValue: token.balance * getPrice(token.symbol),
    }));
  }, [query.data?.tokens, getPrice]);

  /**
   * Get total USD value of all tokens
   */
  const totalUsdValue = useMemo(
    () =>
      tokensWithUpdatedPrices.reduce((sum, token) => sum + token.usdValue, 0),
    [tokensWithUpdatedPrices]
  );

  return {
    tokens: tokensWithUpdatedPrices,
    nativeBalance: query.data?.nativeBalance ?? 0,
    totalUsdValue,
    isLoading: query.isLoading || isPricesLoading,
    /** Whether the USD prices are estimates (API unavailable or stale) */
    isPricesStale,
    error: query.error?.message ?? null,
    refresh: query.refetch,
  };
}
