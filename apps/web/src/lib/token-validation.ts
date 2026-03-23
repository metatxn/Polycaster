/**
 * Token ID validation utilities for Polymarket CLOB
 *
 * Polymarket token IDs (asset IDs) are typically long numeric strings
 * representing the token contract address or identifier.
 *
 * This module provides consistent validation across the codebase.
 */

/**
 * Minimum length for a valid Polymarket token ID
 * Token IDs are typically 77+ characters (numeric strings)
 * However, some test/dev environments may use shorter IDs
 *
 * We use 10 as a safe minimum that filters out obviously invalid values
 * while allowing flexibility for different environments
 */
export const MIN_TOKEN_ID_LENGTH = 10;

/**
 * Check if a token ID is valid for WebSocket subscription
 *
 * @param tokenId - The token ID to validate
 * @returns true if the token ID is valid for subscription
 */
export function isValidTokenId(tokenId: string | null | undefined): boolean {
  if (!tokenId) return false;
  if (typeof tokenId !== "string") return false;
  if (tokenId.trim().length < MIN_TOKEN_ID_LENGTH) return false;
  return true;
}

/**
 * Filter an array of token IDs to only valid ones
 *
 * @param tokenIds - Array of token IDs to filter
 * @returns Array of valid token IDs
 */
export function filterValidTokenIds(
  tokenIds: (string | null | undefined)[]
): string[] {
  return tokenIds.filter((id): id is string => isValidTokenId(id));
}

/**
 * Check if a token ID is valid for REST API calls
 * REST API is more lenient - any non-empty string is valid
 *
 * @param tokenId - The token ID to validate
 * @returns true if the token ID is valid for REST API
 */
export function isValidTokenIdForRest(
  tokenId: string | null | undefined
): boolean {
  if (!tokenId) return false;
  if (typeof tokenId !== "string") return false;
  return tokenId.trim().length > 0;
}

/**
 * Normalize a token ID (trim whitespace)
 *
 * @param tokenId - The token ID to normalize
 * @returns Normalized token ID or empty string if invalid
 */
export function normalizeTokenId(tokenId: string | null | undefined): string {
  if (!tokenId || typeof tokenId !== "string") return "";
  return tokenId.trim();
}
