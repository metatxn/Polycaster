/**
 * Polymarket utility functions and constants
 *
 * Note: All ClobClient operations have been moved to the frontend
 * using the useClobClient hook with the real user signer.
 *
 * This file now only contains utility functions for backend API routes
 * that need to make direct HTTP calls to the CLOB API.
 */

import {
  fetchClobJson,
  fetchClobMarket,
  fetchClobPrice,
  fetchClobTrades,
} from "@knoww/shared-types/clob";
import {
  CLOB_ORDER_SIDES,
  type ClobOrderSide,
  SIGNATURE_TYPES,
  TRADING_SIDES,
  type TradingSide,
} from "@knoww/shared-types/polymarket";
import Decimal from "decimal.js";

export const Side = TRADING_SIDES;
export type Side = TradingSide;

/**
 * Order side enum matching Polymarket's CLOB numeric values
 */
export const OrderSide = CLOB_ORDER_SIDES;
export type OrderSide = ClobOrderSide;

export const SignatureType = SIGNATURE_TYPES;
export type SignatureType =
  (typeof SIGNATURE_TYPES)[keyof typeof SIGNATURE_TYPES];

/**
 * Calculate potential profit/loss for an order.
 * Uses Decimal.js internally to avoid floating-point rounding errors.
 *
 * BUY:  pay price×size USDC → receive `size` shares → if outcome wins, payout = size ($1/share)
 * SELL: sell `size` shares at `price` → receive price×size USDC (gross, pre-fee)
 */
export function calculatePotentialPnL(
  price: number,
  size: number,
  side: OrderSide
): {
  cost: number;
  proceeds: number;
  potentialWin: number;
  potentialLoss: number;
} {
  const p = new Decimal(price);
  const s = new Decimal(size);

  if (side === OrderSide.BUY) {
    const cost = p.mul(s);
    return {
      cost: cost.toNumber(),
      proceeds: 0,
      potentialWin: s.sub(cost).toNumber(),
      potentialLoss: cost.toNumber(),
    };
  }

  // SELL orders do not spend capital; they realize immediate proceeds.
  const proceeds = p.mul(s);
  return {
    cost: 0,
    proceeds: proceeds.toNumber(),
    potentialWin: 0,
    potentialLoss: s.sub(proceeds).toNumber(),
  };
}

/**
 * Get environment variable or throw error if not found
 */
function _getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is not defined`);
  }
  return value;
}

/**
 * Get environment variable (optional)
 */
function getEnvOptional(key: string): string | undefined {
  return process.env[key];
}

/**
 * Get the CLOB API host URL. Server-only code may set POLYMARKET_HOST to
 * override the shared NEXT_PUBLIC_POLYMARKET_HOST value (e.g. to route server
 * requests through an internal mirror); otherwise it inherits the client
 * value.
 */
export function getClobHost(): string {
  return (
    getEnvOptional("POLYMARKET_HOST") ||
    getEnvOptional("NEXT_PUBLIC_POLYMARKET_HOST") ||
    "https://clob.polymarket.com"
  );
}

/**
 * Get the chain ID
 */
export function getChainId(): number {
  return Number.parseInt(
    getEnvOptional("POLYMARKET_CHAIN_ID") ||
      getEnvOptional("NEXT_PUBLIC_POLYMARKET_CHAIN_ID") ||
      "137",
    10
  );
}

/**
 * Default allowed origins when ALLOWED_ORIGINS env var is not set.
 * Never default to ["*"] in production — explicitly list allowed domains.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  "https://knoww.app",
  "https://www.knoww.app",
  "http://localhost:8000",
  "http://localhost:8787",
] as const;

/**
 * Get allowed origins for CORS (used in API routes)
 */
export function getAllowedOrigins(): string[] {
  const origins = process.env.ALLOWED_ORIGINS;
  if (!origins) {
    return [...DEFAULT_ALLOWED_ORIGINS];
  }
  return origins.split(",").map((origin) => origin.trim());
}

/**
 * Fetch order book directly from CLOB API
 * This is a read-only operation that doesn't require authentication
 */
export async function fetchOrderBook(tokenId: string): Promise<unknown> {
  return fetchClobJson("book", { token_id: tokenId }, { host: getClobHost() });
}

/**
 * Fetch market info directly from CLOB API
 */
export async function fetchMarket(
  conditionId: string,
  signal?: AbortSignal
): Promise<unknown> {
  return fetchClobMarket(conditionId, {
    host: getClobHost(),
    ...(signal ? { requestInit: { signal } } : {}),
  });
}

/**
 * Fetch trades for a token directly from CLOB API
 */
export async function fetchTrades(tokenId: string): Promise<unknown> {
  return fetchClobTrades(tokenId, { host: getClobHost() });
}

/**
 * Fetch price for a token directly from CLOB API
 */
export async function fetchPrice(tokenId: string): Promise<unknown> {
  return fetchClobPrice(tokenId, { host: getClobHost() });
}
