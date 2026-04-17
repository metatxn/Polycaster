import type {
  CardStyles,
  InjectionPoint,
  ThemeStyles,
} from "../../types/platform";

export function normalizeText(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

// Capture up to two trailing path segments so that articles sharing a final
// slug across different sections (e.g. /politics/news vs /sports/news) do not
// collide on the post-id derived from this match. The optional prefix segment
// excludes "." so that the host portion of an absolute URL (e.g. "cnbc.com")
// is never picked up as a section qualifier.
export const GENERIC_LINK_PATTERN = /\/((?:[^/?#.]+\/)?[^/?#]+)\/?(?:[?#]|$)/i;

export function collectTextParts(
  scope: ParentNode,
  selectors: string[]
): string[] {
  const parts: string[] = [];

  for (const selector of selectors) {
    if (!selector) continue;

    if (
      "matches" in scope &&
      typeof scope.matches === "function" &&
      scope.matches(selector)
    ) {
      const text = normalizeText((scope as Element).textContent);
      if (text && !parts.includes(text)) {
        parts.push(text);
      }
    }

    if (
      !("querySelectorAll" in scope) ||
      typeof scope.querySelectorAll !== "function"
    ) {
      continue;
    }

    for (const node of Array.from(scope.querySelectorAll(selector))) {
      const text = normalizeText(node.textContent);
      if (text && !parts.includes(text)) {
        parts.push(text);
      }
    }
  }

  return parts;
}

export function combineTextParts(
  parts: Array<string | null | undefined>,
  minLength = 20
): string {
  const combined = parts
    .map((part) => normalizeText(part))
    .filter((part, index, array) => part && array.indexOf(part) === index)
    .join(" ")
    .trim();

  return combined.length >= minLength ? combined : "";
}

export function detectGenericTheme(): "dark" | "light" {
  const themeOverride = window.KNOWW_CONFIG?.getThemeOverride?.();
  if (themeOverride && themeOverride !== "auto") {
    return themeOverride === "light" ? "light" : "dark";
  }

  const classHints = [
    document.documentElement.className,
    document.body.className,
    document.documentElement.getAttribute("data-theme"),
    document.body.getAttribute("data-theme"),
    document.documentElement.getAttribute("data-color-mode"),
    document.body.getAttribute("data-color-mode"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    classHints.includes("dark") ||
    classHints.includes("night") ||
    classHints.includes("midnight")
  ) {
    return "dark";
  }

  const bodyBg = window.getComputedStyle(document.body).backgroundColor;
  const rgbMatch = bodyBg.match(
    /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)/i
  );
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    return luminance < 145 ? "dark" : "light";
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

interface GenericCardStyleOptions {
  accentColor: string;
  fontFamily: string;
  borderRadius?: string;
  cardPadding?: string;
  cardMargin?: string;
  lightTheme?: Partial<ThemeStyles>;
  darkTheme?: Partial<ThemeStyles>;
}

export function buildGenericCardStyles(
  options: GenericCardStyleOptions,
  theme: "dark" | "light"
): CardStyles {
  const lightTheme: ThemeStyles = {
    backgroundColor: "rgb(255, 255, 255)",
    borderColor: "rgba(0, 0, 0, 0.12)",
    textColor: "rgb(28, 28, 28)",
    secondaryTextColor: "rgb(99, 99, 99)",
    cardBg: "rgb(247, 247, 248)",
    ...(options.lightTheme || {}),
  };

  const darkTheme: ThemeStyles = {
    backgroundColor: "rgb(32, 32, 33)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    textColor: "rgb(240, 240, 240)",
    secondaryTextColor: "rgba(255, 255, 255, 0.7)",
    cardBg: "rgb(44, 44, 46)",
    ...(options.darkTheme || {}),
  };

  return {
    fontFamily: options.fontFamily,
    cardPadding: options.cardPadding || "12px 16px",
    cardMargin: options.cardMargin || "8px 0",
    borderRadius: options.borderRadius || "12px",
    accentColor: options.accentColor,
    ...(theme === "dark" ? darkTheme : lightTheme),
    theme,
  };
}

export function findFirstMatchingSelector(
  selectors: string[],
  scope: ParentNode = document
): string {
  const validSelectors = selectors
    .map((selector) => selector.trim())
    .filter(Boolean);
  if (validSelectors.length === 0) {
    throw new Error("findFirstMatchingSelector requires at least one selector");
  }

  return (
    validSelectors.find((selector) => scope.querySelector(selector)) ||
    validSelectors[0]
  );
}

export function buildDynamicSelectors(
  itemSelector: string,
  containerSelectors: string[]
): { itemSelector: string; containerSelector: string } {
  return {
    itemSelector,
    containerSelector: findFirstMatchingSelector(containerSelectors),
  };
}

export function findInjectionAfterSelectors(
  postElement: Element,
  selectors: string[]
): InjectionPoint | null {
  for (const selector of selectors) {
    if (!selector) continue;

    const reference = postElement.matches(selector)
      ? postElement
      : postElement.querySelector(selector);
    if (reference?.parentElement) {
      return {
        container: reference.parentElement,
        referenceElement: reference,
        insertPosition: "after",
        postWrapper: postElement,
      };
    }
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

export function findInjectionBeforeSelectors(
  postElement: Element,
  selectors: string[]
): InjectionPoint {
  for (const selector of selectors) {
    const reference = postElement.querySelector(selector);
    if (reference?.parentElement) {
      return {
        container: reference.parentElement,
        referenceElement: reference,
        insertPosition: "before",
        postWrapper: postElement,
      };
    }
  }

  return {
    container: postElement,
    referenceElement: null,
    insertPosition: "append",
    postWrapper: postElement,
  };
}

export function extractPostIdFromAttributes(
  postElement: Element,
  attributeNames: string[]
): string | null {
  for (const attributeName of attributeNames) {
    const directValue = postElement.getAttribute(attributeName);
    if (directValue) {
      return directValue;
    }

    const descendant =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? postElement.querySelector(`[${CSS.escape(attributeName)}]`)
        : Array.from(postElement.querySelectorAll("*")).find((element) =>
            element.hasAttribute(attributeName)
          );
    const value = descendant?.getAttribute(attributeName);
    if (value) {
      return value;
    }
  }

  return null;
}

export function extractPostIdFromLink(
  postElement: Element,
  hrefPattern: RegExp
): string | null {
  const link = postElement.matches("a[href]")
    ? postElement
    : postElement.querySelector("a[href]");
  const href = link?.getAttribute("href");
  const match = href?.match(hrefPattern);
  return match?.[1] || null;
}
