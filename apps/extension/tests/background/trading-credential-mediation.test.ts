import assert from "node:assert/strict";
import test from "node:test";
import {
  extractDerivedCredentials,
  tradingOpNeedsCredentials,
} from "../../src/background/trading-credential-mediation";

const CREDS = {
  apiKey: "key-1",
  apiSecret: "secret-1",
  apiPassphrase: "passphrase-1",
};

test("tradingOpNeedsCredentials flags only the credential-bearing ops", () => {
  assert.equal(tradingOpNeedsCredentials("trading:place-order"), true);
  assert.equal(tradingOpNeedsCredentials("trading:split-position"), true);
  assert.equal(tradingOpNeedsCredentials("trading:merge-positions"), true);
  assert.equal(tradingOpNeedsCredentials("trading:derive-credentials"), false);
  assert.equal(tradingOpNeedsCredentials("trading:get-order-preflight"), false);
  assert.equal(tradingOpNeedsCredentials("trading:get-balance"), false);
});

test("extractDerivedCredentials pulls creds out and returns a method-only response", () => {
  const result = extractDerivedCredentials({
    ok: true,
    data: { ...CREDS, method: "create" },
  });
  assert.ok(result !== null);
  assert.deepEqual(result?.credentials, CREDS);
  // The response relayed to content carries ONLY the method — no secrets.
  assert.deepEqual(result?.response, { ok: true, data: { method: "create" } });
  assert.equal(JSON.stringify(result?.response).includes("secret-1"), false);
});

test("extractDerivedCredentials returns null for a failed derive response", () => {
  assert.equal(extractDerivedCredentials({ ok: false, error: "boom" }), null);
});

test("extractDerivedCredentials returns null when the response has no credentials", () => {
  assert.equal(
    extractDerivedCredentials({ ok: true, data: { method: "x" } }),
    null
  );
  assert.equal(extractDerivedCredentials(undefined), null);
});
