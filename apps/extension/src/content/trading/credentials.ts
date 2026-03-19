/**
 * CredentialManager — orchestrates CLOB API credential derivation
 * for the extension.
 *
 * Step 1: Sign an EIP-712 ClobAuth message via WalletBridge (MetaMask)
 * Step 2: Send the signature to background which calls the CLOB API
 * Step 3: Cache credentials via background service worker (session storage)
 */

import {
  type ApiKeyCreds,
  CLOB_AUTH_DOMAIN,
  CLOB_AUTH_MESSAGE,
  CLOB_AUTH_TYPES,
} from "@knoww/shared-types/polymarket";

export type { ApiKeyCreds } from "@knoww/shared-types/polymarket";

import { WalletBridge } from "./bridge";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function sendTradingMsg<T>(
  message: Record<string, unknown>,
  errorLabel: string
): Promise<T> {
  let attempt = 0;

  function trySend(): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        message,
        (response: { ok: boolean; data?: T; error?: string }) => {
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

function storageKey(address: string): string {
  return `${CREDS_STORAGE_KEY}_${address.toLowerCase()}`;
}

export const CredentialManager = {
  async getStored(address: string): Promise<ApiKeyCreds | null> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "creds:get", key: storageKey(address) },
        (resp: { ok: boolean; data?: ApiKeyCreds | null }) => {
          if (chrome.runtime.lastError || !resp?.ok) {
            resolve(null);
            return;
          }
          resolve(resp.data ?? null);
        }
      );
    });
  },

  async store(address: string, creds: ApiKeyCreds): Promise<void> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "creds:set", key: storageKey(address), value: creds },
        () => {
          resolve();
        }
      );
    });
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
  async derive(address: string): Promise<ApiKeyCreds> {
    // Check cache first
    const cached = await this.getStored(address);
    if (cached) return cached;

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = 0;

    // Build EIP-712 typed data payload
    const typedData = JSON.stringify({
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
        ],
        ClobAuth: CLOB_AUTH_TYPES.ClobAuth,
      },
      primaryType: "ClobAuth",
      domain: CLOB_AUTH_DOMAIN,
      message: {
        address,
        timestamp: `${timestamp}`,
        nonce: nonce,
        message: CLOB_AUTH_MESSAGE,
      },
    });

    const signature = await WalletBridge.signTypedData(address, typedData);

    // Send to background for credential derivation via CLOB API
    const creds = await sendTradingMsg<ApiKeyCreds>(
      {
        type: "trading:derive-credentials",
        address,
        signature,
        timestamp: `${timestamp}`,
        nonce,
      },
      "Failed to derive credentials"
    );

    await this.store(address, creds);
    return creds;
  },
};
