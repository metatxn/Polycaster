import type { InjectionPoint, PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
  combineTextParts,
  extractPostIdFromAttributes,
  extractPostIdFromLink,
  normalizeText,
} from "./helpers";

const FEED_TEXT_SELECTORS = [
  "a.font-headline",
  "h1",
  "h2",
  "h3",
  "p",
  "[class*='headline']",
  "[class*='summary']",
  "[class*='description']",
];

const LINK_PATTERN = /\/news\/([^/?#]+)/i;

const BlockworksAdapter = createBasicAdapter({
  name: "blockworks",
  hostPatterns: [/^(?:www\.)?blockworks\.com$/],
  itemSelectors: [
    "div.grid.grid-cols-1.h-full",
    "div[class*='grid-rows-[168px_minmax(168px,_1fr)]']",
    "article",
  ],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: FEED_TEXT_SELECTORS,
  accentColor: "#1d4ed8",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const title = normalizeText(
      postElement.querySelector("a.font-headline, h1, h2, h3")?.textContent
    );
    const parts = collectTextParts(postElement, FEED_TEXT_SELECTORS);
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
    const isArchiveCard =
      postElement.classList.contains("grid-cols-1") &&
      postElement.classList.contains("h-full") &&
      !!postElement.querySelector("a[href*='/news/']");

    if (isArchiveCard) {
      // DOM: outer-grid -> grid-cell (parent) -> div.grid.grid-cols-1.h-full (postElement)
      // Inject after the grid-cell in the outer-grid so the card appears
      // below the entire news card rather than inside it.
      const gridCell = postElement.parentElement;
      const outerGrid = gridCell?.parentElement;
      if (!outerGrid || !gridCell) return null;
      return {
        container: outerGrid,
        referenceElement: gridCell,
        insertPosition: "after",
        postWrapper: gridCell,
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

export const adapter: PlatformAdapter = BlockworksAdapter;

export { BlockworksAdapter };
