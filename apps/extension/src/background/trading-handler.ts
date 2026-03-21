/**
 * Trading Handler — processes trading-related messages in the offscreen document.
 * Uses ClobClient + BridgeSigner for order operations.
 * Supports: limit (GTC/GTD), market (FAK/FOK), split, merge, and balance queries.
 */

import {
  CTF_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
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
import { ClobClient } from "@polymarket/clob-client";
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
  TradingSplitPositionMessage,
  TradingSuccessResponse,
} from "../types/chrome-messages";
import { BridgeSigner } from "./bridge-signer";
import { createExtensionBuilderConfig } from "./builder-config";
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

  const deriveRes = await fetch(`${CLOB_HOST}/auth/derive-api-key`, {
    method: "GET",
    headers,
  });
  if (deriveRes.ok) {
    raw = await deriveRes.json();
  } else {
    const createRes = await fetch(`${CLOB_HOST}/auth/api-key`, {
      method: "POST",
      headers,
    });
    if (!createRes.ok) return fail("Failed to derive CLOB API credentials");
    raw = await createRes.json();
  }

  return ok({
    apiKey: raw.apiKey,
    apiSecret: raw.secret,
    apiPassphrase: raw.passphrase,
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
  const builderConfig = createExtensionBuilderConfig();

  const creds = {
    key: msg.credentials.apiKey,
    secret: msg.credentials.apiSecret,
    passphrase: msg.credentials.apiPassphrase,
  };

  const client = new ClobClient(
    CLOB_HOST,
    POLYGON_CHAIN_ID,
    signer,
    creds,
    SIGNATURE_TYPES.POLY_GNOSIS_SAFE,
    msg.proxyAddress,
    undefined,
    false,
    builderConfig as any
  );

  const feeRateBps = await client.getFeeRateBps(msg.tokenId);
  const orderOptions = msg.negRisk ? { negRisk: true } : undefined;
  const orderType = msg.orderType || "GTC";

  try {
    await client.updateBalanceAllowance({
      asset_type: "COLLATERAL" as any,
    });
    await client.updateBalanceAllowance({
      asset_type: "CONDITIONAL" as any,
      token_id: msg.tokenId,
    });
    console.log("[PlaceOrder] Balance/allowance synced with CLOB");
  } catch (syncErr) {
    console.warn(
      "[PlaceOrder] updateBalanceAllowance failed (non-fatal):",
      syncErr
    );
  }

  if (orderType === "FAK" || orderType === "FOK") {
    const marketAmount =
      msg.side === "SELL" ? msg.size : (msg.amount ?? msg.size);
    const marketOrder: Record<string, unknown> = {
      tokenID: msg.tokenId,
      amount: marketAmount,
      side: msg.side,
      feeRateBps,
      orderType,
    };
    if (msg.price && msg.price > 0) {
      marketOrder.price = msg.price;
    }

    console.log("[PlaceOrder] Market order params:", {
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

  console.log("[PlaceOrder] Limit order params:", {
    tokenID: msg.tokenId,
    price: msg.price,
    size: msg.size,
    side: msg.side,
    feeRateBps,
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
      feeRateBps,
      expiration: orderType === "GTD" ? msg.expiration : 0,
    },
    orderOptions
  );

  console.log("[PlaceOrder] Signed order:", JSON.stringify(order));

  const response = await client.postOrder(order, orderType as any);

  console.log("[PlaceOrder] CLOB response:", JSON.stringify(response));

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
  const client = new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID);
  const feeRate = await client.getFeeRateBps(msg.tokenId);
  return ok({ feeRate });
}

// ── Proxy Address ──

async function handleDeriveProxyAddress(msg: {
  eoaAddress: string;
}): Promise<TradingResponse> {
  const addressClean = msg.eoaAddress.toLowerCase().replace("0x", "");
  const encoded = "0x" + "0".repeat(24) + addressClean;
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
  const ctf = new ethers.Contract(
    CTF_ADDRESS,
    ERC1155_IS_APPROVED_ABI,
    provider
  );

  const erc20Targets = [
    CTF_ADDRESS,
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

  const erc20Results = await Promise.all(
    erc20Targets.map((t) =>
      usdc.allowance(msg.ownerAddress, t).catch(() => ethers.BigNumber.from(0))
    )
  );
  for (let i = 0; i < erc20Targets.length; i++) {
    allowances[erc20Targets[i]] = Number(
      ethers.utils.formatUnits(erc20Results[i], 6)
    );
  }

  const erc1155Results = await Promise.all(
    erc1155Operators.map((op) =>
      ctf.isApprovedForAll(msg.ownerAddress, op).catch(() => false)
    )
  );
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

// ── Split Position (USDC → YES + NO) ──

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

  const ctf = new ethers.Contract(CTF_ADDRESS, CTF_SPLIT_ABI, signer);
  const amountWei = ethers.utils.parseUnits(String(msg.amount), 6);

  const tx = await ctf.splitPosition(
    USDC_E_ADDRESS,
    PARENT_COLLECTION_ID,
    msg.conditionId,
    BINARY_PARTITION,
    amountWei
  );

  const receipt = await tx.wait();
  return ok({ txHash: receipt.transactionHash, success: true });
}

// ── Merge Positions (YES + NO → USDC) ──

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

  const ctf = new ethers.Contract(CTF_ADDRESS, CTF_MERGE_ABI, signer);
  const amountWei = ethers.utils.parseUnits(String(msg.amount), 6);

  const tx = await ctf.mergePositions(
    USDC_E_ADDRESS,
    PARENT_COLLECTION_ID,
    msg.conditionId,
    BINARY_PARTITION,
    amountWei
  );

  const receipt = await tx.wait();
  return ok({ txHash: receipt.transactionHash, success: true });
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
