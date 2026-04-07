import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";

function findProductHuntItems(): string {
  const candidates = [
    "[data-test^='post-item']",
    "[data-test='post-item']",
    "[data-test='feed-item']",
    "[data-test='homepage-section-0'] > div > div",
    "a[href^='/posts/']",
  ];

  for (const sel of candidates) {
    if (document.querySelectorAll(sel).length > 0) return sel;
  }

  const main = document.querySelector("main") || document.body;
  const links = main.querySelectorAll("a[href^='/posts/']");
  if (links.length > 0) {
    const cards = new Set<Element>();
    for (const link of Array.from(links)) {
      const card =
        link.closest("[data-test]") ||
        link.closest("section > div > div") ||
        link.closest("li") ||
        link.parentElement?.closest("div:not(main):not(body)");
      if (card) cards.add(card);
    }
    if (cards.size > 0) {
      const first = cards.values().next().value as Element;
      if (first.getAttribute("data-test")) {
        return `[data-test='${first.getAttribute("data-test")}']`;
      }
      if (first.tagName === "LI") return "li:has(a[href^='/posts/'])";
      return "div:has(> a[href^='/posts/'])";
    }
  }

  return candidates[0];
}

function findProductHuntContainer(): string {
  const selectors = [
    "[data-test='homepage-section-0']",
    "main section",
    "main",
    '[role="main"]',
    "body",
  ];
  return selectors.find((s) => document.querySelector(s)) || "body";
}

function findPHInjectionPoint(postElement: Element): InjectionPoint | null {
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

const ProductHuntAdapter = createBasicAdapter({
  name: "producthunt",
  hostPatterns: [/^(?:www\.)?producthunt\.com$/],
  itemSelectors: [
    "[data-test^='post-item']",
    "[data-test='post-item']",
    "[data-test='feed-item']",
    "[data-test='comment-item']",
    "li:has(a[href^='/posts/'])",
    "div:has(> a[href^='/posts/'])",
  ],
  containerSelectors: [
    "[data-test='homepage-section-0']",
    "main section",
    "main",
    '[role="main"]',
    "body",
  ],
  textSelectors: [
    "[data-test='post-name']",
    "[data-test='tagline']",
    "[data-test='comment-body']",
    "a[href^='/posts/']",
    "h1",
    "h2",
    "h3",
    "p",
  ],
  referenceSelectors: [
    "[data-test='tagline']",
    "[data-test='comment-body']",
    "a[href^='/posts/'] + *",
    "h3",
    "p",
  ],
  accentColor: "#da552f",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  wrapperStyles: `
    padding: 8px 16px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    position: relative;
    z-index: 1;
  `,
  getDynamicSelectors() {
    return {
      itemSelector: findProductHuntItems(),
      containerSelector: findProductHuntContainer(),
    };
  },
  findInjectionPoint: findPHInjectionPoint,
  extractPostText(postElement: Element): string {
    const parts: string[] = [];

    const nameSelectors = [
      "[data-test='post-name']",
      "a[href^='/posts/']",
      "h3",
      "h2",
    ];
    for (const sel of nameSelectors) {
      const el = postElement.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 2) {
        parts.push(text);
        break;
      }
    }

    const taglineSelectors = [
      "[data-test='tagline']",
      "[data-test='post-tagline']",
      "[color='subdued']",
    ];
    for (const sel of taglineSelectors) {
      const el = postElement.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 5) {
        parts.push(text);
        break;
      }
    }

    if (parts.join(" ").trim().length < 20) {
      const textParts: string[] = [];
      const walker = document.createTreeWalker(
        postElement,
        NodeFilter.SHOW_TEXT
      );
      for (
        let node = walker.nextNode();
        node !== null;
        node = walker.nextNode()
      ) {
        const t = (node.textContent || "").trim();
        if (t) textParts.push(t);
      }
      const raw = textParts.join(" ");

      const cleaned = raw
        .replace(/^\d+\.\s*/, "")
        .replace(/\bPromoted\b/g, " ")
        .replace(/•/g, ", ")
        .replace(/\b\d{1,6}\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (cleaned.length >= 20) {
        return cleaned.slice(0, 300);
      }
    }

    const combined = parts.join(" ").trim();
    return combined.length >= 15 ? combined : "";
  },
  getPostId(postElement: Element): string | null {
    const dataTest = postElement.getAttribute("data-test");
    if (dataTest) return dataTest;

    const postId = postElement.getAttribute("data-post-id");
    if (postId) return postId;

    if (postElement.id) return postElement.id;

    const link = postElement.querySelector("a[href^='/posts/']");
    const href = link?.getAttribute("href");
    if (href) {
      const slug = href.replace(/^\/posts\//, "").split("?")[0];
      if (slug) return `ph-${slug}`;
    }

    return null;
  },
});

registerAdapterWithRetry(ProductHuntAdapter, 100, 50);

export { ProductHuntAdapter };
