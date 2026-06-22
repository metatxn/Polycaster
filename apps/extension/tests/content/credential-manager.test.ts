/// <reference path="../../src/env.d.ts" />

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAuthorized: vi.fn(),
  signTypedData: vi.fn(),
}));

vi.mock("../../src/content/trading/extension-session", () => ({
  ExtensionSession: {
    ensureAuthorized: mocks.ensureAuthorized,
  },
}));

vi.mock("../../src/content/trading/bridge", () => ({
  WalletBridge: {
    signTypedData: mocks.signTypedData,
  },
}));

import { CredentialManager } from "../../src/content/trading/credentials";

type SendMessageCallback = (response: unknown) => void;

function installChromeRuntimeHarness() {
  let deriveRequests = 0;
  let beginRequests = 0;
  let endRequests = 0;
  const runtime = {
    lastError: undefined as { message?: string } | undefined,
    sendMessage(message: { type?: string }, callback: SendMessageCallback) {
      runtime.lastError = undefined;
      if (message.type === "creds:has") {
        callback({ ok: true, data: { hasCredentials: false } });
        return;
      }
      if (message.type === "creds:derive-begin") {
        beginRequests += 1;
        callback({
          ok: true,
          data: { status: "claimed", token: `claim-${beginRequests}` },
        });
        return;
      }
      if (message.type === "creds:derive-end") {
        endRequests += 1;
        callback({ ok: true, data: { released: true } });
        return;
      }
      if (message.type === "trading:derive-credentials") {
        deriveRequests += 1;
        callback({ ok: true, data: { method: "derive" } });
        return;
      }
      callback({ ok: false, error: `Unexpected message: ${message.type}` });
    },
  };

  (globalThis as { chrome?: unknown }).chrome = {
    runtime,
  };

  return {
    get deriveRequests() {
      return deriveRequests;
    },
    get beginRequests() {
      return beginRequests;
    },
    get endRequests() {
      return endRequests;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete (globalThis as { chrome?: unknown }).chrome;
});

test("concurrent credential derivations share one ClobAuth signature request", async () => {
  const chromeHarness = installChromeRuntimeHarness();
  mocks.ensureAuthorized.mockResolvedValue(undefined);
  mocks.signTypedData.mockResolvedValue("0xsig");

  const address = "0x000000000000000000000000000000000000dEaD";
  const [first, second] = await Promise.all([
    CredentialManager.derive(address),
    CredentialManager.derive(address),
  ]);

  assert.deepEqual(first, { method: "derive" });
  assert.deepEqual(second, { method: "derive" });
  assert.equal(mocks.ensureAuthorized.mock.calls.length, 1);
  assert.equal(mocks.signTypedData.mock.calls.length, 1);
  assert.equal(chromeHarness.beginRequests, 1);
  assert.equal(chromeHarness.deriveRequests, 1);
  assert.equal(chromeHarness.endRequests, 1);
});

test("waiting credential derivation survives a transient idle status after worker restart", async () => {
  vi.useFakeTimers();
  let hasRequests = 0;
  let statusRequests = 0;

  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(message: { type?: string }, callback: SendMessageCallback) {
        if (message.type === "creds:has") {
          hasRequests += 1;
          callback({
            ok: true,
            data: { hasCredentials: hasRequests >= 3 },
          });
          return;
        }
        if (message.type === "creds:derive-begin") {
          callback({ ok: true, data: { status: "busy" } });
          return;
        }
        if (message.type === "creds:derive-status") {
          statusRequests += 1;
          callback({ ok: true, data: { status: "idle" } });
          return;
        }
        callback({ ok: false, error: `Unexpected message: ${message.type}` });
      },
    },
  };

  const promise = CredentialManager.derive(
    "0x000000000000000000000000000000000000bEEF"
  );

  await vi.advanceTimersByTimeAsync(500);
  const result = await promise;

  assert.deepEqual(result, { method: "derive" });
  assert.equal(statusRequests, 1);
  assert.equal(mocks.ensureAuthorized.mock.calls.length, 0);
  assert.equal(mocks.signTypedData.mock.calls.length, 0);
});
