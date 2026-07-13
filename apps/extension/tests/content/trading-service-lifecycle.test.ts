import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  accountsAdded: [] as Array<(accounts: string[]) => void>,
  accountsRemoved: [] as Array<(accounts: string[]) => void>,
  reset: 0,
}));

vi.mock("../../src/content/trading/bridge", () => ({
  WalletBridge: {
    onAccountsChanged: (listener: (accounts: string[]) => void) => {
      bridge.accountsAdded.push(listener);
      return () => bridge.accountsRemoved.push(listener);
    },
    resetAfterDisconnect: () => {
      bridge.reset += 1;
    },
  },
}));

type RuntimeListener = (message: unknown) => boolean;

const runtimeListeners = {
  added: [] as RuntimeListener[],
  removed: [] as RuntimeListener[],
};

beforeEach(() => {
  bridge.accountsAdded.length = 0;
  bridge.accountsRemoved.length = 0;
  bridge.reset = 0;
  runtimeListeners.added.length = 0;
  runtimeListeners.removed.length = 0;
  vi.stubGlobal("__DEV_MODE__", false);
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (listener: RuntimeListener) =>
          runtimeListeners.added.push(listener),
        removeListener: (listener: RuntimeListener) =>
          runtimeListeners.removed.push(listener),
      },
    },
  });
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

test("trading service import is inert and its installer is idempotent and reversible", async () => {
  const { installTradingServiceListeners } = await import(
    "../../src/content/trading/trading-service"
  );

  assert.equal(bridge.accountsAdded.length, 0);
  assert.equal(runtimeListeners.added.length, 0);

  const dispose = installTradingServiceListeners();
  const duplicateDisposer = installTradingServiceListeners();

  assert.equal(dispose, duplicateDisposer);
  assert.equal(bridge.accountsAdded.length, 1);
  assert.equal(runtimeListeners.added.length, 1);
  assert.equal(runtimeListeners.added[0]({ type: "unrelated" }), false);
  assert.equal(
    runtimeListeners.added[0]({ type: "trading:session-disconnected" }),
    false
  );

  dispose();
  dispose();
  assert.deepEqual(bridge.accountsRemoved, bridge.accountsAdded);
  assert.deepEqual(runtimeListeners.removed, runtimeListeners.added);
});
