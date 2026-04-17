import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  combineTextParts,
  findInjectionAfterSelectors,
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

const DLNEWS_HOST_RE = /^(?:www\.)?dlnews\.com$/i;
const DLNEWS_CONTAINER_SELECTORS = [
  "main",
  '[role="main"]',
  "#__next",
  "body",
] as const;

const DLNEWS_PRIMARY_HEADLINE_LINK_SELECTORS = [
  'a.story-headline-hover[href*="/articles/"]',
  'a.story-headline-hover[href*="/external/"]',
  'a.story-headline-hover[href*="/research/"]',
] as const;

const DLNEWS_MEDIA_LINK_SELECTORS = [
  'a.article-preview-image[href*="/articles/"]',
  'a.article-preview-image[href*="/external/"]',
  'a.article-preview-image[href*="/research/"]',
  'a.story-image-hover[href*="/articles/"]',
  'a.story-image-hover[href*="/external/"]',
  'a.story-image-hover[href*="/research/"]',
] as const;

const DLNEWS_PRIMARY_FALLBACK_LINK_SELECTORS = [
  'a[href*="/articles/"]',
  'a[href*="/external/"]',
  'a[href*="/research/"]',
] as const;

const DLNEWS_PRIMARY_LINK_SELECTORS = [
  ...DLNEWS_PRIMARY_HEADLINE_LINK_SELECTORS,
  ...DLNEWS_MEDIA_LINK_SELECTORS,
  ...DLNEWS_PRIMARY_FALLBACK_LINK_SELECTORS,
] as const;

const DLNEWS_ITEM_ROOT_SELECTORS = [
  ...DLNEWS_PRIMARY_HEADLINE_LINK_SELECTORS,
  ...DLNEWS_PRIMARY_FALLBACK_LINK_SELECTORS,
].map((selector) => `.story-container:has(${selector})`) as string[];

const DLNEWS_TITLE_SELECTORS = [
  "a.story-headline-hover",
  "h1",
  "h2",
  "h3",
  "h4",
] as const;

function getDlNewsStoryScope(postElement: Element): Element {
  if (postElement.matches("h1")) {
    return postElement;
  }

  return postElement.closest(".story-container") || postElement;
}

function getDlNewsPrimaryLink(postElement: Element): HTMLAnchorElement | null {
  const scope = getDlNewsStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    DLNEWS_PRIMARY_LINK_SELECTORS
  );
}

function getDlNewsSummaryText(scope: ParentNode): string {
  if (
    !("querySelectorAll" in scope) ||
    typeof scope.querySelectorAll !== "function"
  ) {
    return "";
  }

  for (const paragraph of Array.from(scope.querySelectorAll("p"))) {
    const text = normalizeText(paragraph.textContent);
    if (!text || text.length < 30) {
      continue;
    }

    return text;
  }

  return "";
}

function extractDlNewsPostText(postElement: Element): string {
  if (postElement.matches("h1")) {
    const title = normalizeText(postElement.textContent);
    const summary = getDocumentDescription();
    const articleText = combineTextParts([title, summary]);
    if (articleText) {
      return articleText;
    }
  }

  const scope = getDlNewsStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, DLNEWS_TITLE_SELECTORS) ||
    normalizeText(getDlNewsPrimaryLink(scope)?.textContent);
  const summary = getDlNewsSummaryText(scope);
  const focusedText = combineTextParts([title, summary]);
  if (focusedText) {
    return focusedText;
  }

  return combineTextParts([title]);
}

function getDlNewsPostId(postElement: Element): string | null {
  const primaryLink = getDlNewsPrimaryLink(postElement);
  const href = primaryLink?.getAttribute("href") || primaryLink?.href || "";
  const match = href.match(GENERIC_LINK_PATTERN);
  if (match?.[1]) {
    return match[1];
  }

  if (postElement.matches("h1") && window.location.pathname !== "/") {
    return window.location.pathname;
  }

  return null;
}

function getDlNewsDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    DLNEWS_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (document.querySelector("main h1")) {
    return {
      itemSelector: "main h1",
      containerSelector,
    };
  }

  const scopedSelectors = DLNEWS_ITEM_ROOT_SELECTORS.map(
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

function findDlNewsInjectionPoint(postElement: Element): InjectionPoint | null {
  if (postElement.matches("h1")) {
    const summary = postElement.parentElement?.querySelector("p");
    if (summary?.parentElement) {
      return {
        container: summary.parentElement,
        referenceElement: summary,
        insertPosition: "after",
        postWrapper: postElement.closest("article") || postElement,
      };
    }

    return findInjectionAfterSelectors(postElement, ["h1"]);
  }

  const scope = getDlNewsStoryScope(postElement);
  if (scope.parentElement) {
    return {
      container: scope.parentElement,
      referenceElement: scope,
      insertPosition: "after",
      postWrapper: scope,
    };
  }

  return findInjectionAfterSelectors(scope, [
    ...DLNEWS_TITLE_SELECTORS,
    ...DLNEWS_PRIMARY_LINK_SELECTORS,
  ]);
}

function hasDlNewsInjectedCard(postElement: Element): boolean {
  if (postElement.matches("h1")) {
    const articleRoot = postElement.closest("article") || postElement;
    return hasInjectedCardSibling(articleRoot);
  }

  const scope = getDlNewsStoryScope(postElement);
  return hasInjectedCardSibling(scope);
}

function getDlNewsWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const DlNewsAdapter = createBasicAdapter({
  name: "dlnews",
  hostPatterns: [DLNEWS_HOST_RE],
  bypassEnglishCheck: true,
  itemSelectors: [...DLNEWS_ITEM_ROOT_SELECTORS],
  containerSelectors: [...DLNEWS_CONTAINER_SELECTORS],
  textSelectors: [...DLNEWS_TITLE_SELECTORS],
  accentColor: "#2563eb",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText: extractDlNewsPostText,
  getPostId: getDlNewsPostId,
  findInjectionPoint: findDlNewsInjectionPoint,
  getDynamicSelectors: getDlNewsDynamicSelectors,
  getWrapperStyles: getDlNewsWrapperStyles,
  hasInjectedCard: hasDlNewsInjectedCard,
});

registerAdapterWithRetry(DlNewsAdapter, 100, 50);

export { DlNewsAdapter };
