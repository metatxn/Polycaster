import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { extractPostIdFromAttributes } from "./helpers";

const STACK_NETWORK_ITEM_SELECTORS = [
  "#question",
  ".answer",
  ".s-post-summary",
  ".js-post-summary",
];

const STACK_NETWORK_TEXT_SELECTORS = [
  ".js-post-body",
  ".s-post-summary--content-title",
  ".s-post-summary--content-excerpt",
];

function findStackExchangeInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const isPostSummary = postElement.matches(
    ".s-post-summary, .js-post-summary"
  );

  if (isPostSummary) {
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
  }

  const postMenu = postElement.querySelector(".js-post-menu");
  if (postMenu?.parentElement) {
    return {
      container: postMenu.parentElement,
      referenceElement: postMenu,
      insertPosition: "before",
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

const StackExchangeAdapter = createBasicAdapter({
  name: "stackexchange",
  hostPatterns: [
    /^(?:.+\.)?stackexchange\.com$/,
    /^(?:meta\.)?superuser\.com$/,
    /^(?:meta\.)?serverfault\.com$/,
    /^(?:meta\.)?askubuntu\.com$/,
    /^(?:meta\.)?mathoverflow\.net$/,
    /^(?:meta\.)?stackapps\.com$/,
  ],
  itemSelectors: STACK_NETWORK_ITEM_SELECTORS,
  containerSelectors: ["#mainbar", "main", "#content", "body"],
  textSelectors: STACK_NETWORK_TEXT_SELECTORS,
  accentColor: "#4a6ea9",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "10px",
  findInjectionPoint: findStackExchangeInjectionPoint,
  getWrapperStyles(): string {
    return `
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    `;
  },
  getPostId(postElement: Element): string | null {
    return extractPostIdFromAttributes(postElement, [
      "data-answerid",
      "data-questionid",
      "data-post-id",
      "id",
    ]);
  },
});

registerAdapterWithRetry(StackExchangeAdapter, 100, 50);

export { StackExchangeAdapter };
