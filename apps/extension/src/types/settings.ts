/**
 * User settings interface for the Knoww extension
 */
export interface UserSettings {
  platforms: {
    twitter: boolean;
    linkedin: boolean;
    reddit: boolean;
    quora: boolean;
  };
  sources: {
    polymarket: boolean;
    kalshi: boolean;
  };
  relevanceThreshold: number;
  aiConfidenceThreshold: number;
  cooldownPosts: number;
  showNotificationStack: boolean;
  aiExtractionEnabled: boolean;
  personalizationEnabled: boolean;
  themeOverride: "auto" | "dark" | "light" | "dim";
  debugMode: boolean;
}

/**
 * Default user settings
 */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  platforms: {
    twitter: true,
    linkedin: true,
    reddit: true,
    quora: true,
  },
  sources: {
    polymarket: true,
    kalshi: false, // Disabled for now — re-enable when Kalshi integration is ready
  },
  relevanceThreshold: 0.3,
  aiConfidenceThreshold: 0.3,
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
  MIN_AI_CONFIDENCE: number;
  COOLDOWN_POSTS: number;
  USE_AI_EXTRACTION: boolean;
}
