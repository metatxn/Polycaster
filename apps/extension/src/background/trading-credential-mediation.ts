/**
 * Service-worker-side mediation of CLOB credentials for offscreen trading.
 *
 * The trading handler runs in the offscreen document, which cannot persist to
 * the TRUSTED_CONTEXTS-only session store the SW reads. So credentials flow
 * exclusively through the SW (which owns the store):
 *   - outbound credential-bearing ops get creds injected by the SW;
 *   - the derive response is intercepted by the SW, which persists the creds and
 *     relays a content-safe, method-only response.
 * Content never sends or receives the raw credentials.
 */

import type { ApiKeyCreds } from "@knoww/shared-types/polymarket";
import type { BackgroundResponse } from "../types/chrome-messages";

const CREDENTIAL_BEARING_TRADING_OPS = new Set([
  "trading:place-order",
  "trading:split-position",
  "trading:merge-positions",
]);

/** Whether an outbound offscreen trading op needs SW-injected CLOB creds. */
export function tradingOpNeedsCredentials(type: string): boolean {
  return CREDENTIAL_BEARING_TRADING_OPS.has(type);
}

function isApiKeyCreds(value: unknown): value is ApiKeyCreds {
  if (!value || typeof value !== "object") return false;
  const creds = value as Partial<ApiKeyCreds>;
  return (
    typeof creds.apiKey === "string" &&
    typeof creds.apiSecret === "string" &&
    typeof creds.apiPassphrase === "string"
  );
}

/**
 * For a successful `trading:derive-credentials` offscreen response, pull out the
 * raw credentials for the SW to persist and produce a content-safe response
 * carrying only the derivation method. Returns null when there's nothing to
 * persist (the caller then relays the original response unchanged).
 */
export function extractDerivedCredentials(
  result: BackgroundResponse | undefined
): { credentials: ApiKeyCreds; response: BackgroundResponse } | null {
  if (!result || result.ok !== true) return null;
  const data = (result as { data?: unknown }).data;
  if (!isApiKeyCreds(data)) return null;
  const method = (data as { method?: unknown }).method;
  return {
    credentials: {
      apiKey: data.apiKey,
      apiSecret: data.apiSecret,
      apiPassphrase: data.apiPassphrase,
    },
    response: {
      ok: true,
      data: typeof method === "string" ? { method } : {},
    } as BackgroundResponse,
  };
}
