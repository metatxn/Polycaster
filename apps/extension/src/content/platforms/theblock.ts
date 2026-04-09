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

const TEXT_SELECTORS = [
  "h1",
  "h2",
  "h3",
  "p",
  "[class*='title']",
  "[class*='headline']",
  "[class*='summary']",
  "[class*='description']",
];

const LINK_PATTERN = /\/post\/([^/?#]+)/i;

const TheBlockAdapter = createBasicAdapter({
  name: "theblock",
  hostPatterns: [/^(?:www\.)?theblock\.co$/],
  itemSelectors: [
    "[class*='article-card']",
    "[class*='story-card']",
    "[class*='article']",
    "article",
  ],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: TEXT_SELECTORS,
  accentColor: "#0d9488",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const title = normalizeText(
      postElement.querySelector("h1, h2, h3, [class*='title']")?.textContent
    );
    const parts = collectTextParts(postElement, TEXT_SELECTORS);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    return (
      extractPostIdFromAttributes(postElement, [
        "data-id",
        "data-post-id",
        "data-testid",
        "id",
      ]) || extractPostIdFromLink(postElement, LINK_PATTERN)
    );
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    const parent = postElement.parentElement;
    if (!parent) return null;

    const separator = postElement.nextElementSibling;
    if (separator?.tagName === "HR" && separator.parentElement === parent) {
      return {
        container: parent,
        referenceElement: separator,
        insertPosition: "after",
        postWrapper: postElement,
      };
    }

    return {
      container: parent,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement,
    };
  },
});

registerAdapterWithRetry(TheBlockAdapter, 100, 50);

export { TheBlockAdapter };
