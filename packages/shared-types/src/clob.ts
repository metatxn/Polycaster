import { POLYMARKET_API, type TradingSide } from "./polymarket.ts";

export type ClobHeaders = Record<string, string>;

export interface ClobFetchInit {
  method?: string;
  headers?: ClobHeaders;
  body?: string;
  [key: string]: unknown;
}

export interface ClobFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
}

export type ClobFetch = (
  input: string,
  init?: ClobFetchInit
) => Promise<ClobFetchResponse>;

export interface UnifiedClobOrderBookClient {
  fetchOrderBook(request: { tokenId: string }): Promise<unknown>;
  fetchOrderBooks?(request: Array<{ tokenId: string }>): Promise<unknown>;
  fetchMarketInfo?(request: { conditionId: string }): Promise<unknown>;
  fetchPrice?(request: {
    tokenId: string;
    side: TradingSide;
  }): Promise<unknown>;
  fetchPriceHistory?(request: {
    tokenId: string;
    startTs?: number;
    endTs?: number;
    fidelity?: number;
  }): Promise<unknown>;
  fetchBuilderFeeRates?(request: { builderCode: string }): Promise<unknown>;
}

export interface ClobRequestOptions {
  host?: string;
  fetchImpl?: ClobFetch;
  headers?: ClobHeaders;
  requestInit?: ClobFetchInit;
  unifiedClient?: UnifiedClobOrderBookClient;
  useUnifiedSdk?: boolean;
  priceSide?: TradingSide;
}

export interface ClobOrderBookLevel {
  price: string;
  size: string;
}

export interface ClobOrderBook {
  market?: string;
  asset_id?: string;
  hash?: string;
  timestamp?: string;
  bids: ClobOrderBookLevel[];
  asks: ClobOrderBookLevel[];
  min_order_size?: string;
  tick_size?: string;
  spread?: number;
  midpoint?: number;
}

export interface ClobPriceHistoryPoint {
  t: number;
  p: number;
}

export interface ClobPriceHistoryResponse {
  history?: ClobPriceHistoryPoint[];
}

export interface ClobPriceHistoryParams {
  startTs?: string | number;
  endTs?: string | number;
  fidelity?: string | number;
}

export class ClobRequestError extends Error {
  readonly status: number;
  readonly statusText: string | undefined;

  constructor(message: string, response: ClobFetchResponse) {
    super(message);
    this.name = "ClobRequestError";
    this.status = response.status;
    this.statusText = response.statusText;
  }
}

type ClobQueryValue = string | number | boolean | bigint | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeClobHost(host?: string): string {
  return (host || POLYMARKET_API.CLOB.BASE).replace(/\/+$/, "");
}

function canUseUnifiedSdkForPublicRead(options?: ClobRequestOptions): boolean {
  if (options?.useUnifiedSdk === false) return false;
  if (options?.fetchImpl || options?.headers || options?.requestInit) {
    return false;
  }

  return (
    normalizeClobHost(options?.host) ===
    normalizeClobHost(POLYMARKET_API.CLOB.BASE)
  );
}

function encodeQuery(params?: Record<string, ClobQueryValue>): string {
  if (!params) return "";

  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )
    .join("&");
}

function getFetch(options?: ClobRequestOptions): ClobFetch {
  const fetchImpl =
    options?.fetchImpl ?? (globalThis as { fetch?: ClobFetch }).fetch;

  if (!fetchImpl) {
    throw new Error("CLOB fetch implementation unavailable");
  }

  return fetchImpl;
}

function buildFetchInit(
  options: ClobRequestOptions | undefined,
  overrides: ClobFetchInit = {}
): ClobFetchInit {
  return {
    ...(options?.requestInit ?? {}),
    ...overrides,
    headers: {
      Accept: "application/json",
      ...(options?.headers ?? {}),
      ...(options?.requestInit?.headers ?? {}),
      ...(overrides.headers ?? {}),
    },
  };
}

async function readClobError(
  response: ClobFetchResponse,
  fallback: string
): Promise<string> {
  const data = await response.json().catch(() => null);

  if (isRecord(data)) {
    if (typeof data.error === "string" && data.error) return data.error;
    if (typeof data.message === "string" && data.message) return data.message;
  }

  return fallback;
}

function normalizeLevel(level: unknown): ClobOrderBookLevel | null {
  if (!isRecord(level)) return null;

  const { price, size } = level;
  const validPrice = typeof price === "string" || typeof price === "number";
  const validSize = typeof size === "string" || typeof size === "number";
  if (!validPrice || !validSize) return null;

  const priceString = String(price);
  const sizeString = String(size);
  if (!priceString || !sizeString) return null;

  return { price: priceString, size: sizeString };
}

function normalizeLevels(value: unknown): ClobOrderBookLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeLevel)
    .filter((level): level is ClobOrderBookLevel => level !== null);
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buildUnifiedPriceHistoryRequest(
  tokenId: string,
  params: ClobPriceHistoryParams
): {
  tokenId: string;
  startTs?: number;
  endTs?: number;
  fidelity?: number;
} {
  const request: {
    tokenId: string;
    startTs?: number;
    endTs?: number;
    fidelity?: number;
  } = { tokenId };
  const startTs = optionalNumber(params.startTs);
  const endTs = optionalNumber(params.endTs);
  const fidelity = optionalNumber(params.fidelity);
  if (startTs !== undefined) request.startTs = startTs;
  if (endTs !== undefined) request.endTs = endTs;
  if (fidelity !== undefined) request.fidelity = fidelity;
  return request;
}

export function buildClobPublicUrl(
  path: string,
  params?: Record<string, ClobQueryValue>,
  options?: Pick<ClobRequestOptions, "host">
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const [pathOnly, existingQuery] = normalizedPath.split("?", 2);
  const query = [existingQuery, encodeQuery(params)].filter(Boolean).join("&");

  return `${normalizeClobHost(options?.host)}${pathOnly}${
    query ? `?${query}` : ""
  }`;
}

export function normalizeClobOrderBook(raw: unknown): ClobOrderBook {
  const data = isRecord(raw) ? raw : {};

  return {
    market: optionalString(data.market),
    asset_id: optionalString(data.asset_id ?? data.tokenId),
    hash: optionalString(data.hash),
    timestamp: optionalString(data.timestamp),
    bids: normalizeLevels(data.bids),
    asks: normalizeLevels(data.asks),
    min_order_size: optionalString(data.min_order_size ?? data.minOrderSize),
    tick_size: optionalString(data.tick_size ?? data.tickSize),
    spread: optionalNumber(data.spread),
    midpoint: optionalNumber(data.midpoint),
  };
}

export async function fetchClobJson<T = unknown>(
  path: string,
  params?: Record<string, ClobQueryValue>,
  options?: ClobRequestOptions,
  init?: ClobFetchInit
): Promise<T> {
  const response = await getFetch(options)(
    buildClobPublicUrl(path, params, options),
    buildFetchInit(options, init)
  );

  if (!response.ok) {
    throw new ClobRequestError(
      await readClobError(
        response,
        `CLOB request failed: ${response.statusText || response.status}`
      ),
      response
    );
  }

  return (await response.json()) as T;
}

export async function fetchClobOrderBook(
  tokenId: string,
  options?: ClobRequestOptions
): Promise<ClobOrderBook> {
  if (canUseUnifiedSdkForPublicRead(options)) {
    if (options?.unifiedClient) {
      const data = await options.unifiedClient.fetchOrderBook({ tokenId });
      return normalizeClobOrderBook(data);
    }

    const { fetchUnifiedClobOrderBook } = await import(
      "./polymarket-unified.ts"
    );
    return fetchUnifiedClobOrderBook(tokenId);
  }

  const data = await fetchClobJson("book", { token_id: tokenId }, options);
  return normalizeClobOrderBook(data);
}

export async function fetchClobOrderBooks(
  tokenIds: readonly string[],
  options?: ClobRequestOptions
): Promise<ClobOrderBook[]> {
  if (tokenIds.length === 0) return [];

  if (canUseUnifiedSdkForPublicRead(options)) {
    if (options?.unifiedClient?.fetchOrderBooks) {
      const data = await options.unifiedClient.fetchOrderBooks(
        tokenIds.map((tokenId) => ({ tokenId }))
      );
      return Array.isArray(data) ? data.map(normalizeClobOrderBook) : [];
    }

    const { fetchUnifiedClobOrderBooks } = await import(
      "./polymarket-unified.ts"
    );
    return fetchUnifiedClobOrderBooks(tokenIds);
  }

  const data = await fetchClobJson<unknown>(
    "books?token_ids",
    undefined,
    options,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenIds.map((token_id) => ({ token_id }))),
    }
  );

  if (!Array.isArray(data)) return [];
  return data.map(normalizeClobOrderBook);
}

export function fetchClobMarket<T = unknown>(
  conditionId: string,
  options?: ClobRequestOptions
): Promise<T> {
  if (
    options?.useUnifiedSdk === true &&
    canUseUnifiedSdkForPublicRead(options)
  ) {
    if (options?.unifiedClient?.fetchMarketInfo) {
      return options.unifiedClient.fetchMarketInfo({
        conditionId,
      }) as Promise<T>;
    }

    return import("./polymarket-unified.ts").then(
      ({ fetchUnifiedClobMarket }) => fetchUnifiedClobMarket<T>(conditionId)
    );
  }

  return fetchClobJson<T>(
    `markets/${encodeURIComponent(conditionId)}`,
    undefined,
    options
  );
}

export function fetchClobTrades<T = unknown>(
  tokenId: string,
  options?: ClobRequestOptions
): Promise<T> {
  return fetchClobJson<T>("trades", { token_id: tokenId }, options);
}

export function fetchClobPrice<T = unknown>(
  tokenId: string,
  options?: ClobRequestOptions
): Promise<T> {
  if (options?.priceSide && canUseUnifiedSdkForPublicRead(options)) {
    if (options?.unifiedClient?.fetchPrice) {
      return options.unifiedClient.fetchPrice({
        tokenId,
        side: options.priceSide,
      }) as Promise<T>;
    }

    return import("./polymarket-unified.ts").then(({ fetchUnifiedClobPrice }) =>
      fetchUnifiedClobPrice<T>(tokenId, options.priceSide as TradingSide)
    );
  }

  return fetchClobJson<T>("price", { token_id: tokenId }, options);
}

export function fetchClobPriceHistory<T = ClobPriceHistoryResponse>(
  tokenId: string,
  params: ClobPriceHistoryParams = {},
  options?: ClobRequestOptions
): Promise<T> {
  if (canUseUnifiedSdkForPublicRead(options)) {
    if (options?.unifiedClient?.fetchPriceHistory) {
      return options.unifiedClient
        .fetchPriceHistory(buildUnifiedPriceHistoryRequest(tokenId, params))
        .then((data) => ({
          history: Array.isArray(data) ? data : [],
        })) as Promise<T>;
    }

    return import("./polymarket-unified.ts").then(
      ({ fetchUnifiedClobPriceHistory }) =>
        fetchUnifiedClobPriceHistory<T>(tokenId, params)
    );
  }

  return fetchClobJson<T>(
    "prices-history",
    {
      market: tokenId,
      startTs: params.startTs,
      endTs: params.endTs,
      fidelity: params.fidelity,
    },
    options
  );
}

/**
 * Bytes32 zero used by CLOB for "no builder" orders. Matches the SDK's
 * isBuilderOrder check (any builder code equal to this is treated as absent).
 */
const CLOB_BUILDER_CODE_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** CLOB returns builder fees in basis-points; divide by 1e4 to get the rate. */
const CLOB_BUILDER_FEES_BPS_DIVISOR = 10_000;

export interface ClobBuilderFeeRates {
  /** Maker fee rate as a fraction (e.g. 0.001 = 10 bps = 0.1 %). */
  maker: number;
  /** Taker fee rate as a fraction. */
  taker: number;
}

interface BuilderFeesResponse {
  builder_maker_fee_rate_bps?: number;
  builder_taker_fee_rate_bps?: number;
}

/**
 * Fetch the builder maker/taker fee rates for a given builder code from the
 * CLOB's public `/fees/builder-fees/{code}` endpoint. Returned as fractions
 * (already divided by 10_000). Both the place-order pre-flight and the
 * trading-panel preview must source builder fees from this endpoint — the
 * order-creation path does the same internally, and `getClobMarketInfo` does
 * not include builder-specific fees.
 *
 * Returns `{ maker: 0, taker: 0 }` when the builder code is missing or the
 * bytes32 zero sentinel.
 */
export async function fetchClobBuilderFeeRates(
  builderCode: string | undefined,
  options?: ClobRequestOptions
): Promise<ClobBuilderFeeRates> {
  if (!builderCode || builderCode === CLOB_BUILDER_CODE_ZERO) {
    return { maker: 0, taker: 0 };
  }

  if (canUseUnifiedSdkForPublicRead(options)) {
    if (options?.unifiedClient?.fetchBuilderFeeRates) {
      const data = await options.unifiedClient.fetchBuilderFeeRates({
        builderCode,
      });
      return normalizeClobBuilderFeeRates(data);
    }

    const { fetchUnifiedClobBuilderFeeRates } = await import(
      "./polymarket-unified.ts"
    );
    return fetchUnifiedClobBuilderFeeRates(builderCode);
  }

  const data = await fetchClobJson<BuilderFeesResponse>(
    `fees/builder-fees/${encodeURIComponent(builderCode)}`,
    undefined,
    options
  );

  return {
    maker:
      (data.builder_maker_fee_rate_bps ?? 0) / CLOB_BUILDER_FEES_BPS_DIVISOR,
    taker:
      (data.builder_taker_fee_rate_bps ?? 0) / CLOB_BUILDER_FEES_BPS_DIVISOR,
  };
}

function normalizeClobBuilderFeeRates(raw: unknown): ClobBuilderFeeRates {
  if (!isRecord(raw)) return { maker: 0, taker: 0 };
  const maker = optionalNumber(raw.maker) ?? 0;
  const taker = optionalNumber(raw.taker) ?? 0;
  return { maker, taker };
}
