import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
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
  stripMediaFromClone,
  stripTrailingBylineFragment,
} from "./story-adapter-helpers";

const YAHOO_FINANCE_HOST_RE = /^(?:finance\.)?yahoo\.com$/i;
const YAHOO_FINANCE_CONTAINER_SELECTORS = [
  "#nimbus-app",
  "#svelte",
  "main",
  '[role="main"]',
  "body",
] as const;

const YAHOO_FINANCE_PRIMARY_LINK_SELECTORS = [
  'a.subtle-link.titles[href*=".html"]',
  'a[data-ylk*="ct:story"][href*=".html"]',
  'a[href*="/news/"][href*=".html"]',
  'a[href*="/video/"][href*=".html"]',
  'a[href*="/articles/"][href*=".html"]',
  'a[href*="/markets/"][href*=".html"]',
  'a[href*="/economy/"][href*=".html"]',
  'a[href*="/sectors/"][href*=".html"]',
  'a[href*="/personal-finance/"][href*=".html"]',
] as const;

const YAHOO_FINANCE_ITEM_ROOT_SELECTORS = [
  "section[data-testid='storyitem']",
  "li.stream-item.story-item",
  `section[role="article"]:has(${YAHOO_FINANCE_PRIMARY_LINK_SELECTORS[0]})`,
  `section[role="article"]:has(${YAHOO_FINANCE_PRIMARY_LINK_SELECTORS[1]})`,
] as const;

const YAHOO_FINANCE_TITLE_SELECTORS = [
  "a.subtle-link.titles h1",
  "a.subtle-link.titles h2",
  "a.subtle-link.titles h3",
  "a.subtle-link.titles h4",
  '[data-testid="storyitem"] h1',
  '[data-testid="storyitem"] h2',
  '[data-testid="storyitem"] h3',
  '[data-testid="storyitem"] h4',
  "h1",
  "h2",
  "h3",
  "h4",
  ...YAHOO_FINANCE_PRIMARY_LINK_SELECTORS,
] as const;

const YAHOO_FINANCE_SUMMARY_SELECTORS = [
  '[data-testid="storyitem"] [class*="summary"]',
  '[data-testid="storyitem"] [class*="description"]',
  '[data-testid="storyitem"] p',
  '[class*="summary"]',
  '[class*="description"]',
  "p",
] as const;

function countYahooFinanceStoryLinks(scope: ParentNode): number {
  if (
    !("querySelectorAll" in scope) ||
    typeof scope.querySelectorAll !== "function"
  ) {
    return 0;
  }

  return scope.querySelectorAll(YAHOO_FINANCE_PRIMARY_LINK_SELECTORS.join(", "))
    .length;
}

function getYahooFinanceStoryScope(postElement: Element): Element {
  if (postElement.matches("h1")) {
    return postElement;
  }

  return (
    postElement.closest("section[data-testid='storyitem']") ||
    postElement.closest("li.stream-item.story-item") ||
    postElement
  );
}

function isYahooFinanceModuleContainer(element: Element): boolean {
  const styles = window.getComputedStyle(element);
  const display = styles.display.toLowerCase();
  const isGrid = display.includes("grid");
  const isRowFlex =
    display.includes("flex") && styles.flexDirection !== "column";
  const storyItemCount = element.querySelectorAll(
    "section[data-testid='storyitem'], li.stream-item.story-item"
  ).length;

  return isGrid || isRowFlex || storyItemCount > 1;
}

function getYahooFinanceModuleScope(postElement: Element): Element | null {
  const scope = getYahooFinanceStoryScope(postElement);
  let fallback: Element | null = null;
  let current: Element | null = scope.parentElement;
  let depth = 0;

  while (current && !current.matches("main, body, html") && depth < 6) {
    const storyLinkCount = countYahooFinanceStoryLinks(current);
    if (storyLinkCount > 1 && storyLinkCount <= 10) {
      fallback = current;
      if (isYahooFinanceModuleContainer(current)) {
        return current;
      }
    }

    current = current.parentElement;
    depth += 1;
  }

  return fallback;
}

function getYahooFinancePrimaryStoryLink(
  postElement: Element
): HTMLAnchorElement | null {
  const scope = getYahooFinanceStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    YAHOO_FINANCE_PRIMARY_LINK_SELECTORS
  );
}

function extractYahooFinancePostText(postElement: Element): string {
  if (postElement.matches("h1")) {
    const title = normalizeText(postElement.textContent);
    const summary = getDocumentDescription();
    const articleText = combineTextParts([title, summary]);
    if (articleText) {
      return articleText;
    }
  }

  const scope = getYahooFinanceStoryScope(postElement);
  const title = getFirstMatchingText(scope, YAHOO_FINANCE_TITLE_SELECTORS);
  const summary = stripTrailingBylineFragment(
    getFirstMatchingText(scope, YAHOO_FINANCE_SUMMARY_SELECTORS)
  );
  const structuredText = combineTextParts([title, summary]);
  if (structuredText) {
    return structuredText;
  }

  const primaryLink = getYahooFinancePrimaryStoryLink(scope);
  if (primaryLink) {
    const cleaned = normalizeText(stripMediaFromClone(primaryLink).textContent);
    if (cleaned.length >= 20) {
      return cleaned;
    }
  }

  return combineTextParts([
    ...collectTextParts(scope, [...YAHOO_FINANCE_TITLE_SELECTORS]),
    ...collectTextParts(scope, [...YAHOO_FINANCE_SUMMARY_SELECTORS]),
  ]);
}

function getYahooFinancePostId(postElement: Element): string | null {
  const primaryLink = getYahooFinancePrimaryStoryLink(postElement);
  const href = primaryLink?.getAttribute("href") || primaryLink?.href || "";
  const match = href.match(GENERIC_LINK_PATTERN);
  if (match?.[1]) {
    return match[1];
  }

  if (/\.html$/i.test(window.location.pathname)) {
    return window.location.pathname;
  }

  return null;
}

function getYahooFinanceDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    YAHOO_FINANCE_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (
    /\.html$/i.test(window.location.pathname) &&
    document.querySelector("h1")
  ) {
    return {
      itemSelector: "h1",
      containerSelector,
    };
  }

  const scopedSelectors = YAHOO_FINANCE_ITEM_ROOT_SELECTORS.map(
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

function findYahooFinanceInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (postElement.matches("h1")) {
    return findInjectionAfterSelectors(postElement, ["p", "h1"]);
  }

  const moduleScope = getYahooFinanceModuleScope(postElement);
  if (moduleScope?.parentElement) {
    return {
      container: moduleScope.parentElement,
      referenceElement: moduleScope,
      insertPosition: "after",
      postWrapper: moduleScope,
    };
  }

  const row =
    postElement.closest("li.stream-item.story-item") ??
    (postElement.matches("li.stream-item.story-item") ? postElement : null);
  if (row?.parentElement) {
    return {
      container: row.parentElement,
      referenceElement: row,
      insertPosition: "after",
      postWrapper: row,
    };
  }

  const scope = getYahooFinanceStoryScope(postElement);
  const reference = getYahooFinancePrimaryStoryLink(scope);
  if (reference?.parentElement) {
    return {
      container: reference.parentElement,
      referenceElement: reference,
      insertPosition: "after",
      postWrapper: scope,
    };
  }

  return findInjectionAfterSelectors(scope, [
    ...YAHOO_FINANCE_PRIMARY_LINK_SELECTORS,
    "h1",
    "h2",
    "h3",
    "h4",
    "p",
  ]);
}

function hasYahooFinanceInjectedCard(postElement: Element): boolean {
  if (postElement.matches("h1")) {
    return hasInjectedCardSibling(postElement);
  }

  const moduleScope = getYahooFinanceModuleScope(postElement);
  if (moduleScope && hasInjectedCardSibling(moduleScope)) {
    return true;
  }

  const row =
    postElement.closest("li.stream-item.story-item") ??
    (postElement.matches("li.stream-item.story-item") ? postElement : null);
  const target = row ?? getYahooFinanceStoryScope(postElement);
  return hasInjectedCardSibling(target);
}

function getYahooFinanceWrapperStyles(): string {
  return getFullWidthCardWrapperStyles({ listStyleNone: true });
}

const YahooFinanceAdapter = createBasicAdapter({
  name: "yahoo-finance",
  hostPatterns: [YAHOO_FINANCE_HOST_RE],
  bypassEnglishCheck: true,
  itemSelectors: [...YAHOO_FINANCE_ITEM_ROOT_SELECTORS],
  containerSelectors: [...YAHOO_FINANCE_CONTAINER_SELECTORS],
  textSelectors: [
    ...YAHOO_FINANCE_TITLE_SELECTORS,
    ...YAHOO_FINANCE_SUMMARY_SELECTORS,
  ],
  accentColor: "#2563eb",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText: extractYahooFinancePostText,
  getPostId: getYahooFinancePostId,
  findInjectionPoint: findYahooFinanceInjectionPoint,
  getDynamicSelectors: getYahooFinanceDynamicSelectors,
  getWrapperStyles: getYahooFinanceWrapperStyles,
  hasInjectedCard: hasYahooFinanceInjectedCard,
});

registerAdapterWithRetry(YahooFinanceAdapter, 100, 50);

export { YahooFinanceAdapter };
