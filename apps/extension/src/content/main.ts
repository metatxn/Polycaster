// ============================================
// MAIN ENTRY POINT
// ============================================

import { createLogger } from "@knoww/logger";
import { isOnboardingWalletSetupUrl } from "../onboarding-state";
import type {
  KalshiCategoriesCache,
  PolymarketTagsCache,
} from "../types/market";
import type { UserSettings } from "../types/settings";
import { isWebmailUrl } from "../webmail";
import { startDiscoveryWarmup } from "./discovery-warmup";
import { loadPlatformAdapter } from "./platform-loader";
import { prefetchTradingRuntime } from "./trading-loader";
import { startXTraderPnlBadges } from "./x-pnl-badges";

const logger = createLogger("extension.main");

// Declare NTH_INSERTER as a global that may or may not exist
declare const NTH_INSERTER: typeof window.NTH_INSERTER | undefined;

const PRELOAD_WARMUP_IDLE_TIMEOUT_MS = 1000;
const FIRST_TRADING_CARD_SELECTOR =
  '.knoww-market-card[data-nth-injector-card="true"]';

export function observeFirstMountedTradingCard(
  scheduleIdle: (callback: () => void, timeout: number) => void = window
    .KNOWW_UTILS.scheduleIdle,
  prefetch: () => void = prefetchTradingRuntime
): () => void {
  let stopped = false;
  let matchedCard: HTMLElement | null = null;
  const removePagehideListener = (): void => {
    window.removeEventListener("pagehide", stop);
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    removePagehideListener();
  };
  const observer = new MutationObserver(() => {
    if (stopped || matchedCard) return;
    const card = document.querySelector<HTMLElement>(
      FIRST_TRADING_CARD_SELECTOR
    );
    if (!card?.isConnected) return;
    matchedCard = card;
    observer.disconnect();
    scheduleIdle(() => {
      if (stopped || document.hidden || !matchedCard?.isConnected) {
        stop();
        return;
      }
      prefetch();
      stop();
    }, PRELOAD_WARMUP_IDLE_TIMEOUT_MS);
  });
  window.addEventListener("pagehide", stop, { once: true });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  return stop;
}

(async function main(): Promise<void> {
  if (isWebmailUrl(window.location.href)) return;
  const { log, safeSendMessage } = window.KNOWW_UTILS;
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

  if (isOnboardingWalletSetupUrl(window.location.href)) {
    injectMetamaskBridge();
    return;
  }

  // Load user settings first (before doing anything else)
  await loadUserSettings();
  const platformLoaded = await loadPlatformAdapter(
    new URL(window.location.href)
  );
  if (!platformLoaded) {
    logger.warn("platform.adapter_unavailable", {
      host: window.location.hostname,
    });
    return;
  }

  // Get platform name for checking if enabled
  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  if (!platform) {
    logger.warn("platform.detection_unavailable", {
      host: window.location.hostname,
    });
    return;
  }
  const platformName = platform.name;

  // Check if current platform is enabled by user
  if (!isPlatformEnabled(platformName)) {
    if (isDebugMode()) {
      logger.debug("platform.disabled", { platformName });
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

  if (platformName === "twitter") {
    startXTraderPnlBadges();
  }

  // Kalshi remains idle-loaded because it is disabled by default and is not
  // part of the Polymarket first-card path.
  const deferredKalshiPrefetch = (): void => {
    if (document.hidden) {
      log("⏸️ Tab hidden, deferring prefetch");
      return;
    }

    if (ENABLED_SOURCES?.kalshi && window.KNOWW_KALSHI) {
      void window.KNOWW_KALSHI.fetchKalshiCategories()
        .then((categories: KalshiCategoriesCache | null) => {
          if (categories) {
            log(
              "Pre-fetched",
              categories.categories?.length || 0,
              "Kalshi categories"
            );
          }
        })
        .catch(() => {});
    }
  };

  const { scheduleIdle } = window.KNOWW_UTILS;
  if (ENABLED_SOURCES?.kalshi) {
    scheduleIdle(deferredKalshiPrefetch, PRELOAD_WARMUP_IDLE_TIMEOUT_MS);
  }

  // Streaming surfaces (Twitch/YouTube/…) have no feed of posts. Instead of
  // scanning the page and running the relevance pipeline, surface a single
  // companion Live Markets card seeded by the stream's game/category. Skip
  // watchFeed (and thus the English check → context gate → AI score filtering)
  // entirely.
  if (platform?.surface === "stream") {
    log(
      "🎥 Streaming platform detected — starting Live Markets card:",
      platformName
    );
    window.KNOWW_STREAMING?.initStreamingMarkets?.();
    return;
  }

  startDiscoveryWarmup({
    isHidden: () => document.hidden,
    onError: (target, error) => {
      if (isDebugMode()) {
        logger.error("discovery.prewarm_failed", { error, target });
      }
    },
    warmScoring: () => safeSendMessage({ type: "scoring:prewarm-offscreen" }),
    warmTags: ENABLED_SOURCES?.polymarket
      ? async () => {
          const tags: PolymarketTagsCache | null = await fetchPolymarketTags();
          if (tags) {
            log("Pre-fetched", tags.list?.length || 0, "Polymarket tags");
          }
        }
      : undefined,
  });

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

  // No in-page trading panel ships in the store-compliant build, so there is
  // nothing to prefetch/warm.
  if (!__STORE_BUILD__) {
    observeFirstMountedTradingCard(scheduleIdle);
  }

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
    window.KNOWW_UI.updateNotificationStackTheme?.();
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
