// apps/extension/src/funding/gateway.ts
// Gateway boundary between the pure funding machine/controller and whatever
// surface (sidepanel, content script) actually talks to chrome.* / the
// background service worker. Verbatim from the Task 3 brief (plus the
// additive loadWalletTokens `source` parameter for cross-chain deposits).
import type { FundingTokenSource } from "./machine";
import type {
  FundingAttempt,
  FundingBridgeAsset,
  FundingCommand,
  FundingError,
  FundingExecutionResult,
  FundingQuote,
  FundingQuoteRequest,
  FundingStatusResult,
  FundingToken,
} from "./types";

export interface FundingGateway {
  /**
   * Loads the deposit token list. `source` is threaded from the machine's
   * `loadTokens` effect; it is absent on re-loads (BACK from the amount
   * step), where the gateway falls back to its surface's current source.
   */
  loadWalletTokens(source?: FundingTokenSource): Promise<FundingToken[]>;
  loadBridgeAssets(): Promise<FundingBridgeAsset[]>;
  resolveBridgeAddress(asset: FundingBridgeAsset): Promise<string>;
  fetchQuote(input: FundingQuoteRequest): Promise<FundingQuote>;
  /** Background-only. Allocates or resumes the attempt for this command. */
  beginAttempt(command: FundingCommand): Promise<FundingAttempt>;
  /** Background-only. Executes via KNOWW_PORTFOLIO_DEPOSIT / _WITHDRAW. */
  execute(
    command: FundingCommand,
    attempt: FundingAttempt
  ): Promise<FundingExecutionResult>;
  awaitDepositCredit(attempt: FundingAttempt): Promise<"credited" | "reverted">;
  pollWithdrawStatus(attempt: FundingAttempt): Promise<FundingStatusResult>;
  /** Background-only. Marks the attempt terminal. */
  completeAttempt(
    attempt: FundingAttempt,
    outcome: "credited" | "reverted"
  ): Promise<void>;
}

/** Gateways throw FundingGatewayError; anything else becomes a generic code. */
export class FundingGatewayError extends Error {
  readonly funding: FundingError;
  constructor(funding: FundingError) {
    super(funding.message);
    this.name = "FundingGatewayError";
    this.funding = funding;
  }
}
