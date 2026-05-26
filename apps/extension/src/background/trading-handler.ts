/**
 * Trading Handler — processes trading-related messages in the offscreen document.
 * Uses the Polymarket unified SDK + a viem bridge wallet client for order operations.
 * Supports: limit (GTC/GTD), market (FAK/FOK), split, merge, and balance queries.
 */

import { logInfo, logWarn } from "@knoww/logger";
import {
  buildFullTradingApprovalTransactions,
  buildTradingApprovalTransactions,
  readErc20Allowance,
  readErc1155Approval,
  readPusdExchangeAllowance,
  readTradingApprovalStatus,
} from "@knoww/shared-types/approvals";
import {
  POLYGON_WALLET_TOKENS,
  readTradingWalletBalance,
} from "@knoww/shared-types/balances";
import { POLYGON_CHAIN } from "@knoww/shared-types/chains";
import {
  fetchClobBuilderFeeRates,
  fetchClobOrderBook,
} from "@knoww/shared-types/clob";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  CTF_APPROVAL_OPERATORS,
  NEG_RISK_ADAPTER_ADDRESS,
  PUSD_ADDRESS,
  PUSD_APPROVAL_TARGETS,
  PUSD_CTF_APPROVAL_TARGET,
  USDC_E_ADDRESS,
} from "@knoww/shared-types/contracts";
import {
  planCtfOperationTransaction,
  planCtfOperationTransactions,
  readCtfOutcomeBalances,
} from "@knoww/shared-types/ctf";
import {
  buildClobBalanceAllowanceTargets,
  buildClobL1Headers,
  type ClobBalanceAllowanceClient,
  type ClobBalanceAllowanceTarget,
  createOrDeriveClobApiKey,
  getClobPostOrderError,
  getPolymarketSignatureType,
  normalizeTradingWalletMode,
  POLYMARKET_API,
  syncClobBalanceAllowance,
} from "@knoww/shared-types/polymarket";
import {
  fetchUnifiedClobMarket,
  type LegacyClobOrderRequest,
} from "@knoww/shared-types/polymarket-unified";
import {
  derivePolymarketDepositWallet,
  derivePolymarketSafe,
  type RelayerTransaction,
} from "@knoww/shared-types/relayer";
import {
  buildClobOrderPreflightPlan,
  buildPusdAutoWrapTransactions,
  parseApprovalAmountRaw,
  planPusdAutoWrap,
} from "@knoww/shared-types/trading";
import {
  type Address,
  createPublicClient,
  erc20Abi,
  formatUnits,
  getAddress,
  type Hex,
  http,
  type WalletClient,
} from "viem";
import type {
  TradingDeploySafeMessage,
  TradingDeriveCredentialsMessage,
  TradingDeriveProxyAddressMessage,
  TradingErrorResponse,
  TradingGetAllAllowancesMessage,
  TradingGetAllowanceMessage,
  TradingGetBalanceMessage,
  TradingGetOrderBookMessage,
  TradingGetOrderPreflightMessage,
  TradingGetOrderPreflightResponse,
  TradingGetOutcomeBalancesMessage,
  TradingMergePositionsMessage,
  TradingPlaceOrderMessage,
  TradingRelayerApproveMessage,
  TradingSplitPositionMessage,
  TradingSuccessResponse,
  TradingWalletMode,
} from "../types/chrome-messages";
import {
  type BridgeWalletClient,
  createBridgeWalletClient,
} from "./bridge-signer";
import {
  deployDepositWallet,
  deployProxyWallet,
  executeViaDepositWallet,
  executeViaRelayer,
} from "./relayer-client";
import { setActiveTab } from "./signing-state";
import { createExtensionLegacyClobClient } from "./unified-clob-client";

const CLOB_HOST = POLYMARKET_API.CLOB.BASE;
const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";
const publicClient = createPublicClient({
  chain: POLYGON_CHAIN,
  transport: http(POLYGON_RPC),
});
const CLOB_INITIAL_CURSOR = "MA==";
const CLOB_END_CURSOR = "LTE=";

type TradingResponse = TradingSuccessResponse | TradingErrorResponse;
type ClobApiCredentials = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
};
type ClobOpenOrder = {
  side?: string;
  price?: string | number;
  original_size?: string | number;
  size_matched?: string | number;
};
type ExtensionLegacyClobClient = ClobBalanceAllowanceClient & {
  getOpenOrders(): Promise<unknown>;
  getClobMarketInfo(conditionId: string): Promise<unknown>;
  createMarketOrder(order: LegacyClobOrderRequest): Promise<unknown>;
  createOrder(
    order: LegacyClobOrderRequest & {
      price: number;
      size: number;
      expiration: number;
    },
    options?: unknown
  ): Promise<unknown>;
  postOrder(order: unknown, orderType?: string): Promise<unknown>;
};
// Memoize the public CLOB builder-fee endpoint per builder code. The rates
// are effectively static (set by Polymarket per builder), so caching for the
// lifetime of the offscreen document is safe and avoids one extra round-trip
// per debounced preflight call. Cached as the maker+taker pair so the
// preflight can pick the side-appropriate rate.
const builderFeeRatesCache = new Map<
  string,
  Promise<{ maker: number; taker: number }>
>();

function getBuilderFeeRates(
  builderCode: string
): Promise<{ maker: number; taker: number }> {
  const cached = builderFeeRatesCache.get(builderCode);
  if (cached) return cached;
  const pending = fetchClobBuilderFeeRates(builderCode, {
    host: CLOB_HOST,
  }).catch((err) => {
    // Don't poison the cache on a transient failure — let the next call retry.
    builderFeeRatesCache.delete(builderCode);
    throw err;
  });
  builderFeeRatesCache.set(builderCode, pending);
  return pending;
}

const unifiedMarketInfoClient = {
  getClobMarketInfo(conditionId: string) {
    return fetchUnifiedClobMarket(conditionId);
  },
};

function ok(data: unknown): TradingSuccessResponse {
  return { ok: true, data };
}

function fail(error: string): TradingErrorResponse {
  return { ok: false, error };
}

async function executeDirectTransactions(
  walletClient: BridgeWalletClient,
  transactions: Array<{ to: Address; data: Hex; value?: string }>
): Promise<{ txHash: string }> {
  let lastHash: Hex = "0x";
  for (const tx of transactions) {
    const hash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : undefined,
    });
    lastHash = hash;
    await publicClient.waitForTransactionReceipt({ hash });
  }
  return { txHash: lastHash };
}

function deriveTradingWalletAddress(
  ownerAddress: Address,
  walletMode?: TradingWalletMode
): Address {
  const mode = normalizeTradingWalletMode(walletMode);
  if (mode === "eoa") return ownerAddress;
  if (mode === "deposit") return derivePolymarketDepositWallet(ownerAddress);
  return derivePolymarketSafe(ownerAddress);
}

function deriveProxyAddressSync(
  eoaAddress: string,
  walletMode?: TradingWalletMode
): string {
  return deriveTradingWalletAddress(
    getAddress(eoaAddress) as Address,
    walletMode
  );
}

async function executeWalletModeTransactions(
  walletClient: BridgeWalletClient,
  ownerAddress: Address,
  walletMode: TradingWalletMode | undefined,
  transactions: RelayerTransaction[],
  walletAddress?: Address
): Promise<{ txHash: string }> {
  const mode = normalizeTradingWalletMode(walletMode);
  if (mode === "eoa") {
    return executeDirectTransactions(walletClient, transactions);
  }
  if (mode === "deposit") {
    return executeViaDepositWallet(
      walletClient,
      ownerAddress,
      transactions,
      walletAddress ?? derivePolymarketDepositWallet(ownerAddress)
    );
  }
  return executeViaRelayer(walletClient, ownerAddress, transactions);
}

export async function handleTradingMessage(
  message: { type: string; [key: string]: unknown },
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse | null> {
  const type = message.type as string;
  if (!type.startsWith("trading:")) return null;

  if (sender.tab?.id) {
    setActiveTab(sender.tab.id);
  }

  try {
    switch (type) {
      case "trading:derive-credentials":
        return await handleDeriveCredentials(
          message as unknown as TradingDeriveCredentialsMessage,
          sender
        );
      case "trading:get-balance":
        return await handleGetBalance(
          message as unknown as TradingGetBalanceMessage
        );
      case "trading:place-order":
        return await handlePlaceOrder(
          message as unknown as TradingPlaceOrderMessage,
          sender
        );
      case "trading:get-allowance":
        return await handleGetAllowance(
          message as unknown as TradingGetAllowanceMessage
        );
      case "trading:get-all-allowances":
        return await handleGetAllAllowances(
          message as unknown as TradingGetAllAllowancesMessage
        );
      case "trading:derive-proxy-address":
        return await handleDeriveProxyAddress(
          message as unknown as TradingDeriveProxyAddressMessage
        );
      case "trading:get-orderbook":
        return await handleGetOrderBook(
          message as unknown as TradingGetOrderBookMessage
        );
      case "trading:get-order-preflight":
        return await handleGetOrderPreflight(
          message as unknown as TradingGetOrderPreflightMessage
        );
      case "trading:split-position":
        return await handleSplitPosition(
          message as unknown as TradingSplitPositionMessage,
          sender
        );
      case "trading:merge-positions":
        return await handleMergePositions(
          message as unknown as TradingMergePositionsMessage,
          sender
        );
      case "trading:get-outcome-balances":
        return await handleGetOutcomeBalances(
          message as unknown as TradingGetOutcomeBalancesMessage
        );
      case "trading:relayer-approve":
        return await handleRelayerApprove(
          message as unknown as TradingRelayerApproveMessage,
          sender
        );
      case "trading:deploy-safe":
        return await handleDeploySafe(
          message as unknown as TradingDeploySafeMessage,
          sender
        );
      default:
        return fail(`Unknown trading message type: ${type}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(msg);
  }
}

// ── Derive Credentials ──

async function handleDeriveCredentials(
  msg: TradingDeriveCredentialsMessage,
  _sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const result = await createOrDeriveClobApiKey(CLOB_HOST, {
    ...buildClobL1Headers(msg),
  });

  if (!result.success || !result.data || !result.method) {
    return fail("Failed to derive CLOB API credentials");
  }

  return ok({
    ...result.data,
    method: result.method,
  });
}

// ── Balance ──

async function handleGetBalance(
  msg: TradingGetBalanceMessage
): Promise<TradingResponse> {
  const owner = getAddress(msg.proxyAddress) as Address;
  const balance = await readTradingWalletBalance(publicClient, owner, {
    tokens: POLYGON_WALLET_TOKENS,
    includeNative: true,
    includeDeployment: true,
  });

  return ok(balance);
}

// ── Place Order (Limit: GTC/GTD, Market: FAK/FOK) ──

async function handlePlaceOrder(
  msg: TradingPlaceOrderMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) return fail("No active tab for signing");

  const ownerAddress = getAddress(msg.address) as Address;
  const walletClient = createBridgeWalletClient(ownerAddress, tabId);

  const builderCode = process.env.POLY_BUILDER_CODE;
  const funderAddress =
    normalizeTradingWalletMode(msg.walletMode) === "eoa"
      ? ownerAddress
      : (getAddress(msg.proxyAddress) as Address);

  const client = (await createExtensionLegacyClobClient({
    walletClient: walletClient as unknown as WalletClient,
    funderAddress,
    credentials: msg.credentials,
    builderCode,
  })) as ExtensionLegacyClobClient;

  const orderType = msg.orderType || "GTC";
  const preflight = await buildClobOrderPreflightPlan({
    side: msg.side,
    orderType,
    amount: msg.amount,
    size: msg.size,
    price: msg.price,
    conditionId: msg.conditionId,
    marketInfoClient: client,
    builderCode,
    getBuilderFeeRates,
    isMarketableBuy: msg.isMarketableBuy,
    getOpenOrders: () => clobGetOpenOrders(msg.address, msg.credentials),
    onOpenOrdersError: (err) =>
      logWarn("trading.open-orders-fetch-failed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    onFeeError: (err) =>
      logWarn("trading.fee-info-fetch-failed", {
        conditionId: msg.conditionId,
        error: err instanceof Error ? err.message : String(err),
      }),
  });

  if (preflight.buy) {
    const requiredCollateralPusd = preflight.buy.requiredCollateralRaw;

    await ensurePusdSufficient(
      walletClient,
      funderAddress,
      preflight.buy.requiredPusdRaw,
      preflight.buy.reservedPusdRaw,
      preflight.buy.estimatedFeeRaw,
      msg.walletMode
    );

    const exchangeAllowance = await readPusdExchangeAllowance(
      publicClient,
      funderAddress,
      msg.negRisk,
      { fallbackRaw: 0n }
    );
    // CLOB V2 also pulls pUSD via the neg-risk adapter for neg-risk markets, so
    // verify that allowance up-front instead of relying on the server's misleading
    // "not enough balance / allowance" rejection.
    const adapterAllowance = msg.negRisk
      ? await readErc20Allowance(
          publicClient,
          funderAddress,
          NEG_RISK_ADAPTER_ADDRESS as Address,
          { fallbackRaw: 0n }
        )
      : requiredCollateralPusd;
    if (
      exchangeAllowance < requiredCollateralPusd ||
      adapterAllowance < requiredCollateralPusd
    ) {
      return fail(
        `Approval too low for this order. Approve at least ${formatUnits(requiredCollateralPusd, 6)} pUSD and retry.`
      );
    }
  }

  try {
    await syncClobBalanceAllowance(
      client as unknown as ClobBalanceAllowanceClient,
      { tokenId: msg.tokenId }
    );
    logInfo("trading.balance-updated", {
      tokenId: msg.tokenId,
      side: msg.side,
    });
  } catch (syncErr) {
    logWarn("trading.balance-update-failed", {
      tokenId: msg.tokenId,
      side: msg.side,
      error: syncErr instanceof Error ? syncErr.message : String(syncErr),
    });
  }

  if (preflight.isMarketOrder) {
    const marketAmount =
      msg.side === "SELL" ? msg.size : (msg.amount ?? msg.size);
    const marketOrder: LegacyClobOrderRequest = {
      tokenID: msg.tokenId,
      amount: marketAmount,
      side: msg.side,
      // feeRateBps removed (V2: protocol-determined at match time)
    };
    if (msg.price && msg.price > 0) {
      marketOrder.price = msg.price;
    }

    logInfo("trading.place-order.market-params", {
      side: msg.side,
      amount: marketAmount,
      price: marketOrder.price,
      msgSize: msg.size,
      msgAmount: msg.amount,
    });

    const order = await client.createMarketOrder(marketOrder);
    const response = await client.postOrder(order, orderType);

    const errorMsg = getClobPostOrderError(response);
    if (errorMsg) {
      return fail(`CLOB rejected order: ${errorMsg}`);
    }

    return ok(response);
  }

  logInfo("trading.place-order.limit-params", {
    tokenID: msg.tokenId,
    price: msg.price,
    size: msg.size,
    side: msg.side,
    orderType,
    expiration: orderType === "GTD" ? msg.expiration : 0,
    negRisk: !!msg.negRisk,
  });

  const order = await client.createOrder(
    {
      tokenID: msg.tokenId,
      price: msg.price,
      size: msg.size,
      side: msg.side,
      // feeRateBps removed (V2: protocol-determined at match time)
      expiration: orderType === "GTD" ? (msg.expiration ?? 0) : 0,
    },
    undefined
  );

  const signedOrder = order as Record<string, unknown>;
  logInfo("trading.place-order.signed", {
    tokenID: signedOrder.tokenId,
    side: signedOrder.side,
    size: signedOrder.size,
    price: signedOrder.price,
  });

  const response = await client.postOrder(order, orderType);

  logInfo("trading.place-order.clob-response", {
    txHash: (response as Record<string, unknown>)?.transactionHash,
    status: (response as Record<string, unknown>)?.status,
  });

  const errorMsg = getClobPostOrderError(response);
  if (errorMsg) {
    return fail(`CLOB rejected order: ${errorMsg}`);
  }

  return ok(response);
}

// ── Proxy Address ──

async function handleDeriveProxyAddress(
  msg: TradingDeriveProxyAddressMessage
): Promise<TradingResponse> {
  const owner = getAddress(msg.eoaAddress) as Address;
  const proxyAddress = deriveTradingWalletAddress(owner, msg.walletMode);

  const code = await publicClient.getBytecode({ address: proxyAddress });
  return ok({ proxyAddress, isDeployed: !!code && code !== "0x" });
}

// ── Allowance ──

async function handleGetAllowance(
  msg: TradingGetAllowanceMessage
): Promise<TradingResponse> {
  const owner = getAddress(msg.ownerAddress) as Address;
  const exchangeAllowance = await readPusdExchangeAllowance(
    publicClient,
    owner,
    msg.negRisk,
    { fallbackRaw: 0n }
  );
  // For neg-risk markets, CLOB V2 also pulls pUSD via the neg-risk adapter, so
  // the binding allowance is min(exchange, adapter). Reporting the minimum keeps
  // the trading panel's approval CTA in sync with what the order pre-flight
  // requires.
  const adapterAllowance = msg.negRisk
    ? await readErc20Allowance(
        publicClient,
        owner,
        NEG_RISK_ADAPTER_ADDRESS as Address,
        { fallbackRaw: 0n }
      )
    : exchangeAllowance;
  const allowance =
    exchangeAllowance < adapterAllowance ? exchangeAllowance : adapterAllowance;
  return ok({
    allowance: Number(formatUnits(allowance, 6)),
    allowanceRaw: allowance.toString(),
  });
}

// ── All Allowances ──

async function handleGetAllAllowances(
  msg: TradingGetAllAllowancesMessage
): Promise<TradingResponse> {
  const owner = getAddress(msg.ownerAddress) as Address;
  const pusdSpenders = [...PUSD_APPROVAL_TARGETS];
  const erc1155Operators = [...CTF_APPROVAL_OPERATORS];

  const allowances: Record<string, number> = {};

  const [pusdCtf, usdcOnramp, pusdResults, erc1155Results] = await Promise.all([
    readErc20Allowance(
      publicClient,
      owner,
      PUSD_CTF_APPROVAL_TARGET as Address,
      {
        fallbackRaw: 0n,
      }
    ),
    readErc20Allowance(
      publicClient,
      owner,
      COLLATERAL_ONRAMP_ADDRESS as Address,
      { token: USDC_E_ADDRESS as Address, fallbackRaw: 0n }
    ),
    Promise.all(
      pusdSpenders.map((spender) =>
        readErc20Allowance(publicClient, owner, spender as Address, {
          fallbackRaw: 0n,
        })
      )
    ),
    Promise.all(
      erc1155Operators.map((operator) =>
        readErc1155Approval(publicClient, owner, operator as Address, {
          fallbackApproved: false,
        })
      )
    ),
  ]);

  allowances[`pusd:${PUSD_CTF_APPROVAL_TARGET}`] = Number(
    formatUnits(pusdCtf, 6)
  );
  allowances[`usdce:${COLLATERAL_ONRAMP_ADDRESS}`] = Number(
    formatUnits(usdcOnramp, 6)
  );
  for (let i = 0; i < pusdSpenders.length; i++) {
    allowances[`pusd:${pusdSpenders[i]}`] = Number(
      formatUnits(pusdResults[i], 6)
    );
  }
  for (let i = 0; i < erc1155Operators.length; i++) {
    allowances[`erc1155:${erc1155Operators[i]}`] = erc1155Results[i] ? 1 : 0;
  }

  return ok({ allowances });
}

// ── Order Book ──

async function handleGetOrderBook(
  msg: TradingGetOrderBookMessage
): Promise<TradingResponse> {
  try {
    return ok(await fetchClobOrderBook(msg.tokenId, { host: CLOB_HOST }));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

async function handleGetOrderPreflight(
  msg: TradingGetOrderPreflightMessage
): Promise<TradingResponse> {
  // Mirror handlePlaceOrder's builder fee schedule so the fee preview matches
  // the authoritative pre-flight performed before posting.
  const builderCode = process.env.POLY_BUILDER_CODE;
  const preflight = await buildClobOrderPreflightPlan({
    side: msg.side,
    orderType: msg.orderType || "GTC",
    amount: msg.amount,
    size: msg.size,
    price: msg.price,
    conditionId: msg.conditionId,
    marketInfoClient: unifiedMarketInfoClient,
    builderCode,
    getBuilderFeeRates,
    isMarketableBuy: msg.isMarketableBuy,
    onFeeError: (err) =>
      logWarn("trading.preflight-fee-info-fetch-failed", {
        conditionId: msg.conditionId,
        error: err instanceof Error ? err.message : String(err),
      }),
  });

  const response: TradingGetOrderPreflightResponse = {
    isMarketOrder: preflight.isMarketOrder,
    requiredCollateralRaw:
      preflight.buy?.requiredCollateralRaw.toString() ?? "0",
    requiredPusdRaw: preflight.buy?.requiredPusdRaw.toString() ?? "0",
    estimatedFeeRaw: preflight.buy?.estimatedFeeRaw?.toString() ?? null,
  };
  return ok(response);
}

// ── Post-split/merge: tell the CLOB about updated on-chain balances ──
// Uses direct HTTP + HMAC auth to avoid any wallet/signer interaction.

async function buildHmacHeaders(
  address: string,
  creds: ClobApiCredentials,
  method: string,
  requestPath: string,
  body?: string
): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000);
  // Polymarket signs the canonical path and optional body only; query params
  // are intentionally excluded from the HMAC message.
  const message = `${ts}${method}${requestPath}${body ?? ""}`;
  const keyData = base64ToArrayBuffer(creds.apiSecret);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await globalThis.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message)
  );
  const sig = arrayBufferToBase64(sigBuf)
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: sig,
    POLY_TIMESTAMP: String(ts),
    POLY_API_KEY: creds.apiKey,
    POLY_PASSPHRASE: creds.apiPassphrase,
  };
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const s = b64
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function clobGetOpenOrders(
  address: string,
  creds: ClobApiCredentials,
  filters?: { market?: string; assetId?: string }
): Promise<ClobOpenOrder[]> {
  const endpoint = "/data/orders";
  const headers = await buildHmacHeaders(address, creds, "GET", endpoint);
  const results: ClobOpenOrder[] = [];
  let nextCursor = CLOB_INITIAL_CURSOR;

  while (nextCursor !== CLOB_END_CURSOR) {
    const params = new URLSearchParams({ next_cursor: nextCursor });
    if (filters?.market) params.set("market", filters.market);
    if (filters?.assetId) params.set("asset_id", filters.assetId);
    const res = await fetch(`${CLOB_HOST}${endpoint}?${params}`, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch open orders: ${res.status}`);
    }

    const payload = (await res.json()) as {
      data?: unknown;
      error?: unknown;
      next_cursor?: unknown;
    };
    if (payload.error) {
      throw new Error(String(payload.error));
    }
    if (Array.isArray(payload.data)) {
      results.push(...(payload.data as ClobOpenOrder[]));
    }

    const next =
      typeof payload.next_cursor === "string"
        ? payload.next_cursor
        : CLOB_END_CURSOR;
    if (next === nextCursor) break;
    nextCursor = next;
  }

  return results;
}

async function clobUpdateBalanceAllowance(
  address: string,
  creds: ClobApiCredentials,
  target: ClobBalanceAllowanceTarget,
  signatureType: number = getPolymarketSignatureType()
): Promise<void> {
  const endpoint = "/balance-allowance/update";
  const headers = await buildHmacHeaders(address, creds, "GET", endpoint);
  const params = new URLSearchParams({
    asset_type: target.asset_type,
    signature_type: String(signatureType),
  });
  if (target.token_id) params.set("token_id", target.token_id);
  const res = await fetch(`${CLOB_HOST}${endpoint}?${params}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    throw new Error(`Failed to update balance allowance: ${res.status}`);
  }
}

async function syncBalancesAfterCTF(msg: {
  address: string;
  conditionId: string;
  credentials?: { apiKey: string; apiSecret: string; apiPassphrase: string };
  proxyAddress?: string;
  walletMode?: TradingWalletMode;
  yesTokenId?: string;
  noTokenId?: string;
}): Promise<void> {
  if (!msg.credentials || !msg.proxyAddress) return;

  const signatureType: number = getPolymarketSignatureType(msg.walletMode);
  for (const target of buildClobBalanceAllowanceTargets({
    tokenIds: [msg.yesTokenId, msg.noTokenId],
  })) {
    await clobUpdateBalanceAllowance(
      msg.address,
      msg.credentials,
      target,
      signatureType
    );
  }
  logInfo("trading.ctf-balance-synced", {
    conditionId: msg.conditionId,
    address: msg.address,
  });
}

// ── Split Position (pUSD → YES + NO) via Relayer (gasless) ──

async function handleSplitPosition(
  msg: TradingSplitPositionMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) return fail("No active tab for signing");

  const ownerAddress = getAddress(msg.address) as Address;
  const walletClient = createBridgeWalletClient(ownerAddress, tabId);

  const walletMode = normalizeTradingWalletMode(msg.walletMode);
  const proxyAddress =
    walletMode === "eoa"
      ? ownerAddress
      : (getAddress(
          msg.proxyAddress ?? deriveProxyAddressSync(msg.address, walletMode)
        ) as Address);
  const plan = await planCtfOperationTransactions({
    operation: "splitPosition",
    conditionId: msg.conditionId,
    amount: String(msg.amount),
    negRisk: msg.negRisk,
    client: publicClient,
    collateralOwner: getAddress(proxyAddress) as Address,
    fallbackToApproval: true,
  });
  if (plan.approvalTransaction) {
    await executeWalletModeTransactions(
      walletClient,
      ownerAddress,
      walletMode,
      [plan.approvalTransaction],
      proxyAddress
    );
  }

  const result = await executeWalletModeTransactions(
    walletClient,
    ownerAddress,
    walletMode,
    [plan.transaction],
    proxyAddress
  );

  syncBalancesAfterCTF(msg).catch((e) =>
    logWarn("trading.ctf-post-sync-failed", {
      kind: "split",
      error: e instanceof Error ? e.message : String(e),
    })
  );

  return ok({ txHash: result.txHash, success: true });
}

// ── Merge Positions (YES + NO → pUSD) via Relayer (gasless) ──

async function handleMergePositions(
  msg: TradingMergePositionsMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) return fail("No active tab for signing");

  const ownerAddress = getAddress(msg.address) as Address;
  const walletClient = createBridgeWalletClient(ownerAddress, tabId);
  const walletMode = normalizeTradingWalletMode(msg.walletMode);
  const proxyAddress =
    walletMode === "eoa"
      ? ownerAddress
      : (getAddress(
          msg.proxyAddress ?? deriveProxyAddressSync(msg.address, walletMode)
        ) as Address);

  const plan = planCtfOperationTransaction({
    operation: "mergePositions",
    conditionId: msg.conditionId,
    amount: String(msg.amount),
    negRisk: msg.negRisk,
  });

  const result = await executeWalletModeTransactions(
    walletClient,
    ownerAddress,
    walletMode,
    [plan.transaction],
    proxyAddress
  );

  syncBalancesAfterCTF(msg).catch((e) =>
    logWarn("trading.ctf-post-sync-failed", {
      kind: "merge",
      error: e instanceof Error ? e.message : String(e),
    })
  );

  return ok({ txHash: result.txHash, success: true });
}

// ── Gasless Trading Wallet Deployment via Relayer ──

/**
 * Deploys the user's selected Polymarket trading wallet. Invoked from the
 * content script when the trading panel detects
 * `isDeployed === false` on an authenticated wallet.
 */
async function handleDeploySafe(
  msg: TradingDeploySafeMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const ownerAddress = getAddress(msg.address) as Address;
  const walletMode = normalizeTradingWalletMode(msg.walletMode);

  logInfo("trading.deploy-wallet.submit", {
    address: msg.address,
    walletMode,
  });
  try {
    if (walletMode === "eoa") {
      return ok({
        txHash: "",
        proxyAddress: ownerAddress,
        alreadyDeployed: true,
      });
    }

    if (walletMode === "deposit") {
      const result = await deployDepositWallet(ownerAddress);
      return ok({
        txHash: result.txHash,
        proxyAddress: result.proxyAddress,
        alreadyDeployed: result.alreadyDeployed ?? false,
      });
    }

    const tabId = sender.tab?.id;
    if (!tabId) return fail("No active tab for signing");
    const result = await deployProxyWallet(
      createBridgeWalletClient(ownerAddress, tabId),
      ownerAddress
    );
    return ok({
      txHash: result.txHash,
      proxyAddress: result.proxyAddress,
      alreadyDeployed: result.alreadyDeployed ?? false,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return fail(errMsg);
  }
}

// ── Gasless Approvals via Relayer ──

async function handleRelayerApprove(
  msg: TradingRelayerApproveMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) return fail("No active tab for signing");

  const ownerAddress = getAddress(msg.address) as Address;
  const walletClient = createBridgeWalletClient(ownerAddress, tabId);

  // Floor the approval amount at the default. Callers (e.g. the trading panel's
  // "Approve pUSD" CTA) pass the visible order cost, but the place-order
  // pre-flight requires allowance against the fee-inclusive collateral, so
  // approving exactly the cost would still fail. Mirrors the web's behaviour
  // (use-clob-client.ts: max(requiredPusdRaw, DEFAULT_TRADING_APPROVAL_RAW)).
  const requestedApprovalAmount = parseApprovalAmountRaw(msg.approvalAmount);
  const defaultApprovalAmount = parseApprovalAmountRaw();
  const approvalAmount =
    requestedApprovalAmount > defaultApprovalAmount
      ? requestedApprovalAmount
      : defaultApprovalAmount;
  const walletMode = normalizeTradingWalletMode(msg.walletMode);
  const proxyAddress =
    walletMode === "eoa"
      ? ownerAddress
      : (getAddress(
          deriveProxyAddressSync(msg.address, walletMode)
        ) as Address);

  const txns = await readTradingApprovalStatus(
    publicClient,
    getAddress(proxyAddress) as Address,
    { approvalAmountRaw: approvalAmount }
  )
    .then((status) => buildTradingApprovalTransactions(status, approvalAmount))
    .catch(() => buildFullTradingApprovalTransactions(approvalAmount));

  if (txns.length === 0) {
    return ok({ txHash: "", alreadyApproved: true });
  }

  logInfo("trading.approve.submit", { txnCount: txns.length, walletMode });
  const result = await executeWalletModeTransactions(
    walletClient,
    ownerAddress,
    walletMode,
    txns,
    proxyAddress
  );
  return ok({ txHash: result.txHash, success: true });
}

async function ensurePusdSufficient(
  walletClient: BridgeWalletClient,
  proxyAddress: string,
  requiredPusd: bigint,
  reservedPusd: bigint = 0n,
  estimatedFee: bigint | null = null,
  walletMode?: TradingWalletMode
): Promise<void> {
  const owner = getAddress(proxyAddress) as Address;
  const [pusdBalanceOnChain, usdcBalance] = await Promise.all([
    publicClient.readContract({
      address: PUSD_ADDRESS as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    }),
    publicClient.readContract({
      address: USDC_E_ADDRESS as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    }),
  ]);

  const wrapPlan = planPusdAutoWrap({
    pusdBalanceRaw: pusdBalanceOnChain,
    usdcEBalanceRaw: usdcBalance,
    requiredPusdRaw: requiredPusd,
    reservedPusdRaw: reservedPusd,
    estimatedFeeRaw: estimatedFee,
  });

  if (!wrapPlan.needsWrap) return;

  if (!wrapPlan.hasEnoughBaseCollateral) {
    throw new Error(
      `Insufficient collateral: need ${wrapPlan.baseShortfallRaw.toString()} more pUSD (or USDC.e to wrap), have ${wrapPlan.availablePusdRaw.toString()} pUSD + ${usdcBalance.toString()} USDC.e`
    );
  }

  const txns = buildPusdAutoWrapTransactions(owner, wrapPlan.wrapAmountRaw);

  await executeWalletModeTransactions(
    walletClient,
    getAddress(walletClient.account.address) as Address,
    walletMode,
    txns,
    owner
  );

  logInfo("trading.auto-wrap", { wrapped: wrapPlan.wrapAmountRaw.toString() });
}

// ── Outcome Token Balances ──

async function handleGetOutcomeBalances(
  msg: TradingGetOutcomeBalancesMessage
): Promise<TradingResponse> {
  const owner = getAddress(msg.ownerAddress) as Address;
  const balances = await readCtfOutcomeBalances(
    publicClient,
    owner,
    msg.yesTokenId,
    msg.noTokenId
  );

  const yesBalance = Number(formatUnits(balances.yesBalance, 6));
  const noBalance = Number(formatUnits(balances.noBalance, 6));
  return ok({
    yesBalance,
    noBalance,
    minBalance: Number(formatUnits(balances.minBalance, 6)),
  });
}
