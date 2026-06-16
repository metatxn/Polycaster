import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildMarketContextText,
  getPreferredOutcomeNames,
  prioritizeByPreferredOutcomeNames,
} from "../../src/content/market-context";
import type { Market } from "../../src/types/market";

function worldCupMarket(): Market {
  return {
    id: "30615",
    title: "World Cup Winner",
    source: "polymarket",
    markets: [
      {
        active: true,
        groupItemTitle: "Spain",
        outcomePrices: ["0.1615", "0.8385"],
        question: "Will Spain win the 2026 FIFA World Cup?",
      },
      {
        active: true,
        groupItemTitle: "Germany",
        outcomePrices: ["0.0615", "0.9385"],
        question: "Will Germany win the 2026 FIFA World Cup?",
      },
      {
        active: true,
        groupItemTitle: "Curaçao",
        outcomePrices: ["0.0005", "0.9995"],
        question: "Will Curaçao win the 2026 FIFA World Cup?",
      },
    ],
  };
}

test("market context text includes nested team markets for scoring and gates", () => {
  const text = buildMarketContextText(worldCupMarket());

  assert.match(text, /World Cup Winner/);
  assert.match(text, /Germany/);
  assert.match(text, /Curaçao/);
  assert.match(text, /Will Germany win the 2026 FIFA World Cup/);
});

test("preferred outcome names match schedule teams with accent-insensitive text", () => {
  const preferred = getPreferredOutcomeNames(
    "FIFA World Cup match: Germany vs Curacao. Score: Germany 7, Curacao 1.",
    worldCupMarket()
  );

  assert.deepEqual(preferred, ["Germany", "Curaçao"]);
});

test("preferred outcomes are ordered ahead of unrelated high-probability outcomes", () => {
  const ordered = prioritizeByPreferredOutcomeNames(
    [
      { name: "Spain", price: 0.1615 },
      { name: "Germany", price: 0.0615 },
      { name: "Curaçao", price: 0.0005 },
    ],
    ["Germany", "Curaçao"]
  );

  assert.deepEqual(
    ordered.map((item) => item.name),
    ["Germany", "Curaçao", "Spain"]
  );
});
