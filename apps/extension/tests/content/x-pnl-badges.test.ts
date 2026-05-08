import assert from "node:assert/strict";
import test from "node:test";
import {
  extractXHandleFromTweet,
  formatPnlBadgeLabel,
  normalizeXHandle,
  prepareBadgeRowForPnlBadge,
} from "../../src/content/x-pnl-badges";

function anchor(href: string, text: string): HTMLAnchorElement {
  return {
    getAttribute(name: string): string | null {
      return name === "href" ? href : null;
    },
    textContent: text,
  } as unknown as HTMLAnchorElement;
}

function tweetWithUserName(anchors: HTMLAnchorElement[]): Element {
  return {
    querySelector(selector: string): Element | null {
      if (selector !== '[data-testid="User-Name"]') return null;
      return {
        querySelectorAll(anchorSelector: string): HTMLAnchorElement[] {
          return anchorSelector === "a[href]" ? anchors : [];
        },
      } as unknown as Element;
    },
    querySelectorAll(): HTMLAnchorElement[] {
      return [];
    },
  } as unknown as Element;
}

function anchorWithParent(href: string): {
  anchor: HTMLAnchorElement;
  parent: Element & { addedClasses: string[] };
} {
  const parent = {
    addedClasses: [] as string[],
    querySelector(): Element | null {
      return null;
    },
    classList: {
      add(className: string): void {
        parent.addedClasses.push(className);
      },
    },
  } as unknown as Element & { addedClasses: string[] };

  const item = {
    getAttribute(name: string): string | null {
      return name === "href" ? href : null;
    },
    parentElement: parent,
  } as unknown as HTMLAnchorElement;

  return { anchor: item, parent };
}

test("normalizeXHandle accepts @-prefixed X handles case-insensitively", () => {
  assert.equal(normalizeXHandle(" @SecureZer0 "), "securezer0");
});

test("normalizeXHandle rejects invalid X handles", () => {
  assert.equal(normalizeXHandle("has-dash"), null);
  assert.equal(normalizeXHandle("this_handle_is_too_long"), null);
});

test("extractXHandleFromTweet reads the author handle from the X header", () => {
  const tweet = tweetWithUserName([
    anchor("/EventWavesIO", "eventwaves | +$33.7K"),
    anchor("/EventWavesIO/status/2045506639655211513", "Apr 18"),
  ]);

  assert.equal(extractXHandleFromTweet(tweet), "eventwavesio");
});

test("prepareBadgeRowForPnlBadge marks the display-name row as horizontal", () => {
  const displayName = anchorWithParent("/EventWavesIO");
  const timestamp = anchorWithParent(
    "/EventWavesIO/status/2045506639655211513"
  );
  const tweet = tweetWithUserName([displayName.anchor, timestamp.anchor]);

  const target = prepareBadgeRowForPnlBadge(tweet, "eventwavesio");

  assert.equal(target, displayName.parent);
  assert.deepEqual(displayName.parent.addedClasses, ["knoww-x-pnl-name-row"]);
  assert.deepEqual(timestamp.parent.addedClasses, []);
});

test("formatPnlBadgeLabel compacts positive and negative PNL", () => {
  assert.equal(formatPnlBadgeLabel(33725.42), "+$33.7K");
  assert.equal(formatPnlBadgeLabel(-2720), "-$2.72K");
  assert.equal(formatPnlBadgeLabel(42), "+$42");
});
