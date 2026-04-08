import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { collectTextParts, combineTextParts, normalizeText } from "./helpers";

const FEED_TEXT_SELECTORS = [
  "h3[class*='Title-sc']",
  "h3",
  "h2",
  "[class*='SubtitleContainer']",
  "[class*='PreviewContainer']",
  "[class*='Main-sc-15cb59b9']",
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

const LINK_PATTERN = /beincrypto\.com\/([a-z][\w-]+-[\w-]+)\/?/i;

const BeInCryptoAdapter = createBasicAdapter({
  name: "beincrypto",
  hostPatterns: [/^(?:www\.)?beincrypto\.com$/],
  itemSelectors: [
    "div[class*='ContentCard-sc-765f8aa']",
    "div[class*='ArticleContent']",
    "div[class*='PostContent']",
  ],
  containerSelectors: [
    "main[class*='Main-sc']",
    "main",
    '[role="main"]',
    "body",
  ],
  textSelectors: FEED_TEXT_SELECTORS,
  accentColor: "#7c3aed",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const isArticlePage = !!postElement.className.match(
      /ArticleContent|PostContent/i
    );

    const selectors = isArticlePage
      ? ARTICLE_TEXT_SELECTORS
      : FEED_TEXT_SELECTORS;

    const title = normalizeText(
      postElement.querySelector("h1, h2, h3")?.textContent
    );
    const parts = collectTextParts(postElement, selectors);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    const link = postElement.querySelector("a[href*='beincrypto.com/']");
    if (link) {
      const href = link.getAttribute("href") || "";
      const match = href.match(LINK_PATTERN);
      if (match) return `bic-${match[1]}`;
    }

    const isArticlePage = !!postElement.className.match(
      /ArticleContent|PostContent/i
    );
    if (isArticlePage) {
      const match = window.location.pathname.match(/\/([^/?#]+)\/?$/i);
      if (match) return `bic-article-${match[1]}`;
    }

    return null;
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    // Content cards (div.ant-card.ContentCard-sc) are direct children of
    // <main>, so injecting after them as a sibling is clean and does not
    // break any grid/flex layout.
    if (!postElement.parentElement) return null;
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement,
    };
  },
});

registerAdapterWithRetry(BeInCryptoAdapter, 100, 50);

export { BeInCryptoAdapter };
