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

const WSJ_HOST_RE = /^(?:www\.)?wsj\.com$/i;

const WSJ_CONTAINER_SELECTORS = ["main", '[role="main"]', "body"] as const;

const WSJ_PRIMARY_LINK_SELECTORS = [
  'a[data-testid="flexcard-headline"][href*="wsj.com/"]',
  'a[data-testid="flexcard-headline"][href^="/"]',
] as const;

const WSJ_ITEM_ROOT_SELECTORS = [
  '[data-parsely-slot] a[data-testid="flexcard-headline"]',
  '[class*="CardWrapper"] a[data-testid="flexcard-headline"]',
  'a[data-testid="flexcard-headline"]',
  "main h1",
  "article h1",
] as const;

const WSJ_TITLE_SELECTORS = [
  'a[data-testid="flexcard-headline"] [class*="HeadlineTextBlock"]',
  'a[data-testid="flexcard-headline"]',
  'h1[class*="StyledHeadline"]',
  "h1",
] as const;

const WSJ_SUMMARY_SELECTORS = [
  'p[data-testid="flexcard-text"]',
  'h2[class*="NormalDek"]',
  "main h2",
  "article h2",
] as const;

function isWsjArticlePage(): boolean {
  return (
    window.location.pathname !== "/" &&
    !!document.querySelector("main h1, article h1, h1")
  );
}

function getWsjStoryScope(postElement: Element): Element {
  if (postElement.matches("h1")) {
    return (
      postElement.closest("main article, article, main") ||
      postElement.parentElement ||
      postElement
    );
  }

  return (
    postElement.closest('[class*="StyledStack"]') ||
    postElement.closest('[class*="CardLayoutItem"]') ||
    postElement.closest("[data-parsely-slot]") ||
    postElement.closest('[class*="CardWrapper"]') ||
    postElement.closest("article, li, section") ||
    postElement.parentElement ||
    postElement
  );
}

function getWsjPrimaryLink(postElement: Element): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getWsjStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    WSJ_PRIMARY_LINK_SELECTORS
  );
}

function getWsjTitleBlock(postElement: Element): Element {
  return (
    postElement.closest("h1, h2, h3, h4, h5, h6") ||
    postElement.closest("a") ||
    postElement
  );
}

function getWsjSummaryBlock(scope: Element): Element | null {
  const summary = scope.querySelector('p[data-testid="flexcard-text"]');
  if (!summary) {
    return null;
  }

  return summary.closest("a")?.parentElement || summary.closest("p");
}

function extractWsjPostText(postElement: Element): string {
  if (postElement.matches("h1")) {
    const title = normalizeText(postElement.textContent);
    const summary =
      getFirstMatchingText(document, WSJ_SUMMARY_SELECTORS) ||
      getDocumentDescription();
    return combineTextParts([title, summary]);
  }

  const scope = getWsjStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, WSJ_TITLE_SELECTORS) ||
    normalizeText(getWsjPrimaryLink(postElement)?.textContent);
  const summary = getFirstMatchingText(scope, WSJ_SUMMARY_SELECTORS);

  return combineTextParts([title, summary]);
}

function getWsjPostId(postElement: Element): string | null {
  if (postElement.matches("h1") && window.location.pathname !== "/") {
    return window.location.pathname;
  }

  const primaryLink = getWsjPrimaryLink(postElement);
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

function getWsjDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    WSJ_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isWsjArticlePage()) {
    return {
      itemSelector: "main h1, article h1, h1",
      containerSelector,
    };
  }

  const scopedSelectors = [
    `${containerSelector} [data-parsely-slot] a[data-testid="flexcard-headline"]`,
    `${containerSelector} [class*="CardWrapper"] a[data-testid="flexcard-headline"]`,
    `${containerSelector} a[data-testid="flexcard-headline"]`,
  ];
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

function findWsjInjectionPoint(postElement: Element): InjectionPoint | null {
  if (postElement.matches("h1")) {
    const articleScope = getWsjStoryScope(postElement);
    const summaryBlock =
      document.querySelector('h2[class*="NormalDek"]') ||
      articleScope.querySelector("h2");
    const referenceElement = summaryBlock || postElement;
    const container = referenceElement.parentElement || articleScope;

    return {
      container,
      referenceElement,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  const scope = getWsjStoryScope(postElement);
  const summaryBlock = getWsjSummaryBlock(scope);
  if (summaryBlock?.parentElement) {
    return {
      container: summaryBlock.parentElement,
      referenceElement: summaryBlock,
      insertPosition: "after",
      postWrapper: scope,
    };
  }

  const titleBlock = getWsjTitleBlock(postElement);
  if (titleBlock.parentElement) {
    return {
      container: titleBlock.parentElement,
      referenceElement: titleBlock,
      insertPosition: "after",
      postWrapper: scope,
    };
  }

  if (scope.parentElement) {
    return {
      container: scope.parentElement,
      referenceElement: scope,
      insertPosition: "after",
      postWrapper: scope,
    };
  }

  return null;
}

function hasWsjInjectedCard(postElement: Element): boolean {
  if (postElement.matches("h1")) {
    const summaryBlock =
      document.querySelector('h2[class*="NormalDek"]') ||
      getWsjStoryScope(postElement).querySelector("h2");
    return hasInjectedCardSibling(summaryBlock || postElement);
  }

  const scope = getWsjStoryScope(postElement);
  const referenceElement =
    getWsjSummaryBlock(scope) || getWsjTitleBlock(postElement);
  return (
    hasInjectedCardSibling(referenceElement) ||
    !!scope.querySelector(".knoww-market-card")
  );
}

function getWsjWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const WsjAdapter = createBasicAdapter({
  name: "wsj",
  hostPatterns: [WSJ_HOST_RE],
  bypassEnglishCheck: true,
  itemSelectors: [...WSJ_ITEM_ROOT_SELECTORS],
  containerSelectors: [...WSJ_CONTAINER_SELECTORS],
  textSelectors: [...WSJ_TITLE_SELECTORS, ...WSJ_SUMMARY_SELECTORS],
  accentColor: "#1d4ed8",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText: extractWsjPostText,
  getPostId: getWsjPostId,
  findInjectionPoint: findWsjInjectionPoint,
  getDynamicSelectors: getWsjDynamicSelectors,
  getWrapperStyles: getWsjWrapperStyles,
  hasInjectedCard: hasWsjInjectedCard,
});

export const adapter: PlatformAdapter = WsjAdapter;

export { WsjAdapter };
