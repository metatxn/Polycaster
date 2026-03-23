// ============================================
// INSERTER HELPERS
// DOM manipulation utilities for content injection
// ============================================

/**
 * Create a DOM node from HTML string safely (no <script>).
 */
function htmlToElement(html: string): Element | null {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html).trim();
  return tpl.content.firstElementChild;
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
  if (!target || !target.parentNode) return;
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

  if (isLinkedIn) {
    return getLinkedInSelectors();
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
  getPlatformSelectors: typeof getPlatformSelectors;
}

// Expose as a global for content.js consumption in MV3 content scripts
const api: NthInserterApi = {
  htmlToElement,
  isOurCard,
  insertAfter,
  getXSelectors,
  getLinkedInSelectors,
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
  getXSelectors,
  htmlToElement,
  insertAfter,
  isOurCard,
};
