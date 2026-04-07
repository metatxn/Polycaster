// ============================================
// TWITTER/X PLATFORM ADAPTER
// Handles Twitter/X-specific DOM interactions
// ============================================

import type {
  CardStyles,
  InjectionPoint,
  ThemeStyles,
} from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";

function detectTwitterTheme(): "dark" | "dim" | "light" {
  try {
    const themeOverride = window.KNOWW_CONFIG?.getThemeOverride?.();
    if (themeOverride && themeOverride !== "auto") {
      return themeOverride as "dark" | "dim" | "light";
    }

    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
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
}

function getTwitterCardStyles(theme?: string): CardStyles {
  const activeTheme = (theme || detectTwitterTheme()) as
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
}

function findTwitterInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const cellInnerDiv = postElement.closest('div[data-testid="cellInnerDiv"]');
  if (!cellInnerDiv) return null;

  const contentWrapper = cellInnerDiv.firstElementChild;
  if (!contentWrapper) return null;

  return {
    container: contentWrapper,
    cellInnerDiv: cellInnerDiv,
    insertPosition: "append",
  };
}

function findTwitterSidebarInjectionPoint(): {
  parent: Element;
  reference: Element | null;
} | null {
  try {
    const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
    if (!sidebar) return null;

    const walkUpToWidgetLevel = (el: Element): Element | null => {
      let current: Element | null = el;
      while (current && current !== sidebar) {
        const parent: Element | null = current.parentElement;
        if (!parent || parent === sidebar) return null;
        if (parent.children.length > 2) {
          return current;
        }
        current = parent;
      }
      return null;
    };

    const newsSidebar = sidebar.querySelector('[data-testid="news_sidebar"]');
    if (newsSidebar) {
      const widgetEl = walkUpToWidgetLevel(newsSidebar);
      if (widgetEl?.parentElement) {
        return { parent: widgetEl.parentElement, reference: widgetEl };
      }
    }

    const trend = sidebar.querySelector('[data-testid="trend"]');
    if (trend) {
      const widgetEl = walkUpToWidgetLevel(trend);
      if (widgetEl?.parentElement) {
        return { parent: widgetEl.parentElement, reference: widgetEl };
      }
    }

    let inner: Element = sidebar;
    while (inner.firstElementChild) {
      if (inner.children.length === 1) {
        inner = inner.firstElementChild;
      } else if (inner.children.length > 2) {
        return { parent: inner, reference: null };
      } else {
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
}

const TwitterAdapter = createBasicAdapter({
  name: "twitter",
  hostPatterns: [/^(www\.)?twitter\.com$/, /^(www\.)?x\.com$/],
  itemSelectors: ['article[data-testid="tweet"]'],
  containerSelectors: [
    'div[aria-label="Timeline: Your Home Timeline"]',
    'main[role="main"]',
    "main",
  ],
  textSelectors: ['div[data-testid="tweetText"]'],
  accentColor: "rgb(29, 155, 240)",
  fontFamily:
    '"TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "16px",
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
  findInjectionPoint: findTwitterInjectionPoint,
  detectTheme: detectTwitterTheme,
  getCardStyles: getTwitterCardStyles,
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
    const injectionPoint = findTwitterInjectionPoint(postElement);
    if (!injectionPoint?.cellInnerDiv) return false;
    return !!injectionPoint.cellInnerDiv.querySelector(".knoww-market-card");
  },
  getDynamicSelectors(): { itemSelector: string; containerSelector: string } {
    const itemSelector = 'article[data-testid="tweet"]';
    const containerCandidates = [
      'div[aria-label="Timeline: Your Home Timeline"]',
      'main[role="main"]',
      "main",
    ];

    const containerSelector =
      containerCandidates.find((sel) => document.querySelector(sel)) || "main";

    return { itemSelector, containerSelector };
  },
  findSidebarInjectionPoint: findTwitterSidebarInjectionPoint,
});

window.KNOWW_TWITTER = TwitterAdapter;

registerAdapterWithRetry(TwitterAdapter, 100, 50);

export { TwitterAdapter };
