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
import {
  PUSD_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "@/constants/contracts";

const DEPLOYMENT_CACHE_TTL = 5 * 60 * 1000;
const BALANCE_CACHE_TTL = 30 * 1000;
const CACHE_MAX_ENTRIES = 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

let publicClient: PublicClient | null = null;

interface TimedCacheEntry<T> {
  timestamp: number;
  value: T;
}

interface BoundedCache<T> {
  map: Map<string, TimedCacheEntry<T>>;
  ttlMs: number;
  maxEntries: number;
}

const deploymentCache: BoundedCache<boolean> = {
  map: new Map(),
  ttlMs: DEPLOYMENT_CACHE_TTL,
  maxEntries: CACHE_MAX_ENTRIES,
};

const balanceCache: BoundedCache<number> = {
  map: new Map(),
  ttlMs: BALANCE_CACHE_TTL,
  maxEntries: CACHE_MAX_ENTRIES,
};

let lastRpcCall = 0;
const MIN_RPC_INTERVAL = 100;

let lastSweepTime = 0;

function sweepExpired<T>(cache: BoundedCache<T>): void {
  const now = Date.now();
  const staleKeys: string[] = [];
  for (const [key, entry] of cache.map) {
    if (now - entry.timestamp > cache.ttlMs) {
      staleKeys.push(key);
    }
  }
  for (const key of staleKeys) {
    cache.map.delete(key);
  }
}

function trimToMax<T>(cache: BoundedCache<T>): void {
  if (cache.map.size <= cache.maxEntries) return;
  const excess = cache.map.size - cache.maxEntries;
  const iter = cache.map.keys();
  for (let i = 0; i < excess; i++) {
    const { value: key, done } = iter.next();
    if (done) break;
    cache.map.delete(key);
  }
}

function maybeSweepAll(): void {
  const now = Date.now();
  if (now - lastSweepTime < SWEEP_INTERVAL_MS) return;
  lastSweepTime = now;
  sweepExpired(deploymentCache);
  sweepExpired(balanceCache);
}

function getCachedValue<T>(
  cache: BoundedCache<T>,
  key: string,
  allowExpired = false
): T | null {
  const cached = cache.map.get(key);

  maybeSweepAll();

  if (!cached) return null;

  const expired = Date.now() - cached.timestamp > cache.ttlMs;

  if (expired && !allowExpired) {
    cache.map.delete(key);
    return null;
  }

  // If the sweep removed this entry from the map but we're serving it
  // as a stale fallback, re-insert it so subsequent fallback reads
  // during the same upstream outage can still find it.
  if (expired && allowExpired && !cache.map.has(key)) {
    cache.map.set(key, cached);
  }

  return cached.value;
}

function setCachedValue<T>(
  cache: BoundedCache<T>,
  key: string,
  value: T
): void {
  cache.map.delete(key);
  cache.map.set(key, { value, timestamp: Date.now() });
  trimToMax(cache);
  maybeSweepAll();
}

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

  if (!options?.skipCache) {
    const cached = getCachedValue(deploymentCache, cacheKey);
    if (cached !== null) return cached;
  }

  try {
    await throttleRpc();
    const client = getPublicClient();
    const code = await client.getCode({
      address: address as `0x${string}`,
    });

    const isDeployed = code !== undefined && code !== "0x";

    setCachedValue(deploymentCache, cacheKey, isDeployed);

    return isDeployed;
  } catch (err) {
    console.error("[RPC] Failed to check deployment:", err);
    const stale = getCachedValue(deploymentCache, cacheKey, true);
    return stale ?? false;
  }
}

/**
 * Fetch the Safe proxy's effective V2 trading balance.
 *
 * Polymarket V2 settles trades in pUSD, but a Safe can also hold legacy
 * USDC.e that `CollateralOnramp.wrap()` converts to pUSD on demand (e.g.
 * during a BUY). Users think of the sum as "money on Polymarket", so we
 * return `pUSD + USDC.e`.
 *
 * Callers that specifically need pUSD-only (withdrawal via bridge requires
 * real pUSD on the Safe) should read `PUSD_ADDRESS` directly — not through
 * this helper.
 *
 * @param address - Safe proxy address
 * @param options - Optional configuration
 * @returns Combined pUSD + USDC.e balance as a number (USD-scaled)
 */
export async function fetchUsdcBalance(
  address: string,
  options?: { skipCache?: boolean }
): Promise<number> {
  const cacheKey = address.toLowerCase();

  if (!options?.skipCache) {
    const cached = getCachedValue(balanceCache, cacheKey);
    if (cached !== null) return cached;
  }

  try {
    await throttleRpc();
    const client = getPublicClient();
    const { formatUnits } = await import("viem");

    // One multicall round-trip instead of two parallel eth_calls.
    const [pusdResult, usdcEResult] = await client.multicall({
      allowFailure: true,
      contracts: [
        {
          address: PUSD_ADDRESS as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        },
        {
          address: USDC_E_ADDRESS as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        },
      ],
    });

    const rawPusd =
      pusdResult.status === "success"
        ? (pusdResult.result as bigint)
        : BigInt(0);
    const rawUsdcE =
      usdcEResult.status === "success"
        ? (usdcEResult.result as bigint)
        : BigInt(0);
    const pusd = Number(formatUnits(rawPusd, PUSD_DECIMALS));
    const usdcE = Number(formatUnits(rawUsdcE, USDC_E_DECIMALS));
    const balance = pusd + usdcE;

    setCachedValue(balanceCache, cacheKey, balance);

    return balance;
  } catch (err) {
    console.error("[RPC] Failed to fetch trading balance:", err);
    const stale = getCachedValue(balanceCache, cacheKey, true);
    return stale ?? 0;
  }
}

/**
 * Clear the deployment cache for an address
 * Call this after deploying a new Safe
 */
export function clearDeploymentCache(address?: string): void {
  if (address) {
    deploymentCache.map.delete(address.toLowerCase());
  } else {
    deploymentCache.map.clear();
  }
}

/**
 * Clear the balance cache for an address
 * Call this after a transaction that changes balance
 */
export function clearBalanceCache(address?: string): void {
  if (address) {
    balanceCache.map.delete(address.toLowerCase());
  } else {
    balanceCache.map.clear();
  }
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  deploymentCache.map.clear();
  balanceCache.map.clear();
}
