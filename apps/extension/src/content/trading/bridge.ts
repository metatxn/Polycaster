/**
 * WalletBridge — content script side of the page bridge communication.
 *
 * Sends KNOWW_BRIDGE_REQUEST messages to the page-bridge.ts (main world)
 * via window.postMessage and correlates responses via unique IDs.
 *
 * Also handles signing delegation from the background service worker:
 * background → chrome.tabs.sendMessage → here → page bridge → MetaMask → back.
 */

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

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function init(): void {
  if (initialized) return;
  initialized = true;

  // Listen for page bridge responses
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as BridgeResponse | undefined;
    if (!data || data.type !== "KNOWW_BRIDGE_RESPONSE") return;

    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);

    if (data.error) {
      p.reject(new Error(data.error));
    } else {
      p.resolve(data.result);
    }
  });

  // Listen for signing requests from background (BridgeSigner delegation)
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "trading:signing-request") return false;

    const { id, method, params } = message;

    // Forward to page bridge and wait for response
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
}

function request(method: string, params?: unknown[]): Promise<unknown> {
  init();
  return new Promise((resolve, reject) => {
    const id = generateId();
    pending.set(id, { resolve, reject });

    window.postMessage(
      { type: "KNOWW_BRIDGE_REQUEST", id, method, params },
      "*"
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

  async connect(): Promise<string[]> {
    const accounts = (await request("eth_requestAccounts")) as string[];
    return accounts;
  },

  async getAccounts(): Promise<string[]> {
    const accounts = (await request("eth_accounts")) as string[];
    return accounts || [];
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
};
