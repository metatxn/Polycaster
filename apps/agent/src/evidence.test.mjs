import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidencePack, fetchAgentNewsUrl } from "./evidence.ts";

const item = {
  id: "item_1",
  question: "Will the test market resolve Yes?",
  tokenId: "token_1",
  side: "YES",
  outcomeLabel: "Yes",
  marketType: "binary",
  eventType: "single_market",
  outcomes: ["Yes", "No"],
  oppositeOutcomeLabel: "No",
  oppositeTokenId: "token_no",
  eventMarketCount: 1,
  eventStartTime: "2026-05-09T00:00:00.000Z",
  eventEndTime: "2026-05-10T00:00:00.000Z",
  resolutionSource: "https://example.com/resolution",
  newsUrls: [],
  socialNotes: [],
  active: true,
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

async function withMockedFetch(mockFetch, callback) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("rejects forbidden news targets, schemes, and credential-bearing URLs before fetch", async () => {
  let requestCount = 0;

  await withMockedFetch(
    async () => {
      requestCount += 1;
      return new Response("unreachable");
    },
    async () => {
      for (const url of [
        "http://www.reuters.com/world",
        "https://example.com/story",
        "https://127.0.0.1/admin",
        "https://169.254.169.254/latest/meta-data",
        "https://user:password@www.reuters.com/world",
      ]) {
        assert.equal(await fetchAgentNewsUrl(url), null);
      }
    }
  );

  assert.equal(requestCount, 0);
});

test("rejects a news redirect whose destination is not allowed", async () => {
  const requestedUrls = [];

  await withMockedFetch(
    async (input, init) => {
      requestedUrls.push(String(input));
      assert.equal(init?.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { Location: "https://127.0.0.1/internal" },
      });
    },
    async () => {
      assert.equal(
        await fetchAgentNewsUrl("https://www.reuters.com/world/story"),
        null
      );
    }
  );

  assert.deepEqual(requestedUrls, ["https://www.reuters.com/world/story"]);
});

test("stops following news redirects after the configured low hop cap", async () => {
  let requestCount = 0;

  await withMockedFetch(
    async (_input, init) => {
      requestCount += 1;
      assert.equal(init?.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { Location: `/redirect-${requestCount}` },
      });
    },
    async () => {
      assert.equal(
        await fetchAgentNewsUrl("https://www.reuters.com/world/story"),
        null
      );
    }
  );

  assert.equal(requestCount, 4);
});

test("rejects news responses whose declared length exceeds the byte cap", async () => {
  let bodyCancelled = false;
  const body = new ReadableStream({
    pull() {},
    cancel() {
      bodyCancelled = true;
    },
  });

  await withMockedFetch(
    async () =>
      new Response(body, {
        headers: {
          "Content-Length": "80001",
          "Content-Type": "text/html; charset=utf-8",
        },
      }),
    async () => {
      assert.equal(
        await fetchAgentNewsUrl("https://www.reuters.com/world/story"),
        null
      );
    }
  );

  assert.equal(bodyCancelled, true);
});

test("cancels a chunked news response once its decoded body exceeds the byte cap", async () => {
  const encoder = new TextEncoder();
  let bodyCancelled = false;
  let sentFirstChunk = false;
  const body = new ReadableStream({
    pull(controller) {
      if (!sentFirstChunk) {
        sentFirstChunk = true;
        controller.enqueue(encoder.encode("a".repeat(60_000)));
        return;
      }
      controller.enqueue(encoder.encode("b".repeat(30_001)));
    },
    cancel() {
      bodyCancelled = true;
    },
  });

  await withMockedFetch(
    async () =>
      new Response(body, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    async () => {
      assert.equal(
        await fetchAgentNewsUrl("https://www.reuters.com/world/story"),
        null
      );
    }
  );

  assert.equal(bodyCancelled, true);
});

test("rejects a non-text news response", async () => {
  await withMockedFetch(
    async () =>
      new Response(new Uint8Array([0, 1, 2, 3]), {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    async () => {
      assert.equal(
        await fetchAgentNewsUrl("https://www.reuters.com/world/story"),
        null
      );
    }
  );
});

test("accepts a bounded textual response from an allowed news host", async () => {
  await withMockedFetch(
    async () =>
      new Response(
        "<html><title>Bounded report</title><body>Verified reporting.</body></html>",
        {
          headers: {
            "Content-Length": "77",
            "Content-Type": "text/html; charset=utf-8",
          },
        }
      ),
    async () => {
      const news = await fetchAgentNewsUrl(
        "https://www.reuters.com/world/story"
      );
      assert.equal(news?.url, "https://www.reuters.com/world/story");
      assert.equal(news?.title, "Bounded report");
      assert.equal(news?.excerpt, "Bounded report Verified reporting.");
    }
  );
});

test("builds market evidence from the order book without side-less price fetches", async () => {
  const previousFetch = globalThis.fetch;
  const previousProviders = process.env.AGENT_SEARCH_PROVIDERS;
  process.env.AGENT_SEARCH_PROVIDERS = "";
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/prices-history?")) {
      const nowSec = Math.floor(Date.now() / 1000);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          history: [
            { t: nowSec - 86_400, p: 0.45 },
            { t: nowSec - 3_600, p: 0.46 },
            { t: nowSec - 300, p: 0.48 },
            { t: nowSec, p: 0.5 },
          ],
        }),
      };
    }
    assert.match(url, /\/book\?/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        bids: [
          { price: "0.40", size: "100" },
          { price: "0.39", size: "50" },
        ],
        asks: [
          { price: "0.60", size: "50" },
          { price: "0.61", size: "25" },
        ],
      }),
    };
  };

  try {
    const evidence = await buildEvidencePack(item);

    assert.equal(evidence.market.price, "0.5");
    assert.equal(evidence.market.liquidityUsd, "104.75");
    assert.equal(evidence.market.spread, "0.2");
    assert.equal(evidence.market.spreadPct, "40");
    assert.equal(evidence.market.orderBook.bidDepthUsdTop5, "59.5");
    assert.equal(evidence.market.orderBook.askDepthUsdTop5, "45.25");
    assert.equal(evidence.market.orderBook.bidAskImbalanceTop5, "0.136038");
    assert.equal(evidence.market.orderBook.bookPressure, "balanced");
    assert.equal(evidence.market.orderBook.thin, false);
    assert.equal(evidence.market.priceMovement.currentPrice, "0.5");
    assert.equal(evidence.market.priceMovement.priceChange5m, "0.02");
    assert.equal(evidence.market.priceMovement.priceChange1h, "0.04");
    assert.equal(evidence.market.priceMovement.priceChange24h, "0.05");
    assert.equal(evidence.market.priceMovement.trend, "up");
    assert.equal(evidence.market.outcomeLabel, "Yes");
    assert.equal(evidence.market.marketType, "binary");
    assert.equal(evidence.market.eventType, "single_market");
    assert.deepEqual(evidence.market.outcomes, ["Yes", "No"]);
    assert.equal(evidence.market.oppositeOutcomeLabel, "No");
    assert.equal(evidence.market.oppositeTokenId, "token_no");
    assert.equal(evidence.market.eventMarketCount, 1);
    assert.equal(evidence.market.eventEndTime, "2026-05-10T00:00:00.000Z");
    assert.equal(
      evidence.market.resolutionSource,
      "https://example.com/resolution"
    );
    assert.equal(requestedUrls.length, 2);
    assert.ok(!requestedUrls.some((url) => url.includes("/price?")));
    assert.deepEqual(evidence.search, []);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProviders === undefined) {
      delete process.env.AGENT_SEARCH_PROVIDERS;
    } else {
      process.env.AGENT_SEARCH_PROVIDERS = previousProviders;
    }
  }
});

test("adds top related markets from grouped Gamma events", async () => {
  const previousFetch = globalThis.fetch;
  const previousProviders = process.env.AGENT_SEARCH_PROVIDERS;
  process.env.AGENT_SEARCH_PROVIDERS = "";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("gamma-api.polymarket.com/events/slug/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          slug: "grouped-event",
          title: "Grouped event",
          archived: false,
          markets: [
            {
              question: "Will it happen by May 31, 2026?",
              conditionId: "condition_may",
              slug: "may-market",
              outcomes: '["Yes", "No"]',
              clobTokenIds: '["may_yes", "may_no"]',
              outcomePrices: '["0.2", "0.8"]',
              endDate: "2026-05-31T00:00:00.000Z",
              active: true,
              closed: false,
              acceptingOrders: true,
            },
            {
              question: "Will it happen by December 31, 2026?",
              conditionId: "condition_dec",
              slug: "dec-market",
              outcomes: '["Yes", "No"]',
              clobTokenIds: '["dec_yes", "dec_no"]',
              outcomePrices: '["0.7", "0.3"]',
              endDate: "2026-12-31T00:00:00.000Z",
              active: true,
              closed: false,
              acceptingOrders: true,
            },
            {
              question: "Will it happen by June 30, 2026?",
              conditionId: "condition_june",
              slug: "june-market",
              outcomes: '["Yes", "No"]',
              clobTokenIds: '["june_yes", "june_no"]',
              outcomePrices: '["0.4", "0.6"]',
              endDate: "2026-05-31T00:00:00.000Z",
              active: true,
              closed: false,
              acceptingOrders: true,
            },
          ],
        }),
      };
    }
    if (url.includes("/prices-history?")) {
      return { ok: true, status: 200, json: async () => ({ history: [] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        bids: [{ price: "0.69", size: "100" }],
        asks: [{ price: "0.71", size: "100" }],
      }),
    };
  };

  try {
    const evidence = await buildEvidencePack({
      ...item,
      tokenId: "dec_yes",
      marketSlug: "grouped-event",
      outcomeLabel: "Yes",
      marketType: "binary",
      eventType: "multi_market",
      eventMarketCount: 3,
    });

    assert.deepEqual(
      evidence.relatedMarkets.map((market) => ({
        question: market.question,
        eventEndTime: market.eventEndTime,
        price: market.price,
        selected: market.selected,
      })),
      [
        {
          question: "Will it happen by December 31, 2026?",
          eventEndTime: "2026-12-31T00:00:00.000Z",
          price: "0.7",
          selected: true,
        },
        {
          question: "Will it happen by June 30, 2026?",
          eventEndTime: "2026-06-30T00:00:00.000Z",
          price: "0.4",
          selected: false,
        },
        {
          question: "Will it happen by May 31, 2026?",
          eventEndTime: "2026-05-31T00:00:00.000Z",
          price: "0.2",
          selected: false,
        },
      ]
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProviders === undefined) {
      delete process.env.AGENT_SEARCH_PROVIDERS;
    } else {
      process.env.AGENT_SEARCH_PROVIDERS = previousProviders;
    }
  }
});
