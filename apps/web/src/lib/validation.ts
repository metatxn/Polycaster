/**
 * Input validation utilities for API routes and client-side code.
 *
 * Provides Ethereum address validation (with EIP-55 checksum via viem),
 * common input sanitization, and reusable validation helpers.
 */
import { getAddress, isAddress } from "viem";

/**
 * Validate an Ethereum address.
 *
 * Uses viem's `isAddress` which:
 * - Checks basic format (0x + 40 hex chars)
 * - Verifies EIP-55 checksum if the address has mixed case
 * - Accepts all-lowercase and all-uppercase without checksum check
 *
 * @returns true if the address is valid
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Compute EIP-55 mixed-case checksum for an Ethereum address.
 * Returns the checksummed address or null if the input is invalid.
 *
 * Reference: https://eips.ethereum.org/EIPS/eip-55
 */
export function toChecksumAddress(address: string): string | null {
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

/**
 * Normalize an Ethereum address to lowercase with 0x prefix.
 * Returns null if the address is invalid.
 */
export function normalizeAddress(address: string): string | null {
  if (!isAddress(address)) return null;
  return address.toLowerCase() as `0x${string}`;
}

/**
 * Sanitize a string input: trim, limit length, remove control characters.
 */
export function sanitizeString(input: string, maxLength = 500): string {
  return (
    input
      .trim()
      .slice(0, maxLength)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control characters for security
      .replace(/[\x00-\x1f\x7f]/g, "")
  );
}

/**
 * Validate and sanitize a search query string.
 */
export function sanitizeSearchQuery(query: string, maxLength = 200): string {
  return sanitizeString(query, maxLength).replace(/[<>"'`;\\]/g, ""); // Remove characters that could be used for injection
}
