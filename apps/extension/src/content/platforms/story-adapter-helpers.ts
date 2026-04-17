import { normalizeText } from "./helpers";

export function getFirstMatchingText(
  scope: ParentNode,
  selectors: readonly string[]
): string | null {
  for (const selector of selectors) {
    if (!selector) continue;

    const match =
      "matches" in scope &&
      typeof scope.matches === "function" &&
      scope.matches(selector)
        ? (scope as Element)
        : scope.querySelector?.(selector);

    const text = normalizeText(match?.textContent);
    if (text) {
      return text;
    }
  }

  return null;
}

export function stripTrailingBylineFragment(text: string | null): string {
  if (!text) return "";

  // Only strip a trailing "FirstName LastName" fragment when it follows a
  // sentence terminator. Without that gate, legitimate titles ending in
  // proper nouns (e.g. "...met with Chief Justice John Roberts") would be
  // truncated. The terminator is preserved via the $1 backreference.
  return normalizeText(
    text.replace(/([.!?])\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/, "$1")
  );
}

export function stripMediaFromClone(root: Element): Element {
  const clone = root.cloneNode(true) as Element;
  clone
    .querySelectorAll("svg, picture, img, video, script, style")
    .forEach((element) => {
      element.remove();
    });
  return clone;
}

export function getDocumentDescription(): string {
  return normalizeText(
    document
      .querySelector(
        'meta[name="description"], meta[property="og:description"]'
      )
      ?.getAttribute("content")
  );
}

export function findPrimaryLinkFromSelectors(
  postElement: Element,
  scope: Element,
  selectors: readonly string[]
): HTMLAnchorElement | null {
  for (const selector of selectors) {
    if (
      postElement instanceof HTMLAnchorElement &&
      postElement.matches(selector)
    ) {
      return postElement;
    }

    const closestLink = scope.closest(selector);
    if (closestLink instanceof HTMLAnchorElement) {
      return closestLink;
    }

    const nestedLink = scope.querySelector<HTMLAnchorElement>(selector);
    if (nestedLink) {
      return nestedLink;
    }
  }

  return null;
}

export function hasInjectedCardSibling(target: Element): boolean {
  const sibling = target.nextElementSibling as HTMLElement | null;
  return (
    sibling?.getAttribute("data-knoww-injected") === "true" ||
    !!target.querySelector(".knoww-market-card")
  );
}

export function getFullWidthCardWrapperStyles(options?: {
  listStyleNone?: boolean;
}): string {
  const listStyle = options?.listStyleNone ? "list-style: none;" : "";

  return `
    padding: 12px 0 0 0;
    margin: 0;
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    align-self: stretch;
    flex: 0 0 auto;
    grid-column: 1 / -1;
    ${listStyle}
  `;
}
