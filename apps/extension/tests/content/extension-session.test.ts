/// <reference path="../../src/env.d.ts" />

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getChainId: vi.fn(),
  signMessage: vi.fn(),
}));

vi.mock("../../src/content/trading/bridge", () => ({
  WalletBridge: {
    getChainId: mocks.getChainId,
    signMessage: mocks.signMessage,
  },
}));

type SendMessageCallback = (response: unknown) => void;

function installChromeRuntimeHarness(sessionAddress: string) {
  const messages: Array<{ body?: unknown; type?: string; url?: string }> = [];
  const runtime = {
    lastError: undefined as { message?: string } | undefined,
    sendMessage(
      message: { body?: unknown; type?: string; url?: string },
      callback: SendMessageCallback
    ) {
      runtime.lastError = undefined;
      messages.push(message);

      if (message.type === "auth:get-session-info") {
        callback({
          ok: true,
          data: { loggedIn: true, address: sessionAddress },
        });
        return;
      }

      if (message.type === "auth:clear-token") {
        callback({ ok: true, data: null });
        return;
      }

      if (message.type === "auth:set-token") {
        callback({ ok: true, data: null });
        return;
      }

      if (
        message.type === "fetch-json" &&
        message.url === "https://knoww.app/api/extension/session/challenge"
      ) {
        callback({
          ok: true,
          status: 200,
          data: {
            challengeToken: "challenge-token",
            message: "Sign in to Knoww",
          },
        });
        return;
      }

      if (
        message.type === "fetch-json" &&
        message.url === "https://knoww.app/api/extension/session/verify"
      ) {
        callback({
          ok: true,
          status: 200,
          data: {
            success: true,
            token: "new-session-token",
          },
        });
        return;
      }

      callback({ ok: false, error: `Unexpected message: ${message.type}` });
    },
  };

  (globalThis as { chrome?: unknown }).chrome = { runtime };
  (globalThis as { window?: unknown }).window = {};

  return { messages };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { __DEV_MODE__?: unknown }).__DEV_MODE__;
});

test("reauthorizes when the stored extension session belongs to a different address", async () => {
  const existingAddress = "0x1111111111111111111111111111111111111111";
  const requestedAddress = "0x2222222222222222222222222222222222222222";
  const harness = installChromeRuntimeHarness(existingAddress);
  (globalThis as { __DEV_MODE__?: boolean }).__DEV_MODE__ = false;
  mocks.getChainId.mockResolvedValue("0x89");
  mocks.signMessage.mockResolvedValue(`0x${"1".repeat(130)}`);
  const { ExtensionSession } = await import(
    "../../src/content/trading/extension-session"
  );

  await ExtensionSession.ensureAuthorized(requestedAddress);

  assert.deepEqual(
    harness.messages.map((message) => message.type),
    [
      "auth:get-session-info",
      "auth:clear-token",
      "fetch-json",
      "fetch-json",
      "auth:set-token",
    ]
  );
  assert.deepEqual(mocks.signMessage.mock.calls[0], [
    requestedAddress,
    "Sign in to Knoww",
  ]);
});
