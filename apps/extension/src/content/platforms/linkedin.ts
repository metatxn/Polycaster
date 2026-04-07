// ============================================
// LINKEDIN PLATFORM ADAPTER
// Handles LinkedIn-specific DOM interactions
// ============================================

import type { CardStyles, InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { buildGenericCardStyles } from "./helpers";

function isLinkedInDarkMode(): boolean {
  return (
    document.documentElement.classList.contains("artdeco-dark-mode") ||
    document.body.classList.contains("artdeco-dark-mode") ||
    document.documentElement.classList.contains("theme--dark")
  );
}

function detectLinkedInTheme(): "dark" | "light" {
  const themeOverride = window.KNOWW_CONFIG?.getThemeOverride?.();
  if (themeOverride && themeOverride !== "auto") {
    return themeOverride === "light" ? "light" : "dark";
  }

  return isLinkedInDarkMode() ? "dark" : "light";
}

function getLinkedInCardStyles(theme?: string): CardStyles {
  const activeTheme = (theme || detectLinkedInTheme()) as "dark" | "light";

  return buildGenericCardStyles(
    {
      accentColor: "#0a66c2",
      fontFamily:
        '-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Fira Sans", Ubuntu, Oxygen, "Oxygen Sans", Cantarell, "Droid Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Lucida Grande", Helvetica, Arial, sans-serif',
      borderRadius: "8px",
      lightTheme: {
        backgroundColor: "rgb(255, 255, 255)",
        borderColor: "rgba(0, 0, 0, 0.08)",
        textColor: "rgba(0, 0, 0, 0.9)",
        secondaryTextColor: "rgba(0, 0, 0, 0.6)",
        cardBg: "rgb(247, 247, 247)",
      },
      darkTheme: {
        backgroundColor: "rgb(30, 30, 30)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        textColor: "rgba(255, 255, 255, 0.9)",
        secondaryTextColor: "rgba(255, 255, 255, 0.6)",
        cardBg: "rgb(40, 40, 40)",
      },
    },
    activeTheme
  );
}

function findLinkedInInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const controlMenuContainer =
    postElement.closest(".feed-shared-update-v2__control-menu-container") ||
    postElement.querySelector(".feed-shared-update-v2__control-menu-container");

  const feedUpdate =
    controlMenuContainer ||
    postElement.closest(".feed-shared-update-v2") ||
    postElement.closest(".occludable-update") ||
    postElement;

  if (!feedUpdate) return null;

  const socialActionsBar =
    feedUpdate.querySelector(".feed-shared-social-action-bar") ||
    feedUpdate.querySelector(".social-details-social-counts") ||
    feedUpdate.querySelector(".update-v2-social-activity");

  const socialActivityContainer = feedUpdate.querySelector(
    ".update-v2-social-activity"
  );

  if (socialActivityContainer?.parentElement) {
    return {
      container: socialActivityContainer.parentElement,
      referenceElement: socialActivityContainer,
      insertPosition: "before",
      postWrapper: feedUpdate,
    };
  }

  if (socialActionsBar?.parentElement) {
    return {
      container: socialActionsBar.parentElement,
      referenceElement: socialActionsBar,
      insertPosition: "before",
      postWrapper: feedUpdate,
    };
  }

  return {
    container: feedUpdate,
    referenceElement: null,
    insertPosition: "append",
    postWrapper: feedUpdate,
  };
}

const LINKEDIN_ITEM_SELECTORS = [
  "div.feed-shared-update-v2__control-menu-container",
  "div.feed-shared-update-v2",
  "div.occludable-update",
];

const LinkedInAdapter = createBasicAdapter({
  name: "linkedin",
  hostPatterns: [/^(www\.)?linkedin\.com$/],
  itemSelectors: LINKEDIN_ITEM_SELECTORS,
  containerSelectors: [
    "div.scaffold-finite-scroll__content",
    "main.scaffold-layout__main",
    'main[role="main"]',
    "main",
  ],
  textSelectors: [
    ".update-components-text",
    ".update-components-update-v2__commentary",
  ],
  accentColor: "#0a66c2",
  fontFamily:
    '-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Fira Sans", Ubuntu, Oxygen, "Oxygen Sans", Cantarell, "Droid Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Lucida Grande", Helvetica, Arial, sans-serif',
  borderRadius: "8px",
  extractPostText(postElement: Element): string {
    try {
      const textSelectors = [
        ".update-components-text",
        ".update-components-update-v2__commentary",
        ".feed-shared-update-v2__description .update-components-text",
        ".feed-shared-article__description",
        ".feed-shared-article__title",
      ];

      for (const selector of textSelectors) {
        const el = postElement.querySelector(selector);
        if (el) {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (text && text.length > 20) {
            return text;
          }
        }
      }

      const ltrSpans = postElement.querySelectorAll('span[dir="ltr"]');
      for (const span of ltrSpans) {
        const text = (span.textContent || "").trim();
        if (text.length > 50) {
          return text;
        }
      }

      return "";
    } catch {
      return "";
    }
  },
  findInjectionPoint: findLinkedInInjectionPoint,
  detectTheme: detectLinkedInTheme,
  getCardStyles: getLinkedInCardStyles,
  getWrapperStyles(): string {
    return `
      padding: 8px 16px;
      margin: 8px 0 0 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
  },
  hasInjectedCard(postElement: Element): boolean {
    const feedUpdate =
      postElement.closest(".feed-shared-update-v2__control-menu-container") ||
      postElement.querySelector(
        ".feed-shared-update-v2__control-menu-container"
      ) ||
      postElement.closest(".feed-shared-update-v2") ||
      postElement.closest(".occludable-update") ||
      postElement;

    return !!feedUpdate?.querySelector(".knoww-market-card");
  },
  getDynamicSelectors(): { itemSelector: string; containerSelector: string } {
    const itemSelector = LINKEDIN_ITEM_SELECTORS.join(", ");
    const containerCandidates = [
      "div.scaffold-finite-scroll__content",
      "main.scaffold-layout__main",
      'main[role="main"]',
      "main",
    ];

    const containerSelector =
      containerCandidates.find((sel) => document.querySelector(sel)) || "main";

    return { itemSelector, containerSelector };
  },
  getCssClassPrefix(): string {
    return "knoww-linkedin";
  },
});

window.KNOWW_LINKEDIN = LinkedInAdapter;

registerAdapterWithRetry(LinkedInAdapter, 100, 50);

export { LinkedInAdapter };
