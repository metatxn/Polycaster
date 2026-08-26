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

/**
 * Closed or nearly resolved markets have a leading outcome above the display
 * cap. Keep markets without a usable price visible because their price is
 * unknown, not closed.
 */
export function isMarketWithinDisplayPriceCap(market: Market): boolean {
  return getMarketPrices(market).every((price) =>
    isPriceWithinDisplayCap(price.toString())
  );
}
