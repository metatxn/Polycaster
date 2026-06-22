/**
 * Signing State — lightweight module that manages the pending signing
 * request map and the bridge wallet response listener.
 *
 * Extracted from bridge-signer.ts so background.ts can statically import
 * the listener setup without pulling in the trading runtime.
 *
 * The bridge wallet client (in bridge-signer.ts) imports sendSigningRequest
 * from here, sharing the same pendingRequests Map instance.
 */

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  tabId: number;
};

const pendingRequests = new Map<string, PendingRequest>();
const USER_MEDIATED_WALLET_METHODS = new Set([
  "eth_requestAccounts",
  "eth_signTypedData_v4",
  "personal_sign",
  "eth_sendTransaction",
  "wallet_switchEthereumChain",
]);
const DEFAULT_SIGNING_REQUEST_TIMEOUT_MS = 120_000;
// Wallet prompts can survive laptop sleep; keep this much longer than normal
// RPC timeouts, but finite so lost signing responses cannot leak forever.
const USER_MEDIATED_SIGNING_REQUEST_TIMEOUT_MS = 24 * 60 * 60 * 1000;

let currentTabId: number | null = null;
let tabRemovalCleanupRegistered = false;

function getSigningRequestTimeoutMs(method: string): number {
  return USER_MEDIATED_WALLET_METHODS.has(method)
    ? USER_MEDIATED_SIGNING_REQUEST_TIMEOUT_MS
    : DEFAULT_SIGNING_REQUEST_TIMEOUT_MS;
}

function rejectPendingRequest(id: string, error: Error): void {
  const pending = pendingRequests.get(id);
  if (!pending) return;

  pendingRequests.delete(id);
  if (pending.timeoutId) clearTimeout(pending.timeoutId);
  pending.reject(error);
}

export function rejectSigningRequestsForTab(tabId: number, error: Error): void {
  for (const [id, pending] of pendingRequests) {
    if (pending.tabId === tabId) {
      rejectPendingRequest(id, error);
    }
  }
}

function registerTabRemovalCleanup(): void {
  if (tabRemovalCleanupRegistered) return;
  if (typeof chrome.tabs?.onRemoved?.addListener !== "function") return;

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (currentTabId === tabId) currentTabId = null;
    rejectSigningRequestsForTab(tabId, new Error("Signing tab was closed"));
  });
  tabRemovalCleanupRegistered = true;
}

export function initBridgeWallet(): void {
  registerTabRemovalCleanup();

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      const msg = message as {
        type?: string;
        id?: string;
        result?: unknown;
        error?: string;
      };
      if (msg?.type !== "trading:signing-response" || !msg.id) return false;

      const pending = pendingRequests.get(msg.id);
      if (!pending) return false;

      if (msg.error) {
        rejectPendingRequest(msg.id, new Error(msg.error));
      } else {
        pendingRequests.delete(msg.id);
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        pending.resolve(msg.result);
      }

      sendResponse({ ok: true });
      return false;
    }
  );
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function sendSigningRequest(
  tabId: number,
  method: string,
  params: unknown[]
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = generateId();
    const pendingRequest: PendingRequest = { resolve, reject, tabId };
    pendingRequests.set(id, pendingRequest);

    const signingMsg = { type: "trading:signing-request", id, method, params };

    const rejectBridgeError = (message?: string) => {
      rejectPendingRequest(
        id,
        new Error(`Signing bridge error: ${message || "Unknown error"}`)
      );
    };

    const onError = (response?: { ok?: boolean; error?: string }) => {
      if (chrome.runtime.lastError) {
        rejectBridgeError(chrome.runtime.lastError.message);
        return;
      }
      if (response?.ok === false) {
        rejectBridgeError(response.error);
      }
    };

    if (typeof chrome.tabs?.sendMessage === "function") {
      chrome.tabs.sendMessage(tabId, signingMsg, onError);
    } else {
      // Offscreen doc context — relay through the service worker
      chrome.runtime.sendMessage(
        { type: "offscreen:forward-signing", tabId, id, method, params },
        onError
      );
    }

    pendingRequest.timeoutId = setTimeout(() => {
      rejectPendingRequest(id, new Error("Signing request timed out"));
    }, getSigningRequestTimeoutMs(method));
  });
}

export function setActiveTab(tabId: number): void {
  currentTabId = tabId;
}

export function getActiveTab(): number | null {
  return currentTabId;
}
