import type { MarketSearchResult } from "./market";

// ============================================
// SHARED PLATFORM TYPES
// Common interfaces used across platform adapters
// ============================================

/**
 * Represents where a market card should be injected into a post
 */
export interface InjectionPoint {
  container: Element;
  cellInnerDiv?: Element;
  postWrapper?: Element;
  cleanup?: () => void;
  referenceElement?: Element | null | undefined;
  insertPosition: "append" | "before" | "after";
  wrapperClassName?: string;
  wrapperStyles?: string;
  cardClassName?: string;
}

/**
 * Theme-specific color styles
 */
export interface ThemeStyles {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  secondaryTextColor: string;
  cardBg: string;
}

/**
 * Complete card styling configuration
 */
export interface CardStyles {
  fontFamily: string;
  cardPadding: string;
  cardMargin: string;
  borderRadius: string;
  accentColor: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  secondaryTextColor: string;
  cardBg: string;
  theme: "dark" | "dim" | "light";
  [key: string]: string; // Index signature for Record<string, unknown> compatibility
}

export interface MarketLinkHint {
  source: "polymarket";
  url?: string;
  title?: string;
}

/**
 * Context describing the live stream the user is currently watching.
 * Produced by streaming-surface adapters (e.g. Twitch) and used to seed the
 * Live Markets card. The `game`/`title` are the market query keys — they
 * replace per-post text on the feed surfaces.
 */
export interface StreamContext {
  /** Human-readable game/category, e.g. "VALORANT". Empty when undetectable. */
  game: string;
  /** Slug form for querying/dedup, e.g. "valorant". */
  gameSlug?: string;
  /** Stream title (secondary relevance signal). */
  title?: string;
  /** Tag chips shown on the stream. */
  tags?: string[];
  /** Whether the channel is currently live. */
  isLive: boolean;
}

/**
 * Sports match metadata extracted from schedule rows or live match pages.
 * Used by platform adapters that can map a page item directly to a Gamma
 * sports event without running broad text search.
 */
export interface SportsMatchCandidate {
  homeTeam: string;
  awayTeam: string;
  homeAbbreviation?: string;
  awayAbbreviation?: string;
  eventTime?: string;
  league?: string;
  leagueSlug?: string;
  title?: string;
}

/**
 * Optional direct-market resolution for platform-specific exact matches.
 * `bypassGenericSearch` tells the scanner not to fall back to broad relevance
 * search when the adapter knows a page item is a precise structured object.
 */
export interface DirectMarketResolution {
  markets: MarketSearchResult[];
  topics?: string[];
  bypassGenericSearch?: boolean;
  postText?: string;
}

/**
 * Platform Adapter Interface
 */
export interface PlatformAdapter {
  name: string;
  hostPatterns: RegExp[];
  /**
   * Surface model for this platform. "feed" (default) injects a card per post
   * and runs the relevance pipeline (English check → context gate → AI score).
   * "stream" surfaces a single companion Live Markets card seeded by the
   * current stream's game/category and bypasses the feed scan + all relevance
   * filtering entirely. See `getStreamContext`.
   */
  surface?: "feed" | "stream";
  /**
   * Streaming surfaces only: read the current stream context (game/title/tags
   * + live state) from the page. Re-read on SPA navigation to refresh markets.
   */
  getStreamContext?: () => StreamContext | null;
  bypassEnglishCheck?: boolean;
  /**
   * When true, the context gate accepts a single shared signal (instead of
   * the default two) provided the relevance score clears `AI_GATE_RETRY_FLOOR`.
   * Intended for platforms where both sides of the comparison are short
   * market questions (e.g. kalshi.com), so most correct matches naturally
   * share only one meaningful noun.
   */
  relaxContextGate?: boolean;
  /**
   * When true, scoring/gating can include nested Polymarket market labels and
   * questions. Default false preserves the historical behavior for social
   * feeds such as X/Twitter, where only event title/description should drive
   * matching.
   */
  enableNestedMarketContext?: boolean;
  /**
   * Overrides the default per-scan injection cap for this platform. Useful
   * when a single page surfaces many strong candidates at once (e.g. Kalshi's
   * dense market grid) and the default density budget is the limiting factor.
   */
  maxInjectionsPerBatch?: number;
  /**
   * Overrides the default cap on "Active now" items shown in the notification
   * panel. Pair with `maxInjectionsPerBatch` on dense platforms so the panel
   * can surface every injected card instead of truncating at the default.
   */
  maxActiveNotificationItems?: number;
  /** Overrides the default total cap (active + recently scrolled-out). */
  maxNotificationItems?: number;
  selectors: {
    item: string;
    container: string;
    text?: string;
  };
  extractPostText: (post: Element) => string;
  extractMarketLinkHints?: (post: Element) => MarketLinkHint[];
  resolveDirectMarkets?: (
    post: Element
  ) => Promise<DirectMarketResolution | null>;
  cleanupStaleInjections?: () => void;
  findInjectionPoint: (post: Element) => InjectionPoint | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCardStyles?: (theme?: string) => any;
  getDynamicSelectors?: () => {
    itemSelector: string;
    containerSelector: string;
  };
  getWrapperStyles?: () => string;
  detectTheme?: () => "dark" | "light" | "dim";
  hasInjectedCard?: (post: Element) => boolean;
  isDarkMode?: () => boolean;
  getCssClassPrefix?: () => string;
  getPostId?: (post: Element) => string | null;
  /** Find a sidebar injection point for embedding the notification stack inline */
  findSidebarInjectionPoint?: () => {
    parent: Element;
    reference: Element | null;
  } | null;
}
