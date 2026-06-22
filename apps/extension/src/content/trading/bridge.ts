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
  timeoutId?: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingRequest>();
const USER_MEDIATED_WALLET_METHODS = new Set([
  "eth_requestAccounts",
  "eth_signTypedData_v4",
  "personal_sign",
  "eth_sendTransaction",
  "wallet_switchEthereumChain",
]);
const DEFAULT_WALLET_REQUEST_TIMEOUT_MS = 120_000;
// Wallet prompts can survive laptop sleep; keep this much longer than normal
// RPC timeouts, but finite so lost page-bridge responses cannot leak forever.
const USER_MEDIATED_WALLET_REQUEST_TIMEOUT_MS = 24 * 60 * 60 * 1000;

let initialized = false;
let wallets: DiscoveredWallet[] = [];
let walletListeners: Array<(w: DiscoveredWallet[]) => void> = [];
let selectedWalletUuid: string | undefined;

function isWalletConnectSelected(walletUuid?: string): boolean {
  return (walletUuid ?? selectedWalletUuid) === WALLETCONNECT_WALLET_UUID;
}

function getWalletErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      shortMessage?: unknown;
    };
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.shortMessage === "string"
          ? candidate.shortMessage
          : "";
    const code =
      typeof candidate.code === "string" || typeof candidate.code === "number"
        ? String(candidate.code)
        : "";
    return [message, code].filter(Boolean).join(" ");
  }
  return "";
}

function formatWalletSigningError(error: unknown): string {
  const message = getWalletErrorMessage(error);
  if (
    /user rejected|request rejected|rejected the request|denied|4001/i.test(
      message
    )
  ) {
    return "Transaction rejected.";
  }
  return message || "Wallet request failed.";
}

export function getNonce(): string | undefined {
  return window.__KNOWW_BRIDGE_NONCE__;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function requestWalletDiscovery(): void {
  window.postMessage(
    { type: "KNOWW_LIST_WALLETS", _n: getNonce() },
    window.location.origin
  );
}

function getWalletRequestTimeoutMs(method: string): number {
  return USER_MEDIATED_WALLET_METHODS.has(method)
    ? USER_MEDIATED_WALLET_REQUEST_TIMEOUT_MS
    : DEFAULT_WALLET_REQUEST_TIMEOUT_MS;
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
      if (p.timeoutId) clearTimeout(p.timeoutId);
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
          error: formatWalletSigningError(err),
        });
      });

    sendResponse({ ok: true });
    return false;
  });

  requestWalletDiscovery();
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
    const pendingRequest: PendingRequest = { resolve, reject };
    pending.set(id, pendingRequest);

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

    pendingRequest.timeoutId = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Wallet request timed out: ${method}`));
      }
    }, getWalletRequestTimeoutMs(method));
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
      return WalletConnectBridge.connect({ forceNew: true });
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

  async cancelMobileConnect(): Promise<void> {
    await WalletConnectBridge.cancel();
  },

  async disconnect(): Promise<void> {
    const wasWalletConnectSelected = isWalletConnectSelected();
    selectedWalletUuid = undefined;
    if (wasWalletConnectSelected) {
      await WalletConnectBridge.disconnect();
    }
    init();
    requestWalletDiscovery();
  },

  resetAfterDisconnect(): void {
    const wasWalletConnectSelected = isWalletConnectSelected();
    selectedWalletUuid = undefined;
    if (wasWalletConnectSelected) {
      void WalletConnectBridge.disconnect().catch(() => {
        /* best-effort cleanup after a global logout */
      });
    }
    init();
    requestWalletDiscovery();
  },
};
