import assert from "node:assert/strict";
import { test } from "vitest";
import {
  checkAuthorizedSender,
  checkCredsKey,
  TRADING_CREDS_STORAGE_PREFIX,
} from "../../src/background/creds-guards";

const RUNTIME_ID = "knoww-extension-id";

// ── checkAuthorizedSender ────────────────────────────────────────────────────

test("checkAuthorizedSender allows messages from this extension itself", () => {
  assert.equal(checkAuthorizedSender(RUNTIME_ID, RUNTIME_ID), null);
});

test("checkAuthorizedSender rejects messages from a different extension id", () => {
  const result = checkAuthorizedSender("other-extension-id", RUNTIME_ID);
  assert.deepEqual(result, {
    ok: false,
    error: "forbidden: external sender",
  });
});

test("checkAuthorizedSender rejects messages with no sender id (web-page origin)", () => {
  // chrome.runtime.MessageSender.id is undefined for messages from
  // externally_connectable web pages; this guard hard-blocks that path.
  const result = checkAuthorizedSender(undefined, RUNTIME_ID);
  assert.deepEqual(result, {
    ok: false,
    error: "forbidden: external sender",
  });
});

test("checkAuthorizedSender rejects messages with empty string sender id", () => {
  const result = checkAuthorizedSender("", RUNTIME_ID);
  assert.deepEqual(result, {
    ok: false,
    error: "forbidden: external sender",
  });
});

// ── checkCredsKey ────────────────────────────────────────────────────────────

test("checkCredsKey allows keys in the trading-creds namespace", () => {
  const key = `${TRADING_CREDS_STORAGE_PREFIX}0xeee50c8c6e3b28f197b6904b1653dd79338b821c`;
  assert.equal(checkCredsKey(key), null);
});

test("checkCredsKey allows the bare prefix (zero-address tail)", () => {
  // Lower-bound case: handler still passes the guard but the key has
  // no address tail. This is acceptable since the storage layer is the
  // source of truth for what's actually stored under that key.
  assert.equal(checkCredsKey(TRADING_CREDS_STORAGE_PREFIX), null);
});

test("checkCredsKey rejects the extension bearer-token storage key", () => {
  // This is the critical lateral-read guard. Without it, an XSS on an
  // allowlisted content-script host could call `creds:get` with this key
  // and exfiltrate the extension bearer token.
  const result = checkCredsKey("knoww_extension_access_token");
  assert.deepEqual(result, {
    ok: false,
    error: "forbidden: key not in trading-creds namespace",
  });
});

test("checkCredsKey rejects arbitrary unrelated session-storage keys", () => {
  for (const key of ["knowwSettings", "some-other-key", "__proto__", ""]) {
    const result = checkCredsKey(key);
    assert.deepEqual(
      result,
      {
        ok: false,
        error: "forbidden: key not in trading-creds namespace",
      },
      `expected rejection for ${JSON.stringify(key)}`
    );
  }
});

test("checkCredsKey rejects near-miss keys that don't fully match the prefix", () => {
  // `knoww_clob_creds` without the trailing underscore must not pass —
  // the trailing-underscore boundary is what keeps the namespace from
  // accidentally swallowing sibling-prefixed keys (e.g. `knoww_clob_creds2`).
  const result = checkCredsKey("knoww_clob_creds");
  assert.deepEqual(result, {
    ok: false,
    error: "forbidden: key not in trading-creds namespace",
  });
});

// ── Constant invariants ──────────────────────────────────────────────────────

test("TRADING_CREDS_STORAGE_PREFIX ends with an underscore so address tails stay separable", () => {
  // The handler does `key.slice(TRADING_CREDS_STORAGE_PREFIX.length)` to
  // recover the address; that only round-trips if the prefix ends with the
  // delimiter the content-script uses to join the address (an underscore).
  assert.equal(
    TRADING_CREDS_STORAGE_PREFIX.endsWith("_"),
    true,
    "prefix must end with '_'"
  );
});
