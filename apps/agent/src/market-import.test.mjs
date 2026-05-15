import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeGammaEventToWatchlistItem,
  parsePolymarketEventSlug,
  resolvePolymarketEventWatchlistItem,
} from "./market-import.ts";

const gammaEvent = {
  slug: "btc-updown-5m-1778415900",
  title: "Bitcoin Up or Down - May 10, 8:25AM-8:30AM ET",
  resolutionSource: "https://data.chain.link/streams/btc-usd",
  startTime: "2026-05-10T12:25:00Z",
  endDate: "2026-05-10T12:30:00Z",
  archived: false,
  markets: [
    {
      question: "Bitcoin Up or Down - May 10, 8:25AM-8:30AM ET",
      conditionId:
        "0x6f7cb69838a216a8fe54b066c972837a7ddccd9f7f8e030e1a8c0cd31dc8159b",
      slug: "btc-updown-5m-1778415900",
      outcomes: '["Up", "Down"]',
      clobTokenIds:
        '["65280938700881719749804790429080618050749954395142741426010680600837471989622", "43983957661072376000760020511311666546601443283262754526380755967283206100917"]',
      resolutionSource: "https://data.chain.link/streams/btc-usd",
      eventStartTime: "2026-05-10T12:25:00Z",
      endDate: "2026-05-10T12:30:00Z",
      archived: false,
    },
  ],
};

const peaceDealEvent = {
  slug: "us-x-iran-permanent-peace-deal-by",
  title: "US x Iran permanent peace deal by...?",
  resolutionSource: "https://polymarket.com",
  startTime: "2026-04-08T16:16:14.414324Z",
  endDate: "2026-12-31T00:00:00Z",
  archived: false,
  markets: [
    {
      question: "US x Iran permanent peace deal by April 22, 2026?",
      conditionId: "0xclosed",
      slug: "us-x-iran-permanent-peace-deal-by-april-22-2026",
      outcomes: '["Yes", "No"]',
      clobTokenIds: '["closed_yes", "closed_no"]',
      outcomePrices: '["0", "1"]',
      eventStartTime: "2026-04-08T16:16:14.414324Z",
      endDate: "2026-04-22T00:00:00Z",
      active: true,
      archived: false,
      closed: true,
      acceptingOrders: false,
      enableOrderBook: true,
    },
    {
      question: "US x Iran permanent peace deal by May 31, 2026?",
      conditionId: "0xmay",
      slug: "us-x-iran-permanent-peace-deal-by-may-31-2026",
      outcomes: '["Yes", "No"]',
      clobTokenIds: '["may_yes", "may_no"]',
      outcomePrices: '["0.175", "0.825"]',
      eventStartTime: "2026-04-08T16:16:14.414324Z",
      endDate: "2026-05-31T00:00:00Z",
      active: true,
      archived: false,
      closed: false,
      acceptingOrders: true,
      enableOrderBook: true,
    },
    {
      question: "US x Iran permanent peace deal by December 31, 2026?",
      conditionId: "0xdec",
      slug: "us-x-iran-permanent-peace-deal-by-december-31-2026",
      outcomes: '["Yes", "No"]',
      clobTokenIds: '["dec_yes", "dec_no"]',
      outcomePrices: '["0.695", "0.305"]',
      eventStartTime: "2026-04-08T16:16:14.414324Z",
      endDate: "2026-12-31T00:00:00Z",
      active: true,
      archived: false,
      closed: false,
      acceptingOrders: true,
      enableOrderBook: true,
    },
  ],
};

test("parses a Polymarket event URL to a Gamma slug", () => {
  assert.equal(
    parsePolymarketEventSlug(
      "https://polymarket.com/event/btc-updown-5m-1778415900"
    ),
    "btc-updown-5m-1778415900"
  );
});

test("normalizes a Gamma event into an Up watchlist item by default", () => {
  const item = normalizeGammaEventToWatchlistItem(gammaEvent);

  assert.equal(item.question, "Bitcoin Up or Down - May 10, 8:25AM-8:30AM ET");
  assert.equal(item.marketSlug, "btc-updown-5m-1778415900");
  assert.equal(item.outcomeLabel, "Up");
  assert.equal(item.marketType, "multi_outcome");
  assert.equal(item.eventType, "single_market");
  assert.deepEqual(item.outcomes, ["Up", "Down"]);
  assert.equal(item.oppositeOutcomeLabel, undefined);
  assert.equal(item.oppositeTokenId, undefined);
  assert.equal(item.eventMarketCount, 1);
  assert.equal(
    item.tokenId,
    "65280938700881719749804790429080618050749954395142741426010680600837471989622"
  );
  assert.equal(item.eventStartTime, "2026-05-10T12:25:00Z");
  assert.equal(item.eventEndTime, "2026-05-10T12:30:00Z");
  assert.equal(
    item.resolutionSource,
    "https://data.chain.link/streams/btc-usd"
  );
  assert.equal(item.active, true);
});

test("normalizes a requested outcome when importing a Gamma event", () => {
  const item = normalizeGammaEventToWatchlistItem(gammaEvent, {
    outcomeLabel: "Down",
  });

  assert.equal(item.outcomeLabel, "Down");
  assert.equal(
    item.tokenId,
    "43983957661072376000760020511311666546601443283262754526380755967283206100917"
  );
});

test("imports the highest-probability open market from a multi-market event", () => {
  const item = normalizeGammaEventToWatchlistItem(peaceDealEvent);

  assert.equal(
    item.question,
    "US x Iran permanent peace deal by December 31, 2026?"
  );
  assert.equal(item.conditionId, "0xdec");
  assert.equal(item.tokenId, "dec_yes");
  assert.equal(item.marketType, "binary");
  assert.equal(item.eventType, "multi_market");
  assert.deepEqual(item.outcomes, ["Yes", "No"]);
  assert.equal(item.oppositeOutcomeLabel, "No");
  assert.equal(item.oppositeTokenId, "dec_no");
  assert.equal(item.eventMarketCount, 3);
  assert.equal(item.eventEndTime, "2026-12-31T00:00:00Z");
  assert.equal(item.active, true);
});

test("imports the requested outcome from the selected open market", () => {
  const item = normalizeGammaEventToWatchlistItem(peaceDealEvent, {
    outcomeLabel: "No",
  });

  assert.equal(
    item.question,
    "US x Iran permanent peace deal by December 31, 2026?"
  );
  assert.equal(item.outcomeLabel, "No");
  assert.equal(item.side, "NO");
  assert.equal(item.tokenId, "dec_no");
  assert.equal(item.oppositeOutcomeLabel, "Yes");
  assert.equal(item.oppositeTokenId, "dec_yes");
});

test("fetches and resolves a Polymarket event URL", async () => {
  const requestedUrls = [];
  const item = await resolvePolymarketEventWatchlistItem(
    "https://polymarket.com/event/btc-updown-5m-1778415900",
    { outcomeLabel: "Up" },
    async (url) => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => gammaEvent,
      };
    }
  );

  assert.equal(requestedUrls.length, 1);
  assert.equal(
    requestedUrls[0],
    "https://gamma-api.polymarket.com/events/slug/btc-updown-5m-1778415900"
  );
  assert.equal(item.outcomeLabel, "Up");
});
