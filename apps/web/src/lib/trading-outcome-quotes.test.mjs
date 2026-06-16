import assert from "node:assert/strict";
import test from "node:test";
import { applyLiveTradingOutcomeQuotes } from "./trading-outcome-quotes.ts";

test("updates trading outcome prices from live executable order-book quotes", () => {
  const outcomes = [
    {
      name: "Delhi Capitals",
      tokenId: "del-token",
      price: 0.425,
      probability: 42.5,
    },
    {
      name: "Kolkata Knight Riders",
      tokenId: "kol-token",
      price: 0.575,
      probability: 57.5,
    },
  ];

  const quoted = applyLiveTradingOutcomeQuotes(
    outcomes,
    new Map([
      ["del-token", { lastTradePrice: 0.45, midpoint: 0.455 }],
      ["kol-token", { midpoint: 0.57, bestBid: 0.56, bestAsk: 0.58 }],
    ])
  );

  assert.equal(quoted[0].price, 0.455);
  assert.equal(quoted[0].probability, 46);
  assert.equal(quoted[1].price, 0.58);
  assert.equal(quoted[1].probability, 58);
});

test("prefers best ask over last trade for executable buy ticket prices", () => {
  const outcomes = [
    {
      name: "IND4",
      tokenId: "india-token",
      price: 0.865,
      probability: 87,
    },
  ];

  const quoted = applyLiveTradingOutcomeQuotes(
    outcomes,
    new Map([
      [
        "india-token",
        { lastTradePrice: 0.85, midpoint: 0.835, bestBid: 0.81, bestAsk: 0.82 },
      ],
    ])
  );

  assert.equal(quoted[0].price, 0.82);
  assert.equal(quoted[0].probability, 82);
});

test("keeps the static outcome price when no finite live quote exists", () => {
  const outcomes = [
    {
      name: "Delhi Capitals",
      tokenId: "del-token",
      price: 0.425,
      probability: 42.5,
    },
  ];

  const quoted = applyLiveTradingOutcomeQuotes(
    outcomes,
    new Map([
      [
        "del-token",
        { lastTradePrice: Number.NaN, midpoint: undefined, bestAsk: null },
      ],
    ])
  );

  assert.equal(quoted[0].price, 0.425);
  assert.equal(quoted[0].probability, 42.5);
});
