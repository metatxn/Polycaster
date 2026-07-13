/**
 * TradingService — orchestrates the full trading flow from the content script.
 *
 * Manages wallet connection, credential derivation, proxy wallet derivation,
 * balance queries, order book fetching, and order placement (limit + market).
 * Also supports split (pUSD→YES+NO) and merge (YES+NO→pUSD) operations.
 */

import { createLogger } from "@knoww/logger";
import { sameAddress } from "@knoww/shared-types/bridge";
import {
  type ClobOrderType,
  POLYGON_CHAIN_ID_HEX,
  resolvePreferredTradingWalletMode,
} from "@knoww/shared-types/polymarket";
import type { OrderBook } from "@knoww/shared-types/slippage";

const log = createLogger("trading-service");
const WALLET_MODE_STORAGE_KEY = "knoww_trading_wallet_mode";

import {
  EXTENSION_AUTH_REQUIRED_ERROR,
  TRADING_SESSION_DISCONNECTED_MESSAGE,
  TRADING_WALLET_CONNECTED_MESSAGE,
  type TradingBalanceData,
  type TradingGetOrderPreflightResponse,
  type TradingWalletMode,
} from "../../types/chrome-messages";
import type { OutcomeBalances } from "../ui/outcome-balances";
import { WalletBridge } from "./bridge";
import { CredentialManager } from "./credentials";
import { ExtensionSession } from "./extension-session";
import { ProxyWallet } from "./proxy-wallet";
import {
  fetchTradingSetupApprovalStatus,
  isWithinDegradedSetupTrustWindow,
  type TradingSetupAllowanceReadStatus,
} from "./setup-flow";
import {
  hasDeployedTradingWallet,
  isTradingWalletDeploymentRequired,
  normalizeExtensionTradingWalletMode,
  TRADING_WALLET_SETUP_REQUIRED_MESSAGE,
} from "./setup-gates";

export type TradingState =
  | "disconnected"
  | "connecting"
  | "switching-chain"
  | "restoring-session"
  | "connected"
  | "deriving-credentials"
  | "ready"
  | "placing-order"
  | "approving"
  | "deploying"
  | "splitting"
  | "merging"
  | "error";

export interface TokenBalanceEntry {
  symbol: string;
  amount: number;
}

export interface TradingContext {
  state: TradingState;
  address: string | null;
  proxyAddress: string | null;
  walletMode: TradingWalletMode;
  legacySafeAvailable: boolean;
  /**
   * On-chain relayer wallet deployment status.
   * `null` = not yet checked (initial state, or proxyAddress not derived yet).
   * `true`  = confirmed deployed.
   * `false` = confirmed absent — user needs to run the deploy flow.
   *
   * The null state lets the panel show a neutral loading spinner instead of
   * flashing the "Deploy Trading Wallet" button for ~500ms on first open
   * while `refreshBalance()` performs its `eth_getCode` check.
   */
  isDeployed: boolean | null;
  pusdBalance: number;
  pusdBalanceRaw: string;
  usdcEBalance: number;
  balance: number;
  polBalance: number;
  tokenBalances: TokenBalanceEntry[];
  /**
   * Whether CLOB credentials exist for this wallet. The raw credentials live
   * only in the background worker; content tracks presence so the UI can move
   * between connected/ready states without ever holding the secret.
   */
  hasCredentials: boolean;
  error: string | null;
  orderBook: OrderBook | null;
  /** Token whose levels are currently stored in `orderBook`. */
  orderBookTokenId: string | null;
  orderBookError: string | null;
  minOrderSize: number;
  tickSize: number;
  hasTradingApproval: boolean;
  usdcAllowance: number;
  usdcAllowanceNegRisk: number;
  approvalReadStatus: TradingSetupAllowanceReadStatus | "unknown";
}

type StateListener = (ctx: TradingContext) => void;

const listeners: StateListener[] = [];

function createDisconnectedContext(): TradingContext {
  return {
    state: "disconnected",
    address: null,
    proxyAddress: null,
    walletMode: "deposit",
    legacySafeAvailable: false,
    isDeployed: null,
    pusdBalance: 0,
    pusdBalanceRaw: "0",
    usdcEBalance: 0,
    balance: 0,
    polBalance: 0,
    tokenBalances: [],
    hasCredentials: false,
    error: null,
    orderBook: null,
    orderBookTokenId: null,
    orderBookError: null,
    minOrderSize: 1,
    tickSize: 0.01,
    hasTradingApproval: false,
    usdcAllowance: 0,
    usdcAllowanceNegRisk: 0,
    approvalReadStatus: "unknown",
  };
}

let ctx: TradingContext = createDisconnectedContext();
let orderBookRequestSequence = 0;
let latestContextOrderBookRequest = 0;
let walletSwitchInProgress = false;
// Last accountsChanged swallowed while a deliberate switch is in flight —
// replayed once the switch settles so a failed switch can't strand ctx on an
// account the provider has already moved past.
let pendingAccountsChangedDuringSwitch: string[] | null = null;
// Card-side counterpart of the side panel's degraded latch: bounds how long
// refreshBalance preserves last-known-good approval state under degraded
// allowance reads (shared trust window from setup-flow).
let consecutiveDegradedApprovalReads = 0;

function tokenBalance(
  tokenBalances: TokenBalanceEntry[] | undefined,
  symbol: string
): number {
  const normalized = symbol.toLowerCase();
  return (
    tokenBalances?.find((token) => token.symbol.toLowerCase() === normalized)
      ?.amount ?? 0
  );
}

function normalizeBalanceData(
  data: TradingBalanceData
): TradingBalanceData & Required<Pick<TradingBalanceData, "polBalance">> {
  const tokenBalances = data.tokenBalances ?? [];
  const pusdBalance = data.pusdBalance ?? tokenBalance(tokenBalances, "pUSD");
  const usdcEBalance =
    data.usdcEBalance ?? tokenBalance(tokenBalances, "USDC.e");

  return {
    ...data,
    balance: data.balance ?? pusdBalance + usdcEBalance,
    balanceRaw: data.balanceRaw ?? data.pusdBalanceRaw ?? "0",
    pusdBalance,
    pusdBalanceRaw: data.pusdBalanceRaw ?? "0",
    usdcEBalance,
    usdcEBalanceRaw: data.usdcEBalanceRaw ?? "0",
    polBalance: data.polBalance ?? 0,
    tokenBalances,
  };
}

function walletModeStorageKey(address: string): string {
  return `${WALLET_MODE_STORAGE_KEY}_${address.toLowerCase()}`;
}

async function readStoredWalletMode(
  address: string
): Promise<TradingWalletMode | null> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
  const key = walletModeStorageKey(address);
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const stored = result?.[key];
      resolve(
        typeof stored === "string"
          ? normalizeExtensionTradingWalletMode(stored)
          : null
      );
    });
  });
}

async function storeWalletMode(
  address: string,
  walletMode: TradingWalletMode
): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await new Promise<void>((resolve) => {
    chrome.storage.local.set(
      {
        [walletModeStorageKey(address)]:
          normalizeExtensionTradingWalletMode(walletMode),
      },
      () => resolve()
    );
  });
}

type ResolvedTradingWallet = {
  proxyAddress: string;
  balance: number;
  pusdBalance: number;
  pusdBalanceRaw: string;
  usdcEBalance: number;
  polBalance: number;
  tokenBalances: TokenBalanceEntry[];
  /** null = deployment unknown (reads failed) — never guessed as false. */
  isDeployed: boolean | null;
};

async function resolveTradingWalletAddress(
  address: string,
  walletMode: TradingWalletMode
): Promise<string> {
  const normalizedMode = normalizeExtensionTradingWalletMode(walletMode);
  return normalizedMode === "eoa"
    ? address
    : await ProxyWallet.deriveAddress(address, normalizedMode);
}

async function resolveTradingWallet(
  address: string,
  walletMode: TradingWalletMode
): Promise<ResolvedTradingWallet> {
  const normalizedMode = normalizeExtensionTradingWalletMode(walletMode);
  if (normalizedMode === "eoa") {
    const balData = normalizeBalanceData(await ProxyWallet.getBalance(address));
    return {
      proxyAddress: address,
      balance: balData.balance,
      pusdBalance: balData.pusdBalance,
      pusdBalanceRaw: balData.pusdBalanceRaw,
      usdcEBalance: balData.usdcEBalance,
      polBalance: balData.polBalance ?? 0,
      tokenBalances: balData.tokenBalances ?? [],
      isDeployed: true,
    };
  }
  // The derive handler owns deployment truth (bytecode + relayer /deployed
  // fallback); the balance read's bytecode-only answer is only a fallback,
  // and unknown stays null. A hard `false` from a silently-failed read sent
  // already-deployed users back to "Create trading vault" after a switch.
  const derived = await ProxyWallet.resolveDeployment(address, normalizedMode);
  const balData = normalizeBalanceData(
    await ProxyWallet.getBalance(derived.proxyAddress)
  );
  return {
    proxyAddress: derived.proxyAddress,
    balance: balData.balance,
    pusdBalance: balData.pusdBalance,
    pusdBalanceRaw: balData.pusdBalanceRaw,
    usdcEBalance: balData.usdcEBalance,
    polBalance: balData.polBalance ?? 0,
    tokenBalances: balData.tokenBalances ?? [],
    isDeployed: derived.isDeployed ?? balData.isDeployed ?? null,
  };
}

async function resolveExistingSafeWallet(
  address: string
): Promise<ResolvedTradingWallet | null> {
  try {
    // Deployment decided by the derive handler (bytecode + relayer fallback):
    // a transient bytecode failure must not read as "no legacy safe".
    const derived = await ProxyWallet.resolveDeployment(address, "safe");
    if (derived.isDeployed !== true) return null;
    const safeBalance = normalizeBalanceData(
      await ProxyWallet.getBalance(derived.proxyAddress)
    );
    return {
      proxyAddress: derived.proxyAddress,
      balance: safeBalance.balance,
      pusdBalance: safeBalance.pusdBalance,
      pusdBalanceRaw: safeBalance.pusdBalanceRaw,
      usdcEBalance: safeBalance.usdcEBalance,
      polBalance: safeBalance.polBalance ?? 0,
      tokenBalances: safeBalance.tokenBalances ?? [],
      isDeployed: true,
    };
  } catch (err) {
    log.warn("legacy_safe.detect_failed", { error: err });
    return null;
  }
}

function trackTradingAnalytics(
  event: string,
  properties: Record<string, string | number | boolean | null | undefined> = {}
): void {
  if (typeof window.KNOWW_ANALYTICS?.track === "function") {
    void window.KNOWW_ANALYTICS.track(event, properties);
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn(ctx);
    } catch {
      /* ignore */
    }
  }
}

function update(partial: Partial<TradingContext>): void {
  ctx = { ...ctx, ...partial };
  notify();
}

function openTradingSetupSidePanel(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage(
    { type: "KNOWW_OPEN_EXTENSION_SIDEPANEL", view: "portfolio" },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function broadcastWalletConnected(address: string): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage(
    { type: TRADING_WALLET_CONNECTED_MESSAGE, address },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function accountListIncludesAddress(
  accounts: string[],
  address: string
): boolean {
  return accounts.some((account) => sameAddress(account, address));
}

function sendMsg<T>(
  message: Record<string, unknown>,
  label: string,
  timeoutMs = 120_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`${label} (timed out after ${timeoutMs / 1000}s)`));
      }
    }, timeoutMs);

    chrome.runtime.sendMessage(
      message,
      (response: { ok: boolean; data?: T; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || label));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || label));
          return;
        }
        resolve(response.data as T);
      }
    );
  });
}

function isExtensionAuthError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message
      .toLowerCase()
      .includes(EXTENSION_AUTH_REQUIRED_ERROR.toLowerCase())
  );
}

let reAuthPromise: Promise<void> | null = null;

async function reauthenticate(address: string): Promise<void> {
  if (reAuthPromise) return reAuthPromise;

  reAuthPromise = (async () => {
    try {
      await ExtensionSession.clear();
      await ExtensionSession.ensureAuthorized(address);
    } finally {
      reAuthPromise = null;
    }
  })();

  return reAuthPromise;
}

async function runWithAuthRetry<T>(
  address: string,
  operation: () => Promise<T>
): Promise<T> {
  await ExtensionSession.ensureAuthorized(address);

  try {
    return await operation();
  } catch (error) {
    if (!isExtensionAuthError(error)) {
      throw error;
    }

    await reauthenticate(address);

    try {
      return await operation();
    } catch (retryError) {
      if (isExtensionAuthError(retryError)) {
        throw new Error(
          "Session expired. Please reconnect your wallet and try again."
        );
      }
      throw retryError;
    }
  }
}

async function applyConnectedWalletAccounts(
  accounts: string[] | undefined,
  walletUuid: string | undefined,
  analyticsEvent: "wallet_connected" | "wallet_switched"
): Promise<void> {
  if (!accounts || accounts.length === 0) {
    update({ state: "error", error: "No accounts returned" });
    return;
  }

  const address = accounts[0];
  const storedWalletMode = await readStoredWalletMode(address);
  const initialWalletMode = resolvePreferredTradingWalletMode({
    storedMode: storedWalletMode,
    legacySafeDeployed: false,
  });
  update({
    address,
    legacySafeAvailable: false,
    approvalReadStatus: "unknown",
    walletMode: initialWalletMode,
  });
  broadcastWalletConnected(address);
  trackTradingAnalytics(analyticsEvent, {
    hasMultipleWallets: walletUuid !== undefined,
  });

  update({ state: "switching-chain" });
  try {
    const chainId = await WalletBridge.getChainId();
    if (chainId !== POLYGON_CHAIN_ID_HEX) {
      await WalletBridge.switchChain(POLYGON_CHAIN_ID_HEX);
    }
  } catch (err) {
    trackTradingAnalytics("wallet_chain_switch_failed", {
      chainId: POLYGON_CHAIN_ID_HEX,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    log.warn("chain.switch_failed", { error: err });
  }

  // The wallet is connected, but the trading-wallet and credential checks
  // below can take several seconds for a returning session. Keep that gap as
  // an explicit loading state so the panel never renders an empty body.
  update({ state: "restoring-session" });

  try {
    const existingSafe = await resolveExistingSafeWallet(address);
    const preferredWalletMode = resolvePreferredTradingWalletMode({
      storedMode: storedWalletMode,
      legacySafeDeployed: Boolean(existingSafe),
    });
    if (preferredWalletMode !== storedWalletMode) {
      await storeWalletMode(address, preferredWalletMode);
    }
    update({
      walletMode: preferredWalletMode,
      legacySafeAvailable: Boolean(existingSafe),
    });

    if (preferredWalletMode === "safe" && existingSafe) {
      update(existingSafe);
    } else {
      const walletData = await resolveTradingWallet(
        address,
        preferredWalletMode
      );
      update(walletData);
    }
  } catch (err) {
    log.warn("trading_wallet.resolve_failed", { error: err });
    const fallbackProxyAddress =
      ctx.proxyAddress ??
      (await resolveTradingWalletAddress(address, ctx.walletMode).catch(
        () => null
      ));
    update({
      ...(fallbackProxyAddress
        ? {
            proxyAddress: fallbackProxyAddress,
            isDeployed: ctx.walletMode === "eoa" ? true : ctx.isDeployed,
          }
        : {}),
      balance: 0,
      pusdBalance: 0,
      pusdBalanceRaw: "0",
      usdcEBalance: 0,
      polBalance: 0,
      tokenBalances: [],
    });
  }

  const hasCreds = await CredentialManager.has(address);
  if (hasCreds) {
    update({
      hasCredentials: true,
      state: hasDeployedTradingWallet(ctx) ? "ready" : "connected",
    });
  } else {
    update({ state: "connected" });
  }
}

async function clearPreviousWalletSession(address: string): Promise<void> {
  try {
    await sendMsg<null>(
      { type: "auth:logout" },
      "Failed to clear switched wallet session",
      15_000
    );
  } catch (err) {
    log.warn("wallet.switch_logout_failed", {
      address,
      error: err,
    });
  }
}

export const TradingService = {
  getContext(): TradingContext {
    return ctx;
  },

  onStateChange(listener: StateListener): () => void {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  },

  async hasActiveSession(): Promise<boolean> {
    return ExtensionSession.hasSession();
  },

  async getConnectedWalletAddress(): Promise<string | null> {
    if (!ctx.address) return null;
    const accounts = await WalletBridge.getSelectedAccounts();
    await this.handleExternalWalletAccountsChanged(accounts);
    return ctx.address;
  },

  async handleExternalWalletAccountsChanged(accounts: string[]): Promise<void> {
    if (walletSwitchInProgress) {
      pendingAccountsChangedDuringSwitch = accounts;
      return;
    }
    if (!ctx.address) return;
    if (accounts.length === 0) {
      // An empty list means the wallet is locked or the provider dropped its
      // connection (EIP-1193 `disconnect`), not that the user removed the
      // account — keep the session. A genuine account switch/removal arrives
      // as a non-empty list that excludes ctx.address.
      return;
    }
    if (accountListIncludesAddress(accounts, ctx.address)) return;

    const disconnectedAddress = ctx.address;
    WalletBridge.resetAfterDisconnect();
    this.reset();

    try {
      await sendMsg<null>(
        { type: "auth:logout" },
        "Failed to clear disconnected wallet session",
        15_000
      );
    } catch (err) {
      log.warn("wallet.external_disconnect_logout_failed", {
        address: disconnectedAddress,
        error: err,
      });
    }
  },

  async connectWallet(walletUuid?: string): Promise<void> {
    update({ state: "connecting", error: null });

    try {
      const accounts = await WalletBridge.connect(walletUuid);
      await applyConnectedWalletAccounts(
        accounts,
        walletUuid,
        "wallet_connected"
      );
    } catch (err) {
      trackTradingAnalytics("wallet_connect_failed", {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      update({
        state: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async switchWallet(walletUuid?: string): Promise<void> {
    const previousContext = { ...ctx };
    walletSwitchInProgress = true;
    update({ state: "connecting", error: null });

    try {
      const accounts = await WalletBridge.switchWallet(walletUuid);
      const nextAddress = accounts?.[0] ?? null;
      const didChangeAddress =
        previousContext.address !== null &&
        nextAddress !== null &&
        !accountListIncludesAddress([nextAddress], previousContext.address);

      if (didChangeAddress && previousContext.address) {
        await clearPreviousWalletSession(previousContext.address);
        ctx = createDisconnectedContext();
        notify();
      }

      await applyConnectedWalletAccounts(
        accounts,
        walletUuid,
        "wallet_switched"
      );
    } catch (err) {
      trackTradingAnalytics("wallet_switch_failed", {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      ctx = {
        ...previousContext,
        error: err instanceof Error ? err.message : String(err),
      };
      notify();
      throw err;
    } finally {
      // Replay the last event swallowed mid-switch: on the failure path the
      // provider may already be on the new account (permissions granted, then
      // eth_requestAccounts rejected) while ctx was restored to the old one —
      // the replay reconciles exactly like the next wallet poll would.
      walletSwitchInProgress = false;
      const buffered = pendingAccountsChangedDuringSwitch;
      pendingAccountsChangedDuringSwitch = null;
      if (buffered) {
        void this.handleExternalWalletAccountsChanged(buffered);
      }
    }
  },

  async deriveCredentials(): Promise<void> {
    if (!ctx.address) {
      update({ state: "error", error: "Wallet not connected" });
      return;
    }

    // Re-read when deployment is unknown OR cached false: the user may have
    // deployed the vault from the side panel wizard, which never notifies
    // content tabs — gating on a stale `false` would bounce this action back
    // to the side panel forever. Deployment is monotonic, so re-checking is
    // always safe.
    if (!ctx.proxyAddress || ctx.isDeployed !== true) {
      await this.refreshBalance();
    }

    if (isTradingWalletDeploymentRequired(ctx)) {
      update({
        state: "connected",
        error: TRADING_WALLET_SETUP_REQUIRED_MESSAGE,
      });
      openTradingSetupSidePanel();
      return;
    }

    update({ state: "deriving-credentials", error: null });
    trackTradingAnalytics("trading_api_key_requested");

    try {
      const result = await CredentialManager.derive(ctx.address);
      trackTradingAnalytics(
        result.method === "create"
          ? "trading_api_key_created"
          : "trading_api_key_derived"
      );
      update({
        hasCredentials: true,
        state: hasDeployedTradingWallet(ctx) ? "ready" : "connected",
      });

      if (!ctx.proxyAddress || ctx.isDeployed === null) {
        await this.refreshBalance();
      }
    } catch (err) {
      trackTradingAnalytics("trading_api_key_failed", {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      update({
        state: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async ensureReady(): Promise<boolean> {
    if (
      ctx.state === "ready" &&
      ctx.hasCredentials &&
      hasDeployedTradingWallet(ctx)
    )
      return true;
    // A prior rejected signature leaves state="error"; a fresh user-initiated
    // ensureReady must clear it and retry, otherwise the button is dead until
    // reload. Reset to the closest non-error state before re-prompting.
    if (ctx.state === "error") {
      update({
        state: ctx.address ? "connected" : "disconnected",
        error: null,
      });
    }
    if (!ctx.address) await this.connectWallet();
    // Connect genuinely failed (no account / rejected the connect itself).
    if (!ctx.address) return false;
    // `!== true` (not `=== null`): a stale cached `false` must also be
    // re-read — see the matching gate in deriveCredentials.
    let refreshedThisCall = false;
    if (!ctx.proxyAddress || ctx.isDeployed !== true) {
      await this.refreshBalance();
      refreshedThisCall = true;
    }
    if (isTradingWalletDeploymentRequired(ctx)) {
      update({
        state: "connected",
        error: TRADING_WALLET_SETUP_REQUIRED_MESSAGE,
      });
      openTradingSetupSidePanel();
      return false;
    }
    if (!ctx.hasCredentials) await this.deriveCredentials();
    // Credentials + deployed vault = ready; the state label can lag behind
    // (e.g. "connected" cached before a side-panel deploy was re-read above)
    // and would otherwise report a fully-set-up user as unready.
    if (
      ctx.state !== "ready" &&
      ctx.hasCredentials &&
      hasDeployedTradingWallet(ctx)
    ) {
      update({ state: "ready", error: null });
    }
    // For a returning user `connectWallet` reaches "ready" without refreshing
    // balance/allowance (only `deriveCredentials` refreshes, and it's skipped
    // when creds already exist). Without this, callers that read ctx right after
    // — e.g. the stream card — see allowance 0 and show a false "Approve".
    // Skip when this call already ran the full refresh fan-out above.
    if (ctx.state === "ready" && !refreshedThisCall) {
      await this.refreshBalance();
    }
    return ctx.state === "ready" && hasDeployedTradingWallet(ctx);
  },

  async setWalletMode(walletMode: TradingWalletMode): Promise<void> {
    const normalizedMode = normalizeExtensionTradingWalletMode(walletMode);
    if (ctx.walletMode === normalizedMode) return;

    let legacySafeWallet: ResolvedTradingWallet | null = null;
    if (normalizedMode === "safe" && ctx.address && !ctx.legacySafeAvailable) {
      legacySafeWallet = await resolveExistingSafeWallet(ctx.address);
      if (!legacySafeWallet) {
        update({
          state: ctx.address ? "connected" : ctx.state,
          error: "Safe is only available for legacy Polymarket Safe wallets.",
        });
        return;
      }
    }

    update({
      walletMode: normalizedMode,
      legacySafeAvailable: ctx.legacySafeAvailable || Boolean(legacySafeWallet),
      proxyAddress: normalizedMode === "eoa" ? ctx.address : null,
      isDeployed: normalizedMode === "eoa" ? true : null,
      balance: 0,
      pusdBalance: 0,
      pusdBalanceRaw: "0",
      usdcEBalance: 0,
      polBalance: 0,
      tokenBalances: [],
      hasTradingApproval: false,
      usdcAllowance: 0,
      usdcAllowanceNegRisk: 0,
      approvalReadStatus: "unknown",
      error: null,
      state: ctx.address ? "connected" : ctx.state,
    });

    if (ctx.address) {
      try {
        await storeWalletMode(ctx.address, normalizedMode);
        const walletData = await resolveTradingWallet(
          ctx.address,
          normalizedMode
        );
        update(walletData);
        await this.refreshBalance();
        if (ctx.hasCredentials) {
          update({
            state: hasDeployedTradingWallet(ctx) ? "ready" : "connected",
          });
        }
      } catch (err) {
        update({
          state: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },

  async refreshBalance(): Promise<void> {
    const walletMode = normalizeExtensionTradingWalletMode(ctx.walletMode);
    if (!ctx.proxyAddress && ctx.address) {
      try {
        const proxyAddress =
          walletMode === "eoa"
            ? ctx.address
            : await ProxyWallet.deriveAddress(ctx.address, walletMode);
        update({ proxyAddress });
      } catch (err) {
        log.warn("proxy.derive_failed_during_refresh", { error: err });
        return;
      }
    }
    if (!ctx.proxyAddress) return;
    try {
      const balData = await ProxyWallet.getBalance(ctx.proxyAddress);
      const nextBalance = normalizeBalanceData(balData);
      update({
        balance: nextBalance.balance,
        pusdBalance: nextBalance.pusdBalance,
        pusdBalanceRaw: nextBalance.pusdBalanceRaw,
        usdcEBalance: nextBalance.usdcEBalance,
        polBalance: nextBalance.polBalance ?? 0,
        tokenBalances: nextBalance.tokenBalances ?? [],
        // Piggybacks on the balance fetch (background returns code presence
        // from the same provider). Deployment is monotonic on-chain and ctx
        // resets on account switch, so a known-deployed wallet never
        // downgrades here — a lagging/pruned RPC node serving empty code must
        // not bounce the user back to "Create trading vault". Failed reads
        // omit the flag entirely, so `??` keeps the last known value.
        isDeployed:
          walletMode === "eoa"
            ? true
            : ctx.isDeployed === true
              ? true
              : (balData.isDeployed ?? ctx.isDeployed),
      });
    } catch (err) {
      log.warn("balance.refresh_failed", { error: err });
    }

    try {
      const approvalStatus = await fetchTradingSetupApprovalStatus(
        ctx.proxyAddress,
        (ownerAddress) =>
          sendMsg<{
            allowances: Record<string, number>;
            degraded?: boolean;
            degradedKeys?: string[];
          }>(
            {
              type: "trading:get-all-allowances",
              ownerAddress,
            },
            "Setup allowance check"
          )
      );
      if (approvalStatus.allowanceReadStatus === "degraded") {
        consecutiveDegradedApprovalReads++;
        if (
          isWithinDegradedSetupTrustWindow(consecutiveDegradedApprovalReads)
        ) {
          // Preserve last-known-good approval state for a bounded window.
          update({ approvalReadStatus: "degraded" });
          return;
        }
        // Past the trust limit: apply the degraded read as authoritative
        // (reported "complete" so the surface resolver stops trusting the
        // persisted latch) — a persistent outage, or an on-chain revoke
        // hiding behind one, must eventually re-surface the approve step.
        // Mirrors the side panel's bound on its durable latch.
        update({
          hasTradingApproval: approvalStatus.hasTradingApproval,
          usdcAllowance: approvalStatus.usdcAllowance,
          usdcAllowanceNegRisk: approvalStatus.usdcAllowanceNegRisk,
          approvalReadStatus: "complete",
        });
        return;
      }
      consecutiveDegradedApprovalReads = 0;
      update({
        hasTradingApproval: approvalStatus.hasTradingApproval,
        usdcAllowance: approvalStatus.usdcAllowance,
        usdcAllowanceNegRisk: approvalStatus.usdcAllowanceNegRisk,
        approvalReadStatus: approvalStatus.allowanceReadStatus,
      });
    } catch (err) {
      log.warn("approval.refresh_failed", { error: err });
      consecutiveDegradedApprovalReads++;
      update({ approvalReadStatus: "degraded" });
    }
  },

  // ── Order Book ──

  async fetchOrderBook(
    tokenId: string,
    options?: { syncContext?: boolean }
  ): Promise<OrderBook | null> {
    const syncContext = options?.syncContext !== false;
    const requestId = syncContext ? ++orderBookRequestSequence : 0;
    if (syncContext) {
      latestContextOrderBookRequest = requestId;
      const tokenChanged = ctx.orderBookTokenId !== tokenId;
      update({
        orderBook: tokenChanged ? null : ctx.orderBook,
        orderBookTokenId: tokenId,
        orderBookError: null,
        ...(tokenChanged ? { minOrderSize: 1, tickSize: 0.01 } : {}),
      });
    }

    try {
      const data = await sendMsg<
        OrderBook & { min_order_size?: string; tick_size?: string }
      >(
        { type: "trading:get-orderbook", tokenId },
        "Failed to fetch order book"
      );
      if (
        syncContext &&
        requestId === latestContextOrderBookRequest &&
        ctx.orderBookTokenId === tokenId
      ) {
        const rawMin = parseFloat(data.min_order_size ?? "1");
        const minOrderSize = Math.max(
          1,
          Math.ceil(Number.isFinite(rawMin) ? rawMin : 1)
        );
        const rawTick = parseFloat(data.tick_size ?? "0.01");
        const tickSize =
          Number.isFinite(rawTick) && rawTick > 0 ? rawTick : 0.01;
        update({
          orderBook: data,
          orderBookError: null,
          minOrderSize,
          tickSize,
        });
      }
      return data;
    } catch (err) {
      if (
        syncContext &&
        requestId === latestContextOrderBookRequest &&
        ctx.orderBookTokenId === tokenId
      ) {
        update({
          orderBook: { bids: [], asks: [] },
          orderBookError:
            err instanceof Error ? err.message : "Failed to fetch order book",
        });
      }
      return null;
    }
  },

  async getOrderPreflight(params: {
    side: "BUY" | "SELL";
    price: number;
    size: number;
    amount?: number;
    orderType?: ClobOrderType;
    conditionId?: string;
    isMarketableBuy?: boolean;
  }): Promise<TradingGetOrderPreflightResponse> {
    return sendMsg<TradingGetOrderPreflightResponse>(
      {
        type: "trading:get-order-preflight",
        ...params,
      },
      "Order preflight failed",
      30_000
    );
  },

  // ── Place Order (Limit + Market) ──

  async placeOrder(params: {
    tokenId: string;
    conditionId?: string;
    outcomeIndex: number;
    side: "BUY" | "SELL";
    price: number;
    size: number;
    amount?: number;
    orderType?: ClobOrderType;
    expiration?: number;
    negRisk?: boolean;
    isMarketableBuy?: boolean;
  }): Promise<unknown> {
    if (!ctx.address || !ctx.proxyAddress || !ctx.hasCredentials) {
      throw new Error("Trading setup incomplete");
    }

    update({ state: "placing-order", error: null });

    try {
      const result = await runWithAuthRetry(ctx.address, () =>
        sendMsg(
          {
            type: "trading:place-order",
            ...params,
            address: ctx.address,
            proxyAddress: ctx.proxyAddress,
            walletMode: ctx.walletMode,
          },
          "Order failed"
        )
      );

      update({ state: "ready" });
      await this.refreshBalance();
      return result;
    } catch (err) {
      update({
        state: "ready",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  // ── Trading Wallet Deployment (gasless via Relayer) ──

  /**
   * Deploys the selected relayer-backed Polymarket trading wallet.
   * Resolves with the tx hash (or empty string if the wallet was already
   * deployed on-chain). On success, flips `ctx.isDeployed` and refreshes
   * balance/allowance state.
   */
  async deployWallet(): Promise<{ txHash: string; alreadyDeployed: boolean }> {
    if (!ctx.address) throw new Error("Wallet not connected");
    if (normalizeExtensionTradingWalletMode(ctx.walletMode) === "eoa") {
      update({
        state: ctx.hasCredentials ? "ready" : "connected",
        isDeployed: true,
        proxyAddress: ctx.address,
      });
      return { txHash: "", alreadyDeployed: true };
    }

    update({ state: "deploying", error: null });

    try {
      const result = await runWithAuthRetry(ctx.address, () =>
        sendMsg<{
          txHash: string;
          proxyAddress: string;
          alreadyDeployed: boolean;
        }>(
          {
            type: "trading:deploy-safe",
            address: ctx.address,
            walletMode: ctx.walletMode,
          },
          "Wallet deployment failed"
        )
      );

      update({
        state: "ready",
        isDeployed: true,
        proxyAddress: result.proxyAddress,
      });
      // Refresh so downstream UI (balances, allowances) reflects the new wallet.
      await this.refreshBalance();
      return {
        txHash: result.txHash,
        alreadyDeployed: result.alreadyDeployed,
      };
    } catch (err) {
      // "error" (not "ready" — the vault isn't deployed) so the wizard's
      // inline error branch and the error toast actually render; the next
      // "Create vault" click resets to "deploying" and clears the error.
      update({
        state: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  // ── USDC & Token Approvals (gasless via Relayer) ──

  async approveUsdc(
    _negRisk = false,
    approvalAmount?: number
  ): Promise<string> {
    if (!ctx.address) throw new Error("Wallet not connected");
    if (ctx.state === "approving") {
      throw new Error(
        "Approval already in progress — confirm the wallet prompt."
      );
    }

    update({ state: "approving", error: null });

    try {
      const result = await runWithAuthRetry(ctx.address, () =>
        sendMsg<{
          txHash: string;
          alreadyApproved?: boolean;
        }>(
          {
            type: "trading:relayer-approve",
            address: ctx.address,
            walletMode: ctx.walletMode,
            approvalAmount:
              approvalAmount && approvalAmount > 0
                ? String(approvalAmount)
                : undefined,
          },
          "Approval failed"
        )
      );

      // Refresh BEFORE flipping to "ready": callers re-render off
      // `getContext()`, and a "ready" state with the stale pre-approval
      // allowance re-renders a clickable Approve (double-submit window) until
      // the refreshed allowance lands.
      await this.refreshBalance();
      update({ state: "ready" });
      return result.txHash;
    } catch (err) {
      update({
        state: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  // ── Split (pUSD → YES + NO) ──

  async splitPosition(
    conditionId: string,
    amount: string,
    yesTokenId?: string,
    noTokenId?: string,
    negRisk = false
  ): Promise<unknown> {
    if (!ctx.address) throw new Error("Wallet not connected");

    update({ state: "splitting", error: null });

    try {
      const result = await runWithAuthRetry(ctx.address, () =>
        sendMsg(
          {
            type: "trading:split-position",
            conditionId,
            amount,
            address: ctx.address,
            negRisk,
            proxyAddress: ctx.proxyAddress ?? undefined,
            walletMode: ctx.walletMode,
            yesTokenId,
            noTokenId,
          },
          "Split failed"
        )
      );
      update({ state: "ready" });
      await this.refreshBalance();
      return result;
    } catch (err) {
      update({
        state: "ready",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  // ── Merge (YES + NO → pUSD) ──

  async mergePositions(
    conditionId: string,
    amount: string,
    yesTokenId?: string,
    noTokenId?: string,
    negRisk = false
  ): Promise<unknown> {
    if (!ctx.address) throw new Error("Wallet not connected");

    update({ state: "merging", error: null });

    try {
      const result = await runWithAuthRetry(ctx.address, () =>
        sendMsg(
          {
            type: "trading:merge-positions",
            conditionId,
            amount,
            address: ctx.address,
            negRisk,
            proxyAddress: ctx.proxyAddress ?? undefined,
            walletMode: ctx.walletMode,
            yesTokenId,
            noTokenId,
          },
          "Merge failed"
        )
      );
      update({ state: "ready" });
      await this.refreshBalance();
      return result;
    } catch (err) {
      update({
        state: "ready",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  // ── Outcome Token Balances ──

  async getOutcomeBalances(
    yesTokenId: string,
    noTokenId: string
  ): Promise<OutcomeBalances> {
    if (!ctx.proxyAddress) throw new Error("Proxy wallet not derived");
    return sendMsg(
      {
        type: "trading:get-outcome-balances",
        yesTokenId,
        noTokenId,
        ownerAddress: ctx.proxyAddress,
      },
      "Failed to get outcome balances"
    );
  },

  // ── State management ──

  resetToConnected(): void {
    if (ctx.address) {
      update({ state: "connected", error: null });
    }
  },

  reset(): void {
    latestContextOrderBookRequest = ++orderBookRequestSequence;
    ctx = createDisconnectedContext();
    consecutiveDegradedApprovalReads = 0;
    notify();
  },

  async disconnect(): Promise<void> {
    await sendMsg<null>({ type: "auth:logout" }, "Failed to disconnect wallet");
    await WalletBridge.disconnect().catch((err) => {
      log.warn("wallet.disconnect_failed", { error: err });
    });
    this.reset();
  },
};

let tradingServiceListenersInstalled = false;
let removeAccountsChangedListener: (() => void) | null = null;

const handleWalletAccountsChanged = (accounts: string[]): void => {
  void TradingService.handleExternalWalletAccountsChanged(accounts);
};

const handleTradingServiceMessage = (message: unknown): boolean => {
  const runtimeMessage = message as { type?: string } | undefined;
  if (runtimeMessage?.type !== TRADING_SESSION_DISCONNECTED_MESSAGE) {
    return false;
  }

  if (walletSwitchInProgress) {
    return false;
  }

  WalletBridge.resetAfterDisconnect();
  TradingService.reset();
  return false;
};

function disposeTradingServiceListeners(): void {
  if (!tradingServiceListenersInstalled) return;
  tradingServiceListenersInstalled = false;
  removeAccountsChangedListener?.();
  removeAccountsChangedListener = null;
  chrome.runtime.onMessage.removeListener(handleTradingServiceMessage);
}

export function installTradingServiceListeners(): () => void {
  if (tradingServiceListenersInstalled) {
    return disposeTradingServiceListeners;
  }
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) {
    return () => {};
  }

  tradingServiceListenersInstalled = true;
  removeAccountsChangedListener = WalletBridge.onAccountsChanged(
    handleWalletAccountsChanged
  );
  chrome.runtime.onMessage.addListener(handleTradingServiceMessage);
  return disposeTradingServiceListeners;
}
