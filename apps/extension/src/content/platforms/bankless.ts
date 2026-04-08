import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
  combineTextParts,
  extractPostIdFromAttributes,
  extractPostIdFromLink,
  normalizeText,
} from "./helpers";

const FEED_TEXT_SELECTORS = [
  "div.title",
  "p.description",
  "h2",
  "h3",
  "[class*='title']",
  "[class*='headline']",
];

const ARTICLE_TEXT_SELECTORS = [
  "h1",
  "h2",
  "h3",
  "p",
  "blockquote",
  "li",
  "[class*='title']",
];

const LINK_PATTERN = /\/read\/([^/?#]+)/i;

const BanklessAdapter = createBasicAdapter({
  name: "bankless",
  hostPatterns: [/^(?:www\.)?bankless\.com$/],
  itemSelectors: [
    "div.contentGroupCard.article",
    "div.homeFeatured",
    "div.postContentScrollspy",
  ],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: FEED_TEXT_SELECTORS,
  accentColor: "#e11d48",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const isArticlePage = postElement.classList.contains(
      "postContentScrollspy"
    );

    const selectors = isArticlePage
      ? ARTICLE_TEXT_SELECTORS
      : FEED_TEXT_SELECTORS;

    const title = normalizeText(
      postElement.querySelector("div.title, h1, h2, h3")?.textContent
    );
    const parts = collectTextParts(postElement, selectors);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    const fromAttr = extractPostIdFromAttributes(postElement, [
      "data-id",
      "data-post-id",
      "data-testid",
      "id",
    ]);
    if (fromAttr) return fromAttr;

    const fromLink = extractPostIdFromLink(postElement, LINK_PATTERN);
    if (fromLink) return fromLink;

    if (postElement.classList.contains("postContentScrollspy")) {
      const match = window.location.pathname.match(LINK_PATTERN);
      if (match) return `bankless-article-${match[1]}`;
    }

    return null;
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    if (postElement.classList.contains("postContentScrollspy")) {
      if (!postElement.parentElement) return null;
      return {
        container: postElement.parentElement,
        referenceElement: postElement,
        insertPosition: "after",
        postWrapper: postElement,
      };
    }

    if (postElement.classList.contains("contentGroupCard")) {
      // Feed cards live inside a horizontal scroller:
      //   div.contentGroup → div.scroll → div.contentGroupCard.article
      // Injecting between scroller children causes overlap. Instead,
      // inject after the scroller's parent (div.contentGroup) so the
      // card appears below the entire carousel section.
      const scroller = postElement.parentElement;
      const sectionWrapper = scroller?.parentElement;
      if (!sectionWrapper?.parentElement) return null;
      return {
        container: sectionWrapper.parentElement,
        referenceElement: sectionWrapper,
        insertPosition: "after",
        postWrapper: sectionWrapper,
      };
    }

    if (postElement.classList.contains("homeFeatured")) {
      // Featured cards: div.homeFeatured → div.col-6 (or similar)
      // Inject after the column wrapper so the card sits below the
      // featured card without breaking the grid layout.
      const colWrapper = postElement.parentElement;
      if (!colWrapper?.parentElement) return null;
      return {
        container: colWrapper.parentElement,
        referenceElement: colWrapper,
        insertPosition: "after",
        postWrapper: colWrapper,
      };
    }

    if (!postElement.parentElement) return null;
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement,
    };
  },
});

registerAdapterWithRetry(BanklessAdapter, 100, 50);

export { BanklessAdapter };
