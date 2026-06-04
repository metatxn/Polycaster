/**
 * Native, multi-chain portfolio deposit / withdraw execution.
 *
 * Mirrors the knoww.app web flows and reuses the shared Polymarket Bridge API
 * (@knoww/shared-types/bridge) + relayer (@knoww/shared-types/relayer):
 *  - Deposit:  EOA transfers pUSD directly to the proxy, or sends supported
 *              source tokens to a Bridge deposit address that credits pUSD.
 *  - Withdraw: Proxy transfers pUSD to a Bridge withdrawal address configured
 *              for the chosen destination chain and token.
 *
 * Signing is delegated to the active content tab via createBridgeWalletClient
 * (the same rail "Enable trading" uses) — the side panel has no wallet itself.
 */

import { logInfo, logWarn } from "@knoww/logger";
import {
  POLYGON_WALLET_TOKENS,
  readTradingWalletBalance,
} from "@knoww/shared-types/balances";
import {
  createDepositAddresses,
  type DepositTransaction,
  fetchDepositStatus,
  fetchQuote,
  fetchSupportedAssets,
  fetchWithdrawalAddresses,
  findSupportedBridgeAsset,
  getMinDepositForToken,
  isPusdToken,
  POLYGON_BRIDGE_CHAIN_ID,
  type QuoteResponse,
  resolveWalletDepositRoute,
  type SupportedAsset,
} from "@knoww/shared-types/bridge";
import { POLYGON_CHAIN } from "@knoww/shared-types/chains";
import {
  PUSD_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "@knoww/shared-types/contracts";
import {
  derivePolymarketDepositWallet,
  derivePolymarketSafe,
  type RelayerTransaction,
} from "@knoww/shared-types/relayer";
import Decimal from "decimal.js";
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  parseUnits,
} from "viem";
import { createBridgeWalletClient } from "./bridge-signer";
import { getKnowwAppUrl } from "./extension-session";
import {
  buildPortfolioDirectWithdrawQuote,
  buildPortfolioWithdrawQuoteRequest,
  type PortfolioBridgeStatusSummary,
  type PortfolioWithdrawDestination,
  summarizePortfolioBridgeStatus,
  validatePortfolioWithdrawBridgeAddress,
} from "./portfolio-withdraw-flow";
import { executeViaDepositWallet, executeViaRelayer } from "./relayer-client";

// Polygon tokens the "Wallet" deposit method can transfer.
const DEPOSIT_WALLET_TOKENS = POLYGON_WALLET_TOKENS;

const STABLE_SYMBOLS = new Set(["USDC", "USDC.e", "USDT", "DAI", "pUSD"]);

export interface PortfolioWalletToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  amount: number;
  usdValue: number;
  minUsd: number;
  depositSupported: boolean;
  depositDisabledReason?: string;
}

async function fetchTokenPrices(): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${getKnowwAppUrl()}/api/price/tokens`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { prices?: Record<string, number> };
    return data.prices ?? {};
  } catch {
    return {};
  }
}

function priceForSymbol(
  prices: Record<string, number>,
  symbol: string
): number {
  if (STABLE_SYMBOLS.has(symbol)) return 1;
  if (prices[symbol]) return prices[symbol];
  // Wrapped tokens track their underlying.
  if (symbol === "WETH") return prices.ETH ?? prices.WETH ?? 0;
  if (symbol === "WBTC") return prices.BTC ?? prices.WBTC ?? 0;
  if (symbol === "WMATIC" || symbol === "POL")
    return prices.POL ?? prices.MATIC ?? 0;
  return prices[symbol] ?? 0;
}

/**
 * The connected EOA's Polygon token balances (native POL + the supported ERC20s)
 * with USD values and per-token minimum deposit — drives the deposit "Wallet →
 * token" picker, mirroring the web's useWalletTokens.
 */
export async function getPortfolioWalletTokens(
  eoaAddress: string
): Promise<{ tokens: PortfolioWalletToken[] }> {
  const owner = getAddress(eoaAddress) as Address;
  const [balance, prices, assets] = await Promise.all([
    readTradingWalletBalance(polygonClient, owner, {
      tokens: DEPOSIT_WALLET_TOKENS,
      includeNative: true,
    }),
    fetchTokenPrices(),
    getPortfolioBridgeAssets().catch(() => [] as SupportedAsset[]),
  ]);

  const tokens: PortfolioWalletToken[] = [];
  const pushToken = (
    symbol: string,
    name: string,
    address: string,
    decimals: number,
    amount: number
  ): void => {
    if (amount <= 0) return;
    const price = priceForSymbol(prices, symbol);
    const supported = findSupportedBridgeAsset(
      assets,
      POLYGON_BRIDGE_CHAIN_ID,
      symbol,
      address
    );
    const isPusd = isPusdToken(symbol, address);
    const minUsd = isPusd
      ? 0
      : (supported?.minCheckoutUsd ?? getMinDepositForToken(assets, symbol));
    tokens.push({
      symbol,
      name,
      address,
      decimals,
      amount,
      usdValue: amount * price,
      minUsd,
      depositSupported: isPusd || Boolean(supported),
      depositDisabledReason:
        isPusd || supported ? undefined : "Unsupported deposits",
    });
  };

  // Native POL first (matches the web header token).
  pushToken("POL", "Polygon", NATIVE_TOKEN, 18, balance.polBalance);
  for (const entry of balance.tokenBalances) {
    const def = DEPOSIT_WALLET_TOKENS.find((t) => t.symbol === entry.symbol);
    pushToken(
      entry.symbol,
      def?.name ?? entry.symbol,
      entry.address,
      entry.decimals,
      entry.amount
    );
  }

  tokens.sort((a, b) => b.usdValue - a.usdValue);
  return { tokens };
}

export type PortfolioWalletMode = "deposit" | "safe" | "eoa";

const NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";

const polygonClient = createPublicClient({
  chain: POLYGON_CHAIN,
  transport: http(POLYGON_RPC),
});

function bridgeOptions(): { builderCode?: string } {
  const code = process.env.POLY_BUILDER_CODE;
  return code ? { builderCode: code } : {};
}

function normalizeWalletMode(mode?: string): PortfolioWalletMode {
  return mode === "safe" || mode === "eoa" || mode === "deposit"
    ? mode
    : "deposit";
}

function deriveProxyAddress(eoa: Address, mode: PortfolioWalletMode): Address {
  if (mode === "eoa") return eoa;
  if (mode === "deposit") return derivePolymarketDepositWallet(eoa);
  return derivePolymarketSafe(eoa);
}

function encodeTransfer(to: Address, amountRaw: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amountRaw],
  });
}

async function assertPortfolioTokenBalance(input: {
  owner: Address;
  tokenAddress: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  amountRaw: bigint;
}): Promise<void> {
  const balanceRaw = await polygonClient.readContract({
    address: input.tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [input.owner],
  });

  if (balanceRaw >= input.amountRaw) return;

  const available = new Decimal(balanceRaw.toString())
    .div(new Decimal(10).pow(input.tokenDecimals))
    .toFixed();
  throw new Error(
    `Insufficient ${input.tokenSymbol} balance. Available: ${available} ${input.tokenSymbol}.`
  );
}

let cachedAssets: SupportedAsset[] | null = null;

/** Live bridge-supported chains + tokens (cached) for the deposit/withdraw UI. */
export async function getPortfolioBridgeAssets(): Promise<SupportedAsset[]> {
  if (!cachedAssets) {
    cachedAssets = await fetchSupportedAssets(bridgeOptions());
  }
  return cachedAssets;
}

/** Connected EOA's USDC.e balance on Polygon, for the deposit Max on Polygon. */
export async function getPortfolioDepositMax(
  eoaAddress: string
): Promise<{ balance: string }> {
  const owner = getAddress(eoaAddress) as Address;
  const result = await readTradingWalletBalance(polygonClient, owner, {
    tokens: [
      {
        symbol: "USDC.e",
        name: "Bridged USDC",
        address: USDC_E_ADDRESS as Address,
        decimals: USDC_E_DECIMALS,
      },
    ],
  });
  return { balance: String(result.usdcEBalance ?? 0) };
}

export async function getPortfolioWithdrawQuote(input: {
  amount: string;
  destination: string;
  chainKey?: string;
  tokenId?: string;
}): Promise<{
  quote: QuoteResponse;
  destination: PortfolioWithdrawDestination;
}> {
  const draft = buildPortfolioWithdrawQuoteRequest({
    amount: input.amount,
    chainKey: input.chainKey,
    tokenId: input.tokenId,
    recipientAddress: input.destination,
    supportedAssets: await getPortfolioBridgeAssets(),
  });
  logInfo("portfolio.withdraw.quote.request", {
    amount: input.amount,
    chainKey: draft.destination.chainKey,
    tokenId: draft.destination.tokenId,
    routeKind: draft.destination.routeKind,
    recipientAddress: input.destination,
    toChainId: draft.request.toChainId,
    toTokenAddress: draft.request.toTokenAddress,
    fromTokenAddress: draft.request.fromTokenAddress,
  });
  if (draft.destination.routeKind === "direct") {
    const quote = buildPortfolioDirectWithdrawQuote({
      amount: input.amount,
      destination: draft.destination,
    });
    logInfo("portfolio.withdraw.quote.direct", {
      quoteId: quote.quoteId,
      estToTokenBaseUnit: quote.estToTokenBaseUnit,
      estOutputUsd: quote.estOutputUsd,
      tokenId: draft.destination.tokenId,
      tokenSymbol: draft.destination.tokenSymbol,
      toTokenAddress: draft.destination.toTokenAddress,
    });
    return { quote, destination: draft.destination };
  }
  const quote = await fetchQuote(draft.request, bridgeOptions());
  logInfo("portfolio.withdraw.quote.response", {
    quoteId: quote.quoteId,
    estToTokenBaseUnit: quote.estToTokenBaseUnit,
    estOutputUsd: quote.estOutputUsd,
    tokenId: draft.destination.tokenId,
    tokenSymbol: draft.destination.tokenSymbol,
    toTokenAddress: draft.destination.toTokenAddress,
  });
  return { quote, destination: draft.destination };
}

export async function getPortfolioWithdrawStatus(
  bridgeAddress: string
): Promise<{
  transactions: DepositTransaction[];
  summary: PortfolioBridgeStatusSummary;
}> {
  const address = getAddress(bridgeAddress);
  const transactions = await fetchDepositStatus(address, bridgeOptions());
  const summary = summarizePortfolioBridgeStatus(transactions);
  logInfo("portfolio.withdraw.status", {
    bridgeAddress: address,
    transactionCount: transactions.length,
    status: summary.status,
    txHash: summary.txHash,
    fromTokenAddress: summary.fromTokenAddress,
    fromAmountBaseUnit: summary.fromAmountBaseUnit,
    toChainId: summary.toChainId,
    toTokenAddress: summary.toTokenAddress,
  });
  if (summary.toTokenAddress?.toLowerCase() === PUSD_ADDRESS.toLowerCase()) {
    logWarn("portfolio.withdraw.status.pusd_destination", {
      bridgeAddress: address,
      txHash: summary.txHash,
      fromTokenAddress: summary.fromTokenAddress,
      fromAmountBaseUnit: summary.fromAmountBaseUnit,
      toChainId: summary.toChainId,
      toTokenAddress: summary.toTokenAddress,
    });
  }
  return {
    transactions,
    summary,
  };
}

/**
 * Deposit: source token (EOA, on `chainId`) → Bridge deposit address → proxy
 * credited as pUSD. The wallet is switched to the source chain before signing.
 */
export async function executePortfolioDeposit(input: {
  eoaAddress: string;
  walletMode?: string;
  amount: string;
  chainId?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  tokenDecimals?: number;
  tabId: number;
}): Promise<{ txHash: string; bridgeAddress: string }> {
  const eoa = getAddress(input.eoaAddress) as Address;
  const proxy = deriveProxyAddress(eoa, normalizeWalletMode(input.walletMode));
  const chainId = input.chainId || POLYGON_BRIDGE_CHAIN_ID;
  const tokenSymbol = input.tokenSymbol || "USDC.e";
  const tokenAddress = input.tokenAddress || USDC_E_ADDRESS;
  const tokenDecimals = input.tokenDecimals ?? USDC_E_DECIMALS;

  const isDirectPusdDeposit = isPusdToken(tokenSymbol, tokenAddress);
  const [assets, addresses] = await Promise.all([
    isDirectPusdDeposit
      ? Promise.resolve([] as SupportedAsset[])
      : getPortfolioBridgeAssets().catch(() => [] as SupportedAsset[]),
    isDirectPusdDeposit
      ? Promise.resolve([])
      : createDepositAddresses(proxy, bridgeOptions()),
  ]);
  const route = resolveWalletDepositRoute({
    chainId,
    tokenSymbol,
    tokenAddress,
    recipientAddress: proxy,
    supportedAssets: assets,
    depositAddresses: addresses,
  });
  if (!route) {
    throw new Error(`${tokenSymbol} is not supported for Polygon deposits.`);
  }

  const depositAddress = getAddress(route.depositAddress) as Address;

  const amountRaw = parseUnits(input.amount, tokenDecimals);
  if (amountRaw <= 0n) throw new Error("Enter an amount greater than zero.");

  const wallet = createBridgeWalletClient(eoa, input.tabId);
  // Make sure the wallet is on the source chain (no-op if already there).
  await wallet.switchChain(Number(chainId));

  const isNative = tokenAddress.toLowerCase() === NATIVE_TOKEN;
  const txHash = isNative
    ? await wallet.sendTransaction({ to: depositAddress, value: amountRaw })
    : await wallet.sendTransaction({
        to: getAddress(tokenAddress) as Address,
        data: encodeTransfer(depositAddress, amountRaw),
        value: 0n,
      });

  return { txHash, bridgeAddress: depositAddress };
}

/**
 * Withdraw: pUSD (proxy, via relayer on Polygon) → Bridge withdrawal address →
 * the chosen token on the chosen destination chain, delivered to `destination`.
 */
export async function executePortfolioWithdraw(input: {
  eoaAddress: string;
  walletMode?: string;
  amount: string;
  destination: string;
  chainKey?: string;
  tokenId?: string;
  quote?: QuoteResponse;
  tabId: number;
}): Promise<{
  txHash: string;
  bridgeAddress?: string;
  route: "bridge" | "direct";
  quote: QuoteResponse;
  destination: PortfolioWithdrawDestination;
}> {
  const eoa = getAddress(input.eoaAddress) as Address;
  const mode = normalizeWalletMode(input.walletMode);
  const proxy = deriveProxyAddress(eoa, mode);
  const assets = await getPortfolioBridgeAssets();
  const draft = buildPortfolioWithdrawQuoteRequest({
    amount: input.amount,
    chainKey: input.chainKey,
    tokenId: input.tokenId,
    recipientAddress: input.destination,
    supportedAssets: assets,
  });
  const { destination } = draft;
  logInfo("portfolio.withdraw.prepare", {
    ownerAddress: eoa,
    sourceWallet: proxy,
    walletMode: mode,
    recipientAddress: input.destination,
    amountBaseUnit: draft.request.fromAmountBaseUnit,
    routeKind: destination.routeKind,
    chainKey: destination.chainKey,
    tokenId: destination.tokenId,
    tokenSymbol: destination.tokenSymbol,
    toChainId: destination.toChainId,
    toTokenAddress: destination.toTokenAddress,
  });
  const quote =
    input.quote ??
    (destination.routeKind === "direct"
      ? buildPortfolioDirectWithdrawQuote({
          amount: input.amount,
          destination,
        })
      : await fetchQuote(draft.request, bridgeOptions()));
  logInfo("portfolio.withdraw.quote.confirmed", {
    quoteId: quote.quoteId,
    estToTokenBaseUnit: quote.estToTokenBaseUnit,
    estOutputUsd: quote.estOutputUsd,
    sourceWallet: proxy,
    recipientAddress: input.destination,
    tokenId: destination.tokenId,
    routeKind: destination.routeKind,
    toTokenAddress: destination.toTokenAddress,
  });

  const wallet = createBridgeWalletClient(eoa, input.tabId);

  if (destination.routeKind === "direct") {
    const amountRaw = parseUnits(input.amount, destination.tokenDecimals);
    const recipient = getAddress(input.destination) as Address;
    const tokenAddress = getAddress(destination.toTokenAddress) as Address;

    await assertPortfolioTokenBalance({
      owner: proxy,
      tokenAddress,
      tokenSymbol: destination.tokenSymbol,
      tokenDecimals: destination.tokenDecimals,
      amountRaw,
    });

    const transactions: RelayerTransaction[] = [
      {
        to: tokenAddress,
        data: encodeTransfer(recipient, amountRaw),
        value: "0",
      },
    ];
    const result =
      mode === "deposit"
        ? await executeViaDepositWallet(wallet, eoa, transactions)
        : await executeViaRelayer(wallet, eoa, transactions);
    logInfo("portfolio.withdraw.direct_transfer.submitted", {
      transactionHash: result.txHash,
      sourceWallet: proxy,
      recipientAddress: recipient,
      tokenId: destination.tokenId,
      tokenAddress,
      amountBaseUnit: amountRaw.toString(),
    });

    return {
      txHash: result.txHash,
      route: "direct",
      quote,
      destination,
    };
  }

  const amountRaw = BigInt(draft.request.fromAmountBaseUnit);
  await assertPortfolioTokenBalance({
    owner: proxy,
    tokenAddress: PUSD_ADDRESS as Address,
    tokenSymbol: "pUSD",
    tokenDecimals: PUSD_DECIMALS,
    amountRaw,
  });

  const response = await fetchWithdrawalAddresses(
    {
      address: proxy,
      toChainId: destination.toChainId,
      toTokenAddress: destination.toTokenAddress,
      // EVM/Solana recipient is validated in the side panel; passed through.
      recipientAddr: input.destination,
    },
    bridgeOptions()
  );
  const evmBridgeAddress = response.address.evm;
  if (!evmBridgeAddress) {
    throw new Error("Bridge did not return an EVM deposit address.");
  }
  const bridgeAddress = getAddress(evmBridgeAddress) as Address;
  try {
    validatePortfolioWithdrawBridgeAddress({
      routeKind: destination.routeKind,
      bridgeAddress,
      recipientAddress: input.destination,
      sourceAddress: proxy,
    });
  } catch (error) {
    logWarn("portfolio.withdraw.bridge_address.rejected", {
      error,
      bridgeAddress,
      sourceWallet: proxy,
      recipientAddress: input.destination,
      tokenId: destination.tokenId,
      toTokenAddress: destination.toTokenAddress,
    });
    throw error;
  }
  logInfo("portfolio.withdraw.bridge_address.received", {
    bridgeAddress,
    sourceWallet: proxy,
    recipientAddress: input.destination,
    tokenId: destination.tokenId,
    tokenSymbol: destination.tokenSymbol,
    toChainId: destination.toChainId,
    toTokenAddress: destination.toTokenAddress,
  });

  const transactions: RelayerTransaction[] = [
    {
      to: PUSD_ADDRESS as Address,
      data: encodeTransfer(bridgeAddress, amountRaw),
      value: "0",
    },
  ];

  const result =
    mode === "deposit"
      ? await executeViaDepositWallet(wallet, eoa, transactions)
      : await executeViaRelayer(wallet, eoa, transactions);
  logInfo("portfolio.withdraw.pusd_transfer.submitted", {
    transactionHash: result.txHash,
    sourceWallet: proxy,
    bridgeAddress,
    recipientAddress: input.destination,
    tokenId: destination.tokenId,
    toTokenAddress: destination.toTokenAddress,
    amountBaseUnit: amountRaw.toString(),
  });

  return {
    txHash: result.txHash,
    bridgeAddress,
    route: "bridge",
    quote,
    destination,
  };
}
