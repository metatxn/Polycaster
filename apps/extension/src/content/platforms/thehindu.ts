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

const THE_HINDU_HOST_RE = /^(?:www\.)?thehindu\.com$/i;

const THE_HINDU_CONTAINER_SELECTORS = ["main", "body"] as const;

const THE_HINDU_PRIMARY_LINK_SELECTORS = [
  'h3.title a[href*="thehindu.com/"][href$=".ece"]',
  'h3.title a[href$=".ece"]',
  'h1.title a[href*="thehindu.com/"][href$=".ece"]',
  'h1.title a[href$=".ece"]',
  '.sub-text a[href*="thehindu.com/"][href$=".ece"]',
  '.sub-text a[href$=".ece"]',
  'a.picture[href*="thehindu.com/"][href$=".ece"]',
  'a.picture[href$=".ece"]',
  'a.element[href*="thehindu.com/"][href$=".ece"]',
  'a.element[href$=".ece"]',
  'a[href*="thehindu.com/"][href$=".ece"]',
  'a[href$=".ece"]',
] as const;

const THE_HINDU_FEED_ITEM_ROOT_SELECTORS = [
  '.three-d-carousel-container .carousel .card:has(a.element[href$=".ece"])',
  'li.story-item:has(h3.title a[href$=".ece"])',
  '.element.main-row-element:has(h3.title a[href$=".ece"])',
  '.element.row-element.wide:has(h3.title a[href$=".ece"])',
  '.element.row-element.smaller:has(h3.title a[href$=".ece"])',
  '.element.row-element:has(h3.title a[href$=".ece"])',
  '.element.bigger:has(h3.title a[href$=".ece"])',
  '.element.smaller:has(h3.title a[href$=".ece"])',
  '.element:has(h1.title a[href$=".ece"])',
  '.element:has(h3.title a[href$=".ece"])',
] as const;

const THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS = [
  'h1[itemprop="name"].title',
  'h1[itemprop="name"]',
  "h1.title.premium",
  "h1.title",
] as const;

const THE_HINDU_TITLE_SELECTORS = [
  'h1[itemprop="name"].title',
  'h1[itemprop="name"]',
  "h1.title",
  "h3.title.big",
  "h3.title",
  ".right-content .title.big",
  ".right-content .title",
  ".content .title",
  ".title",
] as const;

const THE_HINDU_SUMMARY_SELECTORS = [
  ".sub-text a",
  ".sub-text",
  ".articlebodycontent .schemaDiv > p:first-of-type",
] as const;

const THE_HINDU_ECE_SLUG_PATTERN = /\/([^/?#]+)\.ece(?:[?#].*)?$/i;

function isTheHinduArticlePage(): boolean {
  return (
    /\.ece(?:$|[?#])/i.test(window.location.pathname) &&
    !!document.querySelector(THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  );
}

function getTheHinduArticleScope(postElement: Element): Element {
  return (
    postElement.closest(".articlepaywall") ||
    postElement.closest("article") ||
    document.querySelector(".articlebodycontent") ||
    postElement.parentElement ||
    postElement
  );
}

function getTheHinduStoryScope(postElement: Element): Element {
  if (postElement.matches(THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return getTheHinduArticleScope(postElement);
  }

  return (
    postElement.closest("li.story-item") ||
    postElement.closest(".three-d-carousel-container .card") ||
    postElement.closest(".element") ||
    postElement
  );
}

function getTheHinduPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getTheHinduStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    THE_HINDU_PRIMARY_LINK_SELECTORS
  );
}

function extractTheHinduFeedText(postElement: Element): string {
  const scope = getTheHinduStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, THE_HINDU_TITLE_SELECTORS) ||
    normalizeText(getTheHinduPrimaryLink(postElement)?.textContent);
  const summary = getFirstMatchingText(scope, THE_HINDU_SUMMARY_SELECTORS);

  return combineTextParts([title, summary]);
}

function extractTheHinduPostText(postElement: Element): string {
  if (postElement.matches(THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const title =
      normalizeText(postElement.textContent) ||
      normalizeText(
        document
          .querySelector('meta[itemprop="headline"]')
          ?.getAttribute("content")
      );
    const summary =
      normalizeText(
        document
          .querySelector('meta[itemprop="description"]')
          ?.getAttribute("content")
      ) || getDocumentDescription();

    return combineTextParts([title, summary]);
  }

  return extractTheHinduFeedText(postElement);
}

function getTheHinduPostId(postElement: Element): string | null {
  if (
    postElement.matches(THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS.join(", ")) &&
    window.location.pathname !== "/"
  ) {
    return window.location.pathname;
  }

  const primaryLink = getTheHinduPrimaryLink(postElement);
  const href = primaryLink?.getAttribute("href") || primaryLink?.href || "";
  const match = href.match(THE_HINDU_ECE_SLUG_PATTERN);
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

function getTheHinduDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    THE_HINDU_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isTheHinduArticlePage()) {
    return {
      itemSelector: THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = THE_HINDU_FEED_ITEM_ROOT_SELECTORS.map(
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

function findTheHinduArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getTheHinduArticleScope(postElement);
  const firstParagraph = document.querySelector(
    ".articlebodycontent .schemaDiv > p"
  );

  if (firstParagraph?.parentElement) {
    return {
      container: firstParagraph.parentElement,
      referenceElement: firstParagraph,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  const title = document.querySelector(
    THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS.join(", ")
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

function findTheHinduFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getTheHinduStoryScope(postElement);
  const listItem = scope.closest("li.story-item");

  if (listItem?.parentElement) {
    return {
      container: listItem.parentElement,
      referenceElement: listItem,
      insertPosition: "after",
      postWrapper: listItem,
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

function findTheHinduInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (postElement.matches(THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return findTheHinduArticleInjectionPoint(postElement);
  }

  return findTheHinduFeedInjectionPoint(postElement);
}

function hasTheHinduInjectedCard(postElement: Element): boolean {
  if (postElement.matches(THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const firstParagraph = document.querySelector(
      ".articlebodycontent .schemaDiv > p"
    );
    const articleScope = getTheHinduArticleScope(postElement);

    return (
      (firstParagraph ? hasInjectedCardSibling(firstParagraph) : false) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getTheHinduStoryScope(postElement);
  const listItem = scope.closest("li.story-item");

  return (
    (listItem
      ? hasInjectedCardSibling(listItem)
      : hasInjectedCardSibling(scope)) ||
    !!scope.querySelector(".knoww-market-card")
  );
}

function getTheHinduWrapperStyles(): string {
  return getFullWidthCardWrapperStyles({ listStyleNone: true });
}

const TheHinduAdapter = createBasicAdapter({
  name: "thehindu",
  hostPatterns: [THE_HINDU_HOST_RE],
  // Regional homepage modules sometimes mix non-English schema snippets into
  // otherwise English headlines, which makes the generic detector too brittle.
  bypassEnglishCheck: true,
  itemSelectors: [
    ...THE_HINDU_FEED_ITEM_ROOT_SELECTORS,
    ...THE_HINDU_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...THE_HINDU_CONTAINER_SELECTORS],
  textSelectors: [...THE_HINDU_TITLE_SELECTORS, ...THE_HINDU_SUMMARY_SELECTORS],
  accentColor: "#9b1c1c",
  fontFamily:
    'Merriweather, Georgia, "Times New Roman", "Source Serif 4", serif',
  borderRadius: "12px",
  extractPostText: extractTheHinduPostText,
  getPostId: getTheHinduPostId,
  findInjectionPoint: findTheHinduInjectionPoint,
  getDynamicSelectors: getTheHinduDynamicSelectors,
  getWrapperStyles: getTheHinduWrapperStyles,
  hasInjectedCard: hasTheHinduInjectedCard,
});

registerAdapterWithRetry(TheHinduAdapter, 100, 50);

export { TheHinduAdapter };
