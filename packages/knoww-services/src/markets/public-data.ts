import { z } from "zod";
import { UpstreamPublicDataError } from "../errors";
import {
  type ServiceFetchOptions,
  withUpstreamTimeout,
} from "../fetch-options";
import { decimalValueSchema } from "../validation";
import { gammaMarketDetailSchema } from "./detail";
import { CLOB_API_BASE as ORDERBOOK_CLOB_API_BASE } from "./orderbook";
import { GAMMA_API_BASE as SEARCH_GAMMA_API_BASE } from "./search";

export const GAMMA_API_BASE = SEARCH_GAMMA_API_BASE;
export const DATA_API_BASE = "https://data-api.polymarket.com";
export const CLOB_API_BASE = ORDERBOOK_CLOB_API_BASE;

const PUBLIC_DATA_TIMEOUT_MS = 8500;
const decimalStringSchema = decimalValueSchema().transform(String);
const nonNegativeDecimalStringSchema = decimalValueSchema({
  min: "0",
}).transform(String);
const probabilityStringSchema = decimalValueSchema({
  min: "0",
  max: "1",
}).transform(String);

function optionalDecimal(schema = decimalStringSchema) {
  return schema.nullish().transform((value) => value ?? undefined);
}

const tagSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    label: z.string().trim().min(1),
    slug: z.string().trim().min(1),
  })
  .passthrough();

const eventSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    slug: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    volume: optionalDecimal(nonNegativeDecimalStringSchema),
    liquidity: optionalDecimal(nonNegativeDecimalStringSchema),
    markets: z.array(gammaMarketDetailSchema).default([]),
    tags: z.array(tagSchema).default([]),
  })
  .passthrough();

const eventPageSchema = z.object({
  events: z.array(eventSchema),
  next_cursor: z.string().nullish(),
});

const marketPageSchema = z.object({
  markets: z.array(gammaMarketDetailSchema),
  next_cursor: z.string().nullish(),
});

const tradeSchema = z
  .object({
    proxyWallet: z.string(),
    side: z.enum(["BUY", "SELL"]),
    asset: z.string(),
    conditionId: z.string(),
    size: nonNegativeDecimalStringSchema,
    price: probabilityStringSchema,
    timestamp: z.number().int().nonnegative(),
    title: z.string().optional(),
    slug: z.string().optional(),
    eventSlug: z.string().optional(),
    outcome: z.string().optional(),
    outcomeIndex: z.number().int().nonnegative().optional(),
    transactionHash: z.string().optional(),
  })
  .passthrough();

const holderSchema = z
  .object({
    proxyWallet: z.string(),
    asset: z.string(),
    amount: nonNegativeDecimalStringSchema,
    outcomeIndex: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const holderGroupSchema = z
  .object({
    token: z.string(),
    holders: z.array(holderSchema),
  })
  .passthrough();

const openInterestSchema = z
  .object({
    market: z.string(),
    value: nonNegativeDecimalStringSchema,
  })
  .passthrough()
  .transform(({ market, value }) => ({ conditionId: market, value }));

const liveVolumeSchema = z
  .object({
    total: nonNegativeDecimalStringSchema,
    markets: z.array(
      z
        .object({
          market: z.string(),
          value: nonNegativeDecimalStringSchema,
        })
        .passthrough()
        .transform(({ market, value }) => ({ conditionId: market, value }))
    ),
  })
  .passthrough();

const leaderboardEntrySchema = z
  .object({
    rank: z.union([z.string(), z.number()]).transform(String),
    proxyWallet: z.string(),
    userName: z
      .string()
      .nullish()
      .transform((value) => value ?? undefined),
    vol: nonNegativeDecimalStringSchema,
    pnl: decimalStringSchema,
    verifiedBadge: z.boolean().optional(),
  })
  .passthrough()
  .transform(({ vol, ...entry }) => ({ ...entry, volume: vol }));

const sportsMetadataSchema = z
  .object({
    sport: z.string(),
    image: z.string().optional(),
    resolution: z.string().optional(),
    ordering: z.string().optional(),
    tags: z
      .union([z.string(), z.number()])
      .optional()
      .transform((value) => (value === undefined ? undefined : String(value))),
    series: z
      .union([z.string(), z.number()])
      .optional()
      .transform((value) => (value === undefined ? undefined : String(value))),
  })
  .passthrough();

const sportsMarketTypesSchema = z.union([
  z.array(z.string()),
  z
    .object({ marketTypes: z.array(z.string()) })
    .transform((value) => value.marketTypes),
]);

const teamSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string(),
    league: z.string().optional(),
    abbreviation: z.string().optional(),
  })
  .passthrough();

type PublicFetchOptions = ServiceFetchOptions;

async function fetchJson(
  url: URL,
  schema: z.ZodType,
  options?: PublicFetchOptions,
  init?: RequestInit
): Promise<unknown> {
  return withUpstreamTimeout(
    options,
    PUBLIC_DATA_TIMEOUT_MS,
    async (fetchImpl, signal) => {
      const response = await fetchImpl(url, {
        ...init,
        headers: {
          Accept: "application/json",
          ...init?.headers,
        },
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new UpstreamPublicDataError(
          `Public data request failed with ${response.status}`,
          response.status
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new UpstreamPublicDataError(
          "Public data request returned malformed JSON"
        );
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new UpstreamPublicDataError(
          "Public data request returned an invalid response"
        );
      }
      return parsed.data;
    }
  );
}

function addIfDefined(
  params: URLSearchParams,
  name: string,
  value: string | number | boolean | undefined
) {
  if (value !== undefined) params.set(name, String(value));
}

export interface EventPageParams {
  limit: number;
  cursor?: string;
  closed?: boolean;
  live?: boolean;
  tagSlug?: string;
  seriesIds?: number[];
  startDateMin?: string;
  startDateMax?: string;
  endDateMin?: string;
  endDateMax?: string;
  order?: string;
  ascending?: boolean;
}

export async function fetchEventPage(
  input: EventPageParams,
  options?: PublicFetchOptions
) {
  const url = new URL("/events/keyset", GAMMA_API_BASE);
  addIfDefined(url.searchParams, "limit", input.limit);
  addIfDefined(url.searchParams, "after_cursor", input.cursor);
  addIfDefined(url.searchParams, "closed", input.closed);
  addIfDefined(url.searchParams, "live", input.live);
  addIfDefined(url.searchParams, "tag_slug", input.tagSlug);
  addIfDefined(url.searchParams, "series_id", input.seriesIds?.join(","));
  addIfDefined(url.searchParams, "start_date_min", input.startDateMin);
  addIfDefined(url.searchParams, "start_date_max", input.startDateMax);
  addIfDefined(url.searchParams, "end_date_min", input.endDateMin);
  addIfDefined(url.searchParams, "end_date_max", input.endDateMax);
  addIfDefined(url.searchParams, "order", input.order);
  addIfDefined(url.searchParams, "ascending", input.ascending);
  const data = (await fetchJson(url, eventPageSchema, options)) as z.infer<
    typeof eventPageSchema
  >;
  return { events: data.events, nextCursor: data.next_cursor ?? null };
}

export interface MarketTradesParams {
  conditionIds?: string[];
  eventIds?: number[];
  walletAddress?: string;
  side?: "BUY" | "SELL";
  startTimestamp?: number;
  endTimestamp?: number;
  limit: number;
  offset: number;
}

export async function fetchMarketTrades(
  input: MarketTradesParams,
  options?: PublicFetchOptions
) {
  const url = new URL("/trades", DATA_API_BASE);
  addIfDefined(url.searchParams, "market", input.conditionIds?.join(","));
  addIfDefined(url.searchParams, "eventId", input.eventIds?.join(","));
  addIfDefined(url.searchParams, "user", input.walletAddress);
  addIfDefined(url.searchParams, "side", input.side);
  addIfDefined(url.searchParams, "start", input.startTimestamp);
  addIfDefined(url.searchParams, "end", input.endTimestamp);
  addIfDefined(url.searchParams, "limit", input.limit);
  addIfDefined(url.searchParams, "offset", input.offset);
  return (await fetchJson(url, z.array(tradeSchema), options)) as z.infer<
    typeof tradeSchema
  >[];
}

const quoteMapSchema = z.record(
  z.string(),
  z
    .object({
      BUY: probabilityStringSchema.optional(),
      SELL: probabilityStringSchema.optional(),
    })
    .passthrough()
);
const decimalMapSchema = z.record(z.string(), nonNegativeDecimalStringSchema);
const lastTradeSchema = z.array(
  z
    .object({
      token_id: z.string(),
      price: probabilityStringSchema,
      side: z.enum(["BUY", "SELL"]),
    })
    .passthrough()
);

export async function fetchMarketQuotes(
  tokenIds: string[],
  options?: PublicFetchOptions
) {
  const tokens = tokenIds.map((tokenId) => ({ token_id: tokenId }));
  const priceRequests = tokenIds.flatMap((tokenId) => [
    { token_id: tokenId, side: "BUY" },
    { token_id: tokenId, side: "SELL" },
  ]);
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const [prices, midpoints, spreads, lastTrades] = await Promise.all([
    fetchJson(
      new URL("/prices", CLOB_API_BASE),
      quoteMapSchema,
      options,
      post(priceRequests)
    ),
    fetchJson(
      new URL("/midpoints", CLOB_API_BASE),
      decimalMapSchema,
      options,
      post(tokens)
    ),
    fetchJson(
      new URL("/spreads", CLOB_API_BASE),
      decimalMapSchema,
      options,
      post(tokens)
    ),
    fetchJson(
      new URL("/last-trades-prices", CLOB_API_BASE),
      lastTradeSchema,
      options,
      post(tokens)
    ),
  ]);
  const priceMap = prices as z.infer<typeof quoteMapSchema>;
  const midpointMap = midpoints as z.infer<typeof decimalMapSchema>;
  const spreadMap = spreads as z.infer<typeof decimalMapSchema>;
  const lastTradeMap = new Map(
    (lastTrades as z.infer<typeof lastTradeSchema>).map((entry) => [
      entry.token_id,
      entry,
    ])
  );
  return tokenIds.map((tokenId) => ({
    tokenId,
    buyPrice: priceMap[tokenId]?.BUY,
    sellPrice: priceMap[tokenId]?.SELL,
    midpoint: midpointMap[tokenId],
    spread: spreadMap[tokenId],
    lastTradePrice: lastTradeMap.get(tokenId)?.price,
    lastTradeSide: lastTradeMap.get(tokenId)?.side,
  }));
}

export async function fetchMarketHolders(
  input: { conditionIds: string[]; limit: number; minBalance?: number },
  options?: PublicFetchOptions
) {
  const url = new URL("/holders", DATA_API_BASE);
  url.searchParams.set("market", input.conditionIds.join(","));
  addIfDefined(url.searchParams, "limit", input.limit);
  addIfDefined(url.searchParams, "minBalance", input.minBalance);
  return (await fetchJson(url, z.array(holderGroupSchema), options)) as z.infer<
    typeof holderGroupSchema
  >[];
}

export async function fetchOpenInterest(
  conditionIds: string[],
  options?: PublicFetchOptions
) {
  const url = new URL("/oi", DATA_API_BASE);
  url.searchParams.set("market", conditionIds.join(","));
  return (await fetchJson(
    url,
    z.array(openInterestSchema),
    options
  )) as z.infer<typeof openInterestSchema>[];
}

export async function fetchEventLiveVolume(
  eventId: number,
  options?: PublicFetchOptions
) {
  const url = new URL("/live-volume", DATA_API_BASE);
  url.searchParams.set("id", String(eventId));
  const rows = (await fetchJson(
    url,
    z.array(liveVolumeSchema),
    options
  )) as z.infer<typeof liveVolumeSchema>[];
  const row = rows[0] ?? { total: "0", markets: [] };
  return { eventId, total: row.total, markets: row.markets };
}

export async function fetchTraderLeaderboard(
  input: {
    category: string;
    timePeriod: string;
    orderBy: string;
    limit: number;
    offset: number;
    walletAddress?: string;
    userName?: string;
  },
  options?: PublicFetchOptions
) {
  const url = new URL("/v1/leaderboard", DATA_API_BASE);
  url.searchParams.set("category", input.category);
  url.searchParams.set("timePeriod", input.timePeriod);
  url.searchParams.set("orderBy", input.orderBy);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("offset", String(input.offset));
  addIfDefined(url.searchParams, "user", input.walletAddress);
  addIfDefined(url.searchParams, "userName", input.userName);
  return (await fetchJson(
    url,
    z.array(leaderboardEntrySchema),
    options
  )) as z.infer<typeof leaderboardEntrySchema>[];
}

export async function fetchTags(
  input: { limit: number; offset: number },
  options?: PublicFetchOptions
) {
  const url = new URL("/tags", GAMMA_API_BASE);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("offset", String(input.offset));
  return (await fetchJson(url, z.array(tagSchema), options)) as z.infer<
    typeof tagSchema
  >[];
}

export async function fetchSportsMetadata(options?: PublicFetchOptions) {
  return (await fetchJson(
    new URL("/sports", GAMMA_API_BASE),
    z.array(sportsMetadataSchema),
    options
  )) as z.infer<typeof sportsMetadataSchema>[];
}

export async function fetchSportsMarketTypes(options?: PublicFetchOptions) {
  return (await fetchJson(
    new URL("/sports/market-types", GAMMA_API_BASE),
    sportsMarketTypesSchema,
    options
  )) as string[];
}

export async function fetchSportsTeams(
  input: { league?: string; limit: number; offset: number },
  options?: PublicFetchOptions
) {
  const url = new URL("/teams", GAMMA_API_BASE);
  addIfDefined(url.searchParams, "league", input.league);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("offset", String(input.offset));
  return (await fetchJson(url, z.array(teamSchema), options)) as z.infer<
    typeof teamSchema
  >[];
}

export async function fetchMarketPageByTagSlug(
  input: { tagSlug: string; limit: number; cursor?: string },
  options?: PublicFetchOptions
) {
  const tag = (await fetchJson(
    new URL(`/tags/slug/${encodeURIComponent(input.tagSlug)}`, GAMMA_API_BASE),
    tagSchema,
    options
  )) as z.infer<typeof tagSchema>;
  const url = new URL("/markets/keyset", GAMMA_API_BASE);
  url.searchParams.set("tag_id", tag.id);
  url.searchParams.set("limit", String(input.limit));
  addIfDefined(url.searchParams, "after_cursor", input.cursor);
  const page = (await fetchJson(url, marketPageSchema, options)) as z.infer<
    typeof marketPageSchema
  >;
  return { tag, markets: page.markets, nextCursor: page.next_cursor ?? null };
}
