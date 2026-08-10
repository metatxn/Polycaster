import {
  type ClobOrderBook,
  fetchClobOrderBooks,
} from "@knoww/shared-types/clob";
import Decimal from "decimal.js";
import { isAbortLikeError } from "@/lib/fetch-with-timeout";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_ENTRIES = 1_000;

type FetchOrderBooks = (
  tokenIds: readonly string[],
  signal?: AbortSignal
) => Promise<ClobOrderBook[]>;

type LoadPrices = (
  tokenIds: readonly string[],
  signal?: AbortSignal
) => Promise<Map<string, number | null>>;

interface PriceCacheEntry {
  expiresAt: number;
  price: number | null;
}

interface ClobPriceBatchLoaderOptions {
  batchSize?: number;
  fetchOrderBooks?: FetchOrderBooks;
  maxEntries?: number;
  now?: () => number;
  ttlMs?: number;
}

function validPrice(value: string): Decimal | null {
  try {
    const price = new Decimal(value);
    return price.isFinite() && price.gte(0) && price.lte(1) ? price : null;
  } catch {
    return null;
  }
}

export function midpointFromOrderBook(book: ClobOrderBook): number | null {
  const bids = book.bids
    .map((level) => validPrice(level.price))
    .filter((price): price is Decimal => price !== null);
  const asks = book.asks
    .map((level) => validPrice(level.price))
    .filter((price): price is Decimal => price !== null);
  if (bids.length === 0 || asks.length === 0) return null;

  const bestBid = Decimal.max(...bids);
  const bestAsk = Decimal.min(...asks);
  if (bestBid.gt(bestAsk)) return null;

  return bestBid.add(bestAsk).div(2).toNumber();
}

export function resolveReferencePrice(
  prices: ReadonlyMap<string, number | null>,
  assetId: string,
  tradePrice: number
): number {
  const currentPrice = prices.get(assetId);
  return typeof currentPrice === "number" && Number.isFinite(currentPrice)
    ? currentPrice
    : tradePrice;
}

export function createClobPriceBatchLoader(
  options: ClobPriceBatchLoaderOptions = {}
): LoadPrices {
  const batchSize = Math.max(
    1,
    Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE)
  );
  const maxEntries = Math.max(
    1,
    Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES)
  );
  const ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS);
  const now = options.now ?? Date.now;
  const fetchOrderBooks: FetchOrderBooks =
    options.fetchOrderBooks ??
    ((tokenIds, signal) =>
      fetchClobOrderBooks(
        tokenIds,
        signal
          ? {
              useUnifiedSdk: false,
              requestInit: { signal },
            }
          : undefined
      ));
  const cache = new Map<string, PriceCacheEntry>();

  function cachePrice(tokenId: string, price: number | null): void {
    cache.delete(tokenId);
    cache.set(tokenId, { price, expiresAt: now() + ttlMs });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  return async (tokenIds, signal) => {
    const uniqueTokenIds = [...new Set(tokenIds.filter(Boolean))];
    const prices = new Map<string, number | null>();
    const uncached: string[] = [];
    const readAt = now();

    for (const tokenId of uniqueTokenIds) {
      const cached = cache.get(tokenId);
      if (cached && cached.expiresAt > readAt) {
        cache.delete(tokenId);
        cache.set(tokenId, cached);
        prices.set(tokenId, cached.price);
      } else {
        cache.delete(tokenId);
        uncached.push(tokenId);
      }
    }

    for (let index = 0; index < uncached.length; index += batchSize) {
      const batch = uncached.slice(index, index + batchSize);
      let books: ClobOrderBook[] = [];
      try {
        books = signal
          ? await fetchOrderBooks(batch, signal)
          : await fetchOrderBooks(batch);
      } catch (error) {
        if (signal?.aborted || isAbortLikeError(error)) throw error;
        // Preserve the route's existing trade-price fallback on upstream errors.
      }

      const batchIds = new Set(batch);
      const fetched = new Map<string, number | null>();
      for (const orderBook of books) {
        if (!orderBook.asset_id || !batchIds.has(orderBook.asset_id)) continue;
        fetched.set(orderBook.asset_id, midpointFromOrderBook(orderBook));
      }

      for (const tokenId of batch) {
        const price = fetched.get(tokenId) ?? null;
        cachePrice(tokenId, price);
        prices.set(tokenId, price);
      }
    }

    return prices;
  };
}

export const loadCurrentClobPrices = createClobPriceBatchLoader();
