/**
 * Polymarket utility functions and constants
 *
 * Note: All ClobClient operations have been moved to the frontend
 * using the useClobClient hook with the real user signer.
 *
 * This file now only contains utility functions for backend API routes
 * that need to make direct HTTP calls to the CLOB API.
 */

export enum Side {
  BUY = "BUY",
  SELL = "SELL",
}

/**
 * Order side enum matching Polymarket's CLOB numeric values
 */
export enum OrderSide {
  BUY = 0,
  SELL = 1,
}

export enum SignatureType {
  EOA = 0,
  POLY_PROXY = 1,
  POLY_GNOSIS_SAFE = 2,
}

/**
 * Calculate potential profit/loss for an order
 */
export function calculatePotentialPnL(
  price: number,
  size: number,
  side: OrderSide
): { cost: number; potentialWin: number; potentialLoss: number } {
  const cost = price * size;

  if (side === OrderSide.BUY) {
    // Buying YES: pay price * size, win size if YES, lose cost if NO
    return {
      cost,
      potentialWin: size - cost, // Profit = payout - cost
      potentialLoss: cost,
    };
  }
  // Selling YES (buying NO): pay (1-price) * size, win size if NO
  const noPrice = 1 - price;
  const noCost = noPrice * size;
  return {
    cost: noCost,
    potentialWin: size - noCost,
    potentialLoss: noCost,
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
 * Get the CLOB API host URL
 */
export function getClobHost(): string {
  return getEnvOptional("POLYMARKET_HOST") || "https://clob.polymarket.com";
}

/**
 * Get the chain ID
 */
export function getChainId(): number {
  return Number.parseInt(getEnvOptional("POLYMARKET_CHAIN_ID") || "137", 10);
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
  const host = getClobHost();
  const response = await fetch(`${host}/book?token_id=${tokenId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch order book: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch market info directly from CLOB API
 */
export async function fetchMarket(conditionId: string): Promise<unknown> {
  const host = getClobHost();
  const response = await fetch(`${host}/markets/${conditionId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch market: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch trades for a token directly from CLOB API
 */
export async function fetchTrades(tokenId: string): Promise<unknown> {
  const host = getClobHost();
  const response = await fetch(`${host}/trades?token_id=${tokenId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch trades: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch price for a token directly from CLOB API
 */
export async function fetchPrice(tokenId: string): Promise<unknown> {
  const host = getClobHost();
  const response = await fetch(`${host}/price?token_id=${tokenId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch price: ${response.statusText}`);
  }

  return response.json();
}
