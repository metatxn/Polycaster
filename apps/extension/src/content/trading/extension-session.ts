import type {
  BackgroundResponse,
  FetchJsonSuccessResponse,
} from "../../types/chrome-messages";
import { WalletBridge } from "./bridge";

const KNOWW_APP_URL = __DEV_MODE__
  ? "http://localhost:8787"
  : "https://knoww.app";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

interface NonceResponse {
  challengeToken?: string;
  expiresAt?: string;
  issuedAt?: string;
  message?: string;
  nonce?: string;
}

interface VerifyResponse {
  error?: string;
  expiresAt?: string;
  token?: string;
  success?: boolean;
}

function getApiErrorMessage(payload: unknown): string | null {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return null;
}

function sendAuthMessage<T>(
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
            const err = chrome.runtime.lastError.message || errorLabel;
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

function normalizeChainId(value: string): number {
  const chainId = value.startsWith("0x")
    ? Number.parseInt(value, 16)
    : Number.parseInt(value, 10);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error(`Invalid chain id: ${value}`);
  }
  return chainId;
}

async function fetchJson<T>(
  path: string,
  body: Record<string, unknown>
): Promise<{ data: T; status: number }> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "fetch-json",
        url: `${KNOWW_APP_URL}${path}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      },
      (response: BackgroundResponse) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const isFetchJsonSuccess =
          response?.ok === true && "data" in response && "status" in response;

        if (!isFetchJsonSuccess) {
          reject(
            new Error(
              response?.ok === false && "error" in response
                ? response.error
                : "Challenge request failed"
            )
          );
          return;
        }

        const fetchResponse = response as FetchJsonSuccessResponse;
        resolve({
          data: fetchResponse.data as T,
          status: fetchResponse.status,
        });
      }
    );
  });
}

export const ExtensionSession = {
  async getToken(): Promise<string | null> {
    return sendAuthMessage<string | null>(
      { type: "auth:get-token" },
      "Failed to get auth token"
    );
  },

  async clear(): Promise<void> {
    await sendAuthMessage<null>(
      { type: "auth:clear-token" },
      "Failed to clear auth token"
    );
  },

  async ensureAuthorized(address: string): Promise<string> {
    const cachedToken = await this.getToken();
    if (cachedToken) {
      return cachedToken;
    }

    const chainId = normalizeChainId(await WalletBridge.getChainId());
    const nonceResult = await fetchJson<NonceResponse>(
      "/api/extension/session/challenge",
      {
        walletAddress: address,
        chainId,
      }
    );

    if (
      nonceResult.status < 200 ||
      nonceResult.status >= 300 ||
      !nonceResult.data.message ||
      !nonceResult.data.challengeToken
    ) {
      throw new Error(
        getApiErrorMessage(nonceResult.data) || "Failed to start Knoww sign-in"
      );
    }

    const signature = await WalletBridge.signMessage(
      address,
      nonceResult.data.message
    );
    const verifyResult = await fetchJson<VerifyResponse>(
      "/api/extension/session/verify",
      {
        message: nonceResult.data.message,
        signature,
        challengeToken: nonceResult.data.challengeToken,
        walletAddress: address,
        chainId,
      }
    );

    const token = verifyResult.data.token;

    if (
      verifyResult.status < 200 ||
      verifyResult.status >= 300 ||
      !verifyResult.data.success ||
      !token
    ) {
      throw new Error(
        getApiErrorMessage(verifyResult.data) || "Knoww sign-in failed"
      );
    }

    await sendAuthMessage<null>(
      { type: "auth:set-token", token },
      "Failed to store auth token"
    );

    return token;
  },
};
