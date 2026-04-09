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

/**
 * Platform Adapter Interface
 */
export interface PlatformAdapter {
  name: string;
  hostPatterns: RegExp[];
  selectors: {
    item: string;
    container: string;
    text?: string;
  };
  extractPostText: (post: Element) => string;
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
