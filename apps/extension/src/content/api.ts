// ============================================
// API & DATA FUNCTIONS
// ============================================

import { createLogger } from "@knoww/logger";
import { parseGammaStringArray } from "@knoww/shared-types/polymarket";
import type {
  KeywordExtractionResult,
  KeywordRegexEntry,
  Market,
  PolymarketTag,
  PolymarketTagsCache,
} from "../types/market";
import type { MarketLinkHint } from "../types/platform";
import { KNOWW_CONFIG } from "./config";
import { isMarketWithinDisplayPriceCap } from "./market-price-filter";
import { findMatchingLiveMarket } from "./market-token-resolution";
import {
  buildMarketGateText,
  CASE_INSENSITIVE_HIGH_SIGNAL_TOKENS,
  HIGH_SIGNAL_TOKENS,
} from "./scoring-policy";

const log = createLogger("extension.api");

// Cache for Polymarket tags
let polymarketTagsCache: PolymarketTagsCache | null = null;
let tagsLastFetched = 0;
let polymarketTagsInFlight: Promise<PolymarketTagsCache | null> | null = null;

// Cache for AI extraction results (both success and short-lived failures)
interface AIExtractionCacheEntry {
  result: AIExtractionResult | null;
  cachedAt: number;
}
const aiExtractionCache = new Map<string, AIExtractionCacheEntry>();
const AI_CACHE_MAX_ENTRIES = 120;
const AI_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const AI_CACHE_FAILURE_TTL_MS = 60 * 1000; // 1 minute
const AI_REQUEST_TIMEOUT_MS = 8500; // Must exceed backend AI timeout (7s) + network overhead
const POLYMARKET_SEARCH_CACHE_TTL_MS = 60 * 1000;
const POLYMARKET_SEARCH_EMPTY_CACHE_TTL_MS = 30 * 1000;
const POLYMARKET_SEARCH_FAILURE_CACHE_TTL_MS = 30 * 1000;
const POLYMARKET_SEARCH_MIN_INTERVAL_MS = 900;
const POLYMARKET_SEARCH_CACHE_MAX_ENTRIES = 120;
const POLYMARKET_EVENT_REFRESH_MIN_INTERVAL_MS = 8000;
const POLYMARKET_DIRECT_LINK_CACHE_TTL_MS = 5 * 60 * 1000;
const POLYMARKET_DIRECT_LINK_MAX_HINTS = 4;

interface PolymarketSearchCacheEntry {
  markets: Market[];
  cachedAt: number;
  expiresAt: number;
  degraded: boolean;
}

const polymarketSearchCache = new Map<string, PolymarketSearchCacheEntry>();
const polymarketSearchInFlight = new Map<string, Promise<Market[]>>();
let polymarketSearchQueue: Promise<void> = Promise.resolve();
let lastPolymarketSearchStartedAt = 0;
const polymarketEventRefreshInFlight = new Map<
  string,
  Promise<Market | null>
>();
const polymarketEventLastRefreshStartedAt = new Map<string, number>();
const polymarketDirectUrlCache = new Map<
  string,
  { value: string | null; expiresAt: number }
>();

// Memory optimization: Track cache size for cleanup decisions
const CACHE_CLEANUP_THRESHOLD = 30 * 60 * 1000; // 30 minutes of inactivity

/**
 * Result of building tag keyword maps
 */
interface TagKeywordMapsResult {
  keywordMap: Map<string, string>;
  keywordRegexMap: Map<string, KeywordRegexEntry>;
}

/**
 * Check if a keyword is simple enough for token-based matching
 * Simple keywords are alphanumeric only (no spaces/punctuation)
 */
function isSimpleKeyword(keyword: string): boolean {
  return /^[a-z0-9]+$/.test(keyword);
}

// ============================================
// HOISTED CONSTANTS (module-scope for performance)
// Avoids re-creating Sets on every function call
// ============================================

/** Words too generic to use as tag identifiers */
const BLOCKED_TAG_WORDS = new Set([
  "day",
  "week",
  "month",
  "year",
  "time",
  "today",
  "new",
  "top",
  "best",
  "first",
  "last",
  "next",
  "other",
  "more",
  "most",
  "all",
  "any",
  "some",
  "one",
  "two",
  "three",
  "yes",
  "no",
  "up",
  "down",
  "out",
  "in",
  "on",
  "off",
  "over",
  "under",
  "back",
  "end",
  "start",
  "big",
  "small",
  "high",
  "low",
  "good",
  "bad",
  "real",
  "fake",
  "true",
  "false",
  "old",
  "young",
  "free",
  "open",
  "close",
  "full",
  "half",
  "part",
  "side",
  "way",
  "man",
  "woman",
  "people",
  "person",
  "thing",
  "place",
  "point",
  "fact",
  "case",
  "issue",
  "home",
  "work",
  "life",
  "number",
  "group",
  "market",
  "markets",
]);

/** Common English stop words for keyword extraction */
const COMMON_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "might",
  "must",
  "i",
  "me",
  "my",
  "you",
  "your",
  "he",
  "him",
  "she",
  "her",
  "it",
  "its",
  "we",
  "us",
  "they",
  "them",
  "this",
  "that",
  "these",
  "those",
  "just",
  "like",
  "really",
  "very",
  "much",
  "more",
  "most",
  "also",
  "even",
  "still",
  "here",
  "there",
  "where",
  "when",
  "then",
  "than",
  "about",
  "over",
  "some",
  "only",
  "every",
  "never",
  "always",
  "after",
  "before",
  "first",
  "last",
  "breaking",
  "update",
  "updates",
  "thread",
  "viral",
  "trending",
  "alert",
  "watch",
  "check",
  "read",
  "share",
  "right",
  "wrong",
  "thing",
  "things",
  "people",
  "world",
  "today",
  "major",
  "going",
  "think",
  "using",
  "weeks",
  "months",
  "years",
  "global",
  "track",
  "prompt",
  "announce",
  "announced",
  "announces",
  "report",
  "reports",
  "reported",
  "says",
  "said",
  "sources",
  "according",
  "official",
  "new",
  "now",
  "because",
  "poor",
  "two",
  "three",
  "four",
  "five",
  "point",
  "points",
  "look",
  "looks",
  "great",
  "good",
  "bad",
  "best",
  "worst",
  "need",
  "needs",
  "want",
  "wants",
  "get",
  "got",
  "getting",
  "take",
  "took",
  "make",
  "made",
  "long",
  "come",
  "came",
  "back",
  "keep",
  "same",
  "way",
  "well",
  "real",
  "big",
  "many",
  "part",
  "whole",
  "actually",
  "opinion",
  "prediction",
  "odds",
  "chance",
  "likely",
  "bet",
  "betting",
  "question",
  "post",
  "live",
  "court",
  "former",
  "house",
  "speaker",
  "calls",
  "calling",
  "campaign",
  "currently",
  "accepting",
  "donations",
  "donation",
  "fundraiser",
  "page",
  "reportedly",
  "received",
  "pledged",
  "fraction",
  "tiny",
  "billion",
  "million",
  "launch",
  "launching",
  "celebration",
  "anniversary",
  "entered",
  "travels",
  "through",
  "atmosphere",
  "journey",
  "ending",
  "perfect",
]);

/** Entity name pattern (capitalized multi-word names) */
const ENTITY_NAME_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;

/** Words to exclude from entity extraction */
const ENTITY_EXCLUDE_WORDS = new Set([
  "Will",
  "The",
  "What",
  "How",
  "Which",
  "When",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

/**
 * Build a keyword-to-tag mapping for common variations
 * Also builds precompiled regex map for efficient tag extraction
 */
function buildTagKeywordMap(tags: PolymarketTag[]): TagKeywordMapsResult {
  const keywordMap = new Map<string, string>();
  const complexKeywords = new Map<string, string>();

  const addKeyword = (keyword: string, tagSlug: string): void => {
    const normalized = keyword.toLowerCase();
    if (!normalized || BLOCKED_TAG_WORDS.has(normalized)) return;

    if (isSimpleKeyword(normalized)) {
      keywordMap.set(normalized, tagSlug);
    } else {
      complexKeywords.set(normalized, tagSlug);
    }
  };

  for (const tag of tags) {
    if (tag.slug) {
      const slugLower = tag.slug.toLowerCase();
      if (!BLOCKED_TAG_WORDS.has(slugLower) && slugLower.length >= 2) {
        addKeyword(slugLower, tag.slug);
        const words = tag.slug.split("-");
        if (words.length > 1) {
          addKeyword(words.join(""), tag.slug);
          addKeyword(words.join(" "), tag.slug);
        }
      }
    }
    if (tag.label) {
      const labelLower = tag.label.toLowerCase();
      if (!BLOCKED_TAG_WORDS.has(labelLower) && labelLower.length > 2) {
        addKeyword(labelLower, tag.slug || tag.label);
      }
    }
  }

  // Custom keyword mappings - expanded for better coverage
  const customMappings: Record<string, string> = {
    // Politics - US
    trump: "trump",
    "donald trump": "trump",
    donaldtrump: "trump",
    biden: "biden",
    "joe biden": "biden",
    election: "elections",
    vote: "elections",
    voting: "elections",
    ballot: "elections",
    democrat: "democrats",
    democratic: "democrats",
    dems: "democrats",
    republican: "republicans",
    gop: "republicans",
    rnc: "republicans",
    congress: "congress",
    senate: "senate",
    "supreme court": "scotus",
    desantis: "desantis",
    "ron desantis": "desantis",
    kamala: "kamala-harris",
    "kamala harris": "kamala-harris",
    rfk: "rfk",
    "robert kennedy": "rfk",

    // Crypto
    bitcoin: "bitcoin",
    btc: "bitcoin",
    "₿": "bitcoin",
    ethereum: "ethereum",
    eth: "ethereum",
    crypto: "crypto",
    cryptocurrency: "crypto",
    defi: "crypto",
    solana: "solana",
    sol: "solana",
    xrp: "xrp",
    ripple: "xrp",
    dogecoin: "dogecoin",
    doge: "dogecoin",

    // Sports
    nfl: "nfl",
    "super bowl": "nfl",
    superbowl: "nfl",
    football: "nfl",
    nba: "nba",
    basketball: "nba",
    mlb: "mlb",
    baseball: "mlb",
    "world series": "mlb",
    nhl: "nhl",
    hockey: "nhl",
    "stanley cup": "nhl",
    ufc: "ufc",
    mma: "ufc",
    f1: "f1",
    "formula 1": "f1",
    "formula one": "f1",

    // Tech companies & people
    apple: "apple",
    iphone: "apple",
    ipad: "apple",
    google: "google",
    alphabet: "google",
    android: "google",
    tesla: "tesla",
    tsla: "tesla",
    nvidia: "nvidia",
    nvda: "nvidia",
    microsoft: "microsoft",
    msft: "microsoft",
    amazon: "amazon",
    amzn: "amazon",
    aws: "amazon",
    meta: "meta",
    facebook: "meta",
    instagram: "meta",
    zuckerberg: "meta",
    "elon musk": "elon-musk",
    musk: "elon-musk",
    elonmusk: "elon-musk",
    "sam altman": "openai",
    altman: "openai",
    "jeff bezos": "amazon",
    bezos: "amazon",
    "tim cook": "apple",

    // AI
    ai: "ai",
    "artificial intelligence": "ai",
    openai: "ai",
    chatgpt: "ai",
    gpt: "ai",
    "gpt-4": "ai",
    "gpt-5": "ai",
    claude: "ai",
    anthropic: "ai",
    gemini: "ai",
    bard: "ai",
    llm: "ai",
    "large language model": "ai",

    // Geopolitics
    ukraine: "ukraine",
    kyiv: "ukraine",
    zelensky: "ukraine",
    russia: "russia",
    putin: "russia",
    moscow: "russia",
    china: "china",
    beijing: "china",
    xi: "china",
    "xi jinping": "china",
    israel: "israel",
    gaza: "gaza",
    palestine: "palestine",
    hamas: "israel",
    iran: "iran",
    tehran: "iran",
    taiwan: "taiwan",

    // Space
    spacex: "space",
    nasa: "space",
    mars: "space",
    starship: "space",
    falcon: "space",
    rocket: "space",

    // Economy & Markets
    fed: "fed",
    "federal reserve": "fed",
    "interest rate": "fed",
    "rate cut": "fed",
    inflation: "economy",
    recession: "economy",
    gdp: "economy",
    "stock market": "stocks",
    "s&p": "stocks",
    nasdaq: "stocks",
    "dow jones": "stocks",

    // Entertainment
    oscars: "oscars",
    "academy awards": "oscars",
    grammys: "grammys",
    emmys: "emmys",
    "taylor swift": "taylor-swift",
    taylorswift: "taylor-swift",
  };

  for (const [keyword, tagSlug] of Object.entries(customMappings)) {
    addKeyword(keyword.toLowerCase(), tagSlug);
  }

  // Build precompiled regex map for complex keywords only
  const keywordRegexMap = new Map<string, KeywordRegexEntry>();
  for (const [keyword, tagSlug] of complexKeywords) {
    try {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escapedKeyword}\\b`, "i");
      keywordRegexMap.set(keyword, { regex, tagSlug });
    } catch {
      // Invalid regex pattern, skip this keyword
    }
  }

  return { keywordMap, keywordRegexMap };
}

/**
 * Fetch and cache Polymarket tags
 */
async function fetchPolymarketTags(): Promise<PolymarketTagsCache | null> {
  const { log, isExtensionContextValid, safeSendMessage } = window.KNOWW_UTILS;
  const { POLYMARKET_TAGS_API_URL, TAGS_CACHE_DURATION } = window.KNOWW_CONFIG;
  const now = Date.now();

  if (polymarketTagsCache && now - tagsLastFetched < TAGS_CACHE_DURATION) {
    return polymarketTagsCache;
  }

  if (polymarketTagsInFlight) {
    return polymarketTagsInFlight;
  }

  if (!isExtensionContextValid()) {
    log("Extension context invalidated, cannot fetch tags");
    return polymarketTagsCache;
  }

  polymarketTagsInFlight = (async () => {
    try {
      const url = `${POLYMARKET_TAGS_API_URL}?limit=500`;
      const resp = await safeSendMessage({ type: "fetch-text", url });

      if (resp?.ok && "text" in resp && resp.text) {
        const tags = JSON.parse(resp.text) as PolymarketTag[];
        const { keywordMap, keywordRegexMap } = buildTagKeywordMap(tags);
        // MEMORY: Only store the derived maps needed for matching.
        // The raw list, slugs Set, and labels Set are not used after building maps.
        polymarketTagsCache = {
          list: tags,
          keywordMap,
          keywordRegexMap,
        };
        tagsLastFetched = now;
        log(
          "Cached",
          tags.length,
          "Polymarket tags with",
          keywordRegexMap.size,
          "precompiled regexes"
        );
        return polymarketTagsCache;
      }
    } catch (e) {
      log("Failed to fetch tags:", e);
    } finally {
      polymarketTagsInFlight = null;
    }

    return polymarketTagsCache;
  })();

  return polymarketTagsInFlight;
}

/**
 * Extract matching Polymarket tags from text using precompiled regexes
 */
function extractMatchingTags(
  text: string,
  tagsData: PolymarketTagsCache
): string[] {
  if (!tagsData) return [];

  const lower = text.toLowerCase();
  const tokenMatchedTags = new Set<string>();
  const phraseMatchedTags = new Set<string>();

  // Fast path: token-based lookup for simple keywords
  // Cap at 15 to avoid unnecessary work on long posts while keeping a good selection pool
  if (tagsData.keywordMap?.size) {
    const tokens = lower.match(/[a-z0-9]+/g) || [];
    for (const token of tokens) {
      const tagSlug = tagsData.keywordMap.get(token);
      if (tagSlug) {
        tokenMatchedTags.add(tagSlug);
        if (tokenMatchedTags.size >= 15) break;
      }
    }
  }

  // Regex pass for complex multi-word keywords (more specific, higher quality)
  // Cap at 10 — phrase matches are prioritized in the final result
  if (tagsData.keywordRegexMap?.size) {
    for (const { regex, tagSlug } of tagsData.keywordRegexMap.values()) {
      if (regex.test(lower)) {
        phraseMatchedTags.add(tagSlug);
        if (phraseMatchedTags.size >= 10) break;
      }
    }
  }

  // Prioritize phrase matches, then fill remaining slots with token matches.
  const merged = new Set(phraseMatchedTags);
  for (const tag of tokenMatchedTags) merged.add(tag);
  return Array.from(merged).slice(0, 5);
}

// Scored keyword extraction: candidates are ranked by quality, not position.

const MULTI_WORD_ENTITY_RE =
  /\b([A-Z][a-z]+(?:\s+(?:of|the|and|for|in)\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
const SHORT_CAPS_TOKEN_RE = /\b[A-Z][A-Z0-9]{1,5}\b/g;
const CAMEL_HASHTAG_RE = /#([A-Z][a-z]+(?:[A-Z][a-z]+)+)/g;
const DIGIT_HASHTAG_RE = /#([A-Za-z]+)(\d+)/g;

const CANDIDATE_SCORE = {
  multiWordEntity: 10,
  highSignalToken: 9,
  hashtag: 7,
  titleCaseWord: 5,
  longNoun: 3,
} as const;

interface KeywordCandidate {
  term: string;
  score: number;
}

function normalizeHashtag(raw: string): string {
  const withoutHash = raw.startsWith("#") ? raw.slice(1) : raw;

  const camelSplit = withoutHash.replace(/([a-z])([A-Z])/g, "$1 $2");
  const digitSplit = camelSplit.replace(/([A-Za-z])(\d)/g, "$1 $2");
  return digitSplit.toLowerCase();
}

function extractBasicKeywords(text: string): string {
  if (!text) return "";

  const candidates: KeywordCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (term: string, score: number): void => {
    const key = term.toLowerCase().trim();
    if (!key || key.length < 2 || seen.has(key)) return;
    if (COMMON_WORDS.has(key)) return;
    seen.add(key);
    candidates.push({ term: key, score });
  };

  const cleanText = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u0060\u02BC]/g, "'")
    .replace(/'s\b/gi, "")
    .replace(/n't\b/gi, "")
    .replace(/'[a-z]{1,2}\b/gi, "");

  MULTI_WORD_ENTITY_RE.lastIndex = 0;
  for (
    let match = MULTI_WORD_ENTITY_RE.exec(cleanText);
    match !== null;
    match = MULTI_WORD_ENTITY_RE.exec(cleanText)
  ) {
    const phrase = match[1].trim();
    const words = phrase.split(/\s+/);
    const contentWords = words.filter(
      (w) => !COMMON_WORDS.has(w.toLowerCase())
    );
    if (contentWords.length >= 2) {
      addCandidate(phrase, CANDIDATE_SCORE.multiWordEntity);
    }
  }

  SHORT_CAPS_TOKEN_RE.lastIndex = 0;
  for (
    let match = SHORT_CAPS_TOKEN_RE.exec(cleanText);
    match !== null;
    match = SHORT_CAPS_TOKEN_RE.exec(cleanText)
  ) {
    const token = match[0].toLowerCase();
    if (HIGH_SIGNAL_TOKENS.has(token)) {
      addCandidate(match[0], CANDIDATE_SCORE.highSignalToken);
    }
  }

  // Case-insensitive sweep for high-signal brand/protocol names. Tickers and
  // acronyms above are caught by SHORT_CAPS_TOKEN_RE; this branch handles
  // mixed-case proper nouns like "Hyperliquid" or "Polymarket" so they bias
  // the upstream search ranker instead of falling to the long-noun bucket.
  for (const word of cleanText.replace(/[^\w\s]/g, " ").split(/\s+/)) {
    if (!word) continue;
    const lower = word.toLowerCase();
    if (CASE_INSENSITIVE_HIGH_SIGNAL_TOKENS.has(lower)) {
      addCandidate(word, CANDIDATE_SCORE.highSignalToken);
    }
  }

  const hashtags = cleanText.match(/#\w+/g) || [];
  for (const tag of hashtags) {
    const normalized = normalizeHashtag(tag);
    if (normalized.length >= 2 && !COMMON_WORDS.has(normalized)) {
      addCandidate(normalized, CANDIDATE_SCORE.hashtag);
    }
  }

  CAMEL_HASHTAG_RE.lastIndex = 0;
  for (
    let match = CAMEL_HASHTAG_RE.exec(cleanText);
    match !== null;
    match = CAMEL_HASHTAG_RE.exec(cleanText)
  ) {
    addCandidate(normalizeHashtag(match[0]), CANDIDATE_SCORE.hashtag);
  }

  DIGIT_HASHTAG_RE.lastIndex = 0;
  for (
    let match = DIGIT_HASHTAG_RE.exec(cleanText);
    match !== null;
    match = DIGIT_HASHTAG_RE.exec(cleanText)
  ) {
    addCandidate(
      `${match[1].toLowerCase()} ${match[2]}`,
      CANDIDATE_SCORE.hashtag
    );
  }

  const titleCaseWords = cleanText.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  for (const word of titleCaseWords) {
    if (!ENTITY_EXCLUDE_WORDS.has(word)) {
      addCandidate(word, CANDIDATE_SCORE.titleCaseWord);
    }
  }

  const allWords = cleanText.replace(/[^\w\s]/g, " ").split(/\s+/);
  for (const word of allWords) {
    const lower = word.toLowerCase();
    if (
      word.length > 4 &&
      !COMMON_WORDS.has(lower) &&
      !/^\d+$/.test(word) &&
      !HIGH_SIGNAL_TOKENS.has(lower)
    ) {
      addCandidate(word, CANDIDATE_SCORE.longNoun);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates
    .slice(0, 6)
    .map((c) => c.term)
    .join(" ");
}

interface AIExtractionResult {
  keywords: string;
  topics: string[];
  entities: string[];
  confidence: number;
}

interface AITopicExtractionEndpointResponse {
  success?: boolean;
  searchQuery?: string;
  tags?: string[];
  entities?: string[];
  confidence?: number;
  cached?: boolean;
  durationMs?: number;
  fallbackReason?: string;
  inputLength?: number;
  truncated?: boolean;
  error?: string;
}

/**
 * Build a stable, bounded cache key from post text
 */
function getAIExtractionCacheKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 600);
}

/**
 * Read from AI extraction cache with per-result TTL
 */
function getCachedAIExtraction(
  text: string
): AIExtractionResult | null | undefined {
  const key = getAIExtractionCacheKey(text);
  if (!key) return undefined;

  const cached = aiExtractionCache.get(key);
  if (!cached) return undefined;

  const ttl = cached.result ? AI_CACHE_TTL_MS : AI_CACHE_FAILURE_TTL_MS;
  if (Date.now() - cached.cachedAt > ttl) {
    aiExtractionCache.delete(key);
    return undefined;
  }

  return cached.result;
}

/**
 * Write AI extraction result to cache with simple LRU-like eviction
 */
function setCachedAIExtraction(
  text: string,
  result: AIExtractionResult | null
): void {
  const key = getAIExtractionCacheKey(text);
  if (!key) return;

  // Refresh recency order if key already exists
  if (aiExtractionCache.has(key)) {
    aiExtractionCache.delete(key);
  }
  aiExtractionCache.set(key, { result, cachedAt: Date.now() });

  if (aiExtractionCache.size > AI_CACHE_MAX_ENTRIES) {
    const oldestKey = aiExtractionCache.keys().next().value;
    if (oldestKey !== undefined) {
      aiExtractionCache.delete(oldestKey);
    }
  }
}

/**
 * Extract keywords using AI (optional, requires API endpoint)
 */
async function extractKeywordsWithAI(
  text: string
): Promise<AIExtractionResult | null> {
  const { log, safeSendMessage } = window.KNOWW_UTILS;
  const { KNOWW_APP_URL } = window.KNOWW_CONFIG;
  const normalizedText = text.trim();
  if (!normalizedText) return null;

  const cachedResult = getCachedAIExtraction(normalizedText);
  if (cachedResult !== undefined) {
    log(
      cachedResult
        ? "AI extraction cache hit (success)"
        : "AI extraction cache hit (recent failure)"
    );
    if (cachedResult) {
      log("AI cache payload:", {
        keywords: cachedResult.keywords,
        topics: cachedResult.topics,
        entities: cachedResult.entities,
      });
    }
    return cachedResult;
  }

  try {
    const requestPromise = safeSendMessage({
      type: "fetch-json",
      url: `${KNOWW_APP_URL}/api/ai/extract-topics`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { text: normalizedText },
    });

    const timeoutPromise = new Promise<{ ok: false; error: string }>(
      (resolve) => {
        setTimeout(
          () => resolve({ ok: false, error: "AI extraction request timeout" }),
          AI_REQUEST_TIMEOUT_MS
        );
      }
    );

    const resp = await Promise.race([requestPromise, timeoutPromise]);
    if (!resp.ok) {
      log("AI extraction request did not succeed:", resp.error);
    }

    if (resp?.ok && "data" in resp && resp.data) {
      const data = resp.data as AITopicExtractionEndpointResponse;
      const status = "status" in resp ? resp.status : undefined;

      if (typeof status === "number" && (status < 200 || status >= 300)) {
        log("AI extraction returned non-2xx status:", status, data);
        setCachedAIExtraction(normalizedText, null);
        return null;
      }

      log("AI endpoint response meta:", {
        success: data.success,
        cached: data.cached,
        durationMs: data.durationMs,
        fallbackReason: data.fallbackReason,
        inputLength: data.inputLength,
        truncated: data.truncated,
      });

      if (data.success === false) {
        log(
          "AI endpoint returned success=false:",
          data.error || "unknown error"
        );
        setCachedAIExtraction(normalizedText, null);
        return null;
      }

      if (
        typeof data.searchQuery !== "string" ||
        !Array.isArray(data.tags) ||
        !Array.isArray(data.entities) ||
        typeof data.confidence !== "number"
      ) {
        log("AI endpoint returned unexpected payload shape:", data);
        setCachedAIExtraction(normalizedText, null);
        return null;
      }

      // Map backend response shape to extension's internal AI result shape.
      // Backend returns { searchQuery, tags, entities, confidence }; extension expects
      // { keywords, topics, entities, confidence }.
      const normalizedResult: AIExtractionResult = {
        keywords: data.searchQuery || "",
        topics: data.tags || [],
        entities: data.entities || [],
        confidence: data.confidence ?? 0,
      };
      log("AI extracted keywords:", normalizedResult);
      setCachedAIExtraction(normalizedText, normalizedResult);
      return normalizedResult;
    }
  } catch (e) {
    log("AI extraction failed, falling back to rules:", e);
  }

  // Short-lived negative cache prevents repeated failing calls for same post text
  setCachedAIExtraction(normalizedText, null);
  return null;
}

/**
 * Extract keywords using rule-based approach.
 * AI is no longer used for direct keyword extraction — it is only used
 * as a fallback when the context gate blocks high-scoring markets
 * (handled in injection.ts).
 */
async function extractSearchKeywords(
  text: string
): Promise<KeywordExtractionResult> {
  if (!text) return { keywords: "", matchedTags: [], source: "none" };

  const { log } = window.KNOWW_UTILS;
  const textPreview = text.slice(0, 160).replace(/\s+/g, " ").trim();
  log("Keyword extraction start:", {
    textLength: text.length,
    textPreview,
  });
  const tagsData = await fetchPolymarketTags();

  const matchedTags = tagsData ? extractMatchingTags(text, tagsData) : [];
  const keywords = extractBasicKeywords(text);
  log("Rules extraction result:", {
    keywords,
    matchedTags,
    extractionSource: "rules",
  });

  return { keywords, matchedTags, source: "rules" };
}

// Type for raw Polymarket event from API
interface RawPolymarketEvent {
  id: string;
  title?: string;
  slug?: string;
  closed?: boolean;
  active?: boolean;
  volume24hr?: number;
  tags?: Array<{ slug?: string; label?: string }>;
  markets?: Array<{
    id?: string;
    question?: string;
    groupItemTitle?: string;
    outcomePrices?: string | number[];
    outcomes?: string[];
    conditionId?: string;
    clobTokenIds?: string;
    slug?: string;
    active?: boolean;
    closed?: boolean;
    archived?: boolean;
    acceptingOrders?: boolean;
    volume?: string | number;
  }>;
  image?: string;
  _source?: string;
  source?: "polymarket" | "kalshi";
}

interface KnowwSearchResponsePayload {
  events?: RawPolymarketEvent[];
  data?: RawPolymarketEvent[];
  degraded?: boolean;
}

function parsePolymarketEventsPayload(payload: unknown): RawPolymarketEvent[] {
  if (Array.isArray(payload)) {
    return payload as RawPolymarketEvent[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const wrapper = payload as {
    data?: unknown;
    events?: unknown;
  };

  if (Array.isArray(wrapper.events)) {
    return wrapper.events as RawPolymarketEvent[];
  }

  if (Array.isArray(wrapper.data)) {
    return wrapper.data as RawPolymarketEvent[];
  }

  return [];
}

function normalizePolymarketSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

function normalizePolymarketTagSlugs(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const slug = tag
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    normalized.push(slug);
    if (normalized.length >= 2) break;
  }

  return normalized;
}

function buildPolymarketSearchCacheKey(
  query: string,
  matchedTags: string[]
): string {
  return JSON.stringify({
    query: normalizePolymarketSearchQuery(query),
    tags: normalizePolymarketTagSlugs(matchedTags),
  });
}

function readPolymarketSearchCache(
  key: string,
  requireFresh: boolean
): Market[] | null {
  const entry = polymarketSearchCache.get(key);
  if (!entry) return null;

  if (requireFresh && entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry.markets;
}

function writePolymarketSearchCache(
  key: string,
  markets: Market[],
  degraded = false
): void {
  const now = Date.now();
  const ttl = degraded
    ? POLYMARKET_SEARCH_FAILURE_CACHE_TTL_MS
    : markets.length > 0
      ? POLYMARKET_SEARCH_CACHE_TTL_MS
      : POLYMARKET_SEARCH_EMPTY_CACHE_TTL_MS;

  if (polymarketSearchCache.has(key)) {
    polymarketSearchCache.delete(key);
  }

  polymarketSearchCache.set(key, {
    markets,
    cachedAt: now,
    expiresAt: now + ttl,
    degraded,
  });

  if (polymarketSearchCache.size > POLYMARKET_SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = polymarketSearchCache.keys().next().value;
    if (oldestKey) polymarketSearchCache.delete(oldestKey);
  }
}

function buildKnowwPolymarketSearchUrl(
  query: string,
  matchedTags: string[]
): string {
  const baseUrl = window.KNOWW_CONFIG.KNOWW_APP_URL || "https://knoww.app";
  const url = new URL("/api/search", baseUrl);
  const normalizedQuery = normalizePolymarketSearchQuery(query);
  const normalizedTags = normalizePolymarketTagSlugs(matchedTags);

  if (normalizedQuery) {
    url.searchParams.set("q", normalizedQuery);
  }
  if (normalizedTags.length > 0) {
    url.searchParams.set("tag_slugs", normalizedTags.join(","));
  }

  url.searchParams.set("limit", "8");
  url.searchParams.set("source", "extension");

  return url.toString();
}

function buildKnowwPolymarketEventUrl(market: Market): string | null {
  const identifier = market.slug || market.id;
  if (!identifier) return null;

  return buildKnowwPolymarketEventUrlByIdentifier(identifier);
}

function buildKnowwPolymarketEventUrlByIdentifier(identifier: string): string {
  const baseUrl = window.KNOWW_CONFIG.KNOWW_APP_URL || "https://knoww.app";
  const url = new URL(`/api/events/${encodeURIComponent(identifier)}`, baseUrl);
  url.searchParams.set("fresh", "1");
  url.searchParams.set("source", "extension");
  return url.toString();
}

function buildKnowwPolymarketMarketSlugUrl(slug: string): string {
  const baseUrl = window.KNOWW_CONFIG.KNOWW_APP_URL || "https://knoww.app";
  const url = new URL(`/api/markets/slug/${encodeURIComponent(slug)}`, baseUrl);
  url.searchParams.set("source", "extension");
  return url.toString();
}

function parsePolymarketEventDetailPayload(payload: unknown): Market | null {
  if (!payload || typeof payload !== "object") return null;

  const wrapper = payload as { success?: unknown; event?: unknown };
  if (wrapper.success === false || !wrapper.event) return null;

  const [market] = mapRawPolymarketEvents(
    [wrapper.event as RawPolymarketEvent],
    "search"
  );
  return market ?? null;
}

function parsePolymarketMarketSlugPayload(payload: unknown): Market | null {
  if (!payload || typeof payload !== "object") return null;

  const wrapper = payload as { success?: unknown; market?: unknown };
  if (wrapper.success === false || !wrapper.market) return null;
  if (typeof wrapper.market !== "object" || wrapper.market === null) {
    return null;
  }

  const raw = wrapper.market as Record<string, unknown>;
  const rawSlug = typeof raw.slug === "string" ? raw.slug : "";
  const id =
    typeof raw.id === "string"
      ? raw.id
      : typeof raw.conditionId === "string"
        ? raw.conditionId
        : rawSlug;
  const title =
    typeof raw.question === "string"
      ? raw.question
      : typeof raw.groupItemTitle === "string"
        ? raw.groupItemTitle
        : rawSlug.replace(/-/g, " ");

  if (!id || !title) return null;

  const nestedMarket = raw as unknown as NonNullable<Market["markets"]>[number];
  return {
    ...raw,
    id,
    title,
    slug: rawSlug || undefined,
    source: "polymarket",
    image: typeof raw.image === "string" ? raw.image : undefined,
    active: raw.active !== false,
    closed: raw.closed === true,
    volume:
      typeof raw.volume === "number"
        ? raw.volume
        : typeof raw.volume === "string"
          ? Number(raw.volume)
          : undefined,
    volume24hr: typeof raw.volume24hr === "number" ? raw.volume24hr : undefined,
    markets: [nestedMarket],
  } as Market;
}

function enqueuePolymarketSearch<T>(task: () => Promise<T>): Promise<T> {
  const run = polymarketSearchQueue
    .catch(() => undefined)
    .then(async () => {
      const elapsed = Date.now() - lastPolymarketSearchStartedAt;
      const delayMs = Math.max(0, POLYMARKET_SEARCH_MIN_INTERVAL_MS - elapsed);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      lastPolymarketSearchStartedAt = Date.now();
      return task();
    });

  polymarketSearchQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

function mapRawPolymarketEvents(
  events: RawPolymarketEvent[],
  fallbackSource: "search" | "tag"
): Market[] {
  const allEvents: Market[] = [];
  const seenIds = new Set<string>();

  for (const event of events) {
    if (event.closed === true || event.active === false) continue;
    if (seenIds.has(event.id)) continue;

    seenIds.add(event.id);
    const eventSource =
      event._source === "search" || event._source === "tag"
        ? event._source
        : fallbackSource;
    allEvents.push({
      ...event,
      title: event.title || "",
      source: "polymarket",
      _source: eventSource,
    });
  }

  return allEvents
    .filter((event) => event.closed !== true && event.active !== false)
    .sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0))
    .slice(0, 8);
}

async function fetchKnowwPolymarketSearch(
  query: string,
  matchedTags: string[]
): Promise<Market[]> {
  const { log, safeSendMessage } = window.KNOWW_UTILS;
  const searchUrl = buildKnowwPolymarketSearchUrl(query, matchedTags);

  const searchResp = await safeSendMessage({
    type: "fetch-json",
    method: "GET",
    url: searchUrl,
  });

  if (!searchResp?.ok || !("data" in searchResp)) {
    throw new Error(
      "error" in (searchResp || {})
        ? (searchResp as { error?: string }).error || "Search request failed"
        : "Search request failed"
    );
  }

  const responseStatus =
    "status" in searchResp && typeof searchResp.status === "number"
      ? searchResp.status
      : 200;

  if (responseStatus >= 400) {
    throw new Error(`Search request failed with ${responseStatus}`);
  }

  const payload = searchResp.data as KnowwSearchResponsePayload;
  const rawEvents = parsePolymarketEventsPayload(payload);
  const markets = mapRawPolymarketEvents(rawEvents, "search");

  log(
    "Polymarket Search API:",
    rawEvents.length,
    "raw events,",
    markets.length,
    "active for:",
    query
  );

  if (payload.degraded) {
    log("Polymarket Search API degraded response for:", query);
  }

  return markets;
}

async function searchPolymarketEventsViaKnoww(
  query: string,
  matchedTags: string[]
): Promise<Market[]> {
  const { log } = window.KNOWW_UTILS;
  const cacheKey = buildPolymarketSearchCacheKey(query, matchedTags);

  const cached = readPolymarketSearchCache(cacheKey, true);
  if (cached) {
    return cached;
  }

  const inFlight = polymarketSearchInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = enqueuePolymarketSearch(async () => {
    try {
      const markets = await fetchKnowwPolymarketSearch(query, matchedTags);
      writePolymarketSearchCache(cacheKey, markets);
      return markets;
    } catch (error) {
      log("Polymarket Search API error:", error);
      const stale = readPolymarketSearchCache(cacheKey, false);
      if (stale) {
        return stale;
      }
      writePolymarketSearchCache(cacheKey, [], true);
      return [];
    } finally {
      polymarketSearchInFlight.delete(cacheKey);
    }
  });

  polymarketSearchInFlight.set(cacheKey, request);
  return request;
}

/**
 * Search Polymarket events
 */
async function searchPolymarketEvents(
  query: string,
  matchedTags: string[] = []
): Promise<Market[]> {
  const { log, isExtensionContextValid } = window.KNOWW_UTILS;
  const { ENABLED_SOURCES } = window.KNOWW_CONFIG;

  // Check if Polymarket is enabled
  if (!ENABLED_SOURCES?.polymarket) {
    log("Polymarket source is disabled");
    return [];
  }

  if (!query.trim() && matchedTags.length === 0) return [];

  if (!isExtensionContextValid()) {
    log("Extension context invalidated, cannot search");
    return [];
  }

  return searchPolymarketEventsViaKnoww(query, matchedTags);
}

async function fetchPolymarketEventRefresh(
  market: Market
): Promise<Market | null> {
  const { log, isExtensionContextValid, safeSendMessage } = window.KNOWW_UTILS;

  if (market.source !== "polymarket") return null;
  if (!isExtensionContextValid()) {
    log("Extension context invalidated, cannot refresh market event");
    return null;
  }

  const refreshUrl = buildKnowwPolymarketEventUrl(market);
  if (!refreshUrl) return null;

  const refreshKey = market.slug || market.id;
  const inFlight = polymarketEventRefreshInFlight.get(refreshKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    const lastStartedAt =
      polymarketEventLastRefreshStartedAt.get(refreshKey) ?? 0;
    const elapsed = Date.now() - lastStartedAt;
    const delayMs = Math.max(
      0,
      POLYMARKET_EVENT_REFRESH_MIN_INTERVAL_MS - elapsed
    );
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    polymarketEventLastRefreshStartedAt.set(refreshKey, Date.now());

    try {
      const response = await safeSendMessage({
        type: "fetch-json",
        method: "GET",
        url: refreshUrl,
      });

      if (!response?.ok || !("data" in response)) {
        return null;
      }

      const responseStatus =
        "status" in response && typeof response.status === "number"
          ? response.status
          : 200;
      if (responseStatus >= 400) return null;

      return parsePolymarketEventDetailPayload(response.data);
    } catch (error) {
      log("Polymarket event refresh failed:", error);
      return null;
    } finally {
      polymarketEventRefreshInFlight.delete(refreshKey);
    }
  })();

  polymarketEventRefreshInFlight.set(refreshKey, request);
  return request;
}

type PolymarketDirectLocation = {
  kind: "event" | "market";
  slug: string;
  nestedMarketSlug?: string;
};

function parsePolymarketDirectLocation(
  rawUrl: string
): PolymarketDirectLocation | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (host !== "polymarket.com" && !host.endsWith(".polymarket.com")) {
      return null;
    }

    const segments = url.pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment).trim())
      .filter(Boolean);
    const section = segments[0]?.toLowerCase();
    const slug = segments[1];

    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return null;
    const nestedMarketSlug =
      typeof segments[2] === "string" && /^[a-z0-9-]+$/i.test(segments[2])
        ? segments[2]
        : undefined;

    if (section === "event" || section === "events") {
      return { kind: "event", slug, nestedMarketSlug };
    }
    if (section === "market" || section === "markets") {
      return { kind: "market", slug };
    }
  } catch {
    return null;
  }

  return null;
}

function readDirectUrlCache(key: string): string | null | undefined {
  const cached = polymarketDirectUrlCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    polymarketDirectUrlCache.delete(key);
    return undefined;
  }
  return cached.value;
}

function writeDirectUrlCache(key: string, value: string | null): void {
  polymarketDirectUrlCache.set(key, {
    value,
    expiresAt: Date.now() + POLYMARKET_DIRECT_LINK_CACHE_TTL_MS,
  });

  if (polymarketDirectUrlCache.size > POLYMARKET_SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = polymarketDirectUrlCache.keys().next().value;
    if (oldestKey) polymarketDirectUrlCache.delete(oldestKey);
  }
}

function findPolymarketUrlInText(text: string): string | null {
  const match = text.match(/https:\/\/(?:www\.)?polymarket\.com\/[^\s"'<>]+/i);
  return match?.[0] || null;
}

function normalizeDirectMarketTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[_]+/g, " blank ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDirectMarketTitleScore(hintTitle: string, market: Market): number {
  const hint = normalizeDirectMarketTitle(hintTitle);
  const title = normalizeDirectMarketTitle(market.title || "");
  if (!hint || !title) return 0;
  if (hint === title) return 1;
  if (hint.includes(title) || title.includes(hint)) return 0.95;

  const hintTokens = new Set(
    hint.split(" ").filter((token) => token.length > 2)
  );
  const titleTokens = new Set(
    title.split(" ").filter((token) => token.length > 2)
  );
  if (hintTokens.size === 0 || titleTokens.size === 0) return 0;

  let shared = 0;
  for (const token of hintTokens) {
    if (titleTokens.has(token)) shared++;
  }

  return shared / Math.max(hintTokens.size, titleTokens.size);
}

async function fetchDirectPolymarketMarketByTitle(
  hintTitle: string
): Promise<Market | null> {
  const { log } = window.KNOWW_UTILS;
  const normalizedHintTitle = normalizeDirectMarketTitle(hintTitle);
  if (!normalizedHintTitle || normalizedHintTitle.length < 6) return null;

  const searchResults = await searchPolymarketEvents(hintTitle, []);
  const ranked = searchResults
    .filter((market) => market.closed !== true && market.active !== false)
    .map((market) => ({
      market,
      score: getDirectMarketTitleScore(hintTitle, market),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 0.6) {
    log("Direct Polymarket title fallback found no strong match:", {
      title: hintTitle.slice(0, 100),
      bestScore: best?.score,
      bestTitle: best?.market.title?.slice(0, 100),
    });
    return null;
  }

  log("Direct Polymarket title fallback matched:", {
    title: hintTitle.slice(0, 100),
    market: best.market.title?.slice(0, 100),
    score: Number(best.score.toFixed(3)),
  });

  return best.market;
}

async function resolvePolymarketHintUrl(
  hint: MarketLinkHint
): Promise<string | null> {
  const { log, safeSendMessage } = window.KNOWW_UTILS;
  if (!hint.url) return null;

  try {
    const directLocation = parsePolymarketDirectLocation(hint.url);
    if (directLocation) return hint.url;

    const url = new URL(hint.url, window.location.origin);
    const host = url.hostname.toLowerCase();
    if (host !== "t.co") return null;

    const cacheKey = url.toString();
    const cached = readDirectUrlCache(cacheKey);
    if (cached !== undefined) return cached;

    const response = await safeSendMessage({
      type: "fetch-text",
      url: cacheKey,
    });

    if (!response?.ok || !("text" in response)) {
      writeDirectUrlCache(cacheKey, null);
      return null;
    }

    const expandedUrl =
      (typeof response.responseUrl === "string" &&
      parsePolymarketDirectLocation(response.responseUrl)
        ? response.responseUrl
        : null) || findPolymarketUrlInText(response.text);
    writeDirectUrlCache(cacheKey, expandedUrl);
    return expandedUrl;
  } catch (error) {
    log("Failed to resolve Polymarket link hint:", error);
    return null;
  }
}

async function fetchDirectPolymarketMarket(
  location: PolymarketDirectLocation
): Promise<Market | null> {
  const { safeSendMessage } = window.KNOWW_UTILS;

  const fetchJson = async (url: string) => {
    return safeSendMessage({
      type: "fetch-json",
      method: "GET",
      url,
    });
  };

  if (location.kind === "event") {
    if (location.nestedMarketSlug) {
      const nestedMarketResponse = await fetchJson(
        buildKnowwPolymarketMarketSlugUrl(location.nestedMarketSlug)
      );
      if (nestedMarketResponse?.ok && "data" in nestedMarketResponse) {
        const market = parsePolymarketMarketSlugPayload(
          nestedMarketResponse.data
        );
        if (market) return market;
      }
    }

    const eventResponse = await fetchJson(
      buildKnowwPolymarketEventUrlByIdentifier(location.slug)
    );
    if (eventResponse?.ok && "data" in eventResponse) {
      const market = parsePolymarketEventDetailPayload(eventResponse.data);
      if (market) return market;
    }

    const marketResponse = await fetchJson(
      buildKnowwPolymarketMarketSlugUrl(location.slug)
    );
    if (marketResponse?.ok && "data" in marketResponse) {
      return parsePolymarketMarketSlugPayload(marketResponse.data);
    }
    return null;
  }

  const marketResponse = await fetchJson(
    buildKnowwPolymarketMarketSlugUrl(location.slug)
  );
  if (marketResponse?.ok && "data" in marketResponse) {
    const market = parsePolymarketMarketSlugPayload(marketResponse.data);
    if (market) return market;
  }

  const eventResponse = await fetchJson(
    buildKnowwPolymarketEventUrlByIdentifier(location.slug)
  );
  if (eventResponse?.ok && "data" in eventResponse) {
    return parsePolymarketEventDetailPayload(eventResponse.data);
  }
  return null;
}

async function resolvePolymarketMarketsFromHints(
  hints: MarketLinkHint[]
): Promise<Market[]> {
  const { log } = window.KNOWW_UTILS;
  const directMarkets: Market[] = [];
  const seen = new Set<string>();

  for (const hint of hints.slice(0, POLYMARKET_DIRECT_LINK_MAX_HINTS)) {
    if (hint.source !== "polymarket") continue;

    const resolvedUrl = await resolvePolymarketHintUrl(hint);
    const location = resolvedUrl
      ? parsePolymarketDirectLocation(resolvedUrl)
      : null;
    let market = location ? await fetchDirectPolymarketMarket(location) : null;

    if (!market && hint.title) {
      market = await fetchDirectPolymarketMarketByTitle(hint.title);
    }

    if (
      !market ||
      market.closed === true ||
      market.active === false ||
      !isMarketWithinDisplayPriceCap(market)
    ) {
      continue;
    }

    const key = market.id || market.slug || market.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    market._contextReason = "Direct Polymarket link";
    directMarkets.push(market);
  }

  if (directMarkets.length > 0) {
    log(
      "Resolved direct Polymarket link(s):",
      directMarkets.map((market) => market.title?.slice(0, 80))
    );
  }

  return directMarkets;
}

/**
 * Search all enabled market sources (Polymarket + Kalshi)
 * Returns unified, deduplicated results from all sources
 */
async function searchAllMarkets(
  query: string,
  matchedTags: string[] = []
): Promise<Market[]> {
  const { log } = window.KNOWW_UTILS;
  const { ENABLED_SOURCES } = window.KNOWW_CONFIG;
  const isDebug =
    window.KNOWW_CONFIG?.isDebugMode?.() ??
    window.KNOWW_CONFIG?.DEV_MODE ??
    false;

  log("Searching all markets for:", query, "tags:", matchedTags);

  const searchEntries: Array<{
    source: string;
    promise: Promise<Market[]>;
  }> = [];

  // Search Polymarket if enabled
  if (ENABLED_SOURCES?.polymarket) {
    searchEntries.push({
      source: "Polymarket",
      promise: searchPolymarketEvents(query, matchedTags).catch((e) => {
        log("Polymarket search failed:", e);
        return [];
      }),
    });
  }

  // Search Kalshi if enabled and adapter is available
  if (ENABLED_SOURCES?.kalshi && window.KNOWW_KALSHI) {
    // Get Kalshi categories from text
    const kalshiCategories = await window.KNOWW_KALSHI.fetchKalshiCategories();
    const kalshiMatchedCategories = kalshiCategories
      ? window.KNOWW_KALSHI.extractMatchingKalshiCategories(
          `${query} ${matchedTags.join(" ")}`,
          kalshiCategories
        )
      : [];

    searchEntries.push({
      source: "Kalshi",
      promise: window.KNOWW_KALSHI.searchKalshiEvents(
        query,
        kalshiMatchedCategories
      ).catch((e) => {
        log("Kalshi search failed:", e);
        return [];
      }),
    });
  }

  // Wait for all searches to complete
  const results = await Promise.all(
    searchEntries.map((entry) => entry.promise)
  );

  if (isDebug) {
    log("📥 Search results by source:");
    results.forEach((sourceResults, i) => {
      log(`  ${searchEntries[i].source}: ${sourceResults.length} results`);
    });
  }

  // Flatten results
  const allMarkets = results.flat();

  if (isDebug) {
    // Debug: Verify source field is set
    const marketsWithoutSource = allMarkets.filter((m) => !m.source);
    if (marketsWithoutSource.length > 0) {
      log(
        `⚠️ ${marketsWithoutSource.length} markets missing 'source' field (will default to polymarket)`
      );
    }
  }

  // Deduplicate by title similarity (markets from different sources might have similar titles)
  const deduplicatedMarkets = deduplicateMarkets(allMarkets).filter(
    isMarketWithinDisplayPriceCap
  );

  // Sort by volume (highest first)
  deduplicatedMarkets.sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));

  if (isDebug) {
    // Debug: Final breakdown
    const finalPolymarket = deduplicatedMarkets.filter(
      (m) => (m.source || "polymarket") === "polymarket"
    ).length;
    const finalKalshi = deduplicatedMarkets.filter(
      (m) => m.source === "kalshi"
    ).length;

    log(
      "📊 Combined search results:",
      deduplicatedMarkets.length,
      `markets (Polymarket: ${finalPolymarket}, Kalshi: ${finalKalshi})`
    );
  }

  return deduplicatedMarkets.slice(0, 10);
}

/**
 * Deduplicate markets by title similarity using fuzzy matching
 * Keeps the market with higher volume when duplicates are found
 * Uses Levenshtein distance with a similarity threshold to avoid merging distinct markets
 */
function deduplicateMarkets(markets: Market[]): Market[] {
  const uniqueMarkets: Market[] = [];

  for (const market of markets) {
    const normalizedTitle = normalizeTitle(market.title || "");
    let isDuplicate = false;
    let duplicateIndex = -1;

    // Check against all existing unique markets using fuzzy similarity
    for (let i = 0; i < uniqueMarkets.length; i++) {
      const existingNormalized = normalizeTitle(uniqueMarkets[i].title || "");
      const similarity = calculateTitleSimilarity(
        normalizedTitle,
        existingNormalized
      );

      // Only consider as duplicate if similarity is very high (>= 0.92)
      if (similarity >= 0.92) {
        isDuplicate = true;
        duplicateIndex = i;
        break;
      }
    }

    if (!isDuplicate) {
      uniqueMarkets.push(market);
    } else {
      // Keep the one with higher volume
      const existing = uniqueMarkets[duplicateIndex];
      if ((market.volume24hr || 0) > (existing.volume24hr || 0)) {
        uniqueMarkets[duplicateIndex] = market;
      }
    }
  }

  return uniqueMarkets;
}

/**
 * Calculate similarity between two normalized titles using Levenshtein distance
 */
function calculateTitleSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;

  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

/**
 * Calculate Levenshtein distance between two strings
 * Optimized: Uses 2 rows instead of full (m+1)x(n+1) matrix
 * Memory: O(n) instead of O(m*n)
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Edge cases
  if (m === 0) return n;
  if (n === 0) return m;

  // Optimize by using shorter string for columns (less memory)
  if (m < n) {
    return levenshteinDistance(str2, str1);
  }

  // Only need 2 rows instead of full matrix
  let prevRow = new Array<number>(n + 1);
  let currRow = new Array<number>(n + 1);

  // Initialize first row
  for (let j = 0; j <= n; j++) {
    prevRow[j] = j;
  }

  // Fill using only 2 rows
  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        currRow[j] = prevRow[j - 1];
      } else {
        currRow[j] = 1 + Math.min(prevRow[j], currRow[j - 1], prevRow[j - 1]);
      }
    }
    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n];
}

/**
 * Normalize title for deduplication comparison
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Keep alphanumerics and spaces
    .replace(/\s+/g, " ") // Collapse multiple spaces to single space
    .trim()
    .slice(0, 120); // Extended limit to preserve meaningful differences
}

interface DeduplicationTestResult {
  passed: number;
  failed: number;
  total: number;
}

/**
 * Test suite for deduplication logic
 * Only available in DEV_MODE - never runs or logs in production
 */
function testDeduplicationLogic(): DeduplicationTestResult | null {
  // Guard: Only run in DEV_MODE
  if (!KNOWW_CONFIG.DEV_MODE) {
    return null;
  }

  const testCases = [
    // Should NOT be deduplicated (distinct markets)
    {
      title1: "Will Bitcoin hit $100K?",
      title2: "Will Bitcoin hit $100K in 2025?",
      shouldMerge: false,
      description: "Different timeframe specificity",
    },
    {
      title1: "Will Trump win 2024?",
      title2: "Will Trump win 2028?",
      shouldMerge: false,
      description: "Different years",
    },
    {
      title1: "Will Ethereum reach $5000?",
      title2: "Will Ethereum reach $10000?",
      shouldMerge: false,
      description: "Different price targets",
    },
    {
      title1: "Will the Fed raise rates in January?",
      title2: "Will the Fed raise rates in March?",
      shouldMerge: false,
      description: "Different months",
    },
    {
      title1: "Will SpaceX launch Starship?",
      title2: "Will SpaceX land Starship?",
      shouldMerge: false,
      description: "Different actions",
    },
    // Should be deduplicated (same market, different formatting)
    {
      title1: "Will Bitcoin hit $100K?",
      title2: "Will Bitcoin hit $100K",
      shouldMerge: true,
      description: "Same market, punctuation difference",
    },
    {
      title1: "Will Trump Win 2024",
      title2: "Will Trump win 2024?",
      shouldMerge: true,
      description: "Same market, case and punctuation",
    },
    {
      title1: "Bitcoin to $100K",
      title2: "Bitcoin to $100K?",
      shouldMerge: true,
      description: "Same market, question mark",
    },
  ];

  log.info("dedup_tests.start", { total: testCases.length });
  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    const norm1 = normalizeTitle(test.title1);
    const norm2 = normalizeTitle(test.title2);
    const similarity = calculateTitleSimilarity(norm1, norm2);
    const wouldMerge = similarity >= 0.92;
    const testPassed = wouldMerge === test.shouldMerge;

    if (testPassed) {
      passed++;
      log.debug("dedup_tests.pass", {
        description: test.description,
        similarity: Number((similarity * 100).toFixed(1)),
      });
    } else {
      failed++;
      log.error("dedup_tests.fail", {
        description: test.description,
        title1: test.title1,
        title2: test.title2,
        norm1,
        norm2,
        similarityPercent: Number((similarity * 100).toFixed(1)),
        wouldMerge,
        shouldMerge: test.shouldMerge,
      });
    }
  }

  log.info("dedup_tests.done", { passed, failed, total: testCases.length });
  return { passed, failed, total: testCases.length };
}

/**
 * Calculate relevance score between post content and market
 */
function calculateRelevanceScore(
  postTexts: string[],
  market: Market,
  options: { includeNestedMarketContext?: boolean } = {}
): number {
  const { STOP_WORDS } = window.KNOWW_UTILS;
  const combinedText = postTexts.join(" ").toLowerCase();
  const marketTitle = (
    options.includeNestedMarketContext === true
      ? buildMarketGateText(market, { includeNestedMarkets: true })
      : market.title || ""
  ).toLowerCase();
  const marketTags = (market.tags || []).map((t) =>
    (t.slug || t.label || "").toLowerCase()
  );

  let score = 0;
  let meaningfulMatches = 0;

  // Extract significant words from market title
  const titleWords = marketTitle
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Check for meaningful word matches in title
  for (const word of titleWords) {
    if (combinedText.includes(word)) {
      // Give more weight to longer, more specific words
      if (word.length > 6) {
        score += 0.18;
        meaningfulMatches++;
      } else if (word.length > 4) {
        score += 0.12;
        meaningfulMatches++;
      } else if (word.length > 2) {
        score += 0.06;
        meaningfulMatches++;
      }
    }
  }

  // Check for tag matches (these are more specific/meaningful)
  for (const tag of marketTags) {
    if (tag.length > 2 && combinedText.includes(tag)) {
      score += 0.25;
      meaningfulMatches++;
    }
  }

  // Check for specific entity matches (names, proper nouns)
  const entities = extractEntities(marketTitle);
  for (const entity of entities) {
    if (combinedText.includes(entity.toLowerCase())) {
      score += 0.3; // High score for matching specific entities
      meaningfulMatches++;
    }
  }

  // Softer penalty for single matches
  if (meaningfulMatches < 2) {
    score = score * 0.7;
  }

  // Hard cap: no word overlap at all means the market is almost certainly irrelevant.
  // Volume and personalization alone should never push a zero-overlap market past threshold.
  if (meaningfulMatches === 0) {
    return Math.min(score, 0.1);
  }

  // Boost for high volume (popular markets)
  if (market.volume24hr && market.volume24hr > 1000000) {
    score += 0.08;
  } else if (market.volume24hr && market.volume24hr > 500000) {
    score += 0.05;
  } else if (market.volume24hr && market.volume24hr > 100000) {
    score += 0.03;
  }

  // Personalization boost (small nudge from user interaction history)
  if (
    window.KNOWW_CONFIG?.getUserSettings().personalizationEnabled !== false &&
    window.KNOWW_PREFERENCES
  ) {
    const prefBoost = window.KNOWW_PREFERENCES.getPreferenceBoost(market);
    if (prefBoost > 0) {
      score += prefBoost;
    }
  }

  return Math.min(score, 1.0);
}

/**
 * Extract named entities (people, companies, etc.) from text.
 * Uses module-scope ENTITY_NAME_RE and ENTITY_EXCLUDE_WORDS to avoid
 * re-creating RegExp/Set on every call.
 */
function extractEntities(text: string): string[] {
  const entities: string[] = [];

  const matches = text.match(ENTITY_NAME_RE) || [];
  for (const entity of matches) {
    if (entity.length > 3 && !ENTITY_EXCLUDE_WORDS.has(entity)) {
      entities.push(entity);
    }
  }

  return entities;
}

/**
 * Clear the Polymarket tags cache to free memory
 * Called when tab becomes hidden or on manual cleanup
 */
function clearTagsCache(): void {
  const noop = () => {};
  const { log } = window.KNOWW_UTILS || { log: noop };
  const now = Date.now();

  // Only clear if cache is old enough (avoid clearing fresh cache)
  if (polymarketTagsCache && now - tagsLastFetched > CACHE_CLEANUP_THRESHOLD) {
    const hadEntries = polymarketTagsCache.list?.length || 0;
    polymarketTagsCache = null;
    tagsLastFetched = 0;
    log(`🧹 Cleared Polymarket tags cache (${hadEntries} entries)`);
  }
}

/**
 * Get current cache stats for debugging
 */
function getCacheStats(): {
  tagsCount: number;
  tagsCacheAge: number;
  regexCount: number;
} {
  return {
    tagsCount: polymarketTagsCache?.list?.length || 0,
    tagsCacheAge: tagsLastFetched ? Date.now() - tagsLastFetched : 0,
    regexCount: polymarketTagsCache?.keywordRegexMap?.size || 0,
  };
}

/**
 * Validate that a market is genuinely relevant to a post via AI.
 * Returns { relevant, reason, confidence } or null on failure (fail-open).
 */
const VALIDATION_TIMEOUT_MS = 6000;

async function validateMarketRelevance(
  postText: string,
  market: Market
): Promise<{ relevant: boolean; reason: string; confidence: number } | null> {
  const { log, isExtensionContextValid, safeSendMessage } = window.KNOWW_UTILS;
  const { KNOWW_APP_URL, CONFIG } = window.KNOWW_CONFIG;

  if (!CONFIG.USE_AI_EXTRACTION || !isExtensionContextValid()) return null;

  const marketTags = (market.tags || [])
    .map((t) => t.slug || t.label || "")
    .filter(Boolean);

  try {
    const requestPromise = safeSendMessage({
      type: "fetch-json",
      url: `${KNOWW_APP_URL}/api/ai/validate-relevance`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        postText: postText.slice(0, 400),
        marketTitle: market.title,
        marketTags,
      },
    });

    const timeoutPromise = new Promise<{ ok: false; error: string }>(
      (resolve) => {
        setTimeout(
          () => resolve({ ok: false, error: "Validation timeout" }),
          VALIDATION_TIMEOUT_MS
        );
      }
    );

    const resp = await Promise.race([requestPromise, timeoutPromise]);
    if (
      resp?.ok &&
      "data" in resp &&
      resp.data &&
      typeof resp.data === "object"
    ) {
      const data = resp.data as {
        relevant?: boolean;
        reason?: string;
        confidence?: number;
      };
      const status = "status" in resp ? resp.status : undefined;

      if (typeof status === "number" && (status < 200 || status >= 300)) {
        log("AI relevance validation returned non-2xx status:", status, data);
        return null;
      }

      if (
        typeof data.relevant !== "boolean" ||
        typeof data.reason !== "string" ||
        typeof data.confidence !== "number"
      ) {
        log("AI relevance validation returned unexpected payload shape:", data);
        return null;
      }

      log("AI relevance validation:", {
        market: market.title?.slice(0, 40),
        relevant: data.relevant,
        reason: data.reason,
        confidence: data.confidence,
      });
      return {
        relevant: data.relevant,
        reason: data.reason,
        confidence: data.confidence,
      };
    }
  } catch (e) {
    log("AI validation failed (fail-open):", e);
  }

  return null;
}

// ============================================
// TRENDING MARKETS
// Fetches high-volume active markets independently of feed discovery.
// ============================================

let trendingMarketsCache: { markets: Market[]; fetchedAt: number } | null =
  null;
const TRENDING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch trending/popular markets sorted by 24h volume.
 * Used to populate the notification stack while feed-specific discovery runs
 * independently. Feed-discovered markets keep display priority in the UI.
 */
async function fetchTrendingMarkets(): Promise<Market[]> {
  const { log, isExtensionContextValid, safeSendMessage } = window.KNOWW_UTILS;
  const { POLYMARKET_EVENTS_KEYSET_API_URL, ENABLED_SOURCES } =
    window.KNOWW_CONFIG;

  const now = Date.now();
  if (
    trendingMarketsCache &&
    now - trendingMarketsCache.fetchedAt < TRENDING_CACHE_TTL_MS
  ) {
    log("Trending markets cache hit");
    return trendingMarketsCache.markets;
  }

  if (!isExtensionContextValid()) {
    log("Extension context invalidated, cannot fetch trending markets");
    return trendingMarketsCache?.markets || [];
  }

  const allTrending: Market[] = [];
  const seenIds = new Set<string>();

  // Fetch top Polymarket events by volume
  if (ENABLED_SOURCES?.polymarket) {
    try {
      const url = `${POLYMARKET_EVENTS_KEYSET_API_URL}?closed=false&limit=10&order=volume24hr&ascending=false`;
      const resp = await safeSendMessage({ type: "fetch-text", url });

      if (resp?.ok && "text" in resp && resp.text) {
        const eventList = parsePolymarketEventsPayload(JSON.parse(resp.text));
        for (const event of eventList) {
          if (event.closed === true || event.active === false) continue;
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id);
            allTrending.push({
              ...event,
              title: event.title || "",
              source: "polymarket",
              _source: "tag",
            });
          }
        }
        log("Fetched", eventList.length, "trending Polymarket events");
      }
    } catch (e) {
      log("Failed to fetch trending Polymarket events:", e);
    }
  }

  // Fetch trending Kalshi events via the v1 search API with a broad query.
  // searchKalshiEvents("", []) short-circuits, so we use a generic trending
  // keyword that returns popular active events.
  if (ENABLED_SOURCES?.kalshi && window.KNOWW_KALSHI) {
    try {
      const kalshiTrending = await window.KNOWW_KALSHI.searchKalshiEvents(
        "trending",
        []
      );
      for (const market of kalshiTrending) {
        if (!seenIds.has(market.id)) {
          seenIds.add(market.id);
          allTrending.push(market);
        }
      }
      log("Fetched", kalshiTrending.length, "trending Kalshi events");
    } catch (e) {
      log("Failed to fetch trending Kalshi events:", e);
    }
  }

  // Sort by volume and keep top 10 (UI picks a random 2 to display)
  allTrending.sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));
  const result = allTrending.filter(isMarketWithinDisplayPriceCap).slice(0, 10);

  trendingMarketsCache = { markets: result, fetchedAt: now };
  log("Cached", result.length, "trending markets");
  return result;
}

/**
 * Fetch full event data from the Polymarket events API to get clobTokenIds.
 * The search API (optimized=true) strips clobTokenIds, so we need a secondary
 * fetch when the user clicks an outcome for inline trading.
 * Mutates the market in-place to cache the result for subsequent clicks.
 */
async function fetchClobTokenIds(
  market: Market,
  outcomeIndex: number,
  isMultiOutcome: boolean,
  marketIndex?: number
): Promise<string | null> {
  const { log, isExtensionContextValid, safeSendMessage } = window.KNOWW_UTILS;
  const { POLYMARKET_EVENTS_API_URL } = window.KNOWW_CONFIG;

  if (market.source !== "polymarket") return null;
  if (!isExtensionContextValid()) return null;

  const slug = market.slug || market.id;
  if (!slug) return null;

  try {
    const url = `${POLYMARKET_EVENTS_API_URL}?slug=${encodeURIComponent(slug)}`;
    log("Fetching full event data for clobTokenIds:", slug);

    const resp = await safeSendMessage({ type: "fetch-text", url });
    if (!resp?.ok || !("text" in resp) || !resp.text) return null;

    const events = JSON.parse(resp.text) as RawPolymarketEvent[];
    if (!Array.isArray(events) || events.length === 0) return null;

    const fullEvent = events[0];
    if (!fullEvent.markets || fullEvent.markets.length === 0) return null;

    if (market.markets) {
      for (let i = 0; i < market.markets.length; i++) {
        const localMarket = market.markets[i];
        const liveMarket = findMatchingLiveMarket(
          localMarket,
          fullEvent.markets,
          i
        );
        if (liveMarket?.clobTokenIds) {
          (localMarket as Record<string, unknown>).clobTokenIds =
            liveMarket.clobTokenIds;
        }
        if (liveMarket?.conditionId) {
          (localMarket as Record<string, unknown>).conditionId =
            liveMarket.conditionId;
        }
      }
    }

    const idx = marketIndex ?? 0;
    const nestedMarket = findMatchingLiveMarket(
      market.markets?.[idx],
      fullEvent.markets,
      idx
    );
    if (!nestedMarket?.clobTokenIds) return null;
    if (
      nestedMarket.active === false ||
      nestedMarket.closed === true ||
      nestedMarket.acceptingOrders === false
    ) {
      return null;
    }

    const tokenIds = parseGammaStringArray(nestedMarket.clobTokenIds);

    const tokenIndex = isMultiOutcome ? 0 : outcomeIndex;
    if (tokenIds[tokenIndex]) {
      log("Resolved clobTokenId:", tokenIds[tokenIndex]);
      return tokenIds[tokenIndex];
    }
  } catch (e) {
    log("Failed to fetch clobTokenIds:", e);
  }
  return null;
}

// Base API functions (always available)
const KNOWW_API_BASE = {
  // Tag/keyword functions
  fetchPolymarketTags,
  extractMatchingTags,
  extractBasicKeywords,
  extractSearchKeywords,
  extractKeywordsWithAI,
  // Search functions
  searchPolymarketEvents,
  fetchPolymarketEventRefresh,
  resolvePolymarketMarketsFromHints,
  searchAllMarkets,
  // Scoring
  calculateRelevanceScore,
  // Validation
  validateMarketRelevance,
  // Utilities
  deduplicateMarkets,
  // Trending fallback
  fetchTrendingMarkets,
  // Trading data enrichment
  fetchClobTokenIds,
  // Memory optimization
  clearTagsCache,
  getCacheStats,
};

// Test-only functions (only available in DEV_MODE)
const KNOWW_API_DEV = {
  normalizeTitle,
  testDeduplicationLogic,
  calculateTitleSimilarity,
  levenshteinDistance,
};

// Export API functions - conditionally include dev/test functions only in DEV_MODE
export const KNOWW_API = KNOWW_CONFIG.DEV_MODE
  ? { ...KNOWW_API_BASE, ...KNOWW_API_DEV }
  : KNOWW_API_BASE;

window.KNOWW_API = KNOWW_API;
