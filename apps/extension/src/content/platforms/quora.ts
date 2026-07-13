// ============================================
// QUORA PLATFORM ADAPTER
// Handles Quora-specific DOM interactions
// ============================================

import type {
  CardStyles,
  InjectionPoint,
  PlatformAdapter,
} from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import {
  buildGenericCardStyles,
  combineTextParts,
  detectGenericTheme,
  normalizeText,
} from "./helpers";

const ANSWER_CONTENT_SELECTORS = [
  ".puppeteer_test_answer_content",
  "[data-testid='answer_content']",
];

const HOME_FEED_ITEM_SELECTORS = [
  "[class*='dom_annotate_question_answer_item_']",
  "[class*='spacing_log_answer_content']",
  ".puppeteer_test_answer_content",
  "[data-testid='answer_content']",
];

const ALL_ITEM_SELECTORS = [
  ...new Set([...HOME_FEED_ITEM_SELECTORS, ...ANSWER_CONTENT_SELECTORS]),
];

function detectQuoraTheme(): "dark" | "light" {
  return detectGenericTheme();
}

function getQuoraCardStyles(theme?: string): CardStyles {
  const activeTheme =
    theme === "dark" || theme === "light" ? theme : detectQuoraTheme();

  return buildGenericCardStyles(
    {
      accentColor: "#b92b27",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      borderRadius: "12px",
      lightTheme: {
        backgroundColor: "rgb(255, 255, 255)",
        borderColor: "rgba(0, 0, 0, 0.12)",
        textColor: "rgb(40, 40, 41)",
        secondaryTextColor: "rgb(99, 99, 100)",
        cardBg: "rgb(247, 247, 248)",
      },
      darkTheme: {
        backgroundColor: "rgb(38, 38, 39)",
        borderColor: "rgba(255, 255, 255, 0.12)",
        textColor: "rgb(240, 240, 240)",
        secondaryTextColor: "rgba(255, 255, 255, 0.7)",
        cardBg: "rgb(48, 48, 49)",
      },
    },
    activeTheme
  );
}

function findQuoraInjectionPoint(postElement: Element): InjectionPoint | null {
  const answerContentSelector = ANSWER_CONTENT_SELECTORS.join(", ");
  const answerContent = postElement.matches(answerContentSelector)
    ? postElement
    : postElement.querySelector(answerContentSelector);

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

  const feedItemWrapper =
    postElement.closest("[class*='dom_annotate_question_answer_item_']") ||
    postElement;

  if (feedItemWrapper.parentElement) {
    return {
      container: feedItemWrapper.parentElement,
      referenceElement: feedItemWrapper,
      insertPosition: "after",
      postWrapper: feedItemWrapper,
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
}

const QuoraAdapter = createBasicAdapter({
  name: "quora",
  hostPatterns: [/^(www\.)?quora\.com$/],
  itemSelectors: ALL_ITEM_SELECTORS,
  containerSelectors: ['main[role="main"]', "main", '[role="main"]', "body"],
  textSelectors: ALL_ITEM_SELECTORS,
  accentColor: "#b92b27",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: "12px",
  extractPostText(postElement: Element): string {
    try {
      const answerContentSelector = ANSWER_CONTENT_SELECTORS.join(", ");
      const answerText = normalizeText(
        postElement.matches(answerContentSelector)
          ? postElement.textContent
          : (postElement.querySelector(answerContentSelector) || postElement)
              ?.textContent
      );

      const questionTitle = normalizeText(
        postElement
          .closest("[class*='dom_annotate_question_answer_item_']")
          ?.querySelector(
            ".puppeteer_test_question_title, [class*='puppeteer_test_question_title']"
          )?.textContent ||
          document.querySelector(".puppeteer_test_question_title")?.textContent
      );

      return combineTextParts([questionTitle, answerText]);
    } catch {
      return "";
    }
  },
  findInjectionPoint: findQuoraInjectionPoint,
  detectTheme: detectQuoraTheme,
  getCardStyles: getQuoraCardStyles,
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
      postElement.closest(
        "[data-answer-id], [id^='answer-'], [class*='dom_annotate_question_answer_item_']"
      ) ||
      postElement.parentElement ||
      postElement;

    return !!wrapper.querySelector(".knoww-market-card");
  },
  getCssClassPrefix(): string {
    return "knoww-quora";
  },
  getPostId(postElement: Element): string | null {
    const feedItem = postElement.closest(
      "[class*='dom_annotate_question_answer_item_']"
    );
    if (feedItem) {
      const itemClass = Array.from(feedItem.classList).find((c) =>
        c.startsWith("dom_annotate_question_answer_item_")
      );
      if (itemClass) return itemClass;
    }

    const wrapper =
      postElement.closest("[data-answer-id], [id^='answer-']") || postElement;

    return (
      wrapper.getAttribute("data-answer-id") ||
      wrapper.getAttribute("id") ||
      postElement.getAttribute("data-answer-id") ||
      null
    );
  },
});

export const adapter: PlatformAdapter = QuoraAdapter;

export { QuoraAdapter };
