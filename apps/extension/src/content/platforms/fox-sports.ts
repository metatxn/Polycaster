import type {
  DirectMarketResolution,
  InjectionPoint,
  PlatformAdapter,
  SportsMatchCandidate,
  StreamContext,
} from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { resolveDirectSportsMarket } from "../sports-live-market-source";
import { createBasicAdapter } from "./basic-adapter";
import {
  combineTextParts,
  GENERIC_LINK_PATTERN,
  normalizeText,
} from "./helpers";
import {
  findPrimaryLinkFromSelectors,
  getDocumentDescription,
  getFirstMatchingText,
  getFullWidthCardWrapperStyles,
  hasInjectedCardSibling,
} from "./story-adapter-helpers";

const FOXSPORTS_HOST_RE = /^(?:www\.)?foxsports\.com$/i;

// Every editorial article on Fox Sports lives under /stories/{sport}/{slug};
// box-score pages use /{sport}/{team-slug}-{numeric-id}. Both are handled by
// the feed-detection logic — isArticlePage just needs a story headline.
const FOXSPORTS_ARTICLE_PATH_RE =
  /^\/(?:stories\/[^/?#]+\/[^/?#]+|[a-z-]+\/[^/?#]+-\d{3,})\/?(?:[?#].*)?$/i;
const FOXSPORTS_STREAM_PATH_RE = /^\/(?:live|watch\/[^/?#]+)\/?$/i;
const FOXSPORTS_GAME_BOXSCORE_ID_RE = /game-boxscore-(\d+)/i;
const FOXSPORTS_NUXT_SPECIAL_EVENT_KEY = "options:asyncdata:special-event-page";
const FOXSPORTS_DATE_SLUG_RE =
  /-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{1,2})-(\d{4})-game-boxscore-/i;
const FOXSPORTS_MONTH_INDEX: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

const FOXSPORTS_CONTAINER_SELECTORS = [
  ".fscom-main-content",
  "#__nuxt",
  "body",
] as const;

const FOXSPORTS_SCHEDULE_ITEM_ROOT_SELECTORS = [
  "a[href*='-game-boxscore-']",
] as const;
const FOXSPORTS_SCHEDULE_CONTAINER_SELECTOR = ".ses-scorechips.scores";

const FOXSPORTS_PRIMARY_LINK_SELECTORS = [
  "a[href*='-game-boxscore-']",
  "a.card-story[href]",
  "a[href*='/stories/']",
  "a[href*='/watch/']",
  ".article-texts a[href]",
  "a[href*='foxsports.com/stories/']",
  "a[href]",
] as const;

// Homepage story units. `.news-article` and `.article-container` are the same
// element with stacked classes, so we keep both as item roots so whichever
// variant persists across templates still matches.
const FOXSPORTS_FEED_ITEM_ROOT_SELECTORS = [
  ".news-article",
  ".article-container",
  "a.card-story",
  ...FOXSPORTS_SCHEDULE_ITEM_ROOT_SELECTORS,
] as const;

const FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS = [
  "h1.story-title",
  ".story-header-container h1",
] as const;

const FOXSPORTS_TITLE_SELECTORS = [
  "h1.story-title",
  ".story-header-container h1",
  ".article-texts h1",
  ".article-texts h2",
  ".article-texts h3",
  "h1",
  "h2",
  "h3",
] as const;

const FOXSPORTS_DESCRIPTION_SELECTORS = [
  ".article-texts p",
  ".article-texts [class*='description']",
  ".article-texts [class*='summary']",
  ".story-topic",
  "p",
] as const;

const FOXSPORTS_STREAM_TITLE_SELECTORS = [
  "[class*='video-title']",
  "[class*='event-title']",
  "[class*='matchup']",
  "h1",
] as const;

function isFoxSportsStreamPath(): boolean {
  return FOXSPORTS_STREAM_PATH_RE.test(window.location.pathname);
}

function cleanFoxSportsTitle(value: string | null | undefined): string {
  return normalizeText(value)
    .replace(/\s*\|\s*FOX Sports\s*$/i, "")
    .replace(/\s*\|\s*FOX Sports.*$/i, "")
    .trim();
}

function firstFoxSportsStreamTitle(): string {
  for (const selector of FOXSPORTS_STREAM_TITLE_SELECTORS) {
    const text = cleanFoxSportsTitle(
      document.querySelector(selector)?.textContent
    );
    if (text && !/^(?:watch|live now|trending)$/i.test(text)) return text;
  }

  const title = cleanFoxSportsTitle(document.title);
  return /^(?:fox sports live|watch)$/i.test(title) ? "" : title;
}

function getFoxSportsStreamGameSignal(): { game: string; slug: string } | null {
  const combined = normalizeText(
    `${document.title || ""} ${document.body?.textContent || ""}`
  ).toLowerCase();

  if (/\bfifa\b|\bfifa wc\b|\bworld cup\b/.test(combined)) {
    return { game: "FIFA World Cup", slug: "fifa-world-cup" };
  }

  if (/\bsoccer\b/.test(combined)) {
    return { game: "Soccer", slug: "soccer" };
  }

  return null;
}

function getFoxSportsStreamContext(): StreamContext | null {
  if (!isFoxSportsStreamPath()) return null;

  const title = firstFoxSportsStreamTitle();
  const gameSignal = getFoxSportsStreamGameSignal();
  return {
    game: gameSignal?.game || "",
    gameSlug: gameSignal?.slug,
    title,
    tags: ["FOX Sports"],
    isLive: window.location.pathname === "/live",
  };
}

type FoxSportsRecord = Record<string, unknown>;

interface FoxSportsScheduleTeam {
  name?: string;
  longName?: string;
  score?: string;
}

interface FoxSportsScheduleEvent {
  id?: string;
  eventTime?: string;
  statusLine?: string;
  league?: string;
  gameNotes?: string;
  eventHeadline?: string;
  oddsLine?: string;
  overUnderLine?: string;
  webUrl?: string;
  upperTeam?: FoxSportsScheduleTeam;
  lowerTeam?: FoxSportsScheduleTeam;
}

function asFoxSportsRecord(value: unknown): FoxSportsRecord | null {
  return value && typeof value === "object" ? (value as FoxSportsRecord) : null;
}

function asFoxSportsString(value: unknown): string {
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function getFoxSportsScheduleEventIdFromHref(
  href: string | null | undefined
): string | null {
  return href?.match(FOXSPORTS_GAME_BOXSCORE_ID_RE)?.[1] || null;
}

function getFoxSportsHrefPath(href: string | null | undefined): string {
  if (!href) return "";

  try {
    return new URL(href, window.location.origin).pathname;
  } catch {
    return href.split(/[?#]/)[0] || "";
  }
}

function getFoxSportsScheduleLink(
  postElement: Element
): HTMLAnchorElement | null {
  const link = getFoxSportsPrimaryLink(postElement);
  if (!link) return null;

  const href = link.getAttribute("href") || "";
  return FOXSPORTS_GAME_BOXSCORE_ID_RE.test(href) ? link : null;
}

function getFoxSportsScheduleEventId(postElement: Element): string | null {
  const href = getFoxSportsScheduleLink(postElement)?.getAttribute("href");
  return getFoxSportsScheduleEventIdFromHref(href);
}

function getFoxSportsNuxtScheduleEventId(
  event: FoxSportsRecord
): string | null {
  const entityLink = asFoxSportsRecord(event.entityLink);
  const layout = asFoxSportsRecord(entityLink?.layout);
  const tokens = asFoxSportsRecord(layout?.tokens);
  const tokenId = asFoxSportsString(tokens?.id);
  if (tokenId) return tokenId;

  const contentUri = asFoxSportsString(event.contentUri);
  const contentId = contentUri.match(/\/events\/(\d+)\b/i)?.[1];
  if (contentId) return contentId;

  const rawId = asFoxSportsString(event.id);
  return rawId.match(/\d+/)?.[0] || null;
}

function getFoxSportsNuxtScheduleTeam(
  team: unknown
): FoxSportsScheduleTeam | undefined {
  const record = asFoxSportsRecord(team);
  if (!record) return undefined;

  const longName = asFoxSportsString(record.longName);
  const name = asFoxSportsString(record.name);
  const score = asFoxSportsString(record.score);
  return {
    name: name || undefined,
    longName: longName || name || undefined,
    score: score || undefined,
  };
}

function getFoxSportsNuxtScheduleEvents(): FoxSportsScheduleEvent[] {
  const nuxt = asFoxSportsRecord(
    (window as typeof window & { __NUXT__?: unknown }).__NUXT__
  );
  const data = asFoxSportsRecord(nuxt?.data);
  const special = asFoxSportsRecord(data?.[FOXSPORTS_NUXT_SPECIAL_EVENT_KEY]);
  const components = Array.isArray(special?.mainComponents)
    ? special.mainComponents
    : [];

  for (const component of components) {
    const props = asFoxSportsRecord(asFoxSportsRecord(component)?.props);
    if (
      props?.componentName !== "schedule" &&
      props?.template !== "schedule-scorechips"
    ) {
      continue;
    }

    const scoresData = asFoxSportsRecord(props.scoresData);
    const segment = asFoxSportsRecord(scoresData?.segment);
    const events = Array.isArray(segment?.events) ? segment.events : [];
    return events
      .map((event): FoxSportsScheduleEvent | null => {
        const record = asFoxSportsRecord(event);
        if (!record) return null;

        const entityLink = asFoxSportsRecord(record.entityLink);
        const id = getFoxSportsNuxtScheduleEventId(record);
        return {
          id: id || undefined,
          eventTime: asFoxSportsString(record.eventTime) || undefined,
          statusLine: asFoxSportsString(record.statusLine) || undefined,
          league: asFoxSportsString(record.league) || undefined,
          gameNotes: asFoxSportsString(record.gameNotes) || undefined,
          eventHeadline: asFoxSportsString(record.eventHeadline) || undefined,
          oddsLine: asFoxSportsString(record.oddsLine) || undefined,
          overUnderLine: asFoxSportsString(record.overUnderLine) || undefined,
          webUrl: asFoxSportsString(entityLink?.webUrl) || undefined,
          upperTeam: getFoxSportsNuxtScheduleTeam(record.upperTeam),
          lowerTeam: getFoxSportsNuxtScheduleTeam(record.lowerTeam),
        };
      })
      .filter((event): event is FoxSportsScheduleEvent => event !== null);
  }

  return [];
}

function getFoxSportsScheduleEventFromNuxt(
  postElement: Element
): FoxSportsScheduleEvent | null {
  const link = getFoxSportsScheduleLink(postElement);
  if (!link) return null;

  const href = link.getAttribute("href") || "";
  const eventId = getFoxSportsScheduleEventIdFromHref(href);
  const hrefPath = getFoxSportsHrefPath(href);

  return (
    getFoxSportsNuxtScheduleEvents().find((event) => {
      if (eventId && event.id === eventId) return true;
      return !!event.webUrl && getFoxSportsHrefPath(event.webUrl) === hrefPath;
    }) || null
  );
}

function getFoxSportsScheduleTextCompetition(
  event?: FoxSportsScheduleEvent
): string {
  const league = event?.league || "";
  if (
    /world cup/i.test(league) ||
    /fifa-world-cup/i.test(window.location.pathname) ||
    /world cup/i.test(document.title)
  ) {
    return "FIFA World Cup";
  }

  return cleanFoxSportsTitle(document.title) || "FOX Sports";
}

function getFoxSportsScheduleLeagueSlug(
  event?: FoxSportsScheduleEvent
): string | undefined {
  const combined = normalizeText(
    `${event?.league || ""} ${event?.eventHeadline || ""} ${window.location.pathname} ${document.title}`
  ).toLowerCase();

  if (/\bfifa\b|\bworld cup\b|fifa-world-cup/.test(combined)) {
    return "fifa-world-cup";
  }

  if (/\bsoccer\b/.test(combined)) return "soccer";

  return undefined;
}

function getFoxSportsScheduleEventDateFromHref(
  postElement: Element
): string | undefined {
  const href = getFoxSportsScheduleLink(postElement)?.getAttribute("href");
  const match = href?.match(FOXSPORTS_DATE_SLUG_RE);
  if (!match) return undefined;

  const [, rawMonth, rawDay, year] = match;
  const month = FOXSPORTS_MONTH_INDEX[rawMonth.toLowerCase()];
  if (!month) return undefined;

  return `${year}-${month}-${rawDay.padStart(2, "0")}`;
}

function getFoxSportsScheduleMatchCandidate(
  postElement: Element
): SportsMatchCandidate | null {
  const event =
    getFoxSportsScheduleEventFromNuxt(postElement) ||
    getFoxSportsScheduleEventFromDom(postElement);
  if (!event) return null;

  const homeTeam = event.upperTeam?.longName || event.upperTeam?.name || "";
  const awayTeam = event.lowerTeam?.longName || event.lowerTeam?.name || "";
  if (!homeTeam || !awayTeam) return null;

  return {
    homeTeam,
    awayTeam,
    homeAbbreviation: event.upperTeam?.name,
    awayAbbreviation: event.lowerTeam?.name,
    eventTime:
      event.eventTime || getFoxSportsScheduleEventDateFromHref(postElement),
    league: getFoxSportsScheduleTextCompetition(event),
    leagueSlug: getFoxSportsScheduleLeagueSlug(event),
    title: `${homeTeam} vs. ${awayTeam}`,
  };
}

async function resolveFoxSportsDirectMarkets(
  postElement: Element
): Promise<DirectMarketResolution | null> {
  const match = getFoxSportsScheduleMatchCandidate(postElement);
  if (!match) return null;

  return resolveDirectSportsMarket(match);
}

function formatFoxSportsScheduleText(event: FoxSportsScheduleEvent): string {
  const upperName = event.upperTeam?.longName || event.upperTeam?.name || "";
  const lowerName = event.lowerTeam?.longName || event.lowerTeam?.name || "";
  if (!upperName || !lowerName) return "";

  const parts = [
    `${getFoxSportsScheduleTextCompetition(event)} match: ${upperName} vs ${lowerName}.`,
  ];

  if (event.statusLine) {
    parts.push(`Status: ${event.statusLine}.`);
  } else if (event.eventTime) {
    parts.push(`Scheduled: ${event.eventTime}.`);
  }

  if (event.upperTeam?.score && event.lowerTeam?.score) {
    parts.push(
      `Score: ${upperName} ${event.upperTeam.score}, ${lowerName} ${event.lowerTeam.score}.`
    );
  }

  if (event.gameNotes) parts.push(`Group: ${event.gameNotes}.`);
  if (event.oddsLine) parts.push(`Odds: ${event.oddsLine}.`);
  if (event.overUnderLine) parts.push(`Total: ${event.overUnderLine}.`);
  if (event.eventHeadline) parts.push(`Headline: ${event.eventHeadline}.`);

  return combineTextParts(parts, 20);
}

function getFoxSportsScheduleTeamFromRow(row: Element): FoxSportsScheduleTeam {
  const teamNameScope = row.querySelector(".score-team-name.team");
  const abbrScope = row.querySelector(".score-team-name.abbreviation");
  const scoreScope = row.querySelector(".score-team-score");
  const longName =
    teamNameScope?.querySelector(".scores-text")?.getAttribute("title") ||
    normalizeText(teamNameScope?.querySelector(".scores-text")?.textContent) ||
    normalizeText(teamNameScope?.textContent);
  const name =
    abbrScope?.querySelector(".scores-text")?.getAttribute("title") ||
    normalizeText(abbrScope?.querySelector(".scores-text")?.textContent) ||
    normalizeText(abbrScope?.textContent);
  const score =
    normalizeText(scoreScope?.querySelector(".scores-text")?.textContent) ||
    normalizeText(scoreScope?.textContent);

  return {
    name: name || undefined,
    longName: longName || name || undefined,
    score: score || undefined,
  };
}

function getFoxSportsScheduleEventFromDom(
  postElement: Element
): FoxSportsScheduleEvent | null {
  const link = getFoxSportsScheduleLink(postElement);
  if (!link) return null;

  const rows = Array.from(link.querySelectorAll(".score-team-row"));
  const [upperTeam, lowerTeam] = rows.map(getFoxSportsScheduleTeamFromRow);
  if (!upperTeam?.longName || !lowerTeam?.longName) return null;

  const rawText = normalizeText(link.textContent);
  return {
    id: getFoxSportsScheduleEventId(postElement) || undefined,
    statusLine:
      rawText.match(
        /\b(?:FINAL|LIVE|HALFTIME|FULL TIME|FT|POSTPONED|CANCELED)\b/i
      )?.[0] || undefined,
    gameNotes: rawText.match(/\bGROUP\s+[A-Z0-9]+\b/i)?.[0] || undefined,
    oddsLine:
      rawText.match(/\b(?:[A-Z]{2,4}|DRAW)\s+[+-]\d+\b/)?.[0] || undefined,
    overUnderLine:
      rawText.match(/\b(?:OVER|UNDER)\s+\d+(?:\.\d+)?\b/i)?.[0] || undefined,
    upperTeam,
    lowerTeam,
  };
}

function extractFoxSportsScheduleText(postElement: Element): string {
  const event =
    getFoxSportsScheduleEventFromNuxt(postElement) ||
    getFoxSportsScheduleEventFromDom(postElement);
  return event ? formatFoxSportsScheduleText(event) : "";
}

function isFoxSportsArticlePage(): boolean {
  return (
    FOXSPORTS_ARTICLE_PATH_RE.test(window.location.pathname) &&
    !!document.querySelector(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))
  );
}

function getFoxSportsArticleScope(postElement: Element): Element {
  return (
    postElement.closest(".story-content-main") ||
    postElement.closest(".story-content") ||
    postElement.closest(".fscom-main-content") ||
    postElement.closest("#article-content") ||
    postElement.parentElement ||
    postElement
  );
}

function getFoxSportsStoryScope(postElement: Element): Element {
  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return getFoxSportsArticleScope(postElement);
  }

  return (
    postElement.closest(".news-article") ||
    postElement.closest(".article-container") ||
    postElement.closest("a.card-story") ||
    postElement
  );
}

function getFoxSportsPrimaryLink(
  postElement: Element
): HTMLAnchorElement | null {
  if (postElement instanceof HTMLAnchorElement) {
    return postElement;
  }

  const scope = getFoxSportsStoryScope(postElement);
  return findPrimaryLinkFromSelectors(
    postElement,
    scope,
    FOXSPORTS_PRIMARY_LINK_SELECTORS
  );
}

function extractFoxSportsFeedText(postElement: Element): string {
  const scope = getFoxSportsStoryScope(postElement);
  const title =
    getFirstMatchingText(scope, FOXSPORTS_TITLE_SELECTORS) ||
    normalizeText(getFoxSportsPrimaryLink(postElement)?.textContent);
  const summary =
    getFirstMatchingText(scope, FOXSPORTS_DESCRIPTION_SELECTORS) || "";

  return combineTextParts([title, summary], 8);
}

function extractFoxSportsPostText(postElement: Element): string {
  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const scope = getFoxSportsArticleScope(postElement);
    const title = normalizeText(postElement.textContent);
    const summary =
      getFirstMatchingText(scope, FOXSPORTS_DESCRIPTION_SELECTORS) ||
      getDocumentDescription();
    return combineTextParts([title, summary], 8);
  }

  const scheduleText = extractFoxSportsScheduleText(postElement);
  if (scheduleText) {
    return scheduleText;
  }

  return extractFoxSportsFeedText(postElement);
}

function getFoxSportsPostId(postElement: Element): string | null {
  const scheduleEventId = getFoxSportsScheduleEventId(postElement);
  if (scheduleEventId) {
    return `foxsports-event-${scheduleEventId}`;
  }

  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const path = window.location.pathname;
    const match = path.match(GENERIC_LINK_PATTERN);
    return match?.[1] || path || null;
  }

  const href = getFoxSportsPrimaryLink(postElement)?.getAttribute("href") || "";
  const directMatch = href.match(GENERIC_LINK_PATTERN);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  try {
    const url = new URL(href, window.location.origin);
    const pathnameMatch = url.pathname.match(GENERIC_LINK_PATTERN);
    return pathnameMatch?.[1] || normalizeText(url.pathname) || null;
  } catch {
    return normalizeText(href) || null;
  }
}

function isFoxSportsInjectedWrapper(element: Element): boolean {
  return (
    element.getAttribute("data-knoww-injected") === "true" &&
    element.getAttribute("data-knoww-platform") === "fox-sports"
  );
}

function getFoxSportsSchedulePostKey(element: Element | null): string | null {
  if (!element?.matches(FOXSPORTS_SCHEDULE_ITEM_ROOT_SELECTORS.join(", "))) {
    return null;
  }

  const postId = getFoxSportsPostId(element);
  return postId ? `fox-sports:${postId}` : null;
}

function cleanupFoxSportsStaleInjections(): void {
  for (const container of Array.from(
    document.querySelectorAll(FOXSPORTS_SCHEDULE_CONTAINER_SELECTOR)
  )) {
    for (const child of Array.from(container.children)) {
      if (!isFoxSportsInjectedWrapper(child)) continue;

      const expectedPostKey = getFoxSportsSchedulePostKey(
        child.previousElementSibling
      );
      const actualPostKey = child.getAttribute("data-knoww-post-key");
      if (!expectedPostKey || actualPostKey !== expectedPostKey) {
        child.remove();
      }
    }
  }
}

function getFoxSportsDynamicSelectors(): {
  itemSelector: string;
  containerSelector: string;
} {
  const containerSelector =
    FOXSPORTS_CONTAINER_SELECTORS.find((selector) =>
      document.querySelector(selector)
    ) || "body";

  if (isFoxSportsArticlePage()) {
    return {
      itemSelector: FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "),
      containerSelector,
    };
  }

  const scopedSelectors = FOXSPORTS_FEED_ITEM_ROOT_SELECTORS.map(
    (selector) => `${containerSelector} ${selector}`
  );
  const matchedSelectors = scopedSelectors.filter((selector) =>
    document.querySelector(selector)
  );

  return {
    itemSelector:
      matchedSelectors.length > 0
        ? matchedSelectors.join(", ")
        : scopedSelectors.join(", "),
    containerSelector,
  };
}

function findFoxSportsArticleInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const articleScope = getFoxSportsArticleScope(postElement);
  const byline =
    articleScope.querySelector(".story-by-line") ||
    articleScope.querySelector(".article-contributors");
  if (byline?.parentElement) {
    return {
      container: byline.parentElement,
      referenceElement: byline,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  const headerContainer = articleScope.querySelector(".story-header-container");
  if (headerContainer?.parentElement) {
    return {
      container: headerContainer.parentElement,
      referenceElement: headerContainer,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  if (postElement.parentElement) {
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: articleScope,
    };
  }

  return null;
}

function findFoxSportsFeedInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  const scope = getFoxSportsStoryScope(postElement);
  if (!scope.parentElement) {
    return null;
  }

  return {
    container: scope.parentElement,
    referenceElement: scope,
    insertPosition: "after",
    postWrapper: scope,
  };
}

function findFoxSportsInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    return findFoxSportsArticleInjectionPoint(postElement);
  }

  return findFoxSportsFeedInjectionPoint(postElement);
}

function hasFoxSportsInjectedCard(postElement: Element): boolean {
  if (postElement.matches(FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS.join(", "))) {
    const articleScope = getFoxSportsArticleScope(postElement);
    const anchor =
      articleScope.querySelector(".story-by-line") ||
      articleScope.querySelector(".article-contributors") ||
      articleScope.querySelector(".story-header-container");
    return (
      (anchor
        ? hasInjectedCardSibling(anchor)
        : hasInjectedCardSibling(postElement)) ||
      !!articleScope.querySelector(".knoww-market-card")
    );
  }

  const scope = getFoxSportsStoryScope(postElement);
  return (
    hasInjectedCardSibling(scope) || !!scope.querySelector(".knoww-market-card")
  );
}

function getFoxSportsWrapperStyles(): string {
  return getFullWidthCardWrapperStyles();
}

const FoxSportsFeedAdapter = createBasicAdapter({
  name: "fox-sports",
  hostPatterns: [FOXSPORTS_HOST_RE],
  itemSelectors: [
    ...FOXSPORTS_FEED_ITEM_ROOT_SELECTORS,
    ...FOXSPORTS_ARTICLE_ITEM_ROOT_SELECTORS,
  ],
  containerSelectors: [...FOXSPORTS_CONTAINER_SELECTORS],
  textSelectors: [...FOXSPORTS_TITLE_SELECTORS],
  accentColor: "#003478",
  fontFamily:
    '"Benton Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractFoxSportsPostText,
  getPostId: getFoxSportsPostId,
  findInjectionPoint: findFoxSportsInjectionPoint,
  getDynamicSelectors: getFoxSportsDynamicSelectors,
  getWrapperStyles: getFoxSportsWrapperStyles,
  hasInjectedCard: hasFoxSportsInjectedCard,
});

const FoxSportsAdapter: PlatformAdapter = {
  ...FoxSportsFeedAdapter,
  enableNestedMarketContext: true,
  get surface() {
    return isFoxSportsStreamPath() ? "stream" : "feed";
  },
  get maxActiveNotificationItems() {
    return isFoxSportsStreamPath() ? 24 : undefined;
  },
  get maxNotificationItems() {
    return isFoxSportsStreamPath() ? 24 : undefined;
  },
  getStreamContext: getFoxSportsStreamContext,
  resolveDirectMarkets: resolveFoxSportsDirectMarkets,
  cleanupStaleInjections: cleanupFoxSportsStaleInjections,
};

registerAdapterWithRetry(FoxSportsAdapter, 100, 50);

export { FoxSportsAdapter };
