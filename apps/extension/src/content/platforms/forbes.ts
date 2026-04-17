import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { combineTextParts, normalizeText } from "./helpers";
import {
  findPrimaryLinkFromSelectors,
  getDocumentDescription,
  getFirstMatchingText,
  getFullWidthCardWrapperStyles,
  hasInjectedCardSibling,
} from "./story-adapter-helpers";

const FORBES_HOST_RE = /^(?:www\.)?forbes\.com$/i;

// Forbes article URLs are /sites/{author}/{yyyy}/{mm}/{dd}/{slug}/ (no .html).
const FORBES_ARTICLE_PATH_RE =
  /^\/sites\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/[^/?#]+\/?(?:[?#].*)?$/i;
const FORBES_ARTICLE_SLUG_PATTERN =
  /\/sites\/([^/?#]+\/\d{4}\/\d{2}\/\d{2}\/[^/?#]+)\/?(?:[?#]|$)/i;

const FORBES_CONTAINER_SELECTORS = [
  "main",
  ".main-content",
  "#root",
  "body",
] as const;

const FORBES_PRIMARY_LINK_SELECTORS = [
  "a.headlink[href*='/sites/']",
  "a.for-you-card__title[href*='/sites/']",
  "a.featured__slide-link--title[href*='/sites/']",
  "a.featured__slide-link[href*='/sites/']",
  "a[href*='forbes.com/sites/']",
  "a[href*='/sites/']",
] as const;

// Homepage / channel feed cards. Forbes uses semi-stable BEM names on card
// roots even though many inner classes are hashed. `:has()` gates out nav
// rail / footer cards that happen to share the `card` base class.
const FORBES_FEED_ITEM_ROOT_SELECTORS = [
  ".card.card--large:has(a[href*='/sites/'])",
  ".card.card--small:has(a[href*='/sites/'])",
  ".card.csf-block:has(a[href*='/sites/'])",
  ".for-you-card:has(a[href*='/sites/'])",
  ".featured__slide-content:has(a[href*='/sites/'])",
  ".channel__content:has(a[href*='/sites/'])",
] as const;

// Article pages. Forbes tags the main headline with `speakable-headline` for
// accessibility, which is the only class name that reliably survives their
// CSS-in-JS build. `main article h1` covers layouts that drop the hint.
const FORBES_ARTICLE_ITEM_ROOT_SELECTORS = [
  "h1.speakable-headline",
  "main article h1",
] as const;

const FORBES_TITLE_SELECTORS = [
  "h1.speakable-headline",
  "a.headlink",
  "a.for-you-card__title",
  "a.featured__slide-link--title",
  "h3.h3--dense",
  "h1",
  "h2",
  "h3",
] as const;

const FORBES_DESCRIPTION_SELECTORS = [
  ".body--dense.list--description",
  ".list--description",
  "[class*='description']",
  "[class*='deck']",
  "p",
] as const;

function isForbesArticlePage(): boolean {
  return (
    FORBES_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(FORBES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  );
}

function getForbesArticleScope(postElement: Element): Element {
  return (
    postElement.closest("article[id^='article-num-']") ||
    postElement.closest("main article") ||
    postElement.closest(".headline-embed") ||
    postElement.closest("main") ||
    postElement.parentElement ||
    postElement
  );
}

function getForbesStoryScope(postElement: Element): Element {
  if (postElement.matches(FORBES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return getForbesArticleScope(postElement);
  }

  return (
    postElement.closest(".card.card--large") ||
    postElement.closest(".card.card--small") ||
    postElement.closest(".card.csf-block") ||
    postElement.closest(".for-you-card") ||
    postElement.closest(".featured__slide-content") ||
    postElement.closest(".channel__content") ||
    postElement
  );
}

function getForbesPrimaryLink(postElement: Element): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getForbesStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    FORBES_PRIMARY_LINK_SELECTORS
  );
}

function extractForbesFeedText(postElement: Element): string {
  const scope = getForbesStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, FORBES_TITLE_SELECTORS) ||
    normalizeText(getForbesPrimaryLink(postElement)?.textContent);
  const summary =
    getFirstMatchingText(scope, FORBES_DESCRIPTION_SELECTORS) || "";

  return combineTextParts([title, summary], 8);
}

function extractForbesPostText(postElement: Element): string {
  if (postElement.matches(FORBES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const title = normalizeText(postElement.textContent);
    const summary = getDocumentDescription();
    return combineTextParts([title, summary], 8);
  }

  return extractForbesFeedText(postElement);
}

function getForbesPostId(postElement: Element): string | null {
  if (postElement.matches(FORBES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const match = window.location.pathname.match(FORBES_ARTICLE_SLUG_PATTERN);
    return match?.[1] || window.location.pathname || null;
  }

  const href = getForbesPrimaryLink(postElement)?.getAttribute("href") || "";
  const directMatch = href.match(FORBES_ARTICLE_SLUG_PATTERN);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  try {
    const url = new URL(href, window.location.origin);
    const pathnameMatch = url.pathname.match(FORBES_ARTICLE_SLUG_PATTERN);
    return pathnameMatch?.[1] || normalizeText(url.pathname) || null;
  } catch {
    return normalizeText(href) || null;
  }
}

function getForbesDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    FORBES_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isForbesArticlePage()) {
    return {
      itemSelector: FORBES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = FORBES_FEED_ITEM_ROOT_SELECTORS.map(
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

function findForbesArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getForbesArticleScope(postElement);
  const byline = articleScope.querySelector(
    "[class*='byline'], [class*='Byline']"
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

function findForbesFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getForbesStoryScope(postElement);
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

function findForbesInjectionPoint(postElement: Element): InjectionPoint | null {
  if (postElement.matches(FORBES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return findForbesArticleInjectionPoint(postElement);
  }

  return findForbesFeedInjectionPoint(postElement);
}

function hasForbesInjectedCard(postElement: Element): boolean {
  if (postElement.matches(FORBES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const articleScope = getForbesArticleScope(postElement);
    const byline = articleScope.querySelector(
      "[class*='byline'], [class*='Byline']"
    );
    return (
      (byline
        ? hasInjectedCardSibling(byline)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getForbesStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getForbesWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const ForbesAdapter = createBasicAdapter({
  name: "forbes",
  hostPatterns: [FORBES_HOST_RE],
  itemSelectors: [
    ...FORBES_FEED_ITEM_ROOT_SELECTORS,
    ...FORBES_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...FORBES_CONTAINER_SELECTORS],
  textSelectors: [...FORBES_TITLE_SELECTORS],
  accentColor: "#d82229",
  fontFamily:
    '"Work Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractForbesPostText,
  getPostId: getForbesPostId,
  findInjectionPoint: findForbesInjectionPoint,
  getDynamicSelectors: getForbesDynamicSelectors,
  getWrapperStyles: getForbesWrapperStyles,
  hasInjectedCard: hasForbesInjectedCard,
});

registerAdapterWithRetry(ForbesAdapter, 100, 50);

export { ForbesAdapter };
