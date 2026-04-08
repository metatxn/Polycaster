import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { collectTextParts, combineTextParts, normalizeText } from "./helpers";

const HOME_TEXT_SELECTORS = [
  "a.post-title",
  "div.description",
  "h2",
  "h3",
  "[class*='title']",
];

const NEWS_TEXT_SELECTORS = [
  "h3",
  "div.post-teaser",
  "p.cat-group",
  "[class*='title']",
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

const LINK_PATTERN = /unchainedcrypto\.com\/([a-z][\w-]+)\/?$/i;

const UnchainedAdapter = createBasicAdapter({
  name: "unchained",
  hostPatterns: [/^(?:www\.)?unchainedcrypto\.com$/],
  itemSelectors: ["div.archive-item", "div.post", "div.post-inner"],
  containerSelectors: [
    "div.alm-listing",
    "div.feed",
    "div.posts",
    "main",
    '[role="main"]',
    "body",
  ],
  textSelectors: HOME_TEXT_SELECTORS,
  accentColor: "#0f766e",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    const isArchiveItem = postElement.classList.contains("archive-item");
    const isHomeFeed =
      postElement.classList.contains("post") ||
      postElement.classList.contains("post-inner");

    let selectors: string[];
    if (isArchiveItem) {
      selectors = NEWS_TEXT_SELECTORS;
    } else if (isHomeFeed) {
      selectors = HOME_TEXT_SELECTORS;
    } else {
      selectors = ARTICLE_TEXT_SELECTORS;
    }

    const title = normalizeText(
      postElement.querySelector("a.post-title, h1, h2, h3")?.textContent
    );
    const parts = collectTextParts(postElement, selectors);
    return combineTextParts(title ? [title, ...parts] : parts);
  },
  getPostId(postElement: Element): string | null {
    const link = postElement.querySelector(
      "a.post-title, a[href*='unchainedcrypto.com']"
    );
    if (link) {
      const href = link.getAttribute("href") || "";
      const match = href.match(LINK_PATTERN);
      if (match) return `unchained-${match[1]}`;
    }

    const match = window.location.pathname.match(/\/([^/?#]+)\/?$/i);
    if (match && match[1] !== "news") return `unchained-article-${match[1]}`;

    return null;
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    if (postElement.classList.contains("archive-item")) {
      // /news/ page: group-posts → individual-post → archive-item
      // Inject after individual-post inside group-posts so the card
      // sits below the full news item (image + title block).
      const individualPost = postElement.parentElement;
      const groupPosts = individualPost?.parentElement;
      if (!groupPosts) return null;
      return {
        container: groupPosts,
        referenceElement: individualPost,
        insertPosition: "after",
        postWrapper: individualPost,
      };
    }

    // Homepage feed: div.feed → div.post
    if (!postElement.parentElement) return null;
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement,
    };
  },
});

registerAdapterWithRetry(UnchainedAdapter, 100, 50);

export { UnchainedAdapter };
