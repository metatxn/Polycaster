import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "vitest";
import { SUPPORTED_MATCH_PATTERNS } from "../../src/supported-hosts";

type ImportedAdapter = typeof import("../../src/content/platforms/fox-sports");

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  nextElementSibling: FakeElement | null = null;
  previousElementSibling: FakeElement | null = null;

  constructor(
    readonly tagName: string,
    readonly className = "",
    readonly textContent = ""
  ) {}

  append(child: FakeElement): FakeElement {
    const previous = this.children[this.children.length - 1];
    if (previous) {
      previous.nextElementSibling = child;
      child.previousElementSibling = previous;
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;

    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index === -1) return;

    const previous = siblings[index - 1] || null;
    const next = siblings[index + 1] || null;
    if (previous) previous.nextElementSibling = next;
    if (next) next.previousElementSibling = previous;

    siblings.splice(index, 1);
    this.parentElement = null;
    this.previousElementSibling = null;
    this.nextElementSibling = null;
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
    const normalizedSelectors = selector
      .split(",")
      .map((part) => part.trim().split(/\s+/).at(-1) || "")
      .filter(Boolean);

    for (const child of this.children) {
      if (normalizedSelectors.some((part) => child.matches(part))) {
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

    if (selector === "body") {
      return this.tagName.toLowerCase() === "body";
    }

    if (selector === "#__nuxt") {
      return this.getAttribute("id") === "__nuxt";
    }

    if (selector.startsWith(".")) {
      const requiredClasses = selector.split(".").filter(Boolean);
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      return requiredClasses.every((className) => classes.has(className));
    }

    const tagWithClass = selector.match(/^([a-z][a-z0-9-]*)\.([^\s[]+)$/i);
    if (tagWithClass) {
      const [, tag, className] = tagWithClass;
      return (
        this.tagName.toLowerCase() === tag.toLowerCase() &&
        this.className.split(/\s+/).includes(className)
      );
    }

    const attrContains = selector.match(
      /^([a-z][a-z0-9-]*)?\[([^=\]]+)\*=['"]([^'"]+)['"]\]$/i
    );
    if (attrContains) {
      const [, tag, attr, needle] = attrContains;
      return (
        (!tag || this.tagName.toLowerCase() === tag.toLowerCase()) &&
        (this.getAttribute(attr) || "").includes(needle)
      );
    }

    const attrExists = selector.match(/^([a-z][a-z0-9-]*)?\[([^=\]]+)\]$/i);
    if (attrExists) {
      const [, tag, attr] = attrExists;
      return (
        (!tag || this.tagName.toLowerCase() === tag.toLowerCase()) &&
        this.getAttribute(attr) !== null
      );
    }

    if (/^h[1-6]$/.test(selector) || selector === "p") {
      return this.tagName.toLowerCase() === selector;
    }

    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
}

class FakeAnchor extends FakeElement {
  constructor(href: string, textContent = "", className = "") {
    super("a", className, textContent);
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

function installDom(pathname: string, title = ""): FakeElement {
  const documentElement = new FakeElement("html");
  const body = documentElement.append(new FakeElement("body"));
  const location = {
    href: `https://www.foxsports.com${pathname}`,
    hostname: "www.foxsports.com",
    origin: "https://www.foxsports.com",
    pathname,
  };

  globalThis.HTMLAnchorElement =
    FakeAnchor as unknown as typeof HTMLAnchorElement;
  globalThis.window = {
    location,
    KNOWW_CONFIG: {
      POLYMARKET_EVENTS_KEYSET_API_URL:
        "https://gamma-api.polymarket.com/events/keyset",
    },
    KNOWW_UTILS: {
      isExtensionContextValid: () => true,
      log() {},
      safeSendMessage: async () => ({
        ok: true,
        text: JSON.stringify({ events: [] }),
      }),
    },
    KNOWW_PLATFORM: {
      registerPlatform() {},
    },
  } as unknown as Window & typeof globalThis;
  globalThis.location = location as unknown as Location;
  globalThis.document = {
    title,
    documentElement,
    body,
    querySelector(selector: string) {
      return documentElement.querySelector(selector);
    },
    querySelectorAll(selector: string) {
      return documentElement.querySelectorAll(selector);
    },
  } as unknown as Document;

  return body;
}

async function importAdapter(): Promise<ImportedAdapter> {
  installLoggerStub();
  return import("../../src/content/platforms/fox-sports");
}

test("FOX Sports is included in extension host match patterns", () => {
  assert.ok(SUPPORTED_MATCH_PATTERNS.includes("https://www.foxsports.com/*"));
  assert.ok(SUPPORTED_MATCH_PATTERNS.includes("https://foxsports.com/*"));
});

test("FOX Sports uses stream surface for live/watch pages and feed surface for schedule hubs", async () => {
  installDom("/live", "FOX Sports Live - Watch Live Sports");
  const { FoxSportsAdapter } = await importAdapter();

  assert.equal(FoxSportsAdapter.surface, "stream");

  installDom(
    "/watch/fmc-0qmhxagaet0jv1v2",
    "Netherlands vs Japan Highlights | 2026 FIFA World Cup™ | FOX Sports"
  );
  assert.equal(FoxSportsAdapter.surface, "stream");

  installDom("/soccer/fifa-world-cup", "Men's 2026 World Cup");
  assert.equal(FoxSportsAdapter.surface, "feed");
});

test("FOX Sports stream context extracts FIFA World Cup signal from video pages", async () => {
  const body = installDom(
    "/watch/fmc-0qmhxagaet0jv1v2",
    "Netherlands vs Japan Highlights | 2026 FIFA World Cup™ | FOX Sports"
  );
  body.append(new FakeElement("h1", "", "Netherlands vs Japan Highlights"));
  const { FoxSportsAdapter } = await importAdapter();

  const ctx = FoxSportsAdapter.getStreamContext?.();

  assert.equal(ctx?.game, "FIFA World Cup");
  assert.equal(ctx?.gameSlug, "fifa-world-cup");
  assert.equal(ctx?.title, "Netherlands vs Japan Highlights");
  assert.equal(ctx?.isLive, false);
});

test("FOX Sports schedule hubs scan game-boxscore anchors as traditional feed items", async () => {
  const body = installDom("/soccer/fifa-world-cup", "Men's 2026 World Cup");
  const main = body.append(new FakeElement("main", "fscom-main-content"));
  const matchLink = main.append(
    new FakeAnchor(
      "/soccer/fifa-world-cup-men-germany-vs-curacao-jun-19-2026-game-boxscore-647614",
      "GROUP E Germany 1-0-0 GER 7 Curacao 0-0-1 CUW 1 FINAL"
    )
  );
  const { FoxSportsAdapter } = await importAdapter();

  const selectors = FoxSportsAdapter.getDynamicSelectors?.();
  const text = FoxSportsAdapter.extractPostText(matchLink);
  const injectionPoint = FoxSportsAdapter.findInjectionPoint(matchLink);

  assert.match(selectors?.itemSelector || "", /-game-boxscore-/);
  assert.match(text, /Germany/);
  assert.match(text, /Curacao/);
  assert.equal(
    FoxSportsAdapter.getPostId?.(matchLink),
    "foxsports-event-647614"
  );
  assert.equal(injectionPoint?.referenceElement, matchLink);
  assert.equal(injectionPoint?.insertPosition, "after");
});

test("FOX Sports schedule cards use Nuxt event data for exact match text", async () => {
  const body = installDom("/soccer/fifa-world-cup", "Men's 2026 World Cup");
  const main = body.append(new FakeElement("main", "fscom-main-content"));
  const matchLink = main.append(
    new FakeAnchor(
      "/soccer/fifa-world-cup-men-germany-vs-curacao-jun-14-2026-game-boxscore-647624",
      "GROUP E Germany 1-0-0 7 Curacao 0-0-1 1 FINAL GER -2857 OVER 4.5"
    )
  );
  (
    globalThis.window as Window & {
      __NUXT__?: unknown;
    }
  ).__NUXT__ = {
    data: {
      "options:asyncdata:special-event-page": {
        mainComponents: [
          {
            props: {
              template: "schedule-scorechips",
              componentName: "schedule",
              scoresData: {
                segment: {
                  events: [
                    {
                      contentUri: "soccer/wc/events/647624",
                      eventTime: "2026-06-14T17:00:00Z",
                      statusLine: "FINAL",
                      league: "WORLD CUP",
                      gameNotes: "GROUP E",
                      eventHeadline:
                        "Germany crushes Curaçao, powered by Havertz's 2 goals",
                      oddsLine: "GER -2857",
                      overUnderLine: "OVER 4.5",
                      entityLink: {
                        webUrl:
                          "/soccer/fifa-world-cup-men-germany-vs-curacao-jun-14-2026-game-boxscore-647624",
                        layout: { tokens: { id: "647624" } },
                      },
                      upperTeam: {
                        name: "GER",
                        longName: "Germany",
                        score: 7,
                        record: "1-0-0",
                      },
                      lowerTeam: {
                        name: "CUW",
                        longName: "Curacao",
                        score: 1,
                        record: "0-0-1",
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
  const { FoxSportsAdapter } = await importAdapter();

  const text = FoxSportsAdapter.extractPostText(matchLink);

  assert.equal(
    FoxSportsAdapter.getPostId?.(matchLink),
    "foxsports-event-647624"
  );
  assert.match(text, /^FIFA World Cup match: Germany vs Curacao\./);
  assert.match(text, /Status: FINAL\./);
  assert.match(text, /Score: Germany 7, Curacao 1\./);
  assert.match(text, /Group: GROUP E\./);
  assert.match(text, /Odds: GER -2857\./);
  assert.match(text, /Total: OVER 4\.5\./);
  assert.match(
    text,
    /Headline: Germany crushes Curaçao, powered by Havertz's 2 goals\./
  );
  assert.doesNotMatch(text, /1-0-0|0-0-1/);
});

test("FOX Sports schedule cleanup removes orphaned date-change cards", async () => {
  const body = installDom("/soccer/fifa-world-cup", "Men's 2026 World Cup");
  const scores = body.append(new FakeElement("div", "ses-scorechips scores"));
  const staleWrapper = scores.append(
    new FakeElement("div", "knoww-stacked-cards knoww-platform-fox-sports")
  );
  staleWrapper.setAttribute("data-knoww-injected", "true");
  staleWrapper.setAttribute("data-knoww-platform", "fox-sports");
  staleWrapper.setAttribute(
    "data-knoww-post-key",
    "fox-sports:foxsports-event-647624"
  );

  const currentLink = scores.append(
    new FakeAnchor(
      "/soccer/fifa-world-cup-men-france-vs-senegal-jun-16-2026-game-boxscore-647633",
      "GROUP I France 0-0-0 Senegal 0-0-0 12:30AM"
    )
  );
  const currentWrapper = scores.append(
    new FakeElement("div", "knoww-stacked-cards knoww-platform-fox-sports")
  );
  currentWrapper.setAttribute("data-knoww-injected", "true");
  currentWrapper.setAttribute("data-knoww-platform", "fox-sports");
  currentWrapper.setAttribute(
    "data-knoww-post-key",
    "fox-sports:foxsports-event-647633"
  );

  const mismatchedLink = scores.append(
    new FakeAnchor(
      "/soccer/fifa-world-cup-men-iraq-vs-norway-jun-16-2026-game-boxscore-647634",
      "GROUP I Iraq 0-0-0 Norway 0-0-0 3:30AM"
    )
  );
  const mismatchedWrapper = scores.append(
    new FakeElement("div", "knoww-stacked-cards knoww-platform-fox-sports")
  );
  mismatchedWrapper.setAttribute("data-knoww-injected", "true");
  mismatchedWrapper.setAttribute("data-knoww-platform", "fox-sports");
  mismatchedWrapper.setAttribute(
    "data-knoww-post-key",
    "fox-sports:foxsports-event-647624"
  );
  const { FoxSportsAdapter } = await importAdapter();

  (
    FoxSportsAdapter as typeof FoxSportsAdapter & {
      cleanupStaleInjections?: () => void;
    }
  ).cleanupStaleInjections?.();

  assert.equal(staleWrapper.parentElement, null);
  assert.equal(mismatchedWrapper.parentElement, null);
  assert.equal(currentWrapper.parentElement, scores);
  assert.equal(currentLink.nextElementSibling, currentWrapper);
  assert.equal(mismatchedLink.nextElementSibling, null);
});

test("FOX Sports schedule rows bypass generic search when no direct sports event matches", async () => {
  const body = installDom("/soccer/fifa-world-cup", "Men's 2026 World Cup");
  const main = body.append(new FakeElement("main", "fscom-main-content"));
  const matchLink = main.append(
    new FakeAnchor(
      "/soccer/fifa-world-cup-men-spain-vs-cabo-verde-jun-15-2026-game-boxscore-647700"
    )
  );
  const upperRow = matchLink.append(new FakeElement("div", "score-team-row"));
  const upperName = upperRow.append(
    new FakeElement("div", "score-team-name team")
  );
  upperName.append(new FakeElement("span", "scores-text", "Spain"));
  const upperAbbr = upperRow.append(
    new FakeElement("div", "score-team-name abbreviation")
  );
  upperAbbr.append(new FakeElement("span", "scores-text", "ESP"));

  const lowerRow = matchLink.append(new FakeElement("div", "score-team-row"));
  const lowerName = lowerRow.append(
    new FakeElement("div", "score-team-name team")
  );
  lowerName.append(new FakeElement("span", "scores-text", "Cape Verde"));
  const lowerAbbr = lowerRow.append(
    new FakeElement("div", "score-team-name abbreviation")
  );
  lowerAbbr.append(new FakeElement("span", "scores-text", "CPV"));
  const { FoxSportsAdapter } = await importAdapter();

  const resolution = await FoxSportsAdapter.resolveDirectMarkets?.(matchLink);

  assert.equal(resolution?.bypassGenericSearch, true);
  assert.deepEqual(resolution?.markets, []);
  assert.match(resolution?.postText || "", /Spain vs Cape Verde/i);
});

test("FOX Sports schedule rows resolve direct sports live markets before generic scoring", async () => {
  const body = installDom("/soccer/fifa-world-cup", "Men's 2026 World Cup");
  const main = body.append(new FakeElement("main", "fscom-main-content"));
  const matchLink = main.append(
    new FakeAnchor(
      "/soccer/fifa-world-cup-men-spain-vs-cabo-verde-jun-15-2026-game-boxscore-647700",
      "GROUP B Spain 0-0-0 Cabo Verde 0-0-0 12:00 PM ET"
    )
  );
  (
    globalThis.window as Window & {
      __NUXT__?: unknown;
    }
  ).__NUXT__ = {
    data: {
      "options:asyncdata:special-event-page": {
        mainComponents: [
          {
            props: {
              template: "schedule-scorechips",
              componentName: "schedule",
              scoresData: {
                segment: {
                  events: [
                    {
                      contentUri: "soccer/wc/events/647700",
                      eventTime: "2026-06-15T16:00:00Z",
                      statusLine: "12:00 PM ET",
                      league: "WORLD CUP",
                      entityLink: {
                        webUrl:
                          "/soccer/fifa-world-cup-men-spain-vs-cabo-verde-jun-15-2026-game-boxscore-647700",
                        layout: { tokens: { id: "647700" } },
                      },
                      upperTeam: {
                        name: "ESP",
                        longName: "Spain",
                      },
                      lowerTeam: {
                        name: "CVI",
                        longName: "Cabo Verde",
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
  (
    globalThis.window as Window & {
      KNOWW_UTILS: {
        safeSendMessage: () => Promise<{ ok: boolean; text: string }>;
      };
    }
  ).KNOWW_UTILS.safeSendMessage = async () => ({
    ok: true,
    text: JSON.stringify({
      events: [
        {
          id: "510232",
          slug: "fifwc-esp-cvi-2026-06-15",
          title: "Spain vs. Cabo Verde",
          active: true,
          closed: false,
          live: true,
          startTime: "2026-06-15T16:00:00Z",
          teams: [
            { name: "Spain", abbreviation: "ESP", league: "fifwc" },
            { name: "Cabo Verde", abbreviation: "CVI", league: "fifwc" },
          ],
          tags: [{ slug: "fifa-world-cup", label: "FIFA World Cup" }],
          markets: [
            {
              id: "2322490",
              active: true,
              closed: false,
              acceptingOrders: true,
              question: "Will Spain win on 2026-06-15?",
              groupItemTitle: "Spain",
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.755","0.245"]',
              clobTokenIds: '["spain_yes","spain_no"]',
              conditionId: "0xspain",
              gameStartTime: "2026-06-15 16:00:00+00",
              sportsMarketType: "moneyline",
            },
            {
              id: "2322491",
              active: true,
              closed: false,
              acceptingOrders: true,
              question: "Will Cabo Verde win on 2026-06-15?",
              groupItemTitle: "Cabo Verde",
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.065","0.935"]',
              clobTokenIds: '["cabo_yes","cabo_no"]',
              conditionId: "0xcabo",
              gameStartTime: "2026-06-15 16:00:00+00",
              sportsMarketType: "moneyline",
            },
          ],
        },
      ],
    }),
  });
  const { FoxSportsAdapter } = await importAdapter();

  const resolution = await FoxSportsAdapter.resolveDirectMarkets?.(matchLink);

  assert.equal(resolution?.bypassGenericSearch, true);
  assert.equal(resolution?.markets.length, 1);
  assert.equal(resolution?.markets[0].market.title, "Spain vs. Cabo Verde");
  assert.deepEqual(resolution?.markets[0].market._preferredOutcomeNames, [
    "Spain",
    "Cabo Verde",
  ]);
});
