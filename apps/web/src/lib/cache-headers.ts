/**
 * Cache Headers Utility for Cloudflare Workers
 *
 * Cloudflare Workers use the Cache-Control header to determine how to cache
 * responses at the edge. This utility provides consistent cache headers
 * for different types of data.
 *
 * Key concepts:
 * - s-maxage: Cache lifetime at CDN/edge (Cloudflare)
 * - max-age: Cache lifetime in browser
 * - stale-while-revalidate: Serve stale content while fetching fresh
 * - stale-if-error: Serve stale content if origin fails
 */

export type CacheProfile =
  | "static" // Long-lived data (tags, categories)
  | "events" // Event data (1 minute)
  | "realtime" // Price data, order books (10 seconds)
  | "user" // User-specific data (no cache)
  | "leaderboard" // Leaderboard data (1 minute)
  | "priceHistory" // Historical price data (5 minutes)
  | "search"; // Search results (30 seconds, aligns with upstream fetch revalidate)

interface CacheConfig {
  maxAge: number; // Browser cache (seconds)
  sMaxAge: number; // CDN/Edge cache (seconds)
  staleWhileRevalidate: number;
  staleIfError: number;
  isPrivate: boolean;
}

/**
 * Shared cache config for minute-level caching (events, leaderboard)
 * Intentionally duplicated to allow future divergence between profiles
 */
const MINUTE_CACHE: Omit<CacheConfig, "isPrivate"> = {
  maxAge: 30, // 30 seconds in browser
  sMaxAge: 60, // 1 minute at edge
  staleWhileRevalidate: 120, // 2 minutes
  staleIfError: 300, // 5 minutes
};

const CACHE_PROFILES: Record<CacheProfile, CacheConfig> = {
  static: {
    maxAge: 300, // 5 minutes in browser
    sMaxAge: 3600, // 1 hour at edge
    staleWhileRevalidate: 86400, // 24 hours
    staleIfError: 86400, // 24 hours
    isPrivate: false,
  },
  events: {
    ...MINUTE_CACHE,
    isPrivate: false,
  },
  realtime: {
    maxAge: 5, // 5 seconds in browser
    sMaxAge: 10, // 10 seconds at edge
    staleWhileRevalidate: 30, // 30 seconds
    staleIfError: 60, // 1 minute
    isPrivate: false,
  },
  leaderboard: {
    ...MINUTE_CACHE,
    isPrivate: false,
  },
  priceHistory: {
    maxAge: 120, // 2 minutes in browser
    sMaxAge: 300, // 5 minutes at edge
    staleWhileRevalidate: 600, // 10 minutes
    staleIfError: 1800, // 30 minutes
    isPrivate: false,
  },
  user: {
    maxAge: 0,
    sMaxAge: 0,
    staleWhileRevalidate: 0,
    staleIfError: 0,
    isPrivate: true, // User data should never be cached at edge
  },
  search: {
    maxAge: 15, // 15 seconds in browser
    sMaxAge: 30, // 30 seconds at edge (aligns with upstream fetch revalidate: 30)
    staleWhileRevalidate: 60, // 1 minute
    staleIfError: 120, // 2 minutes
    isPrivate: false,
  },
};

/**
 * Get cache headers for a specific profile
 */
export function getCacheHeaders(profile: CacheProfile): HeadersInit {
  const config = CACHE_PROFILES[profile];

  if (config.isPrivate) {
    return {
      "Cache-Control": "private, no-store, must-revalidate",
    };
  }

  return {
    "Cache-Control": [
      "public",
      `max-age=${config.maxAge}`,
      `s-maxage=${config.sMaxAge}`,
      `stale-while-revalidate=${config.staleWhileRevalidate}`,
      `stale-if-error=${config.staleIfError}`,
    ].join(", "),
    // Cloudflare-specific header for edge caching
    "CDN-Cache-Control": `max-age=${config.sMaxAge}`,
  };
}

/**
 * Create a cached JSON response
 * Only applies cache headers for successful responses (status < 400)
 * Error responses use no-store to prevent caching
 */
export function cachedJsonResponse(
  data: unknown,
  profile: CacheProfile,
  status = 200
): Response {
  const isError = status >= 400;

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(isError
        ? { "Cache-Control": "no-store, no-cache, must-revalidate" }
        : getCacheHeaders(profile)),
    },
  });
}

/**
 * Add cache headers to an existing Header Object
 */
export function addCacheHeaders(headers: Headers, profile: CacheProfile): void {
  const cacheHeaders = getCacheHeaders(profile);
  for (const [key, value] of Object.entries(cacheHeaders)) {
    headers.set(key, value);
  }
}
