import type { CardStyles, InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  detectGenericTheme,
  extractPostIdFromLink,
  normalizeText,
} from "./helpers";

const THREADS_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const ThreadsAdapter = createBasicAdapter({
  name: "threads",
  hostPatterns: [/^(?:www\.)?threads\.com$/],
  itemSelectors: ["div[data-pressable-container]", "article"],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: ["span[dir='auto']"],
  referenceSelectors: ["span[dir='auto']"],
  accentColor: "#e1e1e1",
  fontFamily: THREADS_FONT,
  getCardStyles(theme?: string): CardStyles {
    const t = (theme || detectGenericTheme()) as "dark" | "light";
    if (t === "dark") {
      return {
        fontFamily: THREADS_FONT,
        cardPadding: "12px 16px",
        cardMargin: "8px 0",
        borderRadius: "12px",
        accentColor: "rgb(225, 225, 225)",
        backgroundColor: "rgb(16, 16, 16)",
        borderColor: "rgb(54, 54, 54)",
        textColor: "rgb(243, 245, 247)",
        secondaryTextColor: "rgb(119, 119, 119)",
        cardBg: "rgb(30, 30, 30)",
        theme: "dark",
      };
    }
    return {
      fontFamily: THREADS_FONT,
      cardPadding: "12px 16px",
      cardMargin: "8px 0",
      borderRadius: "12px",
      accentColor: "rgb(0, 0, 0)",
      backgroundColor: "rgb(255, 255, 255)",
      borderColor: "rgb(219, 219, 219)",
      textColor: "rgb(0, 0, 0)",
      secondaryTextColor: "rgb(115, 115, 115)",
      cardBg: "rgb(250, 250, 250)",
      theme: "light",
    };
  },
  extractPostText(postElement: Element): string {
    const spans = postElement.querySelectorAll("span[dir='auto']");
    const parts: string[] = [];

    for (const span of Array.from(spans)) {
      if (span.closest("a")) continue;
      const text = normalizeText(span.textContent);
      if (text && text.length > 2 && !parts.includes(text)) {
        parts.push(text);
      }
    }

    const combined = parts.join(" ").trim();
    return combined.length >= 20 ? combined : "";
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    const parent = postElement.parentElement;
    if (parent) {
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
    return {
      container: postElement,
      referenceElement: null,
      insertPosition: "append",
      postWrapper: postElement,
    };
  },
  getPostId(postElement: Element): string | null {
    return extractPostIdFromLink(postElement, /\/post\/([^/?#]+)/);
  },
});

registerAdapterWithRetry(ThreadsAdapter, 100, 50);

export { ThreadsAdapter };
