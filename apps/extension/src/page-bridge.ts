/**
 * Page Bridge - Runs in the MAIN WORLD (page context).
 *
 * Provides access to window.ethereum (MetaMask) for the extension's
 * content script which runs in an isolated world. Communication uses
 * window.postMessage with structured request/response messages and
 * correlation IDs.
 *
 * Supported methods:
 *   eth_requestAccounts, eth_accounts, eth_chainId,
 *   eth_signTypedData_v4, eth_sendTransaction,
 *   wallet_switchEthereumChain
 */

(() => {
  if (window.__KNOWW_BRIDGE__) return;
  window.__KNOWW_BRIDGE__ = true;

  const ALLOWED_METHODS = new Set([
    "eth_requestAccounts",
    "eth_accounts",
    "eth_chainId",
    "eth_signTypedData_v4",
    "eth_sendTransaction",
    "wallet_switchEthereumChain",
    "personal_sign",
  ]);

  interface BridgeRequest {
    type: "KNOWW_BRIDGE_REQUEST";
    id: string;
    method: string;
    params?: unknown[];
  }

  window.addEventListener("message", async (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as BridgeRequest | undefined;
    if (!data || data.type !== "KNOWW_BRIDGE_REQUEST") return;

    const { id, method, params } = data;

    if (!ALLOWED_METHODS.has(method)) {
      window.postMessage(
        {
          type: "KNOWW_BRIDGE_RESPONSE",
          id,
          error: `Method not allowed: ${method}`,
        },
        "*"
      );
      return;
    }

    const eth = (window as any).ethereum;
    if (!eth || typeof eth.request !== "function") {
      window.postMessage(
        {
          type: "KNOWW_BRIDGE_RESPONSE",
          id,
          error: "No wallet provider found (MetaMask not installed)",
        },
        "*"
      );
      return;
    }

    try {
      const result = await eth.request({ method, params });
      window.postMessage({ type: "KNOWW_BRIDGE_RESPONSE", id, result }, "*");
    } catch (err: any) {
      const error = err?.message || String(err);
      const code = err?.code;
      window.postMessage(
        { type: "KNOWW_BRIDGE_RESPONSE", id, error, code },
        "*"
      );
    }
  });
})();

declare global {
  interface Window {
    __KNOWW_BRIDGE__?: boolean;
  }
}

export {};
