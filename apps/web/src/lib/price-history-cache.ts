import { createLogger } from "@knoww/logger";
import {
  type ClobPriceHistoryParams,
  type ClobPriceHistoryResponse,
  fetchClobPriceHistory,
} from "@knoww/shared-types/clob";

const log = createLogger("price-history-cache");

const CACHE_NAME = "price-history-v1";
const CACHE_ORIGIN = "https://price-history-cache.internal";
const DEFAULT_CACHE_TTL_SECONDS = 60;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 8_000;

interface PriceHistoryCacheOptions {
  cacheTtlSeconds?: number;
  signal?: AbortSignal;
  upstreamTimeoutMs?: number;
}

const inFlight = new Map<string, Promise<ClobPriceHistoryResponse>>();

function cacheKey(tokenId: string, params: ClobPriceHistoryParams): string {
  const url = new URL("/history", CACHE_ORIGIN);
  url.searchParams.set("market", tokenId);
  if (params.startTs !== undefined) {
    url.searchParams.set("startTs", String(params.startTs));
  }
  if (params.endTs !== undefined) {
    url.searchParams.set("endTs", String(params.endTs));
  }
  if (params.fidelity !== undefined) {
    url.searchParams.set("fidelity", String(params.fidelity));
  }
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCachedHistory(value: unknown): ClobPriceHistoryResponse | null {
  if (!isRecord(value) || !Array.isArray(value.history)) return null;

  const validHistory = value.history.every(
    (point) =>
      isRecord(point) &&
      typeof point.t === "number" &&
      Number.isFinite(point.t) &&
      typeof point.p === "number" &&
      Number.isFinite(point.p)
  );
  return validHistory
    ? { history: value.history as ClobPriceHistoryResponse["history"] }
    : null;
}

async function openRegionalCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;

  try {
    return await caches.open(CACHE_NAME);
  } catch (error) {
    log.warn("open.failed", { error });
    return null;
  }
}

async function readRegionalCache(
  cache: Cache | null,
  key: string
): Promise<ClobPriceHistoryResponse | null> {
  if (!cache) return null;

  try {
    const response = await cache.match(key);
    if (!response) return null;
    return parseCachedHistory(await response.json());
  } catch (error) {
    log.warn("read.failed", { error });
    return null;
  }
}

async function writeRegionalCache(
  cache: Cache | null,
  key: string,
  value: ClobPriceHistoryResponse,
  ttlSeconds: number
): Promise<void> {
  if (!cache) return;

  try {
    await cache.put(
      key,
      new Response(JSON.stringify(value), {
        headers: {
          "Cache-Control": `public, max-age=${ttlSeconds}`,
          "Content-Type": "application/json",
        },
      })
    );
  } catch (error) {
    // Cache persistence is best effort. Fresh upstream data must still be
    // returned when a regional cache is unavailable or rejects the write.
    log.warn("write.failed", { error });
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function waitForCaller<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function fetchAndCache(
  cache: Cache | null,
  key: string,
  tokenId: string,
  params: ClobPriceHistoryParams,
  cacheTtlSeconds: number,
  upstreamTimeoutMs: number
): Promise<ClobPriceHistoryResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), upstreamTimeoutMs);

  try {
    const data = await fetchClobPriceHistory(tokenId, params, {
      requestInit: {
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      },
    });
    const value = { history: data.history ?? [] };
    await writeRegionalCache(cache, key, value, cacheTtlSeconds);
    return value;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch price history through Cloudflare's regional Cache API.
 *
 * Next's `next.revalidate` data cache is intentionally bypassed here. OpenNext
 * persists that cache in R2, whose one-write-per-second-per-key limit rejects
 * concurrent refreshes of popular token histories with error 10058. The
 * regional cache is a better fit for this short-lived data, while `inFlight`
 * coalesces identical misses inside the same Worker isolate.
 */
export async function fetchCachedClobPriceHistory(
  tokenId: string,
  params: ClobPriceHistoryParams,
  options: PriceHistoryCacheOptions = {}
): Promise<ClobPriceHistoryResponse> {
  const key = cacheKey(tokenId, params);
  const cache = await openRegionalCache();
  if (options.signal?.aborted) throw abortError(options.signal);
  const cached = await readRegionalCache(cache, key);
  if (options.signal?.aborted) throw abortError(options.signal);
  if (cached) return cached;

  let sharedRequest = inFlight.get(key);
  if (!sharedRequest) {
    sharedRequest = fetchAndCache(
      cache,
      key,
      tokenId,
      params,
      options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
      options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
    );
    inFlight.set(key, sharedRequest);
    void sharedRequest.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key)
    );
  }

  return waitForCaller(sharedRequest, options.signal);
}
