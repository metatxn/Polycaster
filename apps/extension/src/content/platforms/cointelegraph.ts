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
  ".post-card-inline__title",
  "p.post-card-inline__text",
  ".post-card-inline__title-link",
];

const ARTICLE_TEXT_SELECTORS = [
  "h1",
  "h2",
  "h3",
  "p",
  "blockquote",
  "li",
  ".ct-prose",
];

const LINK_PATTERN = /\/news\/([^/?#]+)/i;

const CointelegraphAdapter = createBasicAdapter({
  name: "cointelegraph",
  hostPatterns: [/^(?:www\.)?cointelegraph\.com$/],
  itemSelectors: ["article.post-card-inline", "article"],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: FEED_TEXT_SELECTORS,
  accentColor: "#f0b90b",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const isFeedCard = postElement.classList.contains("post-card-inline");
    const selectors = isFeedCard ? FEED_TEXT_SELECTORS : ARTICLE_TEXT_SELECTORS;

    const titleEl = postElement.querySelector(
      isFeedCard
        ? ".post-card-inline__title, .post-card-inline__title-link"
        : "h1"
    );
    const title = normalizeText(titleEl?.textContent);
    const parts = collectTextParts(postElement, selectors);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    const isFeedCard = postElement.classList.contains("post-card-inline");
    if (!isFeedCard) {
      const slug = window.location.pathname.match(LINK_PATTERN);
      return slug?.[1] || null;
    }
    return extractPostIdFromLink(postElement, LINK_PATTERN);
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    const isFeedCard = postElement.classList.contains("post-card-inline");

    if (isFeedCard) {
      const li = postElement.parentElement;
      if (!li?.parentElement) return null;
      return {
        container: li.parentElement,
        referenceElement: li,
        insertPosition: "after",
        postWrapper: li,
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

registerAdapterWithRetry(CointelegraphAdapter, 100, 50);

export { CointelegraphAdapter };
