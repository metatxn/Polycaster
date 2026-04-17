import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  extractPostIdFromAttributes,
  extractPostIdFromLink,
  GENERIC_LINK_PATTERN,
} from "./helpers";

// manifold.markets has its own dedicated adapter (manifold-markets.ts) since
// its Tailwind-utility DOM needs bespoke extraction logic and Kalshi-style
// gate relaxation.
const MARKET_HOST_PATTERNS = [
  /^(?:www\.)?metaculus\.com$/,
  /^(?:www\.)?tradingview\.com$/,
  /^(?:www\.)?defillama\.com$/,
];

function getMarketPostId(postElement: Element): string | null {
  return (
    extractPostIdFromAttributes(postElement, [
      "data-id",
      "data-market-id",
      "data-question-id",
      "data-testid",
      "id",
    ]) ||
    extractPostIdFromLink(postElement, GENERIC_LINK_PATTERN) ||
    (window.location.pathname !== "/" && postElement.querySelector("h1")
      ? window.location.pathname
      : null)
  );
}

function findMarketInjectionPoint(postElement: Element): InjectionPoint | null {
  if (postElement.tagName.toLowerCase() === "a" && postElement.parentElement) {
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement,
    };
  }

  if (postElement.parentElement) {
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement,
    };
  }

  return {
    container: postElement,
    referenceElement: null,
    insertPosition: "append",
    postWrapper: postElement,
  };
}

const ExtendedMarketsAdapter = createBasicAdapter({
  name: "extended-markets",
  hostPatterns: MARKET_HOST_PATTERNS,
  itemSelectors: [
    "a[href*='/market/']",
    "a[href*='/markets/']",
    "a[href*='/question/']",
    "a[href*='/questions/']",
    "a[href*='/event/']",
    "[data-testid*='market']",
    "[data-testid*='question']",
    "[class*='market-card']",
    "[class*='question-card']",
    "main > article",
    "article",
  ],
  containerSelectors: ["main", '[role="main"]', "#__next", "#root", "body"],
  textSelectors: [
    "a[href*='/market/']",
    "a[href*='/questions/']",
    "h1",
    "h2",
    "h3",
    "p",
    "[class*='title']",
    "[class*='question']",
    "[class*='forecast']",
    "[class*='description']",
  ],
  referenceSelectors: [
    "[class*='market-card']",
    "[class*='market']",
    "[class*='question']",
    "a[href*='/market/']",
    "a[href*='/questions/']",
    "article",
    "h1",
    "h2",
    "p",
  ],
  accentColor: "#7c3aed",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  getPostId: getMarketPostId,
  findInjectionPoint: findMarketInjectionPoint,
});

registerAdapterWithRetry(ExtendedMarketsAdapter, 100, 50);

export { ExtendedMarketsAdapter };
