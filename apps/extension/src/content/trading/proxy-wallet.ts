/**
 * ProxyWallet — derives the Polymarket Safe proxy address from an EOA.
 *
 * Since keccak256 is needed for CREATE2 derivation and we want to keep
 * the content script lightweight, the computation is delegated to the
 * background service worker which already has ethers bundled.
 */

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function sendTradingMessage<T>(
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

export const ProxyWallet = {
  async deriveAddress(eoaAddress: string): Promise<string> {
    const data = await sendTradingMessage<{ proxyAddress: string }>(
      { type: "trading:derive-proxy-address", eoaAddress },
      "Failed to derive proxy address"
    );
    return data.proxyAddress;
  },

  async getBalance(proxyAddress: string): Promise<{
    balance: number;
    balanceRaw: string;
    polBalance?: number;
    tokenBalances?: Array<{ symbol: string; amount: number }>;
    /** On-chain Safe-deployment status (true iff code exists at proxyAddress). */
    isDeployed?: boolean;
  }> {
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
