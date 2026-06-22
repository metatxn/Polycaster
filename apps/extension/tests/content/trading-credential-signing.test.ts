import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { WalletBridge } from "../../src/content/trading/bridge";

type MessageListener = (event: { source: unknown; data: unknown }) => void;

function installBridgeHarness() {
  const nonce = "nonce-1";
  const listeners: MessageListener[] = [];
  const posted: Array<{ message: Record<string, unknown>; target: string }> =
    [];
  const win = {
    __KNOWW_BRIDGE_NONCE__: nonce,
    location: { origin: "https://example.test" },
    addEventListener(type: string, listener: MessageListener) {
      if (type === "message") listeners.push(listener);
    },
    postMessage(message: Record<string, unknown>, target: string) {
      posted.push({ message, target });
    },
  };

  (globalThis as { window?: unknown }).window = win;
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn(),
      },
    },
  };

  return {
    posted,
    respond(id: unknown, result: unknown) {
      for (const listener of listeners) {
        listener({
          source: win,
          data: {
            type: "KNOWW_BRIDGE_RESPONSE",
            id,
            result,
            _n: nonce,
          },
        });
      }
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { chrome?: unknown }).chrome;
});

test("wallet signature requests do not time out while the wallet prompt is pending", async () => {
  vi.useFakeTimers();
  const harness = installBridgeHarness();
  let state = "pending";

  const promise = WalletBridge.signTypedData(
    "0x000000000000000000000000000000000000dEaD",
    "{}"
  ).then(
    () => {
      state = "resolved";
    },
    (error) => {
      state = error instanceof Error ? error.message : String(error);
    }
  );

  await vi.advanceTimersByTimeAsync(120_000);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(state, "pending");
  const request = harness.posted.find(
    (entry) => entry.message.type === "KNOWW_BRIDGE_REQUEST"
  );
  assert.ok(request);
  harness.respond(request.message.id, "0xsig");
  await promise;
  assert.equal(state, "resolved");
});

test("wallet signature requests still have a long upper bound", async () => {
  vi.useFakeTimers();
  installBridgeHarness();
  let state = "pending";

  WalletBridge.signTypedData(
    "0x000000000000000000000000000000000000dEaD",
    "{}"
  ).catch((error) => {
    state = error instanceof Error ? error.message : String(error);
  });

  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);
  await Promise.resolve();

  assert.match(state, /Wallet request timed out: eth_signTypedData_v4/);
});
