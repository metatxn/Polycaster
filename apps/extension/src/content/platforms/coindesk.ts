import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
  combineTextParts,
  extractPostIdFromLink,
  normalizeText,
} from "./helpers";

const FEED_TEXT_SELECTORS = ["h2", "p.font-body", ".content-card-title"];

const ARTICLE_TEXT_SELECTORS = [
  "h1",
  "h2",
  "h3",
  "p",
  "blockquote",
  "li",
  "[class*='title']",
  "[class*='headline']",
];

const LINK_PATTERN = /\/([^/?#]+)$/i;

const CoinDeskAdapter = createBasicAdapter({
  name: "coindesk",
  hostPatterns: [/^(?:www\.)?coindesk\.com$/],
  itemSelectors: [
    "div.shrink.justify-between",
    "[data-module-name='article-body']",
  ],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: FEED_TEXT_SELECTORS,
  accentColor: "#1740ff",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const isArticle =
      postElement.getAttribute("data-module-name") === "article-body";
    const selectors = isArticle ? ARTICLE_TEXT_SELECTORS : FEED_TEXT_SELECTORS;

    const titleEl = postElement.querySelector(
      isArticle ? "h1" : ".content-card-title, h2"
    );
    const title = normalizeText(titleEl?.textContent);
    const parts = collectTextParts(postElement, selectors);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    const isArticle =
      postElement.getAttribute("data-module-name") === "article-body";
    if (isArticle) {
      const slug = window.location.pathname.match(LINK_PATTERN);
      return slug?.[1] || null;
    }
    return extractPostIdFromLink(postElement, LINK_PATTERN);
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    const isArticle =
      postElement.getAttribute("data-module-name") === "article-body";

    if (isArticle) {
      if (!postElement.parentElement) return null;
      return {
        container: postElement.parentElement,
        referenceElement: postElement,
        insertPosition: "after",
        postWrapper: postElement,
      };
    }

    const wrapper = postElement.parentElement;
    if (!wrapper?.parentElement) return null;
    return {
      container: wrapper.parentElement,
      referenceElement: wrapper,
      insertPosition: "after",
      postWrapper: wrapper,
    };
  },
});

registerAdapterWithRetry(CoinDeskAdapter, 100, 50);

export { CoinDeskAdapter };
