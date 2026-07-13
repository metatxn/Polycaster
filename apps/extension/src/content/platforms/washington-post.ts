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

const WASHINGTON_POST_HOST_RE = /^(?:www\.)?washingtonpost\.com$/i;

const WASHINGTON_POST_CONTAINER_SELECTORS = [
  "main",
  '[role="main"]',
  "#main-content",
  "body",
] as const;

/** WaPo feed + section pages often use absolute https URLs; relative `/…` matchers miss every headline link. */
const WASHINGTON_POST_ARTICLE_HREF_SNIPPET =
  "[href*='washingtonpost.'][href*='/20']";

const WASHINGTON_POST_PRIMARY_LINK_SELECTORS = [
  `a[data-qa*='headline']${WASHINGTON_POST_ARTICLE_HREF_SNIPPET}`,
  `a[data-qa*='title']${WASHINGTON_POST_ARTICLE_HREF_SNIPPET}`,
  "a[data-qa*='headline'][href^='/']",
  "a[data-qa*='title'][href^='/']",
  `h2 a${WASHINGTON_POST_ARTICLE_HREF_SNIPPET}`,
  `h3 a${WASHINGTON_POST_ARTICLE_HREF_SNIPPET}`,
  `h4 a${WASHINGTON_POST_ARTICLE_HREF_SNIPPET}`,
  "h2 a[href^='/']",
  "h3 a[href^='/']",
  "h4 a[href^='/']",
  `a${WASHINGTON_POST_ARTICLE_HREF_SNIPPET}`,
  'a[href^="/"][href*="/20"]',
] as const;

const WASHINGTON_POST_ITEM_ROOT_SELECTORS = [
  `a[data-qa*='headline']${WASHINGTON_POST_ARTICLE_HREF_SNIPPET}`,
  `a[data-qa*='title']${WASHINGTON_POST_ARTICLE_HREF_SNIPPET}`,
  "a[data-qa*='headline'][href^='/']",
  "a[data-qa*='title'][href^='/']",
  `h2:has(a${WASHINGTON_POST_ARTICLE_HREF_SNIPPET})`,
  `h3:has(a${WASHINGTON_POST_ARTICLE_HREF_SNIPPET})`,
  `h4:has(a${WASHINGTON_POST_ARTICLE_HREF_SNIPPET})`,
  "h2:has(a[href^='/'])",
  "h3:has(a[href^='/'])",
  "h4:has(a[href^='/'])",
  `a${WASHINGTON_POST_ARTICLE_HREF_SNIPPET}`,
  'a[href^="/"][href*="/20"]',
  "h1",
  "article h1",
] as const;

const WASHINGTON_POST_TITLE_SELECTORS = [
  'a[data-qa*="headline"]',
  'a[data-qa*="title"]',
  "h1",
  "h2",
  "h3",
  "h4",
] as const;

const WASHINGTON_POST_SUMMARY_SELECTORS = [
  'p[data-qa*="description"]',
  'div[data-qa*="description"]',
  'div[data-qa*="summary"]',
  "h2",
  "p",
] as const;

function isWashingtonPostArticlePage(): boolean {
  return (
    window.location.pathname !== "/" &&
    !!document.querySelector("main h1, article h1, h1")
  );
}

function getWashingtonPostTitleBlock(postElement: Element): Element {
  return postElement.closest("h1, h2, h3, h4, h5, h6") || postElement;
}

function getWashingtonPostStoryScope(postElement: Element): Element {
  if (postElement.matches("h1")) {
    return (
      postElement.closest("main article, article, main") ||
      postElement.parentElement ||
      postElement
    );
  }

  const titleBlock = getWashingtonPostTitleBlock(postElement);

  return (
    titleBlock.closest("article") ||
    titleBlock.closest("section") ||
    titleBlock.closest("li") ||
    titleBlock.closest('[data-qa*="story"]') ||
    titleBlock.closest('[data-testid*="story"]') ||
    titleBlock.parentElement ||
    titleBlock
  );
}

function getWashingtonPostPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getWashingtonPostStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    WASHINGTON_POST_PRIMARY_LINK_SELECTORS
  );
}

function isLikelyWashingtonPostSummary(text: string, title: string): boolean {
  if (!text || text === title || text.length < 28) {
    return false;
  }

  if (/^By\b/i.test(text)) {
    return false;
  }

  if (/^(Analysis|Opinion|Live Updates|Column|Reader Q&A)$/i.test(text)) {
    return false;
  }

  if (/^\d+\s+(?:minute|minutes|hour|hours|day|days)\s+ago$/i.test(text)) {
    return false;
  }

  return true;
}

function getWashingtonPostSummaryBlock(
  scope: Element,
  titleBlock?: Element
): Element | null {
  const title = normalizeText(titleBlock?.textContent);

  if (titleBlock?.parentElement) {
    let sibling: Element | null = titleBlock.nextElementSibling;

    while (sibling) {
      const text = normalizeText(sibling.textContent);
      if (isLikelyWashingtonPostSummary(text, title)) {
        return sibling;
      }
      sibling = sibling.nextElementSibling;
    }
  }

  for (const selector of WASHINGTON_POST_SUMMARY_SELECTORS) {
    for (const candidate of Array.from(scope.querySelectorAll(selector))) {
      const text = normalizeText(candidate.textContent);
      if (isLikelyWashingtonPostSummary(text, title)) {
        return candidate;
      }
    }
  }

  for (const candidate of Array.from(
    scope.querySelectorAll("a, p, div, span")
  )) {
    const text = normalizeText(candidate.textContent);
    if (isLikelyWashingtonPostSummary(text, title)) {
      return candidate;
    }
  }

  return null;
}

function extractWashingtonPostPostText(postElement: Element): string {
  if (postElement.matches("h1")) {
    const title = normalizeText(postElement.textContent);
    const summary =
      getFirstMatchingText(document, WASHINGTON_POST_SUMMARY_SELECTORS) ||
      getDocumentDescription();

    return combineTextParts([title, summary]);
  }

  const scope = getWashingtonPostStoryScope(postElement);
  const titleBlock = getWashingtonPostTitleBlock(postElement);
  const title =
    normalizeText(titleBlock.textContent) ||
    getFirstMatchingText(scope, WASHINGTON_POST_TITLE_SELECTORS) ||
    normalizeText(getWashingtonPostPrimaryLink(postElement)?.textContent);
  const summary = normalizeText(
    getWashingtonPostSummaryBlock(scope, titleBlock)?.textContent
  );

  return combineTextParts([title, summary]);
}

function getWashingtonPostPostId(postElement: Element): string | null {
  if (postElement.matches("h1") && window.location.pathname !== "/") {
    return window.location.pathname;
  }

  const primaryLink = getWashingtonPostPrimaryLink(postElement);
  if (!primaryLink) {
    return null;
  }

  try {
    const url = new URL(primaryLink.href, window.location.origin);
    return normalizeText(url.pathname) || null;
  } catch {
    return normalizeText(primaryLink.getAttribute("href")) || null;
  }
}

function getWashingtonPostDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    WASHINGTON_POST_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isWashingtonPostArticlePage()) {
    return {
      itemSelector: "main h1, article h1, h1",
      containerSelector,
    };
  }

  const scopedSelectors = WASHINGTON_POST_ITEM_ROOT_SELECTORS.map(
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

function findWashingtonPostInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (postElement.matches("h1")) {
    const articleScope = getWashingtonPostStoryScope(postElement);
    const summaryBlock =
      getWashingtonPostSummaryBlock(articleScope, postElement) || postElement;
    const container = summaryBlock.parentElement || articleScope;

    return {
      container,
      referenceElement: summaryBlock,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  const scope = getWashingtonPostStoryScope(postElement);
  const titleBlock = getWashingtonPostTitleBlock(postElement);
  const summaryBlock = getWashingtonPostSummaryBlock(scope, titleBlock);
  const referenceElement = summaryBlock || titleBlock;
  const container = referenceElement.parentElement || scope.parentElement;

  if (!container) {
    return null;
  }

  return {
    container,
    referenceElement,
    insertPosition: "after",
    postWrapper: scope,
  };
}

function hasWashingtonPostInjectedCard(postElement: Element): boolean {
  if (postElement.matches("h1")) {
    const articleScope = getWashingtonPostStoryScope(postElement);
    const summaryBlock =
      getWashingtonPostSummaryBlock(articleScope, postElement) || postElement;
    return hasInjectedCardSibling(summaryBlock);
  }

  const scope = getWashingtonPostStoryScope(postElement);
  const titleBlock = getWashingtonPostTitleBlock(postElement);
  const summaryBlock = getWashingtonPostSummaryBlock(scope, titleBlock);
  return (
    hasInjectedCardSibling(summaryBlock || titleBlock) ||
    !!scope.querySelector(".knoww-market-card")
  );
}

function getWashingtonPostWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const WashingtonPostAdapter = createBasicAdapter({
  name: "washington-post",
  hostPatterns: [WASHINGTON_POST_HOST_RE],
  bypassEnglishCheck: true,
  itemSelectors: [...WASHINGTON_POST_ITEM_ROOT_SELECTORS],
  containerSelectors: [...WASHINGTON_POST_CONTAINER_SELECTORS],
  textSelectors: [
    ...WASHINGTON_POST_TITLE_SELECTORS,
    ...WASHINGTON_POST_SUMMARY_SELECTORS,
  ],
  accentColor: "#2563eb",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText: extractWashingtonPostPostText,
  getPostId: getWashingtonPostPostId,
  findInjectionPoint: findWashingtonPostInjectionPoint,
  getDynamicSelectors: getWashingtonPostDynamicSelectors,
  getWrapperStyles: getWashingtonPostWrapperStyles,
  hasInjectedCard: hasWashingtonPostInjectedCard,
});

export const adapter: PlatformAdapter = WashingtonPostAdapter;

export { WashingtonPostAdapter };
