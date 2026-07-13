// apps/extension/src/funding/gateways/shared.ts
//
// Protocol helpers shared by every `FundingGateway` implementation: the
// runtime-message response envelope, background error-string → FundingError
// mapping, attempt-payload validation, and the gateway-boundary
// number→decimal-string conversions. Neutral home so neither surface's
// gateway imports from the other.
import Decimal from "decimal.js";
import { FundingGatewayError } from "../gateway";
import type { FundingAttempt, FundingAttemptPhase } from "../types";

/** The background `sendResponse` envelope every gateway message resolves to. */
export interface RuntimeResponse {
  ok?: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Maps a background/relayer error string onto a `FundingGatewayError`. The
 * *code* is what matters: the machine recomputes retryability from it
 * (`PENDING_RECONCILIATION`, `IDEMPOTENCY_FINGERPRINT_MISMATCH`,
 * `NO_CONTENT_TAB` → non-retryable; everything else → retryable
 * `EXECUTION_FAILED`). The raw message is carried through verbatim so the
 * renderer can format the final user-facing copy from `{ code, message }`.
 */
export function executionError(
  rawError: string | undefined
): FundingGatewayError {
  const message = rawError ?? "Could not complete the transaction.";
  if (rawError === "NO_CONTENT_TAB") {
    return new FundingGatewayError({
      code: "NO_CONTENT_TAB",
      message,
      retryable: false,
    });
  }
  if (rawError === "PENDING_RECONCILIATION") {
    return new FundingGatewayError({
      code: "PENDING_RECONCILIATION",
      message,
      retryable: false,
    });
  }
  if (
    rawError === "IDEMPOTENCY_FINGERPRINT_MISMATCH" ||
    rawError === "INVALID_IDEMPOTENCY_KEY"
  ) {
    return new FundingGatewayError({
      code: "IDEMPOTENCY_FINGERPRINT_MISMATCH",
      message,
      retryable: false,
    });
  }
  return new FundingGatewayError({
    code: "EXECUTION_FAILED",
    message,
    retryable: true,
  });
}

/**
 * The `KNOWW_PORTFOLIO_FUND_BEGIN_ATTEMPT` response is a `StoredFundAttempt`,
 * which is structurally a `FundingAttempt`. This validates + narrows the
 * untrusted runtime payload.
 */
export function toFundingAttempt(data: unknown): FundingAttempt | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const phase = record.phase;
  const validPhase =
    phase === "none" ||
    phase === "submitted" ||
    phase === "credited" ||
    phase === "reverted";
  if (
    typeof record.attemptId !== "string" ||
    typeof record.idempotencyKey !== "string" ||
    typeof record.fingerprint !== "string" ||
    (record.txHash !== null && typeof record.txHash !== "string") ||
    !validPhase
  ) {
    return null;
  }
  return {
    attemptId: record.attemptId,
    idempotencyKey: record.idempotencyKey,
    fingerprint: record.fingerprint,
    txHash: (record.txHash as string | null) ?? null,
    phase: phase as FundingAttemptPhase,
  };
}

/** Number → canonical decimal string, at the gateway boundary only. */
export function toDecimalString(value: number): string {
  return new Decimal(String(value)).toFixed();
}

/** USD-pegged symbols convert USD floors to token units 1:1. */
function isUsdPeggedSymbol(symbol: string): boolean {
  return /USD|DAI/i.test(symbol);
}

/**
 * Derives the minimum-deposit floor in TOKEN UNITS from the USD floor
 * (`minUsd`) and the token's implied price (`usdValue / balance`). The
 * machine enforces `FundingToken.minAmount` (token units) — it never sees
 * prices, so this conversion lives at the gateway boundary. Exported for
 * unit tests.
 *
 * - No USD floor → "0".
 * - USD-pegged symbols → the USD floor 1:1.
 * - Otherwise `minAmount = minUsd / (usdValue / balance)` (the baseline's
 *   price-ratio conversion) when both are known and positive.
 * - Price underivable (zero/unknown balance or USD value) → "0": no
 *   client-side floor; the background/bridge enforces the real minimum at
 *   execution.
 */
export function deriveDepositMinAmount(
  symbol: string,
  minUsd: string,
  usdValue: string,
  balance: string
): string {
  const minUsdDec = new Decimal(minUsd || "0");
  if (minUsdDec.lte(0)) return "0";
  if (isUsdPeggedSymbol(symbol)) return minUsdDec.toFixed();
  const usdValueDec = new Decimal(usdValue || "0");
  const balanceDec = new Decimal(balance || "0");
  if (usdValueDec.gt(0) && balanceDec.gt(0)) {
    return minUsdDec.mul(balanceDec).div(usdValueDec).toFixed();
  }
  return "0";
}
