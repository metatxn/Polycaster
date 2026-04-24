/**
 * Re-export shared Polymarket constants.
 * Core constants are defined in @knoww/shared-types.
 */

export type { ApiKeyCreds } from "@knoww/shared-types/polymarket";
export {
  CLOB_AUTH_DOMAIN,
  CLOB_AUTH_MESSAGE,
  CLOB_AUTH_TYPES,
  ORDER_CONFIG,
  POLYGON_CHAIN_ID,
  POLYMARKET_API,
  POLYMARKET_CHAIN,
  RELAYER_API_URL,
  SIGNATURE_TYPES,
} from "@knoww/shared-types/polymarket";

/**
 * Web-app-specific constants below
 */

/**
 * Single source of truth for the Polymarket CLOB REST host. Reads
 * NEXT_PUBLIC_POLYMARKET_HOST with a pre-cutover fallback. During V2 preprod
 * testing point this at https://clob-v2.polymarket.com; post-cutover the
 * primary host (https://clob.polymarket.com) serves V2.
 */
export const CLOB_BASE_URL =
  process.env.NEXT_PUBLIC_POLYMARKET_HOST || "https://clob-v2.polymarket.com";

/**
 * Single source of truth for the Polymarket CLOB WebSocket base host (no
 * path). Reads NEXT_PUBLIC_POLYMARKET_WS_HOST with a fallback. Per Polymarket
 * V2 migration docs WebSocket URLs are unchanged at cutover.
 */
export const CLOB_WS_BASE_URL =
  process.env.NEXT_PUBLIC_POLYMARKET_WS_HOST ||
  "wss://ws-subscriptions-clob.polymarket.com";

export const CLOB_WS_MARKET_URL = `${CLOB_WS_BASE_URL}/ws/market`;
export const CLOB_WS_USER_URL = `${CLOB_WS_BASE_URL}/ws/user`;

export const POLYMARKET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_POLYMARKET_CHAIN_ID || "137"
);

export const WEBSOCKET_CONFIG = {
  RECONNECT_DELAY_MS: 1000,
  MAX_RECONNECT_DELAY_MS: 30000,
  RECONNECT_BACKOFF: 2,
  MAX_SUBSCRIPTIONS_PER_CONNECTION: 50,
  HEARTBEAT_INTERVAL_MS: 30000,
  CONNECTION_TIMEOUT_MS: 10000,
} as const;

export const PAGINATION = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 100,
  DEFAULT_OFFSET: 0,
} as const;

export const CACHE_DURATION = {
  SPORTS_LIST: 3600,
  LEAGUES: 3600,
  TEAMS: 1800,
  MARKETS: 60,
  EVENTS: 60,
  PRICES: 10,
} as const;

export const API_LIMITS = {
  SPORTS: {
    MIN_LIMIT: 1,
    MAX_LIMIT: 100,
    DEFAULT_LIMIT: 100,
  },
  TEAMS: {
    MIN_LIMIT: 1,
    MAX_LIMIT: 100,
    DEFAULT_LIMIT: 100,
  },
  MARKETS: {
    MIN_LIMIT: 1,
    MAX_LIMIT: 100,
    DEFAULT_LIMIT: 50,
  },
  EVENTS: {
    MIN_LIMIT: 1,
    MAX_LIMIT: 100,
    DEFAULT_LIMIT: 50,
  },
} as const;

export const ERROR_MESSAGES = {
  SPORT_NOT_FOUND: "Sport not found",
  TEAM_NOT_FOUND: "Team not found",
  MARKET_NOT_FOUND: "Market not found",
  EVENT_NOT_FOUND: "Event not found",
  INVALID_TAG_ID: "Invalid tag ID provided",
  GAMMA_API_ERROR: "Gamma API error",
  CLOB_API_ERROR: "CLOB API error",
  INVALID_CREDENTIALS:
    "API Credentials are needed to interact with this endpoint!",
  UNKNOWN_ERROR: "Unknown error occurred",
} as const;

export const API_VERSION = "1.0.0" as const;
