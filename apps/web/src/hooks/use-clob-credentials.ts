"use client";

import {
  type ApiKeyCreds,
  type ApiKeyCredsLike,
  buildClobAuthViemTypedData,
  isCompleteApiKeyCreds,
  normalizeApiKeyCreds,
} from "@knoww/shared-types/polymarket";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";
import { CLOB_BASE_URL } from "@/constants/polymarket";
import { getViemWalletClient } from "@/lib/viem-wallet-client";

export type { ApiKeyCreds } from "@knoww/shared-types/polymarket";

/** Storage key for Knoww's local CLOB API credential map. */
const CREDS_STORAGE_KEY = "knoww_clob_api_key_map";
const LEGACY_SESSION_CREDS_STORAGE_KEY = "polymarket_api_creds";
const CREDS_STORAGE_VERSION = 1;
const CREDS_STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const credentialDerivationPromises = new Map<string, Promise<ApiKeyCreds>>();

type StoredCredentialsEntry = {
  credentials: ApiKeyCredsLike;
  createdAt: number;
  expiresAt: number;
};

type StoredCredentialsMap = {
  version: typeof CREDS_STORAGE_VERSION;
  entries: Record<string, StoredCredentialsEntry>;
};

function getCacheKey(address: string): string {
  return `${CLOB_BASE_URL}_${address.toLowerCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isStoredCredentialsEntry(
  value: unknown
): value is StoredCredentialsEntry {
  if (!isRecord(value)) return false;
  const createdAt = value.createdAt;
  const expiresAt = value.expiresAt;
  return (
    isCompleteApiKeyCreds(value.credentials) &&
    isFiniteTimestamp(createdAt) &&
    isFiniteTimestamp(expiresAt) &&
    expiresAt > createdAt
  );
}

/**
 * Get the old sessionStorage key for a specific address. Kept only so the
 * localStorage migration can remove stale tab-scoped credential copies.
 */
function getLegacySessionStorageKey(address: string): string {
  return `${LEGACY_SESSION_CREDS_STORAGE_KEY}_${CLOB_BASE_URL}_${address.toLowerCase()}`;
}

function emptyStoredCredentialsMap(): StoredCredentialsMap {
  return { version: CREDS_STORAGE_VERSION, entries: {} };
}

function parseStoredCredentialsMap(
  stored: string
): { map: StoredCredentialsMap; didDropEntry: boolean } | null {
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.version !== CREDS_STORAGE_VERSION ||
      !isRecord(parsed.entries)
    ) {
      return null;
    }

    const entries: Record<string, StoredCredentialsEntry> = {};
    let didDropEntry = false;
    const now = Date.now();
    for (const [key, value] of Object.entries(parsed.entries)) {
      if (isStoredCredentialsEntry(value) && value.expiresAt > now) {
        entries[key] = value;
      } else {
        didDropEntry = true;
      }
    }

    const map: StoredCredentialsMap = {
      version: CREDS_STORAGE_VERSION,
      entries,
    };
    return { map, didDropEntry };
  } catch {
    return null;
  }
}

function writeStoredCredentialsMap(map: StoredCredentialsMap): void {
  if (typeof window === "undefined") return;

  try {
    if (Object.keys(map.entries).length === 0) {
      localStorage.removeItem(CREDS_STORAGE_KEY);
      return;
    }

    // lgtm[js/clear-text-storage-of-sensitive-data]
    localStorage.setItem(CREDS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage may throw if quota is exceeded or persistence is blocked.
  }
}

function readStoredCredentialsMap(): StoredCredentialsMap {
  if (typeof window === "undefined") return emptyStoredCredentialsMap();

  const currentStored = localStorage.getItem(CREDS_STORAGE_KEY);

  if (currentStored) {
    const parsed = parseStoredCredentialsMap(currentStored);
    if (parsed) {
      if (parsed.didDropEntry) {
        writeStoredCredentialsMap(parsed.map);
      }
      return parsed.map;
    }

    localStorage.removeItem(CREDS_STORAGE_KEY);
  }

  return emptyStoredCredentialsMap();
}

function removeLegacySessionCredentials(address: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(getLegacySessionStorageKey(address));
  } catch {
    // Ignore blocked sessionStorage.
  }
}

/**
 * Get stored credentials from localStorage.
 * Expired or malformed entries are removed instead of being used.
 */
function getStoredCredentials(address: string): ApiKeyCreds | null {
  if (typeof window === "undefined") return null;

  const cacheKey = getCacheKey(address);

  removeLegacySessionCredentials(address);

  const map = readStoredCredentialsMap();
  const entry = map.entries[cacheKey];
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) {
      delete map.entries[cacheKey];
      writeStoredCredentialsMap(map);
    }
    return null;
  }

  const credentials = normalizeApiKeyCreds(entry.credentials);
  // Return defensive copy to prevent cache corruption from caller mutations
  return { ...credentials };
}

/**
 * Store credentials in localStorage with an expiry.
 *
 * Security: CodeQL flags this as clear-text storage of sensitive data.
 * localStorage is origin-locked but readable by same-origin JavaScript, so CSP
 * hardening and strict validation are the main browser-side controls. These are
 * re-derivable CLOB API credentials, not wallet private keys.
 */
function storeCredentials(address: string, creds: ApiKeyCreds): void {
  if (typeof window === "undefined") return;
  const cacheKey = getCacheKey(address);
  const now = Date.now();
  const map = readStoredCredentialsMap();
  map.entries[cacheKey] = {
    credentials: creds,
    createdAt: now,
    expiresAt: now + CREDS_STORAGE_TTL_MS,
  };
  writeStoredCredentialsMap(map);
  removeLegacySessionCredentials(address);
}

/**
 * Clear stored credentials from localStorage.
 */
function clearStoredCredentials(address: string): void {
  if (typeof window === "undefined") return;
  const cacheKey = getCacheKey(address);
  const map = readStoredCredentialsMap();
  delete map.entries[cacheKey];
  writeStoredCredentialsMap(map);
  removeLegacySessionCredentials(address);
}

/**
 * Hook for managing Polymarket CLOB API credentials
 *
 * This hook handles:
 * 1. Checking for existing stored credentials in localStorage
 * 2. Deriving new credentials through the server API route
 * 3. Storing credentials in localStorage with an expiry
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
  const [isDerivingCredentials, setIsDerivingCredentials] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Load stored credentials when address changes.
  useEffect(() => {
    if (!address) {
      setCredentials(null);
      return;
    }

    setCredentials(getStoredCredentials(address));
  }, [address]);

  useEffect(() => {
    if (!address || typeof window === "undefined") return;

    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== CREDS_STORAGE_KEY && event.key !== null) return;

      setCredentials(getStoredCredentials(address));
    };

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
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
   * Derive credentials via the server-side API route.
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
   * Create or derive API credentials through the server API route.
   *
   * The route implements the create-or-derive L1 auth flow. Keeping this to a
   * single path prevents one user action from opening multiple wallet signing
   * prompts if fallback attempts also need `ClobAuth`.
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

    const cacheKey = getCacheKey(address);
    const inFlight = credentialDerivationPromises.get(cacheKey);
    if (inFlight) return inFlight;

    setIsDerivingCredentials(true);
    setError(null);

    const derivation = deriveCredentialsViaApi()
      .catch((err) => {
        const error =
          err instanceof Error
            ? err
            : new Error("Failed to derive credentials");
        setError(error);
        throw error;
      })
      .finally(() => {
        credentialDerivationPromises.delete(cacheKey);
        setIsDerivingCredentials(false);
      });

    credentialDerivationPromises.set(cacheKey, derivation);
    return derivation;
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
   * Clear all stored credentials.
   */
  const clearAllCredentials = useCallback(() => {
    if (address) {
      clearStoredCredentials(address);
      setCredentials(null);
    }
  }, [address]);

  /**
   * Refresh credentials from localStorage
   * Useful after completing onboarding to ensure state is up to date.
   */
  const refresh = useCallback(() => {
    if (address) {
      const stored = getStoredCredentials(address);
      setCredentials(stored);
    }
  }, [address]);

  /**
   * Check if credentials exist
   */
  const hasCredentials = useMemo(() => credentials !== null, [credentials]);
  const isLoading = isDerivingCredentials;

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
