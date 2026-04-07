export interface PlatformSettings {
  twitter: boolean;
  linkedin: boolean;
  reddit: boolean;
  quora: boolean;
  hackernews: boolean;
  stackoverflow: boolean;
  stackexchange: boolean;
  producthunt: boolean;
  slashdot: boolean;
  lemmy: boolean;
  threads: boolean;
  bluesky: boolean;
  mastodon: boolean;
  discord: boolean;
  youtube: boolean;
}

/**
 * User settings interface for the Knoww extension
 */
export interface UserSettings {
  platforms: PlatformSettings;
  sources: {
    polymarket: boolean;
    kalshi: boolean;
  };
  relevanceThreshold: number;
  cooldownPosts: number;
  showNotificationStack: boolean;
  aiExtractionEnabled: boolean;
  personalizationEnabled: boolean;
  themeOverride: "auto" | "dark" | "light" | "dim";
  debugMode: boolean;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  twitter: true,
  linkedin: true,
  reddit: true,
  quora: true,
  hackernews: true,
  stackoverflow: true,
  stackexchange: true,
  producthunt: true,
  slashdot: true,
  lemmy: true,
  threads: true,
  bluesky: true,
  mastodon: true,
  discord: true,
  youtube: true,
};

/**
 * Default user settings
 */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  platforms: { ...DEFAULT_PLATFORM_SETTINGS },
  sources: {
    polymarket: true,
    kalshi: false, // Disabled for now — re-enable when Kalshi integration is ready
  },
  relevanceThreshold: 0.3,
  cooldownPosts: 4,
  showNotificationStack: true,
  aiExtractionEnabled: true,
  personalizationEnabled: true,
  themeOverride: "auto",
  debugMode: false,
};

/**
 * Enabled sources configuration with dynamic getters
 */
export interface EnabledSources {
  polymarket: boolean;
  kalshi: boolean;
}

/**
 * Configuration for auto-injection behavior
 */
export interface Config {
  POSTS_TO_ANALYZE: number;
  MIN_RELEVANCE_SCORE: number;
  COOLDOWN_POSTS: number;
  USE_AI_EXTRACTION: boolean;
}
