/**
 * Wallet funding-source lookup via Alchemy `alchemy_getAssetTransfers`.
 *
 * For a given Polygon wallet, find the address that funded it first
 * (any ERC-20 or native MATIC transfer IN). The first-funder is the
 * wallet's on-chain anchor — if two wallets share the same first-
 * funder, they're very likely controlled by the same operator, which
 * is the strongest insider-clustering signal we can extract without
 * a labeled graph.
 *
 * Used by the Phase 4 `funding_cluster` archetype, which fires only
 * when the category-specialist archetype has already fired AND the
 * funding data reveals either a self-custody first-funder or a
 * shared-funder cluster with other specialist-firing wallets.
 *
 * Rate-limited at the Alchemy layer — the free tier (300M CU/mo) is
 * enormously in excess of what a single backtest run needs (~5-10
 * lookups per run, each costing ~150 CU).
 */

import { createLogger } from "@knoww/logger";
import { classifyFunder, type FunderCategory } from "@/constants/cex-addresses";

const log = createLogger("insider.funding-source");

export interface WalletFunding {
  /** Original (mixed-case) address that was looked up. Always lowercased in
   *  cache keys and in the `firstFunderAddress` field. */
  address: string;
  /** Address of the first inbound transfer sender, or null if we
   *  couldn't find one (new wallet with no history, or Alchemy
   *  returned empty). Always lowercased. */
  firstFunderAddress: string | null;
  /** Classification of firstFunderAddress (CEX / bridge / self-custody / unknown). */
  firstFunderCategory: FunderCategory;
  /** Unix seconds of the first inbound transfer, or null if unavailable. */
  firstFundingTimestamp: number | null;
}

/** 7 days — funding history is immutable once set. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Guard against unbounded memory growth across long-running servers. */
const CACHE_MAX_ENTRIES = 2000;

interface CachedFunding {
  value: WalletFunding;
  storedAt: number;
}

const cache = new Map<string, CachedFunding>();

function getAlchemyUrl(): string | null {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return null;
  return `https://polygon-mainnet.g.alchemy.com/v2/${key}`;
}

interface AlchemyTransfer {
  from?: string;
  to?: string;
  hash?: string;
  value?: number | null;
  asset?: string | null;
  category?: string;
  blockNum?: string;
  metadata?: { blockTimestamp?: string };
}

interface AlchemyResponse {
  result?: { transfers?: AlchemyTransfer[] };
  error?: { code: number; message: string };
}

async function fetchFirstTransfers(
  address: string
): Promise<AlchemyTransfer[] | null> {
  const url = getAlchemyUrl();
  if (!url) return null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getAssetTransfers",
        params: [
          {
            toAddress: address,
            category: ["external", "erc20"],
            order: "asc",
            maxCount: "0x5",
            withMetadata: true,
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as AlchemyResponse;
    if (data.error) {
      log.error("alchemy.error", { message: data.error.message });
      return null;
    }
    const transfers = data.result?.transfers;
    return Array.isArray(transfers) ? transfers : [];
  } catch (err) {
    log.error("fetch.failed", { error: err });
    return null;
  }
}

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

function emptyFunding(address: string): WalletFunding {
  return {
    address: address.toLowerCase(),
    firstFunderAddress: null,
    firstFunderCategory: "unknown",
    firstFundingTimestamp: null,
  };
}

/**
 * Look up a single wallet's first-funder. Cached for 7 days.
 * Returns an "unknown"-category record if Alchemy is unavailable or
 * the wallet has no inbound history, so callers don't need to
 * null-check.
 */
export async function getWalletFunding(
  address: string
): Promise<WalletFunding> {
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.storedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const transfers = await fetchFirstTransfers(address);
  if (!transfers || transfers.length === 0) {
    const empty = emptyFunding(address);
    cache.set(key, { value: empty, storedAt: Date.now() });
    trimCache();
    return empty;
  }

  // Take the first transfer with a positive value — Alchemy sometimes
  // returns zero-value txs for contract-interaction edges that aren't
  // real funding. Falls back to the first transfer if none qualify.
  const first = transfers.find((t) => (t.value ?? 0) > 0) ?? transfers[0];
  const funder = first.from ? first.from.toLowerCase() : null;
  const ts = first.metadata?.blockTimestamp
    ? Math.floor(new Date(first.metadata.blockTimestamp).getTime() / 1000)
    : null;

  const value: WalletFunding = {
    address: key,
    firstFunderAddress: funder,
    firstFunderCategory: classifyFunder(funder),
    firstFundingTimestamp: Number.isFinite(ts as number) ? ts : null,
  };

  cache.set(key, { value, storedAt: Date.now() });
  trimCache();
  return value;
}

/**
 * Batch-fetch funding for a list of wallets. Deduplicates addresses
 * by lowercase before hitting Alchemy. Bounded concurrency to keep
 * the upstream RPC comfortable — 4 in flight is plenty for backtest
 * workloads where we typically only have 5-10 specialist wallets to
 * look up per run.
 */
export async function getWalletFundingBatch(
  addresses: string[],
  concurrency = 4
): Promise<Map<string, WalletFunding>> {
  const out = new Map<string, WalletFunding>();
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((a) => getWalletFunding(a)));
    for (const r of results) out.set(r.address, r);
  }
  return out;
}
