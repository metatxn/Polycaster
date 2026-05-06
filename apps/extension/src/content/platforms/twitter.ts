// ============================================
// TWITTER/X PLATFORM ADAPTER
// Handles Twitter/X-specific DOM interactions
// ============================================

import type {
  CardStyles,
  InjectionPoint,
  MarketLinkHint,
  ThemeStyles,
} from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";

const POLYMARKET_HOST_RE = /(^|\.)polymarket\.com$/i;
const POLYMARKET_TEXT_RE = /\bpolymarket\.com\b/i;
const POLYMARKET_FROM_RE = /\bfrom\s+polymarket\.com\b/gi;

function isTwitterTheme(
  theme: string | undefined
): theme is "dark" | "dim" | "light" {
  return theme === "dark" || theme === "dim" || theme === "light";
}

function detectTwitterTheme(): "dark" | "dim" | "light" {
  try {
    const themeOverride = window.KNOWW_CONFIG?.getThemeOverride?.();
    if (
      themeOverride &&
      themeOverride !== "auto" &&
      isTwitterTheme(themeOverride)
    ) {
      return themeOverride;
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
  const activeTheme = isTwitterTheme(theme) ? theme : detectTwitterTheme();

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

function getUrlHost(rawUrl: string): string {
  try {
    return new URL(rawUrl, window.location.origin).hostname;
  } catch {
    return "";
  }
}

function isPolymarketUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  return POLYMARKET_HOST_RE.test(getUrlHost(rawUrl));
}

function getAnchorSignalText(anchor: HTMLAnchorElement): string {
  const parts = [
    anchor.textContent || "",
    anchor.getAttribute("aria-label") || "",
    anchor.getAttribute("title") || "",
    anchor.getAttribute("data-expanded-url") || "",
    anchor.getAttribute("data-url") || "",
    anchor.getAttribute("href") || "",
  ];

  for (const attr of Array.from(anchor.attributes || [])) {
    if (/url|href|expanded|title|label/i.test(attr.name)) {
      parts.push(attr.value);
    }
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function getSlugTitleFromPolymarketUrl(rawUrl: string | undefined): string {
  if (!rawUrl || !isPolymarketUrl(rawUrl)) return "";

  try {
    const url = new URL(rawUrl, window.location.origin);
    const segments = url.pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment).trim())
      .filter(Boolean);
    let slug = "";
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i] !== "event" && segments[i] !== "events") {
        slug = segments[i];
        break;
      }
    }
    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return "";
    return slug.replace(/-/g, " ");
  } catch {
    return "";
  }
}

function cleanPolymarketPreviewTitle(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(POLYMARKET_FROM_RE, " ")
    .replace(POLYMARKET_TEXT_RE, " ")
    .replace(/\bShow more\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTwitterMarketLinkHints(postElement: Element): MarketLinkHint[] {
  const hints: MarketLinkHint[] = [];
  const seen = new Set<string>();
  const anchors = Array.from(
    postElement.querySelectorAll<HTMLAnchorElement>("a[href]")
  );

  for (const anchor of anchors) {
    const href = anchor.href || anchor.getAttribute("href") || "";
    const signalText = getAnchorSignalText(anchor);
    const hasPolymarketSignal =
      isPolymarketUrl(href) || POLYMARKET_TEXT_RE.test(signalText);

    if (!hasPolymarketSignal) continue;

    const title =
      cleanPolymarketPreviewTitle(signalText) ||
      getSlugTitleFromPolymarketUrl(href);
    const key = JSON.stringify([href, title]);
    if (seen.has(key)) continue;
    seen.add(key);

    hints.push({
      source: "polymarket",
      url: href || undefined,
      title: title || undefined,
    });

    if (hints.length >= 4) break;
  }

  return hints;
}

function extractTwitterPostText(postElement: Element): string {
  try {
    const tweetTextEl = postElement.querySelector(
      'div[data-testid="tweetText"]'
    );
    const tweetText = (tweetTextEl?.textContent || "").trim();
    const linkHintText = extractTwitterMarketLinkHints(postElement)
      .flatMap((hint) => [hint.title, getSlugTitleFromPolymarketUrl(hint.url)])
      .filter((part): part is string => !!part && part.length > 2)
      .join(" ");

    return [tweetText, linkHintText]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
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
  extractPostText: extractTwitterPostText,
  extractMarketLinkHints: extractTwitterMarketLinkHints,
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

export {
  extractTwitterMarketLinkHints,
  extractTwitterPostText,
  TwitterAdapter,
};
