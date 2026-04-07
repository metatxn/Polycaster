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

type LegacyWalletProvider = EIP1193Provider & {
  providers?: unknown[];
  info?: {
    uuid?: string;
    name?: string;
    icon?: string;
    rdns?: string;
  };
  name?: string;
  icon?: string;
  rdns?: string;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isCoinbase?: boolean;
  isPhantom?: boolean;
  isRabby?: boolean;
  isRabbyWallet?: boolean;
  isSafe?: boolean;
  isSafeWallet?: boolean;
  source?: string;
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
  "eth_call",
  "eth_getBalance",
  "eth_getTransactionReceipt",
]);

const discoveredWallets = new Map<string, EIP6963Detail>();
const discoveredWalletProviderMap = new Map<LegacyWalletProvider, string>();
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
    discoveredWalletProviderMap.set(
      detail.provider as LegacyWalletProvider,
      detail.info.uuid
    );
    broadcastWallets();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  discoverLegacyWallets();
  broadcastWallets();
}

function discoverLegacyWallets(): void {
  const providers = getLegacyWalletProviders();
  if (providers.length === 0) return;
  const primaryProvider = getLegacyProvider();

  const existingNames = new Set(
    [...discoveredWallets.values()].map((w) => w.info.name.toLowerCase())
  );

  providers.forEach((provider, index) => {
    if (discoveredWalletProviderMap.has(provider)) return;

    const providerUuid =
      provider === primaryProvider &&
      providers.length === 1 &&
      !deriveLegacyIdentityHint(provider)
        ? LEGACY_INJECTED_UUID
        : deriveLegacyIdentityUuid(provider, index);

    const info = provider.info ?? {};
    const icon = info.icon || provider.icon || "";
    const rdns = info.rdns || provider.rdns || "";
    const name = deriveLegacyWalletName(provider, index);
    const displayName = info.name || name;

    if (existingNames.has(displayName.toLowerCase())) {
      discoveredWalletProviderMap.set(provider, providerUuid);
      return;
    }

    const detail: EIP6963Detail = {
      info: {
        uuid: providerUuid,
        name: displayName,
        icon,
        rdns,
      },
      provider,
    };

    discoveredWallets.set(providerUuid, detail);
    discoveredWalletProviderMap.set(provider, providerUuid);
    existingNames.add(displayName.toLowerCase());
  });
}

function deriveLegacyWalletName(
  provider: LegacyWalletProvider,
  index: number
): string {
  if (provider.info?.name) return provider.info.name;
  if (provider.name) return provider.name;
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isPhantom) return "Phantom";
  if (provider.isRabby || provider.isRabbyWallet) return "Rabby";
  if (provider.isSafe || provider.isSafeWallet) return "Safe Wallet";
  if (provider.isCoinbase || provider.isCoinbaseWallet)
    return "Coinbase Wallet";
  const source = provider.source || "";
  const rdnsHint = provider.info?.rdns || provider.rdns || "";
  const iconHint = provider.info?.icon || provider.icon || "";
  const brandHint = detectWalletBrandHint(
    provider.info?.name || "",
    provider.name || "",
    source,
    rdnsHint,
    iconHint
  );
  if (brandHint) return brandHint;
  return `Wallet ${index + 1}`;
}

function deriveLegacyIdentityHint(
  provider: LegacyWalletProvider
): string | undefined {
  return (
    provider.info?.uuid ||
    provider.info?.rdns ||
    provider.rdns ||
    provider.info?.name ||
    provider.name ||
    provider.source ||
    provider.info?.icon ||
    provider.icon
  );
}

function deriveLegacyIdentityUuid(
  provider: LegacyWalletProvider,
  index: number
): string {
  const hint = deriveLegacyIdentityHint(provider) || "";
  const slug = sanitizeWalletSlug(hint);
  const base = slug || `provider-${index}`;
  return ensureWalletUuidUnique(base);
}

function ensureWalletUuidUnique(base: string): string {
  const MAX_ATTEMPTS = 100;
  for (let attempt = 0; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const candidate = `${LEGACY_INJECTED_UUID}-${base}${attempt > 0 ? `-${attempt}` : ""}`;
    if (!discoveredWallets.has(candidate)) return candidate;
  }
  // Extremely defensive fallback; practically unreachable.
  return `${LEGACY_INJECTED_UUID}-${base}-${Date.now().toString(36)}`;
}

function sanitizeWalletSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function detectWalletBrandHint(...values: string[]): string | undefined {
  const joined = values.join(" ").toLowerCase();
  if (joined.includes("metamask")) return "MetaMask";
  if (joined.includes("phantom")) return "Phantom";
  if (joined.includes("rabby")) return "Rabby";
  if (/\bsafe\b/.test(joined)) return "Safe Wallet";
  if (joined.includes("coinbase")) return "Coinbase Wallet";
  if (/\bbase\b/.test(joined) || joined.includes("basewallet")) return "Base";
  return undefined;
}

function getLegacyWalletProviders(): LegacyWalletProvider[] {
  const providers = new Set<LegacyWalletProvider>();
  const primary = getLegacyProvider();
  if (!primary) return [];

  providers.add(primary);

  const embedded = (primary as { providers?: unknown[] }).providers;
  if (Array.isArray(embedded)) {
    for (const candidate of embedded) {
      if (isLegacyWalletProvider(candidate)) {
        providers.add(candidate);
      }
    }
  }

  return Array.from(providers);
}

function isLegacyWalletProvider(value: unknown): value is LegacyWalletProvider {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { request?: unknown }).request === "function"
  );
}

function broadcastWallets(): void {
  const allWallets = [...discoveredWallets.values()].map((w) => ({
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
    allWallets.push({
      uuid: LEGACY_INJECTED_UUID,
      name: "Injected Provider",
      icon: "",
      rdns: "",
    });
  }

  const seenNames = new Map<string, number>();
  const wallets: typeof allWallets = [];
  for (const w of allWallets) {
    const key = w.name.toLowerCase();
    const existingIdx = seenNames.get(key);
    if (existingIdx !== undefined) {
      const existing = wallets[existingIdx];
      if (!existing.rdns && w.rdns) {
        wallets[existingIdx] = w;
      }
      continue;
    }
    seenNames.set(key, wallets.length);
    wallets.push(w);
  }

  window.postMessage(
    stamp({ type: "KNOWW_WALLETS_DISCOVERED" as const, wallets }),
    window.location.origin
  );
}

function getLegacyProvider(): EIP1193Provider | null {
  const eth = (
    window as unknown as {
      ethereum?: EIP1193Provider;
    }
  ).ethereum;
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
        discoverLegacyWallets();
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
