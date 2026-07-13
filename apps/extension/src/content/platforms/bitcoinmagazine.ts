import type { InjectionPoint, PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
  combineTextParts,
  extractPostIdFromAttributes,
  normalizeText,
} from "./helpers";

const FEED_TEXT_SELECTORS = [
  "h3.entry-title",
  ".td-excerpt",
  ".td-post-category",
  "[class*='title']",
  "[class*='excerpt']",
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

const LINK_PATTERN = /bitcoinmagazine\.com\/[^/]+\/([^/?#]+)/i;

const BitcoinMagazineAdapter = createBasicAdapter({
  name: "bitcoinmagazine",
  hostPatterns: [/^(?:www\.)?bitcoinmagazine\.com$/],
  itemSelectors: ["div.td_module_flex.td-cpt-post", "div.td-post-content"],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: FEED_TEXT_SELECTORS,
  accentColor: "#f7931a",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const isArticlePage = postElement.classList.contains("td-post-content");

    const selectors = isArticlePage
      ? ARTICLE_TEXT_SELECTORS
      : FEED_TEXT_SELECTORS;

    const title = normalizeText(
      postElement.querySelector("h1, h3.entry-title, h3")?.textContent
    );
    const parts = collectTextParts(postElement, selectors);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    const fromAttr = extractPostIdFromAttributes(postElement, [
      "data-id",
      "data-post-id",
      "data-testid",
      "id",
    ]);
    if (fromAttr) return fromAttr;

    const link = postElement.querySelector("a[href*='bitcoinmagazine.com']");
    if (link) {
      const href = link.getAttribute("href") || "";
      const match = href.match(LINK_PATTERN);
      if (match) return `btcmag-${match[1]}`;
    }

    if (postElement.classList.contains("td-post-content")) {
      const match = window.location.pathname.match(/\/([^/?#]+)$/i);
      if (match) return `btcmag-article-${match[1]}`;
    }

    return null;
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    if (postElement.classList.contains("td-post-content")) {
      if (!postElement.parentElement) return null;
      return {
        container: postElement.parentElement,
        referenceElement: postElement,
        insertPosition: "after",
        postWrapper: postElement,
      };
    }

    // Feed cards use inline-block layout inside td_block_inner, so
    // injecting between cards breaks the flow. Walk up two levels:
    //   td_module_flex (card) → td_block_inner (list) → td_block_wrap (section)
    // and inject after the whole section block.
    const blockInner = postElement.parentElement;
    const blockWrap = blockInner?.parentElement;
    if (!blockWrap?.parentElement) return null;
    return {
      container: blockWrap.parentElement,
      referenceElement: blockWrap,
      insertPosition: "after",
      postWrapper: blockWrap,
    };
  },
});

export const adapter: PlatformAdapter = BitcoinMagazineAdapter;

export { BitcoinMagazineAdapter };
