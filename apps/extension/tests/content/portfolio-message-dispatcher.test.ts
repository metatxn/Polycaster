import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import type { TradingRuntime } from "../../src/content/trading-runtime-types";
import { WALLETCONNECT_WALLET_UUID } from "../../src/content/walletconnect-constants";

declare const process: { cwd(): string };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function fakeRuntime(overrides: Partial<TradingRuntime> = {}): TradingRuntime {
  return {
    openTradingPanel: () => {},
    hideTradingPanel: () => {},
    hydrateStreamBet: () => ({ dispose: () => {} }),
    handlePortfolioMessage: () => false,
    handleSigningRequest: () => false,
    getWalletConnectStateSync: () => ({
      status: "runtime-idle",
      error: null,
      qrSvg: null,
    }),
    cancelWalletConnect: async () => {},
    cancelWalletConnectSync: () => {},
    dispose: () => {},
    ...overrides,
  };
}

async function createHarness(options?: {
  load?: () => Promise<TradingRuntime>;
  loaded?: () => TradingRuntime | null;
  sendRuntimeMessage?: (message: unknown) => unknown;
}) {
  const { createPortfolioMessageDispatcher } = await import(
    "../../src/content/ui/portfolio-message-dispatcher"
  );
  return createPortfolioMessageDispatcher({
    loadTradingRuntime: options?.load ?? vi.fn(),
    getLoadedRuntime: options?.loaded ?? (() => null),
    sendRuntimeMessage: options?.sendRuntimeMessage ?? vi.fn(),
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

const respondOnCompletionRows = [
  { type: "KNOWW_GET_PORTFOLIO_WALLETS" },
  { type: "KNOWW_GET_PORTFOLIO_CONNECTED_WALLET" },
  { type: "KNOWW_CONNECT_PORTFOLIO_WALLET", walletUuid: "installed-wallet" },
  { type: "KNOWW_SWITCH_PORTFOLIO_WALLET" },
  { type: "KNOWW_PORTFOLIO_REAUTH" },
  { type: "KNOWW_APPROVE_PORTFOLIO_TRADING" },
] as const;

test.each(respondOnCompletionRows)(
  "$type is respond-on-completion and delegates exactly once",
  async (message) => {
    const response = { success: true, data: { delegated: message.type } };
    const handle = vi.fn((_message, sendResponse) => {
      sendResponse(response);
      return true;
    });
    const runtime = fakeRuntime({ handlePortfolioMessage: handle });
    const load = vi.fn().mockResolvedValue(runtime);
    const dispatcher = await createHarness({ load });
    const sendResponse = vi.fn();

    assert.equal(dispatcher.dispatch(message, sendResponse), true);
    assert.equal(sendResponse.mock.calls.length, 0);
    await flush();
    assert.equal(load.mock.calls.length, 1);
    assert.equal(handle.mock.calls.length, 1);
    assert.deepEqual(sendResponse.mock.calls, [[response]]);
  }
);

test.each(respondOnCompletionRows)(
  "$type returns the exact error envelope when the bundle fails to load",
  async (message) => {
    const dispatcher = await createHarness({
      load: vi.fn().mockRejectedValue(new Error("runtime unavailable")),
    });
    const sendResponse = vi.fn();

    assert.equal(dispatcher.dispatch(message, sendResponse), true);
    await flush();
    assert.deepEqual(sendResponse.mock.calls, [
      [{ success: false, data: { error: "runtime unavailable" } }],
    ]);
  }
);

test("ENABLE acknowledges synchronously, returns false, and swallows load errors", async () => {
  const load = vi.fn().mockRejectedValue(new Error("offline"));
  const dispatcher = await createHarness({ load });
  const sendResponse = vi.fn();

  assert.equal(
    dispatcher.dispatch(
      { type: "KNOWW_ENABLE_PORTFOLIO_TRADING", address: "0xabc" },
      sendResponse
    ),
    false
  );
  assert.deepEqual(sendResponse.mock.calls, [
    [{ success: true, data: { status: "started" } }],
  ]);
  await flush();
  assert.equal(load.mock.calls.length, 1);
  assert.equal(sendResponse.mock.calls.length, 1);
});

test("ENABLE delegates after loading without sending a second acknowledgement", async () => {
  const handle = vi.fn(() => false);
  const runtime = fakeRuntime({ handlePortfolioMessage: handle });
  const dispatcher = await createHarness({
    load: vi.fn().mockResolvedValue(runtime),
  });
  const sendResponse = vi.fn();
  const message = { type: "KNOWW_ENABLE_PORTFOLIO_TRADING", address: "0xabc" };

  assert.equal(dispatcher.dispatch(message, sendResponse), false);
  await flush();
  assert.equal(handle.mock.calls.length, 1);
  assert.deepEqual(sendResponse.mock.calls, [
    [{ success: true, data: { status: "started" } }],
  ]);
});

test("WalletConnect connect records loading before its synchronous started ack", async () => {
  const pending = deferred<TradingRuntime>();
  const dispatcher = await createHarness({ load: () => pending.promise });
  const events: string[] = [];
  const sendResponse = vi.fn(() => {
    events.push(dispatcher.getTransitionRecord()?.status ?? "none");
  });

  assert.equal(
    dispatcher.dispatch(
      {
        type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
        walletUuid: WALLETCONNECT_WALLET_UUID,
      },
      sendResponse
    ),
    false
  );
  assert.deepEqual(events, ["loading"]);
  assert.deepEqual(sendResponse.mock.calls, [
    [{ success: true, data: { status: "started" } }],
  ]);

  const stateResponse = vi.fn();
  assert.equal(
    dispatcher.dispatch(
      { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
      stateResponse
    ),
    false
  );
  assert.deepEqual(stateResponse.mock.calls, [
    [
      {
        success: true,
        data: { status: "initializing", error: null, qrSvg: null },
      },
    ],
  ]);
});

test("WalletConnect successful handoff clears the core record and warm runtime becomes authoritative", async () => {
  const handle = vi.fn(() => false);
  const runtime = fakeRuntime({
    handlePortfolioMessage: handle,
    getWalletConnectStateSync: () => ({
      status: "pairing",
      error: null,
      qrSvg: "<svg />",
    }),
  });
  const dispatcher = await createHarness({
    load: vi.fn().mockResolvedValue(runtime),
    loaded: () => runtime,
  });
  dispatcher.dispatch(
    {
      type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
      walletUuid: WALLETCONNECT_WALLET_UUID,
    },
    vi.fn()
  );
  await flush();

  assert.equal(handle.mock.calls.length, 1);
  assert.equal(dispatcher.getTransitionRecord(), null);
  const sendResponse = vi.fn();
  dispatcher.dispatch(
    { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
    sendResponse
  );
  assert.deepEqual(sendResponse.mock.calls, [
    [
      {
        success: true,
        data: { status: "pairing", error: null, qrSvg: "<svg />" },
      },
    ],
  ]);
});

test("WalletConnect import failure remains observable as error", async () => {
  const dispatcher = await createHarness({
    load: vi.fn().mockRejectedValue(new Error("chunk blocked")),
  });
  dispatcher.dispatch(
    {
      type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
      walletUuid: WALLETCONNECT_WALLET_UUID,
    },
    vi.fn()
  );
  await flush();

  const sendResponse = vi.fn();
  dispatcher.dispatch(
    { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
    sendResponse
  );
  assert.deepEqual(sendResponse.mock.calls[0]?.[0], {
    success: true,
    data: { status: "error", error: "chunk blocked", qrSvg: null },
  });
});

test("GET_STATE never loads and delegates only when no core record owns state", async () => {
  const load = vi.fn();
  const runtime = fakeRuntime({
    getWalletConnectStateSync: () => ({
      status: "connected",
      error: null,
      qrSvg: null,
    }),
  });
  const dispatcher = await createHarness({ load, loaded: () => runtime });
  const sendResponse = vi.fn();

  assert.equal(
    dispatcher.dispatch(
      { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
      sendResponse
    ),
    false
  );
  assert.equal(load.mock.calls.length, 0);
  assert.deepEqual(sendResponse.mock.calls[0]?.[0], {
    success: true,
    data: { status: "connected", error: null, qrSvg: null },
  });
});

test("cold GET_STATE returns the exact idle envelope without loading", async () => {
  const load = vi.fn();
  const dispatcher = await createHarness({ load, loaded: () => null });
  const sendResponse = vi.fn();
  assert.equal(
    dispatcher.dispatch(
      { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
      sendResponse
    ),
    false
  );
  assert.equal(load.mock.calls.length, 0);
  assert.deepEqual(sendResponse.mock.calls[0]?.[0], {
    success: true,
    data: { status: "idle", error: null, qrSvg: null },
  });
});

test("warm cancel makes core idle authoritative until cleanup resolves", async () => {
  const cleanup = deferred<void>();
  const cancel = vi.fn(() => cleanup.promise);
  const runtime = fakeRuntime({
    cancelWalletConnect: cancel,
    getWalletConnectStateSync: () => ({
      status: "pairing",
      error: null,
      qrSvg: "qr",
    }),
  });
  const load = vi.fn();
  const dispatcher = await createHarness({ load, loaded: () => runtime });
  const cancelResponse = vi.fn();

  assert.equal(
    dispatcher.dispatch(
      { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
      cancelResponse
    ),
    false
  );
  assert.deepEqual(cancelResponse.mock.calls[0]?.[0], {
    success: true,
    data: { status: "cancelled" },
  });
  assert.equal(cancel.mock.calls.length, 1);
  assert.equal(load.mock.calls.length, 0);

  const pendingState = vi.fn();
  dispatcher.dispatch(
    { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
    pendingState
  );
  assert.equal(pendingState.mock.calls[0]?.[0].data.status, "idle");

  cleanup.resolve();
  await flush();
  assert.equal(dispatcher.getTransitionRecord(), null);
  const completedState = vi.fn();
  dispatcher.dispatch(
    { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
    completedState
  );
  assert.equal(completedState.mock.calls[0]?.[0].data.status, "pairing");
});

test("warm cancel rejection keeps cancelled-as-idle core authority", async () => {
  const runtime = fakeRuntime({
    cancelWalletConnect: vi.fn().mockRejectedValue(new Error("cancel failed")),
    getWalletConnectStateSync: () => ({
      status: "pairing",
      error: null,
      qrSvg: "qr",
    }),
  });
  const dispatcher = await createHarness({ loaded: () => runtime });
  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );
  await flush();

  assert.equal(dispatcher.getTransitionRecord()?.status, "cancelled");
  const sendResponse = vi.fn();
  dispatcher.dispatch(
    { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
    sendResponse
  );
  assert.equal(sendResponse.mock.calls[0]?.[0].data.status, "idle");
});

test("cold cancel remains core-authoritative and never loads or touches a persisted session", async () => {
  const load = vi.fn();
  const cancel = vi.fn();
  const persistedRuntime = fakeRuntime({ cancelWalletConnect: cancel });
  const dispatcher = await createHarness({ load, loaded: () => null });
  const sendResponse = vi.fn();

  assert.equal(
    dispatcher.dispatch(
      { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
      sendResponse
    ),
    false
  );
  assert.equal(load.mock.calls.length, 0);
  assert.equal(cancel.mock.calls.length, 0);
  assert.ok(persistedRuntime);
  assert.equal(dispatcher.getTransitionRecord()?.status, "cancelled");
});

test("cancel during import prevents the queued WalletConnect handoff", async () => {
  const pending = deferred<TradingRuntime>();
  const handle = vi.fn(() => false);
  const runtime = fakeRuntime({ handlePortfolioMessage: handle });
  const dispatcher = await createHarness({ load: () => pending.promise });
  dispatcher.dispatch(
    {
      type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
      walletUuid: WALLETCONNECT_WALLET_UUID,
    },
    vi.fn()
  );
  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );
  pending.resolve(runtime);
  await flush();

  assert.equal(handle.mock.calls.length, 0);
  assert.equal(dispatcher.getTransitionRecord()?.status, "cancelled");
});

test("cancelled reconnect waits for old warm cleanup before delegating", async () => {
  const cleanup = deferred<void>();
  const handle = vi.fn(() => false);
  const runtime = fakeRuntime({
    cancelWalletConnect: () => cleanup.promise,
    handlePortfolioMessage: handle,
  });
  const dispatcher = await createHarness({
    load: vi.fn().mockResolvedValue(runtime),
    loaded: () => runtime,
  });
  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );
  dispatcher.dispatch(
    {
      type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
      walletUuid: WALLETCONNECT_WALLET_UUID,
    },
    vi.fn()
  );
  await flush();
  assert.equal(handle.mock.calls.length, 0);
  assert.equal(dispatcher.getTransitionRecord()?.status, "loading");

  cleanup.resolve();
  await flush();
  assert.equal(handle.mock.calls.length, 1);
  assert.equal(dispatcher.getTransitionRecord(), null);
});

test("reconnect waits for every outstanding warm cancellation cleanup", async () => {
  const firstCleanup = deferred<void>();
  const secondCleanup = deferred<void>();
  const cleanups = [firstCleanup.promise, secondCleanup.promise];
  const handle = vi.fn(() => false);
  const runtime = fakeRuntime({
    cancelWalletConnect: () => {
      const cleanup = cleanups.shift();
      if (!cleanup) throw new Error("missing cancellation cleanup");
      return cleanup;
    },
    handlePortfolioMessage: handle,
  });
  const dispatcher = await createHarness({
    load: vi.fn().mockResolvedValue(runtime),
    loaded: () => runtime,
  });
  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );
  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );
  dispatcher.dispatch(
    {
      type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
      walletUuid: WALLETCONNECT_WALLET_UUID,
    },
    vi.fn()
  );

  secondCleanup.resolve();
  await flush();
  assert.equal(handle.mock.calls.length, 0);
  assert.equal(dispatcher.getTransitionRecord()?.status, "loading");

  firstCleanup.resolve();
  await vi.waitFor(() => assert.equal(handle.mock.calls.length, 1));
  assert.equal(dispatcher.getTransitionRecord(), null);
});

test("consecutive cancel stays core-authoritative until every earlier cleanup settles", async () => {
  const firstCleanup = deferred<void>();
  const secondCleanup = deferred<void>();
  const cleanups = [firstCleanup.promise, secondCleanup.promise];
  const runtime = fakeRuntime({
    cancelWalletConnect: () => {
      const cleanup = cleanups.shift();
      if (!cleanup) throw new Error("missing cancellation cleanup");
      return cleanup;
    },
    getWalletConnectStateSync: () => ({
      status: "pairing",
      error: null,
      qrSvg: "stale-qr",
    }),
  });
  const dispatcher = await createHarness({ loaded: () => runtime });
  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );
  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );

  secondCleanup.resolve();
  await flush();
  assert.equal(dispatcher.getTransitionRecord()?.status, "cancelled");
  const pendingState = vi.fn();
  dispatcher.dispatch(
    { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
    pendingState
  );
  assert.equal(pendingState.mock.calls[0]?.[0].data.status, "idle");

  firstCleanup.resolve();
  await vi.waitFor(() => assert.equal(dispatcher.getTransitionRecord(), null));
  const completedState = vi.fn();
  dispatcher.dispatch(
    { type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE" },
    completedState
  );
  assert.equal(completedState.mock.calls[0]?.[0].data.status, "pairing");
});

test("stale cancel cleanup cannot clear or overwrite a newer reconnect", async () => {
  const cleanup = deferred<void>();
  const runtime = fakeRuntime({
    cancelWalletConnect: () => cleanup.promise,
    handlePortfolioMessage: () => {
      throw new Error("new connect failed");
    },
  });
  const dispatcher = await createHarness({
    load: vi.fn().mockResolvedValue(runtime),
    loaded: () => runtime,
  });
  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );
  dispatcher.dispatch(
    {
      type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
      walletUuid: WALLETCONNECT_WALLET_UUID,
    },
    vi.fn()
  );
  cleanup.resolve();
  await flush();

  assert.deepEqual(dispatcher.getTransitionRecord(), {
    generation: 2,
    status: "error",
    error: "new connect failed",
  });
});

test("a stale WalletConnect failure cannot overwrite a newer generation", async () => {
  const first = deferred<TradingRuntime>();
  const second = deferred<TradingRuntime>();
  const loads = [first.promise, second.promise];
  const dispatcher = await createHarness({
    load: () => {
      const next = loads.shift();
      if (!next) throw new Error("missing deferred runtime load");
      return next;
    },
  });
  const connect = {
    type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
    walletUuid: WALLETCONNECT_WALLET_UUID,
  };
  dispatcher.dispatch(connect, vi.fn());
  dispatcher.dispatch(
    { type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" },
    vi.fn()
  );
  dispatcher.dispatch(connect, vi.fn());
  first.reject(new Error("stale failure"));
  await flush();
  assert.equal(dispatcher.getTransitionRecord()?.status, "loading");

  second.resolve(fakeRuntime());
  await flush();
  assert.equal(dispatcher.getTransitionRecord(), null);
});

test("signing acknowledges immediately and delegates through the runtime only", async () => {
  const pending = deferred<TradingRuntime>();
  const signing = vi.fn(() => false);
  const runtime = fakeRuntime({ handleSigningRequest: signing });
  const sendRuntimeMessage = vi.fn();
  const dispatcher = await createHarness({
    load: () => pending.promise,
    sendRuntimeMessage,
  });
  const sendResponse = vi.fn();
  const message = {
    type: "trading:signing-request",
    id: "sign-1",
    method: "personal_sign",
  };

  assert.equal(dispatcher.dispatch(message, sendResponse), false);
  assert.deepEqual(sendResponse.mock.calls, [[{ ok: true }]]);
  assert.equal(signing.mock.calls.length, 0);
  pending.resolve(runtime);
  await flush();
  assert.deepEqual(signing.mock.calls, [[message]]);
  assert.equal(sendResponse.mock.calls.length, 1);
  assert.equal(sendRuntimeMessage.mock.calls.length, 0);
});

test("signing load failure emits exactly one correlated error response", async () => {
  const sendRuntimeMessage = vi.fn().mockResolvedValue(undefined);
  const dispatcher = await createHarness({
    load: vi.fn().mockRejectedValue(new Error("chunk missing")),
    sendRuntimeMessage,
  });
  const sendResponse = vi.fn();
  assert.equal(
    dispatcher.dispatch(
      { type: "trading:signing-request", id: "request-42" },
      sendResponse
    ),
    false
  );
  assert.deepEqual(sendResponse.mock.calls, [[{ ok: true }]]);
  await flush();
  assert.deepEqual(sendRuntimeMessage.mock.calls, [
    [
      {
        type: "trading:signing-response",
        id: "request-42",
        error: "chunk missing",
      },
    ],
  ]);
});

test("unknown messages return false without loading or responding", async () => {
  const load = vi.fn();
  const dispatcher = await createHarness({ load });
  const sendResponse = vi.fn();
  assert.equal(
    dispatcher.dispatch({ type: "KNOWW_UNKNOWN_MESSAGE" }, sendResponse),
    false
  );
  assert.equal(load.mock.calls.length, 0);
  assert.equal(sendResponse.mock.calls.length, 0);
});

test("the lazy runtime factory owns signing lifecycle while core keeps one dispatcher listener", () => {
  const entry = readFileSync(
    join(process.cwd(), "src/content/trading/trading-entry.ts"),
    "utf8"
  );
  const ui = readFileSync(
    join(process.cwd(), "src/content/ui/index.ts"),
    "utf8"
  );
  assert.doesNotMatch(entry, /installSigningListener/);
  assert.match(entry, /installSigningLifecycle/);
  assert.doesNotMatch(ui, /createTradingRuntime|adoptLoadedTradingRuntime/);
  assert.match(ui, /loadTradingRuntime/);
  assert.match(
    ui,
    /handleNotificationMessage[\s\S]*portfolioMessageDispatcher\.dispatch/
  );
  assert.match(ui, /KNOWW_CONTENT_UI_MESSAGE_LISTENER_INSTALLED/);
});
