/**
 * Page Bridge — runs in the MAIN WORLD (page context).
 *
 * Discovers installed wallets via EIP-6963 and bridges EIP-1193 RPC
 * requests from the content script.  No third-party UI libraries — all
 * heavy rendering lives in the content script's isolated world.
 *
 * Security: a per-injection nonce (_n) is embedded in the injecting
 * <script> tag's data-knoww-nonce attribute. Both sides include the
 * nonce in every message and drop anything that doesn't match.
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
const LEGACY_INJECTED_UUID = "__injected__";

/** The provider the user chose (or the only one available). */
let activeProvider: EIP1193Provider | null = null;

const BRIDGE_NONCE: string | undefined = (() => {
  const el = document.getElementById("knoww-page-bridge");
  return el?.dataset?.knowwNonce || undefined;
})();

function stamp<T extends Record<string, unknown>>(msg: T): T & { _n?: string } {
  if (BRIDGE_NONCE) return { ...msg, _n: BRIDGE_NONCE };
  return msg as T & { _n?: string };
}

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

  const eth = getLegacyProvider();
  const alreadyDiscovered = eth
    ? [...discoveredWallets.values()].some((w) => w.provider === eth)
    : true;
  if (eth && !alreadyDiscovered) {
    wallets.push({
      uuid: LEGACY_INJECTED_UUID,
      name: "Injected Provider",
      icon: "",
      rdns: "",
    });
  }

  window.postMessage(
    stamp({ type: "KNOWW_WALLETS_DISCOVERED" as const, wallets }),
    window.location.origin
  );
}

function getLegacyProvider(): EIP1193Provider | null {
  const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  return eth && typeof eth.request === "function" ? eth : null;
}

function getProvider(uuid?: string): EIP1193Provider | null {
  if (uuid) {
    if (uuid === LEGACY_INJECTED_UUID) return getLegacyProvider();
    const w = discoveredWallets.get(uuid);
    return w ? w.provider : null;
  }
  if (activeProvider) return activeProvider;

  if (discoveredWallets.size > 0) {
    return [...discoveredWallets.values()][0].provider;
  }

  return getLegacyProvider();
}

function postError(id: string, message: string, code?: number): void {
  window.postMessage(
    stamp({ type: "KNOWW_BRIDGE_RESPONSE" as const, id, error: message, code }),
    window.location.origin
  );
}

function postResult(id: string, result: unknown): void {
  window.postMessage(
    stamp({ type: "KNOWW_BRIDGE_RESPONSE" as const, id, result }),
    window.location.origin
  );
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
        | { type: "KNOWW_SELECT_WALLET"; uuid: string; _n?: string }
        | { type: "KNOWW_LIST_WALLETS"; _n?: string }
        | {
            type: "KNOWW_BRIDGE_REQUEST";
            id: string;
            method: string;
            params?: unknown[];
            walletUuid?: string;
            _n?: string;
          }
        | undefined;

      if (!data) return;
      if (BRIDGE_NONCE && data._n !== BRIDGE_NONCE) return;

      if (data.type === "KNOWW_LIST_WALLETS") {
        broadcastWallets();
        return;
      }

      if (data.type === "KNOWW_SELECT_WALLET") {
        let provider: EIP1193Provider | null = null;

        if (data.uuid === LEGACY_INJECTED_UUID) {
          provider = getLegacyProvider();
        } else {
          const w = discoveredWallets.get(data.uuid);
          if (w) provider = w.provider;
        }

        if (provider) {
          activeProvider = provider;
          window.postMessage(
            stamp({
              type: "KNOWW_SELECT_WALLET_RESULT" as const,
              uuid: data.uuid,
              ok: true as const,
            }),
            window.location.origin
          );
        } else {
          window.postMessage(
            stamp({
              type: "KNOWW_SELECT_WALLET_RESULT" as const,
              uuid: data.uuid,
              ok: false as const,
              error: "WALLET_NOT_FOUND",
            }),
            window.location.origin
          );
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
          stamp({ type: "KNOWW_BRIDGE_RESPONSE" as const, id, error, code }),
          window.location.origin
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
