// ============================================
// STREAM BET LOGIC — pure helpers for the compact stream betting widget
// ============================================
// No DOM, no globals: stake stepping, holding selection, sell readiness, and
// label/price formatting. Unit-testable in the node test env. The DOM builder
// (buildStreamBetting in ui.ts) imports these and renders around them.
// ============================================

import {
  balanceToNumber,
  hasDisplayPosition,
  positionValueUsd,
} from "./outcome-balances";

/** Dollar increment for the stream stake stepper. */
export const STREAM_STAKE_STEP = 1;

/** Floor for a stream stake (USD). Min order size (in shares) is enforced at
 *  placement; the stepper just keeps the amount at or above $1. */
export const STREAM_STAKE_MIN = 1;

/**
 * Clamp a USD stake to whole dollars within [min, ceiling]. A `max` of 0 (or any
 * non-positive value) means "no ceiling" — balance unknown / not funded, so the
 * user can dial in the amount they intend to deposit. When `max > 0` the ceiling
 * is the floored balance, but never below `min`.
 */
export function clampStake(
  stake: number,
  min = STREAM_STAKE_MIN,
  max = 0
): number {
  let next = Number.isFinite(stake) ? Math.round(stake) : min;
  if (max > 0) {
    const ceiling = Math.max(min, Math.floor(max));
    if (next > ceiling) next = ceiling;
  }
  if (next < min) next = min;
  return next;
}

/** Step a stake up (+1) or down (-1) by STREAM_STAKE_STEP, then clamp. */
export function stepStake(
  current: number,
  dir: 1 | -1,
  min = STREAM_STAKE_MIN,
  max = 0
): number {
  return clampStake(current + dir * STREAM_STAKE_STEP, min, max);
}

// ── Holding selection, sell readiness, and label/price formatting ─────────────

/** A single surfaced holding for the compact footer / collapsed pill. */
export type StreamHolding = {
  outcomeIndex: number;
  name: string;
  shares: number;
  sharesLabel: string;
  valueUsd: string; // "X.XX"
};

/** One candidate side to consider for the surfaced holding. */
export type HoldingCandidate = {
  outcomeIndex: number;
  name: string;
  balance: string; // decimal share string from getOutcomeBalances
  price: number; // current outcome price (0..1)
};

function formatShares(shares: number): string {
  return Number.isInteger(shares) ? String(shares) : shares.toFixed(1);
}

/**
 * Pick the single holding to surface: the larger-value side when both are held,
 * otherwise whichever side is a display position. Returns null when neither side
 * clears the display threshold.
 */
export function pickHolding(
  candidates: HoldingCandidate[]
): StreamHolding | null {
  let best: StreamHolding | null = null;
  let bestValue = -1;
  for (const c of candidates) {
    if (!hasDisplayPosition(c.balance)) continue;
    const valueUsd = positionValueUsd(c.balance, c.price);
    const value = Number(valueUsd);
    const wins =
      value > bestValue ||
      (value === bestValue &&
        best !== null &&
        c.outcomeIndex < best.outcomeIndex);
    if (wins) {
      bestValue = value;
      const shares = balanceToNumber(c.balance);
      best = {
        outcomeIndex: c.outcomeIndex,
        name: c.name,
        shares,
        sharesLabel: formatShares(shares),
        valueUsd,
      };
    }
  }
  return best;
}

/** Footer holding line, e.g. "5 FURIA · $3.00" (the "YOU HOLD" label is DOM). */
export function formatHoldingLine(h: StreamHolding): string {
  return `${h.sharesLabel} ${h.name} · $${h.valueUsd}`;
}

/** SELL action label, e.g. "Sell 5 FURIA · ~$3.00". */
export function sellButtonLabel(h: StreamHolding): string {
  return `Sell ${h.sharesLabel} ${h.name} · ~$${h.valueUsd}`;
}

/** Whether the held position is large enough to place a market sell. */
export function canSellHolding(
  h: StreamHolding | null,
  minOrderSize: number
): boolean {
  if (!h) return false;
  return h.shares >= Math.max(minOrderSize, 0);
}

/** Compact collapsed-pill price line, e.g. "FURIA 60¢ / MOUZ 41¢". */
export function formatPillPrices(
  outcomes: { name: string; price: number }[],
  max = 2
): string {
  return outcomes
    .slice(0, max)
    .map((o) => `${o.name} ${Math.round(o.price * 100)}¢`)
    .join(" / ");
}
