import Decimal from "decimal.js";
import { z } from "zod";
import { UpstreamPublicDataError } from "../errors";
import {
  type ServiceFetchOptions,
  withUpstreamTimeout,
} from "../fetch-options";
import {
  DATA_API_BASE,
  fetchTraderLeaderboard,
  GAMMA_API_BASE,
} from "../markets/public-data";
import { decimalValueSchema } from "../validation";

const PUBLIC_DATA_TIMEOUT_MS = 8500;
const decimalStringSchema = decimalValueSchema().transform(String);
const nonNegativeDecimalStringSchema = decimalValueSchema({
  min: "0",
}).transform(String);
const probabilityStringSchema = decimalValueSchema({
  min: "0",
  max: "1",
}).transform(String);

const profileSchema = z
  .object({
    createdAt: z.string().optional(),
    proxyWallet: z.string(),
    displayUsernamePublic: z.boolean().optional(),
    pseudonym: z.string().optional(),
    name: z.string().optional(),
    bio: z.string().optional(),
    profileImage: z.string().optional(),
    verifiedBadge: z.boolean().optional(),
  })
  .passthrough();

const positionSchema = z
  .object({
    proxyWallet: z.string(),
    asset: z.string(),
    conditionId: z.string(),
    size: nonNegativeDecimalStringSchema,
    avgPrice: probabilityStringSchema,
    initialValue: nonNegativeDecimalStringSchema,
    currentValue: nonNegativeDecimalStringSchema,
    cashPnl: decimalStringSchema,
    percentPnl: decimalStringSchema,
    totalBought: nonNegativeDecimalStringSchema,
    realizedPnl: decimalStringSchema,
    percentRealizedPnl: decimalStringSchema,
    curPrice: probabilityStringSchema,
    redeemable: z.boolean(),
    mergeable: z.boolean(),
    title: z.string().optional(),
    slug: z.string().optional(),
    eventSlug: z.string().optional(),
    outcome: z.string().optional(),
    outcomeIndex: z.number().int().nonnegative().optional(),
    oppositeOutcome: z.string().optional(),
    oppositeAsset: z.string().optional(),
    endDate: z.string().optional(),
    negativeRisk: z.boolean().optional(),
  })
  .passthrough();

const activitySchema = z
  .object({
    proxyWallet: z.string(),
    timestamp: z.number().int().nonnegative(),
    conditionId: z.string().optional(),
    type: z.string(),
    size: nonNegativeDecimalStringSchema.optional(),
    usdcSize: nonNegativeDecimalStringSchema.optional(),
    transactionHash: z.string().optional(),
    price: probabilityStringSchema.optional(),
    asset: z.string().optional(),
    side: z.enum(["BUY", "SELL"]).optional(),
    outcomeIndex: z.number().int().nonnegative().optional(),
    title: z.string().optional(),
    slug: z.string().optional(),
    eventSlug: z.string().optional(),
    outcome: z.string().optional(),
  })
  .passthrough();

const closedPositionSchema = z
  .object({
    proxyWallet: z.string(),
    asset: z.string(),
    conditionId: z.string(),
    avgPrice: probabilityStringSchema,
    totalBought: nonNegativeDecimalStringSchema,
    realizedPnl: decimalStringSchema,
    curPrice: probabilityStringSchema,
    timestamp: z.number().int().nonnegative(),
    title: z.string().optional(),
    slug: z.string().optional(),
    eventSlug: z.string().optional(),
    outcome: z.string().optional(),
    outcomeIndex: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const portfolioValueSchema = z.array(
  z
    .object({
      user: z.string(),
      value: nonNegativeDecimalStringSchema,
    })
    .passthrough()
);

async function fetchJson<T>(
  url: URL,
  schema: z.ZodType<T>,
  options?: ServiceFetchOptions,
  allowNotFound = false
): Promise<T | null> {
  return withUpstreamTimeout(
    options,
    PUBLIC_DATA_TIMEOUT_MS,
    async (fetchImpl, signal) => {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
      });
      if (allowNotFound && response.status === 404) return null;
      if (!response.ok) {
        throw new UpstreamPublicDataError(
          `Public profile request failed with ${response.status}`,
          response.status
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new UpstreamPublicDataError(
          "Public profile request returned malformed JSON"
        );
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new UpstreamPublicDataError(
          "Public profile request returned an invalid response"
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

export async function fetchPublicProfile(
  walletAddress: string,
  options?: ServiceFetchOptions
) {
  const url = new URL("/public-profile", GAMMA_API_BASE);
  url.searchParams.set("address", walletAddress);
  return fetchJson(url, profileSchema, options, true);
}

export interface WalletPositionsParams {
  walletAddress: string;
  conditionIds?: string[];
  eventIds?: number[];
  sizeThreshold?: string;
  redeemable?: boolean;
  mergeable?: boolean;
  title?: string;
  limit: number;
  offset: number;
  sortBy?: string;
  sortDirection?: "ASC" | "DESC";
}

export async function fetchWalletPositions(
  input: WalletPositionsParams,
  options?: ServiceFetchOptions
) {
  const url = new URL("/positions", DATA_API_BASE);
  url.searchParams.set("user", input.walletAddress);
  addIfDefined(url.searchParams, "market", input.conditionIds?.join(","));
  addIfDefined(url.searchParams, "eventId", input.eventIds?.join(","));
  addIfDefined(url.searchParams, "sizeThreshold", input.sizeThreshold);
  addIfDefined(url.searchParams, "redeemable", input.redeemable);
  addIfDefined(url.searchParams, "mergeable", input.mergeable);
  addIfDefined(url.searchParams, "title", input.title);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("offset", String(input.offset));
  addIfDefined(url.searchParams, "sortBy", input.sortBy);
  addIfDefined(url.searchParams, "sortDirection", input.sortDirection);
  return (await fetchJson(url, z.array(positionSchema), options)) ?? [];
}

export interface WalletActivityParams {
  walletAddress: string;
  conditionIds?: string[];
  eventIds?: number[];
  types?: string[];
  startTimestamp?: number;
  endTimestamp?: number;
  limit: number;
  offset: number;
  sortDirection?: "ASC" | "DESC";
}

export async function fetchWalletActivity(
  input: WalletActivityParams,
  options?: ServiceFetchOptions
) {
  const url = new URL("/activity", DATA_API_BASE);
  url.searchParams.set("user", input.walletAddress);
  addIfDefined(url.searchParams, "market", input.conditionIds?.join(","));
  addIfDefined(url.searchParams, "eventId", input.eventIds?.join(","));
  addIfDefined(url.searchParams, "type", input.types?.join(","));
  addIfDefined(url.searchParams, "start", input.startTimestamp);
  addIfDefined(url.searchParams, "end", input.endTimestamp);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("offset", String(input.offset));
  addIfDefined(url.searchParams, "sortDirection", input.sortDirection);
  return (await fetchJson(url, z.array(activitySchema), options)) ?? [];
}

export interface ClosedPositionsParams {
  walletAddress: string;
  conditionIds?: string[];
  eventIds?: number[];
  limit: number;
  offset: number;
  sortBy?: string;
  sortDirection?: "ASC" | "DESC";
}

export async function fetchClosedPositions(
  input: ClosedPositionsParams,
  options?: ServiceFetchOptions
) {
  const url = new URL("/closed-positions", DATA_API_BASE);
  url.searchParams.set("user", input.walletAddress);
  addIfDefined(url.searchParams, "market", input.conditionIds?.join(","));
  addIfDefined(url.searchParams, "eventId", input.eventIds?.join(","));
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("offset", String(input.offset));
  addIfDefined(url.searchParams, "sortBy", input.sortBy);
  addIfDefined(url.searchParams, "sortDirection", input.sortDirection);
  return (await fetchJson(url, z.array(closedPositionSchema), options)) ?? [];
}

export async function fetchWalletPortfolioValue(
  walletAddress: string,
  options?: ServiceFetchOptions
) {
  const url = new URL("/value", DATA_API_BASE);
  url.searchParams.set("user", walletAddress);
  const rows = (await fetchJson(url, portfolioValueSchema, options)) ?? [];
  const row = rows.find(
    (entry) => entry.user.toLowerCase() === walletAddress.toLowerCase()
  );
  return { walletAddress, value: row?.value ?? "0" };
}

export async function fetchWalletAllTimePnl(
  walletAddress: string,
  options?: ServiceFetchOptions
) {
  const rows = await fetchTraderLeaderboard(
    {
      category: "OVERALL",
      timePeriod: "ALL",
      orderBy: "PNL",
      walletAddress,
      limit: 1,
      offset: 0,
    },
    options
  );
  const row = rows.find(
    (entry) => entry.proxyWallet.toLowerCase() === walletAddress.toLowerCase()
  );
  if (!row) return null;
  return {
    walletAddress,
    rank: row.rank,
    totalPnl: row.pnl,
    volume: row.volume,
  };
}

export interface PnlPosition {
  [key: string]: unknown;
  initialValue: string | number;
  currentValue: string | number;
  cashPnl: string | number;
  realizedPnl: string | number;
}

export function summarizeWalletPnl(positions: PnlPosition[]) {
  let initialValue = new Decimal(0);
  let currentValue = new Decimal(0);
  let cashPnl = new Decimal(0);
  let realizedPnl = new Decimal(0);
  let winningPositions = 0;
  let losingPositions = 0;

  for (const position of positions) {
    initialValue = initialValue.plus(position.initialValue);
    currentValue = currentValue.plus(position.currentValue);
    cashPnl = cashPnl.plus(position.cashPnl);
    realizedPnl = realizedPnl.plus(position.realizedPnl);
    const totalPositionPnl = new Decimal(position.cashPnl).plus(
      position.realizedPnl
    );
    if (totalPositionPnl.isPositive()) winningPositions += 1;
    if (totalPositionPnl.isNegative()) losingPositions += 1;
  }

  const totalPnl = cashPnl.plus(realizedPnl);
  const roiPercent = initialValue.isZero()
    ? new Decimal(0)
    : totalPnl.div(initialValue).mul(100);

  return {
    positionCount: positions.length,
    initialValue: initialValue.toString(),
    currentValue: currentValue.toString(),
    cashPnl: cashPnl.toString(),
    realizedPnl: realizedPnl.toString(),
    totalPnl: totalPnl.toString(),
    roiPercent: roiPercent.toString(),
    winningPositions,
    losingPositions,
  };
}
