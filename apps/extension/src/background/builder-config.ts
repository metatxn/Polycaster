/**
 * RemoteBuilderConfig for the Chrome extension.
 *
 * Delegates order signing to knoww.app/api/sign, authenticating via
 * the same HMAC scheme used for AI endpoints. This avoids exposing
 * the builder signing server token in the extension bundle.
 */

import { computeHmacHex } from "@knoww/shared-types/crypto";

declare const __KNOWW_EXTENSION_SECRET__: string;
declare const __DEV_MODE__: boolean;

const SIGN_PROXY_URL = __DEV_MODE__
  ? "http://localhost:8787/api/sign"
  : "https://knoww.app/api/sign";

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
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        const secret: string = __KNOWW_EXTENSION_SECRET__;
        if (secret) {
          const ts = Date.now().toString();
          const hmac = await computeHmacHex(secret, `${ts}:${bodyStr}`);
          headers["X-Knoww-Signature"] = hmac;
          headers["X-Knoww-Timestamp"] = ts;
        }

        const response = await fetch(SIGN_PROXY_URL, {
          method: "POST",
          headers,
          body: bodyStr,
        });

        if (!response.ok) {
          console.error(
            "[ExtBuilderConfig] sign proxy returned",
            response.status
          );
          return undefined;
        }

        return await response.json();
      } catch (err) {
        console.error("[ExtBuilderConfig] Failed:", err);
        return undefined;
      }
    },
  };
}
