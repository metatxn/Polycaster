import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { TradingRuntime } from "../../src/content/trading-runtime-types";

const walletConnect = vi.hoisted(() => ({
  clientDisconnectRequests: [] as Array<{
    request: unknown;
    reject(reason: unknown): void;
    resolve(): void;
  }>,
  cleanupError: null as Error | null,
  connectReject: null as ((reason: unknown) => void) | null,
  connectResolve: null as ((session: unknown) => void) | null,
  listeners: new Map<string, (...args: unknown[]) => void>(),
  provider: null as Record<string, unknown> | null,
  warnings: [] as Array<{ event: string; details: unknown }>,
}));

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({
    warn: (event: string, details: unknown) => {
      walletConnect.warnings.push({ event, details });
    },
  }),
}));

vi.mock("@walletconnect/universal-provider", () => ({
  default: {
    init: async () => walletConnect.provider,
  },
}));

const ADDRESS = "0x0000000000000000000000000000000000000001";

function providerMock(name: string): ReturnType<typeof vi.fn> {
  const provider = walletConnect.provider;
  assert.ok(provider, "walletConnect provider was not initialised");
  return provider[name] as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  walletConnect.cleanupError = null;
  walletConnect.clientDisconnectRequests.length = 0;
  walletConnect.connectReject = null;
  walletConnect.connectResolve = null;
  walletConnect.listeners.clear();
  walletConnect.warnings.length = 0;
  walletConnect.provider = {
    abortPairingAttempt: vi.fn(),
    cleanupPendingPairings: vi.fn(async () => {
      if (walletConnect.cleanupError) throw walletConnect.cleanupError;
    }),
    connect: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          walletConnect.connectResolve = resolve;
          walletConnect.connectReject = reject;
        })
    ),
    client: {
      disconnect: vi.fn(
        (request: unknown) =>
          new Promise<void>((resolve, reject) => {
            walletConnect.clientDisconnectRequests.push({
              request,
              reject,
              resolve,
            });
          })
      ),
    },
    disconnect: vi.fn(async () => {}),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      walletConnect.listeners.set(event, listener);
    }),
    request: vi.fn(),
    session: null,
  };
  vi.stubGlobal("process", {
    env: { WALLETCONNECT_PROJECT_ID: "test-walletconnect-project" },
  });
  vi.stubGlobal("window", { location: { origin: "https://example.test" } });
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        remove: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  });
  delete (
    globalThis as typeof globalThis & {
      __KNOWW_WALLETCONNECT_BRIDGE_STATE__?: unknown;
    }
  ).__KNOWW_WALLETCONNECT_BRIDGE_STATE__;
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

test("provider cleanup rejection keeps the dispatcher cancelled record authoritative", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  await WalletConnectBridge.getAccounts();
  walletConnect.cleanupError = new Error("relay cleanup failed");

  const { createPortfolioMessageDispatcher } = await import(
    "../../src/content/ui/portfolio-message-dispatcher"
  );
  const runtime = {
    cancelWalletConnect: () => WalletConnectBridge.cancel(),
    getWalletConnectStateSync: () => ({
      ...WalletConnectBridge.getState(),
      qrSvg: null,
    }),
  } as unknown as TradingRuntime;
  const dispatcher = createPortfolioMessageDispatcher({
    getLoadedRuntime: () => runtime,
    loadTradingRuntime: async () => runtime,
  });

  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );
  await vi.waitFor(() => assert.equal(walletConnect.warnings.length, 1));

  assert.equal(walletConnect.warnings[0]?.event, "connect.abort_failed");
  assert.equal(dispatcher.getTransitionRecord()?.status, "cancelled");
  const stateResponse = vi.fn();
  dispatcher.dispatch(
    { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
    stateResponse
  );
  assert.equal(stateResponse.mock.calls[0]?.[0].data.status, "idle");
});

test("failed abort retains the pending attempt so forceNew retries cleanup", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  const firstConnection = WalletConnectBridge.connect();
  void firstConnection.catch(() => {});
  await vi.waitFor(() => {
    assert.equal(providerMock("connect").mock.calls.length, 1);
  });
  walletConnect.cleanupError = new Error("relay cleanup failed");

  const failedCancellation = WalletConnectBridge.cancel();
  await vi.waitFor(() => {
    assert.equal(providerMock("cleanupPendingPairings").mock.calls.length, 1);
  });
  walletConnect.connectReject?.(new Error("stale approval rejected"));
  await assert.rejects(failedCancellation, /relay cleanup failed/);
  walletConnect.cleanupError = null;
  const retry = WalletConnectBridge.connect({ forceNew: true });
  void retry.catch(() => {});

  await vi.waitFor(() => {
    assert.equal(providerMock("cleanupPendingPairings").mock.calls.length, 2);
  });
});

test("cancel aborts pairing cleanup without disconnecting an established session", async () => {
  const establishedSession = {
    namespaces: {
      eip155: { accounts: [`eip155:137:${ADDRESS}`] },
    },
  };
  if (walletConnect.provider) {
    walletConnect.provider.session = establishedSession;
  }
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  assert.deepEqual(await WalletConnectBridge.getAccounts(), [ADDRESS]);

  await WalletConnectBridge.cancel();

  assert.equal(providerMock("disconnect").mock.calls.length, 0);
  assert.equal(walletConnect.provider?.session, establishedSession);
  assert.deepEqual(await WalletConnectBridge.getAccounts(), [ADDRESS]);
});

test("a provider connect that succeeds after cancel rejects as superseded without emitting connected", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  const states: string[] = [];
  WalletConnectBridge.onStateChange((state) => states.push(state.status));
  const connection = WalletConnectBridge.connect();
  void connection.catch(() => {});
  await vi.waitFor(() => {
    assert.equal(providerMock("connect").mock.calls.length, 1);
  });

  const cancellation = WalletConnectBridge.cancel();
  const staleSession = {
    topic: "stale-topic",
    namespaces: {
      eip155: { accounts: [`eip155:137:${ADDRESS}`] },
    },
  };
  if (walletConnect.provider) {
    walletConnect.provider.session = staleSession;
  }
  walletConnect.connectResolve?.(staleSession);

  await vi.waitFor(() => {
    assert.equal(walletConnect.clientDisconnectRequests.length, 1);
  });
  walletConnect.clientDisconnectRequests[0]?.resolve();
  await cancellation;

  await assert.rejects(connection, /superseded/i);
  assert.equal(states.includes("connected"), false);
  assert.equal(WalletConnectBridge.getState().status, "idle");
  assert.deepEqual(walletConnect.clientDisconnectRequests[0]?.request, {
    topic: "stale-topic",
    reason: { code: 6000, message: "User disconnected" },
  });
  assert.equal(providerMock("disconnect").mock.calls.length, 0);
});

test("delayed stale topic cleanup cannot erase a newer connected session", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  const states: string[] = [];
  WalletConnectBridge.onStateChange((state) => states.push(state.status));
  const staleConnection = WalletConnectBridge.connect();
  void staleConnection.catch(() => {});
  await vi.waitFor(() => {
    assert.equal(providerMock("connect").mock.calls.length, 1);
  });
  let cancelSettled = false;
  const cancellation = WalletConnectBridge.cancel().then(() => {
    cancelSettled = true;
  });
  const newerConnection = WalletConnectBridge.connect({ forceNew: true });
  void newerConnection.catch(() => {});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cancelSettled, false);
  assert.equal(
    providerMock("connect").mock.calls.length,
    1,
    "pinned no-op abort must not allow a concurrent second approval"
  );

  const staleSession = {
    topic: "stale-topic",
    namespaces: {
      eip155: { accounts: [`eip155:137:${ADDRESS}`] },
    },
  };
  if (walletConnect.provider) walletConnect.provider.session = staleSession;
  walletConnect.connectResolve?.(staleSession);
  await vi.waitFor(() => {
    assert.equal(walletConnect.clientDisconnectRequests.length, 1);
  });
  assert.equal(cancelSettled, false);
  assert.equal(
    providerMock("connect").mock.calls.length,
    1,
    "new approval must also wait for stale-topic cleanup"
  );
  if (walletConnect.provider) walletConnect.provider.session = null;
  walletConnect.clientDisconnectRequests[0]?.resolve();
  await cancellation;
  await assert.rejects(staleConnection, /superseded/i);
  await vi.waitFor(() => {
    assert.equal(providerMock("connect").mock.calls.length, 2);
  });
  const newerSession = {
    topic: "newer-topic",
    namespaces: {
      eip155: { accounts: [`eip155:137:${ADDRESS}`] },
    },
  };
  if (walletConnect.provider) walletConnect.provider.session = newerSession;
  walletConnect.connectResolve?.(newerSession);
  assert.deepEqual(await newerConnection, [ADDRESS]);
  assert.equal(WalletConnectBridge.getState().status, "connected");
  assert.equal(walletConnect.provider?.session, newerSession);
  assert.equal(WalletConnectBridge.getState().status, "connected");
  assert.equal(states.at(-1), "connected");
  assert.equal(providerMock("disconnect").mock.calls.length, 0);
});

test("forceNew retries a retained stale topic cleanup before starting a new approval", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  const staleConnection = WalletConnectBridge.connect();
  void staleConnection.catch(() => {});
  await vi.waitFor(() => {
    assert.equal(providerMock("connect").mock.calls.length, 1);
  });
  const cancellation = WalletConnectBridge.cancel();
  const staleSession = {
    topic: "retry-stale-topic",
    namespaces: {
      eip155: { accounts: [`eip155:137:${ADDRESS}`] },
    },
  };
  if (walletConnect.provider) walletConnect.provider.session = staleSession;
  walletConnect.connectResolve?.(staleSession);
  await vi.waitFor(() => {
    assert.equal(walletConnect.clientDisconnectRequests.length, 1);
  });
  walletConnect.clientDisconnectRequests[0]?.reject(
    new Error("stale topic disconnect failed")
  );
  await assert.rejects(cancellation, /cleanup failed/i);
  await assert.rejects(staleConnection, /cleanup failed/i);

  const newerConnection = WalletConnectBridge.connect({ forceNew: true });
  void newerConnection.catch(() => {});
  await vi.waitFor(() => {
    assert.equal(
      walletConnect.clientDisconnectRequests.length,
      2,
      "forceNew must retry the exact quarantined stale topic"
    );
  });
  assert.deepEqual(walletConnect.clientDisconnectRequests[1]?.request, {
    topic: "retry-stale-topic",
    reason: { code: 6000, message: "User disconnected" },
  });
  assert.equal(
    providerMock("connect").mock.calls.length,
    1,
    "new approval stays quarantined until the retry succeeds"
  );

  if (walletConnect.provider) walletConnect.provider.session = null;
  walletConnect.clientDisconnectRequests[1]?.resolve();
  await vi.waitFor(() => {
    assert.equal(providerMock("connect").mock.calls.length, 2);
  });
  const newerSession = {
    topic: "retry-newer-topic",
    namespaces: {
      eip155: { accounts: [`eip155:137:${ADDRESS}`] },
    },
  };
  if (walletConnect.provider) walletConnect.provider.session = newerSession;
  walletConnect.connectResolve?.(newerSession);
  assert.deepEqual(await newerConnection, [ADDRESS]);
  assert.equal(walletConnect.provider?.session, newerSession);
  assert.equal(WalletConnectBridge.getState().status, "connected");
  assert.equal(providerMock("disconnect").mock.calls.length, 0);
});

test("a stale session without a topic remains safely quarantined", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  const staleConnection = WalletConnectBridge.connect();
  void staleConnection.catch(() => {});
  await vi.waitFor(() => {
    assert.equal(providerMock("connect").mock.calls.length, 1);
  });
  const cancellation = WalletConnectBridge.cancel();
  const topiclessSession = {
    namespaces: {
      eip155: { accounts: [`eip155:137:${ADDRESS}`] },
    },
  };
  if (walletConnect.provider) walletConnect.provider.session = topiclessSession;
  walletConnect.connectResolve?.(topiclessSession);

  await assert.rejects(cancellation, /no cleanup topic/i);
  await assert.rejects(staleConnection, /no cleanup topic/i);
  await assert.rejects(
    WalletConnectBridge.connect({ forceNew: true }),
    /no cleanup topic/i
  );
  assert.equal(walletConnect.clientDisconnectRequests.length, 0);
  assert.equal(providerMock("connect").mock.calls.length, 1);
});
