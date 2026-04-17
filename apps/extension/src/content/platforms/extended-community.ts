import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
  combineTextParts,
  extractPostIdFromAttributes,
  extractPostIdFromLink,
  GENERIC_LINK_PATTERN,
} from "./helpers";

const SOYLENT_STORY_LINK_PATTERN = /[?&]sid=([^&#]+)/i;
const SOYLENT_STORY_SELECTOR = ".article";
const SOYLENT_STORY_LINK_SELECTOR = ".title a[href*='article.pl?sid=']";
const SOYLENT_STORY_ID_SELECTOR = ".sd-key-sid";
const SOYLENT_STORY_LINKS_SELECTOR = ".storylinks";
const SOYLENT_TEXT_SELECTORS = [
  ".title h3",
  ".details",
  ".topicname",
  "p",
  "blockquote",
  "li",
];
const COMMUNITY_ITEM_SELECTORS = [
  ".topic",
  ".topic-with-excerpt",
  ".entry",
  ".post",
  ".postbody",
  ".comment",
  ".commentbody",
  ".comment-body",
  ".submission",
  ".thread",
  ".message",
  SOYLENT_STORY_SELECTOR,
  "main > article",
  "article",
];
const COMMUNITY_CONTAINER_SELECTORS = [
  "#articles",
  "main",
  "#content",
  '[role="main"]',
  "body",
];
const COMMUNITY_TEXT_SELECTORS = [
  ".topic-title",
  ".topic-text-excerpt",
  ".entry-title",
  ".entry-content",
  ".postbody",
  ".commentbody",
  ".comment-body",
  ".message-content",
  ".thread-title",
  "h1",
  "h2",
  "h3",
  "p",
  "blockquote",
  "li",
  "[class*='title']",
  "[class*='excerpt']",
  "[class*='summary']",
];
const COMMUNITY_REFERENCE_SELECTORS = [
  ".topic",
  ".entry",
  ".post",
  ".postbody",
  ".comment",
  ".comment-body",
  ".message",
  SOYLENT_STORY_LINKS_SELECTOR,
  SOYLENT_STORY_LINK_SELECTOR,
  "article",
  "h1",
  "h2",
  "p",
];

// tildes.net was previously listed here, but `findInjectionPoint` returns
// `null` for every non-Soylent host, so Tildes could never surface inline
// cards and the notification stack (which is fed only from successfully
// injected markets) stayed empty. The host is removed from both this pattern
// list and `SUPPORTED_MATCH_PATTERNS` until a real Tildes adapter ships.
const COMMUNITY_HOST_PATTERNS = [/^(?:www\.)?soylentnews\.org$/];

function isSoylentNewsHost(hostname = window.location.hostname): boolean {
  return /^(?:www\.)?soylentnews\.org$/.test(hostname);
}

function findSoylentStoryRoot(postElement: Element): Element {
  return (
    (postElement.matches(SOYLENT_STORY_SELECTOR)
      ? postElement
      : postElement.closest(SOYLENT_STORY_SELECTOR)) || postElement
  );
}

function getSoylentStoryId(postElement: Element): string | null {
  const root = findSoylentStoryRoot(postElement);
  const sidText = root
    .querySelector(SOYLENT_STORY_ID_SELECTOR)
    ?.textContent?.trim();
  if (sidText) {
    return sidText;
  }

  const href =
    root
      .querySelector<HTMLAnchorElement>(SOYLENT_STORY_LINK_SELECTOR)
      ?.getAttribute("href") || "";
  return href.match(SOYLENT_STORY_LINK_PATTERN)?.[1] || null;
}

function extractSoylentPostText(postElement: Element): string {
  const root = findSoylentStoryRoot(postElement);
  return combineTextParts(collectTextParts(root, SOYLENT_TEXT_SELECTORS));
}

function findSoylentInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const root = findSoylentStoryRoot(postElement);
  const storyLinks = root.querySelector(SOYLENT_STORY_LINKS_SELECTOR);
  if (storyLinks?.parentElement) {
    return {
      container: storyLinks.parentElement,
      referenceElement: storyLinks,
      insertPosition: "before",
      postWrapper: root,
    };
  }

  return {
    container: root,
    referenceElement: null,
    insertPosition: "append",
    postWrapper: root,
  };
}

function getCommunityPostId(postElement: Element): string | null {
  return (
    extractPostIdFromAttributes(postElement, [
      "data-id",
      "data-post-id",
      "data-comment-id",
      "data-entry-id",
      "id",
    ]) ||
    extractPostIdFromLink(postElement, GENERIC_LINK_PATTERN) ||
    (window.location.pathname !== "/" && postElement.querySelector("h1")
      ? window.location.pathname
      : null)
  );
}

const ExtendedCommunityAdapter = createBasicAdapter({
  name: "extended-community",
  hostPatterns: COMMUNITY_HOST_PATTERNS,
  itemSelectors: COMMUNITY_ITEM_SELECTORS,
  containerSelectors: COMMUNITY_CONTAINER_SELECTORS,
  textSelectors: COMMUNITY_TEXT_SELECTORS,
  referenceSelectors: COMMUNITY_REFERENCE_SELECTORS,
  accentColor: "#16a34a",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "10px",
  getPostId(postElement: Element): string | null {
    if (isSoylentNewsHost()) {
      return getSoylentStoryId(postElement) || getCommunityPostId(postElement);
    }

    return getCommunityPostId(postElement);
  },
  extractPostText(postElement: Element): string {
    if (isSoylentNewsHost()) {
      return extractSoylentPostText(postElement);
    }

    return combineTextParts(
      collectTextParts(postElement, COMMUNITY_TEXT_SELECTORS)
    );
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    if (isSoylentNewsHost()) {
      return findSoylentInjectionPoint(postElement);
    }

    // Other community hosts currently support relevance analysis / stack items
    // only; they do not yet have stable feed anchors for inline card injection.
    return null;
  },
  getDynamicSelectors(): { itemSelector: string; containerSelector: string } {
    if (isSoylentNewsHost()) {
      const containerSelector =
        COMMUNITY_CONTAINER_SELECTORS.find((selector) =>
          document.querySelector(selector)
        ) || "body";

      return {
        itemSelector: SOYLENT_STORY_SELECTOR,
        containerSelector,
      };
    }

    const containerSelector =
      COMMUNITY_CONTAINER_SELECTORS.find((selector) =>
        document.querySelector(selector)
      ) || "body";

    return {
      itemSelector: COMMUNITY_ITEM_SELECTORS.join(", "),
      containerSelector,
    };
  },
});

registerAdapterWithRetry(ExtendedCommunityAdapter, 100, 50);

export { ExtendedCommunityAdapter };
