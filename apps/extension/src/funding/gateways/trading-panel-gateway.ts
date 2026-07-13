// apps/extension/src/funding/gateways/trading-panel-gateway.ts
//
// Content trading-panel implementation of `FundingGateway`. It maps the pure
// funding controller's effects onto the panel's read-only bridge API reads
// (asset/address/quote lookups run fine in the content context) and the
// background's `KNOWW_PORTFOLIO_*` runtime messages for anything that MOVES
// money. The panel never signs and never sends a transaction itself — every
// transfer happens through the background service worker's viem path, which
// resolves the signing tab from the message sender (the content tab), so no
// tabId plumbing is needed here.
//
// Unlike the side panel, the content panel OWNS the passive bridge-address
// deposit flow (`loadBridgeAssets` / `resolveBridgeAddress` resolve real
// data), and it has no withdraw UI (those methods reject). It also has no
// executable cross-chain deposit source — the `loadTokens` "cross-chain"
// source falls back to the wallet list (the renderer never dispatches it).
import { createLogger } from "@knoww/logger";
import {
  type DepositAddress,
  getMinDepositForToken,
  isPusdToken,
  POLYGON_BRIDGE_CHAIN_ID,
  type QuoteRequest,
  type QuoteResponse,
  resolveWalletDepositRoute,
  type SupportedAsset,
} from "@knoww/shared-types/bridge";
import { PUSD_ADDRESS } from "@knoww/shared-types/contracts";
import Decimal from "decimal.js";
import { parseUnits } from "viem";
import { type FundingGateway, FundingGatewayError } from "../gateway";
import type { FundingTokenSource } from "../machine";
import type {
  FundingAttempt,
  FundingBridgeAsset,
  FundingCommand,
  FundingExecutionResult,
  FundingQuote,
  FundingQuoteRequest,
  FundingStatusResult,
  FundingToken,
} from "../types";
import {
  deriveDepositMinAmount,
  executionError,
  type RuntimeResponse,
  toDecimalString,
  toFundingAttempt,
} from "./shared";

const log = createLogger("funding.trading-panel-gateway");

/**
 * The panel's native wallet-token shape (`DepositToken`, from
 * `fetchEoaBalancesViaWallet`). Monetary fields are `number`s (plus an
 * optional raw base-unit `amountRaw`) — this is where the sole permitted
 * number→decimal-string bridge happens, at the gateway boundary.
 */
export interface TradingPanelWalletTokenSource {
  symbol: string;
  amount: number;
  amountRaw?: string;
  usdValue: number;
  address: string;
  decimals: number;
  depositSupported?: boolean;
  depositDisabledReason?: string;
}

export interface TradingPanelFundingGatewayDeps {
  sendRuntimeMessage(
    message: Record<string, unknown>
  ): Promise<RuntimeResponse>;
  /** The panel's EOA wallet balance loader (`fetchEoaBalancesViaWallet`). */
  loadWalletTokens(): Promise<TradingPanelWalletTokenSource[]>;
  /** Bridge supported-asset source (`fetchSupportedAssets`, read-only). */
  fetchSupportedAssets(): Promise<SupportedAsset[]>;
  /** Bridge deposit-address minting (`createDepositAddresses`, read-only). */
  createDepositAddresses(proxyAddress: string): Promise<DepositAddress[]>;
  /** Bridge quote source (`fetchQuote`, read-only). */
  fetchBridgeQuote(request: QuoteRequest): Promise<QuoteResponse>;
  /** The proxy (trading wallet) address — the deposit destination that
   * `createDepositAddresses` mints bridge addresses for. */
  getProxyAddress(): string | null;
  /** Waits for the on-chain receipt of a submitted deposit tx (content-side
   * read-only RPC). Resolves the confirmed status; rejects on timeout. */
  waitForTxReceipt(txHash: string): Promise<"success" | "reverted">;
  /** Polls the proxy balance until the deposited pUSD credits
   * (`refreshDepositBalanceUntilSynced`). Best-effort/bounded. */
  awaitBalanceCredit(): Promise<void>;
}

function mapWalletToken(
  token: TradingPanelWalletTokenSource,
  bridgeAssets: SupportedAsset[]
): FundingToken {
  // Prefer the raw base-unit balance when the source knows it (exact), else
  // fall back to the number amount as a decimal string.
  const balanceRaw = token.amountRaw ?? null;
  const balanceDisplay = new Decimal(String(token.amount)).toFixed();
  const usdValue = toDecimalString(token.usdValue);
  // pUSD is a direct same-chain transfer (no bridge minimum); every other
  // token carries the bridge's per-token USD floor.
  const isDirect = isPusdToken(token.symbol, token.address);
  const minUsd = isDirect
    ? "0"
    : toDecimalString(getMinDepositForToken(bridgeAssets, token.symbol));
  return {
    symbol: token.symbol,
    name: token.symbol,
    address: token.address,
    decimals: token.decimals,
    balanceRaw,
    balanceDisplay,
    usdValue,
    minUsd,
    minAmount: deriveDepositMinAmount(
      token.symbol,
      minUsd,
      usdValue,
      balanceDisplay
    ),
    depositSupported: token.depositSupported !== false,
    depositDisabledReason: token.depositDisabledReason ?? null,
  };
}

function mapBridgeAsset(asset: SupportedAsset): FundingBridgeAsset {
  return {
    chainId: asset.chainId,
    chainName: asset.chainName,
    symbol: asset.token.symbol,
    name: asset.token.name,
    address: asset.token.address,
    decimals: asset.token.decimals,
    minCheckoutUsd: toDecimalString(asset.minCheckoutUsd),
  };
}

/**
 * Maps the bridge fee breakdown onto the optional `FundingQuote.feeBreakdown`.
 * This is the sole number→decimal-string conversion point for itemized fees —
 * the machine and renderers only ever see the strings.
 */
function mapFeeBreakdown(
  fb: QuoteResponse["estFeeBreakdown"] | undefined
): FundingQuote["feeBreakdown"] {
  if (!fb) return undefined;
  return {
    gasUsd: toDecimalString(fb.gasUsd ?? 0),
    swapImpactUsd: toDecimalString(fb.swapImpactUsd ?? 0),
    appFeeUsd: toDecimalString(fb.appFeeUsd ?? 0),
    appFeeLabel: fb.appFeeLabel || "App fee",
    // Fraction → percent, pre-formatted to the baseline's 2 dp display.
    maxSlippagePct: new Decimal(String(fb.maxSlippage ?? 0))
      .mul(100)
      .toFixed(2),
    // Baseline displayed minReceived at 2 dp.
    minReceivedDisplay: new Decimal(String(fb.minReceived ?? 0)).toFixed(2),
  };
}

function mapQuote(quote: QuoteResponse): FundingQuote {
  const estOutputPusd = new Decimal(quote.estToTokenBaseUnit || "0")
    .div(1e6)
    .toFixed();
  return {
    quoteId: quote.quoteId,
    estOutputPusd,
    estInputUsd: toDecimalString(quote.estInputUsd),
    totalImpactUsd: toDecimalString(quote.estFeeBreakdown?.totalImpactUsd ?? 0),
    estCheckoutTimeMs: quote.estCheckoutTimeMs,
    estOutputDisplay: new Decimal(quote.estToTokenBaseUnit || "0")
      .div(1e6)
      .toFixed(2),
    estOutputSymbol: "pUSD",
    feeBreakdown: mapFeeBreakdown(quote.estFeeBreakdown),
  };
}

export function createTradingPanelFundingGateway(
  deps: TradingPanelFundingGatewayDeps
): FundingGateway {
  const {
    sendRuntimeMessage,
    loadWalletTokens,
    fetchSupportedAssets,
    createDepositAddresses,
    fetchBridgeQuote,
    getProxyAddress,
    waitForTxReceipt,
    awaitBalanceCredit,
  } = deps;

  // Read-only caches, mirroring the old panel's `depositBridgeAssets` /
  // `depositAddressesCache` module state. Deposit addresses are minted FOR a
  // specific proxy, so that cache is keyed by the proxy it was minted for —
  // an account switch while the panel stays open must never hand out the
  // previous account's bridge addresses.
  let bridgeAssetsCache: SupportedAsset[] | null = null;
  let depositAddressesCache: DepositAddress[] = [];
  let depositAddressesCacheProxy: string | null = null;

  async function loadBridgeAssetsCached(): Promise<SupportedAsset[]> {
    if (bridgeAssetsCache === null) {
      bridgeAssetsCache = await fetchSupportedAssets();
    }
    return bridgeAssetsCache;
  }

  async function loadDepositAddressesCached(): Promise<DepositAddress[]> {
    const proxyAddress = getProxyAddress();
    if (!proxyAddress) {
      throw new FundingGatewayError({
        code: "LOAD_FAILED",
        message: "Connect your wallet to get a deposit address.",
        retryable: false,
      });
    }
    if (
      depositAddressesCacheProxy !== proxyAddress ||
      depositAddressesCache.length === 0
    ) {
      depositAddressesCache = await createDepositAddresses(proxyAddress);
      depositAddressesCacheProxy = proxyAddress;
    }
    return depositAddressesCache;
  }

  /**
   * Resolves the Polygon bridge deposit address that a wallet-method deposit
   * of `tokenAddress` should send to (the quote recipient). Mirrors the old
   * `depositSelectToken` route resolution: pUSD is a direct transfer (no
   * bridge conversion, so no quote), everything else routes through the
   * matched Polygon bridge address. Returns null when there is no conversion
   * quote to fetch (direct pUSD or an unroutable token).
   */
  async function resolveWalletQuoteRecipient(
    tokenAddress: string
  ): Promise<string | null> {
    const proxyAddress = getProxyAddress();
    if (!proxyAddress) return null;
    // Empty symbol is fine: `resolveWalletDepositRoute` / `isPusdToken` /
    // `findSupportedBridgeAsset` all fall back to address matching, which
    // uniquely identifies the token for every ERC-20 in the wallet list.
    if (isPusdToken("", tokenAddress)) return null;
    const [assets, addresses] = await Promise.all([
      loadBridgeAssetsCached(),
      loadDepositAddressesCached(),
    ]);
    const route = resolveWalletDepositRoute({
      chainId: POLYGON_BRIDGE_CHAIN_ID,
      tokenSymbol: "",
      tokenAddress,
      recipientAddress: proxyAddress,
      supportedAssets: assets,
      depositAddresses: addresses,
    });
    if (!route || route.kind === "direct") return null;
    return route.depositAddress;
  }

  return {
    // The content panel has no executable cross-chain deposit source; the
    // "cross-chain" source falls back to the wallet list (the panel renderer
    // never dispatches it).
    async loadWalletTokens(
      _source?: FundingTokenSource
    ): Promise<FundingToken[]> {
      const [tokens, bridgeAssets] = await Promise.all([
        loadWalletTokens(),
        loadBridgeAssetsCached().catch(() => [] as SupportedAsset[]),
      ]);
      return tokens.map((token) => mapWalletToken(token, bridgeAssets));
    },

    async loadBridgeAssets(): Promise<FundingBridgeAsset[]> {
      const assets = await loadBridgeAssetsCached();
      return assets
        .filter(
          (asset) => !isPusdToken(asset.token.symbol, asset.token.address)
        )
        .map(mapBridgeAsset);
    },

    async resolveBridgeAddress(asset: FundingBridgeAsset): Promise<string> {
      const addresses = await loadDepositAddressesCached();
      // Existing matching logic (chainId + tokenSymbol, else chainId).
      const matching =
        addresses.find(
          (a) => a.chainId === asset.chainId && a.tokenSymbol === asset.symbol
        ) || addresses.find((a) => a.chainId === asset.chainId);
      if (!matching) {
        throw new FundingGatewayError({
          code: "LOAD_FAILED",
          message: "Failed to get bridge address.",
          retryable: false,
        });
      }
      return matching.depositAddress;
    },

    // Deposit preview quote. The recipient is the resolved Polygon bridge
    // deposit address (mirrors `depositFetchQuote`). Direct pUSD / unroutable
    // tokens have no conversion, so there is no quote to show.
    async fetchQuote(input: FundingQuoteRequest): Promise<FundingQuote> {
      const recipient = await resolveWalletQuoteRecipient(input.tokenAddress);
      if (!recipient) {
        throw new FundingGatewayError({
          code: "QUOTE_FAILED",
          message: "No conversion quote for this token.",
          retryable: false,
        });
      }
      const quote = await fetchBridgeQuote({
        fromAmountBaseUnit: parseUnits(
          input.amount,
          input.tokenDecimals
        ).toString(),
        fromChainId: "137",
        fromTokenAddress: input.tokenAddress,
        recipientAddress: recipient,
        toChainId: "137",
        toTokenAddress: PUSD_ADDRESS,
      });
      return mapQuote(quote);
    },

    async beginAttempt(command: FundingCommand): Promise<FundingAttempt> {
      if (command.flow !== "deposit") {
        throw new FundingGatewayError({
          code: "EXECUTION_FAILED",
          message: "Withdrawals are not supported on this surface.",
          retryable: false,
        });
      }
      const response = await sendRuntimeMessage({
        type: "KNOWW_PORTFOLIO_FUND_BEGIN_ATTEMPT",
        action: "deposit",
        address: command.address,
        walletMode: command.walletMode,
        amount: command.amount,
        chainId: command.chainId,
        tokenSymbol: command.tokenSymbol,
        tokenAddress: command.tokenAddress,
        tokenDecimals: command.tokenDecimals,
      });
      if (!response.ok) throw executionError(response.error);
      const attempt = toFundingAttempt(response.data);
      if (!attempt) {
        throw new FundingGatewayError({
          code: "EXECUTION_FAILED",
          message: "Could not start the deposit.",
          retryable: true,
        });
      }
      return attempt;
    },

    async execute(
      command: FundingCommand,
      attempt: FundingAttempt
    ): Promise<FundingExecutionResult> {
      if (command.flow !== "deposit") {
        throw new FundingGatewayError({
          code: "EXECUTION_FAILED",
          message: "Withdrawals are not supported on this surface.",
          retryable: false,
        });
      }
      // The background derives the proxy + resolves the bridge deposit address
      // itself, switches the wallet to the source chain, and signs through the
      // sender's content tab. The panel NEVER signs or sends a transaction.
      const response = await sendRuntimeMessage({
        type: "KNOWW_PORTFOLIO_DEPOSIT",
        address: command.address,
        walletMode: command.walletMode,
        amount: command.amount,
        idempotencyKey: attempt.idempotencyKey,
        attemptId: attempt.attemptId,
        chainId: command.chainId,
        tokenSymbol: command.tokenSymbol,
        tokenAddress: command.tokenAddress,
        tokenDecimals: command.tokenDecimals,
      });
      if (!response.ok) throw executionError(response.error);
      // The background returns `{ txHash, bridgeAddress }`; the credit poll
      // only needs the txHash (revert check) + balance sync.
      const data = response.data as { txHash?: string } | undefined;
      return { txHash: data?.txHash ?? "" };
    },

    // On-chain receipt first (revert → "reverted"); once confirmed, poll the
    // proxy balance until the deposited pUSD credits, then report "credited".
    // A submitted-but-unconfirmed on-chain tx cannot revert money twice, so a
    // balance-sync timeout still resolves optimistically credited (the
    // background portfolio refresh reconciles) — never a false "reverted".
    async awaitDepositCredit(
      attempt: FundingAttempt
    ): Promise<"credited" | "reverted"> {
      const txHash = attempt.txHash;
      if (!txHash) return "credited";
      const receipt = await waitForTxReceipt(txHash);
      if (receipt === "reverted") return "reverted";
      try {
        await awaitBalanceCredit();
      } catch (reason) {
        log.error("awaitBalanceCredit.rejected", reason);
      }
      return "credited";
    },

    async pollWithdrawStatus(): Promise<FundingStatusResult> {
      throw new FundingGatewayError({
        code: "EXECUTION_FAILED",
        message: "Withdrawals are not supported on this surface.",
        retryable: false,
      });
    },

    async completeAttempt(
      attempt: FundingAttempt,
      outcome: "credited" | "reverted"
    ): Promise<void> {
      const response = await sendRuntimeMessage({
        type: "KNOWW_PORTFOLIO_FUND_COMPLETE_ATTEMPT",
        attemptId: attempt.attemptId,
        idempotencyKey: attempt.idempotencyKey,
        outcome,
      });
      if (!response.ok) {
        throw new FundingGatewayError({
          code: "EXECUTION_FAILED",
          message: response.error || "Could not finalize the attempt.",
          retryable: false,
        });
      }
    },
  };
}
