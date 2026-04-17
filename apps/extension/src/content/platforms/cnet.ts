import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
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

const CNET_HOST_RE = /^(?:www\.)?cnet\.com$/i;

// CNET editorial URLs are always path-slug based, e.g.
// /tech/mobile/smartphone-prices-are-still-going-up-.../ — no numeric id.
const CNET_ARTICLE_PATH_RE =
  /^\/[a-z][a-z-]*\/[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i;

const CNET_CONTAINER_SELECTORS = [
  "main",
  ".c-pageHome",
  "#__nuxt",
  "body",
] as const;

const CNET_PRIMARY_LINK_SELECTORS = [
  "a.c-storiesNeonHighlightsCard_link[href]",
  "a.c-storiesNeonHighlightsLead_link[href]",
  ".c-storiesNeonHighlightsCard a[href]",
  ".c-categorySection_storyCard a[href]",
  ".c-storiesNeonBestCarousel_story a[href]",
  ".c-storiesNeonLatest_story a[href]",
  "a[href^='/tech/']",
  "a[href^='/home/']",
  "a[href^='/health/']",
  "a[href^='/money/']",
  "a[href^='/science/']",
  "a[href^='/culture/']",
  "a[href]",
] as const;

// Homepage feed cards. CNET nests hero + card components, so we list the
// canonical card classes; post-id dedup handles any nested overlap.
const CNET_FEED_ITEM_ROOT_SELECTORS = [
  ".c-storiesNeonHighlightsLead",
  ".c-storiesNeonHighlightsCard",
  ".c-categorySection_storyCard",
  ".c-storiesNeonBestCarousel_story",
  ".c-storiesNeonLatest_story",
] as const;

const CNET_ARTICLE_ITEM_ROOT_SELECTORS = [
  "h1.c-contentHeader_headline",
  ".c-articleHeader_contentHeader h1",
] as const;

const CNET_TITLE_SELECTORS = [
  "h1.c-contentHeader_headline",
  ".c-storiesNeonHighlightsCard_link",
  ".c-storiesNeonHighlightsLead_link",
  ".c-categorySection_storyCard a",
  "h1",
  "h2",
  "h3",
] as const;

const CNET_DESCRIPTION_SELECTORS = [
  ".c-contentHeader_dek",
  ".c-storiesNeonHighlightsCard_description",
  "[class*='description']",
  "[class*='summary']",
  "[class*='dek']",
  "p",
] as const;

function isCnetArticlePage(): boolean {
  return (
    CNET_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(CNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  );
}

function getCnetArticleScope(postElement: Element): Element {
  return (
    postElement.closest(".c-articleHeader") ||
    postElement.closest(".c-pageArticle") ||
    postElement.closest("main") ||
    postElement.parentElement ||
    postElement
  );
}

function getCnetStoryScope(postElement: Element): Element {
  if (postElement.matches(CNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return getCnetArticleScope(postElement);
  }

  return (
    postElement.closest(".c-storiesNeonHighlightsLead") ||
    postElement.closest(".c-storiesNeonHighlightsCard") ||
    postElement.closest(".c-categorySection_storyCard") ||
    postElement.closest(".c-storiesNeonBestCarousel_story") ||
    postElement.closest(".c-storiesNeonLatest_story") ||
    postElement
  );
}

function getCnetPrimaryLink(postElement: Element): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getCnetStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    CNET_PRIMARY_LINK_SELECTORS
  );
}

function extractCnetFeedText(postElement: Element): string {
  const scope = getCnetStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, CNET_TITLE_SELECTORS) ||
    normalizeText(getCnetPrimaryLink(postElement)?.textContent);
  const summary = getFirstMatchingText(scope, CNET_DESCRIPTION_SELECTORS) || "";

  return combineTextParts([title, summary], 8);
}

function extractCnetPostText(postElement: Element): string {
  if (postElement.matches(CNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const scope = getCnetArticleScope(postElement);
    const title = normalizeText(postElement.textContent);
    const dek = getFirstMatchingText(scope, CNET_DESCRIPTION_SELECTORS) || "";
    const summary = dek || getDocumentDescription();
    return combineTextParts([title, summary], 8);
  }

  return extractCnetFeedText(postElement);
}

function getCnetPostId(postElement: Element): string | null {
  if (postElement.matches(CNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const path = window.location.pathname;
    const match = path.match(GENERIC_LINK_PATTERN);
    return match?.[1] || path || null;
  }

  const href = getCnetPrimaryLink(postElement)?.getAttribute("href") || "";
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

function getCnetDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    CNET_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isCnetArticlePage()) {
    return {
      itemSelector: CNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = CNET_FEED_ITEM_ROOT_SELECTORS.map(
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

function findCnetArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getCnetArticleScope(postElement);
  const meta = articleScope.querySelector(".c-articleHeader_metaContainer");
  if (meta?.parentElement) {
    return {
      container: meta.parentElement,
      referenceElement: meta,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  const contentHeader = articleScope.querySelector(
    ".c-articleHeader_contentHeader"
  );
  if (contentHeader?.parentElement) {
    return {
      container: contentHeader.parentElement,
      referenceElement: contentHeader,
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

function findCnetFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getCnetStoryScope(postElement);
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

function findCnetInjectionPoint(postElement: Element): InjectionPoint | null {
  if (postElement.matches(CNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return findCnetArticleInjectionPoint(postElement);
  }

  return findCnetFeedInjectionPoint(postElement);
}

function hasCnetInjectedCard(postElement: Element): boolean {
  if (postElement.matches(CNET_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const articleScope = getCnetArticleScope(postElement);
    const anchor =
      articleScope.querySelector(".c-articleHeader_metaContainer") ||
      articleScope.querySelector(".c-articleHeader_contentHeader");
    return (
      (anchor
        ? hasInjectedCardSibling(anchor)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getCnetStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getCnetWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const CnetAdapter = createBasicAdapter({
  name: "cnet",
  hostPatterns: [CNET_HOST_RE],
  itemSelectors: [
    ...CNET_FEED_ITEM_ROOT_SELECTORS,
    ...CNET_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...CNET_CONTAINER_SELECTORS],
  textSelectors: [...CNET_TITLE_SELECTORS],
  accentColor: "#e30613",
  fontFamily:
    '"Graphik", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractCnetPostText,
  getPostId: getCnetPostId,
  findInjectionPoint: findCnetInjectionPoint,
  getDynamicSelectors: getCnetDynamicSelectors,
  getWrapperStyles: getCnetWrapperStyles,
  hasInjectedCard: hasCnetInjectedCard,
});

registerAdapterWithRetry(CnetAdapter, 100, 50);

export { CnetAdapter };
