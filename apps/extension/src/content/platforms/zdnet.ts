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

const ZDNET_HOST_RE = /^(?:www\.)?zdnet\.com$/i;

// ZDNet URLs are either /article/{slug}/ or /{section}/{subsection}/{slug}/.
const ZDNET_ARTICLE_PATH_RE =
  /^\/(?:article\/[a-z0-9][a-z0-9-]+|[a-z][a-z-]*\/[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]+)\/?(?:[?#].*)?$/i;

const ZDNET_CONTAINER_SELECTORS = [
  "main",
  ".c-pageHome",
  "#__nuxt",
  "body",
] as const;

const ZDNET_PRIMARY_LINK_SELECTORS = [
  "a.c-listingLatest_itemLink[href]",
  "a.c-featureFeaturedStory_link[href]",
  "a.c-featureThreeItems_recommendsItemLink[href]",
  ".c-listingLatest_item a[href]",
  ".c-featureThreeItems_item a[href]",
  ".c-listingTopStories_item a[href]",
  ".c-featureFeaturedStory a[href]",
  "a[href^='/article/']",
  "a[href]",
] as const;

// Homepage feed wrappers. ZDNet shares Red Ventures' `c-*` BEM stack with
// CNET but uses a different component family (`listingLatest`, `featureX`).
const ZDNET_FEED_ITEM_ROOT_SELECTORS = [
  ".c-featureFeaturedStory",
  ".c-featureThreeItems_item",
  ".c-listingTopStories_item",
  ".c-listingLatest_item",
] as const;

const ZDNET_ARTICLE_ITEM_ROOT_SELECTORS = [
  "h1.c-contentHeader_headline",
  ".c-contentHeader h1",
] as const;

const ZDNET_TITLE_SELECTORS = [
  "h1.c-contentHeader_headline",
  ".c-featureFeaturedStory_link",
  ".c-listingLatest_itemLink",
  ".c-featureThreeItems_item a",
  "h1",
  "h2",
  "h3",
] as const;

const ZDNET_DESCRIPTION_SELECTORS = [
  ".c-contentHeader_description",
  "[class*='description']",
  "[class*='summary']",
  "[class*='dek']",
  "p",
] as const;

function isZdnetArticlePage(): boolean {
  return (
    ZDNET_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(ZDNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  );
}

function getZdnetArticleScope(postElement: Element): Element {
  return (
    postElement.closest(".c-pageArticleSingle") ||
    postElement.closest(".c-contentHeader") ||
    postElement.closest("main") ||
    postElement.parentElement ||
    postElement
  );
}

function getZdnetStoryScope(postElement: Element): Element {
  if (postElement.matches(ZDNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return getZdnetArticleScope(postElement);
  }

  return (
    postElement.closest(".c-featureFeaturedStory") ||
    postElement.closest(".c-featureThreeItems_item") ||
    postElement.closest(".c-listingTopStories_item") ||
    postElement.closest(".c-listingLatest_item") ||
    postElement
  );
}

function getZdnetPrimaryLink(postElement: Element): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getZdnetStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    ZDNET_PRIMARY_LINK_SELECTORS
  );
}

function extractZdnetFeedText(postElement: Element): string {
  const scope = getZdnetStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, ZDNET_TITLE_SELECTORS) ||
    normalizeText(getZdnetPrimaryLink(postElement)?.textContent);
  const summary =
    getFirstMatchingText(scope, ZDNET_DESCRIPTION_SELECTORS) || "";

  return combineTextParts([title, summary], 8);
}

function extractZdnetPostText(postElement: Element): string {
  if (postElement.matches(ZDNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const scope = getZdnetArticleScope(postElement);
    const title = normalizeText(postElement.textContent);
    const dek = getFirstMatchingText(scope, ZDNET_DESCRIPTION_SELECTORS) || "";
    const summary = dek || getDocumentDescription();
    return combineTextParts([title, summary], 8);
  }

  return extractZdnetFeedText(postElement);
}

function getZdnetPostId(postElement: Element): string | null {
  if (postElement.matches(ZDNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const path = window.location.pathname;
    const match = path.match(GENERIC_LINK_PATTERN);
    return match?.[1] || path || null;
  }

  const href = getZdnetPrimaryLink(postElement)?.getAttribute("href") || "";
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

function getZdnetDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    ZDNET_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isZdnetArticlePage()) {
    return {
      itemSelector: ZDNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = ZDNET_FEED_ITEM_ROOT_SELECTORS.map(
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

function findZdnetArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getZdnetArticleScope(postElement);
  const description = articleScope.querySelector(
    ".c-contentHeader_description"
  );
  if (description?.parentElement) {
    return {
      container: description.parentElement,
      referenceElement: description,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  const infoContainer = articleScope.querySelector(
    ".c-contentHeader_infoContainer"
  );
  if (infoContainer?.parentElement) {
    return {
      container: infoContainer.parentElement,
      referenceElement: infoContainer,
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

function findZdnetFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getZdnetStoryScope(postElement);
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

function findZdnetInjectionPoint(postElement: Element): InjectionPoint | null {
  if (postElement.matches(ZDNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return findZdnetArticleInjectionPoint(postElement);
  }

  return findZdnetFeedInjectionPoint(postElement);
}

function hasZdnetInjectedCard(postElement: Element): boolean {
  if (postElement.matches(ZDNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const articleScope = getZdnetArticleScope(postElement);
    const anchor =
      articleScope.querySelector(".c-contentHeader_description") ||
      articleScope.querySelector(".c-contentHeader_infoContainer") ||
      articleScope.querySelector(".c-contentHeader");
    return (
      (anchor
        ? hasInjectedCardSibling(anchor)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getZdnetStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getZdnetWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const ZdnetAdapter = createBasicAdapter({
  name: "zdnet",
  hostPatterns: [ZDNET_HOST_RE],
  itemSelectors: [
    ...ZDNET_FEED_ITEM_ROOT_SELECTORS,
    ...ZDNET_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...ZDNET_CONTAINER_SELECTORS],
  textSelectors: [...ZDNET_TITLE_SELECTORS],
  accentColor: "#ef1e25",
  fontFamily:
    '"Graphik", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractZdnetPostText,
  getPostId: getZdnetPostId,
  findInjectionPoint: findZdnetInjectionPoint,
  getDynamicSelectors: getZdnetDynamicSelectors,
  getWrapperStyles: getZdnetWrapperStyles,
  hasInjectedCard: hasZdnetInjectedCard,
});

export const adapter: PlatformAdapter = ZdnetAdapter;

export { ZdnetAdapter };
