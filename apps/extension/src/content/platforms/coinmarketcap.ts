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
  "[class*='post-text']",
  "p",
  "h1",
  "h2",
  "h3",
  "[class*='title']",
  "[class*='headline']",
];

const LINK_PATTERN = /\/(?:community|academy|currencies)\/([^/?#]+)/i;

const CoinMarketCapAdapter = createBasicAdapter({
  name: "coinmarketcap",
  hostPatterns: [/^(?:www\.)?coinmarketcap\.com$/],
  itemSelectors: [
    "[data-test='community-post']",
    "section[class*='post-item']",
  ],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: TEXT_SELECTORS,
  accentColor: "#3861fb",
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
        "data-post-id",
        "data-id",
        "data-testid",
        "id",
      ]) || extractPostIdFromLink(postElement, LINK_PATTERN)
    );
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    if (!postElement.parentElement) return null;
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement,
    };
  },
});

registerAdapterWithRetry(CoinMarketCapAdapter, 100, 50);

export { CoinMarketCapAdapter };
