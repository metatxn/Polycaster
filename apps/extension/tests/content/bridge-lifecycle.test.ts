import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const walletConnectState = vi.hoisted(() => ({
  cancel: 0,
  signMessageRequests: [] as Array<{
    reject(reason: Error): void;
    resolve(value: string): void;
  }>,
  transactionRequests: [] as Array<{
    reject(reason: Error): void;
    resolve(value: string): void;
  }>,
}));

vi.mock("../../src/content/trading/walletconnect-bridge", () => ({
  WalletConnectBridge: {
    cancel: async () => {
      walletConnectState.cancel += 1;
    },
    connect: async () => ["0x0000000000000000000000000000000000000001"],
    getState: () => ({ status: "idle", qrUri: null, error: null }),
    sendTransaction: () =>
      new Promise<string>((resolve, reject) => {
        walletConnectState.transactionRequests.push({ resolve, reject });
      }),
    signMessage: () =>
      new Promise<string>((resolve, reject) => {
        walletConnectState.signMessageRequests.push({ resolve, reject });
      }),
  },
}));

type Listener = (...args: unknown[]) => unknown;

const observations = {
  chromeAdded: [] as Listener[],
  chromeRemoved: [] as Listener[],
  responses: [] as unknown[],
  windowAdded: [] as Listener[],
  windowRemoved: [] as Listener[],
  windowPosts: [] as unknown[],
};

beforeEach(() => {
  for (const key of Object.keys(observations) as Array<
    keyof typeof observations
  >) {
    observations[key].length = 0;
  }
  walletConnectState.cancel = 0;
  walletConnectState.signMessageRequests.length = 0;
  walletConnectState.transactionRequests.length = 0;

  vi.stubGlobal("window", {
    __KNOWW_BRIDGE_NONCE__: "test-nonce",
    addEventListener: (_type: string, listener: Listener) => {
      observations.windowAdded.push(listener);
    },
    location: { origin: "https://example.test" },
    postMessage: (message: unknown) => {
      observations.windowPosts.push(message);
    },
    removeEventListener: (_type: string, listener: Listener) => {
      observations.windowRemoved.push(listener);
    },
  });
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (listener: Listener) => {
          observations.chromeAdded.push(listener);
        },
        removeListener: (listener: Listener) => {
          observations.chromeRemoved.push(listener);
        },
      },
      sendMessage: (message: unknown) => {
        observations.responses.push(message);
        return Promise.resolve();
      },
    },
  });
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

test("bridge import is inert and init/signing installers remove their exact callbacks", async () => {
  const { installSigningListener, WalletBridge } = await import(
    "../../src/content/trading/bridge"
  );

  assert.equal(observations.windowAdded.length, 0);
  assert.equal(observations.chromeAdded.length, 0);
  assert.equal(observations.windowPosts.length, 0);

  const disposeBridge = WalletBridge.init();
  const duplicateBridgeDisposer = WalletBridge.init();
  const disposeSigning = installSigningListener();
  const duplicateSigningDisposer = installSigningListener();

  assert.equal(disposeBridge, duplicateBridgeDisposer);
  assert.equal(disposeSigning, duplicateSigningDisposer);
  assert.equal(observations.windowAdded.length, 1);
  assert.equal(observations.chromeAdded.length, 1);

  disposeSigning();
  disposeBridge();

  assert.deepEqual(observations.chromeRemoved, observations.chromeAdded);
  assert.deepEqual(observations.windowRemoved, observations.windowAdded);

  const disposeRecreatedBridge = WalletBridge.init();
  const disposeRecreatedSigning = installSigningListener();
  assert.equal(observations.windowAdded.length, 2);
  assert.equal(observations.chromeAdded.length, 2);
  disposeRecreatedSigning();
  disposeRecreatedBridge();
});

test("early bridge init latches its first valid late nonce until disposal", async () => {
  (
    globalThis.window as typeof globalThis.window & {
      __KNOWW_BRIDGE_NONCE__?: string;
    }
  ).__KNOWW_BRIDGE_NONCE__ = undefined;
  const { WalletBridge } = await import("../../src/content/trading/bridge");
  const walletUpdates: unknown[] = [];
  const accountUpdates: unknown[] = [];
  const disposeBridge = WalletBridge.init();
  const disposeWallets = WalletBridge.onWalletsChanged((wallets) =>
    walletUpdates.push(wallets)
  );
  const disposeAccounts = WalletBridge.onAccountsChanged((accounts) =>
    accountUpdates.push(accounts)
  );
  const duplicateDisposer = WalletBridge.init();
  assert.equal(duplicateDisposer, disposeBridge);
  assert.equal(observations.windowAdded.length, 1);

  const listener = observations.windowAdded[0] as (event: unknown) => void;
  for (const nonce of [undefined, "wrong-nonce"]) {
    listener({
      source: globalThis.window,
      data: {
        type: "KNOWW_WALLETS_DISCOVERED",
        wallets: [{ uuid: "wallet-1", name: "Wallet", icon: "", rdns: "" }],
        ...(nonce ? { _n: nonce } : {}),
      },
    });
    listener({
      source: globalThis.window,
      data: {
        type: "KNOWW_WALLET_ACCOUNTS_CHANGED",
        accounts: ["0xabc"],
        ...(nonce ? { _n: nonce } : {}),
      },
    });
  }
  assert.deepEqual(walletUpdates, []);
  assert.deepEqual(accountUpdates, []);

  globalThis.window.__KNOWW_BRIDGE_NONCE__ = "late-nonce";
  listener({
    source: globalThis.window,
    data: {
      type: "KNOWW_WALLETS_DISCOVERED",
      wallets: [{ uuid: "wallet-1", name: "Wallet", icon: "", rdns: "" }],
      _n: "late-nonce",
    },
  });
  listener({
    source: globalThis.window,
    data: {
      type: "KNOWW_WALLET_ACCOUNTS_CHANGED",
      accounts: ["0xabc"],
      _n: "late-nonce",
    },
  });
  assert.equal(walletUpdates.length, 1);
  assert.deepEqual(accountUpdates, [["0xabc"]]);
  assert.equal(observations.windowAdded.length, 1);

  globalThis.window.__KNOWW_BRIDGE_NONCE__ = "replacement-nonce";
  listener({
    source: globalThis.window,
    data: {
      type: "KNOWW_WALLETS_DISCOVERED",
      wallets: [{ uuid: "wallet-2", name: "Replacement", icon: "", rdns: "" }],
      _n: "replacement-nonce",
    },
  });
  listener({
    source: globalThis.window,
    data: {
      type: "KNOWW_WALLET_ACCOUNTS_CHANGED",
      accounts: ["0xdef"],
      _n: "replacement-nonce",
    },
  });
  assert.equal(walletUpdates.length, 1);
  assert.deepEqual(accountUpdates, [["0xabc"]]);
  assert.equal(observations.windowAdded.length, 1);

  disposeAccounts();
  disposeWallets();
  disposeBridge();

  const replacementAccountUpdates: unknown[] = [];
  const disposeReplacementBridge = WalletBridge.init();
  const disposeReplacementAccounts = WalletBridge.onAccountsChanged(
    (accounts) => replacementAccountUpdates.push(accounts)
  );
  assert.equal(observations.windowAdded.length, 2);
  const replacementListener = observations.windowAdded[1] as (
    event: unknown
  ) => void;
  replacementListener({
    source: globalThis.window,
    data: {
      type: "KNOWW_WALLET_ACCOUNTS_CHANGED",
      accounts: ["0xdef"],
      _n: "replacement-nonce",
    },
  });
  assert.deepEqual(replacementAccountUpdates, [["0xdef"]]);
  disposeReplacementAccounts();
  disposeReplacementBridge();
});

test("signing handler acknowledges synchronously and preserves the correlated response channel", async () => {
  const { installSigningListener, WalletBridge } = await import(
    "../../src/content/trading/bridge"
  );
  const disposeBridge = WalletBridge.init();
  const disposeSigning = installSigningListener();
  const signingListener = observations.chromeAdded[0] as (
    message: unknown,
    sender: unknown,
    sendResponse: (response: unknown) => void
  ) => boolean;
  const acknowledgements: unknown[] = [];

  const returnValue = signingListener(
    {
      type: "trading:signing-request",
      id: "request-7",
      method: "personal_sign",
      params: ["0xmessage", "0xaddress"],
    },
    {},
    (response) => acknowledgements.push(response)
  );

  assert.equal(returnValue, false);
  assert.deepEqual(acknowledgements, [{ ok: true }]);
  const bridgeRequest = observations.windowPosts.find(
    (message) => (message as { type?: string }).type === "KNOWW_BRIDGE_REQUEST"
  ) as { id: string; method: string; params: unknown[] };
  assert.equal(bridgeRequest.method, "personal_sign");
  assert.deepEqual(bridgeRequest.params, ["0xmessage", "0xaddress"]);

  const windowListener = observations.windowAdded[0] as (
    event: unknown
  ) => void;
  windowListener({
    source: globalThis.window,
    data: {
      type: "KNOWW_BRIDGE_RESPONSE",
      id: bridgeRequest.id,
      result: "0xsigned",
      _n: "test-nonce",
    },
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(observations.responses, [
    {
      type: "trading:signing-response",
      id: "request-7",
      result: "0xsigned",
    },
  ]);

  disposeSigning();
  disposeBridge();
});

test("disposing signing replies once with an error and invalidates stale WalletConnect completions", async () => {
  const { installSigningListener, WALLETCONNECT_WALLET_UUID, WalletBridge } =
    await import("../../src/content/trading/bridge");
  const disposeBridge = WalletBridge.init();
  const disposeSigning = installSigningListener();
  await WalletBridge.connect(WALLETCONNECT_WALLET_UUID);
  const signingListener = observations.chromeAdded[0] as (
    message: unknown,
    sender: unknown,
    sendResponse: (response: unknown) => void
  ) => boolean;
  const acknowledgements: unknown[] = [];

  for (const message of [
    {
      type: "trading:signing-request",
      id: "stale-sign",
      method: "personal_sign",
      params: ["0xmessage", "0xaddress"],
    },
    {
      type: "trading:signing-request",
      id: "stale-transaction",
      method: "eth_sendTransaction",
      params: [{ to: "0xrecipient" }],
    },
  ]) {
    assert.equal(
      signingListener(message, {}, (response) =>
        acknowledgements.push(response)
      ),
      false
    );
  }

  assert.deepEqual(acknowledgements, [{ ok: true }, { ok: true }]);
  disposeSigning();
  disposeBridge();
  assert.deepEqual(observations.responses, [
    {
      type: "trading:signing-response",
      id: "stale-sign",
      error: "Trading runtime disposed.",
    },
    {
      type: "trading:signing-response",
      id: "stale-transaction",
      error: "Trading runtime disposed.",
    },
  ]);

  walletConnectState.signMessageRequests[0].resolve("0xstale-success");
  walletConnectState.transactionRequests[0].reject(
    new Error("stale rejection")
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(observations.responses.length, 2);

  const disposeFreshBridge = WalletBridge.init();
  const disposeFreshSigning = installSigningListener();
  const freshListener = observations.chromeAdded[1] as typeof signingListener;
  assert.equal(
    freshListener(
      {
        type: "trading:signing-request",
        id: "fresh-sign",
        method: "personal_sign",
        params: ["0xfresh", "0xaddress"],
      },
      {},
      (response) => acknowledgements.push(response)
    ),
    false
  );
  walletConnectState.signMessageRequests[1].resolve("0xfresh-success");
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(observations.responses[2], {
    type: "trading:signing-response",
    id: "fresh-sign",
    result: "0xfresh-success",
  });
  assert.equal(observations.responses.length, 3);
  disposeFreshSigning();
  disposeFreshBridge();
});
