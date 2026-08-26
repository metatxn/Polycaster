import { parseGammaStringArray } from "@knoww/shared-types/polymarket";
import { z } from "zod";
import { UpstreamMarketError } from "../errors";
import {
  type ServiceFetchOptions,
  withUpstreamTimeout,
} from "../fetch-options";
import {
  gammaProbabilityArraySchema,
  gammaStringArraySchema,
  gammaTimestampSchema,
  nonNegativeDecimalSchema,
} from "../validation";
import { GAMMA_API_BASE } from "./search";

const DETAIL_UPSTREAM_TIMEOUT_MS = 8500;

export type MarketIdentifier =
  | { kind: "slug"; value: string }
  | { kind: "conditionId"; value: string }
  | { kind: "tokenId"; value: string };

const IDENTIFIER_QUERY_PARAM: Record<MarketIdentifier["kind"], string> = {
  slug: "slug",
  conditionId: "condition_ids",
  tokenId: "clob_token_ids",
};

/**
 * Fields the MCP layer reads from a Gamma market. Everything is optional
 * except `id` because Gamma's schema drifts across market generations:
 * 2020-era markets lack `umaResolutionStatus` while carrying `active: true`
 * despite being settled, and array columns arrive JSON-stringified.
 */
export interface GammaMarketDetail {
  id: string;
  question?: string;
  slug?: string;
  conditionId?: string;
  description?: string;
  outcomes?: string | string[];
  outcomePrices?: string | (string | number)[];
  clobTokenIds?: string | string[];
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  startDate?: string;
  endDate?: string;
  closedTime?: string;
  volumeNum?: number;
  volume?: string | number;
  liquidityNum?: number;
  liquidity?: string | number;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  spread?: number;
  oneDayPriceChange?: number;
  umaResolutionStatus?: string;
  resolutionSource?: string;
  resolvedBy?: string;
  negRisk?: boolean;
  groupItemTitle?: string;
  events?: {
    id?: string;
    slug?: string;
    title?: string;
    ticker?: string;
  }[];
}

const probabilityNumberSchema = z.number().finite().min(0).max(1);
const priceChangeSchema = z.number().finite().min(-1).max(1);

export const gammaMarketDetailSchema: z.ZodType<GammaMarketDetail> = z
  .object({
    id: z.string().min(1),
    question: z.string().optional(),
    slug: z.string().optional(),
    conditionId: z.string().optional(),
    description: z.string().optional(),
    outcomes: gammaStringArraySchema.optional(),
    outcomePrices: gammaProbabilityArraySchema.optional(),
    clobTokenIds: gammaStringArraySchema.optional(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
    archived: z.boolean().optional(),
    startDate: gammaTimestampSchema.optional(),
    endDate: gammaTimestampSchema.optional(),
    closedTime: gammaTimestampSchema.optional(),
    volumeNum: z.number().finite().nonnegative().optional(),
    volume: nonNegativeDecimalSchema.optional(),
    liquidityNum: z.number().finite().nonnegative().optional(),
    liquidity: nonNegativeDecimalSchema.optional(),
    bestBid: probabilityNumberSchema.optional(),
    bestAsk: probabilityNumberSchema.optional(),
    lastTradePrice: probabilityNumberSchema.optional(),
    spread: probabilityNumberSchema.optional(),
    oneDayPriceChange: priceChangeSchema.optional(),
    umaResolutionStatus: z.string().optional(),
    resolutionSource: z.string().optional(),
    resolvedBy: z.string().optional(),
    negRisk: z.boolean().optional(),
    groupItemTitle: z.string().optional(),
    events: z
      .array(
        z
          .object({
            id: z.string().optional(),
            slug: z.string().optional(),
            title: z.string().optional(),
            ticker: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough()
  .superRefine((market, context) => {
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

async function queryMarkets(
  identifier: MarketIdentifier,
  includeClosed: boolean,
  options?: ServiceFetchOptions
): Promise<GammaMarketDetail | null> {
  const params = new URLSearchParams();
  params.set(IDENTIFIER_QUERY_PARAM[identifier.kind], identifier.value);
  if (includeClosed) {
    params.set("closed", "true");
  }

  return withUpstreamTimeout(
    options,
    DETAIL_UPSTREAM_TIMEOUT_MS,
    async (fetchImpl, signal) => {
      const response = await fetchImpl(
        `${GAMMA_API_BASE}/markets?${params.toString()}`,
        {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal,
        }
      );

      if (!response.ok) {
        throw new UpstreamMarketError(
          `Gamma market lookup failed with ${response.status}`,
          response.status
        );
      }

      const payload: unknown = await response.json();

      if (!Array.isArray(payload)) {
        throw new UpstreamMarketError(
          "Gamma market lookup returned a non-array"
        );
      }
      if (payload.length === 0) {
        return null;
      }

      const market = gammaMarketDetailSchema.safeParse(payload[0]);
      if (!market.success) {
        throw new UpstreamMarketError(
          "Gamma market lookup returned a malformed market"
        );
      }
      return market.data;
    }
  );
}

/**
 * Looks up a single market by slug, condition id, or CLOB token id.
 *
 * Gamma's default filter excludes closed markets even from exact identifier
 * lookups (probed 2026-08: a settled market's slug and condition id both
 * return [] without closed=true), so an empty first result triggers one
 * retry with closed=true before concluding the market does not exist.
 */
export async function fetchMarketByIdentifier(
  identifier: MarketIdentifier,
  options?: ServiceFetchOptions
): Promise<GammaMarketDetail | null> {
  const open = await queryMarkets(identifier, false, options);
  if (open) {
    return open;
  }
  return queryMarkets(identifier, true, options);
}
