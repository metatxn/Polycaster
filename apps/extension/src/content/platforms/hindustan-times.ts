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

const HINDUSTAN_TIMES_HOST_RE = /^(?:www\.)?hindustantimes\.com$/i;
const HINDUSTAN_TIMES_ARTICLE_PATH_RE = /\.html(?:$|[?#])/i;
const HINDUSTAN_TIMES_STORY_ID_PATTERN = /-([0-9]{8,})\.html(?:[?#].*)?$/i;

const HINDUSTAN_TIMES_CONTAINER_SELECTORS = [
  ".articlePage main.container",
  "main",
  "#topnews",
  "body",
] as const;

const HINDUSTAN_TIMES_PRIMARY_LINK_SELECTORS = [
  'a.storyLink.articleClick[href*="hindustantimes.com/"][href$=".html"]',
  'h2.hdg3 a[href*="hindustantimes.com/"][href$=".html"]',
  'a[data-articleid][href*="hindustantimes.com/"][href$=".html"]',
  'a.storyLink.articleClick[href^="/"][href$=".html"]',
  'h2.hdg3 a[href^="/"][href$=".html"]',
  'a[data-articleid][href^="/"][href$=".html"]',
] as const;

const HINDUSTAN_TIMES_FEED_ITEM_ROOT_SELECTORS = [
  '.cartHolder.track[data-vars-storytype="story"][data-weburl*="hindustantimes.com/"]',
  '.cartHolder.track[data-vars-story-url*=".html"]',
  '.cartHolder.track:has(a.storyLink.articleClick[href*="hindustantimes.com/"][href$=".html"])',
] as const;

const HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS = [
  "#dataHolder.detailPage.mainStory h1.artTitle",
  ".detailPage.mainStory h1.artTitle",
  "h1.artTitle",
  ".articleDetail h1",
  "main h1",
  "article h1",
] as const;

const HINDUSTAN_TIMES_TITLE_SELECTORS = [
  "h1.artTitle",
  "h2.hdg3 a",
  "h2.hdg3",
  "h1",
  "h2",
] as const;

const HINDUSTAN_TIMES_SUMMARY_SELECTORS = [
  "h2.artIntro",
  ".storyShortDetail .secName",
  ".storyShortDetail",
  ".actionDiv .secName",
  ".actionDiv",
  "p.content",
] as const;

function isHindustanTimesArticlePage(): boolean {
  return (
    HINDUSTAN_TIMES_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(
      HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS.join(", ")
    )
  );
}

function getHindustanTimesArticleScope(postElement: Element): Element {
  return (
    postElement.closest("#dataHolder.detailPage.mainStory") ||
    postElement.closest(".detailPage.mainStory") ||
    postElement.closest(".articleDetail") ||
    postElement.closest("article") ||
    postElement.closest("main") ||
    postElement.parentElement ||
    postElement
  );
}

function getHindustanTimesStoryScope(postElement: Element): Element {
  if (
    postElement.matches(HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    return getHindustanTimesArticleScope(postElement);
  }

  return postElement.closest(".cartHolder.track") || postElement;
}

function getHindustanTimesPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getHindustanTimesStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    HINDUSTAN_TIMES_PRIMARY_LINK_SELECTORS
  );
}

function extractHindustanTimesFeedText(postElement: Element): string {
  const scope = getHindustanTimesStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, HINDUSTAN_TIMES_TITLE_SELECTORS) ||
    normalizeText(scope.getAttribute("data-vars-story-title")) ||
    normalizeText(getHindustanTimesPrimaryLink(postElement)?.textContent);
  const summary =
    getFirstMatchingText(scope, HINDUSTAN_TIMES_SUMMARY_SELECTORS) ||
    normalizeText(scope.getAttribute("data-vars-section"));

  return combineTextParts([title, summary]);
}

function extractHindustanTimesPostText(postElement: Element): string {
  if (
    postElement.matches(HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    const articleScope = getHindustanTimesArticleScope(postElement);
    const title =
      normalizeText(postElement.textContent) ||
      normalizeText(articleScope.getAttribute("data-title"));
    const summary =
      getFirstMatchingText(articleScope, ["h2.artIntro", "p.content"]) ||
      getDocumentDescription();

    return combineTextParts([title, summary]);
  }

  return extractHindustanTimesFeedText(postElement);
}

function getHindustanTimesPostId(postElement: Element): string | null {
  if (
    postElement.matches(HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    const articleScope = getHindustanTimesArticleScope(postElement);
    return (
      normalizeText(articleScope.getAttribute("data-story-id")) ||
      (window.location.pathname !== "/" ? window.location.pathname : null)
    );
  }

  const scope = getHindustanTimesStoryScope(postElement);
  const dataStoryId =
    normalizeText(scope.getAttribute("data-vars-storyid")) ||
    normalizeText(scope.getAttribute("data-story-id"));
  if (dataStoryId) {
    return dataStoryId;
  }

  const href =
    getHindustanTimesPrimaryLink(postElement)?.getAttribute("href") ||
    getHindustanTimesPrimaryLink(postElement)?.href ||
    "";
  const match = href.match(HINDUSTAN_TIMES_STORY_ID_PATTERN);
  if (match?.[1]) {
    return match[1];
  }

  try {
    const url = new URL(href, window.location.origin);
    return normalizeText(url.pathname) || null;
  } catch {
    return normalizeText(href) || null;
  }
}

function getHindustanTimesDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    HINDUSTAN_TIMES_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isHindustanTimesArticlePage()) {
    return {
      itemSelector: HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = HINDUSTAN_TIMES_FEED_ITEM_ROOT_SELECTORS.map(
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

function findHindustanTimesArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getHindustanTimesArticleScope(postElement);
  const intro =
    articleScope.querySelector("h2.artIntro") ||
    document.querySelector("h2.artIntro");

  if (intro?.parentElement) {
    return {
      container: intro.parentElement,
      referenceElement: intro,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  const title = document.querySelector(
    HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS.join(", ")
  );
  if (title?.parentElement) {
    return {
      container: title.parentElement,
      referenceElement: title,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  return null;
}

function findHindustanTimesFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getHindustanTimesStoryScope(postElement);
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

function findHindustanTimesInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (
    postElement.matches(HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    return findHindustanTimesArticleInjectionPoint(postElement);
  }

  return findHindustanTimesFeedInjectionPoint(postElement);
}

function hasHindustanTimesInjectedCard(postElement: Element): boolean {
  if (
    postElement.matches(HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  ) {
    const articleScope = getHindustanTimesArticleScope(postElement);
    const intro =
      articleScope.querySelector("h2.artIntro") ||
      document.querySelector("h2.artIntro");

    return (
      (intro ? hasInjectedCardSibling(intro) : false) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getHindustanTimesStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getHindustanTimesWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const HindustanTimesAdapter = createBasicAdapter({
  name: "hindustan-times",
  hostPatterns: [HINDUSTAN_TIMES_HOST_RE],
  itemSelectors: [
    ...HINDUSTAN_TIMES_FEED_ITEM_ROOT_SELECTORS,
    ...HINDUSTAN_TIMES_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...HINDUSTAN_TIMES_CONTAINER_SELECTORS],
  textSelectors: [
    ...HINDUSTAN_TIMES_TITLE_SELECTORS,
    ...HINDUSTAN_TIMES_SUMMARY_SELECTORS,
  ],
  accentColor: "#00b1cd",
  fontFamily: 'Lato, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractHindustanTimesPostText,
  getPostId: getHindustanTimesPostId,
  findInjectionPoint: findHindustanTimesInjectionPoint,
  getDynamicSelectors: getHindustanTimesDynamicSelectors,
  getWrapperStyles: getHindustanTimesWrapperStyles,
  hasInjectedCard: hasHindustanTimesInjectedCard,
});

registerAdapterWithRetry(HindustanTimesAdapter, 100, 50);

export { HindustanTimesAdapter };
