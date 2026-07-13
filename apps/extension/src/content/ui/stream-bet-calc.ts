// ============================================
// STREAM BET LOGIC — pure helpers for the compact stream betting widget
// ============================================
// No DOM, no globals: stake stepping, holding selection, sell readiness, and
// label/price formatting. Unit-testable in the node test env. The DOM builder
// (buildStreamBetting in ui.ts) imports these and renders around them.
// ============================================

import {
  parseGammaNumberArray,
  parseGammaStringArray,
} from "@knoww/shared-types/polymarket";
import { Decimal } from "decimal.js";
import type { Market, NestedMarket } from "../../types/market";
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

/** Parse a manually-entered stream stake into the whole-dollar model. */
export function parseStreamStakeInput(
  raw: string,
  min = STREAM_STAKE_MIN
): number | null {
  const normalized = raw.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (!normalized) return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;

  try {
    const amount = new Decimal(normalized);
    if (!amount.isFinite()) return null;
    const rounded = amount.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return Decimal.max(rounded, min).toNumber();
  } catch {
    return null;
  }
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

export type PrimarySportsMoneyline = {
  outcomes: string[];
  prices: number[];
  marketIndex: number;
  multiOutcomeData?: PrimarySportsMoneylineOption[];
};

export type PrimarySportsMoneylineOption = {
  name: string;
  price: number;
  marketIndex: number;
  conditionId?: string;
};

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseProbabilityArray(raw: NestedMarket["outcomePrices"]): number[] {
  return parseGammaNumberArray(raw).map(clampProbability);
}

function isActiveMarket(market: NestedMarket): boolean {
  return (
    market.active !== false &&
    market.closed !== true &&
    market.archived !== true &&
    market.acceptingOrders !== false
  );
}

function hasSportsMarketSignals(nested: NestedMarket[]): boolean {
  return nested.some(
    (m) =>
      Boolean(m.sportsMarketType) ||
      Boolean(m.gameStartTime) ||
      m.acceptingOrders !== undefined ||
      m.enableOrderBook !== undefined
  );
}

function isYesNoPair(outcomes: readonly string[]): boolean {
  return (
    outcomes.length === 2 &&
    outcomes[0].toLowerCase() === "yes" &&
    outcomes[1].toLowerCase() === "no"
  );
}

function yesPriceForMoneylineSibling(market: NestedMarket): number | null {
  const outcomes = parseGammaStringArray(market.outcomes);
  if (!isYesNoPair(outcomes)) return null;

  const prices = parseProbabilityArray(market.outcomePrices);
  return prices.length >= 1 ? prices[0] : null;
}

function normalizeMoneylineSiblingLabel(label: string): string {
  const trimmed = label.trim();
  const withoutParenthetical = trimmed.replace(/\s*\([^)]*\)\s*$/u, "").trim();
  return withoutParenthetical || trimmed;
}

function isDerivativeSportsMarket(market: NestedMarket): boolean {
  const label = [
    market.sportsMarketType,
    market.groupItemTitle,
    market.question,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    /\b(over|under|handicap|spread|total|o\/u|completed\s+match)\b/i.test(
      label
    ) ||
    /\b(?:map|set)\s*\d+\b/i.test(label) ||
    /_(?:map|set)_/i.test(label)
  );
}

function isPrimaryMoneylineCandidate(
  nestedMarket: NestedMarket,
  eventTitle: string
): boolean {
  if (!isActiveMarket(nestedMarket) || isDerivativeSportsMarket(nestedMarket)) {
    return false;
  }

  const outcomes = parseGammaStringArray(nestedMarket.outcomes);
  const prices = parseProbabilityArray(nestedMarket.outcomePrices);
  if (outcomes.length !== 2 || prices.length < 2 || isYesNoPair(outcomes)) {
    return false;
  }

  const sportsMarketType = String(
    nestedMarket.sportsMarketType ?? ""
  ).toLowerCase();
  const label = [nestedMarket.groupItemTitle, nestedMarket.question]
    .filter(Boolean)
    .join(" ");
  if (
    sportsMarketType.includes("moneyline") ||
    /\b(match\s*winner|moneyline|series\s*winner|to\s*win)\b/i.test(label)
  ) {
    return true;
  }

  const normalizedTitle = eventTitle.trim().toLowerCase();
  return (
    normalizedTitle.length > 0 &&
    (nestedMarket.question ?? "").trim().toLowerCase() === normalizedTitle
  );
}

function resolveMoneylineSiblingMarkets(
  nested: NestedMarket[]
): PrimarySportsMoneyline | null {
  const options: PrimarySportsMoneylineOption[] = [];

  for (let marketIndex = 0; marketIndex < nested.length; marketIndex++) {
    const nestedMarket = nested[marketIndex];
    if (!isActiveMarket(nestedMarket)) continue;
    if ((nestedMarket.sportsMarketType ?? "").toLowerCase() !== "moneyline") {
      continue;
    }

    const rawName = nestedMarket.groupItemTitle?.trim();
    if (!rawName) continue;

    const price = yesPriceForMoneylineSibling(nestedMarket);
    if (price === null) continue;

    const option: PrimarySportsMoneylineOption = {
      name: normalizeMoneylineSiblingLabel(rawName),
      price,
      marketIndex,
    };
    if (nestedMarket.conditionId) option.conditionId = nestedMarket.conditionId;
    options.push(option);
  }

  if (options.length < 2) return null;

  return {
    outcomes: options.map((option) => option.name),
    prices: options.map((option) => option.price),
    marketIndex: options[0].marketIndex,
    multiOutcomeData: options,
  };
}

/**
 * For sports events with derivative markets, use the primary moneyline so the
 * betting row shows the competitors and their match prices.
 */
export function resolvePrimarySportsMoneyline(
  market: Market
): PrimarySportsMoneyline | null {
  const nested = market.markets;
  if (!nested || nested.length === 0 || !hasSportsMarketSignals(nested)) {
    return null;
  }

  const marketIndex = nested.findIndex((nestedMarket) =>
    isPrimaryMoneylineCandidate(nestedMarket, market.title)
  );
  if (marketIndex < 0) return resolveMoneylineSiblingMarkets(nested);

  const selectedMarket = nested[marketIndex];
  const outcomes = parseGammaStringArray(selectedMarket.outcomes);
  const prices = parseProbabilityArray(selectedMarket.outcomePrices);
  if (outcomes.length !== 2 || prices.length < 2) {
    return resolveMoneylineSiblingMarkets(nested);
  }

  return {
    outcomes,
    prices: prices.slice(0, outcomes.length),
    marketIndex,
  };
}
