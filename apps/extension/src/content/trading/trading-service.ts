/**
 * TradingService — orchestrates the full trading flow from the content script.
 *
 * Manages wallet connection, credential derivation, proxy wallet derivation,
 * balance queries, order book fetching, and order placement (limit + market).
 * Also supports split (pUSD→YES+NO) and merge (YES+NO→pUSD) operations.
 */

import { createLogger } from "@knoww/logger";
import type { ClobOrderType } from "@knoww/shared-types/polymarket";
import { POLYGON_CHAIN_ID_HEX } from "@knoww/shared-types/polymarket";
import type { OrderBook } from "@knoww/shared-types/slippage";

const log = createLogger("trading-service");

import {
  EXTENSION_AUTH_REQUIRED_ERROR,
  TRADING_SESSION_DISCONNECTED_MESSAGE,
} from "../../types/chrome-messages";
import { WalletBridge } from "./bridge";
import { type ApiKeyCreds, CredentialManager } from "./credentials";
import { ExtensionSession } from "./extension-session";
import { ProxyWallet } from "./proxy-wallet";

export type TradingState =
  | "disconnected"
  | "connecting"
  | "switching-chain"
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
  /**
   * On-chain Safe-deployment status.
   * `null` = not yet checked (initial state, or proxyAddress not derived yet).
   * `true`  = confirmed deployed.
   * `false` = confirmed absent — user needs to run the Deploy Safe flow.
   *
   * The null state lets the panel show a neutral loading spinner instead of
   * flashing the "Deploy Trading Wallet" button for ~500ms on first open
   * while `refreshBalance()` performs its `eth_getCode` check.
   */
  isDeployed: boolean | null;
  balance: number;
  polBalance: number;
  tokenBalances: TokenBalanceEntry[];
  credentials: ApiKeyCreds | null;
  error: string | null;
  orderBook: OrderBook | null;
  minOrderSize: number;
  tickSize: number;
  usdcAllowance: number;
  usdcAllowanceNegRisk: number;
}

type StateListener = (ctx: TradingContext) => void;

const listeners: StateListener[] = [];

function createDisconnectedContext(): TradingContext {
  return {
    state: "disconnected",
    address: null,
    proxyAddress: null,
    isDeployed: null,
    balance: 0,
    polBalance: 0,
    tokenBalances: [],
    credentials: null,
    error: null,
    orderBook: null,
    minOrderSize: 1,
    tickSize: 0.01,
    usdcAllowance: 0,
    usdcAllowanceNegRisk: 0,
  };
}

let ctx: TradingContext = createDisconnectedContext();

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
    return (await ExtensionSession.getToken()) !== null;
  },

  async connectWallet(walletUuid?: string): Promise<void> {
    update({ state: "connecting", error: null });

    try {
      const accounts = await WalletBridge.connect(walletUuid);

      if (!accounts || accounts.length === 0) {
        update({ state: "error", error: "No accounts returned" });
        return;
      }

      const address = accounts[0];
      update({ address });
      trackTradingAnalytics("wallet_connected", {
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

      update({ state: "connected" });

      try {
        const proxyAddress = await ProxyWallet.deriveAddress(address);
        update({ proxyAddress });
        try {
          const balData = await ProxyWallet.getBalance(proxyAddress);
          update({
            balance: balData.balance,
            polBalance: balData.polBalance ?? 0,
            tokenBalances: balData.tokenBalances ?? [],
            // Resolves the null→boolean transition so the panel can render
            // the Deploy Safe gate (or skip it) on first paint after connect.
            isDeployed: balData.isDeployed ?? false,
          });
        } catch (balErr) {
          log.warn("balance.fetch_failed", { proxyAddress, error: balErr });
          update({ balance: 0, polBalance: 0, tokenBalances: [] });
        }
      } catch (err) {
        log.warn("proxy.derive_failed", { error: err });
      }

      const cached = await CredentialManager.getStored(address);
      if (cached) {
        update({ credentials: cached, state: "ready" });
      } else {
        update({ state: "connected" });
      }
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

  async deriveCredentials(): Promise<void> {
    if (!ctx.address) {
      update({ state: "error", error: "Wallet not connected" });
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
        credentials: {
          apiKey: result.apiKey,
          apiSecret: result.apiSecret,
          apiPassphrase: result.apiPassphrase,
        },
        state: "ready",
      });
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
    if (ctx.state === "ready" && ctx.credentials) return true;
    if (!ctx.address) await this.connectWallet();
    if (ctx.state === "error") return false;
    if (!ctx.credentials) await this.deriveCredentials();
    return ctx.state === "ready";
  },

  async refreshBalance(): Promise<void> {
    if (!ctx.proxyAddress && ctx.address) {
      try {
        const proxyAddress = await ProxyWallet.deriveAddress(ctx.address);
        update({ proxyAddress });
      } catch (err) {
        log.warn("proxy.derive_failed_during_refresh", { error: err });
        return;
      }
    }
    if (!ctx.proxyAddress) return;
    try {
      const balData = await ProxyWallet.getBalance(ctx.proxyAddress);
      update({
        balance: balData.balance,
        polBalance: balData.polBalance ?? 0,
        tokenBalances: balData.tokenBalances ?? [],
        // Piggybacks on the balance fetch (background returns code presence
        // from the same provider). Keeps the UI in sync with on-chain Safe
        // deployment without an extra RPC round-trip.
        isDeployed: balData.isDeployed ?? ctx.isDeployed,
      });
    } catch (err) {
      log.warn("balance.refresh_failed", { error: err });
    }

    try {
      const [allowanceData, negRiskAllowanceData] = await Promise.all([
        sendMsg<{ allowance: number }>(
          {
            type: "trading:get-allowance",
            ownerAddress: ctx.proxyAddress,
            negRisk: false,
          },
          "Allowance check"
        ),
        sendMsg<{ allowance: number }>(
          {
            type: "trading:get-allowance",
            ownerAddress: ctx.proxyAddress,
            negRisk: true,
          },
          "NegRisk allowance check"
        ),
      ]);
      update({
        usdcAllowance: allowanceData.allowance,
        usdcAllowanceNegRisk: negRiskAllowanceData.allowance,
      });
    } catch {
      // Non-critical — don't block trading if allowance check fails
    }
  },

  // ── Order Book ──

  async fetchOrderBook(
    tokenId: string,
    options?: { syncContext?: boolean }
  ): Promise<OrderBook | null> {
    try {
      const data = await sendMsg<
        OrderBook & { min_order_size?: string; tick_size?: string }
      >(
        { type: "trading:get-orderbook", tokenId },
        "Failed to fetch order book"
      );
      if (options?.syncContext !== false) {
        const rawMin = parseFloat(data.min_order_size ?? "1");
        const minOrderSize = Math.max(
          1,
          Math.ceil(Number.isFinite(rawMin) ? rawMin : 1)
        );
        const rawTick = parseFloat(data.tick_size ?? "0.01");
        const tickSize =
          Number.isFinite(rawTick) && rawTick > 0 ? rawTick : 0.01;
        update({ orderBook: data, minOrderSize, tickSize });
      }
      return data;
    } catch {
      return null;
    }
  },

  // ── Place Order (Limit + Market) ──

  async placeOrder(params: {
    tokenId: string;
    outcomeIndex: number;
    side: "BUY" | "SELL";
    price: number;
    size: number;
    amount?: number;
    orderType?: ClobOrderType;
    expiration?: number;
    negRisk?: boolean;
  }): Promise<unknown> {
    if (!ctx.address || !ctx.proxyAddress || !ctx.credentials) {
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
            credentials: ctx.credentials,
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

  // ── Safe Deployment (gasless via Relayer) ──

  /**
   * Deploys the user's Polymarket Safe for new users who don't have one yet.
   * Resolves with the tx hash (or empty string if the Safe was already
   * deployed on-chain). On success, flips `ctx.isDeployed` and refreshes the
   * balance — so the trading panel can transition from "Deploy Wallet" to
   * "Approve pUSD" without manual refresh.
   */
  async deployWallet(): Promise<{ txHash: string; alreadyDeployed: boolean }> {
    if (!ctx.address) throw new Error("Wallet not connected");

    update({ state: "deploying", error: null });

    try {
      const result = await runWithAuthRetry(ctx.address, () =>
        sendMsg<{
          txHash: string;
          proxyAddress: string;
          alreadyDeployed: boolean;
        }>(
          { type: "trading:deploy-safe", address: ctx.address },
          "Wallet deployment failed"
        )
      );

      update({
        state: "ready",
        isDeployed: true,
        proxyAddress: result.proxyAddress,
      });
      // Refresh so downstream UI (balances, allowances) reflects the new Safe.
      await this.refreshBalance();
      return {
        txHash: result.txHash,
        alreadyDeployed: result.alreadyDeployed,
      };
    } catch (err) {
      update({
        state: "ready",
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
            approvalAmount:
              approvalAmount && approvalAmount > 0
                ? String(approvalAmount)
                : undefined,
          },
          "Approval failed"
        )
      );

      update({ state: "ready" });
      return result.txHash;
    } catch (err) {
      update({
        state: "ready",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  // ── Split (pUSD → YES + NO) ──

  async splitPosition(
    conditionId: string,
    amount: number,
    yesTokenId?: string,
    noTokenId?: string
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
            proxyAddress: ctx.proxyAddress ?? undefined,
            credentials: ctx.credentials ?? undefined,
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
    amount: number,
    yesTokenId?: string,
    noTokenId?: string
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
            proxyAddress: ctx.proxyAddress ?? undefined,
            credentials: ctx.credentials ?? undefined,
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
  ): Promise<{ yesBalance: number; noBalance: number; minBalance: number }> {
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
    ctx = createDisconnectedContext();
    notify();
  },

  async disconnect(): Promise<void> {
    await sendMsg<null>({ type: "auth:logout" }, "Failed to disconnect wallet");
    this.reset();
  },
};

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== TRADING_SESSION_DISCONNECTED_MESSAGE) {
      return false;
    }

    TradingService.reset();
    return false;
  });
}
