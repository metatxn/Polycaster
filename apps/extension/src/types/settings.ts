export interface PlatformSettings {
  // Streaming surfaces (companion Live Markets card)
  twitch: boolean;
  // Core social / community
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
  farcaster: boolean;
  // Crypto publishers
  coinmarketcap: boolean;
  paragraph: boolean;
  coindesk: boolean;
  cointelegraph: boolean;
  decrypt: boolean;
  theblock: boolean;
  blockworks: boolean;
  bankless: boolean;
  bitcoinmagazine: boolean;
  beincrypto: boolean;
  unchained: boolean;
  cryptopanic: boolean;
  // News publishers
  cnn: boolean;
  nytimes: boolean;
  wsj: boolean;
  "washington-post": boolean;
  thehindu: boolean;
  "hindustan-times": boolean;
  cnbc: boolean;
  forbes: boolean;
  "yahoo-finance": boolean;
  dlnews: boolean;
  // Tech publishers
  cnet: boolean;
  zdnet: boolean;
  tomshardware: boolean;
  // Sports publishers
  skysports: boolean;
  "sporting-news": boolean;
  "fox-sports": boolean;
  // Prediction-market websites
  "kalshi-platform": boolean;
  "manifold-markets": boolean;
  // Generic fallback adapters (cover groups of publishers that don't have a
  // dedicated file, e.g. theguardian.com under extended-editorial)
  "extended-editorial": boolean;
  "extended-community": boolean;
  "extended-markets": boolean;
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
  usageAnalyticsEnabled: boolean;
  relevanceThreshold: number;
  cooldownPosts: number;
  showNotificationStack: boolean;
  notificationPanelSurface: "sidebar" | "floating";
  aiExtractionEnabled: boolean;
  personalizationEnabled: boolean;
  themeOverride: "auto" | "dark" | "light" | "dim";
  debugMode: boolean;
  /** One-click betting prefs for the streaming Live Markets card. */
  streamTrading: StreamTradingSettings;
}

/**
 * Streaming-surface one-click betting preferences. These drive the quick-trade
 * UI on stream cards (default stake) and gate the instant-placement fast-path.
 */
export interface StreamTradingSettings {
  /** Default USD stake pre-selected on each card. */
  defaultAmount: number;
  /** Master toggle for the inline quick-trade UI on stream cards. */
  oneClickEnabled: boolean;
  /**
   * When true, the Trade button opens the confirm panel instead of placing
   * instantly. Safety default ON — instant placement requires opting out.
   */
  confirmBeforeTrade: boolean;
}

export const DEFAULT_STREAM_TRADING_SETTINGS: StreamTradingSettings = {
  defaultAmount: 5,
  oneClickEnabled: true,
  confirmBeforeTrade: true,
};

/** Amount presets shown as chips on the stream quick-trade UI. */
export const STREAM_TRADE_AMOUNT_PRESETS = [1, 5, 25, 100];

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  twitch: true,
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
  farcaster: true,
  coinmarketcap: true,
  paragraph: true,
  coindesk: true,
  cointelegraph: true,
  decrypt: true,
  theblock: true,
  blockworks: true,
  bankless: true,
  bitcoinmagazine: true,
  beincrypto: true,
  unchained: true,
  cryptopanic: true,
  cnn: true,
  nytimes: true,
  wsj: true,
  "washington-post": true,
  thehindu: true,
  "hindustan-times": true,
  cnbc: true,
  forbes: true,
  "yahoo-finance": true,
  dlnews: true,
  cnet: true,
  zdnet: true,
  tomshardware: true,
  skysports: true,
  "sporting-news": true,
  "fox-sports": true,
  "kalshi-platform": true,
  "manifold-markets": true,
  "extended-editorial": true,
  "extended-community": true,
  "extended-markets": true,
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
  usageAnalyticsEnabled: false,
  relevanceThreshold: 0.3,
  cooldownPosts: 4,
  showNotificationStack: true,
  notificationPanelSurface: "floating",
  aiExtractionEnabled: false,
  personalizationEnabled: true,
  themeOverride: "auto",
  debugMode: false,
  streamTrading: { ...DEFAULT_STREAM_TRADING_SETTINGS },
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
