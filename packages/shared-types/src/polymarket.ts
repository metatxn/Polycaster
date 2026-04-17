/**
 * Polymarket API URLs, auth constants, and configuration
 *
 * Reference: https://docs.polymarket.com/developers
 */

export const POLYGON_CHAIN_ID = 137;
export const POLYGON_CHAIN_ID_HEX = "0x89";

// ── Trading Types ──

export type ClobOrderType = "GTC" | "GTD" | "FOK" | "FAK";
export type TradingSide = "BUY" | "SELL";
export type OrderTypeSelection = "LIMIT" | "MARKET";

export interface ApiKeyCreds {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
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
} as const;

export const RELAYER_API_URL = POLYMARKET_API.RELAYER.BASE;
