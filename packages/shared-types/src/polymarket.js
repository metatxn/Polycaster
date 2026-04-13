/**
 * Polymarket API URLs, auth constants, and configuration
 *
 * Reference: https://docs.polymarket.com/developers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RELAYER_API_URL =
  exports.SIGNATURE_TYPES =
  exports.CLOB_AUTH_MESSAGE =
  exports.CLOB_AUTH_TYPES =
  exports.CLOB_AUTH_DOMAIN =
  exports.ORDER_CONFIG =
  exports.POLYMARKET_CHAIN =
  exports.POLYMARKET_API =
  exports.POLYGON_CHAIN_ID_HEX =
  exports.POLYGON_CHAIN_ID =
    void 0;
exports.resolveNegRisk = resolveNegRisk;
exports.POLYGON_CHAIN_ID = 137;
exports.POLYGON_CHAIN_ID_HEX = "0x89";
function parseBooleanLike(value) {
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
function resolveNegRisk(...sources) {
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
exports.POLYMARKET_API = {
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
};
exports.POLYMARKET_CHAIN = {
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
};
exports.ORDER_CONFIG = {
  MIN_PRICE: 0.01,
  MAX_PRICE: 0.99,
  MIN_SIZE: 1,
  DEFAULT_EXPIRATION_SECONDS: 300,
};
/** EIP-712 Domain for CLOB Authentication */
exports.CLOB_AUTH_DOMAIN = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: exports.POLYGON_CHAIN_ID,
};
/** EIP-712 Types for CLOB Authentication */
exports.CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
};
/** Message to sign for CLOB authentication */
exports.CLOB_AUTH_MESSAGE =
  "This message attests that I control the given wallet";
/** Signature types for CLOB client */
exports.SIGNATURE_TYPES = {
  EOA: 0,
  POLY_PROXY: 1,
  POLY_GNOSIS_SAFE: 2,
};
exports.RELAYER_API_URL = exports.POLYMARKET_API.RELAYER.BASE;
