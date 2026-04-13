// ============================================
// MAIN ENTRY POINT
// ============================================

import type {
  KalshiCategoriesCache,
  PolymarketTagsCache,
} from "../types/market";
import type { UserSettings } from "../types/settings";

// Declare NTH_INSERTER as a global that may or may not exist
declare const NTH_INSERTER: typeof window.NTH_INSERTER | undefined;

const PRELOAD_WARMUP_IDLE_TIMEOUT_MS = 1000;

(async function main(): Promise<void> {
  const { log } = window.KNOWW_UTILS;
  const {
    CONFIG,
    ENABLED_SOURCES,
    loadUserSettings,
    isPlatformEnabled,
    isNotificationStackEnabled,
    isDebugMode,
  } = window.KNOWW_CONFIG;
  const { injectInlineStyles, injectMetamaskBridge } = window.KNOWW_STYLES;
  const { fetchPolymarketTags } = window.KNOWW_API;
  const { watchFeed } = window.KNOWW_INJECTION;
  const { initNotificationStack } = window.KNOWW_UI;

  // Load user settings first (before doing anything else)
  await loadUserSettings();

  // Get platform name for checking if enabled
  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  const platformName =
    platform?.name || window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown";

  // Check if current platform is enabled by user
  if (!isPlatformEnabled(platformName)) {
    if (isDebugMode()) {
      console.log(
        `[Knoww] Extension disabled for ${platformName} by user settings`
      );
    }
    return; // Exit early - user has disabled this platform
  }

  void window.KNOWW_ANALYTICS?.track("extension_started", {
    notificationStackEnabled: isNotificationStackEnabled(),
  });
  void window.KNOWW_ANALYTICS?.track("supported_page_detected", {
    platform: platformName,
  });

  // Inject required scripts and styles
  injectMetamaskBridge();
  injectInlineStyles();

  // Initialize notification stack for market discovery (if enabled)
  if (isNotificationStackEnabled()) {
    initNotificationStack();
  }

  // Pre-fetch data from enabled sources (cached for 24h)
  // MEMORY OPTIMIZATION: Only prefetch when tab is visible and after a delay
  // This reduces initial memory footprint and defers loading until needed
  const deferredPrefetch = (): void => {
    // Skip prefetch if tab is hidden
    if (document.hidden) {
      log("⏸️ Tab hidden, deferring prefetch");
      return;
    }

    const prefetchPromises: Promise<void>[] = [];

    // Pre-fetch Polymarket tags if enabled
    if (ENABLED_SOURCES?.polymarket) {
      prefetchPromises.push(
        fetchPolymarketTags()
          .then((tags: PolymarketTagsCache | null) => {
            if (tags) {
              log("Pre-fetched", tags.list?.length || 0, "Polymarket tags");
            }
          })
          .catch((error: unknown) => {
            if (isDebugMode()) {
              console.error("[Knoww] Polymarket prefetch failed:", error);
            }
          })
      );
    }

    // Pre-fetch Kalshi categories ONLY if enabled (lazy loading)
    // This saves memory when Kalshi is disabled
    if (ENABLED_SOURCES?.kalshi && window.KNOWW_KALSHI) {
      prefetchPromises.push(
        window.KNOWW_KALSHI.fetchKalshiCategories()
          .then((categories: KalshiCategoriesCache | null) => {
            if (categories) {
              log(
                "Pre-fetched",
                categories.categories?.length || 0,
                "Kalshi categories"
              );
            }
          })
          .catch(() => {})
      );
    }

    // Wait for all prefetches (don't block startup)
    Promise.all(prefetchPromises).catch(() => {});
  };

  // Defer prefetch to reduce initial memory spike
  const { scheduleIdle } = window.KNOWW_UTILS;
  scheduleIdle(deferredPrefetch, PRELOAD_WARMUP_IDLE_TIMEOUT_MS);

  scheduleIdle(() => {
    if (document.hidden) return;
    chrome.runtime
      .sendMessage({ type: "scoring:prewarm-offscreen" })
      .catch(() => {});
  }, PRELOAD_WARMUP_IDLE_TIMEOUT_MS);

  // Determine site-specific selectors using platform registry
  let itemSelector: string;
  let containerSelector: string;

  if (platform && typeof platform.getDynamicSelectors === "function") {
    // Use the platform adapter's dynamic selectors
    ({ itemSelector, containerSelector } = platform.getDynamicSelectors());
    log(`Using ${platform.name} platform adapter for selectors`);
  } else if (window.KNOWW_PLATFORM?.getSelectors) {
    // Fallback to platform registry's generic selectors
    const selectors = window.KNOWW_PLATFORM.getSelectors();
    itemSelector = selectors.item;
    containerSelector = selectors.container;
    log("Using platform registry selectors");
  } else {
    // Final fallback: use NTH_INSERTER or hardcoded selectors
    const host = location.hostname || "";
    const isLinkedIn = /(^|\.)linkedin\.com$/.test(host);
    const isReddit = /(^|\.)reddit\.com$/.test(host);
    const isQuora = /(^|\.)quora\.com$/.test(host);

    if (
      typeof NTH_INSERTER !== "undefined" &&
      NTH_INSERTER &&
      typeof NTH_INSERTER.getLinkedInSelectors === "function" &&
      typeof NTH_INSERTER.getXSelectors === "function" &&
      typeof NTH_INSERTER.getQuoraSelectors === "function"
    ) {
      if (isLinkedIn) {
        ({ itemSelector, containerSelector } =
          NTH_INSERTER.getLinkedInSelectors());
      } else if (isQuora) {
        ({ itemSelector, containerSelector } =
          NTH_INSERTER.getQuoraSelectors());
      } else {
        ({ itemSelector, containerSelector } = NTH_INSERTER.getXSelectors());
      }
      log("Using NTH_INSERTER selectors (legacy)");
    } else {
      // Hardcoded fallback selectors
      log("⚠️ No selector provider available, using hardcoded fallbacks");
      if (isLinkedIn) {
        itemSelector = "div.feed-shared-update-v2, div.occludable-update";
        containerSelector = ".scaffold-finite-scroll__content";
      } else if (isReddit) {
        itemSelector = "shreddit-post";
        containerSelector = "main";
      } else if (isQuora) {
        itemSelector =
          ".puppeteer_test_answer_content, [data-testid='answer_content']";
        containerSelector = "main";
      } else {
        itemSelector = 'article[data-testid="tweet"]';
        containerSelector = 'main[role="main"]';
      }
    }
  }

  // Log enabled sources
  const enabledSourcesList = Object.entries(ENABLED_SOURCES || {})
    .filter(([, enabled]) => enabled)
    .map(([source]) => source);

  log("🚀 Starting Knoww multi-source market injection");
  log("Platform:", platformName);
  log("Enabled sources:", enabledSourcesList.join(", ") || "none");
  log("Config:", {
    MIN_RELEVANCE_SCORE: CONFIG.MIN_RELEVANCE_SCORE,
    COOLDOWN_POSTS: CONFIG.COOLDOWN_POSTS,
    POSTS_TO_ANALYZE: CONFIG.POSTS_TO_ANALYZE,
  });
  log("Selectors:", { itemSelector, containerSelector });

  // Start watching the feed
  watchFeed(containerSelector, itemSelector);

  // Listen for settings changes to update behavior
  window.KNOWW_CONFIG.onSettingsChange((newSettings: UserSettings) => {
    log("Settings changed:", newSettings);

    // If platform was disabled, we could reload the page or stop watching
    // For now, just log it - changes will take effect on next page load
    const platformKey = platformName as keyof typeof newSettings.platforms;
    if (
      platformKey in newSettings.platforms &&
      !newSettings.platforms[platformKey]
    ) {
      log(
        `⚠️ ${platformName} disabled - changes will take effect on page reload`
      );
    }

    // Update notification stack visibility
    const stackElement = document.getElementById("knoww-notification-stack");
    if (stackElement) {
      stackElement.style.display = newSettings.showNotificationStack
        ? "block"
        : "none";
    }
  });

  // ============================================
  // MEMORY OPTIMIZATION: Tab visibility handler
  // Clean up caches when tab is hidden to reduce memory footprint
  // ============================================
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      log("📴 Tab hidden - triggering memory cleanup");

      // Prune stale market entries
      if (window.KNOWW_INJECTION?.pruneStaleMarkets) {
        window.KNOWW_INJECTION.pruneStaleMarkets();
      }

      // Clear processed posts cache (partial cleanup)
      if (window.KNOWW_INJECTION?.clearProcessedPostsCache) {
        window.KNOWW_INJECTION.clearProcessedPostsCache();
      }

      // Clear orphaned market IDs
      if (window.KNOWW_INJECTION?.clearInjectedMarketIdsCache) {
        window.KNOWW_INJECTION.clearInjectedMarketIdsCache();
      }

      // Clear API caches if available
      if (window.KNOWW_API?.clearTagsCache) {
        window.KNOWW_API.clearTagsCache();
      }

      log("✅ Memory cleanup completed");
    } else {
      log("📱 Tab visible - resuming normal operation");
    }
  });
})();
