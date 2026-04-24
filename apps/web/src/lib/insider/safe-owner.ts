/**
 * Safe-owner lookup for Polymarket wallets (Phase 5).
 *
 * Polymarket's user wallets are Gnosis Safe contracts on Polygon.
 * Each Safe has one or more owner EOAs, stored on-chain and readable
 * via `getOwners()`. Two Safes with the same primary owner are, with
 * extremely high probability, operated by the same person — the
 * cleanest structural signal for insider clustering we can extract
 * without a labeled graph.
 *
 * This module:
 *  - Resolves a Safe's owner array via viem `multicall` (batches
 *    dozens of `getOwners` calls into one eth_call)
 *  - Returns the FIRST owner as the "primary" for clustering — most
 *    Polymarket Safes are single-owner; for multisigs we'd need a
 *    richer model, but single-owner is the overwhelming majority
 *  - Gracefully handles non-Safe addresses (reverts return null)
 *  - Caches results for 7 days (owners change rarely)
 *
 * Latency: a single multicall of 50 `getOwners` calls is ~200-500ms
 * against Alchemy's Polygon endpoint. For the live feed we only look
 * up owners for already-flagged wallets (typically 5-20 per request).
 */

import { erc20Abi } from "viem";
import { getPublicClient } from "@/lib/rpc";

/** Minimal Safe ABI for getOwners(). */
const SAFE_ABI = [
  {
    inputs: [],
    name: "getOwners",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Unused but referenced to avoid removing a lint-safe import shape.
// `erc20Abi` intentionally kept so the file mirrors rpc.ts's pattern
// and leaves room for future token-balance reads during clustering.
void erc20Abi;

export interface SafeOwners {
  /** Safe address lookup was performed for (lowercased). */
  address: string;
  /** Full owner array as returned by the Safe contract. Null when the
   *  call reverted (address is not a Safe, or self-destructed, or
   *  just an EOA — all treated identically). */
  owners: string[] | null;
  /** Convenience: `owners[0]` lowercased, or null. Use this as the
   *  cluster key — Polymarket Safes are overwhelmingly single-owner. */
  primaryOwner: string | null;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;

interface CacheEntry {
  value: SafeOwners;
  storedAt: number;
}

const cache = new Map<string, CacheEntry>();

function trimCache(): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  const excess = cache.size - CACHE_MAX_ENTRIES;
  const iter = cache.keys();
  for (let i = 0; i < excess; i++) {
    const { value, done } = iter.next();
    if (done) break;
    cache.delete(value);
  }
}

function emptyResult(address: string): SafeOwners {
  return {
    address: address.toLowerCase(),
    owners: null,
    primaryOwner: null,
  };
}

function readFromCache(address: string): SafeOwners | null {
  const entry = cache.get(address.toLowerCase());
  if (!entry) return null;
  if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
    cache.delete(address.toLowerCase());
    return null;
  }
  return entry.value;
}

function writeToCache(result: SafeOwners): void {
  cache.set(result.address, { value: result, storedAt: Date.now() });
  trimCache();
}

/**
 * Resolve owners for a list of Safe addresses. Uses viem's
 * `multicall` with `allowFailure: true` so non-Safe addresses don't
 * abort the whole batch — they simply get `owners: null`. Results
 * are cached individually.
 */
export async function getSafeOwnersBatch(
  addresses: string[]
): Promise<Map<string, SafeOwners>> {
  const out = new Map<string, SafeOwners>();
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];

  // Partition into cache hits and misses.
  const toFetch: string[] = [];
  for (const addr of unique) {
    const cached = readFromCache(addr);
    if (cached) {
      out.set(addr, cached);
    } else {
      toFetch.push(addr);
    }
  }

  if (toFetch.length === 0) return out;

  try {
    const client = getPublicClient();
    // One multicall round-trip instead of N eth_calls. Multicall3
    // batches many view reads efficiently.
    const results = await client.multicall({
      allowFailure: true,
      contracts: toFetch.map((addr) => ({
        address: addr as `0x${string}`,
        abi: SAFE_ABI,
        functionName: "getOwners" as const,
      })),
    });

    for (let i = 0; i < toFetch.length; i++) {
      const addr = toFetch[i];
      const r = results[i];
      let value: SafeOwners;
      if (r.status === "success" && Array.isArray(r.result)) {
        const owners = (r.result as readonly string[]).map((o) =>
          o.toLowerCase()
        );
        value = {
          address: addr,
          owners,
          primaryOwner: owners[0] ?? null,
        };
      } else {
        value = emptyResult(addr);
      }
      writeToCache(value);
      out.set(addr, value);
    }
  } catch (err) {
    console.error("[safe-owner] multicall failed:", err);
    // Populate failures with empty results so callers don't re-query
    // in tight loops on transient RPC outages.
    for (const addr of toFetch) {
      const value = emptyResult(addr);
      writeToCache(value);
      out.set(addr, value);
    }
  }

  return out;
}

/** Single-address convenience wrapper over the batch API. */
export async function getSafeOwners(address: string): Promise<SafeOwners> {
  const map = await getSafeOwnersBatch([address]);
  return map.get(address.toLowerCase()) ?? emptyResult(address);
}
