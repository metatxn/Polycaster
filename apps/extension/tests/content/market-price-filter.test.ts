import assert from "node:assert/strict";
import { test } from "vitest";
import {
  isMarketWithinDisplayPriceCap,
  MAX_DISPLAY_PRICE_CENTS,
} from "../../src/content/market-price-filter";
import type { Market } from "../../src/types/market";

function marketWithPrices(prices: string[]): Market {
  return {
    id: "market-1",
    title: "Test market",
    source: "polymarket",
    markets: [{ active: true, outcomePrices: prices }],
  };
}

test("allows a market whose highest outcome is exactly 90 cents", () => {
  assert.equal(MAX_DISPLAY_PRICE_CENTS, 90);
  assert.equal(
    isMarketWithinDisplayPriceCap(marketWithPrices(["0.9", "0.1"])),
    true
  );
});

test("hides markets whose highest outcome is above 90 cents", () => {
  assert.equal(
    isMarketWithinDisplayPriceCap(marketWithPrices(["0.9001", "0.0999"])),
    false
  );
  assert.equal(
    isMarketWithinDisplayPriceCap(marketWithPrices(["0.99", "0.01"])),
    false
  );
});

test("checks all active outcomes and leaves markets without prices visible", () => {
  assert.equal(
    isMarketWithinDisplayPriceCap(marketWithPrices(["0.2", "0.91"])),
    false
  );
  assert.equal(
    isMarketWithinDisplayPriceCap({
      ...marketWithPrices([]),
      outcomes: [{ title: "Yes", price: 0.75 }],
    }),
    true
  );
  assert.equal(isMarketWithinDisplayPriceCap(marketWithPrices([])), true);
});
