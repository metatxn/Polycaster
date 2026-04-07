// ============================================
// REDDIT PLATFORM ADAPTER
// Handles Reddit-specific DOM interactions
// ============================================

import type { CardStyles, InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { buildGenericCardStyles } from "./helpers";

function isRedditDarkMode(): boolean {
  const htmlDark =
    document.documentElement.classList.contains("theme-dark") ||
    document.documentElement.getAttribute("data-theme") === "dark";

  const bodyDark =
    document.body.classList.contains("theme-dark") ||
    document.body.style.colorScheme === "dark";

  if (!htmlDark && !bodyDark) {
    const bgColor = getComputedStyle(document.body).backgroundColor;
    const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const [, r, g, b] = match.map(Number);
      return r < 50 && g < 50 && b < 50;
    }
  }

  return htmlDark || bodyDark;
}

function detectRedditTheme(): "dark" | "light" {
  const themeOverride = window.KNOWW_CONFIG?.getThemeOverride?.();
  if (themeOverride && themeOverride !== "auto") {
    return themeOverride === "light" ? "light" : "dark";
  }

  return isRedditDarkMode() ? "dark" : "light";
}

function getRedditCardStyles(theme?: string): CardStyles {
  const activeTheme = (theme || detectRedditTheme()) as "dark" | "light";

  return buildGenericCardStyles(
    {
      accentColor: "#ff4500",
      fontFamily:
        'IBMPlexSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      borderRadius: "8px",
      lightTheme: {
        backgroundColor: "rgb(255, 255, 255)",
        borderColor: "rgb(204, 204, 204)",
        textColor: "rgb(28, 28, 28)",
        secondaryTextColor: "rgb(120, 124, 126)",
        cardBg: "rgb(246, 247, 248)",
      },
      darkTheme: {
        backgroundColor: "rgb(26, 26, 27)",
        borderColor: "rgb(52, 53, 54)",
        textColor: "rgb(215, 218, 220)",
        secondaryTextColor: "rgb(129, 131, 132)",
        cardBg: "rgb(39, 39, 41)",
      },
    },
    activeTheme
  );
}

function findRedditInjectionPoint(postElement: Element): InjectionPoint | null {
  if (postElement.tagName?.toLowerCase() === "shreddit-post") {
    const parent = postElement.parentElement;
    if (!parent) {
      return {
        container: postElement,
        referenceElement: null,
        insertPosition: "append",
        postWrapper: postElement,
      };
    }

    const nextSibling = postElement.nextElementSibling;

    if (nextSibling) {
      return {
        container: parent,
        referenceElement: nextSibling,
        insertPosition: "before",
        postWrapper: postElement,
      };
    }

    return {
      container: parent,
      referenceElement: null,
      insertPosition: "append",
      postWrapper: postElement,
    };
  }

  const postContainer =
    postElement.closest("[data-testid='post-container']") ||
    postElement.closest(".Post") ||
    postElement;

  if (!postContainer) return null;

  const actionBar =
    postContainer.querySelector("[data-testid='post-actions']") ||
    postContainer.querySelector(".Post__footer") ||
    postContainer.querySelector("[data-click-id='comments']")?.parentElement;

  if (actionBar?.parentElement) {
    return {
      container: actionBar.parentElement,
      referenceElement: actionBar,
      insertPosition: "before",
      postWrapper: postContainer,
    };
  }

  return {
    container: postContainer,
    referenceElement: null,
    insertPosition: "append",
    postWrapper: postContainer,
  };
}

const RedditAdapter = createBasicAdapter({
  name: "reddit",
  hostPatterns: [
    /^(www\.)?reddit\.com$/,
    /^(new\.)?reddit\.com$/,
    /^old\.reddit\.com$/,
  ],
  itemSelectors: [
    "shreddit-post",
    "article[data-testid='post-container']",
    "div[data-testid='post-container']",
    ".Post",
    "[data-click-id='body']",
  ],
  containerSelectors: [
    "shreddit-feed",
    "[data-testid='posts-list']",
    "main",
    "#main-content",
  ],
  textSelectors: [
    "[slot='title']",
    "[data-testid='post-title']",
    "h1",
    "h3",
    "[slot='text-body']",
    "[data-testid='post-content']",
    ".RichTextJSON-root",
    ".md",
  ],
  accentColor: "#ff4500",
  fontFamily:
    'IBMPlexSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  borderRadius: "8px",
  extractPostText(postElement: Element): string {
    try {
      if (postElement.tagName?.toLowerCase() === "shreddit-post") {
        const parts: string[] = [];

        const titleSlot = postElement.querySelector("[slot='title']");
        const titleAttr = postElement.getAttribute("post-title");
        const title = titleSlot?.textContent?.trim() || titleAttr || "";
        if (title) parts.push(title);

        const textBody = postElement.querySelector("[slot='text-body']");
        if (textBody) {
          const bodyText = (textBody.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          if (bodyText && bodyText.length > 10) {
            parts.push(bodyText);
          }
        }

        const subreddit = postElement.getAttribute("subreddit-prefixed-name");
        if (subreddit) {
          parts.push(`Posted in ${subreddit}`);
        }

        const combined = parts.join(" ").trim();
        if (combined.length > 20) return combined;
      }

      const textSelectors = [
        "[data-testid='post-title']",
        "h1[slot='title']",
        "h3[data-adclicklocation='title']",
        ".Post h3",
        "a[data-click-id='body'] h3",
        "[data-testid='post-content']",
        "[slot='text-body']",
        ".RichTextJSON-root",
        ".md",
        "[data-click-id='text']",
      ];

      const parts: string[] = [];

      for (const selector of textSelectors) {
        const el = postElement.querySelector(selector);
        if (el) {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (text && text.length > 5 && !parts.includes(text)) {
            parts.push(text);
          }
        }
      }

      const subredditEl = postElement.querySelector(
        "[data-testid='subreddit-name'], a[data-click-id='subreddit']"
      );
      if (subredditEl) {
        const subreddit = subredditEl.textContent?.trim();
        if (subreddit && !parts.includes(subreddit)) {
          parts.push(`Posted in ${subreddit}`);
        }
      }

      const combined = parts.join(" ").trim();
      return combined.length > 20 ? combined : "";
    } catch {
      return "";
    }
  },
  findInjectionPoint: findRedditInjectionPoint,
  detectTheme: detectRedditTheme,
  getCardStyles: getRedditCardStyles,
  getWrapperStyles(): string {
    return `
      padding: 8px 12px;
      margin: 8px 0 0 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
  },
  hasInjectedCard(postElement: Element): boolean {
    if (postElement.tagName?.toLowerCase() === "shreddit-post") {
      return !!postElement.querySelector(".knoww-market-card");
    }

    const postContainer =
      postElement.closest("[data-testid='post-container']") ||
      postElement.closest(".Post") ||
      postElement;

    return !!postContainer?.querySelector(".knoww-market-card");
  },
  getDynamicSelectors(): { itemSelector: string; containerSelector: string } {
    const itemSelector = "shreddit-post";
    const containerCandidates = [
      "main[role='main']",
      "main",
      "#main-content",
      "shreddit-feed",
      "body",
    ];

    const containerSelector =
      containerCandidates.find((sel) => document.querySelector(sel)) || "body";

    return { itemSelector, containerSelector };
  },
  getCssClassPrefix(): string {
    return "knoww-reddit";
  },
  getPostId(postElement: Element): string | null {
    if (postElement.tagName?.toLowerCase() === "shreddit-post") {
      return (
        postElement.getAttribute("id") ||
        postElement.getAttribute("post-id") ||
        postElement.getAttribute("thing-id")
      );
    }

    return (
      postElement.getAttribute("data-fullname") ||
      postElement.getAttribute("data-post-id") ||
      postElement.id ||
      null
    );
  },
});

window.KNOWW_REDDIT = RedditAdapter;

registerAdapterWithRetry(RedditAdapter, 100, 50);

export { RedditAdapter };
