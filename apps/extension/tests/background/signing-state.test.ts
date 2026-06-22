import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: () => void
) => boolean;
type TabRemovedListener = (tabId: number) => void;

async function loadSigningStateHarness() {
  vi.resetModules();

  const runtimeListeners: MessageListener[] = [];
  const tabRemovedListeners: TabRemovedListener[] = [];

  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      lastError: undefined,
      onMessage: {
        addListener(listener: MessageListener) {
          runtimeListeners.push(listener);
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener(listener: TabRemovedListener) {
          tabRemovedListeners.push(listener);
        },
      },
      sendMessage(_tabId: number, _message: unknown, callback: () => void) {
        callback();
      },
    },
  };

  const signingState = await import("../../src/background/signing-state");
  return { ...signingState, runtimeListeners, tabRemovedListeners };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  delete (globalThis as { chrome?: unknown }).chrome;
});

test("user-mediated background signing requests keep a long upper bound", async () => {
  vi.useFakeTimers();
  const { sendSigningRequest } = await loadSigningStateHarness();
  let state = "pending";

  sendSigningRequest(123, "eth_signTypedData_v4", []).catch((error) => {
    state = error instanceof Error ? error.message : String(error);
  });

  await vi.advanceTimersByTimeAsync(120_000);
  await Promise.resolve();
  assert.equal(state, "pending");

  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);
  await Promise.resolve();

  assert.match(state, /Signing request timed out/);
});

test("background signing requests reject when their source tab is removed", async () => {
  const { initBridgeWallet, sendSigningRequest, tabRemovedListeners } =
    await loadSigningStateHarness();
  let state = "pending";

  initBridgeWallet();
  sendSigningRequest(123, "eth_signTypedData_v4", []).catch((error) => {
    state = error instanceof Error ? error.message : String(error);
  });

  assert.equal(tabRemovedListeners.length, 1);
  tabRemovedListeners[0]?.(123);
  await Promise.resolve();

  assert.match(state, /Signing tab was closed/);
});
