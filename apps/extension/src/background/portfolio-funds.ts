/**
 * Native, multi-chain portfolio deposit / withdraw execution.
 *
 * Mirrors the knoww.app web flows and reuses the shared Polymarket Bridge API
 * (@knoww/shared-types/bridge) + relayer (@knoww/shared-types/relayer):
 *  - Deposit:  EOA transfers the chosen token on the chosen SOURCE chain to a
 *              Bridge deposit address; the bridge credits the proxy as pUSD.
 *  - Withdraw: the proxy transfers pUSD (on Polygon, via the relayer) to a Bridge
 *              withdrawal address; the bridge delivers the chosen token on the
 *              chosen DESTINATION chain to the recipient.
 *
 * Signing is delegated to the active content tab via createBridgeWalletClient
 * (the same rail "Enable trading" uses) — the side panel has no wallet itself.
 */

import {
  POLYGON_WALLET_TOKENS,
  readTradingWalletBalance,
} from "@knoww/shared-types/balances";
import {
  buildBridgeTokenIndex,
  createDepositAddresses,
  fetchSupportedAssets,
  fetchWithdrawalAddresses,
  getMinDepositForToken,
  resolveDestTokenAddress,
  type SupportedAsset,
  WITHDRAW_CHAIN_IDS,
  type WithdrawTokenId,
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
import { executeViaDepositWallet, executeViaRelayer } from "./relayer-client";

// Polygon tokens the "Wallet" deposit method can transfer (pUSD excluded — it's
// the trading collateral, not something you deposit). Mirrors the web list.
const DEPOSIT_WALLET_TOKENS = POLYGON_WALLET_TOKENS.filter(
  (t) => t.symbol !== "pUSD"
);

const STABLE_SYMBOLS = new Set(["USDC", "USDC.e", "USDT", "DAI"]);

export interface PortfolioWalletToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  amount: number;
  usdValue: number;
  minUsd: number;
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
    tokens.push({
      symbol,
      name,
      address,
      decimals,
      amount,
      usdValue: amount * price,
      minUsd: getMinDepositForToken(assets, symbol) || 2,
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
  const chainId = input.chainId || "137";
  const tokenSymbol = input.tokenSymbol || "USDC.e";
  const tokenAddress = input.tokenAddress || USDC_E_ADDRESS;
  const tokenDecimals = input.tokenDecimals ?? USDC_E_DECIMALS;

  const addresses = await createDepositAddresses(proxy, bridgeOptions());
  const matching =
    addresses.find(
      (a) =>
        a.chainId === chainId &&
        a.tokenSymbol.toUpperCase() === tokenSymbol.toUpperCase()
    ) ||
    addresses.find(
      (a) => a.chainId === chainId && a.tokenSymbol.toUpperCase() === "USDC"
    ) ||
    addresses.find((a) => a.chainId === chainId);
  if (!matching) {
    throw new Error(
      `No bridge deposit address for ${tokenSymbol} on that chain.`
    );
  }
  const bridgeAddress = getAddress(matching.depositAddress) as Address;

  const amountRaw = parseUnits(input.amount, tokenDecimals);
  if (amountRaw <= 0n) throw new Error("Enter an amount greater than zero.");

  const wallet = createBridgeWalletClient(eoa, input.tabId);
  // Make sure the wallet is on the source chain (no-op if already there).
  await wallet.switchChain(Number(chainId));

  const isNative = tokenAddress.toLowerCase() === NATIVE_TOKEN;
  const txHash = isNative
    ? await wallet.sendTransaction({ to: bridgeAddress, value: amountRaw })
    : await wallet.sendTransaction({
        to: getAddress(tokenAddress) as Address,
        data: encodeTransfer(bridgeAddress, amountRaw),
        value: 0n,
      });

  return { txHash, bridgeAddress };
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
  tabId: number;
}): Promise<{ txHash: string; bridgeAddress: string }> {
  const eoa = getAddress(input.eoaAddress) as Address;
  const mode = normalizeWalletMode(input.walletMode);
  const proxy = deriveProxyAddress(eoa, mode);
  const chainKey = input.chainKey || "polygon";
  const toChainId = WITHDRAW_CHAIN_IDS[chainKey] ?? "137";
  const tokenId = (input.tokenId as WithdrawTokenId) || "usdc-e";

  // Resolve the destination token address from live bridge data.
  const index = buildBridgeTokenIndex(await getPortfolioBridgeAssets());
  const toTokenAddress =
    resolveDestTokenAddress(index, toChainId, tokenId) ||
    (toChainId === "137" ? USDC_E_ADDRESS : "");
  if (!toTokenAddress) {
    throw new Error("That token isn't available on the selected chain.");
  }

  const response = await fetchWithdrawalAddresses(
    {
      address: proxy,
      toChainId,
      toTokenAddress,
      // EVM/Solana recipient is validated in the side panel; passed through.
      recipientAddr: input.destination,
    },
    bridgeOptions()
  );
  const bridgeAddress = getAddress(response.address.evm) as Address;

  const amountRaw = parseUnits(input.amount, PUSD_DECIMALS);
  if (amountRaw <= 0n) throw new Error("Enter an amount greater than zero.");

  const transactions: RelayerTransaction[] = [
    {
      to: PUSD_ADDRESS as Address,
      data: encodeTransfer(bridgeAddress, amountRaw),
      value: "0",
    },
  ];

  const wallet = createBridgeWalletClient(eoa, input.tabId);
  const result =
    mode === "deposit"
      ? await executeViaDepositWallet(wallet, eoa, transactions)
      : await executeViaRelayer(wallet, eoa, transactions);

  return { txHash: result.txHash, bridgeAddress };
}
