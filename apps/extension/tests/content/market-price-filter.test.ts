import assert from "node:assert/strict";
import { test } from "vitest";
import {
  filterNestedMarketsByDisplayPriceCap,
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

test("removes only nested markets above the price cap", () => {
  const event: Market = {
    id: "event-1",
    title: "Event with several markets",
    source: "polymarket",
    markets: [
      {
        id: "nearly-resolved",
        active: true,
        outcomePrices: ["0.95", "0.05"],
      },
      {
        id: "competitive",
        active: true,
        outcomePrices: ["0.65", "0.35"],
      },
      {
        id: "unknown-price",
        active: true,
        outcomePrices: [],
      },
    ],
  };

  const filtered = filterNestedMarketsByDisplayPriceCap(event);

  assert.ok(filtered);
  assert.deepEqual(
    filtered.markets?.map((market) => market.id),
    ["competitive", "unknown-price"]
  );
  assert.equal(event.markets?.length, 3, "input event must not be mutated");
});

test("removes an event only when none of its nested markets survive", () => {
  const event: Market = {
    id: "event-2",
    title: "Event without an eligible market",
    source: "polymarket",
    markets: [
      {
        id: "resolved-one",
        active: true,
        outcomePrices: ["0.99", "0.01"],
      },
      {
        id: "resolved-two",
        active: true,
        outcomePrices: ["0.92", "0.08"],
      },
    ],
  };

  assert.equal(filterNestedMarketsByDisplayPriceCap(event), null);
});
