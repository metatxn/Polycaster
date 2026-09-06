import { createLogger } from "@knoww/logger";
import UniversalProvider from "@walletconnect/universal-provider";

const log = createLogger("walletconnect-bridge");

const POLYGON_CAIP_CHAIN_ID = "eip155:137";
const POLYGON_CHAIN_ID_HEX = "0x89";
const POLYGON_RPC_URL = "https://polygon-bor-rpc.publicnode.com";
const STORAGE_PREFIX = "knoww_walletconnect_";
const READ_ONLY_RPC_TIMEOUT_MS = 8000;

const WALLETCONNECT_REQUIRED_METHODS = [
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
];

const WALLETCONNECT_OPTIONAL_METHODS = ["wallet_switchEthereumChain"];
const WALLETCONNECT_EVENTS = ["accountsChanged", "chainChanged"];

type WalletConnectStatus =
  | "idle"
  | "initializing"
  | "pairing"
  | "connected"
  | "error";

export interface WalletConnectState {
  status: WalletConnectStatus;
  qrUri: string | null;
  error: string | null;
}

type WalletConnectStateListener = (state: WalletConnectState) => void;

type KeyValueStorage = {
  getKeys(): Promise<string[]>;
  getEntries<T = unknown>(): Promise<[string, T][]>;
  getItem<T = unknown>(key: string): Promise<T | undefined>;
  setItem<T = unknown>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
};

class ChromeWalletConnectStorage implements KeyValueStorage {
  private retired = false;
  retire(): void {
    this.retired = true;
  }
  private key(key: string): string {
    return `${STORAGE_PREFIX}${key}`;
  }

  private unkey(key: string): string {
    return key.startsWith(STORAGE_PREFIX)
      ? key.slice(STORAGE_PREFIX.length)
      : key;
  }

  async getKeys(): Promise<string[]> {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all)
      .filter((key) => key.startsWith(STORAGE_PREFIX))
      .map((key) => this.unkey(key));
  }

  async getEntries<T = unknown>(): Promise<[string, T][]> {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([key]) => key.startsWith(STORAGE_PREFIX))
      .map(([key, value]) => [this.unkey(key), value as T]);
  }

  async getItem<T = unknown>(key: string): Promise<T | undefined> {
    const storageKey = this.key(key);
    const value = await chrome.storage.local.get(storageKey);
    return value[storageKey] as T | undefined;
  }

  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    if (this.retired) return;
    await chrome.storage.local.set({ [this.key(key)]: value });
  }

  async removeItem(key: string): Promise<void> {
    if (this.retired) return;
    await chrome.storage.local.remove(this.key(key));
  }
}

type WalletConnectBridgeSharedState = {
  providerPromise: Promise<UniversalProvider> | null;
  providerStorage?: ChromeWalletConnectStorage;
  connectPromise: Promise<string[]> | null;
  // Monotonic id for the in-flight connect attempt. Bumped whenever an attempt
  // is superseded (forceNew re-entry or an explicit cancel) so the stale
  // attempt's settlement can't clobber the newer one's state/connectPromise.
  connectGeneration: number;
  state: WalletConnectState;
  connectedAccounts: string[];
  listeners: WalletConnectStateListener[];
  attachedProviders: WeakSet<UniversalProvider>;
  staleSessionCleanup: StaleSessionCleanupDescriptor | null;
};

type StaleSessionCleanupDescriptor = {
  provider: UniversalProvider;
  session: unknown;
  topic: string | null;
  inflight: Promise<void> | null;
};

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
}

type WalletConnectGlobal = typeof globalThis & {
  __KNOWW_WALLETCONNECT_BRIDGE_STATE__?: WalletConnectBridgeSharedState;
};

function getSharedState(): WalletConnectBridgeSharedState {
  const globalState = globalThis as WalletConnectGlobal;
  if (!globalState.__KNOWW_WALLETCONNECT_BRIDGE_STATE__) {
    globalState.__KNOWW_WALLETCONNECT_BRIDGE_STATE__ = {
      providerPromise: null,
      connectPromise: null,
      connectGeneration: 0,
      state: {
        status: "idle",
        qrUri: null,
        error: null,
      },
      connectedAccounts: [],
      listeners: [],
      attachedProviders: new WeakSet<UniversalProvider>(),
      staleSessionCleanup: null,
    };
  }
  return globalState.__KNOWW_WALLETCONNECT_BRIDGE_STATE__;
}

function getProjectId(): string {
  return process.env.WALLETCONNECT_PROJECT_ID || "";
}

function getWalletConnectMetadataUrl(): string {
  try {
    const origin = window.location.origin;
    if (origin.startsWith("https://") || origin.startsWith("http://")) {
      return origin;
    }
  } catch {
    /* fall through to the canonical product URL */
  }
  return "https://knoww.app";
}

function emit(next: Partial<WalletConnectState>): void {
  const shared = getSharedState();
  shared.state = { ...shared.state, ...next };
  for (const listener of shared.listeners) {
    try {
      listener(shared.state);
    } catch {
      /* ignore listener failures */
    }
  }
}

function normalizeAccounts(accounts: unknown): string[] {
  if (!Array.isArray(accounts)) return [];
  return accounts
    .map((account) => String(account))
    .map((account) => {
      const parts = account.split(":");
      return parts.length === 3 ? parts[2] : account;
    })
    .filter((account) => /^0x[a-fA-F0-9]{40}$/.test(account));
}

function buildNamespace(methods: string[]) {
  return {
    chains: [POLYGON_CAIP_CHAIN_ID],
    methods,
    events: WALLETCONNECT_EVENTS,
    rpcMap: {
      "137": POLYGON_RPC_URL,
      [POLYGON_CAIP_CHAIN_ID]: POLYGON_RPC_URL,
    },
  };
}

function syncAccountsFromSession(provider: UniversalProvider): string[] {
  const shared = getSharedState();
  const namespace = provider.session?.namespaces.eip155;
  const accounts = normalizeAccounts(namespace?.accounts ?? []);
  shared.connectedAccounts = accounts;
  emit({
    status: accounts.length > 0 ? "connected" : "idle",
    qrUri: null,
    error: null,
  });
  return accounts;
}

const initializedProviders = new WeakSet<Promise<UniversalProvider>>();

async function getProvider(): Promise<UniversalProvider> {
  const shared = getSharedState();
  if (shared.providerPromise) return shared.providerPromise;

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error(
      "WalletConnect is not configured. Set WALLETCONNECT_PROJECT_ID for the extension build."
    );
  }

  emit({ status: "initializing", qrUri: null, error: null });
  const storage = new ChromeWalletConnectStorage();
  shared.providerStorage = storage;
  const providerPromise = UniversalProvider.init({
    projectId,
    metadata: {
      name: "Knoww",
      description: "A prediction market layer for the open internet.",
      url: getWalletConnectMetadataUrl(),
      icons: ["https://knoww.app/logo-256x256.png"],
    },
    storage,
    customStoragePrefix: "knoww",
    disableProviderPing: true,
  })
    .then((provider) => {
      initializedProviders.add(providerPromise);
      if (!shared.attachedProviders.has(provider)) {
        shared.attachedProviders.add(provider);
        provider.on("display_uri", (uri: string) => {
          if (shared.providerPromise !== providerPromise) return;
          emit({ status: "pairing", qrUri: uri, error: null });
        });
        provider.on("accountsChanged", (accounts: unknown) => {
          if (
            shared.providerPromise !== providerPromise ||
            shared.connectPromise
          )
            return;
          shared.connectedAccounts = normalizeAccounts(accounts);
          emit({
            status: shared.connectedAccounts.length > 0 ? "connected" : "idle",
            qrUri: null,
            error: null,
          });
        });
        provider.on("session_update", () => {
          if (
            shared.providerPromise !== providerPromise ||
            shared.connectPromise
          )
            return;
          syncAccountsFromSession(provider);
        });
        provider.on("disconnect", () => {
          if (shared.providerPromise !== providerPromise) return;
          shared.connectedAccounts = [];
          emit({ status: "idle", qrUri: null, error: null });
        });
      }
      return provider;
    })
    .catch((error) => {
      if (shared.providerPromise === providerPromise)
        shared.providerPromise = null;
      throw error;
    });

  shared.providerPromise = providerPromise;
  return providerPromise;
}

async function getSessionAccounts(publish = true): Promise<string[]> {
  const shared = getSharedState();
  const generation = shared.connectGeneration;
  if (publish && shared.connectPromise) return [];
  const provider = await getProvider();
  if (generation !== shared.connectGeneration || (publish && shared.connectPromise)) return [];
  if (!provider.session) return [];
  const accounts = normalizeAccounts(
    provider.session.namespaces.eip155?.accounts ?? []
  );
  if (publish) {
    shared.connectedAccounts = accounts;
    emit({
      status: accounts.length > 0 ? "connected" : "idle",
      qrUri: null,
      error: null,
    });
  }
  return accounts;
}

async function request<T = unknown>(
  method: string,
  params?: unknown[]
): Promise<T> {
  const provider = await getProvider();
  return provider.request<T>({ method, params }, POLYGON_CAIP_CHAIN_ID);
}

async function polygonRpcRequest<T>(
  method: string,
  params?: unknown[]
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, READ_ONLY_RPC_TIMEOUT_MS);

  try {
    const response = await fetch(POLYGON_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Polygon RPC ${method} failed: ${response.status}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new Error(
        payload.error.message || `Polygon RPC ${method} returned an error`
      );
    }
    if (!("result" in payload)) {
      throw new Error(`Polygon RPC ${method} returned no result`);
    }

    return payload.result as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Polygon RPC ${method} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function disconnectExistingSession(provider: UniversalProvider, generation: number) {
  try {
    if (provider.session) {
      await provider.disconnect();
    }
  } catch (error) {
    log.warn("disconnect_existing.failed", { error });
  }
  if (getSharedState().connectGeneration !== generation) return;
  getSharedState().connectedAccounts = [];
  emit({ status: "idle", qrUri: null, error: null });
}

async function purgeWalletConnectStorage(generation: number): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    if (getSharedState().connectGeneration !== generation) return;
    const keys = Object.keys(all).filter((key) =>
      key.startsWith(STORAGE_PREFIX)
    );
    if (keys.length > 0) {
      await chrome.storage.local.remove(keys);
    }
  } catch (error) {
    log.warn("storage.purge_failed", { error });
  }
}

// Tear down an in-flight pairing attempt (one waiting on the QR scan). Bumping
// the generation first invalidates the pending attempt so its rejection can't
// emit an error or null out a newer attempt's connectPromise; then we abort the
// WalletConnect pairing so the relay subscription/URI is released promptly
// instead of lingering until the ~3-min pairing TTL.
async function abortPendingConnect(): Promise<void> {
  const shared = getSharedState();
  const pendingConnect = shared.connectPromise;
  const pendingProvider = shared.providerPromise;
  shared.connectGeneration++;
  if (pendingConnect) {
    shared.connectPromise = null;
    shared.providerPromise = null;
    shared.providerStorage?.retire();
    // Retire synchronously so a racing retry cannot receive old storage writes.
    // Persisted pairing records can remain until SDK expiry; do not purge shared
    // keys here because the replacement Core may already be using them.
    shared.connectedAccounts = [];
    // A late approval is handled by the old attempt's generation check. Its
    // provider and storage must not publish into the replacement attempt.
    void pendingConnect.catch(() => {});
  }
  let cleanupFailure: unknown;
  try {
    await retryRetainedStaleSessionCleanup();
  } catch (error) {
    cleanupFailure = error;
  }
  if (pendingProvider) {
    if (pendingConnect && !initializedProviders.has(pendingProvider)) {
      // An SDK initialization cannot be cancelled. Let it finish off the retry
      // path; the generation check prevents it from starting a pairing.
      void Promise.allSettled([pendingConnect]).then(async () => {
        try {
          await closeRetiredProvider(await pendingProvider);
        } catch (error) {
          log.warn("connect.retired_initialization_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      if (cleanupFailure) throw cleanupFailure;
      return;
    }
    try {
      const provider = await pendingProvider;
      await provider.abortPairingAttempt();
      await provider.cleanupPendingPairings();
    } catch (error) {
      cleanupFailure = error;
      log.warn("connect.abort_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (pendingConnect) {
      void Promise.allSettled([pendingConnect]).then(async () => {
        try {
          const provider = await pendingProvider;
          if (shared.staleSessionCleanup?.provider !== provider) {
            await closeRetiredProvider(provider);
          }
        } catch (error) {
          log.warn("connect.retired_provider_close_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
  }

  if (cleanupFailure) throw cleanupFailure;
}

const closedRetiredProviders = new WeakSet<UniversalProvider>();

async function closeRetiredProvider(provider: UniversalProvider): Promise<void> {
  if (closedRetiredProviders.has(provider)) return;
  closedRetiredProviders.add(provider);
  try {
    await provider.client.core.relayer.transportClose();
  } catch (error) {
    log.warn("connect.retired_transport_close_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    provider.client.core.heartbeat.stop();
  }
}

function assertCurrentConnectGeneration(
  shared: WalletConnectBridgeSharedState,
  generation: number
): void {
  if (shared.connectGeneration !== generation) {
    throw new Error("WalletConnect connection attempt was superseded.");
  }
}

class StaleSessionCleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleSessionCleanupError";
  }
}

async function retryRetainedStaleSessionCleanup(): Promise<void> {
  const shared = getSharedState();
  const descriptor = shared.staleSessionCleanup;
  if (!descriptor) return;
  if (descriptor.inflight) return descriptor.inflight;

  if (!descriptor.topic) {
    log.warn("connect.stale_session_topic_missing", {});
    throw new StaleSessionCleanupError(
      "Superseded WalletConnect session has no cleanup topic."
    );
  }

  const cleanup = descriptor.provider.client
    .disconnect({
      topic: descriptor.topic,
      reason: { code: 6000, message: "User disconnected" },
    })
    .then(async () => {
      if (shared.staleSessionCleanup === descriptor) {
        shared.staleSessionCleanup = null;
      }
      await closeRetiredProvider(descriptor.provider);
    })
    .catch((error: unknown) => {
      log.warn("connect.stale_session_cleanup_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StaleSessionCleanupError(
        "Superseded WalletConnect session cleanup failed."
      );
    })
    .finally(() => {
      if (shared.staleSessionCleanup === descriptor) {
        descriptor.inflight = null;
      }
    });
  descriptor.inflight = cleanup;
  return cleanup;
}

async function cleanupSupersededSession(
  provider: UniversalProvider,
  session: unknown,
  generation: number
): Promise<void> {
  const shared = getSharedState();
  if (shared.connectGeneration === generation) {
    return;
  }
  const topic =
    session &&
    typeof session === "object" &&
    typeof (session as { topic?: unknown }).topic === "string"
      ? (session as { topic: string }).topic
      : null;
  shared.staleSessionCleanup = {
    provider,
    session,
    topic,
    inflight: null,
  };
  await retryRetainedStaleSessionCleanup();
}

export const WalletConnectBridge = {
  onStateChange(listener: WalletConnectStateListener): () => void {
    const shared = getSharedState();
    shared.listeners.push(listener);
    return () => {
      const index = shared.listeners.indexOf(listener);
      if (index >= 0) shared.listeners.splice(index, 1);
    };
  },

  getState(): WalletConnectState {
    return getSharedState().state;
  },

  async connect(options: { forceNew?: boolean } = {}): Promise<string[]> {
    const shared = getSharedState();
    const forceNew = options.forceNew === true;
    await retryRetainedStaleSessionCleanup();

    if (shared.connectPromise) {
      // A non-forced caller (silent reconnect) joins the in-flight attempt.
      if (!forceNew) return shared.connectPromise;
      // An explicit connect while a previous attempt is still pending (e.g. the
      // user cancelled the QR and tapped connect again). Abort the stale
      // attempt so we generate a fresh pairing URI instead of handing back the
      // old in-flight promise — otherwise the QR can be stale or never appear.
      await abortPendingConnect();
    }

    const generation = ++shared.connectGeneration;
    const attempt = (async () => {
      try {
        if (forceNew) {
          const provider = await getProvider();
          assertCurrentConnectGeneration(shared, generation);
          await disconnectExistingSession(provider, generation);
          assertCurrentConnectGeneration(shared, generation);
          if (provider.session) {
            // provider.disconnect() failed and left the session attached —
            // typical after logout, when the persisted session's mobile peer
            // is gone and the relay rejects the teardown. Reusing that dead
            // session would short-circuit pairing below and no QR would ever
            // appear, so drop the provider and its persisted state entirely
            // and let a fresh, sessionless provider initialize.
            shared.providerPromise = null;
            shared.connectedAccounts = [];
            await purgeWalletConnectStorage(generation);
            assertCurrentConnectGeneration(shared, generation);
          }
        }

        // A forced connect must always run a fresh pairing so the QR is
        // guaranteed; only silent reconnects may reuse an existing session.
        const existing = forceNew ? [] : await getSessionAccounts(false);
        assertCurrentConnectGeneration(shared, generation);
        if (existing.length > 0) {
          shared.connectedAccounts = existing;
          emit({ status: "connected", qrUri: null, error: null });
          return existing;
        }

        emit({ status: "pairing", qrUri: null, error: null });
        const provider = await getProvider();
        assertCurrentConnectGeneration(shared, generation);
        const session = await provider.connect({
          namespaces: {
            eip155: buildNamespace(WALLETCONNECT_REQUIRED_METHODS),
          },
          optionalNamespaces: {
            eip155: buildNamespace(WALLETCONNECT_OPTIONAL_METHODS),
          },
        });
        if (shared.connectGeneration !== generation) {
          await cleanupSupersededSession(provider, session, generation);
          assertCurrentConnectGeneration(shared, generation);
        }
        const accounts = normalizeAccounts(
          session?.namespaces.eip155?.accounts ?? []
        );
        if (accounts.length === 0) {
          throw new Error("No accounts returned");
        }
        shared.connectedAccounts = accounts;
        emit({ status: "connected", qrUri: null, error: null });
        return accounts;
      } catch (error) {
        // A superseded attempt (aborted by a newer connect/cancel) must not
        // surface its rejection as the visible error state.
        if (shared.connectGeneration === generation) {
          const message =
            error instanceof Error ? error.message : String(error);
          log.warn("connect.failed", { error: message });
          emit({ status: "error", qrUri: null, error: message });
        }
        throw error;
      } finally {
        if (shared.connectGeneration === generation) {
          shared.connectPromise = null;
        }
      }
    })();

    shared.connectPromise = attempt;
    return attempt;
  },

  // Abort an in-flight pairing without tearing down an established session.
  // Used when the user dismisses the QR so the pending attempt and its relay
  // subscription are released immediately instead of lingering.
  async cancel(): Promise<void> {
    const generation = getSharedState().connectGeneration + 1;
    await abortPendingConnect();
    if (getSharedState().connectGeneration === generation)
      emit({ status: "idle", qrUri: null, error: null });
  },

  async getAccounts(): Promise<string[]> {
    const shared = getSharedState();
    if (shared.connectedAccounts.length > 0) return shared.connectedAccounts;
    try {
      return await getSessionAccounts();
    } catch {
      return [];
    }
  },

  async getChainId(): Promise<string> {
    return POLYGON_CHAIN_ID_HEX;
  },

  async switchChain(chainIdHex: string): Promise<void> {
    if (chainIdHex.toLowerCase() === POLYGON_CHAIN_ID_HEX) return;
    await request("wallet_switchEthereumChain", [{ chainId: chainIdHex }]);
  },

  async signTypedData(address: string, typedData: string): Promise<string> {
    return request<string>("eth_signTypedData_v4", [address, typedData]);
  },

  async signMessage(address: string, message: string): Promise<string> {
    return request<string>("personal_sign", [message, address]);
  },

  async sendTransaction(txParams: Record<string, unknown>): Promise<string> {
    return request<string>("eth_sendTransaction", [txParams]);
  },

  async ethCall(to: string, data: string): Promise<string> {
    return polygonRpcRequest<string>("eth_call", [{ to, data }, "latest"]);
  },

  async getBalance(address: string): Promise<string> {
    return polygonRpcRequest<string>("eth_getBalance", [address, "latest"]);
  },

  async getTransactionReceipt(
    txHash: string
  ): Promise<{ status: string; blockNumber: string } | null> {
    return polygonRpcRequest<{ status: string; blockNumber: string } | null>(
      "eth_getTransactionReceipt",
      [txHash]
    );
  },

  async disconnect(): Promise<void> {
    const shared = getSharedState();
    const provider = await getProvider();
    if (provider.session) {
      await provider.disconnect();
    }
    shared.connectedAccounts = [];
    emit({ status: "idle", qrUri: null, error: null });
  },
};
