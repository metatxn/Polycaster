/**
 * CredentialManager — orchestrates CLOB API credential derivation
 * for the extension.
 *
 * Step 1: Sign an EIP-712 ClobAuth message via WalletBridge (MetaMask)
 * Step 2: Send the signature to background which calls the CLOB API
 * Step 3: Cache credentials via background service worker (session storage)
 */

import { buildClobAuthRpcTypedData } from "@knoww/shared-types/polymarket";

import { WalletBridge } from "./bridge";
import { ExtensionSession } from "./extension-session";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const MESSAGE_TIMEOUT_MS = 20_000;
const DERIVATION_WAIT_POLL_MS = 500;
const DERIVATION_WAIT_TIMEOUT_MS = 120_000;
const ACTIVE_DERIVATION_MESSAGE =
  "Another trading enable request is already waiting in your wallet. Confirm or reject the existing wallet request before retrying.";

function sendTradingMsg<T>(
  message: Record<string, unknown>,
  errorLabel: string
): Promise<T> {
  let attempt = 0;

  function trySend(): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`${errorLabel} timed out`));
      }, MESSAGE_TIMEOUT_MS);

      chrome.runtime.sendMessage(
        message,
        (response: { ok: boolean; data?: T; error?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);

          if (chrome.runtime.lastError) {
            const err = chrome.runtime.lastError.message || "Unknown error";
            if (attempt < MAX_RETRIES && err.includes("message port closed")) {
              attempt++;
              setTimeout(() => trySend().then(resolve, reject), RETRY_DELAY_MS);
              return;
            }
            reject(new Error(err));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || errorLabel));
            return;
          }
          resolve(response.data as T);
        }
      );
    });
  }

  return trySend();
}

const CREDS_STORAGE_KEY = "knoww_clob_creds";

export interface DerivedApiKeyResult {
  method: "create" | "derive";
}

type CredentialDerivationBeginResult =
  | { status: "present" }
  | { status: "claimed"; token: string }
  | { status: "busy" };

type CredentialDerivationStatus =
  | { status: "present" }
  | { status: "busy" }
  | { status: "idle" };

function storageKey(address: string): string {
  return `${CREDS_STORAGE_KEY}_${address.toLowerCase()}`;
}

const credentialDerivationPromises = new Map<
  string,
  Promise<DerivedApiKeyResult>
>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasStoredCredentials(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "creds:has", key: storageKey(address) },
      (resp: { ok: boolean; data?: { hasCredentials?: boolean } }) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          resolve(false);
          return;
        }
        resolve(resp.data?.hasCredentials === true);
      }
    );
  });
}

async function beginCredentialDerivation(
  address: string
): Promise<CredentialDerivationBeginResult> {
  return sendTradingMsg<CredentialDerivationBeginResult>(
    { type: "creds:derive-begin", key: storageKey(address) },
    "Failed to start credential derivation"
  );
}

async function getCredentialDerivationStatus(
  address: string
): Promise<CredentialDerivationStatus> {
  return sendTradingMsg<CredentialDerivationStatus>(
    { type: "creds:derive-status", key: storageKey(address) },
    "Failed to check credential derivation status"
  );
}

async function endCredentialDerivation(
  address: string,
  token: string
): Promise<void> {
  try {
    await sendTradingMsg<{ released: boolean }>(
      { type: "creds:derive-end", key: storageKey(address), token },
      "Failed to finish credential derivation"
    );
  } catch {
    /* best effort */
  }
}

async function waitForActiveCredentialDerivation(
  address: string
): Promise<DerivedApiKeyResult> {
  const deadline = Date.now() + DERIVATION_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await hasStoredCredentials(address)) {
      return { method: "derive" };
    }

    const status = await getCredentialDerivationStatus(address);
    if (status.status === "present") return { method: "derive" };

    await sleep(DERIVATION_WAIT_POLL_MS);
  }

  throw new Error(ACTIVE_DERIVATION_MESSAGE);
}

async function deriveCredentialsWithClaim(
  address: string
): Promise<DerivedApiKeyResult> {
  if (await hasStoredCredentials(address)) {
    return { method: "derive" };
  }

  const claim = await beginCredentialDerivation(address);
  if (claim.status === "present") return { method: "derive" };
  if (claim.status === "busy") {
    return waitForActiveCredentialDerivation(address);
  }

  try {
    await ExtensionSession.ensureAuthorized(address);

    if (await hasStoredCredentials(address)) {
      return { method: "derive" };
    }

    const auth = buildClobAuthRpcTypedData({
      address,
    });
    const typedData = JSON.stringify(auth.typedData);

    const signature = await WalletBridge.signTypedData(address, typedData);

    // Background derives the credentials via the CLOB API, stores them in its
    // own session store, and returns only the method — the raw apiKey/secret/
    // passphrase never come back to the content script.
    return sendTradingMsg<DerivedApiKeyResult>(
      {
        type: "trading:derive-credentials",
        address,
        signature,
        timestamp: auth.timestamp,
        nonce: auth.nonce,
      },
      "Failed to derive credentials"
    );
  } finally {
    await endCredentialDerivation(address, claim.token);
  }
}

export const CredentialManager = {
  /**
   * Whether CLOB credentials already exist for this wallet. The raw credential
   * object stays inside the background worker (it derives, stores, and uses it
   * for signing/placing orders) — content only ever learns presence.
   */
  async has(address: string): Promise<boolean> {
    return hasStoredCredentials(address);
  },

  async clear(address: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "creds:remove", key: storageKey(address) },
        () => {
          resolve();
        }
      );
    });
  },

  /**
   * Derive CLOB API credentials for the given wallet address.
   *
   * 1. Generates an EIP-712 ClobAuth signature via MetaMask
   * 2. Sends the signature to the background which calls the CLOB API
   * 3. Caches the resulting credentials
   */
  async derive(address: string): Promise<DerivedApiKeyResult> {
    const key = address.toLowerCase();
    const existing = credentialDerivationPromises.get(key);
    if (existing) return existing;

    const derivation = deriveCredentialsWithClaim(address).finally(() => {
      credentialDerivationPromises.delete(key);
    });
    credentialDerivationPromises.set(key, derivation);
    return derivation;
  },
};
