/**
 * Trading Session Persistence
 *
 * Handles storing and retrieving trading session data from localStorage.
 * This ensures users don't have to re-onboard on every page refresh.
 *
 * Security hardening:
 * - Data integrity verification via non-cryptographic checksum
 * - Strict schema validation on read
 * - Session expiration enforcement
 * - Address format validation
 *
 * Note: localStorage is inherently vulnerable to XSS. The integrity check
 * prevents casual tampering but cannot protect against a full XSS compromise.
 * For sensitive operations, always verify state against on-chain data.
 *
 * Reference: https://github.com/Polymarket/wagmi-safe-builder-example
 */

/**
 * Trading session data structure
 */
export interface StoredTradingSession {
  eoaAddress: string;
  safeAddress: string;
  hasApprovals: boolean;
  lastUpdated: number; // Unix timestamp
}

/**
 * Internal storage format with integrity check
 */
interface StoredSessionEnvelope {
  version: 1;
  data: StoredTradingSession;
  checksum: string;
}

/**
 * Session storage key prefix
 */
const SESSION_STORAGE_KEY = "polymarket_trading_session";

/**
 * Session expiration time (7 days in milliseconds)
 */
const SESSION_EXPIRATION = 7 * 24 * 60 * 60 * 1000;

/**
 * Ethereum address regex for validation
 */
const ETH_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

/**
 * Compute a simple integrity checksum for session data.
 * This is NOT cryptographic security — it's a tamper-detection mechanism
 * to catch accidental corruption or casual tampering.
 */
function computeChecksum(data: StoredTradingSession): string {
  const payload = [
    data.eoaAddress.toLowerCase(),
    data.safeAddress.toLowerCase(),
    data.hasApprovals ? "1" : "0",
    data.lastUpdated.toString(),
    SESSION_STORAGE_KEY, // salt
  ].join("|");

  // Simple hash using djb2 algorithm — fast, deterministic, non-reversible enough for tamper detection
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 33) ^ payload.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Validate that a value looks like a valid Ethereum address
 */
function isValidEthAddress(address: unknown): address is string {
  return typeof address === "string" && ETH_ADDRESS_REGEX.test(address);
}

/**
 * Validate that a parsed object matches the StoredTradingSession schema
 */
function isValidSession(obj: unknown): obj is StoredTradingSession {
  if (!obj || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;

  return (
    isValidEthAddress(s.eoaAddress) &&
    isValidEthAddress(s.safeAddress) &&
    typeof s.hasApprovals === "boolean" &&
    typeof s.lastUpdated === "number" &&
    Number.isFinite(s.lastUpdated) &&
    s.lastUpdated > 0
  );
}

/**
 * Get the storage key for a specific address
 */
function getStorageKey(address: string): string {
  return `${SESSION_STORAGE_KEY}_${address.toLowerCase()}`;
}

/**
 * Get stored trading session for an address
 */
export function getStoredSession(address: string): StoredTradingSession | null {
  if (typeof window === "undefined") return null;
  if (!ETH_ADDRESS_REGEX.test(address)) return null;

  try {
    const key = getStorageKey(address);
    const stored = localStorage.getItem(key);

    if (!stored) return null;

    const parsed = JSON.parse(stored) as unknown;

    // Handle both legacy (plain session) and new (envelope) formats
    let session: StoredTradingSession;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      (parsed as StoredSessionEnvelope).version === 1
    ) {
      // New envelope format — verify checksum
      const envelope = parsed as StoredSessionEnvelope;

      if (!isValidSession(envelope.data)) {
        localStorage.removeItem(key);
        return null;
      }

      const expectedChecksum = computeChecksum(envelope.data);
      if (envelope.checksum !== expectedChecksum) {
        // Integrity check failed — data may have been tampered with
        console.warn("[Session] Integrity check failed, clearing session");
        localStorage.removeItem(key);
        return null;
      }

      session = envelope.data;
    } else if (isValidSession(parsed)) {
      // Legacy format — migrate to new format on next write
      session = parsed;
    } else {
      // Invalid data
      localStorage.removeItem(key);
      return null;
    }

    // Check if session has expired
    const now = Date.now();
    if (now - session.lastUpdated > SESSION_EXPIRATION) {
      localStorage.removeItem(key);
      return null;
    }

    // Verify the session is for the correct address
    if (session.eoaAddress.toLowerCase() !== address.toLowerCase()) {
      localStorage.removeItem(key);
      return null;
    }

    return session;
  } catch {
    // Ignore parse errors
    return null;
  }
}

/**
 * Store trading session for an address
 */
export function storeSession(
  session: Omit<StoredTradingSession, "lastUpdated">
): void {
  if (typeof window === "undefined") return;
  if (!isValidEthAddress(session.eoaAddress)) return;
  if (!isValidEthAddress(session.safeAddress)) return;

  try {
    const key = getStorageKey(session.eoaAddress);
    const sessionWithTimestamp: StoredTradingSession = {
      ...session,
      lastUpdated: Date.now(),
    };

    const envelope: StoredSessionEnvelope = {
      version: 1,
      data: sessionWithTimestamp,
      checksum: computeChecksum(sessionWithTimestamp),
    };

    localStorage.setItem(key, JSON.stringify(envelope));
  } catch (err) {
    console.error("[Session] Failed to store session:", err);
  }
}

/**
 * Update specific fields in the stored session
 */
export function updateSession(
  address: string,
  updates: Partial<Omit<StoredTradingSession, "eoaAddress" | "lastUpdated">>
): void {
  if (typeof window === "undefined") return;

  const existing = getStoredSession(address);
  if (!existing) return;

  storeSession({
    ...existing,
    ...updates,
  });
}

/**
 * Clear stored session for an address
 */
export function clearSession(address: string): void {
  if (typeof window === "undefined") return;
  if (!ETH_ADDRESS_REGEX.test(address)) return;

  try {
    const key = getStorageKey(address);
    localStorage.removeItem(key);
  } catch (err) {
    console.error("[Session] Failed to clear session:", err);
  }
}

/**
 * Clear all trading sessions (for debugging/logout)
 */
export function clearAllSessions(): void {
  if (typeof window === "undefined") return;

  try {
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(SESSION_STORAGE_KEY)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.error("[Session] Failed to clear all sessions:", err);
  }
}
