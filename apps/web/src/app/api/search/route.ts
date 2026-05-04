import { createLogger } from "@knoww/logger";
import {
  parseGammaNumberArray,
  parseGammaStringArray,
} from "@knoww/shared-types/polymarket";
import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { normalizeTagSlug } from "@/lib/tag-slugs";
import { sanitizeSearchQuery } from "@/lib/validation";

const log = createLogger("api.search");

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const SEARCH_CACHE_TTL_MS = 30 * 1000;
const SEARCH_CACHE_STALE_TTL_MS = 2 * 60 * 1000;
const SEARCH_CACHE_DEGRADED_TTL_MS = 15 * 1000;
const SEARCH_UPSTREAM_TIMEOUT_MS = 8500;
const MAX_TAG_SLUGS = 2;
const MAX_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 10;

interface TopOutcome {
  name: string;
  price: number;
}

interface Market {
  id: string;
  question?: string;
  outcomes?: string | string[];
  outcomePrices?: string | number[];
  groupItemTitle?: string;
}

interface SearchEvent {
  id: string;
  slug?: string;
  title: string;
  description?: string;
  image?: string;
  icon?: string;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  active?: boolean;
  closed?: boolean;
  live?: boolean;
  ended?: boolean;
  competitive?: number;
  markets?: Market[];
  topOutcome?: TopOutcome;
  _source?: "search" | "tag";
}

interface SearchResponseData {
  events: SearchEvent[];
  tags: unknown[];
  profiles: unknown[];
  pagination: { hasMore: boolean; totalResults: number };
  degraded?: boolean;
}

interface SearchCacheEntry {
  data: SearchResponseData;
  expiresAt: number;
  staleUntil: number;
}

const searchCache = new Map<string, SearchCacheEntry>();
const inFlightSearches = new Map<string, Promise<SearchResponseData>>();

class UpstreamSearchError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "UpstreamSearchError";
  }
}

function buildEmptySearchResponse(degraded = false): SearchResponseData {
  return {
    events: [],
    tags: [],
    profiles: [],
    pagination: { hasMore: false, totalResults: 0 },
    ...(degraded ? { degraded: true } : {}),
  };
}

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
  degraded = false
): Headers {
  const headers = new Headers(getCacheHeaders("search"));
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

function parseEventsPayload(payload: unknown): SearchEvent[] {
  if (Array.isArray(payload)) {
    return payload as SearchEvent[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const wrapper = payload as {
    data?: unknown;
    events?: unknown;
  };

  if (Array.isArray(wrapper.events)) {
    return wrapper.events as SearchEvent[];
  }

  if (Array.isArray(wrapper.data)) {
    return wrapper.data as SearchEvent[];
  }

  return [];
}

/**
 * Extract the top outcome (leading position) from an event's markets
 * For multi-outcome markets (like "La Liga Winner"), finds the highest priced outcome
 * For Yes/No markets, returns the "Yes" outcome price
 */
function getTopOutcome(markets: Market[]): TopOutcome | undefined {
  if (!markets || markets.length === 0) return undefined;

  let topOutcome: TopOutcome | undefined;
  let highestPrice = 0;

  for (const market of markets) {
    try {
      // Parse outcomes and prices from JSON strings
      const outcomes = parseGammaStringArray(market.outcomes);
      const prices = parseGammaNumberArray(market.outcomePrices);

      if (outcomes.length === 0 || prices.length === 0) continue;

      // For Yes/No markets, we want the "Yes" price
      const isYesNoMarket =
        outcomes.length === 2 &&
        outcomes.some((o) => o.toLowerCase() === "yes") &&
        outcomes.some((o) => o.toLowerCase() === "no");

      for (let i = 0; i < outcomes.length && i < prices.length; i++) {
        const price = prices[i];
        const outcomeName = outcomes[i];

        // Skip "No" outcomes for Yes/No markets
        if (isYesNoMarket && outcomeName.toLowerCase() === "no") {
          continue;
        }

        if (price > highestPrice) {
          highestPrice = price;
          // Use groupItemTitle if available (for grouped markets like team names)
          topOutcome = {
            name: market.groupItemTitle || outcomeName,
            price: price,
          };
        }
      }
    } catch {}
  }

  return topOutcome;
}

function withTopOutcomes(events: SearchEvent[]): SearchEvent[] {
  return events.map((event) => {
    if (!event.markets || event.markets.length === 0) return event;

    const topOutcome = getTopOutcome(event.markets);
    return topOutcome ? { ...event, topOutcome } : event;
  });
}

function mergeEvents(
  searchEvents: SearchEvent[],
  tagEvents: SearchEvent[],
  limit: number
): SearchEvent[] {
  const seen = new Set<string>();
  const merged: SearchEvent[] = [];

  for (const event of [...searchEvents, ...tagEvents]) {
    if (event.closed === true || event.active === false) continue;

    const key = event.id || event.slug || event.title;
    if (!key || seen.has(key)) continue;

    seen.add(key);
    merged.push(event);
  }

  return withTopOutcomes(merged)
    .sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0))
    .slice(0, limit);
}

async function fetchJsonFromGamma(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    SEARCH_UPSTREAM_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new UpstreamSearchError(
        `Gamma search request failed with ${response.status}`,
        response.status
      );
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPublicSearchEvents(
  query: string,
  limit: number
): Promise<{
  events: SearchEvent[];
  tags: unknown[];
  profiles: unknown[];
  pagination: { hasMore: boolean; totalResults: number };
}> {
  if (!query.trim()) {
    return {
      events: [],
      tags: [],
      profiles: [],
      pagination: { hasMore: false, totalResults: 0 },
    };
  }

  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  params.set("limit_per_type", String(Math.min(limit, 10)));
  params.set("cache", "true");
  params.set("search_tags", "true");
  params.set("optimized", "true");
  params.set("events_status", "active");
  params.set("keep_closed_markets", "0");
  params.set("closed", "false");

  const payload = (await fetchJsonFromGamma(
    `${GAMMA_API_BASE}/public-search?${params.toString()}`
  )) as {
    events?: SearchEvent[];
    tags?: unknown[];
    profiles?: unknown[];
    pagination?: { hasMore: boolean; totalResults: number };
  };

  return {
    events: (payload.events || []).map((event) => ({
      ...event,
      _source: event._source || "search",
    })),
    tags: payload.tags || [],
    profiles: payload.profiles || [],
    pagination: payload.pagination || {
      hasMore: false,
      totalResults: payload.events?.length || 0,
    },
  };
}

async function fetchTagEvents(tagSlug: string): Promise<SearchEvent[]> {
  const params = new URLSearchParams();
  params.set("tag_slug", tagSlug);
  params.set("closed", "false");
  params.set("limit", "5");
  params.set("order", "volume24hr");
  params.set("ascending", "false");

  const payload = await fetchJsonFromGamma(
    `${GAMMA_API_BASE}/events/keyset?${params.toString()}`
  );

  return parseEventsPayload(payload).map((event) => ({
    ...event,
    _source: event._source || "tag",
  }));
}

async function fetchAggregatedSearchData(
  query: string,
  limit: number,
  tagSlugs: string[]
): Promise<SearchResponseData> {
  let degraded = false;

  const publicSearchRequest = fetchPublicSearchEvents(query, limit).catch(
    (error) => {
      degraded = true;
      log.warn("public_search.upstream_failed", {
        error: error instanceof Error ? error.message : String(error),
        status: error instanceof UpstreamSearchError ? error.status : undefined,
      });
      return {
        events: [],
        tags: [],
        profiles: [],
        pagination: { hasMore: false, totalResults: 0 },
      };
    }
  );

  const tagResultsRequest = Promise.all(
    tagSlugs.map((tagSlug) =>
      fetchTagEvents(tagSlug).catch((error) => {
        degraded = true;
        log.warn("tag_search.upstream_failed", {
          tagSlug,
          error: error instanceof Error ? error.message : String(error),
          status:
            error instanceof UpstreamSearchError ? error.status : undefined,
        });
        return [];
      })
    )
  );
  const [publicSearch, tagResults] = await Promise.all([
    publicSearchRequest,
    tagResultsRequest,
  ]);

  const tagEvents = tagResults.flat();
  const events = mergeEvents(publicSearch.events, tagEvents, limit);

  return {
    events,
    tags: publicSearch.tags,
    profiles: publicSearch.profiles,
    pagination: {
      ...publicSearch.pagination,
      totalResults: Math.max(
        publicSearch.pagination.totalResults,
        events.length
      ),
    },
    ...(degraded ? { degraded: true } : {}),
  };
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
export async function GET(request: NextRequest) {
  // Rate limit: 60 searches per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

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
        headers: getCacheHeaders("search"),
      });
    }

    const cacheKey = buildCacheKey(query, limit, tagSlugs);
    const cached = readFreshCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: createSearchHeaders("HIT", cached.degraded),
      });
    }

    const data = await getSearchData(cacheKey, query, limit, tagSlugs);
    const stale = readStaleCache(cacheKey);
    if (data.degraded && stale && stale.events.length > data.events.length) {
      const staleData = { ...stale, degraded: true };
      return NextResponse.json(staleData, {
        headers: createSearchHeaders("STALE", true),
      });
    }

    writeSearchCache(cacheKey, data);

    // Cache search results at edge with TTL aligned to upstream fetch revalidate (30s)
    return NextResponse.json(data, {
      headers: createSearchHeaders("MISS", data.degraded),
    });
  } catch (error) {
    log.error("fetch.failed", { error });
    return NextResponse.json(buildEmptySearchResponse(true), {
      headers: createSearchHeaders("MISS", true),
    });
  }
}
