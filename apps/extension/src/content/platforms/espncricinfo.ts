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

const ESPNCRICINFO_HOST_RE = /^(?:www\.)?espncricinfo\.com$/i;
const ESPNCRICINFO_ID_PATTERN =
  /-(\d{6,})(?:\/(?:match-preview|match-report(?:-\d+)?|live-match-blog|live-cricket-score|full-scorecard))?\/?(?:[?#]|$)/i;
const ESPNCRICINFO_MATCH_URL_PATTERN =
  /\/series\/[^/]+\/([^/?#]+)\/(?:live-cricket-score|full-scorecard)\/?(?:[?#]|$)/i;
const ESPNCRICINFO_MATCH_DESCRIPTOR_PATTERN =
  /-\d+(?:st|nd|rd|th)-(?:match|test|odi|t20i|t20)$/i;
const ESPNCRICINFO_SCORE_MARKET_WRAPPER_CLASS =
  "knoww-espncricinfo-score-market-wrapper";
const ESPNCRICINFO_SCORE_MARKET_GRID_CLASS =
  "knoww-espncricinfo-score-market-grid";

const ESPNCRICINFO_CONTAINER_SELECTORS = [
  "#__next",
  "article.ci-story",
  "body",
] as const;

const ESPNCRICINFO_PRIMARY_LINK_SELECTORS = [
  "a[href*='/story/']",
  "a[href*='/series/'][href*='/match-preview']",
  "a[href*='/series/'][href*='/match-report']",
  "a[href*='/live-match-blog']",
  "a[href*='/series/'][href*='/live-cricket-score']",
  "a[href*='/series/'][href*='/full-scorecard']",
  "a[href]",
] as const;

const ESPNCRICINFO_FEED_ITEM_ROOT_SELECTORS = [
  "a[href*='/story/']:has(h1, h2, h3, h4, h5, h6)",
  "a[href*='/series/'][href*='/match-preview']:has(h1, h2, h3, h4, h5, h6)",
  "a[href*='/series/'][href*='/match-report']:has(h1, h2, h3, h4, h5, h6)",
  "a[href*='/live-match-blog']:has(h1, h2, h3, h4, h5, h6)",
  "div.ds-border-b.ds-border-line.ds-p-4 > a[href*='/story/']",
  "div.ds-border-b.ds-border-line.ds-p-4 > a[href*='/series/'][href*='/match-preview']",
  "div.ds-border-b.ds-border-line.ds-p-4 > a[href*='/series/'][href*='/match-report']",
  "div.ds-border-b.ds-border-line.ds-p-4 > a[href*='/live-match-blog']",
  "div.ds-px-4.ds-py-2 > a[href*='/story/']",
  "div.ds-px-4.ds-py-2 > a[href*='/series/'][href*='/match-preview']",
  "div.ds-px-4.ds-py-2 > a[href*='/series/'][href*='/match-report']",
  "div.ds-px-4.ds-py-2 > a[href*='/live-match-blog']",
  "div.ds-px-4.ds-py-3 > a[href*='/series/'][href*='/live-cricket-score']",
  "div.ds-px-4.ds-py-3 > a[href*='/series/'][href*='/full-scorecard']",
  "div[class~='ds-w-[264px]'] > a[href*='/series/'][href*='/live-cricket-score']",
  "div[class~='ds-w-[264px]'] > a[href*='/series/'][href*='/full-scorecard']",
] as const;

const ESPNCRICINFO_ARTICLE_ITEM_ROOT_SELECTORS = [
  "article.ci-story h1",
  "article h1.ds-text-title-xl",
] as const;

const ESPNCRICINFO_TITLE_SELECTORS = [
  "h1.ds-text-title-xl",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
] as const;

const ESPNCRICINFO_DESCRIPTION_SELECTORS = [
  "header p",
  "article.ci-story header p",
  "article.ci-story p",
  "p",
] as const;

function isESPNcricinfoArticleRoot(postElement: Element): boolean {
  return postElement.matches(
    ESPNCRICINFO_ARTICLE_ITEM_ROOT_SELECTORS.join(", ")
  );
}

function isESPNcricinfoArticlePage(): boolean {
  return !!document.querySelector(
    ESPNCRICINFO_ARTICLE_ITEM_ROOT_SELECTORS.join(", ")
  );
}

function getESPNcricinfoArticleScope(postElement: Element): Element {
  return (
    postElement.closest("article.ci-story") ||
    postElement.closest("article") ||
    postElement.parentElement ||
    postElement
  );
}

function getESPNcricinfoCompactFeedRow(postElement: Element): Element | null {
  const row = postElement.closest("div.ds-px-4.ds-py-2");
  if (!row?.parentElement?.matches("div.ds-flex.ds-flex-col")) {
    return null;
  }

  return row;
}

function getESPNcricinfoScoreCarouselTarget(postElement: Element): {
  container: Element;
  referenceElement: Element | null;
  postWrapper: Element;
  insertPosition: "append";
} | null {
  const postWrapper = postElement.closest("div[class~='ds-w-[264px]']");
  if (!postWrapper?.closest(".slick-slide")) {
    return null;
  }

  const carousel = postWrapper.closest(".ci-v2-hsb-carousel");
  if (!carousel?.parentElement) {
    return null;
  }

  let grid = carousel.nextElementSibling;
  if (!grid?.classList.contains(ESPNCRICINFO_SCORE_MARKET_GRID_CLASS)) {
    grid = document.createElement("div");
    grid.className = ESPNCRICINFO_SCORE_MARKET_GRID_CLASS;
    carousel.parentElement.insertBefore(grid, carousel.nextElementSibling);
  }

  return {
    container: grid,
    referenceElement: null,
    postWrapper,
    insertPosition: "append",
  };
}

function getESPNcricinfoStoryScope(postElement: Element): Element {
  if (isESPNcricinfoArticleRoot(postElement)) {
    return getESPNcricinfoArticleScope(postElement);
  }

  const compactRow = getESPNcricinfoCompactFeedRow(postElement);
  if (compactRow) {
    return compactRow;
  }

  return (
    postElement.closest("td") ||
    postElement.closest("li") ||
    postElement.closest("[class*='ds-flex-row']") ||
    postElement.closest("[class*='ds-flex-col']") ||
    postElement.parentElement ||
    postElement
  );
}

function getESPNcricinfoPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getESPNcricinfoStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    ESPNCRICINFO_PRIMARY_LINK_SELECTORS
  );
}

function formatESPNcricinfoSlugName(slugPart: string): string {
  return slugPart
    .split("-")
    .filter(Boolean)
    .map((part) =>
      /^\d/.test(part)
        ? part.toUpperCase()
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    )
    .join(" ");
}

function extractESPNcricinfoMatchTitleFromUrl(href: string): string {
  const match = href.match(ESPNCRICINFO_MATCH_URL_PATTERN);
  const matchSlug = match?.[1];
  if (!matchSlug?.includes("-vs-")) {
    return "";
  }

  const [teamOneSlug, teamTwoAndDescriptorSlug] = matchSlug.split("-vs-", 2);
  const teamTwoSlug = teamTwoAndDescriptorSlug
    .replace(/-\d{6,}$/, "")
    .replace(ESPNCRICINFO_MATCH_DESCRIPTOR_PATTERN, "");

  const teamOne = formatESPNcricinfoSlugName(teamOneSlug);
  const teamTwo = formatESPNcricinfoSlugName(teamTwoSlug);
  return teamOne && teamTwo ? `${teamOne} vs ${teamTwo}` : "";
}

function getESPNcricinfoMatchTitle(postElement: Element): string {
  const href = getESPNcricinfoPrimaryLink(postElement)?.getAttribute("href");
  if (!href) {
    return "";
  }

  try {
    return extractESPNcricinfoMatchTitleFromUrl(
      new URL(href, window.location.origin).pathname
    );
  } catch {
    return extractESPNcricinfoMatchTitleFromUrl(href);
  }
}

function extractESPNcricinfoFeedText(postElement: Element): string {
  const scope = getESPNcricinfoStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, ESPNCRICINFO_TITLE_SELECTORS) ||
    normalizeText(getESPNcricinfoPrimaryLink(postElement)?.textContent);
  const matchTitle = getESPNcricinfoMatchTitle(postElement);

  return combineTextParts([matchTitle, title], 8);
}

function extractESPNcricinfoPostText(postElement: Element): string {
  if (isESPNcricinfoArticleRoot(postElement)) {
    const scope = getESPNcricinfoArticleScope(postElement);
    const title =
      getFirstMatchingText(scope, ESPNCRICINFO_TITLE_SELECTORS) ||
      normalizeText(postElement.textContent);
    const summary =
      getFirstMatchingText(scope, ESPNCRICINFO_DESCRIPTION_SELECTORS) ||
      getDocumentDescription();

    return combineTextParts([title, summary], 8);
  }

  return extractESPNcricinfoFeedText(postElement);
}

function getESPNcricinfoPostId(postElement: Element): string | null {
  const href =
    (isESPNcricinfoArticleRoot(postElement) ? window.location.pathname : "") ||
    getESPNcricinfoPrimaryLink(postElement)?.getAttribute("href") ||
    "";

  const directMatch = href.match(ESPNCRICINFO_ID_PATTERN);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  try {
    const url = new URL(href, window.location.origin);
    const pathnameMatch = url.pathname.match(ESPNCRICINFO_ID_PATTERN);
    return pathnameMatch?.[1] || normalizeText(url.pathname) || null;
  } catch {
    return normalizeText(href) || null;
  }
}

function getESPNcricinfoDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    ESPNCRICINFO_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isESPNcricinfoArticlePage()) {
    return {
      itemSelector: ESPNCRICINFO_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = ESPNCRICINFO_FEED_ITEM_ROOT_SELECTORS.map(
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

function findESPNcricinfoArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getESPNcricinfoArticleScope(postElement);
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

function findESPNcricinfoFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scoreCarouselTarget = getESPNcricinfoScoreCarouselTarget(postElement);
  if (scoreCarouselTarget) {
    return {
      ...scoreCarouselTarget,
      wrapperClassName: ESPNCRICINFO_SCORE_MARKET_WRAPPER_CLASS,
    };
  }

  const compactRow = getESPNcricinfoCompactFeedRow(postElement);
  if (compactRow?.parentElement) {
    return {
      container: compactRow.parentElement,
      referenceElement: compactRow,
      insertPosition: "after",
      postWrapper: compactRow,
    };
  }

  if (postElement instanceof HTMLAnchorElement && postElement.parentElement) {
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement.parentElement,
    };
  }

  const scope = getESPNcricinfoStoryScope(postElement);
  const link = getESPNcricinfoPrimaryLink(postElement);
  if (link?.parentElement) {
    return {
      container: link.parentElement,
      referenceElement: link,
      insertPosition: "after",
      postWrapper: scope,
    };
  }

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

function findESPNcricinfoInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (isESPNcricinfoArticleRoot(postElement)) {
    return findESPNcricinfoArticleInjectionPoint(postElement);
  }

  return findESPNcricinfoFeedInjectionPoint(postElement);
}

function hasESPNcricinfoInjectedCard(postElement: Element): boolean {
  if (isESPNcricinfoArticleRoot(postElement)) {
    const articleScope = getESPNcricinfoArticleScope(postElement);
    const header = articleScope.querySelector("header");
    return (
      (header
        ? hasInjectedCardSibling(header)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const link = getESPNcricinfoPrimaryLink(postElement);
  const scope = getESPNcricinfoStoryScope(postElement);
  const compactRow = getESPNcricinfoCompactFeedRow(scope);
  if (compactRow && hasInjectedCardSibling(compactRow)) {
    return true;
  }

  return (
    (link ? hasInjectedCardSibling(link) : hasInjectedCardSibling(scope)) ||
    !!scope.querySelector(".knoww-market-card")
  );
}

function getESPNcricinfoWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const ESPNcricinfoAdapter = createBasicAdapter({
  name: "espncricinfo",
  hostPatterns: [ESPNCRICINFO_HOST_RE],
  itemSelectors: [
    ...ESPNCRICINFO_FEED_ITEM_ROOT_SELECTORS,
    ...ESPNCRICINFO_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...ESPNCRICINFO_CONTAINER_SELECTORS],
  textSelectors: [...ESPNCRICINFO_TITLE_SELECTORS],
  accentColor: "#03a9e6",
  fontFamily:
    '"Benton Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  bypassEnglishCheck: true,
  extractPostText: extractESPNcricinfoPostText,
  getPostId: getESPNcricinfoPostId,
  findInjectionPoint: findESPNcricinfoInjectionPoint,
  getDynamicSelectors: getESPNcricinfoDynamicSelectors,
  getWrapperStyles: getESPNcricinfoWrapperStyles,
  hasInjectedCard: hasESPNcricinfoInjectedCard,
});

export const adapter: PlatformAdapter = ESPNcricinfoAdapter;

export { ESPNcricinfoAdapter };
