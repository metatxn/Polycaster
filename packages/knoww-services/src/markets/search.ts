import { createLogger } from "@knoww/logger";
import { parseGammaStringArray } from "@knoww/shared-types/polymarket";
import Decimal from "decimal.js";
import { z } from "zod";
import { UpstreamSearchError } from "../errors";
import {
  type ServiceFetchOptions,
  withUpstreamTimeout,
} from "../fetch-options";
import {
  gammaProbabilityArraySchema,
  gammaStringArraySchema,
  gammaTimestampSchema,
} from "../validation";

const log = createLogger("services.search");

export const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 20;
const SEARCH_UPSTREAM_TIMEOUT_MS = 8500;

export interface TopOutcome {
  name: string;
  price: number;
}

export interface ExactTopOutcome {
  name: string;
  price: string;
}

export interface Market {
  id?: string;
  slug?: string;
  question?: string;
  outcomes?: string | string[];
  outcomePrices?: string | (string | number)[];
  groupItemTitle?: string;
}

export interface SearchEvent {
  id: string;
  slug?: string;
  title: string;
  description?: string;
  image?: string;
  icon?: string;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  live?: boolean;
  ended?: boolean;
  competitive?: number;
  markets?: Market[];
  topOutcome?: TopOutcome;
  _source?: "search" | "tag";
}

export interface SearchResponseData {
  events: SearchEvent[];
  tags: unknown[];
  profiles: unknown[];
  pagination: { hasMore: boolean; totalResults: number };
  degraded?: boolean;
  truncated?: boolean;
}

export interface TagEventsResult {
  events: SearchEvent[];
  truncated: boolean;
}

export interface SearchFetchOptions extends ServiceFetchOptions {
  /** Request complete nested market records, including stable market IDs. */
  fullMarketRecords?: boolean;
}

const marketSchema = z
  .object({
    id: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    question: z.string().optional(),
    outcomes: gammaStringArraySchema.optional(),
    outcomePrices: gammaProbabilityArraySchema.optional(),
    groupItemTitle: z.string().optional(),
  })
  .passthrough()
  .superRefine((market, context) => {
    if (market.id === undefined && market.slug === undefined) {
      context.addIssue({
        code: "custom",
        message: "Market must include an id or slug",
      });
    }
    if (market.outcomes === undefined || market.outcomePrices === undefined) {
      return;
    }
    if (
      parseGammaStringArray(market.outcomes).length !==
      parseGammaStringArray(market.outcomePrices).length
    ) {
      context.addIssue({
        code: "custom",
        message: "Outcome names and prices must have the same length",
      });
    }
  });

const searchEventSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    image: z.string().optional(),
    icon: z.string().optional(),
    volume: z.number().finite().nonnegative().optional(),
    volume24hr: z.number().finite().nonnegative().optional(),
    liquidity: z.number().finite().nonnegative().optional(),
    startDate: gammaTimestampSchema.optional(),
    endDate: gammaTimestampSchema.optional(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
    live: z.boolean().optional(),
    ended: z.boolean().optional(),
    competitive: z.number().finite().optional(),
    markets: z.array(marketSchema).optional(),
    topOutcome: z
      .object({
        name: z.string().min(1),
        price: z.number().finite().min(0).max(1),
      })
      .optional(),
    _source: z.enum(["search", "tag"]).optional(),
  })
  .passthrough();

const paginationSchema = z.object({
  hasMore: z.boolean(),
  totalResults: z.number().int().nonnegative(),
});

export function buildEmptySearchResponse(degraded = false): SearchResponseData {
  return {
    events: [],
    tags: [],
    profiles: [],
    pagination: { hasMore: false, totalResults: 0 },
    ...(degraded ? { degraded: true } : {}),
  };
}

function parseEventsPayload(payload: unknown): SearchEvent[] {
  let events: unknown = payload;
  if (!Array.isArray(payload) && payload && typeof payload === "object") {
    const wrapper = payload as { data?: unknown; events?: unknown };
    events = wrapper.events ?? wrapper.data;
  }

  const parsed = z.array(searchEventSchema).safeParse(events);
  if (!parsed.success) {
    throw new UpstreamSearchError("Gamma event search returned malformed data");
  }
  return parsed.data as SearchEvent[];
}

/**
 * Extract the top outcome (leading position) from an event's markets
 * For multi-outcome markets (like "La Liga Winner"), finds the highest priced outcome
 * For Yes/No markets, returns the "Yes" outcome price
 */
export function getExactTopOutcome(
  markets: Market[]
): ExactTopOutcome | undefined {
  if (!markets || markets.length === 0) return undefined;

  let topOutcome: ExactTopOutcome | undefined;
  let highestPrice = new Decimal(0);

  for (const market of markets) {
    try {
      // Parse outcomes and prices from JSON strings
      const outcomes = parseGammaStringArray(market.outcomes);
      const prices = parseGammaStringArray(market.outcomePrices);

      if (outcomes.length === 0 || prices.length === 0) continue;

      // For Yes/No markets, we want the "Yes" price
      const isYesNoMarket =
        outcomes.length === 2 &&
        outcomes.some((o) => o.toLowerCase() === "yes") &&
        outcomes.some((o) => o.toLowerCase() === "no");

      for (let i = 0; i < outcomes.length && i < prices.length; i++) {
        const price = new Decimal(prices[i]);
        const outcomeName = outcomes[i];

        // Skip "No" outcomes for Yes/No markets
        if (isYesNoMarket && outcomeName.toLowerCase() === "no") {
          continue;
        }

        if (price.comparedTo(highestPrice) > 0) {
          highestPrice = price;
          // Use groupItemTitle if available (for grouped markets like team names)
          topOutcome = {
            name: market.groupItemTitle || outcomeName,
            price: price.toString(),
          };
        }
      }
    } catch {}
  }

  return topOutcome;
}

/** Preserves the web search route's historical numeric response field. */
export function getTopOutcome(markets: Market[]): TopOutcome | undefined {
  const outcome = getExactTopOutcome(markets);
  return outcome ? { ...outcome, price: Number(outcome.price) } : undefined;
}

function withTopOutcomes(events: SearchEvent[]): SearchEvent[] {
  return events.map((event) => {
    if (!event.markets || event.markets.length === 0) return event;

    const topOutcome = getTopOutcome(event.markets);
    return topOutcome ? { ...event, topOutcome } : event;
  });
}

function eventMatchesQuery(event: SearchEvent, queryLower: string): boolean {
  if (!queryLower) return true;
  if ((event.title || "").toLowerCase().includes(queryLower)) return true;
  return Boolean(
    event.markets?.some((m) =>
      (m.question || "").toLowerCase().includes(queryLower)
    )
  );
}

export function mergeEvents(
  searchEvents: SearchEvent[],
  tagEvents: SearchEvent[],
  limit: number,
  query: string
): SearchEvent[] {
  const seen = new Set<string>();
  const merged: SearchEvent[] = [];
  const queryLower = query.trim().toLowerCase();

  // Upstream `/events/keyset?tag_slug=…` doesn't accept a text query, so
  // when a query is present the tag fetch will surface tag-top events
  // that are irrelevant to what the user typed. Filter them down to
  // events whose title or any market question contains the query text;
  // public-search hits keep their upstream relevance score.
  const filteredTagEvents = queryLower
    ? tagEvents.filter((event) => eventMatchesQuery(event, queryLower))
    : tagEvents;

  for (const event of [...searchEvents, ...filteredTagEvents]) {
    if (event.closed === true || event.active === false) continue;

    const key = event.id || event.slug || event.title;
    if (!key || seen.has(key)) continue;

    seen.add(key);
    merged.push(event);
  }

  // No query → sort by 24h volume so the tag landing shows the active
  // top of the book. With a query → preserve the iteration order
  // (public-search relevance first, then matching tag events), so the
  // most relevant matches stay on top instead of being buried under
  // higher-volume but less-relevant tag-top events.
  const withOutcomes = withTopOutcomes(merged);
  const ordered = queryLower
    ? withOutcomes
    : withOutcomes.sort((a, b) =>
        new Decimal(b.volume24hr ?? 0).comparedTo(a.volume24hr ?? 0)
      );

  return ordered.slice(0, limit);
}

async function fetchJsonFromGamma(
  url: string,
  options?: SearchFetchOptions
): Promise<unknown> {
  return withUpstreamTimeout(
    options,
    SEARCH_UPSTREAM_TIMEOUT_MS,
    async (fetchImpl, signal) => {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal,
      });

      if (!response.ok) {
        throw new UpstreamSearchError(
          `Gamma search request failed with ${response.status}`,
          response.status
        );
      }

      return response.json();
    }
  );
}

export async function fetchPublicSearchEvents(
  query: string,
  limit: number,
  options?: SearchFetchOptions
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
  params.set("optimized", options?.fullMarketRecords ? "false" : "true");
  params.set("events_status", "active");
  params.set("keep_closed_markets", "0");
  params.set("closed", "false");

  const payload = await fetchJsonFromGamma(
    `${GAMMA_API_BASE}/public-search?${params.toString()}`,
    options
  );

  const parsed = z
    .object({
      events: z
        .array(searchEventSchema)
        .nullish()
        .transform((events) => events ?? []),
      tags: z
        .array(z.unknown())
        .nullish()
        .transform((tags) => tags ?? []),
      profiles: z
        .array(z.unknown())
        .nullish()
        .transform((profiles) => profiles ?? []),
      pagination: paginationSchema.optional(),
      hasMore: z.boolean().optional(),
    })
    .passthrough()
    .safeParse(payload);
  if (!parsed.success) {
    throw new UpstreamSearchError(
      "Gamma public search returned a malformed payload"
    );
  }

  if (
    options?.fullMarketRecords &&
    parsed.data.events.some((event) =>
      event.markets?.some((market) => market.id === undefined)
    )
  ) {
    throw new UpstreamSearchError(
      "Gamma full public search omitted a nested market ID"
    );
  }

  return {
    events: (parsed.data.events as SearchEvent[]).map((event) => ({
      ...event,
      _source: event._source || "search",
    })),
    tags: parsed.data.tags,
    profiles: parsed.data.profiles,
    pagination: parsed.data.pagination || {
      hasMore: parsed.data.hasMore ?? false,
      totalResults: parsed.data.events.length,
    },
  };
}

export async function fetchTagEvents(
  tagSlug: string,
  options?: SearchFetchOptions,
  limit = DEFAULT_SEARCH_LIMIT
): Promise<TagEventsResult> {
  const boundedLimit = Math.min(Math.max(1, limit), MAX_SEARCH_LIMIT);
  const params = new URLSearchParams();
  params.set("tag_slug", tagSlug);
  params.set("closed", "false");
  params.set("limit", String(boundedLimit + 1));
  params.set("order", "volume24hr");
  params.set("ascending", "false");

  const payload = await fetchJsonFromGamma(
    `${GAMMA_API_BASE}/events/keyset?${params.toString()}`,
    options
  );

  const events = parseEventsPayload(payload).map((event) => ({
    ...event,
    _source: event._source || "tag",
  }));
  return {
    events: events.slice(0, boundedLimit),
    truncated: events.length > boundedLimit,
  };
}

export async function fetchAggregatedSearchData(
  query: string,
  limit: number,
  tagSlugs: string[],
  options?: SearchFetchOptions
): Promise<SearchResponseData> {
  let degraded = false;

  const publicSearchRequest = fetchPublicSearchEvents(
    query,
    limit,
    options
  ).catch((error) => {
    if (options?.signal?.aborted) throw error;
    degraded = true;
    log.warn("public_search.upstream_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      status: error instanceof UpstreamSearchError ? error.status : undefined,
    });
    return {
      events: [],
      tags: [],
      profiles: [],
      pagination: { hasMore: false, totalResults: 0 },
    };
  });

  const tagResultsRequest = Promise.all(
    tagSlugs.map((tagSlug) =>
      fetchTagEvents(tagSlug, options, limit).catch((error) => {
        if (options?.signal?.aborted) throw error;
        degraded = true;
        log.warn("tag_search.upstream_failed", {
          tagSlug,
          errorName: error instanceof Error ? error.name : "UnknownError",
          status:
            error instanceof UpstreamSearchError ? error.status : undefined,
        });
        return { events: [], truncated: false };
      })
    )
  );
  const [publicSearch, tagResults] = await Promise.all([
    publicSearchRequest,
    tagResultsRequest,
  ]);

  const tagEvents = tagResults.flatMap((result) => result.events);
  const tagTruncated = tagResults.some((result) => result.truncated);
  const merged = mergeEvents(publicSearch.events, tagEvents, limit + 1, query);
  const mergedTruncated = merged.length > limit;
  const events = merged.slice(0, limit);
  const truncated = tagTruncated || mergedTruncated;

  return {
    events,
    tags: publicSearch.tags,
    profiles: publicSearch.profiles,
    pagination: {
      ...publicSearch.pagination,
      hasMore: publicSearch.pagination.hasMore || truncated,
      totalResults: Math.max(
        publicSearch.pagination.totalResults,
        events.length
      ),
    },
    ...(degraded ? { degraded: true } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
}
