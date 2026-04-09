// ============================================
// INSERTER HELPERS
// DOM manipulation utilities for content injection
// ============================================

const DANGEROUS_CSS_PATTERN =
  /expression\s*\(|url\s*\(\s*(["']?)\s*javascript:|(-moz-binding|-webkit-binding)\s*:|behavior\s*:/i;

function sanitizeStyleValue(value: string): string {
  return DANGEROUS_CSS_PATTERN.test(value) ? "" : value;
}

/**
 * Create a DOM node from HTML string safely (no <script>).
 */
function htmlToElement(html: string): Element | null {
  const text = String(html).trim();
  if (!text) {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");
  const root = doc.body.firstElementChild;
  const element = root || document.createElement("span");
  if (!root) {
    element.textContent = text;
    return element;
  }

  const nodes = [element, ...Array.from(element.querySelectorAll("*"))];
  const forbiddenTags = new Set([
    "script",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
    "base",
  ]);

  for (const node of nodes) {
    if (forbiddenTags.has(node.tagName.toLowerCase())) {
      node.remove();
      continue;
    }

    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (
        /^on/i.test(name) ||
        ((name === "src" ||
          name === "href" ||
          name === "action" ||
          name === "formaction" ||
          name === "xlink:href" ||
          name === "srcdoc") &&
          typeof attr.value === "string" &&
          /^\s*(javascript|data):/i.test(attr.value))
      ) {
        node.removeAttribute(attr.name);
      } else if (name === "style") {
        const sanitized = sanitizeStyleValue(attr.value);
        if (sanitized) {
          node.setAttribute("style", sanitized);
        } else {
          node.removeAttribute("style");
        }
      }
    }
  }

  if (
    forbiddenTags.has(element.tagName.toLowerCase()) ||
    !doc.body.contains(element)
  ) {
    return null;
  }

  return element;
}

/**
 * Check if a node is an inserted card we created.
 */
function isOurCard(el: Element | null): boolean {
  return !!(
    el &&
    el.nodeType === 1 &&
    el.hasAttribute("data-nth-injector-card")
  );
}

/**
 * Insert `nodeToInsert` after `target`.
 */
function insertAfter(target: Element | null, nodeToInsert: Element): void {
  if (!target?.parentNode) return;
  target.parentNode.insertBefore(nodeToInsert, target.nextSibling);
}

/**
 * Returns a stable selector set for X/Twitter.
 * - itemSelector: individual post
 * - containerSelector: scrolling feed container (for MutationObserver root)
 */
function getXSelectors(): { itemSelector: string; containerSelector: string } {
  // X uses <article data-testid="tweet"> for posts in most views.
  const itemSelector = 'article[data-testid="tweet"]';

  // Timeline container can vary; these two cover Home/Following/For You.
  const containerSelectorCandidates = [
    'div[aria-label="Timeline: Your Home Timeline"]',
    'main[role="main"]',
  ];

  const containerSelector =
    containerSelectorCandidates.find((sel) => document.querySelector(sel)) ||
    "main";
  return { itemSelector, containerSelector };
}

/**
 * Returns a selector set for LinkedIn feed.
 * - itemSelector: individual feed update containers
 * - containerSelector: scrolling feed container
 */
function getLinkedInSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  // Cover classic and newer LinkedIn feed item wrappers
  const itemSelector = [
    "div.occludable-update",
    "div.feed-shared-update-v2",
    'article[data-urn^="urn:li:activity:"]',
  ].join(", ");

  const containerSelectorCandidates = [
    "div.scaffold-finite-scroll__content",
    "main.scaffold-layout__main",
    'main[role="main"]',
    "main",
  ];

  const containerSelector =
    containerSelectorCandidates.find((sel) => document.querySelector(sel)) ||
    "main";
  return { itemSelector, containerSelector };
}

/**
 * Returns a selector set for Quora answers.
 * - itemSelector: answer content blocks
 * - containerSelector: main content area
 */
function getQuoraSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const itemSelector = [
    ".puppeteer_test_answer_content",
    "[data-testid='answer_content']",
  ].join(", ");

  const containerSelectorCandidates = [
    'main[role="main"]',
    "main",
    '[role="main"]',
    "body",
  ];

  const containerSelector =
    containerSelectorCandidates.find((sel) => document.querySelector(sel)) ||
    "body";
  return { itemSelector, containerSelector };
}

/**
 * Get selectors for the current platform (auto-detect)
 * Uses platform registry if available, otherwise falls back to manual detection
 */
function getPlatformSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  // Try platform registry first
  if (typeof window !== "undefined" && window.KNOWW_PLATFORM) {
    const platform = window.KNOWW_PLATFORM.getCurrentPlatform();
    if (platform && typeof platform.getDynamicSelectors === "function") {
      return platform.getDynamicSelectors();
    }
  }

  // Fallback to manual detection
  const host = (typeof location !== "undefined" && location.hostname) || "";
  const isLinkedIn = /(^|\.)linkedin\.com$/.test(host);
  const isQuora = /(^|\.)quora\.com$/.test(host);

  if (isLinkedIn) {
    return getLinkedInSelectors();
  }
  if (isQuora) {
    return getQuoraSelectors();
  }
  return getXSelectors();
}

// NTH Inserter API interface
interface NthInserterApi {
  htmlToElement: typeof htmlToElement;
  isOurCard: typeof isOurCard;
  insertAfter: typeof insertAfter;
  getXSelectors: typeof getXSelectors;
  getLinkedInSelectors: typeof getLinkedInSelectors;
  getQuoraSelectors: typeof getQuoraSelectors;
  getPlatformSelectors: typeof getPlatformSelectors;
}

// Expose as a global for content.js consumption in MV3 content scripts
const api: NthInserterApi = {
  htmlToElement,
  isOurCard,
  insertAfter,
  getXSelectors,
  getLinkedInSelectors,
  getQuoraSelectors,
  getPlatformSelectors,
};

if (typeof window !== "undefined") {
  window.NTH_INSERTER = api;
} else if (typeof self !== "undefined") {
  (self as unknown as { NTH_INSERTER: NthInserterApi }).NTH_INSERTER = api;
}

export {
  getLinkedInSelectors,
  getPlatformSelectors,
  getQuoraSelectors,
  getXSelectors,
  htmlToElement,
  insertAfter,
  isOurCard,
};
