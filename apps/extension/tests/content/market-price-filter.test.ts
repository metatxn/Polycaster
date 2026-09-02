import assert from "node:assert/strict";
import { test } from "vitest";
import {
  filterNestedMarketsByDisplayPriceCap,
  isMarketWithinDisplayPriceCap,
  MAX_DISPLAY_PRICE_CENTS,
} from "../../src/content/market-price-filter";
import { resolveMarketDisplayData } from "../../src/content/ui/cards";
import type { Market } from "../../src/types/market";

function marketWithPrices(prices: string[]): Market {
  return {
    id: "market-1",
    title: "Test market",
    source: "polymarket",
    markets: [{ active: true, outcomePrices: prices }],
  };
}

test("allows a market whose highest outcome is exactly 95 cents", () => {
  assert.equal(MAX_DISPLAY_PRICE_CENTS, 95);
  assert.equal(
    isMarketWithinDisplayPriceCap(marketWithPrices(["0.95", "0.05"])),
    true
  );
});

test("hides markets whose highest outcome is above 95 cents", () => {
  assert.equal(
    isMarketWithinDisplayPriceCap(marketWithPrices(["0.9501", "0.0499"])),
    false
  );
  assert.equal(
    isMarketWithinDisplayPriceCap(marketWithPrices(["0.99", "0.01"])),
    false
  );
});

test("checks all active outcomes and leaves markets without prices visible", () => {
  assert.equal(
    isMarketWithinDisplayPriceCap(marketWithPrices(["0.2", "0.96"])),
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

test("hides the entire event when any nested market exceeds the cap", () => {
  const event: Market = {
    id: "event-1",
    title: "Event with several markets",
    source: "polymarket",
    markets: [
      {
        id: "nearly-resolved",
        active: true,
        outcomePrices: ["0.96", "0.04"],
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

  // The runner-up markets must NOT surface once one child is effectively
  // decided — showing them invites trades on outcomes priced as losers.
  assert.equal(filterNestedMarketsByDisplayPriceCap(event), null);
  assert.equal(isMarketWithinDisplayPriceCap(event), false);
  assert.equal(event.markets?.length, 3, "input event must not be mutated");
});

test("hides the entire event when a later nested market exceeds the cap", () => {
  const event: Market = {
    id: "event-with-later-decided-market",
    title: "Event whose last market crossed the cap",
    source: "polymarket",
    markets: [
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
      {
        id: "nearly-resolved",
        active: true,
        outcomePrices: ["0.96", "0.04"],
      },
    ],
  };

  assert.equal(filterNestedMarketsByDisplayPriceCap(event), null);
  assert.equal(isMarketWithinDisplayPriceCap(event), false);
});

test("keeps low-probability choices in a named multi-outcome event", () => {
  const event: Market = {
    id: "841244",
    title: "Which company has the best Text-to-Video AI end of September?",
    source: "polymarket",
    markets: [
      {
        id: "google",
        groupItemTitle: "Google",
        active: true,
        outcomePrices: ["0.865", "0.135"],
      },
      {
        id: "bytedance",
        groupItemTitle: "ByteDance",
        active: true,
        outcomePrices: ["0.058", "0.942"],
      },
      {
        id: "openai",
        groupItemTitle: "OpenAI",
        active: true,
        outcomePrices: ["0.003", "0.997"],
      },
    ],
  };

  const filtered = filterNestedMarketsByDisplayPriceCap(event);

  assert.ok(filtered);
  assert.deepEqual(
    filtered.markets?.map((market) => market.groupItemTitle),
    ["Google", "ByteDance", "OpenAI"]
  );
  assert.deepEqual(resolveMarketDisplayData(filtered).outcomes, [
    "Google",
    "ByteDance",
    "OpenAI",
  ]);
});

test("hides a named multi-outcome event once its leading choice crosses the cap", () => {
  const event: Market = {
    id: "event-decided-leader",
    title: "Which company has the best Text-to-Video AI end of September?",
    source: "polymarket",
    markets: [
      {
        id: "google",
        groupItemTitle: "Google",
        active: true,
        outcomePrices: ["0.96", "0.04"],
      },
      {
        id: "bytedance",
        groupItemTitle: "ByteDance",
        active: true,
        outcomePrices: ["0.03", "0.97"],
      },
      {
        id: "openai",
        groupItemTitle: "OpenAI",
        active: true,
        outcomePrices: ["0.01", "0.99"],
      },
    ],
  };

  assert.equal(filterNestedMarketsByDisplayPriceCap(event), null);
  assert.equal(isMarketWithinDisplayPriceCap(event), false);
});

test("prunes closed children without hiding an otherwise eligible event", () => {
  const event: Market = {
    id: "event-mixed",
    title: "Event with an already-closed child",
    source: "polymarket",
    markets: [
      {
        id: "eligible",
        active: true,
        outcomePrices: ["0.65", "0.35"],
      },
      {
        id: "closed",
        active: true,
        closed: true,
        outcomePrices: ["0.55", "0.45"],
      },
    ],
  };

  assert.equal(isMarketWithinDisplayPriceCap(event), true);
  assert.deepEqual(
    filterNestedMarketsByDisplayPriceCap(event)?.markets?.map(
      (market) => market.id
    ),
    ["eligible"]
  );
  assert.equal(event.markets?.length, 2, "input event must not be mutated");
});

test("keeps an event with an eliminated choice but hides one whose closed child resolved yes", () => {
  // An eliminated candidate closes near zero — that must not hide the race.
  const eliminated: Market = {
    id: "event-eliminated",
    title: "Two-candidate race with one dropout",
    source: "polymarket",
    markets: [
      {
        id: "front-runner",
        groupItemTitle: "Candidate A",
        active: true,
        outcomePrices: ["0.6", "0.4"],
      },
      {
        id: "dropout",
        groupItemTitle: "Candidate B",
        active: true,
        closed: true,
        outcomePrices: ["0.001", "0.999"],
      },
    ],
  };

  assert.deepEqual(
    filterNestedMarketsByDisplayPriceCap(eliminated)?.markets?.map(
      (market) => market.id
    ),
    ["front-runner"]
  );

  // A closed child near $1 means the event is decided even if the event
  // object has not flipped to closed yet — hide it, long shots included.
  const decided: Market = {
    id: "event-decided",
    title: "Race whose winner already resolved",
    source: "polymarket",
    markets: [
      {
        id: "winner",
        groupItemTitle: "Candidate A",
        active: true,
        closed: true,
        outcomePrices: ["0.99", "0.01"],
      },
      {
        id: "long-shot",
        groupItemTitle: "Candidate B",
        active: true,
        outcomePrices: ["0.01", "0.99"],
      },
    ],
  };

  assert.equal(filterNestedMarketsByDisplayPriceCap(decided), null);
});
