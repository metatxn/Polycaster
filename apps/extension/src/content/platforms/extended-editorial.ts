import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  extractFinanceEditorialPostText,
  FINANCE_EDITORIAL_HOST_PATTERNS,
  findFinanceEditorialInjectionPoint,
  getFinanceEditorialDynamicSelectors,
  getFinanceEditorialPostId,
  getFinanceEditorialWrapperStyles,
  hasFinanceEditorialInjectedCard,
} from "./extended-editorial/finance-sites";
import {
  extractNewsEditorialPostText,
  findNewsEditorialInjectionPoint,
  getNewsEditorialDynamicSelectors,
  getNewsEditorialPostId,
  hasNewsEditorialInjectedCard,
  NEWS_EDITORIAL_HOST_PATTERNS,
} from "./extended-editorial/news-sites";
import {
  BASE_EDITORIAL_CONTAINER_SELECTORS,
  BASE_EDITORIAL_ITEM_SELECTORS,
  BASE_EDITORIAL_REFERENCE_SELECTORS,
  BASE_EDITORIAL_TEXT_SELECTORS,
  extractGenericEditorialPostText,
  GENERIC_EDITORIAL_HOST_PATTERNS,
} from "./extended-editorial/shared";
import {
  extractTechEditorialPostText,
  findTechEditorialInjectionPoint,
  getTechEditorialDynamicSelectors,
  getTechEditorialPostId,
  getTechEditorialWrapperStyles,
  hasTechEditorialInjectedCard,
  TECH_EDITORIAL_HOST_PATTERNS,
} from "./extended-editorial/tech-sites";
import {
  buildDynamicSelectors,
  extractPostIdFromAttributes,
  extractPostIdFromLink,
  findInjectionAfterSelectors,
  GENERIC_LINK_PATTERN,
} from "./helpers";

const EDITORIAL_HOST_PATTERNS = [
  ...GENERIC_EDITORIAL_HOST_PATTERNS,
  ...TECH_EDITORIAL_HOST_PATTERNS,
  ...NEWS_EDITORIAL_HOST_PATTERNS,
  ...FINANCE_EDITORIAL_HOST_PATTERNS,
];

function getEditorialPostId(postElement: Element): string | null {
  const techPostId = getTechEditorialPostId(postElement);
  if (techPostId) {
    return techPostId;
  }

  const newsPostId = getNewsEditorialPostId(postElement);
  if (newsPostId) {
    return newsPostId;
  }

  const financePostId = getFinanceEditorialPostId(postElement);
  if (financePostId) {
    return financePostId;
  }

  return (
    extractPostIdFromAttributes(postElement, [
      "data-id",
      "data-post-id",
      "data-article-id",
      "data-story-id",
      "data-content-id",
      "data-testid",
      "id",
    ]) ||
    extractPostIdFromLink(postElement, GENERIC_LINK_PATTERN) ||
    (window.location.pathname !== "/" &&
    (postElement.matches("h1") || postElement.querySelector("h1"))
      ? window.location.pathname
      : null)
  );
}

function extractEditorialPostText(postElement: Element): string {
  const techText = extractTechEditorialPostText(postElement);
  if (techText) {
    return techText;
  }

  const newsText = extractNewsEditorialPostText(postElement);
  if (newsText) {
    return newsText;
  }

  const financeText = extractFinanceEditorialPostText(postElement);
  if (financeText) {
    return financeText;
  }

  return extractGenericEditorialPostText(postElement);
}

function getEditorialDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  return (
    getTechEditorialDynamicSelectors() ||
    getNewsEditorialDynamicSelectors() ||
    getFinanceEditorialDynamicSelectors() ||
    buildDynamicSelectors(BASE_EDITORIAL_ITEM_SELECTORS.join(", "), [
      ...BASE_EDITORIAL_CONTAINER_SELECTORS,
    ])
  );
}

function findEditorialInjectionPoint(postElement: Element) {
  return (
    findTechEditorialInjectionPoint(postElement) ||
    findNewsEditorialInjectionPoint(postElement) ||
    findFinanceEditorialInjectionPoint(postElement) ||
    findInjectionAfterSelectors(postElement, [
      ...BASE_EDITORIAL_REFERENCE_SELECTORS,
    ])
  );
}

function hasEditorialInjectedCard(postElement: Element): boolean {
  const techResult = hasTechEditorialInjectedCard(postElement);
  if (techResult !== null) {
    return techResult;
  }

  const newsResult = hasNewsEditorialInjectedCard(postElement);
  if (newsResult !== null) {
    return newsResult;
  }

  const financeResult = hasFinanceEditorialInjectedCard(postElement);
  if (financeResult !== null) {
    return financeResult;
  }

  return !!postElement.querySelector(".knoww-market-card");
}

function getEditorialWrapperStyles(): string {
  return (
    getTechEditorialWrapperStyles() ||
    getFinanceEditorialWrapperStyles() ||
    `
      padding: 12px 0 0 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `
  );
}

const ExtendedEditorialAdapter = createBasicAdapter({
  name: "extended-editorial",
  hostPatterns: EDITORIAL_HOST_PATTERNS,
  bypassEnglishCheck: true,
  itemSelectors: [...BASE_EDITORIAL_ITEM_SELECTORS],
  containerSelectors: [...BASE_EDITORIAL_CONTAINER_SELECTORS],
  textSelectors: [...BASE_EDITORIAL_TEXT_SELECTORS],
  referenceSelectors: [...BASE_EDITORIAL_REFERENCE_SELECTORS],
  accentColor: "#2563eb",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  getPostId: getEditorialPostId,
  extractPostText: extractEditorialPostText,
  findInjectionPoint: findEditorialInjectionPoint,
  getDynamicSelectors: getEditorialDynamicSelectors,
  getWrapperStyles: getEditorialWrapperStyles,
  hasInjectedCard: hasEditorialInjectedCard,
});

registerAdapterWithRetry(ExtendedEditorialAdapter, 100, 50);

export { ExtendedEditorialAdapter };
