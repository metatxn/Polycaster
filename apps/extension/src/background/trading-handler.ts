/**
 * Trading Handler — processes trading-related messages in the offscreen document.
 * Uses the Polymarket unified SDK + a viem bridge wallet client for order operations.
 * Supports: limit (GTC/GTD), market (FAK/FOK), split, merge, and balance queries.
 */

import { logInfo, logWarn } from "@knoww/logger";
import {
  buildFullTradingApprovalTransactions,
  buildTradingApprovalTransactions,
  readClobOrderPusdAllowance,
  readErc20Allowance,
  readErc1155Approval,
  readTradingApprovalStatus,
} from "@knoww/shared-types/approvals";
import {
  POLYGON_WALLET_TOKENS,
  readTradingWalletBalance,
} from "@knoww/shared-types/balances";
import { POLYGON_CHAIN } from "@knoww/shared-types/chains";
import {
  fetchClobBuilderFeeRates,
  fetchClobMarketInfo,
  fetchClobOrderBook,
} from "@knoww/shared-types/clob";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  CTF_APPROVAL_OPERATORS,
  PUSD_ADDRESS,
  PUSD_APPROVAL_TARGETS,
  PUSD_CTF_APPROVAL_TARGET,
  USDC_E_ADDRESS,
} from "@knoww/shared-types/contracts";
import {
  planCtfOperationTransactions,
  readCtfOutcomeBalances,
} from "@knoww/shared-types/ctf";
import {
  buildClobL1Headers,
  type ClobBalanceAllowanceClient,
  createOrDeriveClobApiKey,
  getClobPostOrderError,
  POLYMARKET_API,
  postClobOrderWithRetry,
  syncClobBalanceAllowance,
} from "@knoww/shared-types/polymarket";
import type { LegacyClobOrderRequest } from "@knoww/shared-types/polymarket-unified";
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
import { normalizeExtensionTradingWalletMode } from "../content/trading/setup-gates";
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
import { createL2ClobClient } from "./clob-open-orders";
import {
  deployDepositWallet,
  deployProxyWallet,
  executeViaDepositWallet,
  executeViaRelayer,
  isRelayerWalletDeployed,
} from "./relayer-client";
import { setActiveTab } from "./signing-state";
import { createExtensionLegacyClobClient } from "./unified-clob-client";
import { formatUsd6 } from "./usd-format";

const CLOB_HOST = POLYMARKET_API.CLOB.BASE;
const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";
const publicClient = createPublicClient({
  chain: POLYGON_CHAIN,
  transport: http(POLYGON_RPC),
});

type TradingResponse = TradingSuccessResponse | TradingErrorResponse;
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

// Fee estimation reads `/clob-markets/{conditionId}`, not `/markets/…` — only
// the former carries the `fd` protocol-fee curve. This used to call
// `fetchClobMarket`, which meant `parseProtocolFeeDetails` found no `fd` and
// quietly returned a zero protocol fee on every pre-flight.
const unifiedMarketInfoClient = {
  getClobMarketInfo(conditionId: string) {
    return fetchClobMarketInfo(conditionId, { host: CLOB_HOST });
  },
};

function ok(data: unknown): TradingSuccessResponse {
  return { ok: true, data };
}

function fail(error: string): TradingErrorResponse {
  return { ok: false, error };
}

function postExtensionClobOrder(
  client: ExtensionLegacyClobClient,
  order: unknown,
  orderType: string
): Promise<unknown> {
  return postClobOrderWithRetry(() => client.postOrder(order, orderType), {
    onRetry: ({ attempt, error }) =>
      logWarn("trading.place-order.retry", {
        attempt,
        error,
        orderType,
      }),
  });
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
  const mode = normalizeExtensionTradingWalletMode(walletMode);
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
  const mode = normalizeExtensionTradingWalletMode(walletMode);
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

  // Return the derived credentials to the SW, which persists them in its
  // session store and relays a content-safe, method-only response. The
  // offscreen document cannot write the TRUSTED_CONTEXTS-only session store.
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

  // Credentials are injected by the SW (never sent by the content caller).
  const credentials = msg.credentials;
  if (!credentials) {
    return fail("CLOB credentials not found. Enable trading for this wallet.");
  }

  const ownerAddress = getAddress(msg.address) as Address;
  const walletClient = createBridgeWalletClient(ownerAddress, tabId);

  const builderCode = process.env.POLY_BUILDER_CODE;
  const walletMode = normalizeExtensionTradingWalletMode(msg.walletMode);
  const funderAddress =
    walletMode === "eoa"
      ? ownerAddress
      : (getAddress(msg.proxyAddress) as Address);

  const client = (await createExtensionLegacyClobClient({
    walletClient: walletClient as unknown as WalletClient,
    funderAddress,
    credentials,
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
    // The secure client above is already authenticated for this account, so the
    // preflight reuses it instead of opening a second hand-signed CLOB session.
    getOpenOrders: () => client.getOpenOrders(),
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

    // CLOB V2 also pulls pUSD via the neg-risk adapter for neg-risk markets;
    // the shared reader owns the min(exchange, adapter) rule, so verify the
    // effective allowance up-front instead of relying on the server's
    // misleading "not enough balance / allowance" rejection.
    const orderAllowance = await readClobOrderPusdAllowance(
      publicClient,
      funderAddress,
      msg.negRisk,
      { fallbackRaw: 0n }
    );
    if (orderAllowance < requiredCollateralPusd) {
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
      tokenId: msg.tokenId,
      amount: marketAmount,
      side: msg.side,
      // feeRateBps removed (V2: protocol-determined at match time)
      // FAK/FOK is signed into the order at creation time in V2; it is no
      // longer a postOrder argument.
      orderType,
    };
    if (msg.price && msg.price > 0) {
      marketOrder.price = msg.price;
    }
    // No `maxSpend`: the SDK's default is to sign the full `amount` and charge
    // fees on top, which is what the panel quotes and what the collateral
    // preflight reserves. Passing `maxSpend === amount` instead shrinks the
    // signed `makerAmount` below the entered amount on every BUY, and the
    // CLOB's `min size: 1` floor is checked against that reduced number — so
    // small tickets on cheap outcomes were rejected.

    logInfo("trading.place-order.market-params", {
      side: msg.side,
      amount: marketAmount,
      price: marketOrder.price,
      orderType,
      msgSize: msg.size,
      msgAmount: msg.amount,
    });

    const order = await client.createMarketOrder(marketOrder);
    const response = await postExtensionClobOrder(client, order, orderType);

    const errorMsg = getClobPostOrderError(response);
    if (errorMsg) {
      return fail(`CLOB rejected order: ${errorMsg}`);
    }

    return ok(response);
  }

  logInfo("trading.place-order.limit-params", {
    tokenId: msg.tokenId,
    price: msg.price,
    size: msg.size,
    side: msg.side,
    orderType,
    expiration: orderType === "GTD" ? msg.expiration : 0,
    negRisk: !!msg.negRisk,
  });

  const order = await client.createOrder(
    {
      tokenId: msg.tokenId,
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
    tokenId: signedOrder.tokenId,
    side: signedOrder.side,
    size: signedOrder.size,
    price: signedOrder.price,
  });

  const response = await postExtensionClobOrder(client, order, orderType);

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
  const walletMode = normalizeExtensionTradingWalletMode(msg.walletMode);
  const proxyAddress = deriveTradingWalletAddress(owner, walletMode);

  const code = await publicClient.getBytecode({ address: proxyAddress });
  let isDeployed = !!code && code !== "0x";
  if (
    !isDeployed &&
    walletMode !== "eoa" &&
    msg.skipRelayerDeploymentFallback !== true
  ) {
    const walletType = walletMode === "safe" ? "SAFE" : "WALLET";
    try {
      isDeployed = await isRelayerWalletDeployed(proxyAddress, walletType);
    } catch (error) {
      logWarn("relayer.deployment-status-fallback.failed", {
        proxyAddress,
        walletType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return ok({ proxyAddress, isDeployed });
}

// ── Allowance ──

async function handleGetAllowance(
  msg: TradingGetAllowanceMessage
): Promise<TradingResponse> {
  const owner = getAddress(msg.ownerAddress) as Address;
  // min(exchange, adapter-if-negrisk) — the shared reader owns the rule and
  // runs the two reads in parallel.
  const allowance = await readClobOrderPusdAllowance(
    publicClient,
    owner,
    msg.negRisk,
    { fallbackRaw: 0n }
  );
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
  const degradedKeys: string[] = [];

  // Per-read fallbacks ride the shared helpers' error path (fallbackRaw /
  // fallbackApproved) — onFallback records the failed key for the degraded
  // signal without duplicating the catch-and-default logic locally.
  const readAllowanceOrZero = (
    key: string,
    spender: Address,
    options: { token?: Address } = {}
  ): Promise<bigint> =>
    readErc20Allowance(publicClient, owner, spender, {
      ...options,
      fallbackRaw: 0n,
      onFallback: (err) => {
        degradedKeys.push(key);
        logWarn("trading.allowance-read-degraded", { spender, error: err });
      },
    });

  const readApprovalOrFalse = (
    key: string,
    operator: Address
  ): Promise<boolean> =>
    readErc1155Approval(publicClient, owner, operator, {
      fallbackApproved: false,
      onFallback: (err) => {
        degradedKeys.push(key);
        logWarn("trading.erc1155-approval-read-degraded", {
          operator,
          error: err,
        });
      },
    });

  const [pusdCtf, usdcOnramp, pusdResults, erc1155Results] = await Promise.all([
    readAllowanceOrZero(
      `pusd:${PUSD_CTF_APPROVAL_TARGET}`,
      PUSD_CTF_APPROVAL_TARGET as Address
    ),
    readAllowanceOrZero(
      `usdce:${COLLATERAL_ONRAMP_ADDRESS}`,
      COLLATERAL_ONRAMP_ADDRESS as Address,
      {
        token: USDC_E_ADDRESS as Address,
      }
    ),
    Promise.all(
      pusdSpenders.map((spender) =>
        readAllowanceOrZero(`pusd:${spender}`, spender as Address)
      )
    ),
    Promise.all(
      erc1155Operators.map((operator) =>
        readApprovalOrFalse(`erc1155:${operator}`, operator as Address)
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

  return ok({
    allowances,
    degraded: degradedKeys.length > 0,
    degradedKeys,
  });
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
// Goes through the SDK's HMAC-authenticated `/balance-allowance/update`, which
// needs no wallet interaction — see `createL2ClobClient`.

async function syncBalancesAfterCTF(msg: {
  address: string;
  conditionId: string;
  credentials?: { apiKey: string; apiSecret: string; apiPassphrase: string };
  proxyAddress?: string;
  walletMode?: TradingWalletMode;
  yesTokenId?: string;
  noTokenId?: string;
}): Promise<void> {
  // Credentials are injected by the SW (never sent by the content caller).
  if (!msg.credentials || !msg.proxyAddress) return;

  const walletMode = normalizeExtensionTradingWalletMode(msg.walletMode);
  // The funder decides the `signature_type` the SDK sends, so the balances that
  // just moved on-chain are the ones the CLOB re-reads.
  const client = await createL2ClobClient({
    address: msg.address,
    credentials: msg.credentials,
    wallet: walletMode === "eoa" ? msg.address : msg.proxyAddress,
  });

  await syncClobBalanceAllowance(
    client as unknown as ClobBalanceAllowanceClient,
    { tokenIds: [msg.yesTokenId, msg.noTokenId] }
  );
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

  const walletMode = normalizeExtensionTradingWalletMode(msg.walletMode);
  const proxyAddress =
    walletMode === "eoa"
      ? ownerAddress
      : (getAddress(
          msg.proxyAddress ?? deriveProxyAddressSync(msg.address, walletMode)
        ) as Address);
  const plan = await planCtfOperationTransactions({
    operation: "splitPosition",
    conditionId: msg.conditionId,
    amount: msg.amount,
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
  const walletMode = normalizeExtensionTradingWalletMode(msg.walletMode);
  const proxyAddress =
    walletMode === "eoa"
      ? ownerAddress
      : (getAddress(
          msg.proxyAddress ?? deriveProxyAddressSync(msg.address, walletMode)
        ) as Address);

  const plan = await planCtfOperationTransactions({
    operation: "mergePositions",
    conditionId: msg.conditionId,
    amount: msg.amount,
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
  const walletMode = normalizeExtensionTradingWalletMode(msg.walletMode);

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
  const walletMode = normalizeExtensionTradingWalletMode(msg.walletMode);
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

  if (!wrapPlan.hasEnoughBaseCollateral) {
    // Format raw 6-decimal base units to USD — otherwise the message reads
    // "need 1000000 more pUSD" (raw) instead of "need $1.00 more".
    throw new Error(
      `Insufficient collateral: need ${formatUsd6(wrapPlan.baseShortfallRaw)} more pUSD (or USDC.e to wrap), have ${formatUsd6(wrapPlan.availablePusdRaw)} pUSD + ${formatUsd6(usdcBalance)} USDC.e`
    );
  }

  if (!wrapPlan.needsWrap) return;

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

  // Exact 6-decimal strings — Number() here would route share balances
  // through floats before the panel's sizing and display logic sees them.
  return ok({
    yesBalance: formatUnits(balances.yesBalance, 6),
    noBalance: formatUnits(balances.noBalance, 6),
    minBalance: formatUnits(balances.minBalance, 6),
  });
}
