import { createLogger } from "@knoww/logger";
import UniversalProvider from "@walletconnect/universal-provider";

const log = createLogger("walletconnect-bridge");

const POLYGON_CAIP_CHAIN_ID = "eip155:137";
const POLYGON_CHAIN_ID_HEX = "0x89";
const POLYGON_RPC_URL = "https://polygon-bor-rpc.publicnode.com";
const STORAGE_PREFIX = "knoww_walletconnect_";

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
    await chrome.storage.local.set({ [this.key(key)]: value });
  }

  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(this.key(key));
  }
}

type WalletConnectBridgeSharedState = {
  providerPromise: Promise<UniversalProvider> | null;
  connectPromise: Promise<string[]> | null;
  state: WalletConnectState;
  connectedAccounts: string[];
  listeners: WalletConnectStateListener[];
  attachedProviders: WeakSet<UniversalProvider>;
};

type WalletConnectGlobal = typeof globalThis & {
  __KNOWW_WALLETCONNECT_BRIDGE_STATE__?: WalletConnectBridgeSharedState;
};

function getSharedState(): WalletConnectBridgeSharedState {
  const globalState = globalThis as WalletConnectGlobal;
  if (!globalState.__KNOWW_WALLETCONNECT_BRIDGE_STATE__) {
    globalState.__KNOWW_WALLETCONNECT_BRIDGE_STATE__ = {
      providerPromise: null,
      connectPromise: null,
      state: {
        status: "idle",
        qrUri: null,
        error: null,
      },
      connectedAccounts: [],
      listeners: [],
      attachedProviders: new WeakSet<UniversalProvider>(),
    };
  }
  return globalState.__KNOWW_WALLETCONNECT_BRIDGE_STATE__;
}

const shared = getSharedState();

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

async function getProvider(): Promise<UniversalProvider> {
  if (shared.providerPromise) return shared.providerPromise;

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error(
      "WalletConnect is not configured. Set WALLETCONNECT_PROJECT_ID for the extension build."
    );
  }

  emit({ status: "initializing", qrUri: null, error: null });
  shared.providerPromise = UniversalProvider.init({
    projectId,
    metadata: {
      name: "Knoww",
      description: "A prediction market layer for the open internet.",
      url: getWalletConnectMetadataUrl(),
      icons: ["https://knoww.app/logo-256x256.png"],
    },
    storage: new ChromeWalletConnectStorage(),
    customStoragePrefix: "knoww",
    disableProviderPing: true,
  })
    .then((provider) => {
      if (!shared.attachedProviders.has(provider)) {
        shared.attachedProviders.add(provider);
        provider.on("display_uri", (uri: string) => {
          emit({ status: "pairing", qrUri: uri, error: null });
        });
        provider.on("accountsChanged", (accounts: unknown) => {
          shared.connectedAccounts = normalizeAccounts(accounts);
          emit({
            status: shared.connectedAccounts.length > 0 ? "connected" : "idle",
            qrUri: null,
            error: null,
          });
        });
        provider.on("session_update", () => {
          syncAccountsFromSession(provider);
        });
        provider.on("disconnect", () => {
          shared.connectedAccounts = [];
          emit({ status: "idle", qrUri: null, error: null });
        });
      }
      return provider;
    })
    .catch((error) => {
      shared.providerPromise = null;
      throw error;
    });

  return shared.providerPromise;
}

async function getSessionAccounts(): Promise<string[]> {
  const provider = await getProvider();
  if (!provider.session) return [];
  return syncAccountsFromSession(provider);
}

async function request<T = unknown>(
  method: string,
  params?: unknown[]
): Promise<T> {
  const provider = await getProvider();
  return provider.request<T>({ method, params }, POLYGON_CAIP_CHAIN_ID);
}

async function disconnectExistingSession(provider: UniversalProvider) {
  try {
    if (provider.session) {
      await provider.disconnect();
    }
  } catch (error) {
    log.warn("disconnect_existing.failed", { error });
  }
  shared.connectedAccounts = [];
  emit({ status: "idle", qrUri: null, error: null });
}

export const WalletConnectBridge = {
  onStateChange(listener: WalletConnectStateListener): () => void {
    shared.listeners.push(listener);
    return () => {
      const index = shared.listeners.indexOf(listener);
      if (index >= 0) shared.listeners.splice(index, 1);
    };
  },

  getState(): WalletConnectState {
    return shared.state;
  },

  async connect(options: { forceNew?: boolean } = {}): Promise<string[]> {
    if (shared.connectPromise) return shared.connectPromise;

    shared.connectPromise = (async () => {
      try {
        const forceNew = options.forceNew === true;
        if (forceNew) {
          await disconnectExistingSession(await getProvider());
        }

        const existing = await getSessionAccounts();
        if (existing.length > 0) return existing;

        emit({ status: "pairing", qrUri: null, error: null });
        const provider = await getProvider();
        const session = await provider.connect({
          namespaces: {
            eip155: buildNamespace(WALLETCONNECT_REQUIRED_METHODS),
          },
          optionalNamespaces: {
            eip155: buildNamespace(WALLETCONNECT_OPTIONAL_METHODS),
          },
        });
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
        const message = error instanceof Error ? error.message : String(error);
        log.warn("connect.failed", { error: message });
        emit({ status: "error", qrUri: null, error: message });
        throw error;
      } finally {
        shared.connectPromise = null;
      }
    })();

    return shared.connectPromise;
  },

  async getAccounts(): Promise<string[]> {
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
    return request<string>("eth_call", [{ to, data }, "latest"]);
  },

  async getBalance(address: string): Promise<string> {
    return request<string>("eth_getBalance", [address, "latest"]);
  },

  async getTransactionReceipt(
    txHash: string
  ): Promise<{ status: string; blockNumber: string } | null> {
    return request<{ status: string; blockNumber: string } | null>(
      "eth_getTransactionReceipt",
      [txHash]
    );
  },

  async disconnect(): Promise<void> {
    const provider = await getProvider();
    if (provider.session) {
      await provider.disconnect();
    }
    shared.connectedAccounts = [];
    emit({ status: "idle", qrUri: null, error: null });
  },
};
