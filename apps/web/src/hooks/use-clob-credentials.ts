"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useSignTypedData } from "wagmi";
import {
  CLOB_AUTH_DOMAIN,
  CLOB_AUTH_MESSAGE,
  CLOB_AUTH_TYPES,
  CLOB_BASE_URL,
  POLYMARKET_CHAIN_ID,
} from "@/constants/polymarket";

export type { ApiKeyCreds } from "@knoww/shared-types/polymarket";

import type { ApiKeyCreds } from "@knoww/shared-types/polymarket";

/**
 * Read-only API key for viewing data without trading permissions
 * Can be shared with third-party services safely
 */
export interface ReadonlyApiKey {
  apiKey: string;
}

/**
 * Extended ClobClient interface with read-only API key methods
 * These methods exist in the SDK but TypeScript doesn't resolve them correctly
 * due to ESM export issues in the package
 */
interface ClobClientWithReadonlyMethods {
  createReadonlyApiKey(): Promise<{ apiKey: string }>;
  getReadonlyApiKeys(): Promise<string[]>;
  deleteReadonlyApiKey(key: string): Promise<boolean>;
  validateReadonlyApiKey(address: string, key: string): Promise<string>;
}

/**
 * Storage key prefix for credentials
 */
const CREDS_STORAGE_KEY = "polymarket_api_creds";
const READONLY_KEYS_STORAGE_KEY = "polymarket_readonly_keys";

/**
 * Module-level cache for credentials to avoid repeated sessionStorage reads
 * and JSON parsing across multiple component mounts.
 * Cache is invalidated when credentials are stored or cleared.
 */
const credentialsCache = new Map<string, ApiKeyCreds | null>();
const readonlyKeysCache = new Map<string, string[]>();

/**
 * Get the storage key for a specific address
 */
function getStorageKey(address: string): string {
  return `${CREDS_STORAGE_KEY}_${address.toLowerCase()}`;
}

/**
 * Get stored credentials from sessionStorage (cleared when browser closes)
 * Uses module-level cache to avoid repeated storage reads and JSON parsing.
 * This provides better security than localStorage as credentials don't persist indefinitely.
 */
function getStoredCredentials(address: string): ApiKeyCreds | null {
  if (typeof window === "undefined") return null;

  const cacheKey = address.toLowerCase();

  // Return cached value if available (defensive copy to prevent cache corruption)
  if (credentialsCache.has(cacheKey)) {
    const cached = credentialsCache.get(cacheKey);
    return cached ? { ...cached } : null;
  }

  try {
    const stored = sessionStorage.getItem(getStorageKey(address));
    if (stored) {
      const parsed = JSON.parse(stored) as ApiKeyCreds;
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
  const cacheKey = address.toLowerCase();
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
  const cacheKey = address.toLowerCase();
  sessionStorage.removeItem(getStorageKey(address));
  credentialsCache.delete(cacheKey);
}

/**
 * Get the storage key for read-only keys
 */
function getReadonlyKeysStorageKey(address: string): string {
  return `${READONLY_KEYS_STORAGE_KEY}_${address.toLowerCase()}`;
}

/**
 * Get stored read-only API keys from sessionStorage (cleared when browser closes)
 * Uses module-level cache to avoid repeated storage reads and JSON parsing.
 */
function getStoredReadonlyKeys(address: string): string[] {
  if (typeof window === "undefined") return [];

  const cacheKey = address.toLowerCase();

  // Return cached value if available
  if (readonlyKeysCache.has(cacheKey)) {
    return [...(readonlyKeysCache.get(cacheKey) ?? [])];
  }

  try {
    const stored = sessionStorage.getItem(getReadonlyKeysStorageKey(address));
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      readonlyKeysCache.set(cacheKey, parsed);
      // Return defensive copy to prevent cache corruption from caller mutations
      return [...parsed];
    }
  } catch {
    // Ignore parse errors
  }

  readonlyKeysCache.set(cacheKey, []);
  return [];
}

/**
 * Store read-only API keys in sessionStorage (cleared when browser closes)
 * Updates the module-level cache for consistency.
 *
 * Security: Read-only API keys can only view data, not trade. They are
 * designed to be shared with third parties. Storing them in sessionStorage
 * (origin-locked, tab-scoped, cleared on close) is acceptable.
 */
function storeReadonlyKeys(address: string, keys: string[]): void {
  if (typeof window === "undefined") return;
  const cacheKey = address.toLowerCase();
  try {
    // lgtm[js/clear-text-storage-of-sensitive-data]
    sessionStorage.setItem(
      getReadonlyKeysStorageKey(address),
      JSON.stringify(keys)
    );
    // Store copy to prevent external mutations from corrupting cache
    // Only update cache if sessionStorage write succeeded
    readonlyKeysCache.set(cacheKey, [...keys]);
  } catch {
    // sessionStorage may throw if quota exceeded or in private browsing
    // Still update in-memory cache for current session functionality
    readonlyKeysCache.set(cacheKey, [...keys]);
  }
}

/**
 * Clear stored read-only keys from sessionStorage
 * Also clears the module-level cache.
 */
function clearStoredReadonlyKeys(address: string): void {
  if (typeof window === "undefined") return;
  const cacheKey = address.toLowerCase();
  sessionStorage.removeItem(getReadonlyKeysStorageKey(address));
  readonlyKeysCache.delete(cacheKey);
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
  const signTypedData = useSignTypedData();

  const [credentials, setCredentials] = useState<ApiKeyCreds | null>(null);
  const [readonlyKeys, setReadonlyKeys] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Load stored credentials and read-only keys when address changes
  useEffect(() => {
    if (address) {
      const stored = getStoredCredentials(address);
      setCredentials(stored);
      const storedReadonlyKeys = getStoredReadonlyKeys(address);
      setReadonlyKeys(storedReadonlyKeys);
    } else {
      setCredentials(null);
      setReadonlyKeys([]);
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

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = 0;

    const signature = await signTypedData.mutateAsync({
      domain: CLOB_AUTH_DOMAIN,
      types: CLOB_AUTH_TYPES,
      primaryType: "ClobAuth",
      message: {
        address: address as `0x${string}`,
        timestamp: `${timestamp}`,
        nonce: BigInt(nonce),
        message: CLOB_AUTH_MESSAGE,
      },
    });

    return {
      signature,
      timestamp: `${timestamp}`,
      nonce: `${nonce}`,
    };
  }, [address, signTypedData]);

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
        credentials?: {
          apiKey?: string;
          secret?: string;
          passphrase?: string;
        };
      };

      if (!response.ok || !data.success) {
        const errorMessage =
          data.error || data.details || "Failed to derive API credentials";
        throw new Error(errorMessage);
      }

      const creds: ApiKeyCreds = {
        apiKey: data.credentials?.apiKey || "",
        apiSecret: data.credentials?.secret || "",
        apiPassphrase: data.credentials?.passphrase || "",
      };

      storeCredentials(address, creds);
      setCredentials(creds);

      return creds;
    }, [address, generateL1Signature]);

  /**
   * Create or derive API credentials using the SDK
   *
   * Uses the recommended createOrDeriveApiKey() method which automatically
   * handles both returning users (derivation) and new users (creation).
   *
   * Reference: https://docs.polymarket.com/developers/CLOB/clients/methods-l1#createorderiveapikey
   */
  const deriveCredentials = useCallback(async (): Promise<ApiKeyCreds> => {
    if (!address) {
      throw new Error("Wallet not connected");
    }

    if (typeof window === "undefined" || !window.ethereum) {
      throw new Error("No wallet provider found");
    }

    setIsLoading(true);
    setError(null);

    try {
      // Dynamic imports to avoid SSR issues
      const [{ ClobClient }, ethersModule] = await Promise.all([
        import("@polymarket/clob-client-v2"),
        import("ethers"),
      ]);

      // Create ethers signer from wallet provider
      const provider = new ethersModule.providers.Web3Provider(
        // biome-ignore lint/suspicious/noExplicitAny: window.ethereum is the wallet provider
        window.ethereum as any
      );
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();

      // Create CLOB client for credential derivation
      const clobClient = new ClobClient({
        host: CLOB_BASE_URL,
        chain: POLYMARKET_CHAIN_ID,
        signer,
      });

      let creds: { key: string; secret: string; passphrase: string };

      try {
        // Try deriveApiKey first — most users already have keys from a
        // previous session, so this avoids the wasted createApiKey 400
        // and the extra wallet signature that createOrDeriveApiKey causes.
        console.log("[ClobCredentials] Trying deriveApiKey first...");
        creds = await clobClient.deriveApiKey();
        console.log("[ClobCredentials] Successfully derived existing API key");
      } catch {
        try {
          console.log(
            "[ClobCredentials] Derive failed, creating new API key..."
          );
          creds = await clobClient.createApiKey();
          console.log("[ClobCredentials] Successfully created new API key");
        } catch (sdkErr) {
          console.log(
            "[ClobCredentials] SDK failed, using API fallback...",
            sdkErr
          );
          return await deriveCredentialsViaApi();
        }
      }

      const apiCreds: ApiKeyCreds = {
        apiKey: creds.key,
        apiSecret: creds.secret,
        apiPassphrase: creds.passphrase,
      };

      storeCredentials(address, apiCreds);
      setCredentials(apiCreds);

      return apiCreds;
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to derive credentials");
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [address, deriveCredentialsViaApi]);

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
   * Clear all credentials including read-only keys
   */
  const clearAllCredentials = useCallback(() => {
    if (address) {
      clearStoredCredentials(address);
      clearStoredReadonlyKeys(address);
      setCredentials(null);
      setReadonlyKeys([]);
    }
  }, [address]);

  /**
   * Refresh credentials from sessionStorage
   * Useful after completing onboarding to ensure state is up to date.
   * Forces a read from storage by clearing the cache entry first.
   * Also refreshes readonly keys for consistency.
   */
  const refresh = useCallback(() => {
    if (address) {
      // Clear cache to force reading from sessionStorage
      const cacheKey = address.toLowerCase();
      credentialsCache.delete(cacheKey);
      readonlyKeysCache.delete(cacheKey);
      const stored = getStoredCredentials(address);
      setCredentials(stored);
      const storedReadonlyKeys = getStoredReadonlyKeys(address);
      setReadonlyKeys(storedReadonlyKeys);
    }
  }, [address]);

  /**
   * Check if credentials exist
   */
  const hasCredentials = useMemo(() => credentials !== null, [credentials]);

  /**
   * Helper to get an authenticated CLOB client
   * Used internally for read-only key operations
   */
  const getAuthenticatedClient = useCallback(async () => {
    if (!credentials) {
      throw new Error(
        "Full credentials required. Please derive credentials first."
      );
    }

    if (typeof window === "undefined" || !window.ethereum) {
      throw new Error("No wallet provider found");
    }

    const [{ ClobClient }, ethersModule] = await Promise.all([
      import("@polymarket/clob-client-v2"),
      import("ethers"),
    ]);

    const provider = new ethersModule.providers.Web3Provider(
      // biome-ignore lint/suspicious/noExplicitAny: window.ethereum is the wallet provider
      window.ethereum as any
    );
    await provider.send("eth_requestAccounts", []);
    const signer = provider.getSigner();

    const creds = {
      key: credentials.apiKey,
      secret: credentials.apiSecret,
      passphrase: credentials.apiPassphrase,
    };

    return new ClobClient({
      host: CLOB_BASE_URL,
      chain: POLYMARKET_CHAIN_ID,
      signer,
      creds,
    }) as InstanceType<typeof ClobClient> & ClobClientWithReadonlyMethods;
  }, [credentials]);

  /**
   * Create a new read-only API key
   *
   * Read-only keys can be safely shared with third-party services
   * to view portfolio data without trading permissions.
   *
   * Requires full credentials to be derived first.
   */
  const createReadonlyApiKey = useCallback(async (): Promise<string> => {
    if (!address) {
      throw new Error("Wallet not connected");
    }

    setIsLoading(true);
    setError(null);

    try {
      const client = await getAuthenticatedClient();
      console.log("[ClobCredentials] Creating read-only API key...");

      const response = await client.createReadonlyApiKey();
      const newKey = response.apiKey;

      console.log("[ClobCredentials] Successfully created read-only API key");

      // Update local state and storage
      const updatedKeys = [...readonlyKeys, newKey];
      setReadonlyKeys(updatedKeys);
      storeReadonlyKeys(address, updatedKeys);

      return newKey;
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error("Failed to create read-only API key");
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [address, getAuthenticatedClient, readonlyKeys]);

  /**
   * Get all read-only API keys from the server
   *
   * Syncs local state with server state.
   */
  const getReadonlyApiKeys = useCallback(async (): Promise<string[]> => {
    if (!address) {
      throw new Error("Wallet not connected");
    }

    setIsLoading(true);
    setError(null);

    try {
      const client = await getAuthenticatedClient();
      console.log("[ClobCredentials] Fetching read-only API keys...");

      const keys = await client.getReadonlyApiKeys();

      console.log(`[ClobCredentials] Found ${keys.length} read-only API keys`);

      // Update local state and storage
      setReadonlyKeys(keys);
      storeReadonlyKeys(address, keys);

      return keys;
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error("Failed to fetch read-only API keys");
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [address, getAuthenticatedClient]);

  /**
   * Delete a read-only API key
   *
   * Revokes access for any third-party service using this key.
   */
  const deleteReadonlyApiKey = useCallback(
    async (keyToDelete: string): Promise<boolean> => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      setIsLoading(true);
      setError(null);

      try {
        const client = await getAuthenticatedClient();
        console.log("[ClobCredentials] Deleting read-only API key...");

        const success = await client.deleteReadonlyApiKey(keyToDelete);

        if (success) {
          console.log(
            "[ClobCredentials] Successfully deleted read-only API key"
          );

          // Update local state and storage
          const updatedKeys = readonlyKeys.filter((k) => k !== keyToDelete);
          setReadonlyKeys(updatedKeys);
          storeReadonlyKeys(address, updatedKeys);
        }

        return success;
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error("Failed to delete read-only API key");
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [address, getAuthenticatedClient, readonlyKeys]
  );

  /**
   * Validate a read-only API key for a given address
   *
   * Can be used to verify if a key is still valid.
   * This method does not require authentication.
   */
  const validateReadonlyApiKey = useCallback(
    async (targetAddress: string, key: string): Promise<boolean> => {
      try {
        const { ClobClient } = await import("@polymarket/clob-client-v2");

        // Create unauthenticated client for validation
        const client = new ClobClient({
          host: CLOB_BASE_URL,
          chain: POLYMARKET_CHAIN_ID,
        }) as InstanceType<typeof ClobClient> & ClobClientWithReadonlyMethods;

        const result = await client.validateReadonlyApiKey(targetAddress, key);
        return !!result;
      } catch {
        return false;
      }
    },
    []
  );

  return {
    // State
    credentials,
    hasCredentials,
    readonlyKeys,
    isConnected,
    isLoading,
    error,

    // Full credential actions
    deriveCredentials,
    clearCredentials,
    clearAllCredentials,
    refresh,

    // Read-only API key actions
    createReadonlyApiKey,
    getReadonlyApiKeys,
    deleteReadonlyApiKey,
    validateReadonlyApiKey,
  };
}
