/**
 * Polymarket API URLs, auth constants, and configuration
 *
 * Reference: https://docs.polymarket.com/developers
 */

declare function setTimeout(callback: () => void, delay?: number): unknown;

export const POLYGON_CHAIN_ID = 137;
export const POLYGON_CHAIN_ID_HEX = "0x89";

// ── Trading Types ──

export const CLOB_ORDER_TYPES = {
  GTC: "GTC",
  GTD: "GTD",
  FOK: "FOK",
  FAK: "FAK",
} as const;

export const TRADING_SIDES = {
  BUY: "BUY",
  SELL: "SELL",
} as const;

export const ORDER_TYPE_SELECTIONS = {
  LIMIT: "LIMIT",
  MARKET: "MARKET",
} as const;

/**
 * Order side values matching Polymarket's numeric CLOB SDK constants.
 */
export const CLOB_ORDER_SIDES = {
  BUY: 0,
  SELL: 1,
} as const;

export const CLOB_ASSET_TYPES = {
  COLLATERAL: "COLLATERAL",
  CONDITIONAL: "CONDITIONAL",
} as const;

export const TRADING_WALLET_MODES = {
  DEPOSIT: "deposit",
  SAFE: "safe",
  EOA: "eoa",
} as const;

export const SHOW_EOA_OPTION = false;

export type ClobOrderType =
  (typeof CLOB_ORDER_TYPES)[keyof typeof CLOB_ORDER_TYPES];
export type TradingSide = (typeof TRADING_SIDES)[keyof typeof TRADING_SIDES];
export type OrderTypeSelection =
  (typeof ORDER_TYPE_SELECTIONS)[keyof typeof ORDER_TYPE_SELECTIONS];
export type ClobOrderSide =
  (typeof CLOB_ORDER_SIDES)[keyof typeof CLOB_ORDER_SIDES];
export type ClobAssetType =
  (typeof CLOB_ASSET_TYPES)[keyof typeof CLOB_ASSET_TYPES];
export type TradingWalletMode =
  (typeof TRADING_WALLET_MODES)[keyof typeof TRADING_WALLET_MODES];

export interface ClobBalanceAllowanceTarget {
  assetType: ClobAssetType;
  tokenId?: string;
}

export interface ClobBalanceAllowanceClient {
  updateBalanceAllowance(args: ClobBalanceAllowanceTarget): Promise<unknown>;
}

export interface ClobBalanceAllowanceSyncOptions {
  tokenId?: string;
  tokenIds?: ReadonlyArray<string | null | undefined>;
  includeCollateral?: boolean;
  includeConditional?: boolean;
}

export interface ApiKeyCreds {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

export type ApiKeyCredsLike = Partial<ApiKeyCreds> & {
  key?: string;
  apiKey?: string;
  secret?: string;
  apiSecret?: string;
  passphrase?: string;
  apiPassphrase?: string;
  error?: string;
};

export type ClobApiKeyMethod = "create" | "derive";

export interface ClobL1Headers {
  POLY_ADDRESS: string;
  POLY_SIGNATURE: string;
  POLY_TIMESTAMP: string;
  POLY_NONCE: string;
}

export interface ClobAuthInput {
  address: string;
  timestamp?: string | number;
  nonce?: string | number | bigint;
}

export interface ClobApiKeyFetchInit {
  method?: string;
  headers?: Record<string, string>;
}

export interface ClobApiKeyFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type ClobApiKeyFetch = (
  input: string,
  init?: ClobApiKeyFetchInit
) => Promise<ClobApiKeyFetchResponse>;

export interface ClobApiKeyRequestOptions {
  fetchImpl?: ClobApiKeyFetch;
}

export interface ClobApiKeyAttemptResult {
  success: boolean;
  data?: ApiKeyCreds;
  raw?: ApiKeyCredsLike;
  error?: string;
  status?: number;
}

export interface ClobCreateOrDeriveApiKeyResult {
  success: boolean;
  method?: ClobApiKeyMethod;
  data?: ApiKeyCreds;
  raw?: ApiKeyCredsLike;
  createError?: string;
  deriveError?: string;
}

export interface CreateOrderParams {
  tokenId: string;
  price: number;
  size: number;
  side: TradingSide;
  orderType?: ClobOrderType;
  expiration?: number;
  negRisk?: boolean;
}

export interface NegRiskLike {
  negRisk?: unknown;
  enableNegRisk?: unknown;
  negRiskAugmented?: unknown;
  neg_risk?: unknown;
  enable_neg_risk?: unknown;
}

function parseBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0" || normalized === "") {
      return false;
    }
  }
  return undefined;
}

/**
 * Resolves Polymarket's neg-risk flag across the field names used by
 * different Gamma and market-detail payloads.
 */
export function resolveNegRisk(
  ...sources: Array<NegRiskLike | null | undefined>
): boolean {
  for (const source of sources) {
    if (!source) continue;

    const values = [
      source.negRisk,
      source.enableNegRisk,
      source.negRiskAugmented,
      source.neg_risk,
      source.enable_neg_risk,
    ];

    for (const value of values) {
      const parsed = parseBooleanLike(value);
      if (parsed) {
        return true;
      }
    }
  }

  return false;
}

export type GammaArrayField = string | readonly unknown[] | null | undefined;

export interface GammaArrayParseError {
  field?: string;
  label?: string;
  raw: string;
  error: unknown;
}

export interface ParseGammaArrayOptions {
  field?: string;
  label?: string;
  fallbackCsv?: boolean;
  onError?: (error: GammaArrayParseError) => void;
}

export interface GammaMarketTokenLike {
  token_id?: string | number | null;
  tokenId?: string | number | null;
  outcome?: string | null;
}

export interface GammaMarketPayloadLike extends NegRiskLike {
  outcomes?: GammaArrayField;
  outcomePrices?: GammaArrayField;
  clobTokenIds?: GammaArrayField;
  tokens?: readonly GammaMarketTokenLike[] | null;
}

export interface ParsedGammaMarketPayload {
  outcomes: string[];
  outcomePrices: string[];
  outcomePriceNumbers: number[];
  clobTokenIds: string[];
  tokens: GammaMarketTokenLike[];
}

export interface GammaYesNoMarketFields extends ParsedGammaMarketPayload {
  yesIndex: number;
  noIndex: number;
  yesPrice?: string;
  noPrice?: string;
  yesTokenId: string;
  noTokenId: string;
}

function optionsForGammaField(
  options: ParseGammaArrayOptions | undefined,
  field: string
): ParseGammaArrayOptions {
  return {
    ...options,
    field,
  };
}

function stringifyGammaArrayValue(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

export function parseGammaArrayField(
  raw: GammaArrayField,
  options: ParseGammaArrayOptions = {}
): unknown[] {
  if (Array.isArray(raw)) return [...raw];
  if (typeof raw !== "string" || raw.trim() === "") return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (error) {
    options.onError?.({
      field: options.field,
      label: options.label,
      raw,
      error,
    });

    if (options.fallbackCsv) {
      return raw
        .split(",")
        .map((value) => value.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    }
  }

  return [];
}

/**
 * Gamma often returns market array fields as JSON strings. This helper accepts
 * both already-expanded arrays and stringified arrays and fails closed to [].
 */
export function parseGammaStringArray(
  raw: GammaArrayField,
  options?: ParseGammaArrayOptions
): string[] {
  return parseGammaArrayField(raw, options).map(stringifyGammaArrayValue);
}

export function parseGammaNumberArray(
  raw: GammaArrayField,
  options?: ParseGammaArrayOptions
): number[] {
  return parseGammaArrayField(raw, options)
    .map((value) =>
      typeof value === "number"
        ? value
        : Number.parseFloat(stringifyGammaArrayValue(value))
    )
    .filter((value) => Number.isFinite(value));
}

export function parseGammaMarketPayload(
  market: GammaMarketPayloadLike | null | undefined,
  options?: ParseGammaArrayOptions
): ParsedGammaMarketPayload {
  return {
    outcomes: parseGammaStringArray(
      market?.outcomes,
      optionsForGammaField(options, "outcomes")
    ),
    outcomePrices: parseGammaStringArray(
      market?.outcomePrices,
      optionsForGammaField(options, "outcomePrices")
    ),
    outcomePriceNumbers: parseGammaNumberArray(
      market?.outcomePrices,
      optionsForGammaField(options, "outcomePrices")
    ),
    clobTokenIds: parseGammaStringArray(
      market?.clobTokenIds,
      optionsForGammaField(options, "clobTokenIds")
    ),
    tokens: Array.isArray(market?.tokens) ? [...market.tokens] : [],
  };
}

export function findGammaOutcomeIndex(
  outcomes: readonly string[],
  label: string
): number {
  const normalizedLabel = label.toLowerCase();
  return outcomes.findIndex(
    (outcome) => outcome.toLowerCase() === normalizedLabel
  );
}

function getGammaTokenIdFromToken(token: GammaMarketTokenLike | undefined) {
  const tokenId = token?.token_id ?? token?.tokenId;
  return tokenId === undefined || tokenId === null ? "" : String(tokenId);
}

export function getGammaTokenIdForOutcome(
  market: GammaMarketPayloadLike | null | undefined,
  outcomeIndex: number,
  options?: ParseGammaArrayOptions
): string {
  const parsed = parseGammaMarketPayload(market, options);
  const outcomeName = parsed.outcomes[outcomeIndex]?.toLowerCase();

  if (outcomeName) {
    const token = parsed.tokens.find(
      (candidate) => candidate.outcome?.toLowerCase() === outcomeName
    );
    const tokenId = getGammaTokenIdFromToken(token);
    if (tokenId) return tokenId;
  }

  return parsed.clobTokenIds[outcomeIndex] ?? "";
}

export function getGammaYesNoMarketFields(
  market: GammaMarketPayloadLike | null | undefined,
  options?: ParseGammaArrayOptions
): GammaYesNoMarketFields {
  const parsed = parseGammaMarketPayload(market, options);
  const yesIndex = findGammaOutcomeIndex(parsed.outcomes, "yes");
  const noIndex = findGammaOutcomeIndex(parsed.outcomes, "no");
  const yesToken = parsed.tokens.find(
    (token) => token.outcome?.toLowerCase() === "yes"
  );
  const noToken = parsed.tokens.find(
    (token) => token.outcome?.toLowerCase() === "no"
  );

  return {
    ...parsed,
    yesIndex,
    noIndex,
    yesPrice:
      yesIndex !== -1
        ? parsed.outcomePrices[yesIndex]
        : parsed.outcomePrices[0],
    noPrice:
      noIndex !== -1 ? parsed.outcomePrices[noIndex] : parsed.outcomePrices[1],
    yesTokenId:
      getGammaTokenIdFromToken(yesToken) ||
      (yesIndex !== -1
        ? parsed.clobTokenIds[yesIndex]
        : parsed.clobTokenIds[0]) ||
      "",
    noTokenId:
      getGammaTokenIdFromToken(noToken) ||
      (noIndex !== -1
        ? parsed.clobTokenIds[noIndex]
        : parsed.clobTokenIds[1]) ||
      "",
  };
}

function stringifyClobPostOrderError(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value == null) return null;

  try {
    const serialized = JSON.stringify(value);
    if (serialized && serialized !== "{}") return serialized;
  } catch {
    // Fall through to String(value).
  }

  const fallback = String(value).trim();
  return fallback || null;
}

export function getClobPostOrderError(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;

  const record = response as {
    success?: unknown;
    error?: unknown;
    errorMsg?: unknown;
    message?: unknown;
  };
  const responseKeys = Object.keys(response);
  const hasError = responseKeys.includes("error");
  const errorMessage = stringifyClobPostOrderError(record.error);
  const errorMsg = stringifyClobPostOrderError(record.errorMsg);

  if (errorMessage) return errorMessage;
  if (errorMsg) return errorMsg;

  if (record.success === false || (hasError && record.error !== undefined)) {
    return (
      stringifyClobPostOrderError(record.message) ?? "Order rejected by CLOB"
    );
  }

  return null;
}

export function assertClobPostOrderSuccess(response: unknown): void {
  const errorMessage = getClobPostOrderError(response);
  if (errorMessage) throw new Error(errorMessage);
}

/**
 * POST /order rejections the CLOB asks the caller to retry:
 * - "order manager not ready, please retry" / "Service is not ready" — the
 *   market's order manager is warming up and never took the order.
 * - 425 Too Early — "The matching engine is restarting. Retry with
 *   exponential backoff." (docs.polymarket.com/resources/error-codes)
 *
 * Deliberately do not retry generic 500/transport failures: unlike these
 * explicit rejection states, they do not prove the order was rejected.
 */
const TRANSIENT_CLOB_POST_ORDER_PATTERNS: readonly RegExp[] = [
  /\bnot ready\b/i,
  /\bmatching engine is (?:re)?starting\b/i,
];

export function isTransientClobPostOrderError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 425
  ) {
    return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return TRANSIENT_CLOB_POST_ORDER_PATTERNS.some((pattern) =>
    pattern.test(message)
  );
}

export interface ClobPostOrderRetryOptions {
  /** Waits between attempts; attempts = delays + 1. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; error: string }) => void;
}

const DEFAULT_CLOB_POST_ORDER_RETRY_DELAYS_MS: readonly number[] = [
  500, 1000, 2000,
];

function defaultRetrySleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Post an order, absorbing the transient rejections above. The SDK's
 * `postOrder` path has no retry for these states, so a single "order manager
 * not ready, please retry" would otherwise surface as a failed sale.
 *
 * Handles both failure shapes: a thrown `RequestRejectedError` and a resolved
 * response whose body carries the rejection (`getClobPostOrderError`).
 */
export async function postClobOrderWithRetry<T>(
  post: () => Promise<T>,
  options: ClobPostOrderRetryOptions = {}
): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_CLOB_POST_ORDER_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultRetrySleep;

  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt >= delays.length;
    let errorMessage: string;
    try {
      const response = await post();
      const bodyError = getClobPostOrderError(response);
      const isTransientResponse =
        isTransientClobPostOrderError(response) ||
        (bodyError !== null && isTransientClobPostOrderError(bodyError));
      if (isLastAttempt || !isTransientResponse) {
        return response;
      }
      errorMessage = bodyError ?? "CLOB order post rejected with status 425";
    } catch (error) {
      if (isLastAttempt || !isTransientClobPostOrderError(error)) throw error;
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    options.onRetry?.({ attempt: attempt + 1, error: errorMessage });
    await sleep(delays[attempt]);
  }
}

export function buildClobBalanceAllowanceTargets(
  options: ClobBalanceAllowanceSyncOptions = {}
): ClobBalanceAllowanceTarget[] {
  const targets: ClobBalanceAllowanceTarget[] = [];
  const tokenIds = [options.tokenId, ...(options.tokenIds ?? [])].filter(
    (tokenId): tokenId is string => Boolean(tokenId)
  );
  const uniqueTokenIds = Array.from(new Set(tokenIds));
  const includeCollateral = options.includeCollateral ?? true;
  const includeConditional =
    options.includeConditional ?? uniqueTokenIds.length > 0;

  if (includeCollateral) {
    targets.push({ assetType: CLOB_ASSET_TYPES.COLLATERAL });
  }

  if (includeConditional) {
    if (uniqueTokenIds.length === 0) {
      throw new Error("CLOB conditional balance sync requires a token ID");
    }

    for (const tokenId of uniqueTokenIds) {
      targets.push({
        assetType: CLOB_ASSET_TYPES.CONDITIONAL,
        tokenId,
      });
    }
  }

  return targets;
}

export async function syncClobBalanceAllowance(
  client: ClobBalanceAllowanceClient,
  options: ClobBalanceAllowanceSyncOptions = {}
): Promise<void> {
  for (const target of buildClobBalanceAllowanceTargets(options)) {
    await client.updateBalanceAllowance(target);
  }
}

export const POLYMARKET_API = {
  GAMMA: {
    BASE: "https://gamma-api.polymarket.com",
    TEAMS: "https://gamma-api.polymarket.com/teams",
    SPORTS: "https://gamma-api.polymarket.com/sports",
    MARKETS: "https://gamma-api.polymarket.com/markets",
    MARKETS_KEYSET: "https://gamma-api.polymarket.com/markets/keyset",
    EVENTS: "https://gamma-api.polymarket.com/events",
    EVENTS_KEYSET: "https://gamma-api.polymarket.com/events/keyset",
    EVENTS_PAGINATION: "https://gamma-api.polymarket.com/events/pagination",
    COMMENTS: "https://gamma-api.polymarket.com/comments",
  },
  CLOB: {
    BASE: "https://clob.polymarket.com",
  },
  DATA: {
    BASE: "https://data-api.polymarket.com",
    HOLDERS: "https://data-api.polymarket.com/holders",
  },
  USER_PNL: {
    BASE: "https://user-pnl-api.polymarket.com",
  },
  RELAYER: {
    BASE: "https://relayer-v2.polymarket.com/",
  },
  STRAPI: {
    BASE: "https://strapi-matic.poly.market",
  },
  WSS: {
    MARKET: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    USER: "wss://ws-subscriptions-clob.polymarket.com/ws/user",
    SPORTS: "wss://sports-api.polymarket.com/ws",
  },
} as const;

export const POLYMARKET_CHAIN = {
  POLYGON_MAINNET: {
    CHAIN_ID: 137,
    NAME: "Polygon Mainnet",
    CURRENCY: "POL",
    RPC_URL: "https://polygon-rpc.com",
    BLOCK_EXPLORER: "https://polygonscan.com",
  },
  POLYGON_AMOY: {
    CHAIN_ID: 80002,
    NAME: "Polygon Amoy Testnet",
    CURRENCY: "POL",
    RPC_URL: "https://rpc-amoy.polygon.technology/",
    BLOCK_EXPLORER: "https://amoy.polygonscan.com",
  },
} as const;

export const ORDER_CONFIG = {
  MIN_PRICE: 0.01,
  MAX_PRICE: 0.99,
  MIN_SIZE: 1,
  DEFAULT_EXPIRATION_SECONDS: 300,
} as const;

/** EIP-712 Domain for CLOB Authentication */
export const CLOB_AUTH_DOMAIN = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: POLYGON_CHAIN_ID,
} as const;

/** EIP-712 Types for CLOB Authentication */
export const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
} as const;

/** Message to sign for CLOB authentication */
export const CLOB_AUTH_MESSAGE =
  "This message attests that I control the given wallet";

/** Signature types for CLOB client */
export const SIGNATURE_TYPES = {
  EOA: 0,
  POLY_PROXY: 1,
  POLY_GNOSIS_SAFE: 2,
  POLY_1271: 3,
} as const;

export type PolymarketSignatureType =
  (typeof SIGNATURE_TYPES)[keyof typeof SIGNATURE_TYPES];

export function normalizeTradingWalletMode(
  mode?: string | null
): TradingWalletMode {
  if (mode === TRADING_WALLET_MODES.DEPOSIT) {
    return TRADING_WALLET_MODES.DEPOSIT;
  }
  if (mode === TRADING_WALLET_MODES.EOA) return TRADING_WALLET_MODES.EOA;
  if (mode === TRADING_WALLET_MODES.SAFE) return TRADING_WALLET_MODES.SAFE;
  return TRADING_WALLET_MODES.SAFE;
}

export function resolvePreferredTradingWalletMode(args: {
  storedMode?: string | null;
  legacySafeDeployed: boolean;
}): TradingWalletMode {
  if (args.legacySafeDeployed) return TRADING_WALLET_MODES.SAFE;
  if (args.storedMode === TRADING_WALLET_MODES.EOA && SHOW_EOA_OPTION) {
    return TRADING_WALLET_MODES.EOA;
  }
  return TRADING_WALLET_MODES.DEPOSIT;
}

export function isEoaTradingWalletMode(mode?: string | null): boolean {
  return normalizeTradingWalletMode(mode) === TRADING_WALLET_MODES.EOA;
}

export function isSafeTradingWalletMode(mode?: string | null): boolean {
  return normalizeTradingWalletMode(mode) === TRADING_WALLET_MODES.SAFE;
}

export function isDepositTradingWalletMode(mode?: string | null): boolean {
  return normalizeTradingWalletMode(mode) === TRADING_WALLET_MODES.DEPOSIT;
}

export function getPolymarketSignatureType(
  mode?: string | null
): PolymarketSignatureType {
  const normalizedMode = normalizeTradingWalletMode(mode);
  if (normalizedMode === TRADING_WALLET_MODES.EOA) return SIGNATURE_TYPES.EOA;
  if (normalizedMode === TRADING_WALLET_MODES.SAFE) {
    return SIGNATURE_TYPES.POLY_GNOSIS_SAFE;
  }
  return SIGNATURE_TYPES.POLY_1271;
}

export const RELAYER_API_URL = POLYMARKET_API.RELAYER.BASE;

/** Relayer base URL with no trailing slash — for `${RELAYER_API_ORIGIN}/submit` style joins. */
export const RELAYER_API_ORIGIN = RELAYER_API_URL.replace(/\/$/, "");

/** Relayer hostname only (no protocol, no slash) — for ALLOWED_DOMAINS-style allowlists. */
export const RELAYER_API_HOST = RELAYER_API_ORIGIN.replace(/^https?:\/\//, "");

/** Chrome extension `host_permissions` match pattern for the relayer. */
export const RELAYER_API_HOST_PERMISSION = `https://${RELAYER_API_HOST}/*`;

export function normalizeApiKeyCreds(
  raw: ApiKeyCredsLike | null | undefined
): ApiKeyCreds {
  const apiKey = raw?.apiKey || raw?.key || "";
  const apiSecret = raw?.apiSecret || raw?.secret || "";
  const apiPassphrase = raw?.apiPassphrase || raw?.passphrase || "";

  if (!apiKey || !apiSecret || !apiPassphrase) {
    throw new Error("Polymarket returned incomplete API credentials");
  }

  return { apiKey, apiSecret, apiPassphrase };
}

export function isCompleteApiKeyCreds(raw: unknown): raw is ApiKeyCreds {
  if (!raw || typeof raw !== "object") return false;
  const creds = raw as Partial<ApiKeyCreds>;
  return Boolean(creds.apiKey && creds.apiSecret && creds.apiPassphrase);
}

function canNormalizeApiKeyCreds(raw: unknown): raw is ApiKeyCredsLike {
  try {
    normalizeApiKeyCreds(raw as ApiKeyCredsLike);
    return true;
  } catch {
    return false;
  }
}

export function buildClobL1Headers(params: {
  address: string;
  signature: string;
  timestamp: string | number;
  nonce?: string | number;
}): ClobL1Headers {
  return {
    POLY_ADDRESS: params.address,
    POLY_SIGNATURE: params.signature,
    POLY_TIMESTAMP: String(params.timestamp),
    POLY_NONCE: String(params.nonce ?? 0),
  };
}

function resolveClobAuthInput(input: ClobAuthInput): {
  address: string;
  timestamp: string;
  nonceString: string;
  nonceNumber: number;
  nonceBigInt: bigint;
} {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const nonceString = String(input.nonce ?? 0);
  const nonceBigInt = BigInt(nonceString);
  const nonceNumber = Number(nonceBigInt);

  if (!Number.isSafeInteger(nonceNumber)) {
    throw new Error("CLOB auth nonce is outside the safe integer range");
  }

  return {
    address: input.address,
    timestamp,
    nonceString,
    nonceNumber,
    nonceBigInt,
  };
}

export function buildClobAuthViemTypedData<TAddress extends string>(
  input: ClobAuthInput & { address: TAddress }
) {
  const auth = resolveClobAuthInput(input);

  return {
    timestamp: auth.timestamp,
    nonce: auth.nonceString,
    typedData: {
      domain: CLOB_AUTH_DOMAIN,
      types: CLOB_AUTH_TYPES,
      primaryType: "ClobAuth" as const,
      message: {
        address: auth.address as TAddress,
        timestamp: auth.timestamp,
        nonce: auth.nonceBigInt,
        message: CLOB_AUTH_MESSAGE,
      },
    },
  };
}

export function buildClobAuthRpcTypedData(input: ClobAuthInput) {
  const auth = resolveClobAuthInput(input);

  return {
    timestamp: auth.timestamp,
    nonce: auth.nonceNumber,
    typedData: {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
        ],
        ClobAuth: CLOB_AUTH_TYPES.ClobAuth,
      },
      primaryType: "ClobAuth" as const,
      domain: CLOB_AUTH_DOMAIN,
      message: {
        address: auth.address,
        timestamp: auth.timestamp,
        nonce: auth.nonceNumber,
        message: CLOB_AUTH_MESSAGE,
      },
    },
  };
}

function getApiKeyFetch(options?: ClobApiKeyRequestOptions): ClobApiKeyFetch {
  const fetchImpl =
    options?.fetchImpl ?? (globalThis as { fetch?: ClobApiKeyFetch }).fetch;

  if (!fetchImpl) {
    throw new Error("CLOB API-key fetch implementation unavailable");
  }

  return fetchImpl;
}

function parseApiKeyResponseText(responseText: string): ApiKeyCredsLike {
  try {
    return JSON.parse(responseText) as ApiKeyCredsLike;
  } catch {
    return { error: responseText };
  }
}

async function requestClobApiKey(
  clobHost: string,
  path: string,
  method: "GET" | "POST",
  headers: ClobL1Headers,
  options?: ClobApiKeyRequestOptions
): Promise<ClobApiKeyAttemptResult> {
  const response = await getApiKeyFetch(options)(`${clobHost}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  const responseText = await response.text();
  const raw = parseApiKeyResponseText(responseText);

  if (response.ok && canNormalizeApiKeyCreds(raw)) {
    return {
      success: true,
      data: normalizeApiKeyCreds(raw),
      raw,
      status: response.status,
    };
  }

  return {
    success: false,
    raw,
    error: raw.error || responseText,
    status: response.status,
  };
}

export function deriveClobApiKey(
  clobHost: string,
  headers: ClobL1Headers,
  options?: ClobApiKeyRequestOptions
): Promise<ClobApiKeyAttemptResult> {
  return requestClobApiKey(
    clobHost,
    "/auth/derive-api-key",
    "GET",
    headers,
    options
  );
}

export function createClobApiKey(
  clobHost: string,
  headers: ClobL1Headers,
  options?: ClobApiKeyRequestOptions
): Promise<ClobApiKeyAttemptResult> {
  return requestClobApiKey(clobHost, "/auth/api-key", "POST", headers, options);
}

export async function createOrDeriveClobApiKey(
  clobHost: string,
  headers: ClobL1Headers,
  options?: ClobApiKeyRequestOptions
): Promise<ClobCreateOrDeriveApiKeyResult> {
  const deriveResult = await deriveClobApiKey(clobHost, headers, options);

  if (deriveResult.success && deriveResult.data) {
    return {
      success: true,
      method: "derive",
      data: deriveResult.data,
      raw: deriveResult.raw,
    };
  }

  const createResult = await createClobApiKey(clobHost, headers, options);

  if (createResult.success && createResult.data) {
    return {
      success: true,
      method: "create",
      data: createResult.data,
      raw: createResult.raw,
    };
  }

  return {
    success: false,
    createError: createResult.error,
    deriveError: deriveResult.error,
  };
}
