import type {
  CardStyles,
  InjectionPoint,
  PlatformAdapter,
} from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import { extractPostIdFromAttributes } from "./helpers";

const SlashdotAdapter = createBasicAdapter({
  name: "slashdot",
  hostPatterns: [/^(?:www\.)?slashdot\.org$/],
  itemSelectors: ["article.fhitem-story", "article.fhitem", ".comment"],
  containerSelectors: ["#firehose", "body"],
  textSelectors: [
    "h2.story a",
    ".story-title a",
    ".p",
    ".body .p",
    ".commentBody",
    ".commentBody p",
  ],
  referenceSelectors: [".body", ".p", ".commentBody"],
  beforeSelectors: ["footer.article-foot", "aside.novote"],
  accentColor: "#026664",
  fontFamily: "Arial, Helvetica, sans-serif",
  borderRadius: "4px",
  wrapperStyles: `
    padding: 2px 16px 0 16px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 680px;
  `,
  getPostId(postElement: Element): string | null {
    return extractPostIdFromAttributes(postElement, [
      "data-fhid",
      "data-sid",
      "id",
    ]);
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    const footer = postElement.querySelector("footer.article-foot");
    if (footer?.parentElement) {
      return {
        container: footer.parentElement,
        referenceElement: footer,
        insertPosition: "before",
        postWrapper: postElement,
      };
    }

    const aside = postElement.querySelector("aside.novote");
    if (aside?.parentElement) {
      return {
        container: aside.parentElement,
        referenceElement: aside,
        insertPosition: "before",
        postWrapper: postElement,
      };
    }

    const bodyDiv = postElement.querySelector(".body");
    if (bodyDiv?.parentElement) {
      return {
        container: bodyDiv.parentElement,
        referenceElement: bodyDiv,
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
    return "light";
  },
  getCardStyles(theme?: string): CardStyles {
    const t = (theme || "light") as "dark" | "light";
    if (t === "dark") {
      return {
        backgroundColor: "rgb(42, 42, 42)",
        borderColor: "rgba(255, 255, 255, 0.15)",
        textColor: "rgb(230, 230, 230)",
        secondaryTextColor: "rgba(255, 255, 255, 0.6)",
        cardBg: "rgb(50, 50, 50)",
        accentColor: "#026664",
        fontFamily: "Arial, Helvetica, sans-serif",
        cardPadding: "8px 12px",
        cardMargin: "8px 0",
        borderRadius: "4px",
        theme: "dark",
      };
    }
    return {
      backgroundColor: "rgb(255, 255, 255)",
      borderColor: "rgba(0, 0, 0, 0.15)",
      textColor: "rgb(34, 34, 34)",
      secondaryTextColor: "rgb(102, 102, 102)",
      cardBg: "rgb(246, 246, 246)",
      accentColor: "#026664",
      fontFamily: "Arial, Helvetica, sans-serif",
      cardPadding: "8px 12px",
      cardMargin: "8px 0",
      borderRadius: "4px",
      theme: "light",
    };
  },
});

export const adapter: PlatformAdapter = SlashdotAdapter;

export { SlashdotAdapter };
