// @vitest-environment jsdom

import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

const mixedEvent = {
  id: "mixed-event",
  title: "Mixed Polymarket event",
  slug: "mixed-polymarket-event",
  active: true,
  closed: false,
  markets: [
    {
      id: "already-closed",
      active: true,
      closed: true,
      outcomePrices: ["0.55", "0.45"],
    },
    {
      id: "eligible",
      active: true,
      closed: false,
      outcomePrices: ["0.65", "0.35"],
    },
  ],
};

// One child above the display cap means the event is effectively decided, so
// the whole event must disappear instead of surfacing its runner-up markets.
const decidedEvent = {
  id: "decided-event",
  title: "Decided Polymarket event",
  slug: "decided-polymarket-event",
  active: true,
  closed: false,
  markets: [
    {
      id: "nearly-resolved",
      active: true,
      closed: false,
      outcomePrices: ["0.96", "0.04"],
    },
    {
      id: "runner-up",
      active: true,
      closed: false,
      outcomePrices: ["0.65", "0.35"],
    },
  ],
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("__DEV_MODE__", false);
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension",
      lastError: undefined,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(),
    },
  });
});

async function loadApiWithResponse(responseData: unknown) {
  const apiModule = await import("../../src/content/api");
  const safeSendMessage = vi.fn(async () => ({
    ok: true,
    status: 200,
    data: responseData,
  }));

  Object.assign(window, {
    KNOWW_UTILS: {
      isExtensionContextValid: () => true,
      log: vi.fn(),
      safeSendMessage,
    },
  });

  return { api: apiModule.KNOWW_API, safeSendMessage };
}

test("direct event resolution keeps eligible children from a mixed event", async () => {
  const { api } = await loadApiWithResponse({
    success: true,
    event: mixedEvent,
  });

  const markets = await api.resolvePolymarketMarketsFromHints([
    {
      source: "polymarket",
      url: "https://polymarket.com/event/mixed-polymarket-event",
      title: "Mixed Polymarket event",
    },
  ]);

  assert.equal(markets.length, 1);
  assert.deepEqual(
    markets[0].markets?.map((market) => market.id),
    ["eligible"]
  );
});

test("direct event resolution drops an event once any child crosses the cap", async () => {
  const { api } = await loadApiWithResponse({
    success: true,
    event: decidedEvent,
  });

  const markets = await api.resolvePolymarketMarketsFromHints([
    {
      source: "polymarket",
      url: "https://polymarket.com/event/decided-polymarket-event",
      title: "Decided Polymarket event",
    },
  ]);

  assert.equal(markets.length, 0);
});

test("generic Polymarket search keeps eligible children from a mixed event", async () => {
  const { api } = await loadApiWithResponse({ events: [mixedEvent] });

  const markets = await api.searchAllMarkets("mixed polymarket event", []);

  assert.equal(markets.length, 1);
  assert.deepEqual(
    markets[0].markets?.map((market) => market.id),
    ["eligible"]
  );
});

test("live event refresh keeps the same eligible nested children", async () => {
  const { api } = await loadApiWithResponse({
    success: true,
    event: mixedEvent,
  });

  const market = await api.fetchPolymarketEventRefresh({
    id: mixedEvent.id,
    slug: mixedEvent.slug,
    source: "polymarket",
    title: mixedEvent.title,
  });

  assert.ok(market);
  assert.deepEqual(
    market.markets?.map((nestedMarket) => nestedMarket.id),
    ["eligible"]
  );
});
