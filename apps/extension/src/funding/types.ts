// apps/extension/src/funding/types.ts
// Canonical funding DTOs. Both surfaces map their local models into these at
// the gateway boundary; the machine never sees surface-specific shapes.
// Monetary values are decimal strings or raw base-unit strings — never number.

export type FundingFlow = "deposit" | "withdraw";
export type FundingMethod = "wallet" | "bridge";

export interface FundingToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  /**
   * Source chain for an executable deposit of this token. Absent for the
   * default wallet flow (Polygon, "137"); set per-token by cross-chain
   * deposit sources.
   */
  chainId?: string;
  /** Raw base units as string, when the source knows it; else null. */
  balanceRaw: string | null;
  /**
   * Human decimal string, e.g. "12.5". Empty string means the balance is
   * UNKNOWN (e.g. a cross-chain source wallet we cannot read) — the machine
   * skips its over-balance check in that case.
   */
  balanceDisplay: string;
  /** USD estimate as decimal string; "0" when unknown. */
  usdValue: string;
  /** Minimum deposit in USD as decimal string; "0" when none. Display/copy
   * only — enforcement uses `minAmount` (token units). */
  minUsd: string;
  /**
   * Minimum deposit DENOMINATED IN TOKEN UNITS, decimal string; "0" when no
   * floor applies or the token's USD price cannot be derived (in which case
   * the background/bridge enforces the real minimum at execution). Computed
   * at the gateway boundary — the machine never sees prices.
   */
  minAmount: string;
  depositSupported: boolean;
  depositDisabledReason: string | null;
}

export interface FundingBridgeAsset {
  chainId: string;
  chainName: string;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  /** Decimal string. */
  minCheckoutUsd: string;
}

export interface FundingQuoteRequest {
  tokenAddress: string;
  tokenDecimals: number;
  /** Human decimal string. */
  amount: string;
}

/**
 * Optional itemized fee breakdown for a deposit quote. All values are decimal
 * strings, converted from the bridge `QuoteResponse.estFeeBreakdown` numbers
 * AT THE GATEWAY BOUNDARY ONLY (the machine and renderers never see the raw
 * numbers). Populated by the trading-panel gateway; the side panel's baseline
 * never itemized fees, so its gateway leaves this undefined and renderers
 * fall back to the aggregate `totalImpactUsd`.
 */
export interface FundingQuoteFeeBreakdown {
  /** Gas cost in USD, decimal string. */
  gasUsd: string;
  /** Swap price impact in USD, decimal string. */
  swapImpactUsd: string;
  /** Application fee in USD, decimal string. */
  appFeeUsd: string;
  /** Display label for the app fee row (e.g. "App fee"). */
  appFeeLabel: string;
  /** Maximum slippage as a PERCENT decimal string (e.g. "0.50" = 0.5%). */
  maxSlippagePct: string;
  /** Minimum received output, display-formatted decimal string (pUSD). */
  minReceivedDisplay: string;
}

export interface FundingQuote {
  quoteId: string;
  /** Estimated pUSD out, decimal string. */
  estOutputPusd: string;
  /** Estimated USD in, decimal string. */
  estInputUsd: string;
  /** Total fee impact in USD, decimal string. */
  totalImpactUsd: string;
  /** Estimated completion time in milliseconds, when the source knows it. */
  estCheckoutTimeMs?: number;
  /** Formatted destination-token output amount (withdraw preview). */
  estOutputDisplay?: string;
  /** Destination token symbol for `estOutputDisplay`. */
  estOutputSymbol?: string;
  /** Itemized fees, when the quote source provides them (deposit preview). */
  feeBreakdown?: FundingQuoteFeeBreakdown;
}

export type FundingCommand =
  | {
      flow: "deposit";
      address: string;
      walletMode?: string;
      amount: string;
      chainId: string;
      tokenSymbol: string;
      tokenAddress: string;
      tokenDecimals: number;
    }
  | {
      flow: "withdraw";
      address: string;
      walletMode?: string;
      amount: string;
      destination: string;
      chainKey: string;
      tokenId: string;
    };

export type FundingAttemptPhase =
  | "none" // allocated, nothing executed
  | "submitted" // execute returned a txHash; receipt unknown
  | "credited" // terminal success
  | "reverted"; // terminal failure (confirmed on-chain revert)

export interface FundingAttempt {
  attemptId: string;
  idempotencyKey: string;
  fingerprint: string;
  txHash: string | null;
  phase: FundingAttemptPhase;
}

export interface FundingExecutionResult {
  txHash: string;
}

export type FundingErrorCode =
  | "PENDING_RECONCILIATION"
  | "IDEMPOTENCY_FINGERPRINT_MISMATCH"
  | "NO_CONTENT_TAB"
  | "VALIDATION"
  | "LOAD_FAILED"
  | "QUOTE_FAILED"
  | "EXECUTION_FAILED"
  | "REVERTED"
  | "AMBIGUOUS_OUTCOME";

export interface FundingError {
  code: FundingErrorCode;
  message: string;
  retryable: boolean;
}

export interface FundingStatusResult {
  status: "pending" | "completed" | "failed";
  detail: string | null;
}
