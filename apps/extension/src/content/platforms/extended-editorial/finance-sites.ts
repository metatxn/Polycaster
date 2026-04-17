import type { InjectionPoint } from "../../../types/platform";
import {
  collectTextParts,
  combineTextParts,
  extractPostIdFromLink,
  findInjectionAfterSelectors,
  GENERIC_LINK_PATTERN,
  normalizeText,
} from "../helpers";
import {
  getFirstMatchingText,
  stripMediaFromClone,
  stripTrailingBylineFragment,
} from "../story-adapter-helpers";

const BLOOMBERG_HOST_RE = /^(?:www\.)?bloomberg\.com$/i;
const MARKETWATCH_HOST_RE = /^(?:www\.)?marketwatch\.com$/i;
const INVESTING_HOST_RE = /^(?:www\.)?investing\.com$/i;
const SEEKING_ALPHA_HOST_RE = /^(?:www\.)?seekingalpha\.com$/i;

const BLOOMBERG_STORY_LINK_SELECTORS = [
  'a[href*="/news/"]',
  'a[href*="/opinion/"]',
  'a[href*="/view/"]',
  'a[href*="/news/articles/"]',
] as const;

const BLOOMBERG_ITEM_SELECTORS_ORDERED = BLOOMBERG_STORY_LINK_SELECTORS.flatMap(
  (selector) => [
    `main article:has(${selector})`,
    `main li:has(${selector})`,
    `main div:has(> ${selector})`,
    `main section:has(> ${selector})`,
    `main ${selector}`,
  ]
);

const BLOOMBERG_TITLE_SELECTORS = [
  '[class*="headline"]',
  '[class*="Headline"]',
  '[class*="story-card"]',
  '[class*="StoryCard"]',
  "h1",
  "h2",
  "h3",
  "h4",
] as const;

const BLOOMBERG_DEK_SELECTORS = [
  '[class*="summary"]',
  '[class*="deck"]',
  '[class*="subhead"]',
  "p",
] as const;

const MARKETWATCH_CONTAINER_SELECTORS = [
  "main",
  '[role="main"]',
  "#__next",
  "body",
] as const;

const MARKETWATCH_STORY_LINK_SELECTORS = [
  'a[href*="/story/"]',
  'a[href*="/articles/"]',
  'a[href*="/video/"]',
] as const;

const MARKETWATCH_ITEM_ROOT_SELECTORS =
  MARKETWATCH_STORY_LINK_SELECTORS.flatMap((selector) => [
    `article:has(${selector})`,
    `section:has(${selector})`,
    `li:has(${selector})`,
    `h2:has(${selector})`,
    `h3:has(${selector})`,
    `h4:has(${selector})`,
    `${selector}`,
  ]);

const MARKETWATCH_TITLE_SELECTORS = [
  '[class*="headline"]',
  '[class*="Headline"]',
  '[class*="article__"]',
  "h1",
  "h2",
  "h3",
  "h4",
] as const;

const MARKETWATCH_DEK_SELECTORS = [
  '[class*="summary"]',
  '[class*="description"]',
  '[class*="excerpt"]',
  "p",
] as const;

const INVESTING_CONTAINER_SELECTORS = [
  "#leftColumn",
  "#left",
  "#contentSection",
  "#__next",
  "main",
  '[role="main"]',
  "body",
] as const;

const INVESTING_STORY_LINK_SELECTORS = [
  'a[href*="/news/"]',
  'a[href*="/analysis/"]',
] as const;

const INVESTING_ITEM_ROOT_SELECTORS = INVESTING_STORY_LINK_SELECTORS.flatMap(
  (selector) => [
    `article:has(${selector})`,
    `section:has(${selector})`,
    `li:has(${selector})`,
    `div:has(> ${selector})`,
    `${selector}`,
  ]
);

const INVESTING_TITLE_SELECTORS = [
  '[class*="headline"]',
  '[class*="Headline"]',
  '[class*="article__"]',
  "h1",
  "h2",
  "h3",
  "h4",
] as const;

const INVESTING_DEK_SELECTORS = [
  '[class*="summary"]',
  '[class*="description"]',
  '[class*="excerpt"]',
  "p",
] as const;

const SEEKING_ALPHA_FEED_ITEM_SELECTOR =
  'article[data-test-id="post-list-item"]';
const SEEKING_ALPHA_CONTAINER_SELECTORS = [
  '[data-test-id="post-list"]',
  "main",
  '[role="main"]',
  "body",
] as const;

const SEEKING_ALPHA_PRIMARY_LINK_SELECTORS = [
  'a[href*="/news/"]',
  'a[href*="/article/"]',
  'a[href*="/analysis/"]',
  'a[href*="/market-news/"]',
  'a[href*="/symbol/"]',
] as const;

const SEEKING_ALPHA_TITLE_SELECTORS = [
  '[data-test-id*="headline"]',
  '[data-test-id*="title"]',
  '[class*="headline"]',
  '[class*="title"]',
  "h1",
  "h2",
  "h3",
  "h4",
  ...SEEKING_ALPHA_PRIMARY_LINK_SELECTORS,
] as const;

const SEEKING_ALPHA_SUMMARY_SELECTORS = [
  '[data-test-id*="summary"]',
  '[data-test-id*="description"]',
  '[class*="summary"]',
  '[class*="description"]',
  '[class*="excerpt"]',
  "p",
] as const;

export const FINANCE_EDITORIAL_HOST_PATTERNS = [
  BLOOMBERG_HOST_RE,
  MARKETWATCH_HOST_RE,
  INVESTING_HOST_RE,
  SEEKING_ALPHA_HOST_RE,
] as const;

function getBloombergPrimaryStoryLink(
  postElement: Element
): HTMLAnchorElement | null {
  const joined = BLOOMBERG_STORY_LINK_SELECTORS.join(", ");
  if (postElement instanceof HTMLAnchorElement && postElement.matches(joined)) {
    return postElement;
  }
  return postElement.querySelector<HTMLAnchorElement>(joined);
}

function countBloombergStoryLinks(scope: ParentNode): number {
  const joined = BLOOMBERG_STORY_LINK_SELECTORS.join(", ");
  let count = 0;

  if (
    "matches" in scope &&
    typeof scope.matches === "function" &&
    (scope as Element).matches(joined)
  ) {
    count += 1;
  }

  if (
    "querySelectorAll" in scope &&
    typeof scope.querySelectorAll === "function"
  ) {
    count += scope.querySelectorAll(joined).length;
  }

  return count;
}

function isBloombergStoryScopeCandidate(element: Element): boolean {
  return /^(?:A|ARTICLE|DIV|LI|SECTION)$/i.test(element.tagName);
}

function getBloombergStoryScope(postElement: Element): Element {
  if (postElement.matches("main h1")) {
    return postElement;
  }

  const primaryLink = getBloombergPrimaryStoryLink(postElement);
  if (!primaryLink) {
    return postElement;
  }

  let bestMatch: Element = primaryLink;
  let current: Element | null = primaryLink.parentElement;

  while (current && !current.matches("main, body, html")) {
    const storyLinkCount = countBloombergStoryLinks(current);
    if (storyLinkCount > 1) {
      break;
    }

    if (isBloombergStoryScopeCandidate(current)) {
      bestMatch = current;
    }

    current = current.parentElement;
  }

  return bestMatch;
}

function isBloombergModuleContainer(element: Element): boolean {
  const styles = window.getComputedStyle(element);
  const overflows = [styles.overflow, styles.overflowX, styles.overflowY].join(
    " "
  );
  const hasClippedOverflow = /(hidden|clip)/i.test(overflows);
  const borderWidths = [
    styles.borderTopWidth,
    styles.borderRightWidth,
    styles.borderBottomWidth,
    styles.borderLeftWidth,
  ];
  const hasBorder = borderWidths.some((value) => Number.parseFloat(value) > 0);
  const borderRadius = [
    styles.borderTopLeftRadius,
    styles.borderTopRightRadius,
    styles.borderBottomRightRadius,
    styles.borderBottomLeftRadius,
  ];
  const hasRadius = borderRadius.some((value) => Number.parseFloat(value) > 0);

  return hasClippedOverflow || hasBorder || hasRadius;
}

function getBloombergModuleScope(postElement: Element): Element | null {
  const scope = getBloombergStoryScope(postElement);
  let fallback: Element | null = null;
  let current: Element | null = scope.parentElement;
  let depth = 0;

  while (current && !current.matches("main, body, html") && depth < 6) {
    const storyLinkCount = countBloombergStoryLinks(current);
    if (storyLinkCount > 1 && storyLinkCount <= 8) {
      fallback = current;
      if (isBloombergModuleContainer(current)) {
        return current;
      }
    }

    current = current.parentElement;
    depth += 1;
  }

  return fallback;
}

function extractBloombergTextFromShadowAnchors(postElement: Element): string {
  const chunks: string[] = [];
  const seen = new Set<string>();

  const consider = (root: ParentNode) => {
    for (const element of root.querySelectorAll("a")) {
      if (!(element instanceof HTMLAnchorElement)) continue;
      if (
        !BLOOMBERG_STORY_LINK_SELECTORS.some((selector) =>
          element.matches(selector)
        )
      ) {
        continue;
      }
      const text = normalizeText(stripMediaFromClone(element).textContent);
      if (text.length > 15 && !seen.has(text)) {
        seen.add(text);
        chunks.push(text);
      }
    }
  };

  consider(postElement);
  const walkShadow = (element: Element) => {
    if (element.shadowRoot) {
      consider(element.shadowRoot);
    }
    for (const child of element.children) {
      walkShadow(child);
    }
  };
  walkShadow(postElement);

  const combined = normalizeText(chunks.join(" "));
  return combined.length >= 20 ? combined.slice(0, 2000) : "";
}

function extractBloombergPostText(postElement: Element): string {
  const scope = getBloombergStoryScope(postElement);
  const title = getFirstMatchingText(scope, [...BLOOMBERG_TITLE_SELECTORS]);
  const deck = stripTrailingBylineFragment(
    getFirstMatchingText(scope, [...BLOOMBERG_DEK_SELECTORS])
  );
  const fromStructured = combineTextParts([title, deck]);
  if (fromStructured) {
    return fromStructured;
  }

  const storyLink = getBloombergPrimaryStoryLink(scope);
  if (storyLink) {
    const cleaned = normalizeText(stripMediaFromClone(storyLink).textContent);
    if (cleaned.length >= 20) {
      return cleaned;
    }
  }

  if (scope instanceof HTMLElement) {
    const fromInner = normalizeText(scope.innerText || scope.textContent);
    if (fromInner.length >= 20) {
      return fromInner.slice(0, 2000);
    }
  }

  const fromShadow = extractBloombergTextFromShadowAnchors(scope);
  if (fromShadow) {
    return fromShadow;
  }

  return combineTextParts([
    ...collectTextParts(scope, [...BLOOMBERG_TITLE_SELECTORS, "a"]),
    ...collectTextParts(scope, [...BLOOMBERG_DEK_SELECTORS]),
  ]);
}

function getMarketWatchPrimaryStoryLink(
  postElement: Element
): HTMLAnchorElement | null {
  const joined = MARKETWATCH_STORY_LINK_SELECTORS.join(", ");
  if (postElement instanceof HTMLAnchorElement && postElement.matches(joined)) {
    return postElement;
  }
  const closestLink = postElement.closest(joined);
  if (closestLink instanceof HTMLAnchorElement) {
    return closestLink;
  }
  return postElement.querySelector<HTMLAnchorElement>(joined);
}

function getMarketWatchInjectionReference(
  postElement: Element
): Element | null {
  if (postElement.matches("h1, h2, h3, h4")) {
    return postElement;
  }

  return getMarketWatchPrimaryStoryLink(postElement);
}

function extractMarketWatchPostText(postElement: Element): string {
  const title = getFirstMatchingText(postElement, [
    ...MARKETWATCH_TITLE_SELECTORS,
  ]);
  const deck = stripTrailingBylineFragment(
    getFirstMatchingText(postElement, [...MARKETWATCH_DEK_SELECTORS])
  );
  const fromStructured = combineTextParts([title, deck]);
  if (fromStructured) {
    return fromStructured;
  }

  const storyLink = getMarketWatchPrimaryStoryLink(postElement);
  if (storyLink) {
    const cleaned = normalizeText(stripMediaFromClone(storyLink).textContent);
    if (cleaned.length >= 20) {
      return cleaned;
    }
  }

  if (postElement instanceof HTMLElement) {
    const fromInner = normalizeText(
      postElement.innerText || postElement.textContent
    );
    if (fromInner.length >= 20) {
      return fromInner.slice(0, 2000);
    }
  }

  return combineTextParts([
    ...collectTextParts(postElement, [...MARKETWATCH_TITLE_SELECTORS, "a"]),
    ...collectTextParts(postElement, [...MARKETWATCH_DEK_SELECTORS]),
  ]);
}

function getSeekingAlphaPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  const joined = SEEKING_ALPHA_PRIMARY_LINK_SELECTORS.join(", ");
  const directMatch =
    postElement instanceof HTMLAnchorElement && postElement.matches(joined)
      ? postElement
      : null;
  if (directMatch) {
    return directMatch;
  }

  const closestMatch = postElement.closest(joined);
  if (closestMatch instanceof HTMLAnchorElement) {
    return closestMatch;
  }

  return postElement.querySelector<HTMLAnchorElement>(joined);
}

function getSeekingAlphaInjectionReference(
  postElement: Element
): Element | null {
  const selectors = [
    ...SEEKING_ALPHA_SUMMARY_SELECTORS,
    ...SEEKING_ALPHA_TITLE_SELECTORS,
  ];

  for (const selector of selectors) {
    const match = postElement.matches(selector)
      ? postElement
      : postElement.querySelector(selector);
    if (match instanceof Element) {
      return match;
    }
  }

  return getSeekingAlphaPrimaryLink(postElement);
}

function extractSeekingAlphaPostText(postElement: Element): string {
  const title = getFirstMatchingText(postElement, [
    ...SEEKING_ALPHA_TITLE_SELECTORS,
  ]);
  const summary = stripTrailingBylineFragment(
    getFirstMatchingText(postElement, [...SEEKING_ALPHA_SUMMARY_SELECTORS])
  );
  const focusedText = combineTextParts([title, summary]);
  if (focusedText) {
    return focusedText;
  }

  const primaryLink = getSeekingAlphaPrimaryLink(postElement);
  if (primaryLink) {
    const cleaned = normalizeText(stripMediaFromClone(primaryLink).textContent);
    if (cleaned.length >= 20) {
      return cleaned;
    }
  }

  return combineTextParts([
    ...collectTextParts(postElement, [...SEEKING_ALPHA_TITLE_SELECTORS]),
    ...collectTextParts(postElement, [...SEEKING_ALPHA_SUMMARY_SELECTORS]),
  ]);
}

function getInvestingPrimaryStoryLink(
  postElement: Element
): HTMLAnchorElement | null {
  const joined = INVESTING_STORY_LINK_SELECTORS.join(", ");
  if (postElement instanceof HTMLAnchorElement && postElement.matches(joined)) {
    return postElement;
  }
  const closestLink = postElement.closest(joined);
  if (closestLink instanceof HTMLAnchorElement) {
    return closestLink;
  }
  return postElement.querySelector<HTMLAnchorElement>(joined);
}

function getInvestingInjectionReference(postElement: Element): Element | null {
  if (postElement.matches("h1, h2, h3, h4")) {
    return postElement;
  }

  return getInvestingPrimaryStoryLink(postElement);
}

function extractInvestingPostText(postElement: Element): string {
  const title = getFirstMatchingText(postElement, [
    ...INVESTING_TITLE_SELECTORS,
  ]);
  const deck = stripTrailingBylineFragment(
    getFirstMatchingText(postElement, [...INVESTING_DEK_SELECTORS])
  );
  const fromStructured = combineTextParts([title, deck]);
  if (fromStructured) {
    return fromStructured;
  }

  const storyLink = getInvestingPrimaryStoryLink(postElement);
  if (storyLink) {
    const cleaned = normalizeText(stripMediaFromClone(storyLink).textContent);
    if (cleaned.length >= 20) {
      return cleaned;
    }
  }

  if (postElement instanceof HTMLElement) {
    const fromInner = normalizeText(
      postElement.innerText || postElement.textContent
    );
    if (fromInner.length >= 20) {
      return fromInner.slice(0, 2000);
    }
  }

  return combineTextParts([
    ...collectTextParts(postElement, [...INVESTING_TITLE_SELECTORS, "a"]),
    ...collectTextParts(postElement, [...INVESTING_DEK_SELECTORS]),
  ]);
}

export function getFinanceEditorialPostId(postElement: Element): string | null {
  // `null` means either "not a finance-editorial host" or "no stable post id";
  // the composer checks these host-gated helpers in priority order.
  const hostname = window.location.hostname;

  if (BLOOMBERG_HOST_RE.test(hostname)) {
    const bloombergScope = getBloombergStoryScope(postElement);
    return extractPostIdFromLink(
      getBloombergPrimaryStoryLink(bloombergScope) || bloombergScope,
      GENERIC_LINK_PATTERN
    );
  }

  if (MARKETWATCH_HOST_RE.test(hostname)) {
    return extractPostIdFromLink(
      getMarketWatchPrimaryStoryLink(postElement) || postElement,
      GENERIC_LINK_PATTERN
    );
  }

  if (SEEKING_ALPHA_HOST_RE.test(hostname)) {
    return extractPostIdFromLink(
      getSeekingAlphaPrimaryLink(postElement) || postElement,
      GENERIC_LINK_PATTERN
    );
  }

  if (INVESTING_HOST_RE.test(hostname)) {
    return extractPostIdFromLink(
      getInvestingPrimaryStoryLink(postElement) || postElement,
      GENERIC_LINK_PATTERN
    );
  }

  return null;
}

export function extractFinanceEditorialPostText(postElement: Element): string {
  // `""` means "not handled by this family"; handled hosts return extracted text
  // or an empty combined string only if nothing useful was found.
  const hostname = window.location.hostname;

  if (BLOOMBERG_HOST_RE.test(hostname)) {
    return extractBloombergPostText(postElement);
  }

  if (MARKETWATCH_HOST_RE.test(hostname)) {
    return extractMarketWatchPostText(postElement);
  }

  if (SEEKING_ALPHA_HOST_RE.test(hostname)) {
    return extractSeekingAlphaPostText(postElement);
  }

  if (INVESTING_HOST_RE.test(hostname)) {
    return extractInvestingPostText(postElement);
  }

  return "";
}

export function getFinanceEditorialDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} | null {
  const hostname = window.location.hostname;

  if (BLOOMBERG_HOST_RE.test(hostname)) {
    const matchedSelectors = BLOOMBERG_ITEM_SELECTORS_ORDERED.filter(
      (selector) => document.querySelector(selector)
    );
    return {
      itemSelector:
        matchedSelectors.length > 0
          ? matchedSelectors.join(", ")
          : BLOOMBERG_ITEM_SELECTORS_ORDERED.join(", "),
      containerSelector: "main",
    };
  }

  if (MARKETWATCH_HOST_RE.test(hostname)) {
    const containerSelector =
      MARKETWATCH_CONTAINER_SELECTORS.find((selector) =>
        document.querySelector(selector)
      ) || "body";

    if (
      /^\/(?:story|articles|video)\//i.test(window.location.pathname) &&
      document.querySelector("h1")
    ) {
      return {
        itemSelector: "h1",
        containerSelector,
      };
    }

    const scopedSelectors = MARKETWATCH_ITEM_ROOT_SELECTORS.map(
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

  if (INVESTING_HOST_RE.test(hostname)) {
    const containerSelector =
      INVESTING_CONTAINER_SELECTORS.find((selector) =>
        document.querySelector(selector)
      ) || "body";

    const scopedSelectors = INVESTING_ITEM_ROOT_SELECTORS.map(
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

  if (SEEKING_ALPHA_HOST_RE.test(hostname)) {
    const containerSelector =
      SEEKING_ALPHA_CONTAINER_SELECTORS.find((selector) =>
        document.querySelector(selector)
      ) || "body";
    const hasFeedItems = document.querySelector(
      SEEKING_ALPHA_FEED_ITEM_SELECTOR
    );
    return {
      itemSelector: hasFeedItems
        ? SEEKING_ALPHA_FEED_ITEM_SELECTOR
        : `${SEEKING_ALPHA_FEED_ITEM_SELECTOR}, main > article, article`,
      containerSelector,
    };
  }

  return null;
}

export function findFinanceEditorialInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const hostname = window.location.hostname;

  if (BLOOMBERG_HOST_RE.test(hostname)) {
    if (postElement.matches("main h1")) {
      return findInjectionAfterSelectors(postElement, ["p", "h1"]);
    }
    const scope = getBloombergStoryScope(postElement);
    const moduleScope = getBloombergModuleScope(scope);

    if (moduleScope?.parentElement) {
      return {
        container: moduleScope.parentElement,
        referenceElement: moduleScope,
        insertPosition: "after",
        postWrapper: moduleScope,
      };
    }

    return findInjectionAfterSelectors(scope, [
      ...BLOOMBERG_STORY_LINK_SELECTORS,
      '[class*="headline"]',
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
    ]);
  }

  if (MARKETWATCH_HOST_RE.test(hostname)) {
    if (postElement.matches("main h1, h1")) {
      return findInjectionAfterSelectors(postElement, ["p", "h1"]);
    }
    const reference = getMarketWatchInjectionReference(postElement);
    if (reference?.parentElement) {
      return {
        container: reference.parentElement,
        referenceElement: reference,
        insertPosition: "after",
        postWrapper:
          reference === postElement ? postElement : (reference as Element),
      };
    }
    return findInjectionAfterSelectors(postElement, [
      ...MARKETWATCH_STORY_LINK_SELECTORS,
      '[class*="headline"]',
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
    ]);
  }

  if (INVESTING_HOST_RE.test(hostname)) {
    if (postElement.matches("main h1, article h1, h1")) {
      return findInjectionAfterSelectors(postElement, ["p", "h1"]);
    }
    const reference = getInvestingInjectionReference(postElement);
    if (reference?.parentElement) {
      return {
        container: reference.parentElement,
        referenceElement: reference,
        insertPosition: "after",
        postWrapper:
          reference === postElement ? postElement : (reference as Element),
      };
    }
    return findInjectionAfterSelectors(postElement, [
      ...INVESTING_STORY_LINK_SELECTORS,
      '[class*="headline"]',
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
    ]);
  }

  if (SEEKING_ALPHA_HOST_RE.test(hostname)) {
    const reference = getSeekingAlphaInjectionReference(postElement);
    if (reference?.parentElement) {
      return {
        container: reference.parentElement,
        referenceElement: reference,
        insertPosition: "after",
        postWrapper: postElement,
      };
    }

    const feedArticle =
      postElement.closest(SEEKING_ALPHA_FEED_ITEM_SELECTOR) ??
      (postElement.matches(SEEKING_ALPHA_FEED_ITEM_SELECTOR)
        ? postElement
        : null);
    if (feedArticle?.parentElement) {
      return {
        container: feedArticle.parentElement,
        referenceElement: feedArticle,
        insertPosition: "after",
        postWrapper: feedArticle,
      };
    }
  }

  return null;
}

export function hasFinanceEditorialInjectedCard(
  postElement: Element
): boolean | null {
  const hostname = window.location.hostname;

  if (BLOOMBERG_HOST_RE.test(hostname) && postElement.matches("main h1")) {
    const nextSibling = postElement.nextElementSibling as HTMLElement | null;
    return (
      nextSibling?.getAttribute("data-knoww-injected") === "true" ||
      !!postElement.querySelector(".knoww-market-card")
    );
  }

  if (
    MARKETWATCH_HOST_RE.test(hostname) &&
    postElement.matches("main h1, h1")
  ) {
    const nextSibling = postElement.nextElementSibling as HTMLElement | null;
    return (
      nextSibling?.getAttribute("data-knoww-injected") === "true" ||
      !!postElement.querySelector(".knoww-market-card")
    );
  }

  if (MARKETWATCH_HOST_RE.test(hostname)) {
    const reference = getMarketWatchInjectionReference(postElement);
    const nextSibling = reference?.nextElementSibling as HTMLElement | null;
    if (nextSibling?.getAttribute("data-knoww-injected") === "true") {
      return true;
    }

    const postNextSibling =
      postElement.nextElementSibling as HTMLElement | null;
    return (
      postNextSibling?.getAttribute("data-knoww-injected") === "true" ||
      !!postElement.querySelector(".knoww-market-card") ||
      !!reference?.querySelector?.(".knoww-market-card")
    );
  }

  if (
    INVESTING_HOST_RE.test(hostname) &&
    postElement.matches("main h1, article h1, h1")
  ) {
    const nextSibling = postElement.nextElementSibling as HTMLElement | null;
    return (
      nextSibling?.getAttribute("data-knoww-injected") === "true" ||
      !!postElement.querySelector(".knoww-market-card")
    );
  }

  if (INVESTING_HOST_RE.test(hostname)) {
    const reference = getInvestingInjectionReference(postElement);
    const nextSibling = reference?.nextElementSibling as HTMLElement | null;
    if (nextSibling?.getAttribute("data-knoww-injected") === "true") {
      return true;
    }

    const postNextSibling =
      postElement.nextElementSibling as HTMLElement | null;
    return (
      postNextSibling?.getAttribute("data-knoww-injected") === "true" ||
      !!postElement.querySelector(".knoww-market-card") ||
      !!reference?.querySelector?.(".knoww-market-card")
    );
  }

  if (BLOOMBERG_HOST_RE.test(hostname)) {
    const scope = getBloombergStoryScope(postElement);
    const reference = getBloombergModuleScope(scope) || scope;
    const nextSibling = reference.nextElementSibling as HTMLElement | null;
    return (
      nextSibling?.getAttribute("data-knoww-injected") === "true" ||
      !!reference.querySelector(".knoww-market-card")
    );
  }

  if (SEEKING_ALPHA_HOST_RE.test(hostname)) {
    const reference = getSeekingAlphaInjectionReference(postElement);
    const referenceSibling =
      reference?.nextElementSibling as HTMLElement | null;
    if (referenceSibling?.getAttribute("data-knoww-injected") === "true") {
      return true;
    }

    const row =
      postElement.closest(SEEKING_ALPHA_FEED_ITEM_SELECTOR) ??
      (postElement.matches(SEEKING_ALPHA_FEED_ITEM_SELECTOR)
        ? postElement
        : null);
    const target = row ?? postElement;
    const nextSibling = target.nextElementSibling as HTMLElement | null;
    return (
      nextSibling?.getAttribute("data-knoww-injected") === "true" ||
      !!target.querySelector(".knoww-market-card")
    );
  }

  return null;
}

export function getFinanceEditorialWrapperStyles(): string | null {
  if (BLOOMBERG_HOST_RE.test(window.location.hostname)) {
    return `
      padding: 12px 0 0 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      flex: 1 0 100%;
      box-sizing: border-box;
    `;
  }

  if (SEEKING_ALPHA_HOST_RE.test(window.location.hostname)) {
    return `
      padding: 12px 0 0 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
      flex: 0 0 auto;
      align-self: stretch;
      grid-column: 1 / -1;
    `;
  }

  return null;
}
