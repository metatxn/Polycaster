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

// Same host covers every regional path (/in, /us, /au, /uk, ...) since the
// region is a URL segment rather than a subdomain.
const SPORTINGNEWS_HOST_RE = /^(?:www\.)?sportingnews\.com$/i;

// Article URLs end with a 24-char hex MongoDB ObjectId, optionally followed
// by a trailing slash, query, or hash.
const SPORTINGNEWS_ARTICLE_PATH_RE = /\/[a-f0-9]{24}\/?(?:[?#].*)?$/i;
const SPORTINGNEWS_ARTICLE_SLUG_PATTERN = /\/([a-f0-9]{24})\/?(?:[?#]|$)/i;

const SPORTINGNEWS_CONTAINER_SELECTORS = [
  "main",
  "#main-content",
  "[role='main']",
  "#page-container",
  "body",
] as const;

const SPORTINGNEWS_PRIMARY_LINK_SELECTORS = [
  "a[href*='/news/']",
  "a[href*='/tsn/']",
  "a[href*='sportingnews.com/'][href*='/news/']",
  "a[href]",
] as const;

// Sporting News uses Tailwind utility classes almost everywhere; the stable
// hooks are the ARIA role on feed cards and data-testid on article chrome.
const SPORTINGNEWS_FEED_ITEM_ROOT_SELECTORS = ["[role='article']"] as const;

const SPORTINGNEWS_ARTICLE_ITEM_ROOT_SELECTORS = [
  "[data-testid='article-title']",
  "[data-testid='container--article'] h1",
  "main h1.text-headline",
] as const;

const SPORTINGNEWS_TITLE_SELECTORS = [
  "[data-testid='article-title']",
  "h1.text-headline",
  "h1",
  "h2",
  "h3",
] as const;

const SPORTINGNEWS_DESCRIPTION_SELECTORS = [
  "[data-testid='article-lead']",
  "[class*='description']",
  "[class*='summary']",
  "p",
] as const;

function isSportingNewsArticlePage(): boolean {
  return (
    SPORTINGNEWS_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(
      SPORTINGNEWS_ARTICLE_ITEM_ROOT_SELECTORS.join(", ")
    )
  );
}

function getSportingNewsArticleScope(postElement: Element): Element {
  return (
    postElement.closest("[data-testid='container--article']") ||
    postElement.closest(".article-page-new") ||
    postElement.closest("main") ||
    postElement.parentElement ||
    postElement
  );
}

function getSportingNewsStoryScope(postElement: Element): Element {
  if (
    postElement.matches(SPORTINGNEWS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    return getSportingNewsArticleScope(postElement);
  }

  return postElement.closest("[role='article']") || postElement;
}

function getSportingNewsPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getSportingNewsStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    SPORTINGNEWS_PRIMARY_LINK_SELECTORS
  );
}

function extractSportingNewsFeedText(postElement: Element): string {
  const scope = getSportingNewsStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, SPORTINGNEWS_TITLE_SELECTORS) ||
    normalizeText(getSportingNewsPrimaryLink(postElement)?.textContent);
  const summary =
    getFirstMatchingText(scope, SPORTINGNEWS_DESCRIPTION_SELECTORS) || "";

  return combineTextParts([title, summary], 8);
}

function extractSportingNewsPostText(postElement: Element): string {
  if (
    postElement.matches(SPORTINGNEWS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    const scope = getSportingNewsArticleScope(postElement);
    const title = normalizeText(postElement.textContent);
    const lead =
      getFirstMatchingText(scope, SPORTINGNEWS_DESCRIPTION_SELECTORS) || "";
    const summary = lead || getDocumentDescription();
    return combineTextParts([title, summary], 8);
  }

  return extractSportingNewsFeedText(postElement);
}

function getSportingNewsPostId(postElement: Element): string | null {
  if (
    postElement.matches(SPORTINGNEWS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    const match = window.location.pathname.match(
      SPORTINGNEWS_ARTICLE_SLUG_PATTERN
    );
    return match?.[1] || window.location.pathname || null;
  }

  const href =
    getSportingNewsPrimaryLink(postElement)?.getAttribute("href") || "";
  const directMatch = href.match(SPORTINGNEWS_ARTICLE_SLUG_PATTERN);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  try {
    const url = new URL(href, window.location.origin);
    const pathnameMatch = url.pathname.match(SPORTINGNEWS_ARTICLE_SLUG_PATTERN);
    return pathnameMatch?.[1] || normalizeText(url.pathname) || null;
  } catch {
    return normalizeText(href) || null;
  }
}

function getSportingNewsDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    SPORTINGNEWS_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isSportingNewsArticlePage()) {
    return {
      itemSelector: SPORTINGNEWS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = SPORTINGNEWS_FEED_ITEM_ROOT_SELECTORS.map(
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

function findSportingNewsArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getSportingNewsArticleScope(postElement);
  const byline =
    articleScope.querySelector("[data-testid='article-author-list']") ||
    articleScope.querySelector("[data-testid='article-date-time-block']");
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

function findSportingNewsFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getSportingNewsStoryScope(postElement);
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

function findSportingNewsInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (
    postElement.matches(SPORTINGNEWS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    return findSportingNewsArticleInjectionPoint(postElement);
  }

  return findSportingNewsFeedInjectionPoint(postElement);
}

function hasSportingNewsInjectedCard(postElement: Element): boolean {
  if (
    postElement.matches(SPORTINGNEWS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    const articleScope = getSportingNewsArticleScope(postElement);
    const anchor =
      articleScope.querySelector("[data-testid='article-author-list']") ||
      articleScope.querySelector("[data-testid='article-date-time-block']");
    return (
      (anchor
        ? hasInjectedCardSibling(anchor)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getSportingNewsStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getSportingNewsWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const SportingNewsAdapter = createBasicAdapter({
  name: "sporting-news",
  hostPatterns: [SPORTINGNEWS_HOST_RE],
  itemSelectors: [
    ...SPORTINGNEWS_FEED_ITEM_ROOT_SELECTORS,
    ...SPORTINGNEWS_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...SPORTINGNEWS_CONTAINER_SELECTORS],
  textSelectors: [...SPORTINGNEWS_TITLE_SELECTORS],
  accentColor: "#f37021",
  fontFamily:
    '"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractSportingNewsPostText,
  getPostId: getSportingNewsPostId,
  findInjectionPoint: findSportingNewsInjectionPoint,
  getDynamicSelectors: getSportingNewsDynamicSelectors,
  getWrapperStyles: getSportingNewsWrapperStyles,
  hasInjectedCard: hasSportingNewsInjectedCard,
});

export const adapter: PlatformAdapter = SportingNewsAdapter;

export { SportingNewsAdapter };
