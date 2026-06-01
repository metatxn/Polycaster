/**
 * Defense-in-depth guards for credential and bearer-token message handlers
 * in the extension service worker.
 *
 * These are pure functions with no chrome.* side effects so they can be
 * exercised in isolation by `tests/background/creds-guards.test.ts`.
 *
 * Threat model context (from the security follow-up scan):
 *   - The extension declares no `externally_connectable.matches`, so arbitrary
 *     web pages cannot reach the message listener directly.
 *   - Content scripts are registered programmatically against a curated
 *     host allowlist (~80 hosts). XSS on one of those allowlisted hosts is
 *     the only practical exfil path.
 *   - Without these guards, an XSS-compromised content script could call a
 *     `creds:*` channel with key `knoww_extension_access_token` and lateral-read
 *     the extension bearer token out of session storage. (Raw CLOB credentials
 *     are no longer returned to content at all — only a `creds:has` presence
 *     flag — but the namespace guard still protects every other session key.)
 *
 * `checkAuthorizedSender` blocks the case where a future regression adds
 * `externally_connectable` to the manifest and exposes the listener to web
 * pages. `checkCredsKey` keeps `creds:*` confined to the trading-credentials
 * namespace so the generic key/value channel can't be used for lateral reads.
 */

export const TRADING_CREDS_STORAGE_PREFIX = "knoww_clob_creds_";

export interface CredsGuardResponse {
  ok: false;
  error: string;
}

/**
 * Returns a rejection response if the sender is not this extension itself.
 * `sender.id` is set to the extension's own runtime ID for intra-extension
 * messages (content scripts, popup, sidepanel, offscreen doc, etc.) and
 * differs for messages from other extensions or web pages (the latter would
 * only be possible if `externally_connectable` is declared).
 */
export function checkAuthorizedSender(
  senderId: string | undefined,
  runtimeId: string
): CredsGuardResponse | null {
  if (senderId !== runtimeId) {
    return { ok: false, error: "forbidden: external sender" };
  }
  return null;
}

/**
 * Returns a rejection response if the supplied storage key is not in the
 * trading-credentials namespace. Without this gate, an XSS on an allowlisted
 * content-script host could use a generic `creds:*` channel to read or probe
 * unrelated session-storage entries (most importantly the extension bearer
 * token at `knoww_extension_access_token`).
 */
export function checkCredsKey(key: string): CredsGuardResponse | null {
  if (!key.startsWith(TRADING_CREDS_STORAGE_PREFIX)) {
    return {
      ok: false,
      error: "forbidden: key not in trading-creds namespace",
    };
  }
  return null;
}
