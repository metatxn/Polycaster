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

const SKYSPORTS_HOST_RE = /^(?:www\.)?skysports\.com$/i;

// Sky Sports content URLs share a trailing numeric ID. Three variants:
//   - /{sport}/news/{section}/{id}/{slug}
//   - /{sport}/video/{section}/{id}/{slug}
//   - /{sport}/{match}/report/{id}
// The slug fragment is optional, as is a trailing slash.
const SKYSPORTS_ARTICLE_PATH_RE =
  /\/(?:news|video|report)\/(?:\d+\/)*\d+(?:\/[^/?#]+)?\/?(?:[?#].*)?$/i;
const SKYSPORTS_ARTICLE_SLUG_PATTERN =
  /\/(?:news|video|report)\/(?:\d+\/)*(\d+)(?:\/[^/?#]+)?\/?(?:[?#]|$)/i;

const SKYSPORTS_CONTAINER_SELECTORS = [
  "main#main",
  "main",
  "#main",
  "body",
] as const;

const SKYSPORTS_PRIMARY_LINK_SELECTORS = [
  "a.sdc-site-tile__headline-link[href]",
  ".sdc-site-tile__headline a[href]",
  ".sdc-site-carousel__rail-item a[href]",
  "a[href*='/news/']",
  "a[href*='/video/']",
  "a[href*='/report/']",
  "a[href]",
] as const;

const SKYSPORTS_FEED_ITEM_ROOT_SELECTORS = [
  ".sdc-site-tile",
  ".sdc-site-tiles__item",
  ".sdc-site-carousel__rail-item",
] as const;

const SKYSPORTS_ARTICLE_ITEM_ROOT_SELECTORS = [
  "h1.sdc-article-header__title",
  ".sdc-article-header h1",
] as const;

const SKYSPORTS_TITLE_SELECTORS = [
  "h1.sdc-article-header__title",
  ".sdc-site-tile__headline-link",
  ".sdc-site-tile__headline",
  ".sdc-article-header__title",
  "h1",
  "h2",
  "h3",
] as const;

const SKYSPORTS_DESCRIPTION_SELECTORS = [
  ".sdc-article-header__sub-title",
  ".sdc-article-header__long-title",
  ".sdc-site-tile__summary",
  "[class*='summary']",
  "p",
] as const;

function isSkysportsArticlePage(): boolean {
  return (
    SKYSPORTS_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(SKYSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  );
}

function getSkysportsArticleScope(postElement: Element): Element {
  return (
    postElement.closest(".sdc-article-header--story-article") ||
    postElement.closest(".sdc-article-header") ||
    postElement.closest("main") ||
    postElement.parentElement ||
    postElement
  );
}

function getSkysportsStoryScope(postElement: Element): Element {
  if (postElement.matches(SKYSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return getSkysportsArticleScope(postElement);
  }

  return (
    postElement.closest(".sdc-site-tile") ||
    postElement.closest(".sdc-site-tiles__item") ||
    postElement.closest(".sdc-site-carousel__rail-item") ||
    postElement
  );
}

function getSkysportsPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getSkysportsStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    SKYSPORTS_PRIMARY_LINK_SELECTORS
  );
}

function extractSkysportsFeedText(postElement: Element): string {
  const scope = getSkysportsStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, SKYSPORTS_TITLE_SELECTORS) ||
    normalizeText(getSkysportsPrimaryLink(postElement)?.textContent);
  const summary =
    getFirstMatchingText(scope, SKYSPORTS_DESCRIPTION_SELECTORS) || "";

  return combineTextParts([title, summary], 8);
}

function extractSkysportsPostText(postElement: Element): string {
  if (postElement.matches(SKYSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const scope = getSkysportsArticleScope(postElement);
    const title = normalizeText(postElement.textContent);
    const subtitle =
      getFirstMatchingText(scope, SKYSPORTS_DESCRIPTION_SELECTORS) || "";
    const summary = subtitle || getDocumentDescription();
    return combineTextParts([title, summary], 8);
  }

  return extractSkysportsFeedText(postElement);
}

function getSkysportsPostId(postElement: Element): string | null {
  if (postElement.matches(SKYSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const match = window.location.pathname.match(
      SKYSPORTS_ARTICLE_SLUG_PATTERN
    );
    return match?.[1] || window.location.pathname || null;
  }

  const href = getSkysportsPrimaryLink(postElement)?.getAttribute("href") || "";
  const directMatch = href.match(SKYSPORTS_ARTICLE_SLUG_PATTERN);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  try {
    const url = new URL(href, window.location.origin);
    const pathnameMatch = url.pathname.match(SKYSPORTS_ARTICLE_SLUG_PATTERN);
    return pathnameMatch?.[1] || normalizeText(url.pathname) || null;
  } catch {
    return normalizeText(href) || null;
  }
}

function getSkysportsDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    SKYSPORTS_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isSkysportsArticlePage()) {
    return {
      itemSelector: SKYSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = SKYSPORTS_FEED_ITEM_ROOT_SELECTORS.map(
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

function findSkysportsArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getSkysportsArticleScope(postElement);
  const details = articleScope.querySelector(".sdc-article-header__details");
  if (details?.parentElement) {
    return {
      container: details.parentElement,
      referenceElement: details,
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

function findSkysportsFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getSkysportsStoryScope(postElement);
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

function findSkysportsInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (postElement.matches(SKYSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return findSkysportsArticleInjectionPoint(postElement);
  }

  return findSkysportsFeedInjectionPoint(postElement);
}

function hasSkysportsInjectedCard(postElement: Element): boolean {
  if (postElement.matches(SKYSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const articleScope = getSkysportsArticleScope(postElement);
    const details = articleScope.querySelector(".sdc-article-header__details");
    return (
      (details
        ? hasInjectedCardSibling(details)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getSkysportsStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getSkysportsWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const SkySportsAdapter = createBasicAdapter({
  name: "skysports",
  hostPatterns: [SKYSPORTS_HOST_RE],
  itemSelectors: [
    ...SKYSPORTS_FEED_ITEM_ROOT_SELECTORS,
    ...SKYSPORTS_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...SKYSPORTS_CONTAINER_SELECTORS],
  textSelectors: [...SKYSPORTS_TITLE_SELECTORS],
  accentColor: "#e21e26",
  fontFamily:
    '"Sky Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractSkysportsPostText,
  getPostId: getSkysportsPostId,
  findInjectionPoint: findSkysportsInjectionPoint,
  getDynamicSelectors: getSkysportsDynamicSelectors,
  getWrapperStyles: getSkysportsWrapperStyles,
  hasInjectedCard: hasSkysportsInjectedCard,
});

export const adapter: PlatformAdapter = SkySportsAdapter;

export { SkySportsAdapter };
