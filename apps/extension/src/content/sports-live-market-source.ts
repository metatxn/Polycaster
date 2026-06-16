import {
  type GammaArrayField,
  parseGammaNumberArray,
  parseGammaStringArray,
} from "@knoww/shared-types/polymarket";
import type {
  Market,
  MarketSearchResult,
  NestedMarket,
  Tag,
} from "../types/market";
import type {
  DirectMarketResolution,
  SportsMatchCandidate,
} from "../types/platform";

interface GammaSportsTeam {
  name?: string;
  abbreviation?: string;
  alias?: string;
  league?: string;
}

interface GammaSportsMarket {
  id?: string | number;
  question?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  orderMinSize?: string | number;
  groupItemTitle?: string;
  outcomes?: GammaArrayField;
  outcomePrices?: GammaArrayField;
  clobTokenIds?: GammaArrayField;
  conditionId?: string;
  volume?: string | number;
  volume24hr?: string | number;
  image?: string;
  icon?: string;
  gameStartTime?: string;
  sportsMarketType?: string;
}

export interface GammaSportsEvent {
  id?: string | number;
  slug?: string;
  title?: string;
  description?: string;
  image?: string;
  icon?: string;
  active?: boolean;
  closed?: boolean;
  ended?: boolean;
  live?: boolean;
  startTime?: string;
  startDate?: string;
  endDate?: string;
  volume?: string | number;
  volume24hr?: string | number;
  liquidity?: string | number;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  tags?: Array<Tag | string>;
  teams?: GammaSportsTeam[];
  markets?: GammaSportsMarket[];
}

type GammaSportsEventsPayload =
  | GammaSportsEvent[]
  | {
      data?: GammaSportsEvent[];
      events?: GammaSportsEvent[];
      markets?: GammaSportsEvent[];
    };

type TeamMatchSignal = {
  matched: boolean;
  metadata: boolean;
  text: boolean;
};

const SPORTS_EVENTS_CACHE_TTL_MS = 30_000;
const SPORTS_EVENTS_FETCH_LIMIT = 100;
const DIRECT_SPORTS_SCORE = 0.99;

const sportsEventsCache = new Map<
  string,
  { events: GammaSportsEvent[]; expiresAt: number }
>();
const sportsEventsInFlight = new Map<string, Promise<GammaSportsEvent[]>>();

function logSportsMarketSource(...args: unknown[]): void {
  window.KNOWW_UTILS?.log?.("[sports-live-market-source]", ...args);
}

function toNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function normalizeSportsText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTeamAlias(text: string, alias: string): boolean {
  const normalizedAlias = normalizeSportsText(alias);
  if (!text || !normalizedAlias) return false;

  return normalizedAlias.length <= 3
    ? new RegExp(`\\b${escapeRegExp(normalizedAlias)}\\b`).test(text)
    : text.includes(normalizedAlias);
}

function aliasVariants(value: string | undefined): string[] {
  const normalized = normalizeSportsText(value);
  if (!normalized) return [];

  const variants = new Set([normalized]);
  if (normalized === "cabo verde") variants.add("cape verde");
  if (normalized === "cape verde") variants.add("cabo verde");
  if (normalized === "ivory coast") variants.add("cote d ivoire");
  if (normalized === "cote d ivoire") variants.add("ivory coast");
  if (normalized === "united states") {
    variants.add("usa");
    variants.add("us");
  }
  if (normalized === "usa" || normalized === "us") {
    variants.add("united states");
  }
  if (normalized === "south korea") {
    variants.add("korea republic");
    variants.add("republic of korea");
  }
  if (normalized === "korea republic") variants.add("south korea");

  return Array.from(variants);
}

function teamCandidateAliases(
  teamName: string | undefined,
  abbreviation?: string
): string[] {
  return Array.from(
    new Set([...aliasVariants(teamName), ...aliasVariants(abbreviation)])
  );
}

function eventTeamAliases(team: GammaSportsTeam | undefined): string[] {
  if (!team) return [];
  return Array.from(
    new Set([
      ...aliasVariants(team.name),
      ...aliasVariants(team.abbreviation),
      ...aliasVariants(team.alias),
    ])
  );
}

function aliasesMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;

  if (left.length > 3 && containsTeamAlias(right, left)) return true;
  if (right.length > 3 && containsTeamAlias(left, right)) return true;

  return false;
}

function getMatchingEventTeamIndex(
  eventTeams: GammaSportsTeam[] | undefined,
  aliases: string[]
): number | null {
  if (!eventTeams?.length || aliases.length === 0) return null;

  for (let index = 0; index < eventTeams.length; index++) {
    const eventAliases = eventTeamAliases(eventTeams[index]);
    if (
      eventAliases.some((eventAlias) =>
        aliases.some((candidateAlias) =>
          aliasesMatch(eventAlias, candidateAlias)
        )
      )
    ) {
      return index;
    }
  }

  return null;
}

function getEventSearchText(event: GammaSportsEvent): string {
  const teamText = (event.teams ?? [])
    .flatMap((team) => [team.name, team.abbreviation, team.alias, team.league])
    .filter(Boolean)
    .join(" ");
  const tagText = (event.tags ?? [])
    .map((tag) =>
      typeof tag === "string" ? tag : `${tag.slug ?? ""} ${tag.label ?? ""}`
    )
    .join(" ");

  return normalizeSportsText(
    `${event.title ?? ""} ${event.slug ?? ""} ${teamText} ${tagText}`
  );
}

function getTeamMatchSignal(
  event: GammaSportsEvent,
  teamName: string,
  abbreviation?: string
): TeamMatchSignal {
  const aliases = teamCandidateAliases(teamName, abbreviation);
  const metadataIndex = getMatchingEventTeamIndex(event.teams, aliases);
  const eventText = getEventSearchText(event);
  const text = aliases.some((alias) => containsTeamAlias(eventText, alias));

  return {
    matched: metadataIndex !== null || text,
    metadata: metadataIndex !== null,
    text,
  };
}

function teamsMatchEventMetadata(
  event: GammaSportsEvent,
  match: SportsMatchCandidate
): boolean {
  const homeAliases = teamCandidateAliases(
    match.homeTeam,
    match.homeAbbreviation
  );
  const awayAliases = teamCandidateAliases(
    match.awayTeam,
    match.awayAbbreviation
  );
  const homeIndex = getMatchingEventTeamIndex(event.teams, homeAliases);
  const awayIndex = getMatchingEventTeamIndex(event.teams, awayAliases);

  return homeIndex !== null && awayIndex !== null && homeIndex !== awayIndex;
}

function extractDateOnly(input?: string): string | null {
  if (!input) return null;
  return input.split(/[T ]/)[0] || null;
}

function areDatesClose(date1: string, date2: string): boolean {
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  if (Number.isNaN(d1) || Number.isNaN(d2)) return false;
  return Math.abs(d1 - d2) <= 86_400_000;
}

function getSportsEventDate(event: GammaSportsEvent): string | null {
  const eventTime = extractDateOnly(event.startTime);
  if (eventTime) return eventTime;

  for (const market of event.markets ?? []) {
    const marketTime = extractDateOnly(market.gameStartTime);
    if (marketTime) return marketTime;
  }

  return extractDateOnly(event.startDate);
}

function sportsEventMatchesLeague(
  event: GammaSportsEvent,
  match: SportsMatchCandidate
): boolean {
  const leagueAliases = [
    match.leagueSlug,
    match.league,
    match.leagueSlug === "fifa-world-cup" ? "fifwc" : undefined,
  ]
    .flatMap(aliasVariants)
    .filter(Boolean);

  if (leagueAliases.length === 0) return false;

  const eventText = getEventSearchText(event);
  return leagueAliases.some((alias) => containsTeamAlias(eventText, alias));
}

export function findSportsEventForMatch(
  events: GammaSportsEvent[],
  match: SportsMatchCandidate
): GammaSportsEvent | null {
  const matchDate = extractDateOnly(match.eventTime);
  let bestEvent: GammaSportsEvent | null = null;
  let bestScore = -1;

  for (const event of events) {
    if (
      event.closed === true ||
      event.active === false ||
      event.ended === true
    ) {
      continue;
    }

    const homeSignal = getTeamMatchSignal(
      event,
      match.homeTeam,
      match.homeAbbreviation
    );
    const awaySignal = getTeamMatchSignal(
      event,
      match.awayTeam,
      match.awayAbbreviation
    );
    if (!homeSignal.matched || !awaySignal.matched) continue;

    const eventDate = getSportsEventDate(event);
    const dateMatch = Boolean(
      matchDate && eventDate && areDatesClose(matchDate, eventDate)
    );
    if (matchDate && eventDate && !dateMatch) continue;

    const metadataMatch = teamsMatchEventMetadata(event, match);
    const textMatch = homeSignal.text && awaySignal.text;
    const leagueMatch = sportsEventMatchesLeague(event, match);

    let score = 0;
    if (dateMatch) score += 10;
    if (metadataMatch) score += 6;
    if (textMatch) score += 3;
    if (leagueMatch) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestEvent = event;
    }
  }

  return bestEvent;
}

function hasUsablePrice(market: GammaSportsMarket): boolean {
  const prices = parseGammaNumberArray(market.outcomePrices);
  if (prices.length === 0) return false;

  return prices.some((price) => price > 0.001 && price < 0.999);
}

function isUsableSportsMarket(market: GammaSportsMarket): boolean {
  if (
    market.active === false ||
    market.closed === true ||
    market.archived === true ||
    market.acceptingOrders === false
  ) {
    return false;
  }

  const outcomes = parseGammaStringArray(market.outcomes);
  const tokenIds = parseGammaStringArray(market.clobTokenIds);
  if (outcomes.length === 0 || tokenIds.length === 0) return false;

  return hasUsablePrice(market);
}

function isMoneylineMarket(market: GammaSportsMarket): boolean {
  const text = normalizeSportsText(
    `${market.sportsMarketType ?? ""} ${market.groupItemTitle ?? ""} ${market.question ?? ""}`
  );

  return (
    text.includes("moneyline") ||
    /\bwin\b/.test(text) ||
    text.includes("end in a draw")
  );
}

function selectSportsMarkets(event: GammaSportsEvent): GammaSportsMarket[] {
  const usableMarkets = (event.markets ?? []).filter(isUsableSportsMarket);
  const moneylineMarkets = usableMarkets.filter(isMoneylineMarket);
  return moneylineMarkets.length > 0 ? moneylineMarkets : usableMarkets;
}

function normalizeJsonArrayString(value: GammaArrayField): string {
  return JSON.stringify(parseGammaStringArray(value));
}

function normalizeTags(tags: GammaSportsEvent["tags"]): Tag[] | undefined {
  const normalized = (tags ?? [])
    .map((tag): Tag | null => {
      if (typeof tag === "string") {
        return { slug: tag, label: tag };
      }
      if (tag.slug || tag.label) {
        return { slug: tag.slug, label: tag.label };
      }
      return null;
    })
    .filter((tag): tag is Tag => tag !== null);

  return normalized.length > 0 ? normalized : undefined;
}

function mapSportsMarket(market: GammaSportsMarket): NestedMarket {
  return {
    id: market.id !== undefined ? String(market.id) : undefined,
    question: market.question,
    outcomePrices: normalizeJsonArrayString(market.outcomePrices),
    volume: market.volume,
    volume24hr: toNumber(market.volume24hr),
    clobTokenIds: normalizeJsonArrayString(market.clobTokenIds),
    conditionId: market.conditionId,
    slug: market.slug,
    active: market.active,
    closed: market.closed,
    archived: market.archived,
    groupItemTitle: market.groupItemTitle,
    outcomes: parseGammaStringArray(market.outcomes),
    gameStartTime: market.gameStartTime,
    sportsMarketType: market.sportsMarketType,
    acceptingOrders: market.acceptingOrders,
    enableOrderBook: market.enableOrderBook,
    orderMinSize: market.orderMinSize,
    image_url_light_mode: market.image,
    image_url_dark_mode: market.icon || market.image,
  };
}

function buildMatchTitle(match: SportsMatchCandidate): string {
  return match.title || `${match.homeTeam} vs. ${match.awayTeam}`;
}

function getPreferredOutcomeNamesForMatch(
  match: SportsMatchCandidate
): string[] {
  return [match.homeTeam, match.awayTeam].filter(Boolean);
}

export function buildSportsMarketSearchResult(
  event: GammaSportsEvent,
  match: SportsMatchCandidate
): MarketSearchResult | null {
  const selectedMarkets = selectSportsMarkets(event);
  if (selectedMarkets.length === 0) return null;

  const eventId = event.id !== undefined ? String(event.id) : event.slug;
  if (!eventId) return null;

  const market: Market = {
    id: eventId,
    title: event.title || buildMatchTitle(match),
    source: "polymarket",
    slug: event.slug,
    image: event.image || event.icon,
    volume: toNumber(event.volume),
    volume24hr: toNumber(event.volume24hr),
    liquidity: toNumber(event.liquidity),
    description: event.description,
    startDate: event.startTime || event.startDate,
    endDate: event.endDate,
    tags: normalizeTags(event.tags),
    closed: event.closed,
    active: event.active,
    markets: selectedMarkets.map(mapSportsMarket),
    negRisk: event.negRisk,
    enableNegRisk: event.enableNegRisk,
    negRiskAugmented: event.negRiskAugmented,
    _source: "tag",
    _preferredOutcomeNames: getPreferredOutcomeNamesForMatch(match),
  };

  return {
    market,
    score: DIRECT_SPORTS_SCORE,
    source: "polymarket",
  };
}

function parseGammaSportsEventsPayload(payload: unknown): GammaSportsEvent[] {
  if (Array.isArray(payload)) return payload as GammaSportsEvent[];
  if (!payload || typeof payload !== "object") return [];

  const wrapper = payload as GammaSportsEventsPayload;
  if (!Array.isArray(wrapper)) {
    if (Array.isArray(wrapper.events)) return wrapper.events;
    if (Array.isArray(wrapper.data)) return wrapper.data;
    if (Array.isArray(wrapper.markets)) return wrapper.markets;
  }

  return [];
}

function buildSportsEventsUrl(
  endpoint: string,
  params: URLSearchParams
): string {
  const url = new URL(endpoint);
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchGammaSportsEventsUrl(
  url: string
): Promise<GammaSportsEvent[]> {
  const cached = sportsEventsCache.get(url);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.events;
  }

  const inFlight = sportsEventsInFlight.get(url);
  if (inFlight) return inFlight;

  const request = (async () => {
    const response = await window.KNOWW_UTILS.safeSendMessage({
      type: "fetch-text",
      url,
    });
    if (!response?.ok || !("text" in response) || !response.text) {
      return [];
    }

    const events = parseGammaSportsEventsPayload(JSON.parse(response.text));
    if (events.length > 0) {
      sportsEventsCache.set(url, {
        events,
        expiresAt: Date.now() + SPORTS_EVENTS_CACHE_TTL_MS,
      });
    }
    return events;
  })().finally(() => {
    sportsEventsInFlight.delete(url);
  });

  sportsEventsInFlight.set(url, request);
  return request;
}

async function fetchDirectSportsEventCandidates(
  match: SportsMatchCandidate
): Promise<GammaSportsEvent[]> {
  const { POLYMARKET_EVENTS_KEYSET_API_URL } = window.KNOWW_CONFIG;
  const baseParams = new URLSearchParams({
    closed: "false",
    limit: String(SPORTS_EVENTS_FETCH_LIMIT),
    order: "volume24hr",
    ascending: "false",
    markets: "full",
  });
  const requests: string[] = [];

  const liveSportsParams = new URLSearchParams(baseParams);
  liveSportsParams.set("tag_slug", "sports");
  liveSportsParams.set("live", "true");
  requests.push(
    buildSportsEventsUrl(POLYMARKET_EVENTS_KEYSET_API_URL, liveSportsParams)
  );

  if (match.leagueSlug) {
    const leagueParams = new URLSearchParams(baseParams);
    leagueParams.set("tag_slug", match.leagueSlug);
    requests.push(
      buildSportsEventsUrl(POLYMARKET_EVENTS_KEYSET_API_URL, leagueParams)
    );
  }

  const eventMap = new Map<string, GammaSportsEvent>();
  const pages = await Promise.all(
    requests.map((url) => fetchGammaSportsEventsUrl(url))
  );

  for (const event of pages.flat()) {
    const key =
      event.id !== undefined ? String(event.id) : event.slug || event.title;
    if (!key || eventMap.has(key)) continue;
    eventMap.set(key, event);
  }

  return Array.from(eventMap.values());
}

function buildDirectSportsPostText(match: SportsMatchCandidate): string {
  const parts = [
    match.league || match.leagueSlug || "Sports",
    "match:",
    `${match.homeTeam} vs ${match.awayTeam}.`,
  ];
  if (match.eventTime) parts.push(`Scheduled: ${match.eventTime}.`);
  return parts.join(" ");
}

export async function resolveDirectSportsMarket(
  match: SportsMatchCandidate
): Promise<DirectMarketResolution> {
  const postText = buildDirectSportsPostText(match);
  const topics = ["sports", match.leagueSlug].filter((topic): topic is string =>
    Boolean(topic)
  );

  if (
    window.KNOWW_CONFIG.ENABLED_SOURCES &&
    !window.KNOWW_CONFIG.ENABLED_SOURCES.polymarket
  ) {
    return { markets: [], topics, bypassGenericSearch: true, postText };
  }

  if (!window.KNOWW_UTILS.isExtensionContextValid()) {
    return { markets: [], topics, bypassGenericSearch: true, postText };
  }

  try {
    const events = await fetchDirectSportsEventCandidates(match);
    const event = findSportsEventForMatch(events, match);
    const result = event ? buildSportsMarketSearchResult(event, match) : null;

    return {
      markets: result ? [result] : [],
      topics,
      bypassGenericSearch: true,
      postText,
    };
  } catch (error) {
    logSportsMarketSource("failed to resolve direct sports market", error);
    return { markets: [], topics, bypassGenericSearch: true, postText };
  }
}
