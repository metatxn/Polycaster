import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildSportsMarketSearchResult,
  findSportsEventForMatch,
} from "../../src/content/sports-live-market-source";

function fifaEvent() {
  return {
    id: "510232",
    slug: "fifwc-esp-cvi-2026-06-15",
    title: "Spain vs. Cabo Verde",
    active: true,
    closed: false,
    live: true,
    startTime: "2026-06-15T16:00:00Z",
    volume24hr: 147_000,
    teams: [
      { name: "Spain", abbreviation: "ESP", league: "fifwc" },
      { name: "Cabo Verde", abbreviation: "CVI", league: "fifwc" },
    ],
    tags: [{ slug: "fifa-world-cup", label: "FIFA World Cup" }],
    markets: [
      {
        id: "2322490",
        active: true,
        closed: false,
        acceptingOrders: true,
        question: "Will Spain win on 2026-06-15?",
        groupItemTitle: "Spain",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.755","0.245"]',
        clobTokenIds: '["spain_yes","spain_no"]',
        conditionId: "0xspain",
        gameStartTime: "2026-06-15 16:00:00+00",
        sportsMarketType: "moneyline",
      },
      {
        id: "2322491",
        active: true,
        closed: false,
        acceptingOrders: true,
        question: "Will Spain vs. Cabo Verde end in a draw?",
        groupItemTitle: "Draw (Spain vs. Cabo Verde)",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.18","0.82"]',
        clobTokenIds: '["draw_yes","draw_no"]',
        conditionId: "0xdraw",
        gameStartTime: "2026-06-15 16:00:00+00",
        sportsMarketType: "moneyline",
      },
      {
        id: "2322492",
        active: true,
        closed: false,
        acceptingOrders: true,
        question: "Will Cabo Verde win on 2026-06-15?",
        groupItemTitle: "Cabo Verde",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.065","0.935"]',
        clobTokenIds: '["cabo_yes","cabo_no"]',
        conditionId: "0xcabo",
        gameStartTime: "2026-06-15 16:00:00+00",
        sportsMarketType: "moneyline",
      },
    ],
  };
}

test("finds a sports event by exact teams and kickoff date", () => {
  const match = findSportsEventForMatch([fifaEvent()], {
    homeTeam: "Spain",
    awayTeam: "Cabo Verde",
    eventTime: "2026-06-15T16:00:00Z",
    leagueSlug: "fifa-world-cup",
  });

  assert.equal(match?.id, "510232");
});

test("rejects sports events with only one matching team", () => {
  const match = findSportsEventForMatch([fifaEvent()], {
    homeTeam: "Germany",
    awayTeam: "Cabo Verde",
    eventTime: "2026-06-15T16:00:00Z",
    leagueSlug: "fifa-world-cup",
  });

  assert.equal(match, null);
});

test("maps a matched sports event into an injectable Polymarket market result", () => {
  const result = buildSportsMarketSearchResult(fifaEvent(), {
    homeTeam: "Spain",
    awayTeam: "Cabo Verde",
    eventTime: "2026-06-15T16:00:00Z",
    leagueSlug: "fifa-world-cup",
  });

  assert.equal(result?.score, 0.99);
  assert.equal(result?.source, "polymarket");
  assert.equal(result?.market.id, "510232");
  assert.equal(result?.market.title, "Spain vs. Cabo Verde");
  assert.deepEqual(result?.market._preferredOutcomeNames, [
    "Spain",
    "Cabo Verde",
  ]);
  assert.equal(result?.market.markets?.length, 3);
  assert.equal(
    result?.market.markets?.[0].clobTokenIds,
    '["spain_yes","spain_no"]'
  );
  assert.equal(result?.market.markets?.[0].sportsMarketType, "moneyline");
});
