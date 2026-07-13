import assert from "node:assert/strict";
import { test } from "vitest";
import {
  findMatchingLiveMarket,
  resolveSelectedMarketIndex,
} from "../../src/content/market-token-resolution";

test("matches a refreshed Polymarket sub-market by condition ID instead of array position", () => {
  const selectedMarket = {
    conditionId: "condition-england",
    question: "Will England win the 2026 FIFA World Cup?",
    clobTokenIds: '["stale-england-yes","stale-england-no"]',
  };
  const liveMarkets = [
    {
      conditionId: "condition-france",
      question: "Will France win the 2026 FIFA World Cup?",
      clobTokenIds: '["live-france-yes","live-france-no"]',
    },
    {
      conditionId: "condition-england",
      question: "Will England win the 2026 FIFA World Cup?",
      clobTokenIds: '["live-england-yes","live-england-no"]',
    },
  ];

  const match = findMatchingLiveMarket(selectedMarket, liveMarkets, 0);

  assert.equal(match?.conditionId, "condition-england");
  assert.equal(match?.clobTokenIds, '["live-england-yes","live-england-no"]');
});

test("uses normalized question identity when condition ID is unavailable", () => {
  const selectedMarket = {
    question: "  Will ENGLAND win the 2026 FIFA World Cup? ",
  };
  const liveMarkets = [
    { question: "Will France win the 2026 FIFA World Cup?" },
    { question: "Will England win the 2026 FIFA World Cup?" },
  ];

  assert.equal(
    findMatchingLiveMarket(selectedMarket, liveMarkets, 0)?.question,
    "Will England win the 2026 FIFA World Cup?"
  );
});

test("recovers a selected multi-outcome index from its displayed label", () => {
  const markets = [
    { groupItemTitle: "June 30", closed: true },
    { groupItemTitle: "July 31", closed: false },
    { groupItemTitle: "December 31", closed: false },
  ];

  assert.equal(resolveSelectedMarketIndex(markets, "December 31", 0), 2);
});

test("keeps the supplied index when it already identifies the displayed option", () => {
  const markets = [{ groupItemTitle: "France" }, { groupItemTitle: "England" }];

  assert.equal(resolveSelectedMarketIndex(markets, "England", 1), 1);
});
