import assert from "node:assert/strict";
import test from "node:test";
import { extractPostIdFromLink } from "../../src/content/platforms/helpers";

function createFakeAnchor(href: string): Element {
  return {
    matches(selector: string): boolean {
      return selector === "a[href]";
    },
    getAttribute(name: string): string | null {
      return name === "href" ? href : null;
    },
    querySelector(): Element | null {
      return null;
    },
  } as unknown as Element;
}

function createFakeContainer(anchor: Element | null): Element {
  return {
    matches(): boolean {
      return false;
    },
    getAttribute(): string | null {
      return null;
    },
    querySelector(selector: string): Element | null {
      return selector === "a[href]" ? anchor : null;
    },
  } as unknown as Element;
}

test("extractPostIdFromLink supports anchor-root adapters", () => {
  const anchor = createFakeAnchor("/story/warner-bros-deal");

  assert.equal(
    extractPostIdFromLink(anchor, /\/story\/([^/?#]+)/),
    "warner-bros-deal"
  );
});

test("extractPostIdFromLink still supports descendant anchors", () => {
  const anchor = createFakeAnchor("/story/netflix-preview");
  const container = createFakeContainer(anchor);

  assert.equal(
    extractPostIdFromLink(container, /\/story\/([^/?#]+)/),
    "netflix-preview"
  );
});

test("extractPostIdFromLink returns null when no matching link exists", () => {
  const container = createFakeContainer(null);

  assert.equal(extractPostIdFromLink(container, /\/story\/([^/?#]+)/), null);
});
