/**
 * TradingService — orchestrates the full trading flow from the content script.
 *
 * Manages wallet connection, credential derivation, proxy wallet derivation,
 * balance queries, order book fetching, and order placement (limit + market).
 * Also supports split (USDC→YES+NO) and merge (YES+NO→USDC) operations.
 */

import type { ClobOrderType } from "@knoww/shared-types/polymarket";
import { POLYGON_CHAIN_ID_HEX } from "@knoww/shared-types/polymarket";
import type { OrderBook } from "@knoww/shared-types/slippage";
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
  isDeployed: boolean;
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

let ctx: TradingContext = {
  state: "disconnected",
  address: null,
  proxyAddress: null,
  isDeployed: false,
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

      update({ state: "switching-chain" });
      try {
        const chainId = await WalletBridge.getChainId();
        if (chainId !== POLYGON_CHAIN_ID_HEX) {
          await WalletBridge.switchChain(POLYGON_CHAIN_ID_HEX);
        }
      } catch (err) {
        console.warn("[TradingService] Chain switch failed:", err);
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
          });
        } catch (balErr) {
          console.warn(
            "[TradingService] Balance fetch failed for proxy",
            proxyAddress,
            ":",
            balErr
          );
          update({ balance: 0, polBalance: 0, tokenBalances: [] });
        }
      } catch (err) {
        console.warn("[TradingService] Proxy derivation failed:", err);
      }

      const cached = await CredentialManager.getStored(address);
      if (cached) {
        update({ credentials: cached, state: "ready" });
      } else {
        update({ state: "connected" });
      }
    } catch (err) {
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

    try {
      const creds = await CredentialManager.derive(ctx.address);
      update({ credentials: creds, state: "ready" });
    } catch (err) {
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
        console.warn(
          "[TradingService] Proxy derivation failed during refresh:",
          err
        );
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
      });
    } catch (err) {
      console.warn("[TradingService] Balance fetch failed:", err);
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

  async fetchOrderBook(tokenId: string): Promise<OrderBook | null> {
    try {
      const data = await sendMsg<
        OrderBook & { min_order_size?: string; tick_size?: string }
      >(
        { type: "trading:get-orderbook", tokenId },
        "Failed to fetch order book"
      );
      const rawMin = parseFloat(data.min_order_size ?? "1");
      const minOrderSize = Math.max(
        1,
        Math.ceil(Number.isFinite(rawMin) ? rawMin : 1)
      );
      const rawTick = parseFloat(data.tick_size ?? "0.01");
      const tickSize = Number.isFinite(rawTick) && rawTick > 0 ? rawTick : 0.01;
      update({ orderBook: data, minOrderSize, tickSize });
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
      await ExtensionSession.ensureAuthorized(ctx.address);

      const result = await sendMsg(
        {
          type: "trading:place-order",
          ...params,
          address: ctx.address,
          proxyAddress: ctx.proxyAddress,
          credentials: ctx.credentials,
        },
        "Order failed"
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

  // ── USDC & Token Approvals (gasless via Relayer) ──

  async approveUsdc(_negRisk = false): Promise<string> {
    if (!ctx.address) throw new Error("Wallet not connected");

    update({ state: "approving", error: null });

    try {
      const result = await sendMsg<{
        txHash: string;
        alreadyApproved?: boolean;
      }>(
        { type: "trading:relayer-approve", address: ctx.address },
        "Approval failed"
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

  // ── Split (USDC → YES + NO) ──

  async splitPosition(
    conditionId: string,
    amount: number,
    yesTokenId?: string,
    noTokenId?: string
  ): Promise<unknown> {
    if (!ctx.address) throw new Error("Wallet not connected");

    update({ state: "splitting", error: null });

    try {
      const result = await sendMsg(
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

  // ── Merge (YES + NO → USDC) ──

  async mergePositions(
    conditionId: string,
    amount: number,
    yesTokenId?: string,
    noTokenId?: string
  ): Promise<unknown> {
    if (!ctx.address) throw new Error("Wallet not connected");

    update({ state: "merging", error: null });

    try {
      const result = await sendMsg(
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
    ctx = {
      state: "disconnected",
      address: null,
      proxyAddress: null,
      isDeployed: false,
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
    notify();
  },
};
