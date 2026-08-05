/**
 * Fill and fee accounting for live execution: the pure helpers that turn a
 * live order outcome (fresh fill, idempotent replay, or block) into a
 * `PaperFill` audit row, and the fee-estimate math those rows depend on.
 * Everything here is side-effect-free; the submission machinery lives in
 * live-execution.ts.
 */
import { PUSD_DECIMALS } from "@knoww/shared-types/contracts";
import Decimal from "decimal.js";
import type { LiveOrderRecord, PaperFill, PaperOrderRequest } from "./types.ts";

export function toFilledFill(input: {
  request: PaperOrderRequest;
  status: "FILLED" | "PARTIALLY_FILLED";
  notionalUsd: Decimal;
  shares: Decimal;
  price: string;
  reason: string;
  /**
   * Taker fee debited on top of the notional for a BUY: the ACTUAL settled
   * fee when settlement was observed on-chain before this fill was built,
   * the preflight estimate otherwise. Market BUYs sign without `maxSpend`,
   * so the CLOB charges the fee in addition to the filled notional —
   * omitting it overstates remaining cash. SELL fees come out of the
   * proceeds, so this stays unset for SELLs.
   */
  feeUsd?: Decimal;
}): PaperFill {
  return {
    id: crypto.randomUUID(),
    runId: input.request.runId,
    watchlistItemId: input.request.watchlistItemId,
    tokenId: input.request.tokenId,
    status: input.status,
    side: input.request.action,
    price: input.price,
    notionalUsd: input.notionalUsd.toDecimalPlaces(6).toString(),
    shares: input.shares.toDecimalPlaces(6).toString(),
    cashAfterUsd:
      input.request.action === "SELL"
        ? new Decimal(input.request.portfolio.cashUsd)
            .add(input.notionalUsd)
            .toDecimalPlaces(6)
            .toString()
        : new Decimal(input.request.portfolio.cashUsd)
            .sub(input.notionalUsd)
            .sub(input.feeUsd ?? 0)
            .toDecimalPlaces(6)
            .toString(),
    reason: input.reason,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Best available ESTIMATE of the USD fee debited for a BUY: the preflight fee
 * reserve (curve quote when the market carried fee metadata, flat
 * FALLBACK_FEE_BPS otherwise), scaled by the fill ratio so a FAK partial
 * doesn't book the full-order fee. It is an estimate because the actual debit
 * is unobservable at fill time — `POST /order` reports no fee and no
 * fill/trade surface exists to read it back — and on the fallback path it can
 * understate the real fee on cheap outcomes (the curve reaches ~5–9% of
 * notional there; see MIN_MARKETABLE_BUY_TICKET_USD in shared trading.ts).
 */
export function estimatedBuyFeeUsd(input: {
  feeEstimateRaw: bigint | null;
  filledNotionalUsd: Decimal;
  requestedNotionalUsd: Decimal;
}): Decimal {
  if (input.feeEstimateRaw === null) return new Decimal(0);
  const fullFee = new Decimal(input.feeEstimateRaw.toString()).div(
    new Decimal(10).pow(PUSD_DECIMALS)
  );
  if (input.requestedNotionalUsd.lte(0)) return fullFee;
  const ratio = Decimal.min(
    1,
    input.filledNotionalUsd.div(input.requestedNotionalUsd)
  );
  return fullFee.mul(ratio);
}

export function blockedFill(
  request: PaperOrderRequest,
  reason: string
): PaperFill {
  return {
    id: crypto.randomUUID(),
    runId: request.runId,
    watchlistItemId: request.watchlistItemId,
    tokenId: request.tokenId,
    status: "BLOCKED",
    side: request.action,
    price: request.price,
    notionalUsd: "0",
    shares: "0",
    cashAfterUsd: request.portfolio.cashUsd,
    reason,
    createdAt: new Date().toISOString(),
  };
}

export function existingOrderToFill(
  existing: LiveOrderRecord,
  request: PaperOrderRequest
): PaperFill {
  // Map cached audit row back to a PaperFill so the caller flow is
  // identical to fresh submissions. Dry-runs report BLOCKED (no funds
  // moved); successful POSTs flip to FILLED once the CLOB confirms a fill.
  if (existing.status === "FILLED" || existing.status === "PARTIALLY_FILLED") {
    const notional = new Decimal(
      existing.filledNotionalUsd || existing.requestedSizeUsd
    );
    const shares = new Decimal(existing.filledShares || "0");
    return {
      id: existing.idempotencyKey,
      runId: existing.runId,
      watchlistItemId: existing.watchlistItemId,
      tokenId: existing.tokenId,
      // Preserve the partial/full distinction on idempotent replay so the
      // runner reduces vs closes the position consistently with the original.
      status:
        existing.status === "PARTIALLY_FILLED" ? "PARTIALLY_FILLED" : "FILLED",
      side: existing.side,
      price: existing.averageFillPrice ?? existing.price,
      notionalUsd: notional.toDecimalPlaces(6).toString(),
      shares: shares.gt(0)
        ? shares.toDecimalPlaces(6).toString()
        : notional.div(existing.price).toDecimalPlaces(6).toString(),
      cashAfterUsd:
        existing.side === "SELL"
          ? new Decimal(request.portfolio.cashUsd)
              .add(notional)
              .toDecimalPlaces(6)
              .toString()
          : // BUY fees are charged on top of the notional, not out of it.
            // Prefer the actual settled fee when reconciliation observed it;
            // fall back to the preflight estimate the original fill used.
            new Decimal(request.portfolio.cashUsd)
              .sub(notional)
              .sub(existing.settledFeeUsd ?? (existing.feeEstimateUsd || "0"))
              .toDecimalPlaces(6)
              .toString(),
      reason: `idempotent-replay:${existing.status}`,
      createdAt: existing.createdAt,
    };
  }
  return blockedFill(
    request,
    `idempotent-replay:${existing.status}${existing.error ? `:${existing.error}` : ""}`
  );
}

/**
 * True when `balanceSnapshotJson` carries a usable pre-submission balance
 * anchor — the prerequisite for deriving the actual settled fee from a later
 * balance read.
 */
export function hasPreSubmissionAnchor(
  balanceSnapshotJson: string | null
): boolean {
  if (!balanceSnapshotJson) return false;
  try {
    const parsed: unknown = JSON.parse(balanceSnapshotJson);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { preSubmission?: unknown }).preSubmission != null
    );
  } catch {
    return false;
  }
}

/**
 * A real BUY that filled but whose actual fee was never reconciled against a
 * settled balance: `settledFeeUsd` is still null despite the pre-submission
 * anchor needed to derive it. These are the candidates for the later-run
 * settlement reconciliation pass. The anchor guard keeps legacy rows written
 * before anchors existed from qualifying forever.
 */
export function isSettlementPendingLiveOrder(order: LiveOrderRecord): boolean {
  return (
    !order.dryRun &&
    order.side === "BUY" &&
    (order.status === "FILLED" || order.status === "PARTIALLY_FILLED") &&
    order.settledFeeUsd === null &&
    hasPreSubmissionAnchor(order.balanceSnapshotJson)
  );
}

/**
 * A live order that must block further live submissions, either because the
 * submission outcome itself is unknown (POSTED/UNKNOWN) or because its
 * settled fee is still pending reconciliation. Blocking keeps the wallet
 * quiet, which is what makes a later balance delta attributable to the
 * pending order. Dry-run rows never block. Mirrored in SQL by the D1
 * repository's hasUnresolvedLiveOrder.
 */
export function isUnresolvedLiveOrder(order: LiveOrderRecord): boolean {
  if (order.dryRun) return false;
  if (order.status === "POSTED" || order.status === "UNKNOWN") return true;
  return isSettlementPendingLiveOrder(order);
}
