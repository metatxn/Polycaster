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
 * Platform Adapter Interface
 */
export interface PlatformAdapter {
  name: string;
  hostPatterns: RegExp[];
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
