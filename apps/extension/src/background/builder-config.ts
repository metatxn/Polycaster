/**
 * RemoteBuilderConfig for the Chrome extension.
 *
 * Delegates order signing to knoww.app/api/sign using the extension's
 * signed extension bearer session. This keeps the builder signing server token
 * server-side and avoids bundling extension secrets.
 *
 * This runs inside the offscreen document where chrome.storage.session is NOT
 * available. The access token is retrieved via message passing to the service
 * worker which owns session storage.
 */

import { EXTENSION_AUTH_REQUIRED_ERROR } from "../types/chrome-messages";
import { getKnowwAppUrl } from "./extension-session";
import { logInfo, logWarn } from "./logger";

const SIGN_PROXY_URL = `${getKnowwAppUrl()}/api/sign`;

/**
 * Get the extension access token via message to the service worker.
 * The offscreen document cannot access chrome.storage.session directly.
 */
async function getAccessTokenViaMessage(): Promise<string | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "auth:get-token",
    });
    if (
      response?.ok &&
      typeof response.data === "string" &&
      response.data.length > 0
    ) {
      return response.data;
    }
    return null;
  } catch {
    return null;
  }
}

async function clearAccessTokenViaMessage(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "auth:clear-token" });
  } catch {
    // ignore
  }
}

/**
 * A BuilderConfig-compatible object that the ClobClient can use
 * for order signing via the remote proxy.
 */
export function createExtensionBuilderConfig() {
  return {
    remoteBuilderConfig: { url: SIGN_PROXY_URL },
    localBuilderCreds: undefined,
    signer: undefined,

    isValid(): boolean {
      return true;
    },

    getBuilderType() {
      return "REMOTE";
    },

    async generateBuilderHeaders(
      method: string,
      path: string,
      body?: string,
      timestamp?: number
    ) {
      try {
        const bodyStr = JSON.stringify({ method, path, body, timestamp });
        const token = await getAccessTokenViaMessage();
        if (!token) {
          logInfo("builder-config.auth-required", {
            path,
            reason: "missing-token",
          });
          throw new Error(EXTENSION_AUTH_REQUIRED_ERROR);
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        };

        const response = await fetch(SIGN_PROXY_URL, {
          method: "POST",
          headers,
          body: bodyStr,
        });

        if (response.status === 401) {
          await clearAccessTokenViaMessage();
          throw new Error(EXTENSION_AUTH_REQUIRED_ERROR);
        }

        if (!response.ok) {
          logWarn("builder-config.sign-failed", {
            status: response.status,
            statusText: response.statusText,
            path,
          });
          return undefined;
        }

        return await response.json();
      } catch (err) {
        if (
          err instanceof Error &&
          err.message === EXTENSION_AUTH_REQUIRED_ERROR
        ) {
          logInfo("builder-config.auth-required", { path });
          throw err;
        }
        logWarn("builder-config.failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return undefined;
      }
    },
  };
}
