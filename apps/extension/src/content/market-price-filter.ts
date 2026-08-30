import { parseGammaNumberArray } from "@knoww/shared-types/polymarket";
import { Decimal } from "decimal.js";
import type { Market } from "../types/market";

export const MAX_DISPLAY_PRICE_CENTS = 90;

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

function isNamedMultiOutcomeEvent(market: Market): boolean {
  let namedActiveMarketCount = 0;

  for (const nestedMarket of market.markets ?? []) {
    if (
      nestedMarket.active === false ||
      nestedMarket.closed === true ||
      nestedMarket.archived === true
    ) {
      continue;
    }

    if (nestedMarket.groupItemTitle?.trim() || nestedMarket.question?.trim()) {
      namedActiveMarketCount += 1;
      if (namedActiveMarketCount >= 2) return true;
    }
  }

  return false;
}

function isNestedMarketWithinDisplayPriceCap(
  market: NonNullable<Market["markets"]>[number],
  isMultiOutcomeEvent: boolean
): boolean {
  if (
    market.active === false ||
    market.closed === true ||
    market.archived === true
  ) {
    return false;
  }

  const prices = parseGammaNumberArray(market.outcomePrices);

  // Polymarket represents each choice in a grouped event as a Yes/No child.
  // The first price is the displayed choice probability; the complementary
  // No price can legitimately exceed the cap for a low-probability choice.
  if (isMultiOutcomeEvent) {
    return prices.length === 0 || isPriceWithinDisplayCap(prices[0]);
  }

  return prices.every((price) => isPriceWithinDisplayCap(price));
}

/**
 * Closed or nearly resolved markets have a leading outcome above the display
 * cap. Keep markets without a usable price visible because their price is
 * unknown, not closed.
 */
export function isMarketWithinDisplayPriceCap(market: Market): boolean {
  if (market.closed === true || market.active === false) return false;
  if (market.markets && market.markets.length > 0) {
    const isMultiOutcomeEvent = isNamedMultiOutcomeEvent(market);
    return market.markets.some((nestedMarket) =>
      isNestedMarketWithinDisplayPriceCap(nestedMarket, isMultiOutcomeEvent)
    );
  }

  return getMarketPrices(market).every((price) =>
    isPriceWithinDisplayCap(price.toString())
  );
}

export function filterNestedMarketsByDisplayPriceCap(
  market: Market
): Market | null {
  if (market.closed === true || market.active === false) return null;
  if (!market.markets || market.markets.length === 0) {
    return isMarketWithinDisplayPriceCap(market) ? market : null;
  }

  const isMultiOutcomeEvent = isNamedMultiOutcomeEvent(market);
  const eligibleMarkets = market.markets.filter((nestedMarket) =>
    isNestedMarketWithinDisplayPriceCap(nestedMarket, isMultiOutcomeEvent)
  );

  if (eligibleMarkets.length === 0) return null;
  if (eligibleMarkets.length === market.markets.length) return market;

  return { ...market, markets: eligibleMarkets };
}
