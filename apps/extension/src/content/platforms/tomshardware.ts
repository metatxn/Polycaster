import type { InjectionPoint, PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import {
  combineTextParts,
  GENERIC_LINK_PATTERN,
  normalizeText,
} from "./helpers";
import {
  findPrimaryLinkFromSelectors,
  getDocumentDescription,
  getFirstMatchingText,
  getFullWidthCardWrapperStyles,
  hasInjectedCardSibling,
} from "./story-adapter-helpers";

const TOMSHARDWARE_HOST_RE = /^(?:www\.)?tomshardware\.com$/i;

// Tom's Hardware editorial URLs are section-nested slugs, e.g.
// /tech-industry/semiconductors/{long-slug}. No numeric IDs.
const TOMSHARDWARE_ARTICLE_PATH_RE =
  /^\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i;

const TOMSHARDWARE_CONTAINER_SELECTORS = ["#main", "body"] as const;

const TOMSHARDWARE_PRIMARY_LINK_SELECTORS = [
  "a.article-link[href]",
  ".listingResult a[href]",
  "a[href*='tomshardware.com/']",
  "a[href]",
] as const;

// Homepage cards sit under `<div class="listingResult">`. Each result DIV
// wraps a single `<a class="article-link">` that covers the whole card, so
// the item root MUST be the outer DIV — otherwise any injection lands inside
// the wrapping anchor and every click on the market card navigates to the
// article instead of opening our UI.
const TOMSHARDWARE_FEED_ITEM_ROOT_SELECTORS = [".listingResult"] as const;

const TOMSHARDWARE_ARTICLE_ITEM_ROOT_SELECTORS = [
  "article.news-article > header h1",
  ".news-article > header h1",
  "article.news-article h1",
  ".news-article h1",
] as const;

const TOMSHARDWARE_TITLE_SELECTORS = [
  ".news-article header h1",
  "a.article-link[aria-label]",
  ".article-link",
  "h1",
  "h2",
  "h3",
] as const;

const TOMSHARDWARE_DESCRIPTION_SELECTORS = [
  ".strap",
  ".synopsis",
  "[class*='description']",
  "[class*='summary']",
  ".listingResult p",
  "p",
] as const;

function isTomsHardwareArticlePage(): boolean {
  return (
    TOMSHARDWARE_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(
      TOMSHARDWARE_ARTICLE_ITEM_ROOT_SELECTORS.join(", ")
    )
  );
}

function getTomsHardwareArticleScope(postElement: Element): Element {
  return (
    postElement.closest("article.news-article") ||
    postElement.closest(".news-article") ||
    postElement.closest("#main") ||
    postElement.parentElement ||
    postElement
  );
}

function getTomsHardwareStoryScope(postElement: Element): Element {
  if (
    postElement.matches(TOMSHARDWARE_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    return getTomsHardwareArticleScope(postElement);
  }

  return postElement.closest(".listingResult") || postElement;
}

function getTomsHardwarePrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getTomsHardwareStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    TOMSHARDWARE_PRIMARY_LINK_SELECTORS
  );
}

function extractTomsHardwareFeedText(postElement: Element): string {
  const scope = getTomsHardwareStoryScope(postElement);

  // `aria-label` is the most reliable headline source for `a.article-link`
  // cards because the inner markup is often split across truncation spans.
  const link = getTomsHardwarePrimaryLink(postElement);
  const ariaTitle = normalizeText(link?.getAttribute("aria-label"));

  const title =
    ariaTitle ||
    getFirstMatchingText(scope, TOMSHARDWARE_TITLE_SELECTORS) ||
    normalizeText(link?.textContent);
  const summary =
    getFirstMatchingText(scope, TOMSHARDWARE_DESCRIPTION_SELECTORS) || "";

  return combineTextParts([title, summary], 8);
}

function extractTomsHardwarePostText(postElement: Element): string {
  if (
    postElement.matches(TOMSHARDWARE_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    const scope = getTomsHardwareArticleScope(postElement);
    const title = normalizeText(postElement.textContent);
    const strap =
      getFirstMatchingText(scope, TOMSHARDWARE_DESCRIPTION_SELECTORS) || "";
    const summary = strap || getDocumentDescription();
    return combineTextParts([title, summary], 8);
  }

  return extractTomsHardwareFeedText(postElement);
}

function getTomsHardwarePostId(postElement: Element): string | null {
  if (
    postElement.matches(TOMSHARDWARE_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    const path = window.location.pathname;
    const match = path.match(GENERIC_LINK_PATTERN);
    return match?.[1] || path || null;
  }

  const href =
    getTomsHardwarePrimaryLink(postElement)?.getAttribute("href") || "";
  const directMatch = href.match(GENERIC_LINK_PATTERN);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  try {
    const url = new URL(href, window.location.origin);
    const pathnameMatch = url.pathname.match(GENERIC_LINK_PATTERN);
    return pathnameMatch?.[1] || normalizeText(url.pathname) || null;
  } catch {
    return normalizeText(href) || null;
  }
}

function getTomsHardwareDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    TOMSHARDWARE_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isTomsHardwareArticlePage()) {
    return {
      itemSelector: TOMSHARDWARE_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = TOMSHARDWARE_FEED_ITEM_ROOT_SELECTORS.map(
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

function findTomsHardwareArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getTomsHardwareArticleScope(postElement);
  const byline = articleScope.querySelector("[class*='byline']");
  if (byline?.parentElement) {
    return {
      container: byline.parentElement,
      referenceElement: byline,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  const header = articleScope.querySelector("header");
  if (header?.parentElement) {
    return {
      container: header.parentElement,
      referenceElement: header,
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

function findTomsHardwareFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getTomsHardwareStoryScope(postElement);
  if (!scope.parentElement) {
    return null;
  }

  // `scope` is `.listingResult`, which sits OUTSIDE the wrapping
  // `<a class="article-link">`. Inserting after it keeps the card out of
  // the anchor's click target so our UI handles its own clicks.
  return {
    container: scope.parentElement,
    referenceElement: scope,
    insertPosition: "after",
    postWrapper: scope,
  };
}

function findTomsHardwareInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (
    postElement.matches(TOMSHARDWARE_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    return findTomsHardwareArticleInjectionPoint(postElement);
  }

  return findTomsHardwareFeedInjectionPoint(postElement);
}

function hasTomsHardwareInjectedCard(postElement: Element): boolean {
  if (
    postElement.matches(TOMSHARDWARE_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    const articleScope = getTomsHardwareArticleScope(postElement);
    const anchor =
      articleScope.querySelector("[class*='byline']") ||
      articleScope.querySelector("header");
    return (
      (anchor
        ? hasInjectedCardSibling(anchor)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getTomsHardwareStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getTomsHardwareWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const TomsHardwareAdapter = createBasicAdapter({
  name: "tomshardware",
  hostPatterns: [TOMSHARDWARE_HOST_RE],
  itemSelectors: [
    ...TOMSHARDWARE_FEED_ITEM_ROOT_SELECTORS,
    ...TOMSHARDWARE_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...TOMSHARDWARE_CONTAINER_SELECTORS],
  textSelectors: [...TOMSHARDWARE_TITLE_SELECTORS],
  accentColor: "#0056b3",
  fontFamily:
    '"Source Sans Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractTomsHardwarePostText,
  getPostId: getTomsHardwarePostId,
  findInjectionPoint: findTomsHardwareInjectionPoint,
  getDynamicSelectors: getTomsHardwareDynamicSelectors,
  getWrapperStyles: getTomsHardwareWrapperStyles,
  hasInjectedCard: hasTomsHardwareInjectedCard,
});

export const adapter: PlatformAdapter = TomsHardwareAdapter;

export { TomsHardwareAdapter };
