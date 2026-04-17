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

const FOXSPORTS_HOST_RE = /^(?:www\.)?foxsports\.com$/i;

// Every editorial article on Fox Sports lives under /stories/{sport}/{slug};
// box-score pages use /{sport}/{team-slug}-{numeric-id}. Both are handled by
// the feed-detection logic — isArticlePage just needs a story headline.
const FOXSPORTS_ARTICLE_PATH_RE =
  /^\/(?:stories\/[^/?#]+\/[^/?#]+|[a-z-]+\/[^/?#]+-\d{3,})\/?(?:[?#].*)?$/i;

const FOXSPORTS_CONTAINER_SELECTORS = [
  ".fscom-main-content",
  "#__nuxt",
  "body",
] as const;

const FOXSPORTS_PRIMARY_LINK_SELECTORS = [
  "a.card-story[href]",
  "a[href*='/stories/']",
  ".article-texts a[href]",
  "a[href*='foxsports.com/stories/']",
  "a[href]",
] as const;

// Homepage story units. `.news-article` and `.article-container` are the same
// element with stacked classes, so we keep both as item roots so whichever
// variant persists across templates still matches.
const FOXSPORTS_FEED_ITEM_ROOT_SELECTORS = [
  ".news-article",
  ".article-container",
  "a.card-story",
] as const;

const FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS = [
  "h1.story-title",
  ".story-header-container h1",
] as const;

const FOXSPORTS_TITLE_SELECTORS = [
  "h1.story-title",
  ".story-header-container h1",
  ".article-texts h1",
  ".article-texts h2",
  ".article-texts h3",
  "h1",
  "h2",
  "h3",
] as const;

const FOXSPORTS_DESCRIPTION_SELECTORS = [
  ".article-texts p",
  ".article-texts [class*='description']",
  ".article-texts [class*='summary']",
  ".story-topic",
  "p",
] as const;

function isFoxSportsArticlePage(): boolean {
  return (
    FOXSPORTS_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  );
}

function getFoxSportsArticleScope(postElement: Element): Element {
  return (
    postElement.closest(".story-content-main") ||
    postElement.closest(".story-content") ||
    postElement.closest(".fscom-main-content") ||
    postElement.closest("#article-content") ||
    postElement.parentElement ||
    postElement
  );
}

function getFoxSportsStoryScope(postElement: Element): Element {
  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return getFoxSportsArticleScope(postElement);
  }

  return (
    postElement.closest(".news-article") ||
    postElement.closest(".article-container") ||
    postElement.closest("a.card-story") ||
    postElement
  );
}

function getFoxSportsPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getFoxSportsStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    FOXSPORTS_PRIMARY_LINK_SELECTORS
  );
}

function extractFoxSportsFeedText(postElement: Element): string {
  const scope = getFoxSportsStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, FOXSPORTS_TITLE_SELECTORS) ||
    normalizeText(getFoxSportsPrimaryLink(postElement)?.textContent);
  const summary =
    getFirstMatchingText(scope, FOXSPORTS_DESCRIPTION_SELECTORS) || "";

  return combineTextParts([title, summary], 8);
}

function extractFoxSportsPostText(postElement: Element): string {
  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const scope = getFoxSportsArticleScope(postElement);
    const title = normalizeText(postElement.textContent);
    const summary =
      getFirstMatchingText(scope, FOXSPORTS_DESCRIPTION_SELECTORS) ||
      getDocumentDescription();
    return combineTextParts([title, summary], 8);
  }

  return extractFoxSportsFeedText(postElement);
}

function getFoxSportsPostId(postElement: Element): string | null {
  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const path = window.location.pathname;
    const match = path.match(GENERIC_LINK_PATTERN);
    return match?.[1] || path || null;
  }

  const href = getFoxSportsPrimaryLink(postElement)?.getAttribute("href") || "";
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

function getFoxSportsDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    FOXSPORTS_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isFoxSportsArticlePage()) {
    return {
      itemSelector: FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = FOXSPORTS_FEED_ITEM_ROOT_SELECTORS.map(
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

function findFoxSportsArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getFoxSportsArticleScope(postElement);
  const byline =
    articleScope.querySelector(".story-by-line") ||
    articleScope.querySelector(".article-contributors");
  if (byline?.parentElement) {
    return {
      container: byline.parentElement,
      referenceElement: byline,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  const headerContainer = articleScope.querySelector(".story-header-container");
  if (headerContainer?.parentElement) {
    return {
      container: headerContainer.parentElement,
      referenceElement: headerContainer,
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

function findFoxSportsFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getFoxSportsStoryScope(postElement);
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

function findFoxSportsInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return findFoxSportsArticleInjectionPoint(postElement);
  }

  return findFoxSportsFeedInjectionPoint(postElement);
}

function hasFoxSportsInjectedCard(postElement: Element): boolean {
  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const articleScope = getFoxSportsArticleScope(postElement);
    const anchor =
      articleScope.querySelector(".story-by-line") ||
      articleScope.querySelector(".article-contributors") ||
      articleScope.querySelector(".story-header-container");
    return (
      (anchor
        ? hasInjectedCardSibling(anchor)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getFoxSportsStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getFoxSportsWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const FoxSportsAdapter = createBasicAdapter({
  name: "fox-sports",
  hostPatterns: [FOXSPORTS_HOST_RE],
  itemSelectors: [
    ...FOXSPORTS_FEED_ITEM_ROOT_SELECTORS,
    ...FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...FOXSPORTS_CONTAINER_SELECTORS],
  textSelectors: [...FOXSPORTS_TITLE_SELECTORS],
  accentColor: "#003478",
  fontFamily:
    '"Benton Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractFoxSportsPostText,
  getPostId: getFoxSportsPostId,
  findInjectionPoint: findFoxSportsInjectionPoint,
  getDynamicSelectors: getFoxSportsDynamicSelectors,
  getWrapperStyles: getFoxSportsWrapperStyles,
  hasInjectedCard: hasFoxSportsInjectedCard,
});

registerAdapterWithRetry(FoxSportsAdapter, 100, 50);

export { FoxSportsAdapter };
