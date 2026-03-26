/**
 * Page Bridge — runs in the MAIN WORLD (page context).
 *
 * Discovers installed wallets via EIP-6963 and bridges EIP-1193 RPC
 * requests from the content script.  No third-party UI libraries — all
 * heavy rendering lives in the content script's isolated world.
 */

type EIP1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

interface EIP6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

const ALLOWED_METHODS = new Set([
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
  "wallet_switchEthereumChain",
  "personal_sign",
]);

const discoveredWallets = new Map<string, EIP6963Detail>();

/** The provider the user chose (or the only one available). */
let activeProvider: EIP1193Provider | null = null;

function discoverWallets(): void {
  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const detail = (event as CustomEvent<EIP6963Detail>).detail;
    if (!detail?.info?.uuid || !detail?.provider) return;
    discoveredWallets.set(detail.info.uuid, detail);
    broadcastWallets();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function broadcastWallets(): void {
  const wallets = [...discoveredWallets.values()].map((w) => ({
    uuid: w.info.uuid,
    name: w.info.name,
    icon: w.info.icon,
    rdns: w.info.rdns,
  }));
  window.postMessage({ type: "KNOWW_WALLETS_DISCOVERED", wallets }, "*");
}

function getProvider(uuid?: string): EIP1193Provider | null {
  if (uuid) {
    const w = discoveredWallets.get(uuid);
    return w ? w.provider : null;
  }
  if (activeProvider) return activeProvider;

  const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (eth && typeof eth.request === "function") return eth;

  if (discoveredWallets.size > 0) {
    return [...discoveredWallets.values()][0].provider;
  }

  return null;
}

function postError(id: string, message: string, code?: number): void {
  window.postMessage(
    { type: "KNOWW_BRIDGE_RESPONSE", id, error: message, code },
    "*"
  );
}

function postResult(id: string, result: unknown): void {
  window.postMessage({ type: "KNOWW_BRIDGE_RESPONSE", id, result }, "*");
}

(() => {
  if (window.__KNOWW_BRIDGE__) return;
  window.__KNOWW_BRIDGE__ = true;

  discoverWallets();

  window.addEventListener(
    "message",
    async (event: MessageEvent) => {
      if (event.source !== window) return;

      const data = event.data as
        | { type: "KNOWW_SELECT_WALLET"; uuid: string }
        | { type: "KNOWW_LIST_WALLETS" }
        | {
            type: "KNOWW_BRIDGE_REQUEST";
            id: string;
            method: string;
            params?: unknown[];
            walletUuid?: string;
          }
        | undefined;

      if (!data) return;

      if (data.type === "KNOWW_LIST_WALLETS") {
        broadcastWallets();
        return;
      }

      if (data.type === "KNOWW_SELECT_WALLET") {
        const w = discoveredWallets.get(data.uuid);
        if (w) {
          activeProvider = w.provider;
        }
        return;
      }

      if (data.type !== "KNOWW_BRIDGE_REQUEST") return;

      const { id, method, params, walletUuid } = data;

      if (!ALLOWED_METHODS.has(method)) {
        postError(id, `Method not allowed: ${method}`);
        return;
      }

      const eth = getProvider(walletUuid);
      if (!eth) {
        postError(
          id,
          "No wallet provider found. Install a browser wallet extension."
        );
        return;
      }

      try {
        const result = await eth.request({ method, params });
        postResult(id, result);
      } catch (err: unknown) {
        const e = err as { message?: string; code?: number };
        const error = e?.message || String(err);
        const code = e?.code;
        window.postMessage(
          { type: "KNOWW_BRIDGE_RESPONSE", id, error, code },
          "*"
        );
      }
    },
    false
  );
})();

declare global {
  interface Window {
    __KNOWW_BRIDGE__?: boolean;
  }
}

export {};
