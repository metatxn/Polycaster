// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPlatformAdapter: vi.fn(async () => false),
  loggerWarn: vi.fn(),
  prefetchTradingRuntime: vi.fn(),
  startXTraderPnlBadges: vi.fn(),
}));

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: mocks.loggerWarn,
  }),
}));
vi.mock("../../src/content/platform-loader", () => ({
  loadPlatformAdapter: mocks.loadPlatformAdapter,
}));
vi.mock("../../src/content/trading-loader", () => ({
  prefetchTradingRuntime: mocks.prefetchTradingRuntime,
}));
vi.mock("../../src/content/x-pnl-badges", () => ({
  startXTraderPnlBadges: mocks.startXTraderPnlBadges,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.loadPlatformAdapter.mockResolvedValue(false);
});

test("main stops before every downstream boot effect when no adapter loads", async () => {
  const calls = {
    getCurrentPlatform: vi.fn(() => null),
    getPlatformName: vi.fn(() => "unknown"),
    initNotificationStack: vi.fn(),
    injectInlineStyles: vi.fn(),
    injectMetamaskBridge: vi.fn(),
    isNotificationStackEnabled: vi.fn(() => true),
    isPlatformEnabled: vi.fn(() => true),
    loadUserSettings: vi.fn(async () => {}),
    onSettingsChange: vi.fn(),
    safeSendMessage: vi.fn(),
    scheduleIdle: vi.fn(),
    track: vi.fn(),
    watchFeed: vi.fn(),
  };
  Object.assign(window, {
    KNOWW_ANALYTICS: { track: calls.track },
    KNOWW_API: { fetchPolymarketTags: vi.fn() },
    KNOWW_CONFIG: {
      CONFIG: {},
      ENABLED_SOURCES: {},
      isDebugMode: vi.fn(() => false),
      isNotificationStackEnabled: calls.isNotificationStackEnabled,
      isPlatformEnabled: calls.isPlatformEnabled,
      loadUserSettings: calls.loadUserSettings,
      onSettingsChange: calls.onSettingsChange,
    },
    KNOWW_INJECTION: { watchFeed: calls.watchFeed },
    KNOWW_PLATFORM: {
      getCurrentPlatform: calls.getCurrentPlatform,
      getPlatformName: calls.getPlatformName,
    },
    KNOWW_STREAMING: { initStreamingMarkets: vi.fn() },
    KNOWW_STYLES: {
      injectInlineStyles: calls.injectInlineStyles,
      injectMetamaskBridge: calls.injectMetamaskBridge,
    },
    KNOWW_UI: { initNotificationStack: calls.initNotificationStack },
    KNOWW_UTILS: {
      log: vi.fn(),
      safeSendMessage: calls.safeSendMessage,
      scheduleIdle: calls.scheduleIdle,
    },
  });

  await import("../../src/content/main");
  await vi.waitFor(() =>
    expect(mocks.loadPlatformAdapter).toHaveBeenCalledTimes(1)
  );
  await Promise.resolve();

  expect(calls.loadUserSettings).toHaveBeenCalledTimes(1);
  expect(mocks.loadPlatformAdapter).toHaveBeenCalledWith(
    new URL(window.location.href)
  );
  expect(mocks.loggerWarn).toHaveBeenCalledWith(
    "platform.adapter_unavailable",
    { host: window.location.hostname }
  );
  for (const downstream of [
    calls.getCurrentPlatform,
    calls.getPlatformName,
    calls.isPlatformEnabled,
    calls.isNotificationStackEnabled,
    calls.track,
    calls.injectMetamaskBridge,
    calls.injectInlineStyles,
    calls.initNotificationStack,
    calls.scheduleIdle,
    calls.safeSendMessage,
    calls.watchFeed,
    mocks.prefetchTradingRuntime,
    mocks.startXTraderPnlBadges,
  ]) {
    expect(downstream).not.toHaveBeenCalled();
  }
});

test("feed startup begins discovery warm-up before watching the feed", async () => {
  const order: string[] = [];
  const watchFeed = vi.fn(() => {
    order.push("watch");
  });
  const fetchPolymarketTags = vi.fn(async () => {
    order.push("tags");
    return { list: [] };
  });
  const safeSendMessage = vi.fn(async (message: { type?: string }) => {
    if (message.type === "scoring:prewarm-offscreen") {
      order.push("scoring");
    }
    return { ok: true };
  });

  mocks.loadPlatformAdapter.mockResolvedValue(true);
  Object.assign(window, {
    KNOWW_ANALYTICS: { track: vi.fn() },
    KNOWW_API: { fetchPolymarketTags },
    KNOWW_CONFIG: {
      CONFIG: {
        COOLDOWN_POSTS: 4,
        MIN_RELEVANCE_SCORE: 0.3,
        POSTS_TO_ANALYZE: 3,
      },
      ENABLED_SOURCES: { kalshi: false, polymarket: true },
      isDebugMode: vi.fn(() => false),
      isNotificationStackEnabled: vi.fn(() => false),
      isPlatformEnabled: vi.fn(() => true),
      loadUserSettings: vi.fn(async () => {}),
      onSettingsChange: vi.fn(),
    },
    KNOWW_INJECTION: { watchFeed },
    KNOWW_PLATFORM: {
      getCurrentPlatform: vi.fn(() => ({
        getDynamicSelectors: () => ({
          containerSelector: "main",
          itemSelector: "article",
        }),
        name: "twitter",
        hostPatterns: [],
        surface: "feed",
      })),
    },
    KNOWW_STREAMING: { initStreamingMarkets: vi.fn() },
    KNOWW_STYLES: {
      injectInlineStyles: vi.fn(),
      injectMetamaskBridge: vi.fn(),
    },
    KNOWW_UI: {
      initNotificationStack: vi.fn(),
      updateNotificationStackTheme: vi.fn(),
    },
    KNOWW_UTILS: {
      log: vi.fn(),
      safeSendMessage,
      scheduleIdle: vi.fn(),
    },
  });

  await import("../../src/content/main");
  await vi.waitFor(() => expect(watchFeed).toHaveBeenCalledTimes(1));

  expect(order).toEqual(["tags", "scoring", "watch"]);
  window.dispatchEvent(new Event("pagehide"));
});
