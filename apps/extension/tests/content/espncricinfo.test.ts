import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "vitest";
import { SUPPORTED_MATCH_PATTERNS } from "../../src/supported-hosts";

type ImportedAdapter =
  typeof import("../../src/content/platforms/espncricinfo");

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  nextElementSibling: FakeElement | null = null;
  id = "";

  constructor(
    readonly tagName: string,
    readonly className = "",
    readonly textContent = ""
  ) {}

  append(child: FakeElement): FakeElement {
    const previous = this.children[this.children.length - 1];
    if (previous) {
      previous.nextElementSibling = child;
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: FakeElement, referenceChild: FakeElement | null): void {
    const existingIndex = this.children.indexOf(child);
    if (existingIndex >= 0) {
      this.children.splice(existingIndex, 1);
    }

    const referenceIndex = referenceChild
      ? this.children.indexOf(referenceChild)
      : -1;
    const insertIndex =
      referenceIndex >= 0 ? referenceIndex : this.children.length;
    child.parentElement = this;
    this.children.splice(insertIndex, 0, child);

    for (let i = 0; i < this.children.length; i++) {
      this.children[i].nextElementSibling = this.children[i + 1] || null;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  matches(selector: string): boolean {
    return selector
      .split(",")
      .map((part) => part.trim())
      .some((part) => this.matchesOne(part));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node) {
      if (node.matches(selector)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  private matchesOne(selector: string): boolean {
    if (!selector) return false;

    if (selector.startsWith(".")) {
      const requiredClasses = selector.split(".").filter(Boolean);
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      return requiredClasses.every((className) => classes.has(className));
    }

    const classIncludes = selector.match(
      /^([a-z][a-z0-9-]*)\[class~='([^']+)'\]$/i
    );
    if (classIncludes) {
      const [, tag, className] = classIncludes;
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      return (
        this.tagName.toLowerCase() === tag.toLowerCase() &&
        classes.has(className)
      );
    }

    const tagWithClasses = selector.match(/^([a-z][a-z0-9-]*)(\.[^\s>]+)+$/i);
    if (tagWithClasses) {
      const [, tag] = tagWithClasses;
      const requiredClasses = selector
        .slice(tag.length)
        .split(".")
        .filter(Boolean);
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      return (
        this.tagName.toLowerCase() === tag.toLowerCase() &&
        requiredClasses.every((className) => classes.has(className))
      );
    }

    if (selector === "article.ci-story h1") {
      return (
        this.tagName.toLowerCase() === "h1" &&
        !!this.closest("article.ci-story")
      );
    }

    if (/^h[1-6]$/.test(selector) || selector === "p") {
      return this.tagName.toLowerCase() === selector;
    }

    if (selector === "header") {
      return this.tagName.toLowerCase() === "header";
    }

    if (selector === "article" || selector === "article.ci-story") {
      return (
        this.tagName.toLowerCase() === "article" &&
        (selector === "article" ||
          this.className.split(/\s+/).includes("ci-story"))
      );
    }

    if (selector === "td") {
      return this.tagName.toLowerCase() === "td";
    }

    if (selector.startsWith("a[")) {
      const href = this.getAttribute("href") || "";
      return (
        this.tagName.toLowerCase() === "a" &&
        ((selector.includes("/story/") && href.includes("/story/")) ||
          (selector.includes("/match-preview") &&
            href.includes("/match-preview")) ||
          (selector.includes("/match-report") &&
            href.includes("/match-report")) ||
          (selector.includes("/live-match-blog") &&
            href.includes("/live-match-blog")) ||
          selector === "a[href]")
      );
    }

    return false;
  }
}

class FakeAnchor extends FakeElement {
  constructor(href: string, textContent = "") {
    super("a", "", textContent);
    this.setAttribute("href", href);
  }
}

function installLoggerStub(): void {
  const moduleLoader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    __knowwLoggerStubInstalled?: boolean;
  };
  if (moduleLoader.__knowwLoggerStubInstalled) {
    return;
  }

  const originalLoad = moduleLoader._load;
  moduleLoader._load = function loadWithLoggerStub(
    request: string,
    parent: unknown,
    isMain: boolean
  ) {
    if (request === "@knoww/logger") {
      return {
        createLogger() {
          return {
            debug() {},
            info() {},
            warn() {},
            error() {},
          };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  moduleLoader.__knowwLoggerStubInstalled = true;
}

async function importAdapter(): Promise<ImportedAdapter> {
  installLoggerStub();
  const documentElement = new FakeElement("html");
  const body = documentElement.append(new FakeElement("body"));
  const registered: unknown[] = [];

  globalThis.HTMLAnchorElement =
    FakeAnchor as unknown as typeof HTMLAnchorElement;
  globalThis.window = {
    location: { hostname: "www.espncricinfo.com", pathname: "/" },
    KNOWW_PLATFORM: {
      registerPlatform(adapter: unknown) {
        registered.push(adapter);
      },
    },
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    documentElement,
    body,
    querySelector() {
      return null;
    },
  } as unknown as Document;

  const mod = await import("../../src/content/platforms/espncricinfo");
  assert.ok(registered.length <= 1);
  return mod;
}

test("ESPNcricinfo is included in extension host match patterns", () => {
  assert.ok(
    SUPPORTED_MATCH_PATTERNS.includes("https://www.espncricinfo.com/*")
  );
  assert.ok(SUPPORTED_MATCH_PATTERNS.includes("https://espncricinfo.com/*"));
});

test("ESPNcricinfo bypasses generic English detection for score-heavy cricket text", async () => {
  const { ESPNcricinfoAdapter } = await importAdapter();

  assert.equal(ESPNcricinfoAdapter.bypassEnglishCheck, true);
});

test("ESPNcricinfo feed links inject after the story link inside the card cell", async () => {
  const { ESPNcricinfoAdapter } = await importAdapter();
  const cell = new FakeElement("td", "ds-min-w-max !ds-p-0");
  const link = cell.append(
    new FakeAnchor(
      "/series/ipl-2026-1510719/rajasthan-royals-vs-gujarat-titans-52nd-match-1529295/match-preview"
    )
  );
  link.append(
    new FakeElement(
      "h3",
      "ds-text-title-2",
      "RR brace for GT challenge as race for top four heats up"
    )
  );

  assert.equal(
    ESPNcricinfoAdapter.extractPostText(link as unknown as Element),
    "RR brace for GT challenge as race for top four heats up"
  );
  assert.equal(
    ESPNcricinfoAdapter.getPostId?.(link as unknown as Element),
    "1529295"
  );

  const point = ESPNcricinfoAdapter.findInjectionPoint(
    link as unknown as Element
  );
  assert.equal(point?.container, cell);
  assert.equal(point?.referenceElement, link);
  assert.equal(point?.insertPosition, "after");
  assert.equal(point?.postWrapper, cell);
});

test("ESPNcricinfo compact feed rows inject cards as list siblings", async () => {
  const { ESPNcricinfoAdapter } = await importAdapter();
  const list = new FakeElement("div", "ds-p-0 ds-flex ds-flex-col ds-py-2");
  const compactRow = list.append(new FakeElement("div", "ds-px-4 ds-py-2"));
  const link = compactRow.append(
    new FakeAnchor(
      "/story/ipl-orange-cap-winner-race-heats-up-before-playoffs-1529295",
      "IPL Orange Cap winner race heats up"
    )
  );

  assert.equal(
    ESPNcricinfoAdapter.extractPostText(link as unknown as Element),
    "IPL Orange Cap winner race heats up"
  );

  const point = ESPNcricinfoAdapter.findInjectionPoint(
    link as unknown as Element
  );

  assert.equal(point?.container, list);
  assert.equal(point?.referenceElement, compactRow);
  assert.equal(point?.insertPosition, "after");
  assert.equal(point?.postWrapper, compactRow);

  const injected = list.append(new FakeElement("div"));
  injected.setAttribute("data-knoww-injected", "true");
  assert.equal(
    ESPNcricinfoAdapter.hasInjectedCard?.(link as unknown as Element),
    true
  );
});

test("ESPNcricinfo live score cards include expanded team names from match URLs", async () => {
  const { ESPNcricinfoAdapter } = await importAdapter();
  const cell = new FakeElement("div", "ds-px-4 ds-py-3");
  const link = cell.append(
    new FakeAnchor(
      "/series/ipl-2026-1510719/delhi-capitals-vs-kolkata-knight-riders-51st-match-1529294/live-cricket-score",
      "Live IPL • Delhi DC142/8KKR(12.4/20 ov, T:143) 123/2KKR need 20 runs in 44 balls."
    )
  );

  const text = ESPNcricinfoAdapter.extractPostText(link as unknown as Element);

  assert.ok(/Delhi Capitals vs Kolkata Knight Riders/.test(text));
});

test("ESPNcricinfo homepage score carousel injects outside the clipped slick list", async () => {
  const { ESPNcricinfoAdapter } = await importAdapter();
  globalThis.document = {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  } as unknown as Document;
  const homepageShell = new FakeElement("div", "ci-hsb-container");
  const carousel = homepageShell.append(
    new FakeElement("div", "ci-v2-hsb-carousel")
  );
  const slider = carousel.append(
    new FakeElement("div", "slick-slider ds-carousel slick-initialized")
  );
  const list = slider.append(new FakeElement("div", "slick-list"));
  const track = list.append(new FakeElement("div", "slick-track"));
  const slide = track.append(
    new FakeElement("div", "slick-slide slick-active")
  );
  const scoreCell = slide.append(new FakeElement("div", "ds-w-[264px]"));
  const link = scoreCell.append(
    new FakeAnchor(
      "/series/ipl-2026-1510719/delhi-capitals-vs-kolkata-knight-riders-51st-match-1529294/live-cricket-score",
      "RESULT IPL • Delhi DC142/8KKR(14.2/20 ov, T:143) 147/2"
    )
  );

  const point = ESPNcricinfoAdapter.findInjectionPoint(
    link as unknown as Element
  );

  assert.equal(
    point?.container.className,
    "knoww-espncricinfo-score-market-grid"
  );
  assert.equal(point?.container.parentElement, homepageShell);
  assert.equal(carousel.nextElementSibling, point?.container);
  assert.equal(point?.referenceElement, null);
  assert.equal(point?.insertPosition, "append");
  assert.equal(point?.postWrapper, scoreCell);
  assert.equal(
    point?.wrapperClassName,
    "knoww-espncricinfo-score-market-wrapper"
  );
  assert.equal(point?.cardClassName, undefined);
});

test("ESPNcricinfo cricket-news scans main feed and compact right rail links", async () => {
  const { ESPNcricinfoAdapter } = await importAdapter();
  globalThis.document = {
    querySelector(selector: string) {
      return selector.includes("#__next") ||
        selector.includes("div.ds-border-b.ds-border-line.ds-p-4 > a") ||
        selector.includes("div.ds-px-4.ds-py-2 > a")
        ? (new FakeElement("a") as unknown as Element)
        : null;
    },
  } as unknown as Document;

  const selectors = ESPNcricinfoAdapter.getDynamicSelectors?.();

  assert.ok(
    selectors?.itemSelector.includes(
      "div.ds-border-b.ds-border-line.ds-p-4 > a[href*='/story/']"
    )
  );
  assert.ok(
    selectors?.itemSelector.includes("div.ds-px-4.ds-py-2 > a[href*='/story/']")
  );
});

test("ESPNcricinfo live scores scan scorecard and live-score match links", async () => {
  const { ESPNcricinfoAdapter } = await importAdapter();
  globalThis.document = {
    querySelector(selector: string) {
      return selector.includes("#__next") ||
        selector.includes("div.ds-px-4.ds-py-3 > a") ||
        selector.includes("div[class~='ds-w-[264px]'] > a")
        ? (new FakeElement("a") as unknown as Element)
        : null;
    },
  } as unknown as Document;

  const selectors = ESPNcricinfoAdapter.getDynamicSelectors?.();

  assert.ok(
    selectors?.itemSelector.includes(
      "div.ds-px-4.ds-py-3 > a[href*='/series/'][href*='/live-cricket-score']"
    )
  );
  assert.ok(
    selectors?.itemSelector.includes(
      "div[class~='ds-w-[264px]'] > a[href*='/series/'][href*='/full-scorecard']"
    )
  );
});

test("ESPNcricinfo article pages inject after the article header", async () => {
  const { ESPNcricinfoAdapter } = await importAdapter();
  const article = new FakeElement("article", "ds-text-typo ci-story");
  const header = article.append(new FakeElement("header"));
  const headline = header.append(
    new FakeElement(
      "h1",
      "ds-text-title-xl",
      "Shanto walks down the track to extend hot streak in Test cricket"
    )
  );
  header.append(
    new FakeElement(
      "p",
      "",
      "Mominul said Shanto's counter-attacking shots put Pakistan under pressure"
    )
  );

  assert.equal(
    ESPNcricinfoAdapter.extractPostText(headline as unknown as Element),
    "Shanto walks down the track to extend hot streak in Test cricket Mominul said Shanto's counter-attacking shots put Pakistan under pressure"
  );

  const point = ESPNcricinfoAdapter.findInjectionPoint(
    headline as unknown as Element
  );
  assert.equal(point?.container, article);
  assert.equal(point?.referenceElement, header);
  assert.equal(point?.insertPosition, "after");
  assert.equal(point?.postWrapper, article);
});
