import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
  combineTextParts,
  extractPostIdFromLink,
  normalizeText,
} from "./helpers";

const FEED_TEXT_SELECTORS = [
  "h3",
  "p:not([class*='items-center']):not([class*='leading-none'])",
];

const ARTICLE_TEXT_SELECTORS = ["h1", "h2", "h3", "p", "blockquote", "li"];

const LINK_PATTERN = /\/(\d+\/[^/?#]+)$/i;

const DecryptAdapter = createBasicAdapter({
  name: "decrypt",
  hostPatterns: [/^(?:www\.)?decrypt\.co$/],
  itemSelectors: [
    "article.linkbox.flex:not(.inline-flex)",
    "div.unreset.post-content",
  ],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: FEED_TEXT_SELECTORS,
  accentColor: "#a78bfa",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const isArticlePage = postElement.classList.contains("post-content");
    const selectors = isArticlePage
      ? ARTICLE_TEXT_SELECTORS
      : FEED_TEXT_SELECTORS;

    const titleEl = postElement.querySelector(isArticlePage ? "h1, h2" : "h3");
    const title = normalizeText(titleEl?.textContent);
    const parts = collectTextParts(postElement, selectors);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    const isArticlePage = postElement.classList.contains("post-content");
    if (isArticlePage) {
      const slug = window.location.pathname.match(LINK_PATTERN);
      return slug?.[1] || null;
    }
    return extractPostIdFromLink(postElement, LINK_PATTERN);
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    const isArticlePage = postElement.classList.contains("post-content");

    if (isArticlePage) {
      if (!postElement.parentElement) return null;
      return {
        container: postElement.parentElement,
        referenceElement: postElement,
        insertPosition: "after",
        postWrapper: postElement,
      };
    }

    // article → div.col-span (grid cell) → div.md:grid (grid) → div.pt-10 (section wrapper)
    const gridCell = postElement.parentElement;
    const grid = gridCell?.parentElement;
    const sectionWrapper = grid?.parentElement;
    if (!sectionWrapper) return null;
    return {
      container: sectionWrapper,
      referenceElement: grid,
      insertPosition: "after",
      postWrapper: grid,
    };
  },
});

registerAdapterWithRetry(DecryptAdapter, 100, 50);

export { DecryptAdapter };
