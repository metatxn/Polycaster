import type { InjectionPoint, PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
  combineTextParts,
  detectGenericTheme,
  extractPostIdFromAttributes,
} from "./helpers";

// Content-script adapter for rendering Knoww cards on Kalshi pages.
// This is distinct from ../kalshi-adapter.ts, which integrates Kalshi as
// a market/search source rather than a page-level content adapter.

const KALSHI_MARKET_TILE_SELECTOR = "[data-testid='market-tile']";
const KALSHI_DETAIL_HEADING_SELECTOR = "main h1";

// `.market-slide-container` is intentionally omitted: it's the hero carousel
// wrapper that holds ~7 rotating slide panels whose headlines all render
// inside the same root, so treating it as a single post mashes every slide's
// title into one garbled string. The inner per-market tiles are already
// covered by `[data-testid='market-tile']` on tiles elsewhere in the page.
const KALSHI_ITEM_SELECTORS = [
  KALSHI_MARKET_TILE_SELECTOR,
  KALSHI_DETAIL_HEADING_SELECTOR,
  "[data-market-id]",
  "[data-event-id]",
  "[data-series-id]",
  "[data-testid*='market-card']",
  "[data-testid*='event-card']",
  "[data-testid*='series-card']",
  "[class*='market-card']",
  "[class*='marketCard']",
  "[class*='event-card']",
  "[class*='eventCard']",
  "[class*='series-card']",
  "[class*='seriesCard']",
  "article",
  "a[href^='/event/']",
  "a[href^='/events/']",
  "a[href^='/market/']",
  "a[href^='/markets/']",
];

const KALSHI_CARD_ROOT_SELECTORS = [
  KALSHI_MARKET_TILE_SELECTOR,
  "[data-market-id]",
  "[data-event-id]",
  "[data-series-id]",
  "[data-testid*='market-card']",
  "[data-testid*='event-card']",
  "[data-testid*='series-card']",
  "[class*='market-card']",
  "[class*='marketCard']",
  "[class*='event-card']",
  "[class*='eventCard']",
  "[class*='series-card']",
  "[class*='seriesCard']",
];

const KALSHI_TEXT_SELECTORS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "[class*='title']",
  "[class*='question']",
  "[class*='subtitle']",
  "[class*='description']",
  "p",
];

const KALSHI_CONTENT_LINK_PATTERN =
  /^\/(event|events|market|markets)\/([^?#]+)/i;
const KALSHI_DETAIL_PAGE_PATTERN = /^\/(event|events|market|markets)\/[^?#]+/i;
const KALSHI_NON_CONTAINER_TAGS = new Set([
  "A",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "SPAN",
]);

function normalizeKalshiText(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function isKalshiContentPage(pathname = window.location.pathname): boolean {
  return KALSHI_DETAIL_PAGE_PATTERN.test(pathname);
}

function pickKalshiContainerSelector(): string {
  const containerSelectors = [
    "main",
    '[role="main"]',
    "#__next",
    "#root",
    "body",
  ];
  return (
    containerSelectors.find((selector) => document.querySelector(selector)) ||
    "body"
  );
}

function getSelfAndDescendantLinks(postElement: Element): HTMLAnchorElement[] {
  const links: HTMLAnchorElement[] = [];
  const seen = new Set<HTMLAnchorElement>();

  if (postElement instanceof HTMLAnchorElement && postElement.href) {
    links.push(postElement);
    seen.add(postElement);
  }

  for (const link of Array.from(
    postElement.querySelectorAll<HTMLAnchorElement>("a[href]")
  )) {
    if (seen.has(link)) continue;
    seen.add(link);
    links.push(link);
  }

  return links;
}

function scoreKalshiContentLink(link: HTMLAnchorElement): number {
  const href = link.getAttribute("href") || "";
  if (!KALSHI_CONTENT_LINK_PATTERN.test(href)) {
    return Number.NEGATIVE_INFINITY;
  }

  const text = normalizeKalshiText(link.textContent);
  const className = link.getAttribute("class") || "";
  const rect = link.getBoundingClientRect();
  const isVisible = rect.width > 0 && rect.height > 0;

  // Prefer visible, title-like content links inside actual Kalshi market tiles
  // while demoting utility links that are mostly counts, timestamps, or actions.
  let score = isVisible ? 20 : 0;

  if (text.length >= 12 && text.length <= 160) score += 14;
  if (/^\d+\s+markets?$/i.test(text)) score -= 12;
  if (/%/.test(text) || /\d{2}:\d{2}/.test(text)) score -= 8;
  if (className.includes("stretched-link")) score += 6;
  if (className.includes("stretched-link-action")) score -= 6;
  if (link.closest(KALSHI_MARKET_TILE_SELECTOR)) score += 10;

  return score;
}

function getPreferredKalshiContentLink(
  postElement: Element
): HTMLAnchorElement | null {
  return (
    getSelfAndDescendantLinks(postElement)
      .filter((link) =>
        KALSHI_CONTENT_LINK_PATTERN.test(link.getAttribute("href") || "")
      )
      .sort(
        (a, b) => scoreKalshiContentLink(b) - scoreKalshiContentLink(a)
      )[0] || null
  );
}

function findKalshiDetailPageRoot(postElement: Element): Element {
  const heading = postElement.matches("h1")
    ? postElement
    : postElement.querySelector("h1");

  if (!heading) {
    return postElement;
  }

  let current: Element | null = heading;
  let best: Element = heading;

  while (current?.parentElement) {
    const parent: Element = current.parentElement;
    const rect = parent.getBoundingClientRect();

    if (rect.width >= 600 && rect.height > 0 && rect.height <= 180) {
      best = parent;
    }

    if (rect.height > 240) {
      break;
    }

    current = parent;
  }

  return best;
}

function findKalshiPostRoot(postElement: Element): Element {
  if (
    postElement.matches(KALSHI_DETAIL_HEADING_SELECTOR) &&
    isKalshiContentPage()
  ) {
    return findKalshiDetailPageRoot(postElement);
  }

  for (const selector of KALSHI_CARD_ROOT_SELECTORS) {
    const root = postElement.matches(selector)
      ? postElement
      : postElement.closest(selector);
    if (root) {
      return root;
    }
  }

  const contentLink = getPreferredKalshiContentLink(postElement);

  if (contentLink) {
    return contentLink;
  }

  if (isKalshiContentPage() && postElement.querySelector("h1")) {
    return findKalshiDetailPageRoot(postElement);
  }

  return postElement;
}

function extractKalshiLinkId(postElement: Element): string | null {
  const preferredLink = getPreferredKalshiContentLink(postElement);
  const href = preferredLink?.getAttribute("href") || "";
  const match = href.match(KALSHI_CONTENT_LINK_PATTERN);
  if (match) {
    return `${match[1].toLowerCase()}:${match[2].replace(/\/+$/, "")}`;
  }

  return null;
}

function getKalshiPostId(postElement: Element): string | null {
  const root = findKalshiPostRoot(postElement);

  return (
    extractPostIdFromAttributes(root, [
      "data-market-id",
      "data-event-id",
      "data-series-id",
      "id",
    ]) ||
    extractKalshiLinkId(root) ||
    (root.querySelector("h1") &&
    window.location.pathname.match(KALSHI_DETAIL_PAGE_PATTERN)
      ? window.location.pathname
      : null)
  );
}

function extractKalshiPostText(postElement: Element): string {
  const root = findKalshiPostRoot(postElement);
  const parts = collectTextParts(root, KALSHI_TEXT_SELECTORS);
  return combineTextParts(parts);
}

function canAppendInsideKalshiRoot(root: Element): boolean {
  return !KALSHI_NON_CONTAINER_TAGS.has(root.tagName.toUpperCase());
}

function getKalshiWrapperStyles(): string {
  return `
    padding: 12px 0 0 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    position: relative;
    z-index: 2;
    isolation: isolate;
    pointer-events: auto;
  `;
}

function findKalshiInjectionPoint(postElement: Element): InjectionPoint | null {
  const root = findKalshiPostRoot(postElement);
  const rootContainsHeading = !!root.querySelector("h1");
  const isStructuredMarketRoot =
    root.matches(KALSHI_CARD_ROOT_SELECTORS.join(", ")) || rootContainsHeading;

  if (isStructuredMarketRoot && canAppendInsideKalshiRoot(root)) {
    return {
      container: root,
      referenceElement: null,
      insertPosition: "append",
      postWrapper: root,
    };
  }

  if (root.parentElement) {
    return {
      container: root.parentElement,
      referenceElement: root,
      insertPosition: "after",
      postWrapper: root,
    };
  }

  return {
    container: root,
    referenceElement: null,
    insertPosition: "append",
    postWrapper: root,
  };
}

function hasKalshiInjectedCard(postElement: Element): boolean {
  const root = findKalshiPostRoot(postElement);
  if (root.querySelector(".knoww-market-card")) {
    return true;
  }

  const nextSibling = root.nextElementSibling;
  return !!nextSibling?.matches("[data-knoww-injected='true']");
}

const KalshiPlatformAdapter = createBasicAdapter({
  name: "kalshi-platform",
  hostPatterns: [/^(?:www\.)?kalshi\.com$/],
  // Every Kalshi tile is an English market question, so the short-title
  // English detector otherwise rejects legit posts like "Texas Senate winner?".
  bypassEnglishCheck: true,
  // Market-question vs market-question matching rarely shares 2+ meaningful
  // nouns — e.g. "Tech Layoffs Up or Down in 2026?" vs "More tech layoffs in
  // 2026 than 2025?" only overlaps on `tech`. This flag enables calibrated
  // single-signal recovery and observes the historical score-only rule in
  // shadow telemetry.
  relaxContextGate: true,
  // Kalshi's grid surfaces ~16 tiles per scan, so raise the per-batch cap
  // above the global default of 5 to cover most of the visible grid.
  maxInjectionsPerBatch: 10,
  // Keep the notification panel aligned with the injection density so every
  // visible injected card can surface under "Active now" (default is 4/12).
  maxActiveNotificationItems: 10,
  maxNotificationItems: 20,
  itemSelectors: KALSHI_ITEM_SELECTORS,
  containerSelectors: ["main", '[role="main"]', "#__next", "#root", "body"],
  textSelectors: KALSHI_TEXT_SELECTORS,
  accentColor: "#7c3aed",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  detectTheme: detectGenericTheme,
  extractPostText: extractKalshiPostText,
  getPostId: getKalshiPostId,
  findInjectionPoint: findKalshiInjectionPoint,
  getWrapperStyles: getKalshiWrapperStyles,
  hasInjectedCard: hasKalshiInjectedCard,
  getDynamicSelectors: () => {
    const homepageItemSelectors = [KALSHI_MARKET_TILE_SELECTOR];
    const detailItemSelectors = [
      KALSHI_DETAIL_HEADING_SELECTOR,
      "a[href^='/event/']",
      "a[href^='/events/']",
      "a[href^='/market/']",
      "a[href^='/markets/']",
    ];

    const itemSelector = isKalshiContentPage()
      ? [...homepageItemSelectors, ...detailItemSelectors].join(", ")
      : homepageItemSelectors.join(", ");

    return {
      itemSelector,
      containerSelector: pickKalshiContainerSelector(),
    };
  },
});

export const adapter: PlatformAdapter = KalshiPlatformAdapter;

export { KalshiPlatformAdapter };
