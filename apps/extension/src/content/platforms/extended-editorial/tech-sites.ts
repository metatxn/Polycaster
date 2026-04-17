import type { InjectionPoint } from "../../../types/platform";
import {
  collectTextParts,
  combineTextParts,
  extractPostIdFromLink,
  findInjectionAfterSelectors,
  normalizeText,
} from "../helpers";
import {
  getDocumentDescription,
  getFirstMatchingText,
  stripTrailingBylineFragment,
} from "../story-adapter-helpers";
import { BASE_EDITORIAL_ITEM_SELECTORS } from "./shared";

const TECHCRUNCH_HOST_RE = /^(?:www\.)?techcrunch\.com$/i;
const ENGADGET_HOST_RE = /^(?:www\.)?engadget\.com$/i;
const GIZMODO_HOST_RE = /^(?:www\.)?gizmodo\.com$/i;
const NINETOFIVE_FORUMS_HOST_RE = /^(?:www\.)?9to5(?:mac|google)\.com$/i;
const NINETOFIVE_FORUMS_PATH_RE = /^\/forums\/?$/i;
const NINETOFIVE_FORUMS_LINK_PATTERN =
  /(?:#\/|\/)(?:category|topic|discussion|thread|post)\/([^?#]+)/i;
const NINETOFIVE_FORUMS_CONTAINER_SELECTORS = [
  "[data-spotim-module='forums']",
  ".ninetofive-forums-container",
  "main",
] as const;
const NINETOFIVE_FORUMS_LINK_SELECTORS = [
  "a[href*='#/category/']",
  "a[href*='/forums/#/category/']",
  "a[href*='/category/']",
  "a[href*='#/topic/']",
  "a[href*='/forums/#/topic/']",
  "a[href*='/topic/']",
  "a[href*='#/discussion/']",
  "a[href*='/forums/#/discussion/']",
  "a[href*='/discussion/']",
  "a[href*='#/thread/']",
  "a[href*='/forums/#/thread/']",
  "a[href*='/thread/']",
  "a[href*='#/post/']",
  "a[href*='/forums/#/post/']",
  "a[href*='/post/']",
] as const;
const NINETOFIVE_FORUMS_TEXT_SELECTORS = [
  ...NINETOFIVE_FORUMS_LINK_SELECTORS,
  "[role='heading']",
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "[class*='summary']",
  "[class*='description']",
  "[class*='excerpt']",
] as const;
const ENGADGET_ITEM_SELECTORS = [
  "main h1",
  "section[data-test='feature'] .inline-block.justify-start",
  "section[data-test='4up'] .inline-block.justify-start",
  "section[data-test='stream'] li",
] as const;
const GIZMODO_ITEM_SELECTORS = [
  "main div.flex:has(> a.flex.flex-col.w-full.gap-5[href*='-2000'])",
] as const;

function buildScopedSelectors(
  containerSelectors: readonly string[],
  selectors: readonly string[]
): string[] {
  return containerSelectors.flatMap((containerSelector) =>
    selectors.map((selector) => `${containerSelector} ${selector}`)
  );
}

const NINETOFIVE_FORUMS_ITEM_ROOT_SELECTORS =
  NINETOFIVE_FORUMS_LINK_SELECTORS.flatMap((linkSelector) => [
    `li:has(${linkSelector})`,
    `[role='listitem']:has(${linkSelector})`,
    `article:has(${linkSelector})`,
    `section:has(${linkSelector})`,
    `div:has(> ${linkSelector})`,
  ]);

const NINETOFIVE_FORUMS_ITEM_SELECTORS = buildScopedSelectors(
  NINETOFIVE_FORUMS_CONTAINER_SELECTORS,
  NINETOFIVE_FORUMS_ITEM_ROOT_SELECTORS
);
const NINETOFIVE_FORUMS_DIRECT_ITEM_SELECTORS = buildScopedSelectors(
  NINETOFIVE_FORUMS_CONTAINER_SELECTORS,
  NINETOFIVE_FORUMS_LINK_SELECTORS
);
const NINETOFIVE_FORUMS_PAGE_FALLBACK_SELECTOR = ".ninetofive-forums-container";

export const TECH_EDITORIAL_HOST_PATTERNS = [
  TECHCRUNCH_HOST_RE,
  ENGADGET_HOST_RE,
  GIZMODO_HOST_RE,
  NINETOFIVE_FORUMS_HOST_RE,
] as const;

function isNinetofiveForumsPage(): boolean {
  return (
    NINETOFIVE_FORUMS_HOST_RE.test(window.location.hostname) &&
    NINETOFIVE_FORUMS_PATH_RE.test(window.location.pathname)
  );
}

function ensureWrappedInjectionRow(
  element: Element,
  datasetFlag: "knowwGizmodoWrapped" | "knowwForumsWrapped"
): void {
  if (!(element instanceof HTMLElement) || element.dataset[datasetFlag]) {
    return;
  }

  const styles = window.getComputedStyle(element);
  if (styles.display.includes("flex") && styles.flexWrap === "nowrap") {
    element.style.flexWrap = "wrap";
  }

  element.dataset[datasetFlag] = "true";
}

function getNinetofiveForumsScope(postElement: Element): Element {
  if (!postElement.matches("a[href]")) {
    return postElement;
  }

  return (
    postElement.closest("li, [role='listitem'], article, section, div") ||
    postElement
  );
}

function getNinetofiveForumsPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (
    postElement instanceof HTMLAnchorElement &&
    postElement.matches("a[href]")
  ) {
    return postElement;
  }

  const scope = getNinetofiveForumsScope(postElement);
  return scope.querySelector<HTMLAnchorElement>(
    NINETOFIVE_FORUMS_LINK_SELECTORS.join(", ")
  );
}

export function getTechEditorialPostId(postElement: Element): string | null {
  // `null` means either "not a tech-editorial host" or "no stable post id";
  // the composer checks these host-gated helpers in priority order.
  if (!isNinetofiveForumsPage()) {
    return null;
  }

  const forumPostId = extractPostIdFromLink(
    getNinetofiveForumsScope(postElement),
    NINETOFIVE_FORUMS_LINK_PATTERN
  );
  if (forumPostId) {
    return forumPostId;
  }

  const hashId = normalizeText(window.location.hash.replace(/^#\/?/, ""));
  return hashId || null;
}

export function extractTechEditorialPostText(postElement: Element): string {
  // `""` means "not handled by this family"; handled hosts return extracted text
  // or an empty combined string only if nothing useful was found.
  const hostname = window.location.hostname;

  if (isNinetofiveForumsPage()) {
    const scope = getNinetofiveForumsScope(postElement);
    const title = getFirstMatchingText(scope, [
      ...NINETOFIVE_FORUMS_LINK_SELECTORS,
    ]);
    const summary = stripTrailingBylineFragment(
      getFirstMatchingText(scope, [
        "[class*='summary']",
        "[class*='description']",
        "[class*='excerpt']",
        "p",
      ])
    );
    const forumText = combineTextParts([title, summary]);
    if (forumText) {
      return forumText;
    }

    const scopedText = combineTextParts(
      collectTextParts(scope, [...NINETOFIVE_FORUMS_TEXT_SELECTORS])
    );
    if (scopedText) {
      return scopedText;
    }

    return combineTextParts([
      getDocumentDescription(),
      normalizeText(
        window.location.hash.replace(/^#\/?/, "").replace(/\//g, " ")
      ),
    ]);
  }

  if (TECHCRUNCH_HOST_RE.test(hostname)) {
    const title = getFirstMatchingText(postElement, [
      ".loop-card__title-link",
      ".loop-card__title",
      ".duet--content-cards--content-card h1",
      ".duet--content-cards--content-card h2",
      ".duet--content-cards--content-card h3",
      ".duet--content-cards--content-card a",
      "[data-testid='SummaryItemHed']",
      ".summary-item__hed-link",
      ".contentItem__title",
      "h1",
      "h2",
      "h3",
    ]);
    const summary = stripTrailingBylineFragment(
      getFirstMatchingText(postElement, [
        ".loop-card__content p",
        ".summary-item__content",
        ".contentItem__subhead",
        ".duet--content-cards--content-card p",
      ])
    );
    return combineTextParts([title, summary]);
  }

  if (ENGADGET_HOST_RE.test(hostname) && postElement.matches("main h1")) {
    const title = normalizeText(postElement.textContent);
    const summary = getDocumentDescription();
    return combineTextParts([title, summary]);
  }

  return "";
}

export function getTechEditorialDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} | null {
  if (isNinetofiveForumsPage()) {
    const matchedRootSelectors = NINETOFIVE_FORUMS_ITEM_SELECTORS.filter(
      (selector) => document.querySelector(selector)
    );
    const matchedDirectSelectors =
      matchedRootSelectors.length === 0
        ? NINETOFIVE_FORUMS_DIRECT_ITEM_SELECTORS.filter((selector) =>
            document.querySelector(selector)
          )
        : [];

    return {
      itemSelector:
        matchedRootSelectors.length > 0
          ? matchedRootSelectors.join(", ")
          : matchedDirectSelectors.length > 0
            ? matchedDirectSelectors.join(", ")
            : document.querySelector(NINETOFIVE_FORUMS_PAGE_FALLBACK_SELECTOR)
              ? NINETOFIVE_FORUMS_PAGE_FALLBACK_SELECTOR
              : NINETOFIVE_FORUMS_ITEM_SELECTORS.join(", "),
      containerSelector:
        NINETOFIVE_FORUMS_CONTAINER_SELECTORS.find((selector) =>
          document.querySelector(selector)
        ) || "main",
    };
  }

  if (ENGADGET_HOST_RE.test(window.location.hostname)) {
    const engadgetItems = ENGADGET_ITEM_SELECTORS.filter((selector) =>
      document.querySelector(selector)
    );

    return {
      itemSelector:
        engadgetItems.length > 0
          ? engadgetItems.join(", ")
          : BASE_EDITORIAL_ITEM_SELECTORS.join(", "),
      containerSelector: "main",
    };
  }

  if (GIZMODO_HOST_RE.test(window.location.hostname)) {
    const gizmodoItems = GIZMODO_ITEM_SELECTORS.filter((selector) =>
      document.querySelector(selector)
    );

    return {
      itemSelector:
        gizmodoItems.length > 0
          ? [...gizmodoItems, ...BASE_EDITORIAL_ITEM_SELECTORS].join(", ")
          : BASE_EDITORIAL_ITEM_SELECTORS.join(", "),
      containerSelector: "main",
    };
  }

  return null;
}

export function findTechEditorialInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (isNinetofiveForumsPage()) {
    const scope = getNinetofiveForumsScope(postElement);
    const primaryLink = getNinetofiveForumsPrimaryLink(postElement);

    ensureWrappedInjectionRow(scope, "knowwForumsWrapped");

    if (postElement.matches("a[href]") && postElement.parentElement) {
      return {
        container: postElement.parentElement,
        referenceElement: postElement,
        insertPosition: "after",
        postWrapper: scope,
      };
    }

    return {
      container: scope,
      referenceElement: primaryLink,
      insertPosition: primaryLink ? "after" : "append",
      postWrapper: scope,
    };
  }

  if (GIZMODO_HOST_RE.test(window.location.hostname)) {
    const directStoryLink = postElement.querySelector(
      ":scope > a.flex.flex-col.w-full.gap-5[href*='-2000']"
    );

    if (directStoryLink && postElement instanceof HTMLElement) {
      ensureWrappedInjectionRow(postElement, "knowwGizmodoWrapped");

      return {
        container: postElement,
        referenceElement: directStoryLink,
        insertPosition: "after",
        postWrapper: postElement,
      };
    }
  }

  if (ENGADGET_HOST_RE.test(window.location.hostname)) {
    return findInjectionAfterSelectors(postElement, [
      "p",
      "h4",
      ".clickable-multi-line-link",
      "h1",
    ]);
  }

  return null;
}

export function hasTechEditorialInjectedCard(
  postElement: Element
): boolean | null {
  if (isNinetofiveForumsPage()) {
    const primaryLink = getNinetofiveForumsPrimaryLink(postElement);
    if (
      primaryLink?.nextElementSibling?.getAttribute("data-knoww-injected") ===
      "true"
    ) {
      return true;
    }

    return !!getNinetofiveForumsScope(postElement).querySelector(
      ".knoww-market-card"
    );
  }

  if (
    ENGADGET_HOST_RE.test(window.location.hostname) &&
    postElement.matches("main h1")
  ) {
    const nextSibling = postElement.nextElementSibling as HTMLElement | null;
    return (
      nextSibling?.getAttribute("data-knoww-injected") === "true" ||
      !!postElement.querySelector(".knoww-market-card")
    );
  }

  return null;
}

export function getTechEditorialWrapperStyles(): string | null {
  if (isNinetofiveForumsPage()) {
    return `
      padding: 12px 0 0 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
    `;
  }

  if (GIZMODO_HOST_RE.test(window.location.hostname)) {
    return `
      padding: 12px 0 0 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      flex: 1 0 100%;
      box-sizing: border-box;
    `;
  }

  return null;
}
