import assert from "node:assert/strict";
import { test } from "vitest";

import {
  canSellHolding,
  clampStake,
  formatHoldingLine,
  formatPillPrices,
  parseStreamStakeInput,
  pickHolding,
  resolvePrimarySportsMoneyline,
  STREAM_STAKE_STEP,
  type StreamHolding,
  sellButtonLabel,
  stepStake,
} from "../../src/content/ui/stream-bet-calc";
import type { Market } from "../../src/types/market";

test("STREAM_STAKE_STEP is $1", () => {
  assert.equal(STREAM_STAKE_STEP, 1);
});

test("clampStake floors at the minimum", () => {
  assert.equal(clampStake(0), 1);
  assert.equal(clampStake(-5), 1);
});

test("clampStake rounds to whole dollars", () => {
  assert.equal(clampStake(3.4), 3);
  assert.equal(clampStake(3.6), 4);
});

test("clampStake caps at the floored balance ceiling when funded", () => {
  assert.equal(clampStake(10, 1, 3.5), 3); // floor(3.5) = 3
  assert.equal(clampStake(10, 1, 0), 10); // max 0 => no ceiling
});

test("clampStake never returns below min even when balance < min", () => {
  assert.equal(clampStake(10, 1, 0.4), 1);
});

test("stepStake moves by one dollar and clamps", () => {
  assert.equal(stepStake(5, 1), 6);
  assert.equal(stepStake(5, -1), 4);
  assert.equal(stepStake(1, -1), 1); // already at floor
  assert.equal(stepStake(3, 1, 1, 3), 3); // at ceiling
});

test("clampStake collapses non-finite input to the minimum", () => {
  assert.equal(clampStake(Number.NaN), 1);
  assert.equal(clampStake(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampStake(Number.NaN, 1, 50), 1);
});

test("stepStake collapses non-finite current to the minimum", () => {
  assert.equal(stepStake(Number.NaN, 1), 1);
  assert.equal(stepStake(Number.POSITIVE_INFINITY, -1), 1);
});

test("parseStreamStakeInput accepts direct whole-dollar entry", () => {
  assert.equal(parseStreamStakeInput("100"), 100);
  assert.equal(parseStreamStakeInput("$100"), 100);
  assert.equal(parseStreamStakeInput("100.49"), 100);
  assert.equal(parseStreamStakeInput("100.50"), 101);
});

test("parseStreamStakeInput returns null for empty or invalid edits", () => {
  assert.equal(parseStreamStakeInput(""), null);
  assert.equal(parseStreamStakeInput("$"), null);
  assert.equal(parseStreamStakeInput("abc"), null);
});

test("pickHolding returns null when nothing is held", () => {
  assert.equal(
    pickHolding([
      { outcomeIndex: 0, name: "FURIA", balance: "0", price: 0.6 },
      { outcomeIndex: 1, name: "MOUZ", balance: "0.001", price: 0.41 },
    ]),
    null
  );
});

test("pickHolding returns the held side with shares + value", () => {
  const h = pickHolding([
    { outcomeIndex: 0, name: "FURIA", balance: "5", price: 0.6 },
    { outcomeIndex: 1, name: "MOUZ", balance: "0", price: 0.41 },
  ]);
  assert.ok(h);
  assert.equal(h?.outcomeIndex, 0);
  assert.equal(h?.name, "FURIA");
  assert.equal(h?.shares, 5);
  assert.equal(h?.sharesLabel, "5");
  assert.equal(h?.valueUsd, "3.00");
});

test("pickHolding picks the larger-value side when both are held", () => {
  const h = pickHolding([
    { outcomeIndex: 0, name: "FURIA", balance: "2", price: 0.6 }, // $1.20
    { outcomeIndex: 1, name: "MOUZ", balance: "10", price: 0.41 }, // $4.10
  ]);
  assert.equal(h?.name, "MOUZ");
});

test("pickHolding formats fractional shares to one decimal", () => {
  const h = pickHolding([
    { outcomeIndex: 0, name: "FURIA", balance: "3.333333", price: 0.6 },
    { outcomeIndex: 1, name: "MOUZ", balance: "0", price: 0.41 },
  ]);
  assert.equal(h?.sharesLabel, "3.3");
});

test("formatHoldingLine renders 'shares name · $value'", () => {
  const h: StreamHolding = {
    outcomeIndex: 0,
    name: "FURIA",
    shares: 5,
    sharesLabel: "5",
    valueUsd: "3.00",
  };
  assert.equal(formatHoldingLine(h), "5 FURIA · $3.00");
});

test("sellButtonLabel renders 'Sell shares name · ~$value'", () => {
  const h: StreamHolding = {
    outcomeIndex: 0,
    name: "FURIA",
    shares: 5,
    sharesLabel: "5",
    valueUsd: "3.00",
  };
  assert.equal(sellButtonLabel(h), "Sell 5 FURIA · ~$3.00");
});

test("canSellHolding requires shares at or above the min order size", () => {
  const h: StreamHolding = {
    outcomeIndex: 0,
    name: "FURIA",
    shares: 5,
    sharesLabel: "5",
    valueUsd: "3.00",
  };
  assert.equal(canSellHolding(h, 5), true);
  assert.equal(canSellHolding(h, 6), false);
  assert.equal(canSellHolding(null, 5), false);
});

test("formatPillPrices renders 'A a¢ / B b¢' for two outcomes", () => {
  assert.equal(
    formatPillPrices([
      { name: "FURIA", price: 0.6 },
      { name: "MOUZ", price: 0.41 },
    ]),
    "FURIA 60¢ / MOUZ 41¢"
  );
});

test("formatPillPrices caps at the first two outcomes", () => {
  assert.equal(
    formatPillPrices(
      [
        { name: "A", price: 0.5 },
        { name: "B", price: 0.3 },
        { name: "C", price: 0.2 },
      ],
      2
    ),
    "A 50¢ / B 30¢"
  );
});

test("pickHolding breaks an exact value tie by lowest outcome index", () => {
  // Both sides worth $3.00; index 0 must win regardless of array order.
  const a = pickHolding([
    { outcomeIndex: 1, name: "MOUZ", balance: "5", price: 0.6 },
    { outcomeIndex: 0, name: "FURIA", balance: "5", price: 0.6 },
  ]);
  assert.equal(a?.outcomeIndex, 0);
  assert.equal(a?.name, "FURIA");
});

test("formatPillPrices handles one outcome and an empty list", () => {
  assert.equal(formatPillPrices([{ name: "FURIA", price: 0.6 }]), "FURIA 60¢");
  assert.equal(formatPillPrices([]), "");
});

test("resolvePrimarySportsMoneyline prefers the match winner over tennis derivative markets", () => {
  const market: Market = {
    id: "673526",
    title: "Contrexeville: Elina Avanesyan vs Alicia Herrero Linana",
    source: "polymarket",
    markets: [
      {
        id: "2818062",
        question: "Contrexeville: Elina Avanesyan vs Alicia Herrero Linana",
        outcomes: ["Elina Avanesyan", "Alicia Herrero Linana"],
        outcomePrices: '["0.355", "0.645"]',
        clobTokenIds: '["elina_yes","alicia_yes"]',
        sportsMarketType: "moneyline",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
      {
        id: "2819877",
        question: "Set Handicap: Linana (-1.5) vs Avanesyan (+1.5)",
        groupItemTitle:
          "Contrexeville: Elina Avanesyan vs Alicia Herrero Linana Set Handicap +/-1.5",
        outcomes: ["Linana", "Avanesyan"],
        outcomePrices: '["0.49", "0.51"]',
        clobTokenIds: '["linana_handicap","avanesyan_handicap"]',
        sportsMarketType: "tennis_set_handicap",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
    ],
  };

  assert.deepEqual(resolvePrimarySportsMoneyline(market), {
    outcomes: ["Elina Avanesyan", "Alicia Herrero Linana"],
    prices: [0.355, 0.645],
    marketIndex: 0,
  });
});

test("resolvePrimarySportsMoneyline prefers soccer moneyline sibling markets over totals", () => {
  const market: Market = {
    id: "672774",
    title: "Argentina vs. Egypt",
    source: "polymarket",
    markets: [
      {
        question: "Will Argentina win on 2026-07-07?",
        groupItemTitle: "Argentina",
        outcomes: ["Yes", "No"],
        outcomePrices: '["0.735", "0.265"]',
        clobTokenIds: '["argentina_yes","argentina_no"]',
        sportsMarketType: "moneyline",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
      {
        question: "Will Argentina vs. Egypt end in a draw?",
        groupItemTitle: "Draw (Argentina vs. Egypt)",
        outcomes: ["Yes", "No"],
        outcomePrices: '["0.195", "0.805"]',
        clobTokenIds: '["draw_yes","draw_no"]',
        sportsMarketType: "moneyline",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
      {
        question: "Will Egypt win on 2026-07-07?",
        groupItemTitle: "Egypt",
        outcomes: ["Yes", "No"],
        outcomePrices: '["0.075", "0.925"]',
        clobTokenIds: '["egypt_yes","egypt_no"]',
        sportsMarketType: "moneyline",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
      {
        question: "Argentina vs. Egypt: O/U 0.5",
        groupItemTitle: "O/U 0.5",
        outcomes: ["Over", "Under"],
        outcomePrices: '["0.925", "0.075"]',
        clobTokenIds: '["over_yes","under_yes"]',
        sportsMarketType: "totals",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
    ],
  };

  assert.deepEqual(resolvePrimarySportsMoneyline(market), {
    outcomes: ["Argentina", "Draw", "Egypt"],
    prices: [0.735, 0.195, 0.075],
    marketIndex: 0,
    multiOutcomeData: [
      { name: "Argentina", price: 0.735, marketIndex: 0 },
      { name: "Draw", price: 0.195, marketIndex: 1 },
      { name: "Egypt", price: 0.075, marketIndex: 2 },
    ],
  });
});
