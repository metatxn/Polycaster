// apps/extension/src/funding/gateways/sidepanel-gateway.ts
//
// Side-panel implementation of `FundingGateway`. It maps the pure funding
// controller's effects onto the side panel's existing background runtime
// messages (`KNOWW_PORTFOLIO_*`). The side panel never signs and never moves
// money itself — every transfer happens through the background service worker.
//
// The PASSIVE bridge-address deposit flow does NOT exist in the side panel
// (the content trading panel owns it), so `loadBridgeAssets` /
// `resolveBridgeAddress` reject with `LOAD_FAILED`; the side-panel renderer
// therefore never dispatches `SELECT_METHOD "bridge"`. The side panel's
// "Transfer Crypto" method is instead an EXECUTABLE cross-chain deposit
// (`executePortfolioDeposit` switches chains and signs with the user's
// wallet), modeled as the wallet method with `loadTokens` source
// "cross-chain" — see `loadWalletTokens` below.
import { logInfo, logWarn } from "@knoww/logger";
import {
  isPusdToken,
  type QuoteResponse,
  SOLANA_CHAIN_ID,
  type SupportedAsset,
} from "@knoww/shared-types/bridge";
import { formatPortfolioTokenBaseUnitAmount } from "../../background/portfolio-withdraw-flow";
import { EXTENSION_AUTH_REQUIRED_ERROR } from "../../types/chrome-messages";
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

/**
 * The side panel's native wallet-token shape (`PortfolioWalletToken`). Its
 * monetary fields are `number`s — this is where the sole permitted
 * number→decimal-string bridge happens, at the gateway boundary (see
 * `mapWalletToken`).
 */
export interface SidepanelWalletTokenSource {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  amount: number;
  usdValue: number;
  minUsd: number;
  depositSupported?: boolean;
  depositDisabledReason?: string;
}

/** The live withdraw form, already validated by the side panel. */
export interface SidepanelWithdrawFormParams {
  amount: string;
  destination: string;
  chainKey: string;
  tokenId: string;
}

export interface SidepanelFundingGatewayDeps {
  sendRuntimeMessage(
    message: Record<string, unknown>
  ): Promise<RuntimeResponse>;
  /** The side panel's existing token source (`KNOWW_PORTFOLIO_WALLET_TOKENS`). */
  loadWalletTokens(): Promise<SidepanelWalletTokenSource[]>;
  /** The side panel's existing bridge-asset source
   * (`KNOWW_PORTFOLIO_BRIDGE_ASSETS`, cached) — backs the executable
   * cross-chain "Transfer Crypto" deposit token list. */
  loadCrossChainAssets(): Promise<SupportedAsset[]>;
  /** The side panel's CURRENT deposit token source, used when a `loadTokens`
   * effect carries no `source` (re-loads, e.g. BACK from the amount step). */
  defaultTokenSource(): FundingTokenSource;
  /** Re-run the knoww.app sign-in challenge in the content tab, then report
   * whether a fresh session is available. Mirrors `reauthPortfolioSession`. */
  reauthSession(address: string): Promise<{ ok: boolean; error?: string }>;
  /** Reads the live withdraw form (chain/token/destination/amount). Returns
   * `null` when the form is incomplete/invalid, which makes `fetchQuote`
   * reject `QUOTE_FAILED` — the same "quote unavailable" gate the old inline
   * preview enforced before submit. */
  readWithdrawParams(): SidepanelWithdrawFormParams | null;
}

const AMBIGUOUS_MESSAGE =
  "We could not confirm the transaction status. Your funds have not been moved twice.";

/** Mirrors `isAuthRequiredError` in the side panel. */
function isAuthRequiredError(error?: string): boolean {
  if (!error) return false;
  return (
    error === EXTENSION_AUTH_REQUIRED_ERROR ||
    error.toLowerCase().includes("auth required")
  );
}

function mapWalletToken(token: SidepanelWalletTokenSource): FundingToken {
  const balanceDisplay = toDecimalString(token.amount);
  const usdValue = toDecimalString(token.usdValue);
  const minUsd = toDecimalString(token.minUsd);
  return {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    decimals: token.decimals,
    // The side-panel source carries no raw base-unit balance.
    balanceRaw: null,
    // The sole permitted number→string bridge (brief), documented here.
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

/**
 * Maps a bridge `SupportedAsset` to an executable cross-chain deposit
 * `FundingToken`. Mirrors the baseline deposit dropdowns: Solana sources and
 * pUSD itself are excluded (the EVM wallet signs the source transfer), the
 * wallet balance on the source chain is unknown (`balanceDisplay: ""` — the
 * machine skips its over-balance check), and `minCheckoutUsd` is a plain
 * number on the wire, converted at this boundary only. With no balance or
 * usdValue, `deriveDepositMinAmount` yields the USD floor for USD-pegged
 * symbols and "0" (no client floor; bridge enforces) for everything else —
 * the baseline bridge form had no minimum check at all.
 */
function mapCrossChainAssets(assets: SupportedAsset[]): FundingToken[] {
  const tokens: FundingToken[] = [];
  for (const asset of assets) {
    if (asset.chainId === SOLANA_CHAIN_ID) continue;
    if (isPusdToken(asset.token.symbol, asset.token.address)) continue;
    const minCheckoutUsd = toDecimalString(asset.minCheckoutUsd);
    tokens.push({
      symbol: asset.token.symbol,
      name: asset.token.name,
      address: asset.token.address,
      decimals: asset.token.decimals,
      chainId: asset.chainId,
      balanceRaw: null,
      balanceDisplay: "",
      usdValue: "0",
      minUsd: minCheckoutUsd,
      minAmount: deriveDepositMinAmount(
        asset.token.symbol,
        minCheckoutUsd,
        "0",
        ""
      ),
      depositSupported: true,
      depositDisabledReason: null,
    });
  }
  return tokens;
}

export function createSidepanelFundingGateway(
  deps: SidepanelFundingGatewayDeps
): FundingGateway {
  const {
    sendRuntimeMessage,
    loadWalletTokens,
    loadCrossChainAssets,
    defaultTokenSource,
    reauthSession,
    readWithdrawParams,
  } = deps;

  /**
   * Sends a deposit/withdraw execution message, retrying once through the
   * knoww.app re-auth challenge when the relayer pre-flight reports a stale
   * session (mirrors the old `submitPortfolioFund` retry loop).
   */
  async function sendWithReauth(
    address: string,
    build: () => Record<string, unknown>
  ): Promise<RuntimeResponse> {
    let response = await sendRuntimeMessage(build());
    if (!response.ok && isAuthRequiredError(response.error)) {
      const reauth = await reauthSession(address);
      if (!reauth.ok) {
        throw executionError(reauth.error ?? undefined);
      }
      response = await sendRuntimeMessage(build());
    }
    return response;
  }

  async function executeDeposit(
    command: Extract<FundingCommand, { flow: "deposit" }>,
    attempt: FundingAttempt
  ): Promise<FundingExecutionResult> {
    const response = await sendWithReauth(command.address, () => ({
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
    }));
    if (!response.ok) throw executionError(response.error);
    const data = response.data as { txHash?: string } | undefined;
    return { txHash: data?.txHash ?? "" };
  }

  async function executeWithdraw(
    command: Extract<FundingCommand, { flow: "withdraw" }>,
    attempt: FundingAttempt
  ): Promise<FundingExecutionResult> {
    // Mirror the old submit flow: re-quote immediately before executing and
    // pass the fresh quote to the background handler (direct route may return
    // no quote — that is fine).
    logInfo("portfolio.withdraw.ui.submit.request", {
      ownerAddress: command.address,
      walletMode: command.walletMode,
      amount: command.amount,
      chainKey: command.chainKey,
      tokenId: command.tokenId,
      recipientAddress: command.destination,
    });
    const quoteResponse = await sendRuntimeMessage({
      type: "KNOWW_PORTFOLIO_WITHDRAW_QUOTE",
      amount: command.amount,
      destination: command.destination,
      chainKey: command.chainKey,
      tokenId: command.tokenId,
    });
    if (!quoteResponse.ok) {
      throw new FundingGatewayError({
        code: "EXECUTION_FAILED",
        message: quoteResponse.error || "Could not prepare the withdrawal.",
        retryable: true,
      });
    }
    const quote = (quoteResponse.data as { quote?: unknown } | undefined)
      ?.quote;

    const response = await sendWithReauth(command.address, () => ({
      type: "KNOWW_PORTFOLIO_WITHDRAW",
      address: command.address,
      walletMode: command.walletMode,
      amount: command.amount,
      idempotencyKey: attempt.idempotencyKey,
      attemptId: attempt.attemptId,
      destination: command.destination,
      chainKey: command.chainKey,
      tokenId: command.tokenId,
      ...(quote ? { quote } : {}),
    }));
    if (!response.ok) {
      logWarn("portfolio.withdraw.ui.submit.failed", {
        error: response.error,
        ownerAddress: command.address,
        walletMode: command.walletMode,
        amount: command.amount,
        chainKey: command.chainKey,
        tokenId: command.tokenId,
        recipientAddress: command.destination,
      });
      throw executionError(response.error);
    }
    const data = response.data as
      | { bridgeAddress?: string; route?: "bridge" | "direct" }
      | undefined;
    logInfo("portfolio.withdraw.ui.submit.response", {
      bridgeAddress: data?.bridgeAddress,
      route: data?.route,
      recipientAddress: command.destination,
    });
    // The machine's `attempt.txHash` is our withdraw status handle:
    //  - bridge route → the bridge deposit address (polled below),
    //  - direct route → the `"direct"` sentinel (status resolves immediately).
    const txHash =
      data?.route === "direct" ? "direct" : (data?.bridgeAddress ?? "direct");
    return { txHash };
  }

  return {
    async loadWalletTokens(
      source?: FundingTokenSource
    ): Promise<FundingToken[]> {
      // The effect only carries `source` when SELECT_METHOD supplied it;
      // re-loads (BACK from the amount step) fall back to the side panel's
      // current source so a cross-chain flow never flips to the wallet list.
      const resolved = source ?? defaultTokenSource();
      if (resolved === "cross-chain") {
        return mapCrossChainAssets(await loadCrossChainAssets());
      }
      const tokens = await loadWalletTokens();
      return tokens.map(mapWalletToken);
    },

    // Side panel has no passive bridge-address deposit UI.
    async loadBridgeAssets(): Promise<FundingBridgeAsset[]> {
      throw new FundingGatewayError({
        code: "LOAD_FAILED",
        message: "Bridge deposits are not available in the side panel.",
        retryable: false,
      });
    },

    async resolveBridgeAddress(): Promise<string> {
      throw new FundingGatewayError({
        code: "LOAD_FAILED",
        message: "Bridge deposits are not available in the side panel.",
        retryable: false,
      });
    },

    // Only ever called for withdrawals in the side panel (deposit shows no
    // quote preview, so the machine's deposit quote path is unused). The
    // machine emits `tokenDecimals: 0` as a sentinel for withdraw quotes and
    // supplies no destination/chainKey, so the request payload is ignored and
    // the live withdraw form is authoritative instead.
    async fetchQuote(_input: FundingQuoteRequest): Promise<FundingQuote> {
      const params = readWithdrawParams();
      if (!params) {
        throw new FundingGatewayError({
          code: "QUOTE_FAILED",
          message: "Enter valid withdrawal details.",
          retryable: false,
        });
      }
      logInfo("portfolio.withdraw.ui.quote.request", {
        amount: params.amount,
        chainKey: params.chainKey,
        tokenId: params.tokenId,
        recipientAddress: params.destination,
      });
      const response = await sendRuntimeMessage({
        type: "KNOWW_PORTFOLIO_WITHDRAW_QUOTE",
        amount: params.amount,
        destination: params.destination,
        chainKey: params.chainKey,
        tokenId: params.tokenId,
      });
      if (!response.ok) {
        logWarn("portfolio.withdraw.ui.quote.failed", {
          error: response.error,
          amount: params.amount,
          chainKey: params.chainKey,
          tokenId: params.tokenId,
          recipientAddress: params.destination,
        });
        throw new FundingGatewayError({
          code: "QUOTE_FAILED",
          message: response.error || "Quote unavailable",
          retryable: false,
        });
      }
      // The preview fields (fee/time/output) feed the confirm-step quote
      // preview; the EXECUTABLE quote is still re-fetched in
      // `executeWithdraw` immediately before money moves.
      const payload = response.data as
        | {
            quote?: QuoteResponse;
            destination?: { tokenSymbol?: string; tokenDecimals?: number };
          }
        | undefined;
      const quote = payload?.quote;
      const destination = payload?.destination;
      const estOutputDisplay =
        quote?.estToTokenBaseUnit !== undefined &&
        typeof destination?.tokenDecimals === "number"
          ? formatPortfolioTokenBaseUnitAmount(
              quote.estToTokenBaseUnit,
              destination.tokenDecimals
            )
          : undefined;
      return {
        quoteId: quote?.quoteId || "sidepanel-withdraw-quote",
        estOutputPusd: "0",
        estInputUsd: params.amount,
        // Number → decimal string at the gateway boundary only.
        totalImpactUsd: toDecimalString(
          quote?.estFeeBreakdown?.totalImpactUsd ?? 0
        ),
        estCheckoutTimeMs: quote?.estCheckoutTimeMs,
        estOutputDisplay,
        estOutputSymbol: destination?.tokenSymbol,
      };
    },

    async beginAttempt(command: FundingCommand): Promise<FundingAttempt> {
      const message: Record<string, unknown> =
        command.flow === "deposit"
          ? {
              type: "KNOWW_PORTFOLIO_FUND_BEGIN_ATTEMPT",
              action: "deposit",
              address: command.address,
              walletMode: command.walletMode,
              amount: command.amount,
              chainId: command.chainId,
              tokenSymbol: command.tokenSymbol,
              tokenAddress: command.tokenAddress,
              tokenDecimals: command.tokenDecimals,
            }
          : {
              type: "KNOWW_PORTFOLIO_FUND_BEGIN_ATTEMPT",
              action: "withdraw",
              address: command.address,
              walletMode: command.walletMode,
              amount: command.amount,
              destination: command.destination,
              chainKey: command.chainKey,
              tokenId: command.tokenId,
            };
      const response = await sendRuntimeMessage(message);
      if (!response.ok) throw executionError(response.error);
      const attempt = toFundingAttempt(response.data);
      if (!attempt) {
        throw new FundingGatewayError({
          code: "EXECUTION_FAILED",
          message: "Could not start the transaction.",
          retryable: true,
        });
      }
      return attempt;
    },

    execute(
      command: FundingCommand,
      attempt: FundingAttempt
    ): Promise<FundingExecutionResult> {
      return command.flow === "deposit"
        ? executeDeposit(command, attempt)
        : executeWithdraw(command, attempt);
    },

    // The side panel has no on-chain deposit-credit confirmation today: the
    // legacy flow optimistically reports "Deposit submitted" and lets the
    // background portfolio refresh reconcile the balance. We preserve that by
    // treating a submitted deposit as credited; the `done` renderer schedules
    // the same background refreshes the old flow scheduled.
    async awaitDepositCredit(): Promise<"credited" | "reverted"> {
      return "credited";
    },

    async pollWithdrawStatus(
      attempt: FundingAttempt
    ): Promise<FundingStatusResult> {
      const bridgeAddress = attempt.txHash;
      // Direct-route withdrawals (and the rare bridge response without an
      // address) have no bridge to poll — treat them as settled.
      if (!bridgeAddress || bridgeAddress === "direct") {
        return { status: "completed", detail: null };
      }
      const response = await sendRuntimeMessage({
        type: "KNOWW_PORTFOLIO_WITHDRAW_STATUS",
        bridgeAddress,
      });
      if (!response.ok) {
        // Transport failure — surface it so the controller retries (and, after
        // its bounded give-up, reports AMBIGUOUS_OUTCOME).
        throw new FundingGatewayError({
          code: "AMBIGUOUS_OUTCOME",
          message: AMBIGUOUS_MESSAGE,
          retryable: true,
        });
      }
      const summary = (
        response.data as
          | {
              summary?: {
                completed?: boolean;
                failed?: boolean;
                text?: string;
              };
            }
          | undefined
      )?.summary;
      if (!summary) return { status: "pending", detail: null };
      if (summary.completed) return { status: "completed", detail: null };
      if (summary.failed) {
        return {
          status: "failed",
          detail: "Bridge failed. Try a smaller amount or retry later.",
        };
      }
      return { status: "pending", detail: summary.text ?? null };
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
      // Fire-and-forget from the controller's perspective; a failure here must
      // not change UI state, but surface it so the controller can log it.
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
