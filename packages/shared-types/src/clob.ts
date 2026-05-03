import { POLYMARKET_API } from "./polymarket";

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

export interface ClobRequestOptions {
  host?: string;
  fetchImpl?: ClobFetch;
  headers?: ClobHeaders;
  requestInit?: ClobFetchInit;
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
    asset_id: optionalString(data.asset_id),
    hash: optionalString(data.hash),
    timestamp: optionalString(data.timestamp),
    bids: normalizeLevels(data.bids),
    asks: normalizeLevels(data.asks),
    min_order_size: optionalString(data.min_order_size),
    tick_size: optionalString(data.tick_size),
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
  const data = await fetchClobJson("book", { token_id: tokenId }, options);
  return normalizeClobOrderBook(data);
}

export async function fetchClobOrderBooks(
  tokenIds: readonly string[],
  options?: ClobRequestOptions
): Promise<ClobOrderBook[]> {
  if (tokenIds.length === 0) return [];

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
  return fetchClobJson<T>("price", { token_id: tokenId }, options);
}

export function fetchClobPriceHistory<T = ClobPriceHistoryResponse>(
  tokenId: string,
  params: ClobPriceHistoryParams = {},
  options?: ClobRequestOptions
): Promise<T> {
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
