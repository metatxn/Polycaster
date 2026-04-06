// ============================================
// QUORA PLATFORM ADAPTER
// Handles Quora-specific DOM interactions
// ============================================

import type {
  CardStyles,
  InjectionPoint,
  ThemeStyles,
} from "../../types/platform";

const ANSWER_CONTENT_SELECTORS = [
  ".puppeteer_test_answer_content",
  "[data-testid='answer_content']",
];

function normalizeText(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

/**
 * Quora Platform Adapter
 */
const QuoraAdapter = {
  name: "quora" as const,

  hostPatterns: [/^(www\.)?quora\.com$/],

  selectors: {
    item: ANSWER_CONTENT_SELECTORS.join(", "),
    container: 'main[role="main"], main, [role="main"], body',
    text: ANSWER_CONTENT_SELECTORS.join(", "),
  },

  extractPostText(postElement: Element): string {
    try {
      const answerText = normalizeText(
        postElement.matches(this.selectors.text || "")
          ? postElement.textContent
          : postElement.querySelector(this.selectors.text || "")?.textContent
      );

      const questionTitle = normalizeText(
        document.querySelector(".puppeteer_test_question_title")?.textContent
      );

      const parts = [questionTitle, answerText].filter(
        (part) => part && part.length > 10
      );
      const combined = parts.join(" ").trim();

      return combined.length > 20 ? combined : "";
    } catch {
      return "";
    }
  },

  findInjectionPoint(postElement: Element): InjectionPoint | null {
    const answerContent = postElement.matches(this.selectors.item)
      ? postElement
      : postElement.querySelector(this.selectors.item);

    if (answerContent?.parentElement) {
      return {
        container: answerContent.parentElement,
        referenceElement: answerContent,
        insertPosition: "after",
        postWrapper:
          answerContent.closest("[data-answer-id], [id^='answer-']") ||
          answerContent.parentElement,
      };
    }

    if (postElement.parentElement) {
      return {
        container: postElement.parentElement,
        referenceElement: postElement,
        insertPosition: "after",
        postWrapper: postElement,
      };
    }

    return {
      container: postElement,
      referenceElement: null,
      insertPosition: "append",
      postWrapper: postElement,
    };
  },

  detectTheme(): "dark" | "light" {
    const themeOverride = window.KNOWW_CONFIG?.getThemeOverride?.();
    if (themeOverride && themeOverride !== "auto") {
      return themeOverride === "light" ? "light" : "dark";
    }

    const classHints = [
      document.documentElement.className,
      document.body.className,
      document.documentElement.getAttribute("data-theme"),
      document.body.getAttribute("data-theme"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (classHints.includes("dark")) {
      return "dark";
    }

    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const rgbMatch = bodyBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const [, r, g, b] = rgbMatch.map(Number);
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      return luminance < 140 ? "dark" : "light";
    }

    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  },

  getCardStyles(theme?: string): CardStyles {
    const activeTheme = (theme || this.detectTheme()) as "dark" | "light";

    const baseStyles = {
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      accentColor: "#b92b27",
      cardPadding: "12px 16px",
      cardMargin: "8px 0",
      borderRadius: "12px",
    };

    const themeStyles: Record<"dark" | "light", ThemeStyles> = {
      dark: {
        backgroundColor: "rgb(38, 38, 39)",
        borderColor: "rgba(255, 255, 255, 0.12)",
        textColor: "rgb(240, 240, 240)",
        secondaryTextColor: "rgba(255, 255, 255, 0.7)",
        cardBg: "rgb(48, 48, 49)",
      },
      light: {
        backgroundColor: "rgb(255, 255, 255)",
        borderColor: "rgba(0, 0, 0, 0.12)",
        textColor: "rgb(40, 40, 41)",
        secondaryTextColor: "rgb(99, 99, 100)",
        cardBg: "rgb(247, 247, 248)",
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
      padding: 12px 0 0 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
  },

  hasInjectedCard(postElement: Element): boolean {
    const wrapper =
      postElement.closest("[data-answer-id], [id^='answer-']") ||
      postElement.parentElement ||
      postElement;

    return !!wrapper.querySelector(".knoww-market-card");
  },

  getDynamicSelectors(): { itemSelector: string; containerSelector: string } {
    const itemSelector = this.selectors.item;

    const containerCandidates = [
      'main[role="main"]',
      "main",
      '[role="main"]',
      "body",
    ];

    const containerSelector =
      containerCandidates.find((sel) => document.querySelector(sel)) || "body";

    return { itemSelector, containerSelector };
  },

  getCssClassPrefix(): string {
    return "knoww-quora";
  },

  getPostId(postElement: Element): string | null {
    const wrapper =
      postElement.closest("[data-answer-id], [id^='answer-']") || postElement;

    return (
      wrapper.getAttribute("data-answer-id") ||
      wrapper.getAttribute("id") ||
      postElement.getAttribute("data-answer-id") ||
      null
    );
  },
};

window.KNOWW_QUORA = QuoraAdapter;

import { registerAdapterWithRetry } from "../platform-registry";

registerAdapterWithRetry(QuoraAdapter, 100, 50);

export { QuoraAdapter };
