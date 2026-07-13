import type { InjectionPoint, PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import { collectTextParts, combineTextParts, normalizeText } from "./helpers";

const FEED_TEXT_SELECTORS = [
  "[class*='card-header-title']",
  "a",
  "p",
  "h1",
  "h2",
  "h3",
  "blockquote",
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

const LINK_PATTERN = /\/@[^/]+\/([^/?#]+)/i;

const ParagraphAdapter = createBasicAdapter({
  name: "paragraph",
  hostPatterns: [/^(?:.+\.)?paragraph\.com$/],
  itemSelectors: [
    "div.bg-card.text-card-foreground",
    "div[class*='ProseMirror']",
  ],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: FEED_TEXT_SELECTORS,
  accentColor: "#0f172a",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const isProseMirror = postElement.classList.contains("ProseMirror");
    const selectors = isProseMirror
      ? ARTICLE_TEXT_SELECTORS
      : FEED_TEXT_SELECTORS;
    const title = normalizeText(
      postElement.querySelector("[class*='card-header-title'], h1, h2")
        ?.textContent
    );
    const parts = collectTextParts(postElement, selectors);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    const link = postElement.querySelector("a[href*='/@']");
    if (link) {
      const match = link.getAttribute("href")?.match(LINK_PATTERN);
      if (match?.[1]) return match[1];
    }
    const urlMatch = window.location.pathname.match(LINK_PATTERN);
    return urlMatch?.[1] ?? null;
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

export const adapter: PlatformAdapter = ParagraphAdapter;

export { ParagraphAdapter };
