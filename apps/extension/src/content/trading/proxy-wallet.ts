/**
 * ProxyWallet — derives the Polymarket Safe proxy address from an EOA.
 *
 * Since keccak256 is needed for CREATE2 derivation and we want to keep
 * the content script lightweight, the computation is delegated to the
 * background service worker which already has the viem trading runtime bundled.
 */

import type { TradingBalanceData } from "../../types/chrome-messages";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const MESSAGE_TIMEOUT_MS = 20_000;

function sendTradingMessage<T>(
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

export const ProxyWallet = {
  async deriveAddress(eoaAddress: string): Promise<string> {
    const data = await sendTradingMessage<{ proxyAddress: string }>(
      { type: "trading:derive-proxy-address", eoaAddress },
      "Failed to derive proxy address"
    );
    return data.proxyAddress;
  },

  async getBalance(proxyAddress: string): Promise<TradingBalanceData> {
    return sendTradingMessage(
      { type: "trading:get-balance", proxyAddress },
      "Failed to get balance"
    );
  },

  async getAllowance(
    ownerAddress: string,
    negRisk = false
  ): Promise<{ allowance: number; allowanceRaw: string }> {
    return sendTradingMessage(
      { type: "trading:get-allowance", ownerAddress, negRisk },
      "Failed to get allowance"
    );
  },
};
