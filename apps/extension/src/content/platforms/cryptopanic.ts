import type { InjectionPoint, PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import { collectTextParts, combineTextParts, normalizeText } from "./helpers";

const TEXT_SELECTORS = [
  "a[class*='nc-title']",
  "div[class*='nc-title']",
  "[class*='nc-currency']",
];

const CryptoPanicAdapter = createBasicAdapter({
  name: "cryptopanic",
  hostPatterns: [/^(?:www\.)?cryptopanic\.com$/],
  itemSelectors: ["div.news-row.news-row-link", "div.news-row.news-row-media"],
  containerSelectors: ["div.news", "div.news-container", "body"],
  textSelectors: TEXT_SELECTORS,
  accentColor: "#ea580c",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "8px",
  extractPostText(postElement: Element): string {
    const title = normalizeText(
      postElement.querySelector("a[class*='nc-title'], div[class*='nc-title']")
        ?.textContent
    );
    const parts = collectTextParts(postElement, TEXT_SELECTORS);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    const link = postElement.querySelector(
      "a[href*='/news/'], a.click-area[href]"
    );
    if (link) {
      const href = link.getAttribute("href") || "";
      const match =
        href.match(/\/news\/(\d+)\//i) || href.match(/\/news\/(\d+)/i);
      if (match) return `cpanic-${match[1]}`;
    }
    return null;
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    // News rows are stacked vertically inside div.news (display: block).
    // Injecting after the row as a sibling works cleanly.
    if (!postElement.parentElement) return null;
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement,
    };
  },
});

export const adapter: PlatformAdapter = CryptoPanicAdapter;

export { CryptoPanicAdapter };
