import { createLogger } from "@knoww/logger";
import {
  buildEmptySearchResponse,
  DEFAULT_SEARCH_LIMIT,
  fetchAggregatedSearchData,
  MAX_SEARCH_LIMIT,
  type SearchResponseData,
} from "@knoww/services";
import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import {
  extensionCorsHeaders,
  handleExtensionPreflight,
} from "@/lib/extension-auth";
import { normalizeTagSlug } from "@/lib/tag-slugs";
import { sanitizeSearchQuery } from "@/lib/validation";

const log = createLogger("api.search");

const SEARCH_CACHE_TTL_MS = 30 * 1000;
const SEARCH_CACHE_STALE_TTL_MS = 2 * 60 * 1000;
const SEARCH_CACHE_DEGRADED_TTL_MS = 15 * 1000;
const SEARCH_UPSTREAM_FAILURE_STATUS = 502;
const MAX_TAG_SLUGS = 2;

interface SearchCacheEntry {
  data: SearchResponseData;
  expiresAt: number;
  staleUntil: number;
}

const searchCache = new Map<string, SearchCacheEntry>();
const inFlightSearches = new Map<string, Promise<SearchResponseData>>();

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_SEARCH_LIMIT);
}

function parseTagSlugs(value: string | null): string[] {
  if (!value) return [];

  const seen = new Set<string>();
  const slugs: string[] = [];

  for (const rawSlug of value.split(",")) {
    const slug = normalizeTagSlug(rawSlug).replace(/[^a-z0-9-]/g, "");
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
    if (slugs.length >= MAX_TAG_SLUGS) break;
  }

  return slugs;
}

function buildCacheKey(
  query: string,
  limit: number,
  tagSlugs: string[]
): string {
  return JSON.stringify({
    query: query.trim().toLowerCase().replace(/\s+/g, " "),
    limit,
    tagSlugs,
  });
}

function readFreshCache(
  key: string,
  now = Date.now()
): SearchResponseData | null {
  const entry = searchCache.get(key);
  if (!entry || entry.expiresAt <= now) return null;
  return entry.data;
}

function readStaleCache(
  key: string,
  now = Date.now()
): SearchResponseData | null {
  const entry = searchCache.get(key);
  if (!entry || entry.staleUntil <= now) return null;
  return entry.data;
}

function writeSearchCache(key: string, data: SearchResponseData): void {
  const now = Date.now();
  const ttl = data.degraded
    ? SEARCH_CACHE_DEGRADED_TTL_MS
    : SEARCH_CACHE_TTL_MS;
  searchCache.set(key, {
    data,
    expiresAt: now + ttl,
    staleUntil: now + SEARCH_CACHE_STALE_TTL_MS,
  });

  if (searchCache.size > 200) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) searchCache.delete(oldestKey);
  }
}

function createSearchHeaders(
  cacheState: "MISS" | "HIT" | "STALE",
  degraded = false,
  corsHeaders: Record<string, string> = {}
): Headers {
  const headers = new Headers(getCacheHeaders("search"));
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  headers.set("X-Knoww-Search-Cache", cacheState);
  if (degraded) {
    headers.set("X-Knoww-Search-Degraded", "true");
    headers.set(
      "Cache-Control",
      "public, max-age=5, s-maxage=15, stale-while-revalidate=30, stale-if-error=60"
    );
  }
  return headers;
}

function getSearchResponseStatus(data: SearchResponseData): number {
  return data.degraded ? SEARCH_UPSTREAM_FAILURE_STATUS : 200;
}

function applyExtensionCorsHeaders(
  response: NextResponse,
  corsHeaders: Record<string, string>
): NextResponse {
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

async function getSearchData(
  key: string,
  query: string,
  limit: number,
  tagSlugs: string[]
): Promise<SearchResponseData> {
  const existing = inFlightSearches.get(key);
  if (existing) return existing;

  const request = fetchAggregatedSearchData(query, limit, tagSlugs).finally(
    () => {
      inFlightSearches.delete(key);
    }
  );
  inFlightSearches.set(key, request);
  return request;
}

/**
 * Search markets, events, and profiles using Polymarket's public search API
 * @see https://docs.polymarket.com/api-reference/search/search-markets-events-and-profiles
 */
/**
 * @openapi
 * /api/search:
 *   get:
 *     summary: Fetch /api/search.
 *     tags: [Search]
 *     responses:
 *       200:
 *         description: Successful response.
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Request forbidden.
 *       404:
 *         description: Resource not found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Request failed.
 *       502:
 *         description: Upstream search provider failed.
 */
export async function OPTIONS(request: NextRequest) {
  return handleExtensionPreflight(request);
}

export async function GET(request: NextRequest) {
  const corsHeaders = extensionCorsHeaders(request);

  // Rate limit: 60 searches per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) {
    return applyExtensionCorsHeaders(rateLimitResponse, corsHeaders);
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get("q") || searchParams.get("query") || "";
    const query = sanitizeSearchQuery(rawQuery);
    const limit = parseLimit(searchParams.get("limit"));
    const tagSlugs = parseTagSlugs(
      searchParams.get("tag_slugs") || searchParams.get("tags")
    );

    if (!query.trim() && tagSlugs.length === 0) {
      // Return empty results with same edge caching headers as successful responses
      return NextResponse.json(buildEmptySearchResponse(), {
        headers: createSearchHeaders("MISS", false, corsHeaders),
      });
    }

    const cacheKey = buildCacheKey(query, limit, tagSlugs);
    const cached = readFreshCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        status: getSearchResponseStatus(cached),
        headers: createSearchHeaders("HIT", cached.degraded, corsHeaders),
      });
    }

    const data = await getSearchData(cacheKey, query, limit, tagSlugs);
    const stale = readStaleCache(cacheKey);
    if (data.degraded && stale && stale.events.length > data.events.length) {
      const staleData = { ...stale, degraded: true };
      return NextResponse.json(staleData, {
        status: getSearchResponseStatus(staleData),
        headers: createSearchHeaders("STALE", true, corsHeaders),
      });
    }

    writeSearchCache(cacheKey, data);

    // Cache search results at edge with TTL aligned to upstream fetch revalidate (30s)
    return NextResponse.json(data, {
      status: getSearchResponseStatus(data),
      headers: createSearchHeaders("MISS", data.degraded, corsHeaders),
    });
  } catch (error) {
    log.error("fetch.failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(buildEmptySearchResponse(true), {
      status: 500,
      headers: createSearchHeaders("MISS", true, corsHeaders),
    });
  }
}
