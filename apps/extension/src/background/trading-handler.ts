/**
 * Trading Handler — processes trading-related messages in the offscreen document.
 * Uses ClobClient + BridgeSigner for order operations.
 * Supports: limit (GTC/GTD), market (FAK/FOK), split, merge, and balance queries.
 */

import {
  COLLATERAL_ONRAMP_ADDRESS,
  CTF_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  PUSD_ADDRESS,
  SAFE_FACTORY_ADDRESS,
  SAFE_INIT_CODE_HASH,
  USDC_E_ADDRESS,
} from "@knoww/shared-types/contracts";
import {
  BINARY_PARTITION,
  CTF_BALANCE_BATCH_ABI,
  CTF_MERGE_ABI,
  CTF_SPLIT_ABI,
  ERC20_ALLOWANCE_ABI,
  PARENT_COLLECTION_ID,
} from "@knoww/shared-types/ctf";
import {
  POLYGON_CHAIN_ID,
  POLYMARKET_API,
  SIGNATURE_TYPES,
} from "@knoww/shared-types/polymarket";
import { ethers } from "ethers";
import type {
  TradingDeriveCredentialsMessage,
  TradingErrorResponse,
  TradingGetAllAllowancesMessage,
  TradingGetAllowanceMessage,
  TradingGetBalanceMessage,
  TradingGetFeeRateMessage,
  TradingGetOrderBookMessage,
  TradingGetOutcomeBalancesMessage,
  TradingMergePositionsMessage,
  TradingPlaceOrderMessage,
  TradingRelayerApproveMessage,
  TradingSplitPositionMessage,
  TradingSuccessResponse,
} from "../types/chrome-messages";
import { BridgeSigner } from "./bridge-signer";
import { logInfo, logWarn } from "./logger";
import { executeViaRelayer } from "./relayer-client";
import { setActiveTab } from "./signing-state";

const CLOB_HOST = POLYMARKET_API.CLOB.BASE;
const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";

type TradingResponse = TradingSuccessResponse | TradingErrorResponse;

function ok(data: unknown): TradingSuccessResponse {
  return { ok: true, data };
}

function fail(error: string): TradingErrorResponse {
  return { ok: false, error };
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
      case "trading:get-fee-rate":
        return await handleGetFeeRate(
          message as unknown as TradingGetFeeRateMessage
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
          message as unknown as { type: string; eoaAddress: string }
        );
      case "trading:get-orderbook":
        return await handleGetOrderBook(
          message as unknown as TradingGetOrderBookMessage
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
  const { address, signature, timestamp, nonce } = msg;

  const headers: Record<string, string> = {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_NONCE: String(nonce),
  };

  // Try derive first (existing key), then create (new key).
  // Uses the signature already obtained from MetaMask by the content script,
  // avoiding extra signing prompts that ClobClient would trigger.
  let raw: { apiKey: string; secret: string; passphrase: string };
  let method: "create" | "derive";

  const deriveRes = await fetch(`${CLOB_HOST}/auth/derive-api-key`, {
    method: "GET",
    headers,
  });
  if (deriveRes.ok) {
    raw = await deriveRes.json();
    method = "derive";
  } else {
    const createRes = await fetch(`${CLOB_HOST}/auth/api-key`, {
      method: "POST",
      headers,
    });
    if (!createRes.ok) return fail("Failed to derive CLOB API credentials");
    raw = await createRes.json();
    method = "create";
  }

  return ok({
    apiKey: raw.apiKey,
    apiSecret: raw.secret,
    apiPassphrase: raw.passphrase,
    method,
  });
}

// ── Balance ──

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
  "function getEthBalance(address addr) view returns (uint256)",
];
const BALANCE_OF_SELECTOR = "0x70a08231";

interface TokenDef {
  symbol: string;
  address: string;
  decimals: number;
}

const KNOWN_TOKENS: TokenDef[] = [
  { symbol: "USDC.e", address: USDC_E_ADDRESS, decimals: 6 },
  {
    symbol: "USDC",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
  {
    symbol: "USDT",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    decimals: 6,
  },
  {
    symbol: "DAI",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    decimals: 18,
  },
  {
    symbol: "WETH",
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    decimals: 18,
  },
  {
    symbol: "WMATIC",
    address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    decimals: 18,
  },
];

function encodeBalanceOf(owner: string): string {
  return (
    BALANCE_OF_SELECTOR +
    owner.toLowerCase().replace("0x", "").padStart(64, "0")
  );
}

async function handleGetBalance(
  msg: TradingGetBalanceMessage
): Promise<TradingResponse> {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);

  const calls = [
    ...KNOWN_TOKENS.map((t) => ({
      target: t.address,
      allowFailure: true,
      callData: encodeBalanceOf(msg.proxyAddress),
    })),
    {
      target: MULTICALL3,
      allowFailure: true,
      callData: mc.interface.encodeFunctionData("getEthBalance", [
        msg.proxyAddress,
      ]),
    },
  ];

  const results: Array<{ success: boolean; returnData: string }> =
    await mc.aggregate3(calls);

  const tokenBalances: Array<{ symbol: string; amount: number }> = [];
  let primaryBalance = 0;
  let primaryBalanceRaw = "0";

  for (let i = 0; i < KNOWN_TOKENS.length; i++) {
    const tok = KNOWN_TOKENS[i];
    const res = results[i];
    if (!res.success || res.returnData === "0x") continue;
    const raw = ethers.BigNumber.from(res.returnData);
    if (raw.isZero()) continue;
    const amount = Number(ethers.utils.formatUnits(raw, tok.decimals));
    tokenBalances.push({ symbol: tok.symbol, amount });
    if (tok.address.toLowerCase() === USDC_E_ADDRESS.toLowerCase()) {
      primaryBalance = amount;
      primaryBalanceRaw = raw.toString();
    }
  }

  const polRes = results[KNOWN_TOKENS.length];
  const polBalance =
    polRes.success && polRes.returnData !== "0x"
      ? Number(
          ethers.utils.formatEther(ethers.BigNumber.from(polRes.returnData))
        )
      : 0;
  if (polBalance > 0) {
    tokenBalances.push({ symbol: "POL", amount: polBalance });
  }

  return ok({
    balance: primaryBalance,
    balanceRaw: primaryBalanceRaw,
    polBalance,
    tokenBalances,
  });
}

// ── Place Order (Limit: GTC/GTD, Market: FAK/FOK) ──

async function handlePlaceOrder(
  msg: TradingPlaceOrderMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) return fail("No active tab for signing");

  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const signer = new BridgeSigner(msg.address, tabId, provider);
  const { ClobClient } = await import("@polymarket/clob-client-v2");

  const creds = {
    key: msg.credentials.apiKey,
    secret: msg.credentials.apiSecret,
    passphrase: msg.credentials.apiPassphrase,
  };

  const builderCode = process.env.POLY_BUILDER_CODE;

  const client = new ClobClient({
    host: CLOB_HOST,
    chain: POLYGON_CHAIN_ID,
    signer,
    creds,
    signatureType: SIGNATURE_TYPES.POLY_GNOSIS_SAFE,
    funderAddress: msg.proxyAddress,
    ...(builderCode ? { builderConfig: { builderCode } } : {}),
  });

  const orderOptions = msg.negRisk ? { negRisk: true } : undefined;
  const orderType = msg.orderType || "GTC";

  if (msg.side === "BUY") {
    // Required pUSD = price * size for limit, or amount for market BUY
    const requiredPusd =
      orderType === "FAK" || orderType === "FOK"
        ? ethers.utils.parseUnits(String(msg.amount ?? msg.size), 6)
        : ethers.utils.parseUnits(String(msg.price * msg.size), 6);

    await ensurePusdSufficient(
      signer,
      msg.proxyAddress,
      requiredPusd,
      provider
    );
  }

  try {
    await client.updateBalanceAllowance({
      asset_type: "COLLATERAL" as any,
    });
    await client.updateBalanceAllowance({
      asset_type: "CONDITIONAL" as any,
      token_id: msg.tokenId,
    });
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

  if (orderType === "FAK" || orderType === "FOK") {
    const marketAmount =
      msg.side === "SELL" ? msg.size : (msg.amount ?? msg.size);
    const marketOrder: Record<string, unknown> = {
      tokenID: msg.tokenId,
      amount: marketAmount,
      side: msg.side,
      // feeRateBps removed (V2: protocol-determined at match time)
      orderType,
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

    const order = await client.createMarketOrder(
      marketOrder as any,
      orderOptions
    );
    const response = await client.postOrder(order, orderType as any);
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
      side: msg.side as any,
      // feeRateBps removed (V2: protocol-determined at match time)
      expiration: orderType === "GTD" ? msg.expiration : 0,
    },
    orderOptions
  );

  logInfo("trading.place-order.signed", {
    tokenID: order.tokenId,
    side: order.side,
    size: order.size,
    price: order.price,
  });

  const response = await client.postOrder(order, orderType as any);

  logInfo("trading.place-order.clob-response", {
    txHash: (response as Record<string, unknown>)?.transactionHash,
    status: (response as Record<string, unknown>)?.status,
  });

  if (
    response &&
    typeof response === "object" &&
    "error" in (response as Record<string, unknown>)
  ) {
    const errorMsg =
      typeof (response as Record<string, unknown>).error === "string"
        ? ((response as Record<string, unknown>).error as string)
        : JSON.stringify((response as Record<string, unknown>).error);
    return fail(`CLOB rejected order: ${errorMsg}`);
  }

  return ok(response);
}

// ── Fee Rate ──

async function handleGetFeeRate(
  msg: TradingGetFeeRateMessage
): Promise<TradingResponse> {
  const { ClobClient } = await import("@polymarket/clob-client-v2");
  const client = new ClobClient({ host: CLOB_HOST, chain: POLYGON_CHAIN_ID });
  const feeRate = await client.getFeeRateBps(msg.tokenId);
  return ok({ feeRate });
}

// ── Proxy Address ──

async function handleDeriveProxyAddress(msg: {
  eoaAddress: string;
}): Promise<TradingResponse> {
  const addressClean = msg.eoaAddress.toLowerCase().replace("0x", "");
  const encoded = `0x${"0".repeat(24)}${addressClean}`;
  const salt = ethers.utils.keccak256(encoded);
  const proxyAddress = ethers.utils.getCreate2Address(
    SAFE_FACTORY_ADDRESS,
    salt,
    SAFE_INIT_CODE_HASH
  );

  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const code = await provider.getCode(proxyAddress);
  return ok({ proxyAddress, isDeployed: code !== "0x" });
}

// ── Allowance ──

async function handleGetAllowance(
  msg: TradingGetAllowanceMessage
): Promise<TradingResponse> {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const usdc = new ethers.Contract(
    USDC_E_ADDRESS,
    ERC20_ALLOWANCE_ABI,
    provider
  );
  const exchangeAddress = msg.negRisk
    ? NEG_RISK_CTF_EXCHANGE_ADDRESS
    : CTF_EXCHANGE_ADDRESS;
  const allowance: ethers.BigNumber = await usdc.allowance(
    msg.ownerAddress,
    exchangeAddress
  );
  return ok({
    allowance: Number(ethers.utils.formatUnits(allowance, 6)),
    allowanceRaw: allowance.toString(),
  });
}

// ── All Allowances ──

const ERC1155_IS_APPROVED_ABI = [
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
];

async function handleGetAllAllowances(
  msg: TradingGetAllAllowancesMessage
): Promise<TradingResponse> {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const usdc = new ethers.Contract(
    USDC_E_ADDRESS,
    ERC20_ALLOWANCE_ABI,
    provider
  );
  const pusd = new ethers.Contract(PUSD_ADDRESS, ERC20_ALLOWANCE_ABI, provider);
  const ctf = new ethers.Contract(
    CTF_ADDRESS,
    ERC1155_IS_APPROVED_ABI,
    provider
  );

  const pusdSpenders = [
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_CTF_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ];
  const erc1155Operators = [
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_CTF_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ];

  const allowances: Record<string, number> = {};

  const [usdcOnramp, pusdResults, erc1155Results] = await Promise.all([
    usdc
      .allowance(msg.ownerAddress, COLLATERAL_ONRAMP_ADDRESS)
      .catch(() => ethers.BigNumber.from(0)),
    Promise.all(
      pusdSpenders.map((s) =>
        pusd
          .allowance(msg.ownerAddress, s)
          .catch(() => ethers.BigNumber.from(0))
      )
    ),
    Promise.all(
      erc1155Operators.map((op) =>
        ctf.isApprovedForAll(msg.ownerAddress, op).catch(() => false)
      )
    ),
  ]);

  allowances[`usdce:${COLLATERAL_ONRAMP_ADDRESS}`] = Number(
    ethers.utils.formatUnits(usdcOnramp, 6)
  );
  for (let i = 0; i < pusdSpenders.length; i++) {
    allowances[`pusd:${pusdSpenders[i]}`] = Number(
      ethers.utils.formatUnits(pusdResults[i], 6)
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
  const res = await fetch(`${CLOB_HOST}/book?token_id=${msg.tokenId}`);
  if (!res.ok) return fail(`Failed to fetch order book: ${res.statusText}`);
  const data = await res.json();
  return ok(data);
}

// ── Post-split/merge: tell the CLOB about updated on-chain balances ──
// Uses direct HTTP + HMAC auth to avoid any wallet/signer interaction.

async function buildHmacHeaders(
  address: string,
  creds: { apiKey: string; apiSecret: string; apiPassphrase: string },
  method: string,
  requestPath: string
): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000);
  const message = `${ts}${method}${requestPath}`;
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

async function clobUpdateBalanceAllowance(
  address: string,
  creds: { apiKey: string; apiSecret: string; apiPassphrase: string },
  assetType: string,
  tokenId?: string
): Promise<void> {
  const endpoint = "/balance-allowance/update";
  const headers = await buildHmacHeaders(address, creds, "GET", endpoint);
  const params = new URLSearchParams({
    asset_type: assetType,
    signature_type: String(SIGNATURE_TYPES.POLY_GNOSIS_SAFE),
  });
  if (tokenId) params.set("token_id", tokenId);
  await fetch(`${CLOB_HOST}${endpoint}?${params}`, { method: "GET", headers });
}

async function syncBalancesAfterCTF(msg: {
  address: string;
  conditionId: string;
  credentials?: { apiKey: string; apiSecret: string; apiPassphrase: string };
  proxyAddress?: string;
  yesTokenId?: string;
  noTokenId?: string;
}): Promise<void> {
  if (!msg.credentials || !msg.proxyAddress) return;

  await clobUpdateBalanceAllowance(
    msg.proxyAddress,
    msg.credentials,
    "COLLATERAL"
  );
  if (msg.yesTokenId) {
    await clobUpdateBalanceAllowance(
      msg.proxyAddress,
      msg.credentials,
      "CONDITIONAL",
      msg.yesTokenId
    );
  }
  if (msg.noTokenId) {
    await clobUpdateBalanceAllowance(
      msg.proxyAddress,
      msg.credentials,
      "CONDITIONAL",
      msg.noTokenId
    );
  }
  logInfo("trading.ctf-balance-synced", {
    conditionId: msg.conditionId,
    address: msg.address,
  });
}

// ── Split Position (USDC → YES + NO) via Relayer (gasless) ──

async function handleSplitPosition(
  msg: TradingSplitPositionMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) return fail("No active tab for signing");

  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const signer = new BridgeSigner(msg.address, tabId, provider);

  const ctfIface = new ethers.utils.Interface(CTF_SPLIT_ABI);
  const amountWei = ethers.utils.parseUnits(String(msg.amount), 6);
  const calldata = ctfIface.encodeFunctionData("splitPosition", [
    USDC_E_ADDRESS,
    PARENT_COLLECTION_ID,
    msg.conditionId,
    BINARY_PARTITION,
    amountWei,
  ]);

  const result = await executeViaRelayer(signer, [
    { to: CTF_ADDRESS, data: calldata, value: "0" },
  ]);

  syncBalancesAfterCTF(msg).catch((e) =>
    logWarn("trading.ctf-post-sync-failed", {
      kind: "split",
      error: e instanceof Error ? e.message : String(e),
    })
  );

  return ok({ txHash: result.txHash, success: true });
}

// ── Merge Positions (YES + NO → USDC) via Relayer (gasless) ──

async function handleMergePositions(
  msg: TradingMergePositionsMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) return fail("No active tab for signing");

  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const signer = new BridgeSigner(msg.address, tabId, provider);

  const ctfIface = new ethers.utils.Interface(CTF_MERGE_ABI);
  const amountWei = ethers.utils.parseUnits(String(msg.amount), 6);
  const calldata = ctfIface.encodeFunctionData("mergePositions", [
    USDC_E_ADDRESS,
    PARENT_COLLECTION_ID,
    msg.conditionId,
    BINARY_PARTITION,
    amountWei,
  ]);

  const result = await executeViaRelayer(signer, [
    { to: CTF_ADDRESS, data: calldata, value: "0" },
  ]);

  syncBalancesAfterCTF(msg).catch((e) =>
    logWarn("trading.ctf-post-sync-failed", {
      kind: "merge",
      error: e instanceof Error ? e.message : String(e),
    })
  );

  return ok({ txHash: result.txHash, success: true });
}

// ── Gasless Approvals via Relayer ──

const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
];
const ERC1155_SET_APPROVAL_ABI = [
  "function setApprovalForAll(address operator, bool approved)",
];

async function handleRelayerApprove(
  msg: TradingRelayerApproveMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) return fail("No active tab for signing");

  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const signer = new BridgeSigner(msg.address, tabId, provider);

  const erc20Iface = new ethers.utils.Interface(ERC20_APPROVE_ABI);
  const erc1155Iface = new ethers.utils.Interface(ERC1155_SET_APPROVAL_ABI);
  const MAX_UINT256 = ethers.constants.MaxUint256;

  // USDC.e gets approved to the Onramp only (for wrap()).
  const usdcSpender = COLLATERAL_ONRAMP_ADDRESS;

  // pUSD gets approved to the V2 exchanges and adapter for trading.
  const pusdSpenders = [
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_CTF_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ];

  // ERC-1155 outcome tokens approve the same exchanges/adapter as operators.
  const erc1155Operators = [
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_CTF_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ];

  const proxyAddress = deriveProxyAddressSync(msg.address);

  let needsUsdc = false;
  const needsPusd: string[] = [];
  const needsErc1155: string[] = [];

  try {
    const usdc = new ethers.Contract(
      USDC_E_ADDRESS,
      ERC20_ALLOWANCE_ABI,
      provider
    );
    const pusd = new ethers.Contract(
      PUSD_ADDRESS,
      ERC20_ALLOWANCE_ABI,
      provider
    );
    const ctf = new ethers.Contract(
      CTF_ADDRESS,
      ERC1155_IS_APPROVED_ABI,
      provider
    );
    const THRESHOLD = ethers.utils.parseUnits("1000000", 6);

    const [usdcAllowance, pusdAllowances, erc1155Results] = await Promise.all([
      usdc
        .allowance(proxyAddress, usdcSpender)
        .catch(() => ethers.BigNumber.from(0)),
      Promise.all(
        pusdSpenders.map((s) =>
          pusd.allowance(proxyAddress, s).catch(() => ethers.BigNumber.from(0))
        )
      ),
      Promise.all(
        erc1155Operators.map((op) =>
          ctf.isApprovedForAll(proxyAddress, op).catch(() => false)
        )
      ),
    ]);

    if (usdcAllowance.lt(THRESHOLD)) needsUsdc = true;
    for (let i = 0; i < pusdSpenders.length; i++) {
      if (pusdAllowances[i].lt(THRESHOLD)) needsPusd.push(pusdSpenders[i]);
    }
    for (let i = 0; i < erc1155Operators.length; i++) {
      if (!erc1155Results[i]) needsErc1155.push(erc1155Operators[i]);
    }
  } catch {
    needsUsdc = true;
    needsPusd.push(...pusdSpenders);
    needsErc1155.push(...erc1155Operators);
  }

  if (!needsUsdc && needsPusd.length === 0 && needsErc1155.length === 0) {
    return ok({ txHash: "", alreadyApproved: true });
  }

  const txns: Array<{ to: string; data: string; value: string }> = [];

  if (needsUsdc) {
    txns.push({
      to: USDC_E_ADDRESS,
      data: erc20Iface.encodeFunctionData("approve", [
        usdcSpender,
        MAX_UINT256,
      ]),
      value: "0",
    });
  }

  for (const spender of needsPusd) {
    txns.push({
      to: PUSD_ADDRESS,
      data: erc20Iface.encodeFunctionData("approve", [spender, MAX_UINT256]),
      value: "0",
    });
  }

  for (const operator of needsErc1155) {
    txns.push({
      to: CTF_ADDRESS,
      data: erc1155Iface.encodeFunctionData("setApprovalForAll", [
        operator,
        true,
      ]),
      value: "0",
    });
  }

  logInfo("trading.relayer-approve.submit", { txnCount: txns.length });
  const result = await executeViaRelayer(signer, txns);
  return ok({ txHash: result.txHash, success: true });
}

const COLLATERAL_ONRAMP_WRAP_ABI = [
  "function wrap(address _asset, address _to, uint256 _amount)",
];

async function ensurePusdSufficient(
  signer: BridgeSigner,
  proxyAddress: string,
  requiredPusd: ethers.BigNumber,
  provider: ethers.providers.StaticJsonRpcProvider
): Promise<void> {
  const pusd = new ethers.Contract(
    PUSD_ADDRESS,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );
  const usdc = new ethers.Contract(
    USDC_E_ADDRESS,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );

  const pusdBalance: ethers.BigNumber = await pusd.balanceOf(proxyAddress);
  if (pusdBalance.gte(requiredPusd)) return;

  const shortfall = requiredPusd.sub(pusdBalance);
  const usdcBalance: ethers.BigNumber = await usdc.balanceOf(proxyAddress);
  if (usdcBalance.lt(shortfall)) {
    throw new Error(
      `Insufficient collateral: need ${shortfall.toString()} more pUSD (or USDC.e to wrap), have ${pusdBalance.toString()} pUSD + ${usdcBalance.toString()} USDC.e`
    );
  }

  const erc20Iface = new ethers.utils.Interface([
    "function approve(address spender, uint256 amount) returns (bool)",
  ]);
  const onrampIface = new ethers.utils.Interface(COLLATERAL_ONRAMP_WRAP_ABI);

  const approveCalldata = erc20Iface.encodeFunctionData("approve", [
    COLLATERAL_ONRAMP_ADDRESS,
    shortfall,
  ]);
  const wrapCalldata = onrampIface.encodeFunctionData("wrap", [
    USDC_E_ADDRESS,
    proxyAddress,
    shortfall,
  ]);

  await executeViaRelayer(signer, [
    { to: USDC_E_ADDRESS, data: approveCalldata, value: "0" },
    { to: COLLATERAL_ONRAMP_ADDRESS, data: wrapCalldata, value: "0" },
  ]);

  logInfo("trading.auto-wrap", { wrapped: shortfall.toString() });
}

function deriveProxyAddressSync(eoaAddress: string): string {
  const encoded = ethers.utils.defaultAbiCoder.encode(
    ["address"],
    [eoaAddress]
  );
  const salt = ethers.utils.keccak256(encoded);
  return ethers.utils.getCreate2Address(
    SAFE_FACTORY_ADDRESS,
    salt,
    SAFE_INIT_CODE_HASH
  );
}

// ── Outcome Token Balances ──

async function handleGetOutcomeBalances(
  msg: TradingGetOutcomeBalancesMessage
): Promise<TradingResponse> {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const ctf = new ethers.Contract(CTF_ADDRESS, CTF_BALANCE_BATCH_ABI, provider);

  const balances: ethers.BigNumber[] = await ctf.balanceOfBatch(
    [msg.ownerAddress, msg.ownerAddress],
    [msg.yesTokenId, msg.noTokenId]
  );

  const yesBalance = Number(ethers.utils.formatUnits(balances[0], 6));
  const noBalance = Number(ethers.utils.formatUnits(balances[1], 6));
  return ok({
    yesBalance,
    noBalance,
    minBalance: Math.min(yesBalance, noBalance),
  });
}
