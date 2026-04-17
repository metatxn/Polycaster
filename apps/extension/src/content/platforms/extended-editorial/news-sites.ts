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
  getDocumentDescription,
  getFirstMatchingText,
  stripMediaFromClone,
  stripTrailingBylineFragment,
} from "../story-adapter-helpers";
import {
  BASE_EDITORIAL_CONTAINER_SELECTORS,
  BASE_EDITORIAL_ITEM_SELECTORS,
  EDITORIAL_TITLE_SELECTORS,
} from "./shared";

const APNEWS_HOST_RE = /^(?:www\.)?apnews\.com$/i;
const FT_HOST_RE = /^(?:www\.)?ft\.com$/i;
const THEGUARDIAN_HOST_RE = /^(?:www\.)?theguardian\.com$/i;
const POLITICO_HOST_RE = /^(?:www\.)?politico\.com$/i;
const USA_TODAY_HOST_RE = /^(?:www\.)?usatoday\.com$/i;
const INDIA_TIMES_HOST_RE = /^(?:[\w-]+\.)*indiatimes\.com$/i;
const TIMESOFINDIA_LIVE_HOST_RE = /^(?:www\.)?timesofindialive\.com$/i;

const APNEWS_ITEM_SELECTORS = [
  "main .PagePromo",
  "main .PagePromoTrending",
] as const;

const FT_ITEM_SELECTORS_ORDERED = [
  "main .o-teaser",
  'main [data-o-component="o-teaser"]',
  'main [class*="o-teaser-collection__item"]',
  'main li:has(a[href*="/content/"])',
  'main div:has(> a[href*="/content/"])',
  "main h1",
] as const;

const FT_ARTICLE_LINK_SELECTORS = [
  'a[href*="/content/"]',
  'a[href*="/stream/"]',
] as const;

const FT_TITLE_SELECTORS = [
  ".o-teaser__heading",
  ".js-teaser-heading-link",
  '[data-o-component="o-teaser"] [class*="heading"]',
  ...FT_ARTICLE_LINK_SELECTORS,
  "h1",
  "h2",
  "h3",
  "h4",
] as const;

const FT_STANDFIRST_SELECTORS = [
  ".o-teaser__standfirst",
  '[data-o-component="o-teaser"] [class*="standfirst"]',
  '[data-o-component="o-teaser"] p',
  "p",
] as const;

const GUARDIAN_ITEM_SELECTORS_ORDERED = [
  'main li:has(> a[data-link-name="article"])',
  'main li:has(a[data-link-name="article"])',
  'main a[data-link-name="article"]',
] as const;

const GUARDIAN_HEADLINE_SELECTORS = [
  '[class*="card-headline"]',
  '[class*="CardHeadline"]',
] as const;

const GUARDIAN_TRAIL_SELECTORS = [
  '[class*="card-trail"]',
  '[class*="trail-text"]',
  '[class*="CardTrail"]',
] as const;

const POLITICO_ITEM_SELECTORS_ORDERED = [
  'main [class*="story-frag"]',
  'main [class*="StoryFrag"]',
  'main [class*="media-summary"]',
  'main a[href*="/news/20"]',
  'main a[href*="/story/20"]',
] as const;

const POLITICO_ARTICLE_LINK_SELECTORS = [
  'a[href*="/news/20"]',
  'a[href*="/story/20"]',
] as const;

const POLITICO_TITLE_SELECTORS = [
  '[class*="headline"]',
  "h3",
  "h2",
  "h1",
  "h4",
] as const;

const POLITICO_DEK_SELECTORS = [
  '[class*="dek"]',
  '[class*="subhead"]',
  '[class*="summary"]',
  "p",
] as const;

const USA_TODAY_ITEM_SELECTORS_ORDERED = [
  'main a[href*="/story/"][class*="gnt_m_"]',
  "main h1",
  "article h1",
  '[role="main"] h1',
] as const;

const INDIA_TIMES_STORY_LINK_SELECTORS = [
  'a[href*="/articleshow/"]',
  'a[href*="/liveblog/"]',
  'a[href*="/videoshow/"]',
] as const;

const INDIA_TIMES_ARTICLE_PATH_RE = /\/(?:articleshow|liveblog|videoshow)\//i;

export const NEWS_EDITORIAL_HOST_PATTERNS = [
  APNEWS_HOST_RE,
  FT_HOST_RE,
  THEGUARDIAN_HOST_RE,
  POLITICO_HOST_RE,
  USA_TODAY_HOST_RE,
  INDIA_TIMES_HOST_RE,
  TIMESOFINDIA_LIVE_HOST_RE,
] as const;

function isIndiaTimesEditorialHost(): boolean {
  const hostname = window.location.hostname;
  return (
    INDIA_TIMES_HOST_RE.test(hostname) ||
    TIMESOFINDIA_LIVE_HOST_RE.test(hostname)
  );
}

function getGuardianPrimaryArticleLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (
    postElement instanceof HTMLAnchorElement &&
    postElement.matches('a[data-link-name="article"]')
  ) {
    return postElement;
  }
  return postElement.querySelector<HTMLAnchorElement>(
    'a[data-link-name="article"]'
  );
}

function extractGuardianPostText(postElement: Element): string {
  const title = getFirstMatchingText(postElement, [
    ...GUARDIAN_HEADLINE_SELECTORS,
  ]);
  const trail = stripTrailingBylineFragment(
    getFirstMatchingText(postElement, [...GUARDIAN_TRAIL_SELECTORS])
  );
  const fromHeadlineTrail = combineTextParts([title, trail]);
  if (fromHeadlineTrail) {
    return fromHeadlineTrail;
  }

  const link = getGuardianPrimaryArticleLink(postElement);
  if (link) {
    const cleaned = normalizeText(stripMediaFromClone(link).textContent);
    if (cleaned.length >= 20) {
      return cleaned;
    }
  }

  return combineTextParts([
    ...collectTextParts(postElement, [
      ...GUARDIAN_HEADLINE_SELECTORS,
      ...GUARDIAN_TRAIL_SELECTORS,
      "h2",
      "h3",
      "p",
    ]),
  ]);
}

function getPoliticoPrimaryArticleLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (
    postElement instanceof HTMLAnchorElement &&
    postElement.matches(POLITICO_ARTICLE_LINK_SELECTORS.join(", "))
  ) {
    return postElement;
  }

  return postElement.querySelector<HTMLAnchorElement>(
    POLITICO_ARTICLE_LINK_SELECTORS.join(", ")
  );
}

function extractPoliticoPostText(postElement: Element): string {
  const title = getFirstMatchingText(postElement, [
    ...POLITICO_TITLE_SELECTORS,
  ]);
  const deck = stripTrailingBylineFragment(
    getFirstMatchingText(postElement, [...POLITICO_DEK_SELECTORS])
  );
  const fromTitleDek = combineTextParts([title, deck]);
  if (fromTitleDek) {
    return fromTitleDek;
  }

  const link = getPoliticoPrimaryArticleLink(postElement);

  if (link?.href && /politico\.com\//.test(link.href)) {
    const cleaned = normalizeText(stripMediaFromClone(link).textContent);
    if (cleaned.length >= 20) {
      return cleaned;
    }
  }

  return combineTextParts([
    ...collectTextParts(postElement, [
      ...POLITICO_TITLE_SELECTORS,
      ...POLITICO_DEK_SELECTORS,
    ]),
  ]);
}

function getFtPrimaryArticleLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (
    postElement instanceof HTMLAnchorElement &&
    postElement.matches(FT_ARTICLE_LINK_SELECTORS.join(", "))
  ) {
    return postElement;
  }

  return postElement.querySelector<HTMLAnchorElement>(
    FT_ARTICLE_LINK_SELECTORS.join(", ")
  );
}

function extractFtPostText(postElement: Element): string {
  if (postElement.matches("main h1")) {
    const title = normalizeText(postElement.textContent);
    const summary = getDocumentDescription();
    const articleText = combineTextParts([title, summary]);
    if (articleText) {
      return articleText;
    }
  }

  const title = getFirstMatchingText(postElement, [...FT_TITLE_SELECTORS]);
  const standfirst = stripTrailingBylineFragment(
    getFirstMatchingText(postElement, [...FT_STANDFIRST_SELECTORS])
  );
  const teaserText = combineTextParts([title, standfirst]);
  if (teaserText) {
    return teaserText;
  }

  const primaryLink = getFtPrimaryArticleLink(postElement);
  if (primaryLink) {
    const cleaned = normalizeText(stripMediaFromClone(primaryLink).textContent);
    if (cleaned.length >= 20) {
      return cleaned;
    }
  }

  return combineTextParts([
    ...collectTextParts(postElement, [...FT_TITLE_SELECTORS]),
    ...collectTextParts(postElement, [...FT_STANDFIRST_SELECTORS]),
  ]);
}

function getUsaTodayPostId(postElement: Element): string | null {
  if (
    postElement instanceof HTMLAnchorElement &&
    postElement.getAttribute("href")?.includes("/story/")
  ) {
    const href = postElement.getAttribute("href");
    if (href) {
      try {
        return normalizeText(new URL(href, window.location.origin).pathname);
      } catch {
        return normalizeText(href);
      }
    }
  }

  const link = postElement.querySelector(
    'a[href*="/story/"][class*="gnt_m_"]'
  ) as HTMLAnchorElement | null;
  const href = link?.getAttribute("href");
  if (href) {
    try {
      return normalizeText(new URL(href, window.location.origin).pathname);
    } catch {
      return normalizeText(href);
    }
  }

  return null;
}

function getIndiaTimesPrimaryStoryLink(
  postElement: Element
): HTMLAnchorElement | null {
  const joined = INDIA_TIMES_STORY_LINK_SELECTORS.join(", ");
  if (postElement instanceof HTMLAnchorElement && postElement.matches(joined)) {
    return postElement;
  }
  return postElement.querySelector<HTMLAnchorElement>(joined);
}

function getIndiaTimesPostId(postElement: Element): string | null {
  const link = getIndiaTimesPrimaryStoryLink(postElement);
  if (link?.href) {
    try {
      return normalizeText(new URL(link.href, window.location.origin).pathname);
    } catch {
      const href = link.getAttribute("href");
      return href ? normalizeText(href) : null;
    }
  }
  if (INDIA_TIMES_ARTICLE_PATH_RE.test(window.location.pathname)) {
    return normalizeText(window.location.pathname);
  }
  return null;
}

function extractIndiaTimesPostText(postElement: Element): string {
  if (postElement.matches("h1")) {
    const title = normalizeText(postElement.textContent);
    const summary = getDocumentDescription();
    const combined = combineTextParts([title, summary]);
    if (combined) {
      return combined;
    }
  }

  const link = getIndiaTimesPrimaryStoryLink(postElement);
  if (link) {
    const cleaned = normalizeText(stripMediaFromClone(link).textContent);
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
    ...collectTextParts(postElement, [...EDITORIAL_TITLE_SELECTORS]),
  ]);
}

export function getNewsEditorialPostId(postElement: Element): string | null {
  // `null` means either "not a news-editorial host" or "no stable post id";
  // the composer checks these host-gated helpers in priority order.
  const hostname = window.location.hostname;

  if (POLITICO_HOST_RE.test(hostname)) {
    return extractPostIdFromLink(
      getPoliticoPrimaryArticleLink(postElement) || postElement,
      GENERIC_LINK_PATTERN
    );
  }

  if (FT_HOST_RE.test(hostname)) {
    return extractPostIdFromLink(
      getFtPrimaryArticleLink(postElement) || postElement,
      GENERIC_LINK_PATTERN
    );
  }

  if (USA_TODAY_HOST_RE.test(hostname)) {
    return getUsaTodayPostId(postElement);
  }

  if (isIndiaTimesEditorialHost()) {
    return getIndiaTimesPostId(postElement);
  }

  return null;
}

export function extractNewsEditorialPostText(postElement: Element): string {
  // `""` means "not handled by this family"; handled hosts return extracted text
  // or an empty combined string only if nothing useful was found.
  const hostname = window.location.hostname;

  if (THEGUARDIAN_HOST_RE.test(hostname)) {
    return extractGuardianPostText(postElement);
  }

  if (POLITICO_HOST_RE.test(hostname)) {
    return extractPoliticoPostText(postElement);
  }

  if (FT_HOST_RE.test(hostname)) {
    return extractFtPostText(postElement);
  }

  if (USA_TODAY_HOST_RE.test(hostname)) {
    if (postElement.matches("main h1, article h1, h1")) {
      const title = normalizeText(postElement.textContent);
      const summary = getDocumentDescription();
      const articleText = combineTextParts([title, summary]);
      if (articleText) {
        return articleText;
      }
    }
    const fromAnchor = normalizeText(postElement.textContent);
    if (fromAnchor.length >= 20) {
      return fromAnchor;
    }
    return combineTextParts([fromAnchor, getDocumentDescription()]);
  }

  if (isIndiaTimesEditorialHost()) {
    return extractIndiaTimesPostText(postElement);
  }

  return "";
}

export function getNewsEditorialDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} | null {
  const hostname = window.location.hostname;

  if (FT_HOST_RE.test(hostname)) {
    const matchedSelectors = FT_ITEM_SELECTORS_ORDERED.filter((selector) =>
      document.querySelector(selector)
    );
    return {
      itemSelector:
        matchedSelectors.length > 0
          ? matchedSelectors.join(", ")
          : FT_ITEM_SELECTORS_ORDERED.join(", "),
      containerSelector: "main",
    };
  }

  if (APNEWS_HOST_RE.test(hostname)) {
    const apnewsItems = APNEWS_ITEM_SELECTORS.filter((selector) =>
      document.querySelector(selector)
    );

    return {
      itemSelector:
        apnewsItems.length > 0
          ? [...apnewsItems, ...BASE_EDITORIAL_ITEM_SELECTORS].join(", ")
          : BASE_EDITORIAL_ITEM_SELECTORS.join(", "),
      containerSelector: "main",
    };
  }

  if (THEGUARDIAN_HOST_RE.test(hostname)) {
    const firstMatch = GUARDIAN_ITEM_SELECTORS_ORDERED.find((selector) =>
      document.querySelector(selector)
    );
    return {
      itemSelector: firstMatch ?? GUARDIAN_ITEM_SELECTORS_ORDERED[2],
      containerSelector: "main",
    };
  }

  if (POLITICO_HOST_RE.test(hostname)) {
    const matchedSelectors = POLITICO_ITEM_SELECTORS_ORDERED.filter(
      (selector) => document.querySelector(selector)
    );
    return {
      itemSelector:
        matchedSelectors.length > 0
          ? matchedSelectors.join(", ")
          : POLITICO_ITEM_SELECTORS_ORDERED.join(", "),
      containerSelector: "main",
    };
  }

  if (USA_TODAY_HOST_RE.test(hostname)) {
    const containerSelector =
      BASE_EDITORIAL_CONTAINER_SELECTORS.find((selector) =>
        document.querySelector(selector)
      ) || "body";

    const matchedSelectors = USA_TODAY_ITEM_SELECTORS_ORDERED.filter(
      (selector) => document.querySelector(selector)
    );
    return {
      itemSelector:
        matchedSelectors.length > 0
          ? matchedSelectors.join(", ")
          : USA_TODAY_ITEM_SELECTORS_ORDERED.join(", "),
      containerSelector,
    };
  }

  if (isIndiaTimesEditorialHost()) {
    const containerSelector =
      BASE_EDITORIAL_CONTAINER_SELECTORS.find((selector) =>
        document.querySelector(selector)
      ) || "body";

    if (
      INDIA_TIMES_ARTICLE_PATH_RE.test(window.location.pathname) &&
      document.querySelector("h1")
    ) {
      return {
        itemSelector: "h1",
        containerSelector,
      };
    }

    const scopedStorySelectors = INDIA_TIMES_STORY_LINK_SELECTORS.map(
      (selector) => `${containerSelector} ${selector}`
    );
    const matchedStorySelectors = scopedStorySelectors.filter((selector) =>
      document.querySelector(selector)
    );
    if (matchedStorySelectors.length > 0) {
      return {
        itemSelector: matchedStorySelectors.join(", "),
        containerSelector,
      };
    }

    if (TIMESOFINDIA_LIVE_HOST_RE.test(hostname)) {
      return {
        itemSelector: "article, main article",
        containerSelector,
      };
    }

    return {
      itemSelector: INDIA_TIMES_STORY_LINK_SELECTORS.join(", "),
      containerSelector,
    };
  }

  return null;
}

export function findNewsEditorialInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const hostname = window.location.hostname;

  if (FT_HOST_RE.test(hostname)) {
    if (postElement.matches("main h1")) {
      return findInjectionAfterSelectors(postElement, ["p", "h1"]);
    }

    const teaser =
      (postElement.matches(".o-teaser, [data-o-component='o-teaser']")
        ? postElement
        : postElement.querySelector(
            ".o-teaser, [data-o-component='o-teaser']"
          )) || postElement.closest(".o-teaser, [data-o-component='o-teaser']");

    if (teaser) {
      const standfirst = teaser.querySelector(".o-teaser__standfirst");
      if (standfirst?.parentElement) {
        return {
          container: standfirst.parentElement,
          referenceElement: standfirst,
          insertPosition: "after",
          postWrapper: teaser,
        };
      }

      return {
        container: teaser,
        referenceElement:
          teaser.querySelector(
            ".o-teaser__heading, .js-teaser-heading-link, h2, h3, h4"
          ) || getFtPrimaryArticleLink(teaser),
        insertPosition: "after",
        postWrapper: teaser,
      };
    }
  }

  if (THEGUARDIAN_HOST_RE.test(hostname)) {
    return findInjectionAfterSelectors(postElement, [
      'a[data-link-name="article"]',
      '[class*="card-headline"]',
      '[class*="CardHeadline"]',
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
    ]);
  }

  if (POLITICO_HOST_RE.test(hostname)) {
    return findInjectionAfterSelectors(postElement, [
      "h3",
      "h2",
      '[class*="headline"]',
      ...POLITICO_ARTICLE_LINK_SELECTORS,
      "p",
    ]);
  }

  if (APNEWS_HOST_RE.test(hostname)) {
    const promo =
      (postElement.matches(".PagePromo, .PagePromoTrending")
        ? postElement
        : postElement.querySelector(".PagePromo, .PagePromoTrending")) ||
      postElement.closest(".PagePromo, .PagePromoTrending");

    if (promo) {
      const promoContent = promo.querySelector(".PagePromo-content");
      if (promoContent) {
        return {
          container: promo,
          referenceElement: promoContent,
          insertPosition: "after",
          postWrapper: promo,
        };
      }

      return {
        container: promo,
        referenceElement: null,
        insertPosition: "append",
        postWrapper: promo,
      };
    }
  }

  if (USA_TODAY_HOST_RE.test(hostname)) {
    if (postElement.matches("main h1, article h1, h1")) {
      return findInjectionAfterSelectors(postElement, ["p", "h1"]);
    }
    if (
      postElement instanceof HTMLAnchorElement &&
      postElement.href.includes("/story/")
    ) {
      const parent = postElement.parentElement;
      if (parent) {
        return {
          container: parent,
          referenceElement: postElement,
          insertPosition: "after",
          postWrapper: postElement,
        };
      }
    }
    return findInjectionAfterSelectors(postElement, [
      ".gnt_m_tli_c",
      ".gnt_m_he",
      "h2",
      "h3",
      "p",
    ]);
  }

  if (isIndiaTimesEditorialHost()) {
    if (postElement.matches("h1")) {
      return findInjectionAfterSelectors(postElement, ["p", "h1"]);
    }
    if (
      postElement instanceof HTMLAnchorElement &&
      postElement.matches(INDIA_TIMES_STORY_LINK_SELECTORS.join(", "))
    ) {
      const parent = postElement.parentElement;
      if (parent) {
        return {
          container: parent,
          referenceElement: postElement,
          insertPosition: "after",
          postWrapper: postElement,
        };
      }
    }
    return findInjectionAfterSelectors(postElement, ["h2", "h3", "span", "p"]);
  }

  return null;
}

export function hasNewsEditorialInjectedCard(
  postElement: Element
): boolean | null {
  const hostname = window.location.hostname;

  if (FT_HOST_RE.test(hostname) && postElement.matches("main h1")) {
    const nextSibling = postElement.nextElementSibling as HTMLElement | null;
    return (
      nextSibling?.getAttribute("data-knoww-injected") === "true" ||
      !!postElement.querySelector(".knoww-market-card")
    );
  }

  if (USA_TODAY_HOST_RE.test(hostname)) {
    if (postElement.matches("main h1, article h1, h1")) {
      const nextSibling = postElement.nextElementSibling as HTMLElement | null;
      return (
        nextSibling?.getAttribute("data-knoww-injected") === "true" ||
        !!postElement.querySelector(".knoww-market-card")
      );
    }

    const afterAnchor = postElement.nextElementSibling as HTMLElement | null;
    return (
      afterAnchor?.getAttribute("data-knoww-injected") === "true" ||
      !!postElement.querySelector(".knoww-market-card")
    );
  }

  if (isIndiaTimesEditorialHost()) {
    if (postElement.matches("h1")) {
      const nextSibling = postElement.nextElementSibling as HTMLElement | null;
      return (
        nextSibling?.getAttribute("data-knoww-injected") === "true" ||
        !!postElement.querySelector(".knoww-market-card")
      );
    }
    const afterAnchor = postElement.nextElementSibling as HTMLElement | null;
    return (
      afterAnchor?.getAttribute("data-knoww-injected") === "true" ||
      !!postElement.querySelector(".knoww-market-card")
    );
  }

  return null;
}
