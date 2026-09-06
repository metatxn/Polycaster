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
  initGate: null as Promise<void> | null,
  connectReject: null as ((reason: unknown) => void) | null,
  connectResolve: null as ((session: unknown) => void) | null,
  listeners: new Map<string, (...args: unknown[]) => void>(),
  provider: null as Record<string, unknown> | null,
  storages: [] as Array<{
    setItem(key: string, value: unknown): Promise<void>;
  }>,
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
    init: async (options: {
      storage: { setItem(key: string, value: unknown): Promise<void> };
    }) => {
      walletConnect.storages.push(options.storage);
      const provider = walletConnect.provider;
      await walletConnect.initGate;
      return provider;
    },
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
  walletConnect.initGate = null;
  walletConnect.storages.length = 0;
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
      core: {
        relayer: { transportClose: vi.fn(async () => {}) },
        heartbeat: { stop: vi.fn() },
      },
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

test("cancel and reconnect do not wait for an abandoned approval promise", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  void WalletConnectBridge.connect().catch(() => {});
  await vi.waitFor(() =>
    assert.equal(providerMock("connect").mock.calls.length, 1)
  );
  let cancelled = false;
  void WalletConnectBridge.cancel().then(() => {
    cancelled = true;
  });
  await vi.waitFor(() => assert.equal(cancelled, true), { timeout: 250 });
  void WalletConnectBridge.connect({ forceNew: true }).catch(() => {});
  await vi.waitFor(
    () => assert.equal(providerMock("connect").mock.calls.length, 2),
    { timeout: 250 }
  );
  assert.equal(WalletConnectBridge.getState().status, "pairing");
  assert.equal(walletConnect.storages.length, 2);
});

test("retired transport closes only after the abandoned attempt settles", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  const attempt = WalletConnectBridge.connect();
  void attempt.catch(() => {});
  await vi.waitFor(() => assert.ok(walletConnect.connectReject));
  const client = walletConnect.provider?.client as {
    core: { relayer: { transportClose: ReturnType<typeof vi.fn> }; heartbeat: { stop: ReturnType<typeof vi.fn> } };
  };
  await WalletConnectBridge.cancel();
  assert.equal(client.core.relayer.transportClose.mock.calls.length, 0);
  walletConnect.connectReject?.(new Error("expired"));
  await assert.rejects(attempt, /expired/);
  await vi.waitFor(() => assert.equal(client.core.relayer.transportClose.mock.calls.length, 1));
  assert.equal(client.core.heartbeat.stop.mock.calls.length, 1);
});

test("cancelled initialization does not block a replacement provider", async () => {
  let finishInit!: () => void;
  walletConnect.initGate = new Promise<void>((resolve) => { finishInit = resolve; });
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  const oldAttempt = WalletConnectBridge.connect();
  void oldAttempt.catch(() => {});
  await vi.waitFor(() => assert.equal(walletConnect.storages.length, 1));
  let cancelled = false;
  void WalletConnectBridge.cancel().then(() => { cancelled = true; });
  await vi.waitFor(() => assert.equal(cancelled, true), { timeout: 250 });
  walletConnect.initGate = null;
  walletConnect.provider = { ...walletConnect.provider };
  void WalletConnectBridge.connect({ forceNew: true }).catch(() => {});
  await vi.waitFor(() => assert.equal(providerMock("connect").mock.calls.length, 1));
  assert.equal(walletConnect.storages.length, 2);
  finishInit();
  await assert.rejects(oldAttempt, /superseded/);
  assert.equal(providerMock("connect").mock.calls.length, 1);
});

test("account refresh does not clear a pending QR", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  void WalletConnectBridge.connect().catch(() => {});
  await vi.waitFor(() =>
    assert.equal(providerMock("connect").mock.calls.length, 1)
  );
  walletConnect.listeners.get("display_uri")?.("test-pairing-uri");
  if (walletConnect.provider)
    walletConnect.provider.session = {
      namespaces: { eip155: { accounts: [] } },
    };
  assert.deepEqual(await WalletConnectBridge.getAccounts(), []);
  assert.equal(WalletConnectBridge.getState().qrUri, "test-pairing-uri");
  await WalletConnectBridge.cancel();
});

test("retired provider events, storage writes, and late approval cannot replace the new session", async () => {
  const { WalletConnectBridge } = await import(
    "../../src/content/trading/walletconnect-bridge"
  );
  const oldAttempt = WalletConnectBridge.connect();
  void oldAttempt.catch(() => {});
  await vi.waitFor(() =>
    assert.equal(providerMock("connect").mock.calls.length, 1)
  );
  const oldProvider = walletConnect.provider;
  const oldListeners = new Map(walletConnect.listeners);
  const resolveOld = walletConnect.connectResolve;
  await WalletConnectBridge.cancel();
  walletConnect.provider = { ...oldProvider, session: null };
  const newAttempt = WalletConnectBridge.connect({ forceNew: true });
  await vi.waitFor(() =>
    assert.equal(providerMock("connect").mock.calls.length, 2)
  );
  const newAddress = "0x0000000000000000000000000000000000000002";
  const newSession = {
    topic: "new-topic",
    namespaces: { eip155: { accounts: [`eip155:137:${newAddress}`] } },
  };
  if (walletConnect.provider) walletConnect.provider.session = newSession;
  walletConnect.connectResolve?.(newSession);
  assert.deepEqual(await newAttempt, [newAddress]);
  oldListeners.get("display_uri")?.("obsolete-pairing-uri");
  oldListeners.get("accountsChanged")?.([ADDRESS]);
  oldListeners.get("disconnect")?.();
  await walletConnect.storages[0]?.setItem("late-session", "obsolete");
  assert.equal(vi.mocked(chrome.storage.local.set).mock.calls.length, 0);
  const oldSession = {
    topic: "old-topic",
    namespaces: { eip155: { accounts: [`eip155:137:${ADDRESS}`] } },
  };
  if (oldProvider) oldProvider.session = oldSession;
  resolveOld?.(oldSession);
  await vi.waitFor(() =>
    assert.equal(walletConnect.clientDisconnectRequests.length, 1)
  );
  walletConnect.clientDisconnectRequests[0]?.resolve();
  await assert.rejects(oldAttempt, /superseded/);
  assert.deepEqual(await WalletConnectBridge.getAccounts(), [newAddress]);
  assert.equal(WalletConnectBridge.getState().status, "connected");
  assert.equal(WalletConnectBridge.getState().qrUri, null);
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

test("failed abort does not keep the abandoned approval as the active attempt", async () => {
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
  const cancellationRejected = assert.rejects(
    failedCancellation,
    /relay cleanup failed/
  );
  await vi.waitFor(() => {
    assert.equal(providerMock("cleanupPendingPairings").mock.calls.length, 1);
  });
  walletConnect.connectReject?.(new Error("stale approval rejected"));
  await cancellationRejected;
  walletConnect.cleanupError = null;
  const retry = WalletConnectBridge.connect({ forceNew: true });
  void retry.catch(() => {});

  await vi.waitFor(() => {
    assert.equal(providerMock("connect").mock.calls.length, 2);
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
  const resolveStale = walletConnect.connectResolve;
  const cancellation = WalletConnectBridge.cancel();
  await cancellation;
  const newerConnection = WalletConnectBridge.connect({ forceNew: true });
  void newerConnection.catch(() => {});
  await vi.waitFor(() =>
    assert.equal(providerMock("connect").mock.calls.length, 2)
  );

  const staleSession = {
    topic: "stale-topic",
    namespaces: {
      eip155: { accounts: [`eip155:137:${ADDRESS}`] },
    },
  };
  if (walletConnect.provider) walletConnect.provider.session = staleSession;
  resolveStale?.(staleSession);
  await vi.waitFor(() => {
    assert.equal(walletConnect.clientDisconnectRequests.length, 1);
  });
  assert.equal(
    providerMock("connect").mock.calls.length,
    2,
    "the replacement approval can start while stale cleanup is pending"
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
  await cancellation;
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

  await cancellation;
  await assert.rejects(staleConnection, /no cleanup topic/i);
  await assert.rejects(
    WalletConnectBridge.connect({ forceNew: true }),
    /no cleanup topic/i
  );
  assert.equal(walletConnect.clientDisconnectRequests.length, 0);
  assert.equal(providerMock("connect").mock.calls.length, 1);
});
