/**
 * Shared RPC Client Utility
 *
 * This module provides a singleton public client for all RPC calls
 * with built-in caching and rate limiting to avoid 429 errors.
 *
 * The public Polygon RPC (polygon-rpc.com) has strict rate limits.
 * This utility ensures we:
 * 1. Reuse a single client instance across the app
 * 2. Cache deployment status checks
 * 3. Throttle balance checks
 */

import { createPublicClient, erc20Abi, http, type PublicClient } from "viem";
import { polygon } from "viem/chains";
import { USDC_E_ADDRESS, USDC_E_DECIMALS } from "@/constants/contracts";

// Cache expiration times
const DEPLOYMENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const BALANCE_CACHE_TTL = 30 * 1000; // 30 seconds

// Singleton public client
let publicClient: PublicClient | null = null;

// Cache for deployment checks
const deploymentCache = new Map<
  string,
  { isDeployed: boolean; timestamp: number }
>();

// Cache for balance checks
const balanceCache = new Map<string, { balance: number; timestamp: number }>();

// Throttle state for RPC calls
let lastRpcCall = 0;
const MIN_RPC_INTERVAL = 100; // Minimum 100ms between RPC calls

/**
 * Get the RPC URL with priority:
 * Client-side: Uses /api/rpc/polygon proxy (hides API key)
 * Server-side priority:
 *   1. Alchemy RPC (if ALCHEMY_API_KEY is set)
 *   2. Custom RPC URL from env (POLYGON_RPC_URL)
 *   3. Fallback to public Polygon RPC
 *
 * SECURITY: We use a server-side proxy to hide the Alchemy API key.
 * The proxy endpoint forwards requests to Alchemy without exposing the key.
 *
 * @returns The best available RPC URL
 */
export function getRpcUrl(): string {
  // Check if we're on the client side
  const isClient = typeof window !== "undefined";

  if (isClient) {
    // On client: Use the proxy to hide API key
    // The proxy will use Alchemy server-side
    return "/api/rpc/polygon";
  }

  // On server: Use Alchemy directly (key is safe server-side)
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (alchemyKey) {
    return `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  // Priority 2: Custom RPC URL
  const customRpcUrl = process.env.POLYGON_RPC_URL;
  if (customRpcUrl) {
    return customRpcUrl;
  }

  // Priority 3: Public Polygon RPC (has strict rate limits)
  return "https://polygon-rpc.com";
}

/**
 * Get the singleton public client
 */
export function getPublicClient(): PublicClient {
  if (!publicClient) {
    const rpcUrl = getRpcUrl();
    // Hide API key in logs
    publicClient = createPublicClient({
      chain: polygon,
      transport: http(rpcUrl, {
        // Retry configuration
        retryCount: 3,
        retryDelay: 1000,
        timeout: 10000,
      }),
    });
  }
  return publicClient;
}

/**
 * Throttle RPC calls to avoid rate limiting
 */
async function throttleRpc(): Promise<void> {
  const now = Date.now();
  const timeSinceLastCall = now - lastRpcCall;

  if (timeSinceLastCall < MIN_RPC_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_RPC_INTERVAL - timeSinceLastCall)
    );
  }

  lastRpcCall = Date.now();
}

/**
 * Check if an address has deployed contract code
 *
 * @param address - The address to check
 * @param options - Optional configuration
 * @returns Whether the address has contract code
 */
export async function checkIsDeployed(
  address: string,
  options?: { skipCache?: boolean }
): Promise<boolean> {
  const cacheKey = address.toLowerCase();

  // Check cache first
  if (!options?.skipCache) {
    const cached = deploymentCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < DEPLOYMENT_CACHE_TTL) {
      return cached.isDeployed;
    }
  }

  try {
    await throttleRpc();
    const client = getPublicClient();
    const code = await client.getCode({
      address: address as `0x${string}`,
    });

    const isDeployed = code !== undefined && code !== "0x";

    // Update cache
    deploymentCache.set(cacheKey, {
      isDeployed,
      timestamp: Date.now(),
    });

    return isDeployed;
  } catch (err) {
    console.error("[RPC] Failed to check deployment:", err);
    // On error, check cache even if expired
    const cached = deploymentCache.get(cacheKey);
    if (cached) {
      return cached.isDeployed;
    }
    return false;
  }
}

/**
 * Fetch USDC.e balance for an address
 *
 * @param address - The wallet address
 * @param options - Optional configuration
 * @returns The USDC balance as a number
 */
export async function fetchUsdcBalance(
  address: string,
  options?: { skipCache?: boolean }
): Promise<number> {
  const cacheKey = address.toLowerCase();

  // Check cache first
  if (!options?.skipCache) {
    const cached = balanceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_TTL) {
      return cached.balance;
    }
  }

  try {
    await throttleRpc();
    const client = getPublicClient();
    const { formatUnits } = await import("viem");

    const rawBalance = await client.readContract({
      address: USDC_E_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });

    const balance = Number(formatUnits(rawBalance, USDC_E_DECIMALS));

    // Update cache
    balanceCache.set(cacheKey, {
      balance,
      timestamp: Date.now(),
    });

    return balance;
  } catch (err) {
    console.error("[RPC] Failed to fetch USDC balance:", err);
    // On error, return cached value if available
    const cached = balanceCache.get(cacheKey);
    if (cached) {
      return cached.balance;
    }
    return 0;
  }
}

/**
 * Clear the deployment cache for an address
 * Call this after deploying a new Safe
 */
export function clearDeploymentCache(address?: string): void {
  if (address) {
    deploymentCache.delete(address.toLowerCase());
  } else {
    deploymentCache.clear();
  }
}

/**
 * Clear the balance cache for an address
 * Call this after a transaction that changes balance
 */
export function clearBalanceCache(address?: string): void {
  if (address) {
    balanceCache.delete(address.toLowerCase());
  } else {
    balanceCache.clear();
  }
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  deploymentCache.clear();
  balanceCache.clear();
}
