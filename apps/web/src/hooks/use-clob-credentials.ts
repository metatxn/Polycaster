"use client";

import { createLogger } from "@knoww/logger";
import {
  type ApiKeyCreds,
  type ApiKeyCredsLike,
  buildClobAuthViemTypedData,
  isCompleteApiKeyCreds,
  normalizeApiKeyCreds,
} from "@knoww/shared-types/polymarket";
import {
  createUnifiedPolymarketSecureClient,
  createUnifiedPolymarketViemSigner,
} from "@knoww/shared-types/polymarket-unified";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";
import { CLOB_BASE_URL } from "@/constants/polymarket";
import { getViemWalletClient } from "@/lib/viem-wallet-client";

const log = createLogger("clob-credentials");

export type { ApiKeyCreds } from "@knoww/shared-types/polymarket";

/**
 * Storage key prefix for credentials
 */
const CREDS_STORAGE_KEY = "polymarket_api_creds";

/**
 * Module-level cache for credentials to avoid repeated sessionStorage reads
 * and JSON parsing across multiple component mounts.
 * Cache is invalidated when credentials are stored or cleared.
 */
const credentialsCache = new Map<string, ApiKeyCreds | null>();

function getCacheKey(address: string): string {
  return `${CLOB_BASE_URL}_${address.toLowerCase()}`;
}

/**
 * Get the storage key for a specific address
 */
function getStorageKey(address: string): string {
  return `${CREDS_STORAGE_KEY}_${CLOB_BASE_URL}_${address.toLowerCase()}`;
}

/**
 * Get stored credentials from sessionStorage (cleared when browser closes)
 * Uses module-level cache to avoid repeated storage reads and JSON parsing.
 * This provides better security than localStorage as credentials don't persist indefinitely.
 */
function getStoredCredentials(address: string): ApiKeyCreds | null {
  if (typeof window === "undefined") return null;

  const cacheKey = getCacheKey(address);

  // Return cached value if available (defensive copy to prevent cache corruption)
  if (credentialsCache.has(cacheKey)) {
    const cached = credentialsCache.get(cacheKey);
    return cached ? { ...cached } : null;
  }

  try {
    const stored = sessionStorage.getItem(getStorageKey(address));
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (!isCompleteApiKeyCreds(parsed)) {
        sessionStorage.removeItem(getStorageKey(address));
        credentialsCache.set(cacheKey, null);
        return null;
      }
      credentialsCache.set(cacheKey, parsed);
      // Return defensive copy to prevent cache corruption from caller mutations
      return { ...parsed };
    }
  } catch {
    // Ignore parse errors
  }

  credentialsCache.set(cacheKey, null);
  return null;
}

/**
 * Store credentials in sessionStorage (cleared when browser closes)
 * Updates the module-level cache for consistency.
 * This provides better security than localStorage as credentials don't persist indefinitely.
 *
 * Security: CodeQL flags this as clear-text storage of sensitive data.
 * sessionStorage is origin-locked, tab-scoped, and cleared on tab close.
 * These are re-derivable CLOB API credentials (not passwords); encrypting them
 * here adds no real protection since XSS can access the decryption key in the
 * same JS context. This matches the standard Polymarket credential flow.
 */
function storeCredentials(address: string, creds: ApiKeyCreds): void {
  if (typeof window === "undefined") return;
  const cacheKey = getCacheKey(address);
  try {
    // lgtm[js/clear-text-storage-of-sensitive-data]
    sessionStorage.setItem(getStorageKey(address), JSON.stringify(creds));
    // Store shallow copy to prevent external mutations from corrupting cache
    // Only update cache if sessionStorage write succeeded
    credentialsCache.set(cacheKey, { ...creds });
  } catch {
    // sessionStorage may throw if quota exceeded or in private browsing
    // Still update in-memory cache for current session functionality
    credentialsCache.set(cacheKey, { ...creds });
  }
}

/**
 * Clear stored credentials from sessionStorage
 * Also clears the module-level cache.
 */
function clearStoredCredentials(address: string): void {
  if (typeof window === "undefined") return;
  const cacheKey = getCacheKey(address);
  sessionStorage.removeItem(getStorageKey(address));
  credentialsCache.delete(cacheKey);
}

/**
 * Hook for managing Polymarket CLOB API credentials
 *
 * This hook handles:
 * 1. Checking for existing stored credentials in sessionStorage
 * 2. Deriving new credentials via the SDK's createOrDeriveApiKey()
 * 3. Storing credentials in sessionStorage for the current browser session
 *
 * Users need valid API credentials to post orders to the CLOB.
 * Credentials are derived by signing an EIP-712 message.
 *
 * Reference: https://docs.polymarket.com/developers/CLOB/clients/methods-l1
 */
export function useClobCredentials() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();

  const [credentials, setCredentials] = useState<ApiKeyCreds | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Load stored credentials when address changes
  useEffect(() => {
    if (address) {
      const stored = getStoredCredentials(address);
      setCredentials(stored);
    } else {
      setCredentials(null);
    }
  }, [address]);

  /**
   * Generate L1 authentication signature for API fallback
   * Creates an EIP-712 signature that Polymarket uses for authentication
   */
  const generateL1Signature = useCallback(async (): Promise<{
    signature: string;
    timestamp: string;
    nonce: string;
  }> => {
    if (!address) {
      throw new Error("Wallet not connected");
    }

    const auth = buildClobAuthViemTypedData({
      address: address as `0x${string}`,
    });

    const signer = await getViemWalletClient(
      walletClient,
      address as `0x${string}`
    );
    const signature = await signer.signTypedData({
      account: address as `0x${string}`,
      ...auth.typedData,
    });

    return {
      signature,
      timestamp: auth.timestamp,
      nonce: auth.nonce,
    };
  }, [address, walletClient]);

  /**
   * Fallback: Derive credentials via server-side API route
   * Used when SDK methods fail (e.g., due to network issues or CORS)
   */
  const deriveCredentialsViaApi =
    useCallback(async (): Promise<ApiKeyCreds> => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      const { signature, timestamp, nonce } = await generateL1Signature();

      const response = await fetch("/api/auth/derive-api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, timestamp, nonce }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        details?: string;
        credentials?: ApiKeyCredsLike;
      };

      if (!response.ok || !data.success) {
        const errorMessage =
          data.error || data.details || "Failed to derive API credentials";
        throw new Error(errorMessage);
      }

      const creds = normalizeApiKeyCreds(data.credentials);

      storeCredentials(address, creds);
      setCredentials(creds);

      return creds;
    }, [address, generateL1Signature]);

  /**
   * Create or derive API credentials using the SDK
   *
   * Uses our server API route first so expected Polymarket 400s do not show
   * up as browser console errors from the SDK's internal Axios handler. The
   * route implements the same create-or-derive L1 auth flow and the SDK stays
   * as a fallback.
   *
   * Reference: https://docs.polymarket.com/developers/CLOB/clients/methods-l1#createorderiveapikey
   */
  const deriveCredentials = useCallback(async (): Promise<ApiKeyCreds> => {
    if (!address) {
      throw new Error("Wallet not connected");
    }

    if (typeof window === "undefined") {
      throw new Error("No wallet provider found");
    }

    setIsLoading(true);
    setError(null);

    try {
      try {
        return await deriveCredentialsViaApi();
      } catch (apiErr) {
        log.warn("api_credentials_route.failed.fallback_to_sdk", apiErr);
      }

      try {
        log.debug("unified_sdk_credentials.attempt");
        const signer = await getViemWalletClient(
          walletClient,
          address as `0x${string}`
        );
        const { appCredentials } = await createUnifiedPolymarketSecureClient({
          signer: createUnifiedPolymarketViemSigner(signer),
        });
        log.debug("unified_sdk_credentials.success");

        storeCredentials(address, appCredentials);
        setCredentials(appCredentials);

        return appCredentials;
      } catch (sdkErr) {
        log.warn("unified_sdk_credentials.failed.fallback_to_api", sdkErr);
        return await deriveCredentialsViaApi();
      }
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to derive credentials");
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [address, deriveCredentialsViaApi, walletClient]);

  /**
   * Clear stored credentials and reset state
   */
  const clearCredentials = useCallback(() => {
    if (address) {
      clearStoredCredentials(address);
      setCredentials(null);
    }
  }, [address]);

  /**
   * Clear all stored credentials.
   */
  const clearAllCredentials = useCallback(() => {
    if (address) {
      clearStoredCredentials(address);
      setCredentials(null);
    }
  }, [address]);

  /**
   * Refresh credentials from sessionStorage
   * Useful after completing onboarding to ensure state is up to date.
   * Forces a read from storage by clearing the cache entry first.
   */
  const refresh = useCallback(() => {
    if (address) {
      // Clear cache to force reading from sessionStorage
      const cacheKey = getCacheKey(address);
      credentialsCache.delete(cacheKey);
      const stored = getStoredCredentials(address);
      setCredentials(stored);
    }
  }, [address]);

  /**
   * Check if credentials exist
   */
  const hasCredentials = useMemo(() => credentials !== null, [credentials]);

  return {
    // State
    credentials,
    hasCredentials,
    isConnected,
    isLoading,
    error,

    // Full credential actions
    deriveCredentials,
    clearCredentials,
    clearAllCredentials,
    refresh,
  };
}
