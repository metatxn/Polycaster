// ============================================
// LINKEDIN PLATFORM ADAPTER
// Handles LinkedIn-specific DOM interactions
// ============================================

import type {
  CardStyles,
  InjectionPoint,
  ThemeStyles,
} from "../../types/platform";

/**
 * LinkedIn Platform Adapter
 */
const LinkedInAdapter = {
  name: "linkedin" as const,

  hostPatterns: [/^(www\.)?linkedin\.com$/],

  selectors: {
    item: [
      "div.feed-shared-update-v2__control-menu-container",
      "div.feed-shared-update-v2",
      "div.occludable-update",
    ].join(", "),
    container:
      'div.scaffold-finite-scroll__content, main.scaffold-layout__main, main[role="main"], main',
    text: ".update-components-text, .update-components-update-v2__commentary",
  },

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

  findInjectionPoint(postElement: Element): InjectionPoint | null {
    const controlMenuContainer =
      postElement.closest(".feed-shared-update-v2__control-menu-container") ||
      postElement.querySelector(
        ".feed-shared-update-v2__control-menu-container"
      );

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
  },

  getCardStyles(theme?: string): CardStyles {
    const activeTheme = (theme || this.detectTheme()) as "dark" | "light";

    const baseStyles = {
      fontFamily:
        '-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Fira Sans", Ubuntu, Oxygen, "Oxygen Sans", Cantarell, "Droid Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Lucida Grande", Helvetica, Arial, sans-serif',
      accentColor: "#0a66c2",
      cardPadding: "12px 16px",
      cardMargin: "8px 0",
      borderRadius: "8px",
    };

    const themeStyles: Record<"dark" | "light", ThemeStyles> = {
      dark: {
        backgroundColor: "rgb(30, 30, 30)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        textColor: "rgba(255, 255, 255, 0.9)",
        secondaryTextColor: "rgba(255, 255, 255, 0.6)",
        cardBg: "rgb(40, 40, 40)",
      },
      light: {
        backgroundColor: "rgb(255, 255, 255)",
        borderColor: "rgba(0, 0, 0, 0.08)",
        textColor: "rgba(0, 0, 0, 0.9)",
        secondaryTextColor: "rgba(0, 0, 0, 0.6)",
        cardBg: "rgb(247, 247, 247)",
      },
    };

    return {
      ...baseStyles,
      ...themeStyles[activeTheme],
      theme: activeTheme,
    };
  },

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
    const controlMenuContainer =
      postElement.closest(".feed-shared-update-v2__control-menu-container") ||
      postElement.querySelector(
        ".feed-shared-update-v2__control-menu-container"
      );

    const feedUpdate =
      controlMenuContainer ||
      postElement.closest(".feed-shared-update-v2") ||
      postElement.closest(".occludable-update") ||
      postElement;

    if (!feedUpdate) return false;
    return !!feedUpdate.querySelector(".knoww-market-card");
  },

  getDynamicSelectors(): { itemSelector: string; containerSelector: string } {
    const itemSelector = this.selectors.item;

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

  isDarkMode(): boolean {
    return (
      document.documentElement.classList.contains("artdeco-dark-mode") ||
      document.body.classList.contains("artdeco-dark-mode") ||
      document.documentElement.classList.contains("theme--dark")
    );
  },

  detectTheme(): "dark" | "light" {
    const themeOverride = window.KNOWW_CONFIG?.getThemeOverride?.();
    if (themeOverride && themeOverride !== "auto") {
      return themeOverride === "light" ? "light" : "dark";
    }

    return this.isDarkMode() ? "dark" : "light";
  },

  getCssClassPrefix(): string {
    return "knoww-linkedin";
  },
};

window.KNOWW_LINKEDIN = LinkedInAdapter;

// Register with platform registry using shared utility
import { registerAdapterWithRetry } from "../platform-registry";

registerAdapterWithRetry(LinkedInAdapter, 100, 50);

export { LinkedInAdapter };
