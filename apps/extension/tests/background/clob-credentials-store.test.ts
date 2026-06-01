import assert from "node:assert/strict";
import test from "node:test";
import {
  clobCredentialsStorageKey,
  hasClobCredentials,
  loadClobCredentials,
  removeClobCredentials,
  storeClobCredentials,
} from "../../src/background/clob-credentials-store";

function installFakeChromeSession(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  };
  return store;
}

const CREDS = {
  apiKey: "key-1",
  apiSecret: "secret-1",
  apiPassphrase: "passphrase-1",
};

test("clobCredentialsStorageKey namespaces and lowercases the address", () => {
  installFakeChromeSession();
  assert.equal(
    clobCredentialsStorageKey("0xABCdef"),
    "knoww_clob_creds_0xabcdef"
  );
});

test("store then load round-trips the credentials", async () => {
  installFakeChromeSession();
  await storeClobCredentials("0xAbc", CREDS);
  const loaded = await loadClobCredentials("0xabc");
  assert.deepEqual(loaded, CREDS);
});

test("load returns null when no credentials are stored", async () => {
  installFakeChromeSession();
  assert.equal(await loadClobCredentials("0xabc"), null);
});

test("load returns null for a malformed stored value", async () => {
  const store = installFakeChromeSession();
  store[clobCredentialsStorageKey("0xabc")] = { apiKey: "only-key" };
  assert.equal(await loadClobCredentials("0xabc"), null);
});

test("hasClobCredentials reflects presence", async () => {
  installFakeChromeSession();
  assert.equal(await hasClobCredentials("0xabc"), false);
  await storeClobCredentials("0xabc", CREDS);
  assert.equal(await hasClobCredentials("0xabc"), true);
});

test("removeClobCredentials deletes the stored credentials", async () => {
  installFakeChromeSession();
  await storeClobCredentials("0xabc", CREDS);
  await removeClobCredentials("0xabc");
  assert.equal(await loadClobCredentials("0xabc"), null);
});
