import type { InjectionPoint, PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import { combineTextParts, normalizeText } from "./helpers";
import {
  findPrimaryLinkFromSelectors,
  getDocumentDescription,
  getFirstMatchingText,
  getFullWidthCardWrapperStyles,
  hasInjectedCardSibling,
} from "./story-adapter-helpers";

const CNBC_HOST_RE = /^(?:www\.)?cnbc\.com$/i;
const CNBC_ARTICLE_PATH_RE =
  /\/\d{4}\/\d{2}\/\d{2}\/[^/?#]+\.html(?:[?#].*)?$/i;
const CNBC_ARTICLE_SLUG_PATTERN =
  /\/(\d{4}\/\d{2}\/\d{2}\/[^/?#]+)\.html(?:[?#].*)?$/i;

// CNBC renders a zero-height <p id="MainContent"> as a skip-link target and
// does not emit <main> or <article>. The real page wrapper is
// #MainContentContainer; everything else is fallback.
const CNBC_CONTAINER_SELECTORS = [
  "#MainContentContainer",
  "#root",
  "body",
] as const;

const CNBC_PRIMARY_LINK_SELECTORS = [
  "a.LatestNews-headline[href*='cnbc.com/'][href$='.html']",
  "a.LatestNews-headline[href^='/'][href$='.html']",
  ".RiverHeadline-headline a[href*='cnbc.com/'][href$='.html']",
  ".RiverHeadline-headline a[href^='/'][href$='.html']",
  "[class*='FeaturedNewsHero'] a[href*='cnbc.com/'][href$='.html']",
  "[class*='FeaturedNewsHero'] a[href^='/'][href$='.html']",
  "[class*='TrendingNowBreaker'] a[href*='cnbc.com/'][href$='.html']",
  "[class*='TrendingNowBreaker'] a[href^='/'][href$='.html']",
  "[class*='Card-title'] a[href*='cnbc.com/'][href$='.html']",
  "[class*='Card-title'] a[href^='/'][href$='.html']",
  "a[href*='cnbc.com/'][href$='.html']",
  "a[href^='/'][href$='.html']",
  "h1.ArticleHeader-headline",
  "h1",
] as const;

const CNBC_FEED_ITEM_ROOT_SELECTORS = [
  "li.LatestNews-item",
  ".RiverPlusCard-container",
  ".RiverPlusCard-breakerCardContainer",
  "[class*='FeaturedNewsHero']:has(a[href$='.html'])",
  "[class*='TrendingNowBreaker']:has(a[href$='.html'])",
  "[class*='Card']:has([class*='Card-title'] a[href$='.html'])",
] as const;

// CNBC ships two article templates: the standard ArticleHeader and a
// live-blog LiveBlogHeader. Each has its own headline class and wrapper.
const CNBC_ARTICLE_ITEM_ROOT_SELECTORS = [
  "h1.ArticleHeader-headline",
  "header.ArticleHeader-articleHeader h1",
  "h1.LiveBlogHeader-headline",
  "[class*='LiveBlogHeader-wrapper'] h1",
] as const;

const CNBC_TITLE_SELECTORS = [
  "h1.ArticleHeader-headline",
  "h1.LiveBlogHeader-headline",
  ".LatestNews-headline",
  ".RiverHeadline-headline a",
  "[class*='FeaturedNewsHero'] a",
  "[class*='Card-title'] a",
  "h1",
  "h2",
  "h3",
] as const;

function isCnbcArticlePage(): boolean {
  return (
    CNBC_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(CNBC_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  );
}

function getCnbcArticleScope(postElement: Element): Element {
  return (
    postElement.closest("header.ArticleHeader-articleHeader") ||
    postElement.closest('[data-test="articleHeader-0"]') ||
    postElement.closest("[class*='LiveBlogHeader-wrapper']") ||
    postElement.closest("#MainContentContainer") ||
    postElement.parentElement ||
    postElement
  );
}

function getCnbcStoryScope(postElement: Element): Element {
  if (postElement.matches(CNBC_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return getCnbcArticleScope(postElement);
  }

  return (
    postElement.closest("li.LatestNews-item") ||
    postElement.closest(".RiverPlusCard-container") ||
    postElement.closest(".RiverPlusCard-breakerCardContainer") ||
    postElement.closest("[class*='FeaturedNewsHero']") ||
    postElement.closest("[class*='TrendingNowBreaker']") ||
    postElement.closest("[class*='Card']") ||
    postElement
  );
}

function getCnbcPrimaryLink(postElement: Element): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getCnbcStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    CNBC_PRIMARY_LINK_SELECTORS
  );
}

function extractCnbcFeedText(postElement: Element): string {
  const scope = getCnbcStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, CNBC_TITLE_SELECTORS) ||
    normalizeText(getCnbcPrimaryLink(postElement)?.textContent);
  const summary =
    getFirstMatchingText(scope, [
      "[class*='Card-description']",
      "[class*='Card-summary']",
      "[class*='summary']",
      "[class*='description']",
    ]) || "";

  return combineTextParts([title, summary], 8);
}

function extractCnbcPostText(postElement: Element): string {
  if (postElement.matches(CNBC_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const title = normalizeText(postElement.textContent);
    const summary = getDocumentDescription();
    return combineTextParts([title, summary], 8);
  }

  return extractCnbcFeedText(postElement);
}

function getCnbcPostId(postElement: Element): string | null {
  if (postElement.matches(CNBC_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const match = window.location.pathname.match(CNBC_ARTICLE_SLUG_PATTERN);
    return match?.[1] || window.location.pathname || null;
  }

  const href = getCnbcPrimaryLink(postElement)?.getAttribute("href") || "";
  const match = href.match(CNBC_ARTICLE_SLUG_PATTERN);
  if (match?.[1]) {
    return match[1];
  }

  try {
    const url = new URL(href, window.location.origin);
    const pathnameMatch = url.pathname.match(CNBC_ARTICLE_SLUG_PATTERN);
    return pathnameMatch?.[1] || normalizeText(url.pathname) || null;
  } catch {
    return normalizeText(href) || null;
  }
}

function getCnbcDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    CNBC_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isCnbcArticlePage()) {
    return {
      itemSelector: CNBC_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = CNBC_FEED_ITEM_ROOT_SELECTORS.map(
    (selector) => `${containerSelector} ${selector}`
  );
  const matchedSelectors = scopedSelectors.filter((selector) =>
    document.querySelector(selector)
  );

  return {
    itemSelector:
      matchedSelectors.length > 0
        ? matchedSelectors.join(", ")
        : scopedSelectors.join(", "),
    containerSelector,
  };
}

function findCnbcArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getCnbcArticleScope(postElement);
  const byline = articleScope.querySelector(
    ".ArticleHeader-authorAndShareInline"
  );
  if (byline?.parentElement) {
    return {
      container: byline.parentElement,
      referenceElement: byline,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  if (postElement.parentElement) {
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  return null;
}

function findCnbcFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getCnbcStoryScope(postElement);
  if (!scope.parentElement) {
    return null;
  }

  return {
    container: scope.parentElement,
    referenceElement: scope,
    insertPosition: "after",
    postWrapper: scope,
  };
}

function findCnbcInjectionPoint(postElement: Element): InjectionPoint | null {
  if (postElement.matches(CNBC_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return findCnbcArticleInjectionPoint(postElement);
  }

  return findCnbcFeedInjectionPoint(postElement);
}

function hasCnbcInjectedCard(postElement: Element): boolean {
  if (postElement.matches(CNBC_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const articleScope = getCnbcArticleScope(postElement);
    const byline = articleScope.querySelector(
      ".ArticleHeader-authorAndShareInline"
    );
    return (
      (byline
        ? hasInjectedCardSibling(byline)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getCnbcStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getCnbcWrapperStyles(): string {
  return getFullWidthCardWrapperStyles({ listStyleNone: true });
}

const CnbcAdapter = createBasicAdapter({
  name: "cnbc",
  hostPatterns: [CNBC_HOST_RE],
  itemSelectors: [
    ...CNBC_FEED_ITEM_ROOT_SELECTORS,
    ...CNBC_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...CNBC_CONTAINER_SELECTORS],
  textSelectors: [...CNBC_TITLE_SELECTORS],
  accentColor: "#0a4ea3",
  fontFamily:
    'Proxima Nova, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractCnbcPostText,
  getPostId: getCnbcPostId,
  findInjectionPoint: findCnbcInjectionPoint,
  getDynamicSelectors: getCnbcDynamicSelectors,
  getWrapperStyles: getCnbcWrapperStyles,
  hasInjectedCard: hasCnbcInjectedCard,
});

export const adapter: PlatformAdapter = CnbcAdapter;

export { CnbcAdapter };
