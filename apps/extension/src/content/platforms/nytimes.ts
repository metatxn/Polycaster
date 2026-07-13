import type { InjectionPoint, PlatformAdapter } from "../../types/platform";
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

const NYTIMES_HOST_RE = /^(?:www\.)?nytimes\.com$/i;
const NYTIMES_CONTAINER_SELECTORS = [
  "#site-content",
  "main",
  '[data-testid="programming-node"]',
  "body",
] as const;

const NYTIMES_PRIMARY_LINK_SELECTORS = [
  'a.tpl-lbl[href*="nytimes.com/202"]',
  'a.tpl-lbl[href*="nytimes.com/live/"]',
  'a.tpl-lbl[href*="nytimes.com/interactive/"]',
  'a.css-9mylee[href*="nytimes.com/202"]',
  'a.css-9mylee[href*="nytimes.com/live/"]',
  'a.css-9mylee[href*="nytimes.com/interactive/"]',
  'a[href^="/202"]',
  'a[href^="/live/"]',
  'a[href^="/interactive/"]',
  'a[href^="/athletic/"]',
  'a[href*="nytimes.com/athletic/"]',
  'a[href*="nytimes.com/202"]',
  'a[href*="nytimes.com/live/"]',
  'a[href*="nytimes.com/interactive/"]',
] as const;

const NYTIMES_ITEM_ROOT_SELECTORS = [
  `.story-wrapper[data-tpl="sli"]:has(${NYTIMES_PRIMARY_LINK_SELECTORS[0]})`,
  `.story-wrapper[data-tpl="sli"]:has(${NYTIMES_PRIMARY_LINK_SELECTORS[1]})`,
  `.story-wrapper[data-tpl="sli"]:has(${NYTIMES_PRIMARY_LINK_SELECTORS[2]})`,
  `.story-wrapper[data-tpl="sli"]`,
] as const;

const NYTIMES_TITLE_SELECTORS = [
  "p.indicate-hover",
  '[data-tpl="h"] p',
  "h1",
  "h2",
  "h3",
  "h4",
] as const;

const NYTIMES_SUMMARY_SELECTORS = [
  "p.summary-class",
  '[data-tpl="bo"] p',
  '[class*="summary"]',
  "p",
] as const;

function getNytimesStoryScope(postElement: Element): Element {
  if (postElement.matches("h1")) {
    return postElement;
  }

  return postElement.closest('.story-wrapper[data-tpl="sli"]') || postElement;
}

function getNytimesPrimaryLink(postElement: Element): HTMLAnchorElement | null {
  const scope = getNytimesStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    NYTIMES_PRIMARY_LINK_SELECTORS
  );
}

function extractNytimesPostText(postElement: Element): string {
  if (postElement.matches("h1")) {
    const title = normalizeText(postElement.textContent);
    const summary = getDocumentDescription();
    const articleText = combineTextParts([title, summary]);
    if (articleText) {
      return articleText;
    }
  }

  const scope = getNytimesStoryScope(postElement);
  const title = getFirstMatchingText(scope, NYTIMES_TITLE_SELECTORS);
  const summary = getFirstMatchingText(scope, NYTIMES_SUMMARY_SELECTORS);
  const structured = combineTextParts([title, summary]);
  if (structured) {
    return structured;
  }

  return combineTextParts([
    title,
    normalizeText(getNytimesPrimaryLink(scope)?.textContent),
  ]);
}

function getNytimesPostId(postElement: Element): string | null {
  const primaryLink = getNytimesPrimaryLink(postElement);
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

function getNytimesDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    NYTIMES_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (
    /^\/(?:\d{4}\/\d{2}\/\d{2}|live\/\d{4}|interactive\/\d{4}|athletic\/)/i.test(
      window.location.pathname
    ) &&
    document.querySelector("main h1, article h1, h1")
  ) {
    return {
      itemSelector: "main h1, article h1, h1",
      containerSelector,
    };
  }

  const scopedSelectors = NYTIMES_ITEM_ROOT_SELECTORS.map(
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

function findNytimesInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (postElement.matches("h1")) {
    return findInjectionAfterSelectors(postElement, ["p", "h1"]);
  }

  const scope = getNytimesStoryScope(postElement);
  if (scope.parentElement) {
    return {
      container: scope.parentElement,
      referenceElement: scope,
      insertPosition: "after",
      postWrapper: scope,
    };
  }

  return findInjectionAfterSelectors(scope, [
    ...NYTIMES_TITLE_SELECTORS,
    ...NYTIMES_PRIMARY_LINK_SELECTORS,
  ]);
}

function hasNytimesInjectedCard(postElement: Element): boolean {
  if (postElement.matches("h1")) {
    return hasInjectedCardSibling(postElement);
  }

  return hasInjectedCardSibling(getNytimesStoryScope(postElement));
}

function getNytimesWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const NytimesAdapter = createBasicAdapter({
  name: "nytimes",
  hostPatterns: [NYTIMES_HOST_RE],
  bypassEnglishCheck: true,
  itemSelectors: [...NYTIMES_ITEM_ROOT_SELECTORS],
  containerSelectors: [...NYTIMES_CONTAINER_SELECTORS],
  textSelectors: [...NYTIMES_TITLE_SELECTORS, ...NYTIMES_SUMMARY_SELECTORS],
  accentColor: "#2563eb",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText: extractNytimesPostText,
  getPostId: getNytimesPostId,
  findInjectionPoint: findNytimesInjectionPoint,
  getDynamicSelectors: getNytimesDynamicSelectors,
  getWrapperStyles: getNytimesWrapperStyles,
  hasInjectedCard: hasNytimesInjectedCard,
});

export const adapter: PlatformAdapter = NytimesAdapter;

export { NytimesAdapter };
