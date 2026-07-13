import type { InjectionPoint, PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import { combineTextParts, normalizeText } from "./helpers";
import {
  findPrimaryLinkFromSelectors,
  getDocumentDescription,
  getFirstMatchingText,
  getFullWidthCardWrapperStyles,
  hasInjectedCardSibling,
  stripMediaFromClone,
} from "./story-adapter-helpers";

const CNN_HOST_RE = /^(?:www\.|edition\.)?cnn\.com$/i;

const CNN_CONTAINER_SELECTORS = [
  "section.layout__main",
  'div.section[role="main"]',
  '[role="main"]',
  "main",
  "body",
] as const;

const CNN_PRIMARY_LINK_SELECTORS = [
  'a.container__link[href^="/"]',
  'a.container__link[href*="://www.cnn.com/"]',
  'a.container__link[href*="://edition.cnn.com/"]',
] as const;

const CNN_FEED_ITEM_ROOT_SELECTORS = [
  `li[data-component-name="card"]:not(:has(li[data-component-name="card"])):has(${CNN_PRIMARY_LINK_SELECTORS[0]})`,
  `div[data-component-name="card"]:not(:has([data-component-name="card"])):has(${CNN_PRIMARY_LINK_SELECTORS[0]})`,
  `li[data-component-name="card"]:not(:has(li[data-component-name="card"])):has(${CNN_PRIMARY_LINK_SELECTORS[1]})`,
  `div[data-component-name="card"]:not(:has([data-component-name="card"])):has(${CNN_PRIMARY_LINK_SELECTORS[1]})`,
  `li[data-component-name="card"]:not(:has(li[data-component-name="card"])):has(${CNN_PRIMARY_LINK_SELECTORS[2]})`,
  `div[data-component-name="card"]:not(:has([data-component-name="card"])):has(${CNN_PRIMARY_LINK_SELECTORS[2]})`,
] as const;

const CNN_ARTICLE_ITEM_ROOT_SELECTORS = [
  'h1[data-editable="headlineText"]',
  "h1.headline__text",
  "article h1",
  "main h1",
] as const;

const CNN_TITLE_SELECTORS = [
  ".container__headline-text",
  'h1[data-editable="headlineText"]',
  "h1.headline__text",
  "h1",
  "h2",
] as const;

function isCnnArticlePage(): boolean {
  return (
    window.location.pathname !== "/" &&
    !!document.querySelector(CNN_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  );
}

function getCnnStoryScope(postElement: Element): Element {
  if (postElement.matches(CNN_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return (
      postElement.closest('[data-component-name="headline"]') ||
      postElement.closest("section.layout-article-elevate__top") ||
      postElement.closest("article, main") ||
      postElement.parentElement ||
      postElement
    );
  }

  return (
    postElement.closest('li[data-component-name="card"]') ||
    postElement.closest('div[data-component-name="card"]') ||
    postElement
  );
}

function getCnnPrimaryLink(postElement: Element): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getCnnStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    CNN_PRIMARY_LINK_SELECTORS
  );
}

function getCnnArticleReferenceElement(
  postElement: Element,
  scope: Element
): Element {
  return (
    scope.querySelector(".headline__footer") ||
    scope.querySelector(".headline__sub-container") ||
    scope.querySelector(".headline__sub-text") ||
    postElement
  );
}

function getCnnCardContextText(scope: Element, title: string): string {
  const primaryLink = getCnnPrimaryLink(scope);
  if (!primaryLink) {
    return "";
  }

  const clone = stripMediaFromClone(primaryLink);
  clone
    .querySelectorAll(
      ".container__text-label, .container__label-metadata, .card__live-story-timestamp, .container__video-duration, svg"
    )
    .forEach((element) => {
      element.remove();
    });

  const text = normalizeText(clone.textContent);
  if (!text || text === title || text.length <= title.length + 8) {
    return "";
  }

  return text;
}

function extractCnnPostText(postElement: Element): string {
  if (postElement.matches(CNN_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const title = normalizeText(postElement.textContent);
    const summary = getDocumentDescription();
    const articleText = combineTextParts([title, summary]);
    if (articleText) {
      return articleText;
    }
  }

  const scope = getCnnStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, CNN_TITLE_SELECTORS) ||
    normalizeText(
      getCnnPrimaryLink(postElement)?.querySelector(".container__headline-text")
        ?.textContent
    ) ||
    normalizeText(getCnnPrimaryLink(postElement)?.textContent);
  const context = getCnnCardContextText(scope, title);

  return combineTextParts([title, context]);
}

function normalizeCnnPathId(value: string | null): string | null {
  const cleaned = normalizeText(value);
  if (!cleaned) {
    return null;
  }

  try {
    const url = new URL(cleaned, window.location.origin);
    return normalizeText(url.pathname) || null;
  } catch {
    return cleaned;
  }
}

function getCnnPostId(postElement: Element): string | null {
  if (
    postElement.matches(CNN_ARTICLE_ITEM_ROOT_SELECTORS.join(", ")) &&
    window.location.pathname !== "/"
  ) {
    return window.location.pathname;
  }

  const primaryLink = getCnnPrimaryLink(postElement);
  if (primaryLink) {
    const pathId = normalizeCnnPathId(
      primaryLink.getAttribute("href") || primaryLink.href
    );
    if (pathId) {
      return pathId;
    }
  }

  const scope = getCnnStoryScope(postElement);
  return (
    normalizeCnnPathId(scope.getAttribute("data-open-link")) ||
    normalizeCnnPathId(scope.getAttribute("data-page")) ||
    normalizeCnnPathId(scope.getAttribute("data-uri"))
  );
}

function getCnnDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    CNN_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isCnnArticlePage()) {
    return {
      itemSelector: CNN_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = CNN_FEED_ITEM_ROOT_SELECTORS.map(
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

function findCnnInjectionPoint(postElement: Element): InjectionPoint | null {
  if (postElement.matches(CNN_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const scope = getCnnStoryScope(postElement);
    const referenceElement = getCnnArticleReferenceElement(postElement, scope);
    const container = referenceElement.parentElement || scope;

    return {
      container,
      referenceElement,
      insertPosition: "after",
      postWrapper: scope,
    };
  }

  const scope = getCnnStoryScope(postElement);
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

function hasCnnInjectedCard(postElement: Element): boolean {
  if (postElement.matches(CNN_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const scope = getCnnStoryScope(postElement);
    const referenceElement = getCnnArticleReferenceElement(postElement, scope);
    return (
      hasInjectedCardSibling(referenceElement) ||
      !!scope.querySelector(".knoww-market-card")
    );
  }

  const scope = getCnnStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getCnnWrapperStyles(): string {
  return getFullWidthCardWrapperStyles({ listStyleNone: true });
}

const CnnAdapter = createBasicAdapter({
  name: "cnn",
  hostPatterns: [CNN_HOST_RE],
  bypassEnglishCheck: true,
  itemSelectors: [
    ...CNN_FEED_ITEM_ROOT_SELECTORS,
    ...CNN_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...CNN_CONTAINER_SELECTORS],
  textSelectors: [...CNN_TITLE_SELECTORS],
  accentColor: "#c00",
  fontFamily:
    'cnn_sans_display, helveticaneue, Helvetica, Arial, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractCnnPostText,
  getPostId: getCnnPostId,
  findInjectionPoint: findCnnInjectionPoint,
  getDynamicSelectors: getCnnDynamicSelectors,
  getWrapperStyles: getCnnWrapperStyles,
  hasInjectedCard: hasCnnInjectedCard,
});

export const adapter: PlatformAdapter = CnnAdapter;

export { CnnAdapter };
