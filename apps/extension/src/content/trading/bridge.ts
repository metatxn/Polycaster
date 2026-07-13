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
  isEip1193UnsupportedMethodError,
  isEip1193UserRejectedError,
} from "@knoww/shared-types/trading-errors";
import { WALLETCONNECT_WALLET_UUID } from "../walletconnect-constants";
import {
  WalletConnectBridge,
  type WalletConnectState,
} from "./walletconnect-bridge";

export { WALLETCONNECT_WALLET_UUID } from "../walletconnect-constants";

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
  "wallet_requestPermissions",
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
let windowMessageListener: ((event: MessageEvent) => void) | null = null;
let activeNonce: string | undefined;
let signingLifecycleInstalled = false;
let signingListenerInstalled = false;
let signingGeneration = 0;
let wallets: DiscoveredWallet[] = [];
let walletListeners: Array<(w: DiscoveredWallet[]) => void> = [];
let accountListeners: Array<(accounts: string[]) => void> = [];
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
  if (isEip1193UserRejectedError(error)) {
    return "Transaction rejected.";
  }
  const message = getWalletErrorMessage(error);
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

function handleWindowMessage(event: MessageEvent): void {
  if (event.source !== window) return;
  const data = event.data as
    | (BridgeResponse & { _n?: string })
    | {
        type: "KNOWW_WALLETS_DISCOVERED";
        wallets: DiscoveredWallet[];
        _n?: string;
      }
    | {
        type: "KNOWW_WALLET_ACCOUNTS_CHANGED";
        walletUuid?: string;
        active?: boolean;
        accounts?: unknown;
        _n?: string;
      }
    | undefined;
  if (!data?.type) return;

  const expectedNonce = activeNonce ?? getNonce();
  if (!expectedNonce || data._n !== expectedNonce) return;
  activeNonce ??= expectedNonce;

  if (data.type === "KNOWW_BRIDGE_RESPONSE") {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (p.timeoutId) clearTimeout(p.timeoutId);
    if (data.error) {
      const err = new Error(data.error) as Error & { code?: number };
      if (typeof data.code === "number") err.code = data.code;
      p.reject(err);
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

  if (data.type === "KNOWW_WALLET_ACCOUNTS_CHANGED") {
    if (
      selectedWalletUuid &&
      data.walletUuid &&
      data.walletUuid !== selectedWalletUuid
    ) {
      return;
    }
    if (!selectedWalletUuid && data.walletUuid && data.active === false) {
      return;
    }
    const accounts = Array.isArray(data.accounts)
      ? data.accounts.filter(
          (account): account is string => typeof account === "string"
        )
      : [];
    for (const fn of accountListeners) {
      try {
        fn(accounts);
      } catch {
        /* ignore */
      }
    }
  }
}

function disposeBridge(): void {
  if (!initialized) return;
  initialized = false;
  activeNonce = undefined;
  if (windowMessageListener) {
    window.removeEventListener("message", windowMessageListener);
    windowMessageListener = null;
  }
  for (const [id, pendingRequest] of pending) {
    if (pendingRequest.timeoutId) clearTimeout(pendingRequest.timeoutId);
    pendingRequest.reject(new Error(`Wallet bridge disposed: ${id}`));
  }
  pending.clear();
  wallets = [];
  walletListeners = [];
  accountListeners = [];
}

function init(): () => void {
  if (initialized) return disposeBridge;
  initialized = true;
  activeNonce = getNonce() || undefined;
  windowMessageListener = handleWindowMessage;
  window.addEventListener("message", windowMessageListener);
  requestWalletDiscovery();
  return disposeBridge;
}

type SigningResponse = (response: { ok: true }) => void;

interface InflightSigningRequest {
  generation: number;
  id: unknown;
  settled: boolean;
}

const inflightSigningRequests = new Set<InflightSigningRequest>();

function sendSigningCompletion(
  requestToken: InflightSigningRequest,
  completion: { result: unknown } | { error: string }
): void {
  if (
    requestToken.settled ||
    !signingLifecycleInstalled ||
    requestToken.generation !== signingGeneration
  ) {
    return;
  }
  requestToken.settled = true;
  inflightSigningRequests.delete(requestToken);
  void chrome.runtime.sendMessage({
    type: "trading:signing-response",
    id: requestToken.id,
    ...completion,
  });
}

export function delegateSigningRequest(message: unknown): boolean {
  const requestMessage = message as
    | { type?: string; id?: unknown; method?: unknown; params?: unknown }
    | undefined;
  if (requestMessage?.type !== "trading:signing-request") return false;
  if (!signingLifecycleInstalled) {
    throw new Error("Trading signing lifecycle is not installed.");
  }

  const { id, method, params } = requestMessage as {
    id: unknown;
    method: string;
    params?: unknown[];
  };
  const requestToken: InflightSigningRequest = {
    generation: signingGeneration,
    id,
    settled: false,
  };
  inflightSigningRequests.add(requestToken);

  request(method, params)
    .then((result) => {
      sendSigningCompletion(requestToken, { result });
    })
    .catch((err) => {
      sendSigningCompletion(requestToken, {
        error: formatWalletSigningError(err),
      });
    });

  return false;
}

export function handleSigningRequest(
  message: unknown,
  sendResponse: SigningResponse
): boolean {
  const handled =
    (message as { type?: unknown } | null)?.type === "trading:signing-request";
  if (!handled) return false;
  delegateSigningRequest(message);
  sendResponse({ ok: true });
  return false;
}

const signingMessageListener = (
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: SigningResponse
): boolean => handleSigningRequest(message, sendResponse);

function disposeSigningListener(): void {
  if (!signingListenerInstalled) return;
  signingListenerInstalled = false;
  chrome.runtime.onMessage.removeListener(signingMessageListener);
  disposeSigningLifecycle();
}

function disposeSigningLifecycle(): void {
  if (!signingLifecycleInstalled) return;
  signingLifecycleInstalled = false;
  signingGeneration += 1;
  for (const requestToken of inflightSigningRequests) {
    if (requestToken.settled) continue;
    requestToken.settled = true;
    void chrome.runtime.sendMessage({
      type: "trading:signing-response",
      id: requestToken.id,
      error: "Trading runtime disposed.",
    });
  }
  inflightSigningRequests.clear();
}

export function installSigningLifecycle(): () => void {
  if (signingLifecycleInstalled) return disposeSigningLifecycle;
  signingGeneration += 1;
  signingLifecycleInstalled = true;
  return disposeSigningLifecycle;
}

export function installSigningListener(): () => void {
  if (signingListenerInstalled) return disposeSigningListener;
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) {
    return () => {};
  }
  installSigningLifecycle();
  signingListenerInstalled = true;
  chrome.runtime.onMessage.addListener(signingMessageListener);
  return disposeSigningListener;
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

  onAccountsChanged(fn: (accounts: string[]) => void): () => void {
    init();
    accountListeners.push(fn);
    return () => {
      accountListeners = accountListeners.filter((l) => l !== fn);
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

  async switchWallet(walletUuid?: string): Promise<string[]> {
    if (isWalletConnectSelected(walletUuid)) {
      selectedWalletUuid = WALLETCONNECT_WALLET_UUID;
      return WalletConnectBridge.connect({ forceNew: true });
    }
    if (walletUuid) {
      this.selectWallet(walletUuid);
    }

    try {
      await request(
        "wallet_requestPermissions",
        [{ eth_accounts: {} }],
        walletUuid
      );
    } catch (err) {
      if (!isEip1193UnsupportedMethodError(err)) throw err;
    }

    return this.connect(walletUuid);
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

  async getSelectedAccounts(): Promise<string[]> {
    if (isWalletConnectSelected()) {
      return WalletConnectBridge.getAccounts();
    }
    try {
      return ((await request("eth_accounts")) as string[]) ?? [];
    } catch {
      return [];
    }
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
