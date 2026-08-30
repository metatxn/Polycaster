// @vitest-environment jsdom

import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { Market } from "../../src/types/market";

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

beforeEach(() => {
  document.body.innerHTML = "";
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

async function loadInjection(overrides: {
  api?: Record<string, unknown>;
  platform: Record<string, unknown>;
  utils?: Record<string, unknown>;
}) {
  await import("../../src/content/injection");

  const defaults = {
    extractPostText: vi.fn(() => "2% chance the FDA approves Retatrutide."),
    isEnglishText: vi.fn(() => true),
    isExtensionContextValid: vi.fn(() => true),
    log: vi.fn(),
    safeSendMessage: vi.fn(),
    scheduleIdle: vi.fn((callback: () => void) => callback()),
  };
  const utils = { ...defaults, ...overrides.utils };

  Object.assign(window, {
    KNOWW_API: overrides.api,
    KNOWW_CONFIG: {
      CONFIG: {
        COOLDOWN_POSTS: 4,
        MIN_RELEVANCE_SCORE: 0.3,
        POSTS_TO_ANALYZE: 3,
      },
      DEV_MODE: false,
      ENABLED_SOURCES: { kalshi: false, polymarket: true },
      isDebugMode: () => false,
    },
    KNOWW_PLATFORM: {
      getCurrentPlatform: () => overrides.platform,
    },
    KNOWW_UTILS: utils,
  });

  return {
    analyze: window.KNOWW_INJECTION.analyzePostAndFindMarket,
    getMemoryStats: window.KNOWW_INJECTION.getMemoryStats,
    processVisiblePosts: window.KNOWW_INJECTION.processVisiblePosts,
    utils,
  };
}

test("an unavailable explicit Polymarket link never falls back to semantic search", async () => {
  const extractSearchKeywords = vi.fn(async () => ({
    keywords: "fda retatrutide",
    matchedTags: [],
    source: "rules" as const,
  }));
  const searchAllMarkets = vi.fn(async () => []);
  const resolvePolymarketMarketsFromHints = vi.fn(async () => []);
  const { analyze, utils } = await loadInjection({
    api: {
      calculateRelevanceScore: vi.fn(),
      extractSearchKeywords,
      resolvePolymarketMarketsFromHints,
      searchAllMarkets,
    },
    platform: {
      name: "twitter",
      extractMarketLinkHints: () => [
        {
          source: "polymarket",
          title: "FDA approves Retatrutide this year?",
          url: "https://t.co/retatrutide",
        },
      ],
    },
  });

  const result = await analyze(document.createElement("article"));

  assert.equal(result, null);
  assert.equal(resolvePolymarketMarketsFromHints.mock.calls.length, 1);
  assert.equal(
    (utils.isEnglishText as ReturnType<typeof vi.fn>).mock.calls.length,
    0
  );
  assert.equal(extractSearchKeywords.mock.calls.length, 0);
  assert.equal(searchAllMarkets.mock.calls.length, 0);
});

test("structured direct markets remove ineligible nested children before display", async () => {
  const mixedMarket: Market = {
    id: "mixed-event",
    title: "Mixed direct event",
    source: "polymarket",
    active: true,
    closed: false,
    markets: [
      {
        id: "nearly-resolved",
        active: true,
        outcomePrices: ["0.95", "0.05"],
      },
      {
        id: "eligible",
        active: true,
        outcomePrices: ["0.65", "0.35"],
      },
    ],
  };
  const { analyze } = await loadInjection({
    api: {
      calculateRelevanceScore: vi.fn(),
      extractSearchKeywords: vi.fn(),
      resolvePolymarketMarketsFromHints: vi.fn(async () => []),
      searchAllMarkets: vi.fn(),
    },
    platform: {
      name: "test-direct",
      resolveDirectMarkets: vi.fn(async () => ({
        bypassGenericSearch: true,
        markets: [{ market: mixedMarket, score: 1 }],
        postText: "Mixed direct event",
        topics: ["test"],
      })),
    },
  });

  const result = await analyze(document.createElement("article"));

  assert.ok(result);
  assert.deepEqual(
    result.markets[0].market.markets?.map((market) => market.id),
    ["eligible"]
  );
});

test("an explicit Polymarket link bypasses the normal post cooldown", async () => {
  const resolvePolymarketMarketsFromHints = vi.fn(async () => []);
  const { processVisiblePosts } = await loadInjection({
    api: {
      calculateRelevanceScore: vi.fn(),
      extractSearchKeywords: vi.fn(),
      resolvePolymarketMarketsFromHints,
      searchAllMarkets: vi.fn(),
    },
    platform: {
      name: "twitter",
      getPostId: () => "direct-post",
      extractMarketLinkHints: () => [
        {
          source: "polymarket",
          title: "Direct market",
          url: "https://t.co/direct-market",
        },
      ],
    },
  });
  const post = document.createElement("article");
  post.textContent = "A post with one explicit Polymarket link";
  document.body.append(post);

  await processVisiblePosts({ itemSelector: "article" });

  assert.equal(resolvePolymarketMarketsFromHints.mock.calls.length, 1);
});

test("explicit links deferred by the analysis batch limit continue draining", async () => {
  const resolvePolymarketMarketsFromHints = vi.fn(async () => []);
  const { getMemoryStats, processVisiblePosts } = await loadInjection({
    api: {
      calculateRelevanceScore: vi.fn(),
      extractSearchKeywords: vi.fn(),
      resolvePolymarketMarketsFromHints,
      searchAllMarkets: vi.fn(),
    },
    platform: {
      name: "twitter",
      getPostId: (post: Element) => post.getAttribute("data-post-id"),
      extractMarketLinkHints: (post: Element) => [
        {
          source: "polymarket",
          title: `Direct market ${post.getAttribute("data-post-id")}`,
          url: `https://t.co/${post.getAttribute("data-post-id")}`,
        },
      ],
    },
  });
  for (let index = 0; index < 4; index++) {
    const post = document.createElement("article");
    post.setAttribute("data-post-id", `post-${index}`);
    post.textContent = `English test post number ${index}`;
    document.body.append(post);
  }

  await processVisiblePosts({ itemSelector: "article" });

  await vi.waitFor(() => {
    assert.equal(getMemoryStats().totalPostsProcessed, 4);
  });
  assert.equal(resolvePolymarketMarketsFromHints.mock.calls.length, 4);
});

test("generic posts retain the configured analysis batch cap", async () => {
  const { getMemoryStats, processVisiblePosts } = await loadInjection({
    api: {
      calculateRelevanceScore: vi.fn(),
      extractSearchKeywords: vi.fn(async () => ({
        keywords: "test topic",
        matchedTags: [],
        source: "rules" as const,
      })),
      resolvePolymarketMarketsFromHints: vi.fn(async () => []),
      searchAllMarkets: vi.fn(async () => []),
    },
    platform: {
      name: "twitter",
      getPostId: (post: Element) => post.getAttribute("data-post-id"),
      extractMarketLinkHints: () => [],
    },
  });
  for (let index = 0; index < 4; index++) {
    const post = document.createElement("article");
    post.setAttribute("data-post-id", `generic-${index}`);
    post.textContent = `English generic post number ${index}`;
    document.body.append(post);
  }

  await processVisiblePosts({ itemSelector: "article" });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(getMemoryStats().totalPostsProcessed, 3);
});
