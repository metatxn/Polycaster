// ============================================
// CONFIGURATION
// ============================================

import { createLogger } from "@knoww/logger";
import {
  type Config,
  DEFAULT_STREAM_TRADING_SETTINGS,
  DEFAULT_USER_SETTINGS,
  type EnabledSources,
  type StreamTradingSettings,
  type UserSettings,
} from "../types/settings";

import { shouldAutoShowNotificationStack } from "./notification-surface";

const log = createLogger("extension.config");

// ============================================
// BUILD MODE
// Injected by webpack DefinePlugin: true for development, false for production.
// Ambient type declared in env.d.ts.
// ============================================
const DEV_MODE = __DEV_MODE__;

// Current user settings (will be populated from chrome.storage)
let USER_SETTINGS: UserSettings = { ...DEFAULT_USER_SETTINGS };

function canUseSyncStorage(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      !!chrome.runtime?.id &&
      !!chrome.storage?.sync
    );
  } catch {
    return false;
  }
}

// ============================================
// POLYMARKET API URLs (HTTPS only)
// ============================================
const POLYMARKET_SEARCH_API_URL =
  "https://gamma-api.polymarket.com/public-search";
const POLYMARKET_TAGS_API_URL = "https://gamma-api.polymarket.com/tags";
const POLYMARKET_EVENTS_API_URL = "https://gamma-api.polymarket.com/events";
const POLYMARKET_EVENTS_KEYSET_API_URL =
  "https://gamma-api.polymarket.com/events/keyset";

// ============================================
// KALSHI API URLs (HTTPS only)
// ============================================
const KALSHI_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_EVENTS_API_URL = `${KALSHI_BASE_URL}/events`;
const KALSHI_MARKETS_API_URL = `${KALSHI_BASE_URL}/markets`;
const KALSHI_TAGS_API_URL = `${KALSHI_BASE_URL}/search/tags_by_categories`;
const KALSHI_SERIES_API_URL = `${KALSHI_BASE_URL}/series`;

// Kalshi v1 Search API (used by Kalshi platform for text search)
const KALSHI_SEARCH_API_URL =
  "https://api.elections.kalshi.com/v1/search/series";

// Kalshi website URL for market links
const KALSHI_WEB_URL = "https://kalshi.com";

// ============================================
// APP URLs
// ============================================
const KNOWW_APP_URL = DEV_MODE ? "http://localhost:8000" : "https://knoww.app";

// ============================================
// ENABLED MARKET SOURCES (dynamic based on user settings)
// ============================================
const ENABLED_SOURCES: EnabledSources = {
  get polymarket() {
    return (
      USER_SETTINGS.sources?.polymarket ??
      DEFAULT_USER_SETTINGS.sources.polymarket
    );
  },
  get kalshi() {
    return (
      USER_SETTINGS.sources?.kalshi ?? DEFAULT_USER_SETTINGS.sources.kalshi
    );
  },
};

// ============================================
// CONFIGURATION FOR AUTO-INJECTION (dynamic based on user settings)
// ============================================
const CONFIG: Config = {
  POSTS_TO_ANALYZE: 3,
  get MIN_RELEVANCE_SCORE() {
    return (
      USER_SETTINGS.relevanceThreshold ??
      DEFAULT_USER_SETTINGS.relevanceThreshold
    );
  },
  get COOLDOWN_POSTS() {
    return USER_SETTINGS.cooldownPosts ?? DEFAULT_USER_SETTINGS.cooldownPosts;
  },
  get USE_AI_EXTRACTION() {
    return (
      USER_SETTINGS.aiExtractionEnabled ??
      DEFAULT_USER_SETTINGS.aiExtractionEnabled
    );
  },
};

// Cache duration for tags (24 hours)
const TAGS_CACHE_DURATION = 24 * 60 * 60 * 1000;

// ============================================
// SETTINGS LOADER
// ============================================

/**
 * Load user settings from chrome.storage.sync
 */
async function loadUserSettings(): Promise<UserSettings> {
  return new Promise((resolve) => {
    if (!canUseSyncStorage()) {
      USER_SETTINGS = { ...DEFAULT_USER_SETTINGS };
      resolve(USER_SETTINGS);
      return;
    }

    try {
      chrome.storage.sync.get(
        { knowwSettings: DEFAULT_USER_SETTINGS },
        (result) => {
          const storedSettings = result.knowwSettings as
            | Partial<UserSettings>
            | undefined;
          // Merge with defaults to ensure all properties exist
          USER_SETTINGS = {
            ...DEFAULT_USER_SETTINGS,
            ...(storedSettings || {}),
            platforms: {
              ...DEFAULT_USER_SETTINGS.platforms,
              ...(storedSettings?.platforms || {}),
            },
            sources: {
              ...DEFAULT_USER_SETTINGS.sources,
              ...(storedSettings?.sources || {}),
              // Force-align with defaults for sources that are disabled at the code level.
              // This ensures DEFAULT_USER_SETTINGS is the single source of truth,
              // even when chrome.storage.sync has a stale value from a previous version.
              kalshi: DEFAULT_USER_SETTINGS.sources.kalshi,
            },
          };

          if (USER_SETTINGS.debugMode || DEV_MODE) {
            log.debug("settings.loaded", { USER_SETTINGS });
          }

          resolve(USER_SETTINGS);
        }
      );
    } catch {
      USER_SETTINGS = { ...DEFAULT_USER_SETTINGS };
      resolve(USER_SETTINGS);
    }
  });
}

/**
 * Get current user settings
 */
function getUserSettings(): UserSettings {
  return USER_SETTINGS;
}

/**
 * Check if a platform is enabled
 */
function isPlatformEnabled(platformName: string): boolean {
  const platforms = USER_SETTINGS.platforms;
  if (platformName in platforms) {
    return platforms[platformName as keyof typeof platforms];
  }

  const defaultPlatforms = DEFAULT_USER_SETTINGS.platforms;
  if (platformName in defaultPlatforms) {
    return defaultPlatforms[platformName as keyof typeof defaultPlatforms];
  }

  return true;
}

/**
 * Check if a market source is enabled
 */
function isSourceEnabled(sourceName: string): boolean {
  const sources = USER_SETTINGS.sources as Record<string, boolean>;
  const defaultSources = DEFAULT_USER_SETTINGS.sources as Record<
    string,
    boolean
  >;
  return sources?.[sourceName] ?? defaultSources[sourceName] ?? true;
}

/**
 * Check if notification stack should be shown
 */
function isNotificationStackEnabled(): boolean {
  return shouldAutoShowNotificationStack(
    USER_SETTINGS.showNotificationStack ??
      DEFAULT_USER_SETTINGS.showNotificationStack,
    USER_SETTINGS.notificationPanelSurface ??
      DEFAULT_USER_SETTINGS.notificationPanelSurface
  );
}

/**
 * One-click betting preferences for the streaming Live Markets card.
 * Always returns a fully-populated object (defaults merged in).
 */
function getStreamTradingSettings(): StreamTradingSettings {
  return {
    ...DEFAULT_STREAM_TRADING_SETTINGS,
    ...(USER_SETTINGS.streamTrading || {}),
  };
}

/**
 * Check if usage analytics should be sent
 */
function isUsageAnalyticsEnabled(): boolean {
  return USER_SETTINGS.usageAnalyticsEnabled === true;
}

/**
 * Get theme override setting
 */
function getThemeOverride(): string {
  return USER_SETTINGS.themeOverride ?? DEFAULT_USER_SETTINGS.themeOverride;
}

/**
 * Check if debug mode is enabled
 */
function isDebugMode(): boolean {
  return USER_SETTINGS.debugMode === true || DEV_MODE;
}

/**
 * Listen for settings updates from the options page
 */
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (
      message: { type: string; settings?: UserSettings },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean }) => void
    ) => {
      if (message.type === "KNOWW_SETTINGS_UPDATED" && message.settings) {
        USER_SETTINGS = {
          ...DEFAULT_USER_SETTINGS,
          ...message.settings,
          platforms: {
            ...DEFAULT_USER_SETTINGS.platforms,
            ...(message.settings.platforms || {}),
          },
          sources: {
            ...DEFAULT_USER_SETTINGS.sources,
            ...(message.settings.sources || {}),
          },
        };

        // Notify other modules that settings have changed
        if (window.KNOWW_SETTINGS_LISTENERS) {
          for (const listener of window.KNOWW_SETTINGS_LISTENERS) {
            try {
              listener(USER_SETTINGS);
            } catch (e) {
              log.error("settings.listener_error", { error: e });
            }
          }
        }

        sendResponse({ success: true });
        return; // Response sent synchronously, no need to return true
      }

      // Let other content-script modules answer their own message types.
      return false;
    }
  );
}

// Initialize settings listeners array
if (typeof window !== "undefined") {
  window.KNOWW_SETTINGS_LISTENERS = window.KNOWW_SETTINGS_LISTENERS || [];
}

/**
 * Register a callback to be notified when settings change
 */
function onSettingsChange(callback: (settings: UserSettings) => void): void {
  if (typeof callback === "function" && typeof window !== "undefined") {
    window.KNOWW_SETTINGS_LISTENERS.push(callback);
  }
}

// Export for use in other modules
export const KNOWW_CONFIG = {
  DEV_MODE,
  // Polymarket
  POLYMARKET_SEARCH_API_URL,
  POLYMARKET_TAGS_API_URL,
  POLYMARKET_EVENTS_API_URL,
  POLYMARKET_EVENTS_KEYSET_API_URL,
  // Kalshi
  KALSHI_BASE_URL,
  KALSHI_EVENTS_API_URL,
  KALSHI_MARKETS_API_URL,
  KALSHI_TAGS_API_URL,
  KALSHI_SERIES_API_URL,
  KALSHI_SEARCH_API_URL,
  KALSHI_WEB_URL,
  // App
  KNOWW_APP_URL,
  // Settings (dynamic getters)
  ENABLED_SOURCES,
  CONFIG,
  TAGS_CACHE_DURATION,
  // User settings
  DEFAULT_USER_SETTINGS,
  getStreamTradingSettings,
  getUserSettings,
  loadUserSettings,
  isPlatformEnabled,
  isSourceEnabled,
  isNotificationStackEnabled,
  isUsageAnalyticsEnabled,
  getThemeOverride,
  isDebugMode,
  onSettingsChange,
};

if (typeof window !== "undefined") {
  window.KNOWW_CONFIG = KNOWW_CONFIG;
}
