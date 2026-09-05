import { sameAddress } from "@knoww/shared-types/bridge";

import type {
  BackgroundResponse,
  FetchJsonSuccessResponse,
} from "../../types/chrome-messages";
import { WalletBridge } from "./bridge";

const KNOWW_APP_URL = __DEV_MODE__
  ? "http://localhost:8000"
  : "https://knoww.app";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const authorizationRequests = new Map<string, Promise<void>>();

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

interface SessionInfo {
  address?: string | null;
  loggedIn?: boolean;
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

function addressesMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    sameAddress(left, right)
  );
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
  async getInfo(): Promise<SessionInfo> {
    return sendAuthMessage<SessionInfo>(
      { type: "auth:get-session-info" },
      "Failed to get session info"
    );
  },

  /**
   * Whether a knoww session exists. The raw bearer token stays in the
   * background worker; content only learns presence.
   */
  async hasSession(): Promise<boolean> {
    const info = await this.getInfo();
    return info?.loggedIn === true;
  },

  async clear(): Promise<void> {
    await sendAuthMessage<null>(
      { type: "auth:clear-token" },
      "Failed to clear auth token"
    );
  },

  async ensureAuthorized(address: string): Promise<void> {
    const requestKey = address.toLowerCase();
    const existingRequest = authorizationRequests.get(requestKey);
    if (existingRequest) return existingRequest;

    const authorization = (async () => {
      const info = await this.getInfo();
      if (info?.loggedIn === true && addressesMatch(info.address, address)) {
        return;
      }
      if (info?.loggedIn === true) {
        await this.clear();
      }

      void window.KNOWW_ANALYTICS?.track("extension_session_started");

      try {
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
          const reason =
            getApiErrorMessage(nonceResult.data) ||
            "Failed to start Knoww sign-in";
          void window.KNOWW_ANALYTICS?.track("extension_session_failed", {
            reason,
          });
          throw new Error(reason);
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
          const reason =
            getApiErrorMessage(verifyResult.data) || "Knoww sign-in failed";
          void window.KNOWW_ANALYTICS?.track("extension_session_failed", {
            reason,
          });
          throw new Error(reason);
        }

        await sendAuthMessage<null>(
          { type: "auth:set-token", token },
          "Failed to store auth token"
        );

        void window.KNOWW_ANALYTICS?.track("extension_session_succeeded");

        return;
      } catch (err) {
        if (
          err instanceof Error &&
          !err.message.includes("Failed to start") &&
          !err.message.includes("sign-in failed")
        ) {
          void window.KNOWW_ANALYTICS?.track("extension_session_failed", {
            reason: err.message,
          });
        }
        throw err;
      }
    })();

    authorizationRequests.set(requestKey, authorization);
    try {
      await authorization;
    } finally {
      if (authorizationRequests.get(requestKey) === authorization) {
        authorizationRequests.delete(requestKey);
      }
    }
  },
};
