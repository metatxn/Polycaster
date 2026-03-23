// ============================================
// TWITTER/X PLATFORM ADAPTER
// Handles Twitter/X-specific DOM interactions
// ============================================

import type {
  CardStyles,
  InjectionPoint,
  ThemeStyles,
} from "../../types/platform";

/**
 * Twitter/X Platform Adapter
 */
const TwitterAdapter = {
  name: "twitter" as const,

  hostPatterns: [/^(www\.)?twitter\.com$/, /^(www\.)?x\.com$/],

  selectors: {
    item: 'article[data-testid="tweet"]',
    container:
      'div[aria-label="Timeline: Your Home Timeline"], main[role="main"], main',
    text: 'div[data-testid="tweetText"]',
  },

  extractPostText(postElement: Element): string {
    try {
      const tweetTextEl = postElement.querySelector(
        'div[data-testid="tweetText"]'
      );
      if (!tweetTextEl) return "";
      return (tweetTextEl.textContent || "").trim();
    } catch {
      return "";
    }
  },

  findInjectionPoint(postElement: Element): InjectionPoint | null {
    const cellInnerDiv = postElement.closest('div[data-testid="cellInnerDiv"]');
    if (!cellInnerDiv) return null;

    const contentWrapper = cellInnerDiv.firstElementChild;
    if (!contentWrapper) return null;

    return {
      container: contentWrapper,
      cellInnerDiv: cellInnerDiv,
      insertPosition: "append",
    };
  },

  detectTheme(): "dark" | "dim" | "light" {
    try {
      const themeOverride = window.KNOWW_CONFIG?.getThemeOverride?.();
      if (themeOverride && themeOverride !== "auto") {
        return themeOverride as "dark" | "dim" | "light";
      }

      const bodyEl = document.body;
      const bodyBg = window.getComputedStyle(bodyEl).backgroundColor;
      const rgbMatch = bodyBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);

      if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10);
        const g = parseInt(rgbMatch[2], 10);
        const b = parseInt(rgbMatch[3], 10);

        if (r === 0 && g === 0 && b === 0) {
          return "dark";
        }

        if (r < 30 && g < 40 && b < 50 && b > r) {
          return "dim";
        }

        if (r > 240 && g > 240 && b > 240) {
          return "light";
        }
      }

      if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
        return "light";
      }

      return "dark";
    } catch {
      return "dark";
    }
  },

  getCardStyles(theme?: string): CardStyles {
    const activeTheme = (theme || this.detectTheme()) as
      | "dark"
      | "dim"
      | "light";

    const baseStyles = {
      fontFamily:
        '"TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      cardPadding: "0 16px 12px 16px",
      cardMargin: "0",
      borderRadius: "16px",
      accentColor: "rgb(29, 155, 240)",
    };

    const themeStyles: Record<"dark" | "dim" | "light", ThemeStyles> = {
      dark: {
        backgroundColor: "rgb(0, 0, 0)",
        borderColor: "rgb(47, 51, 54)",
        textColor: "rgb(231, 233, 234)",
        secondaryTextColor: "rgb(113, 118, 123)",
        cardBg: "rgb(32, 35, 39)",
      },
      dim: {
        backgroundColor: "rgb(21, 32, 43)",
        borderColor: "rgb(56, 68, 77)",
        textColor: "rgb(247, 249, 249)",
        secondaryTextColor: "rgb(139, 152, 165)",
        cardBg: "rgb(30, 42, 56)",
      },
      light: {
        backgroundColor: "rgb(255, 255, 255)",
        borderColor: "rgb(207, 217, 222)",
        textColor: "rgb(15, 20, 25)",
        secondaryTextColor: "rgb(83, 100, 113)",
        cardBg: "rgb(247, 249, 249)",
      },
    };

    return {
      ...baseStyles,
      ...themeStyles[activeTheme],
      theme: activeTheme,
    };
  },

  getWrapperStyles(): string {
    return `
      padding: 0 16px 12px 16px;
      margin-top: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
  },

  hasInjectedCard(postElement: Element): boolean {
    const injectionPoint = this.findInjectionPoint(postElement);
    if (!injectionPoint?.cellInnerDiv) return false;
    return !!injectionPoint.cellInnerDiv.querySelector(".knoww-market-card");
  },

  getDynamicSelectors(): { itemSelector: string; containerSelector: string } {
    const itemSelector = this.selectors.item;

    const containerCandidates = [
      'div[aria-label="Timeline: Your Home Timeline"]',
      'main[role="main"]',
      "main",
    ];

    const containerSelector =
      containerCandidates.find((sel) => document.querySelector(sel)) || "main";

    return { itemSelector, containerSelector };
  },

  /**
   * Find a sidebar injection point for embedding the notification stack
   * inline in Twitter's right sidebar, above the "Today's News" section.
   * Returns null if the sidebar is not available (e.g., narrow viewport).
   *
   * Twitter/X sidebar DOM (as of 2026):
   *   sidebarColumn > div > div > div > div > div (widget container, ~7 children)
   *     W[0]: Search box (SearchBox_Search_Input_label)
   *     W[1]: spacer
   *     W[2]: Live on X (placementTracking)
   *     W[3]: Today's News (contains [data-testid="news_sidebar"])
   *     W[4]: Trending now (contains [data-testid="trend"])
   *     W[5]: Who to follow (contains [data-testid="UserCell"])
   *     W[6]: footer
   *
   * Strategy: find a known widget by data-testid, walk up to the widget-
   * container level (the ancestor whose parent has many siblings), then
   * insert before that widget-level element.
   */
  findSidebarInjectionPoint(): {
    parent: Element;
    reference: Element | null;
  } | null {
    try {
      const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
      if (!sidebar) return null;

      // Helper: given an element deep inside a widget, walk up until we
      // find the widget-level element (one whose parent has >2 children).
      const walkUpToWidgetLevel = (el: Element): Element | null => {
        let current: Element | null = el;
        while (current && current !== sidebar) {
          const parent: Element | null = current.parentElement;
          if (!parent || parent === sidebar) return null;
          // The widget container has many children (typically 5-8)
          if (parent.children.length > 2) {
            return current; // this is the widget-level element
          }
          current = parent;
        }
        return null;
      };

      // 1. Primary target: "Today's News" via data-testid="news_sidebar"
      const newsSidebar = sidebar.querySelector('[data-testid="news_sidebar"]');
      if (newsSidebar) {
        const widgetEl = walkUpToWidgetLevel(newsSidebar);
        if (widgetEl?.parentElement) {
          return { parent: widgetEl.parentElement, reference: widgetEl };
        }
      }

      // 2. Fallback: "Trending now" / "What's happening" via data-testid="trend"
      const trend = sidebar.querySelector('[data-testid="trend"]');
      if (trend) {
        const widgetEl = walkUpToWidgetLevel(trend);
        if (widgetEl?.parentElement) {
          return { parent: widgetEl.parentElement, reference: widgetEl };
        }
      }

      // 3. Last resort: find the widget container by drilling through
      //    single-child wrappers, then append at the end
      let inner: Element = sidebar;
      while (inner.firstElementChild) {
        if (inner.children.length === 1) {
          inner = inner.firstElementChild;
        } else if (inner.children.length > 2) {
          // This is likely the widget container
          return { parent: inner, reference: null };
        } else {
          // 2 children — go into the last child (widgets are usually in
          // the second branch, the first is often a spacer)
          const last = inner.lastElementChild;
          if (last) {
            inner = last;
          } else {
            break;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  },
};

// Expose directly for backwards compatibility
window.KNOWW_TWITTER = TwitterAdapter;

// Register with platform registry using shared utility
import { registerAdapterWithRetry } from "../platform-registry";

registerAdapterWithRetry(TwitterAdapter, 100, 50);

export { TwitterAdapter };
