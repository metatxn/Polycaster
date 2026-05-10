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
