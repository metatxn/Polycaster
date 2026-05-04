/**
 * WalletBridge — content script side of the page bridge communication.
 *
 * Sends KNOWW_BRIDGE_REQUEST messages to the page-bridge.ts (main world)
 * via window.postMessage and correlates responses via unique IDs.
 *
 * Wallet discovery uses EIP-6963: the page-bridge announces installed
 * wallets and this module exposes them so the trading panel can render
 * a picker UI.
 *
 * Also handles signing delegation from the background service worker:
 * background → chrome.tabs.sendMessage → here → page bridge → wallet → back.
 *
 * Security: every message carries a per-injection nonce (_n) that both
 * sides validate. Messages without a matching nonce are silently dropped.
 */

import {
  WalletConnectBridge,
  type WalletConnectState,
} from "./walletconnect-bridge";

export const WALLETCONNECT_WALLET_UUID = "__knoww_walletconnect_mobile__";

export interface DiscoveredWallet {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface BridgeResponse {
  type: "KNOWW_BRIDGE_RESPONSE";
  id: string;
  result?: unknown;
  error?: string;
  code?: number;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

const pending = new Map<string, PendingRequest>();

let initialized = false;
let wallets: DiscoveredWallet[] = [];
let walletListeners: Array<(w: DiscoveredWallet[]) => void> = [];
let selectedWalletUuid: string | undefined;

function isWalletConnectSelected(walletUuid?: string): boolean {
  return (walletUuid ?? selectedWalletUuid) === WALLETCONNECT_WALLET_UUID;
}

export function getNonce(): string | undefined {
  return window.__KNOWW_BRIDGE_NONCE__;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function init(): void {
  if (initialized) return;
  initialized = true;

  const nonce = getNonce();

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as
      | (BridgeResponse & { _n?: string })
      | {
          type: "KNOWW_WALLETS_DISCOVERED";
          wallets: DiscoveredWallet[];
          _n?: string;
        }
      | undefined;
    if (!data?.type) return;

    if (nonce && data._n !== nonce) return;

    if (data.type === "KNOWW_BRIDGE_RESPONSE") {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.error) {
        p.reject(new Error(data.error));
      } else {
        p.resolve(data.result);
      }
      return;
    }

    if (data.type === "KNOWW_WALLETS_DISCOVERED") {
      wallets = data.wallets;
      for (const fn of walletListeners) {
        try {
          fn(wallets);
        } catch {
          /* ignore */
        }
      }
    }
  });

  // Listen for signing requests from background (bridge wallet delegation)
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "trading:signing-request") return false;

    const { id, method, params } = message;

    request(method, params)
      .then((result) => {
        chrome.runtime.sendMessage({
          type: "trading:signing-response",
          id,
          result,
        });
      })
      .catch((err) => {
        chrome.runtime.sendMessage({
          type: "trading:signing-response",
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    sendResponse({ ok: true });
    return false;
  });

  window.postMessage(
    { type: "KNOWW_LIST_WALLETS", _n: nonce },
    window.location.origin
  );
}

function request(
  method: string,
  params?: unknown[],
  walletUuid?: string
): Promise<unknown> {
  if (isWalletConnectSelected(walletUuid)) {
    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return WalletConnectBridge.getAccounts();
      case "eth_chainId":
        return WalletConnectBridge.getChainId();
      case "wallet_switchEthereumChain": {
        const chainId = (params?.[0] as { chainId?: string } | undefined)
          ?.chainId;
        return WalletConnectBridge.switchChain(chainId ?? "0x89");
      }
      case "eth_signTypedData_v4":
        return WalletConnectBridge.signTypedData(
          String(params?.[0] ?? ""),
          String(params?.[1] ?? "")
        );
      case "personal_sign":
        return WalletConnectBridge.signMessage(
          String(params?.[1] ?? ""),
          String(params?.[0] ?? "")
        );
      case "eth_sendTransaction":
        return WalletConnectBridge.sendTransaction(
          (params?.[0] as Record<string, unknown> | undefined) ?? {}
        );
      case "eth_call": {
        const call = params?.[0] as { to?: string; data?: string } | undefined;
        return WalletConnectBridge.ethCall(call?.to ?? "", call?.data ?? "0x");
      }
      case "eth_getBalance":
        return WalletConnectBridge.getBalance(String(params?.[0] ?? ""));
      case "eth_getTransactionReceipt":
        return WalletConnectBridge.getTransactionReceipt(
          String(params?.[0] ?? "")
        );
      default:
        return Promise.reject(new Error(`Method not allowed: ${method}`));
    }
  }

  init();
  const nonce = getNonce();
  const uuid = walletUuid ?? selectedWalletUuid;
  return new Promise((resolve, reject) => {
    const id = generateId();
    pending.set(id, { resolve, reject });

    window.postMessage(
      {
        type: "KNOWW_BRIDGE_REQUEST",
        id,
        method,
        params,
        walletUuid: uuid,
        _n: nonce,
      },
      window.location.origin
    );

    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Wallet request timed out: ${method}`));
      }
    }, 120_000);
  });
}

export const WalletBridge = {
  init,

  getDiscoveredWallets(): DiscoveredWallet[] {
    init();
    return wallets;
  },

  onWalletsChanged(fn: (w: DiscoveredWallet[]) => void): () => void {
    walletListeners.push(fn);
    return () => {
      walletListeners = walletListeners.filter((l) => l !== fn);
    };
  },

  selectWallet(uuid: string): void {
    selectedWalletUuid = uuid;
    if (uuid === WALLETCONNECT_WALLET_UUID) return;
    window.postMessage(
      { type: "KNOWW_SELECT_WALLET", uuid, _n: getNonce() },
      window.location.origin
    );
  },

  async connect(walletUuid?: string): Promise<string[]> {
    if (walletUuid === WALLETCONNECT_WALLET_UUID) {
      selectedWalletUuid = WALLETCONNECT_WALLET_UUID;
      return WalletConnectBridge.connect();
    }
    if (walletUuid) {
      this.selectWallet(walletUuid);
    }
    const accounts = (await request(
      "eth_requestAccounts",
      undefined,
      walletUuid
    )) as string[];
    if (accounts?.length > 0 && walletUuid) {
      selectedWalletUuid = walletUuid;
    }
    return accounts;
  },

  async getAccounts(): Promise<string[]> {
    if (isWalletConnectSelected()) {
      return WalletConnectBridge.getAccounts();
    }
    let accounts: string[] = [];
    try {
      accounts = (await request("eth_accounts")) as string[];
    } catch {
      accounts = [];
    }
    if (accounts?.length > 0) return accounts;
    const mobileAccounts = await WalletConnectBridge.getAccounts();
    if (mobileAccounts.length > 0) {
      selectedWalletUuid = WALLETCONNECT_WALLET_UUID;
    }
    return mobileAccounts;
  },

  async getChainId(): Promise<string> {
    return (await request("eth_chainId")) as string;
  },

  async switchChain(chainIdHex: string): Promise<void> {
    await request("wallet_switchEthereumChain", [{ chainId: chainIdHex }]);
  },

  async signTypedData(address: string, typedData: string): Promise<string> {
    return (await request("eth_signTypedData_v4", [
      address,
      typedData,
    ])) as string;
  },

  async signMessage(address: string, message: string): Promise<string> {
    return (await request("personal_sign", [message, address])) as string;
  },

  async sendTransaction(txParams: Record<string, unknown>): Promise<string> {
    return (await request("eth_sendTransaction", [txParams])) as string;
  },

  async ethCall(to: string, data: string): Promise<string> {
    return (await request("eth_call", [{ to, data }, "latest"])) as string;
  },

  async getBalance(address: string): Promise<string> {
    return (await request("eth_getBalance", [address, "latest"])) as string;
  },

  async getTransactionReceipt(
    txHash: string
  ): Promise<{ status: string; blockNumber: string } | null> {
    return (await request("eth_getTransactionReceipt", [txHash])) as {
      status: string;
      blockNumber: string;
    } | null;
  },

  onMobileConnectionChange(
    listener: (state: WalletConnectState) => void
  ): () => void {
    return WalletConnectBridge.onStateChange(listener);
  },

  getMobileConnectionState(): WalletConnectState {
    return WalletConnectBridge.getState();
  },

  async disconnect(): Promise<void> {
    if (!isWalletConnectSelected()) return;
    await WalletConnectBridge.disconnect();
    selectedWalletUuid = undefined;
  },
};
