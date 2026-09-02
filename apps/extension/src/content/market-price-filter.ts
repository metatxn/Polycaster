import { parseGammaNumberArray } from "@knoww/shared-types/polymarket";
import { Decimal } from "decimal.js";
import type { Market } from "../types/market";

export const MAX_DISPLAY_PRICE_CENTS = 95;

const MAX_DISPLAY_PRICE = new Decimal(MAX_DISPLAY_PRICE_CENTS).div(100);

export function isPriceWithinDisplayCap(
  value: number | string | null | undefined
): boolean {
  if (value === null || value === undefined || value === "") return true;

  try {
    const price = new Decimal(value);
    return price.isFinite() && price.lte(MAX_DISPLAY_PRICE);
  } catch {
    return false;
  }
}

export function isPriceCentsWithinDisplayCap(
  value: number | string | null | undefined
): boolean {
  if (value === null || value === undefined || value === "") return true;

  try {
    const priceCents = new Decimal(value);
    return priceCents.isFinite() && priceCents.lte(MAX_DISPLAY_PRICE_CENTS);
  } catch {
    return false;
  }
}

function getMarketPrices(market: Market): Decimal[] {
  const prices: Decimal[] = [];

  for (const nestedMarket of market.markets ?? []) {
    if (
      nestedMarket.active === false ||
      nestedMarket.closed === true ||
      nestedMarket.archived === true
    ) {
      continue;
    }

    for (const rawPrice of parseGammaNumberArray(nestedMarket.outcomePrices)) {
      prices.push(new Decimal(rawPrice));
    }
  }

  if (prices.length > 0) return prices;

  for (const outcome of market.outcomes ?? []) {
    if (outcome.price === undefined || outcome.price === null) continue;
    prices.push(new Decimal(outcome.price));
  }

  return prices;
}

type NestedMarket = NonNullable<Market["markets"]>[number];

// Closed children still count here (unlike getMarketPrices): the event's
// shape must not flip to "binary" when a choice is eliminated, or the
// eliminated child's near-$1 No price would wrongly hide the whole event.
function isNamedMultiOutcomeEvent(market: Market): boolean {
  let namedMarketCount = 0;

  for (const nestedMarket of market.markets ?? []) {
    if (nestedMarket.groupItemTitle?.trim() || nestedMarket.question?.trim()) {
      namedMarketCount += 1;
      if (namedMarketCount >= 2) return true;
    }
  }

  return false;
}

function isNestedMarketDisplayable(market: NestedMarket): boolean {
  return (
    market.active !== false &&
    market.closed !== true &&
    market.archived !== true
  );
}

function nestedMarketExceedsDisplayPriceCap(
  market: NestedMarket,
  isMultiOutcomeEvent: boolean
): boolean {
  // Archived children are deprecated duplicates whose prices may be stale.
  if (market.archived === true) return false;

  const prices = parseGammaNumberArray(market.outcomePrices);

  // Polymarket represents each choice in a grouped event as a Yes/No child.
  // The first price is the displayed choice probability; the complementary
  // No price can legitimately exceed the cap for a low-probability choice.
  if (isMultiOutcomeEvent) {
    return prices.length > 0 && !isPriceWithinDisplayCap(prices[0]);
  }

  return prices.some((price) => !isPriceWithinDisplayCap(price));
}

/**
 * An event stays visible only while none of its markets has crossed the
 * display cap. A single child above it means the event is effectively
 * decided, and surfacing the remaining markets invites trades on outcomes
 * already priced as losers — so the whole event is hidden rather than
 * trimmed to its runner-ups. Closed children count toward this check (a
 * closed near-$1 winner is the strongest "decided" signal), while markets
 * without a usable price stay visible because their price is unknown, not
 * decided.
 */
export function isMarketWithinDisplayPriceCap(market: Market): boolean {
  if (market.closed === true || market.active === false) return false;
  if (market.markets && market.markets.length > 0) {
    const isMultiOutcomeEvent = isNamedMultiOutcomeEvent(market);
    if (
      market.markets.some((nestedMarket) =>
        nestedMarketExceedsDisplayPriceCap(nestedMarket, isMultiOutcomeEvent)
      )
    ) {
      return false;
    }

    return market.markets.some(isNestedMarketDisplayable);
  }

  return getMarketPrices(market).every((price) =>
    isPriceWithinDisplayCap(price.toString())
  );
}

export function filterNestedMarketsByDisplayPriceCap(
  market: Market
): Market | null {
  if (!isMarketWithinDisplayPriceCap(market)) return null;
  if (!market.markets || market.markets.length === 0) return market;

  const displayableMarkets = market.markets.filter(isNestedMarketDisplayable);
  if (displayableMarkets.length === market.markets.length) return market;

  return { ...market, markets: displayableMarkets };
}
