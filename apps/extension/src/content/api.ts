// ============================================
// API & DATA FUNCTIONS
// ============================================

import type {
  KeywordExtractionResult,
  KeywordRegexEntry,
  Market,
  PolymarketTag,
  PolymarketTagsCache,
} from "../types/market";
import { KNOWW_CONFIG } from "./config";

// Cache for Polymarket tags
let polymarketTagsCache: PolymarketTagsCache | null = null;
let tagsLastFetched = 0;

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
  "just",
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
  "every",
  "going",
  "think",
  "using",
  "weeks",
  "months",
  "years",
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

  if (!isExtensionContextValid()) {
    log("Extension context invalidated, cannot fetch tags");
    return polymarketTagsCache;
  }

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
  }

  return polymarketTagsCache;
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

/**
 * Basic keyword extraction
 * Uses module-scope COMMON_WORDS Set to avoid re-creation on each call.
 */
function extractBasicKeywords(text: string): string {
  if (!text) return "";

  const hashtags = (text.match(/#\w+/g) || [])
    .map((tag) => tag.slice(1))
    .filter((tag) => tag.length > 2)
    .slice(0, 3);

  const capitalizedWords = (text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [])
    .filter((word) => !COMMON_WORDS.has(word.toLowerCase()) && word.length > 2)
    .slice(0, 4);

  const cleanedText = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\w\s]/g, " ");
  const significantWords = cleanedText
    .split(/\s+/)
    .filter((word) => {
      const lower = word.toLowerCase();
      return (
        word.length > 4 && !COMMON_WORDS.has(lower) && !word.match(/^\d+$/)
      );
    })
    .slice(0, 4);

  const allTerms = [...hashtags, ...capitalizedWords, ...significantWords];
  const seen = new Set<string>();
  const uniqueTerms = allTerms.filter((term) => {
    const lower = term.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });

  return uniqueTerms.slice(0, 6).join(" ");
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
    volume?: string | number;
  }>;
  image?: string;
  _source?: string;
  source?: "polymarket" | "kalshi";
}

/**
 * Search Polymarket events
 */
async function searchPolymarketEvents(
  query: string,
  matchedTags: string[] = []
): Promise<Market[]> {
  const { log, isExtensionContextValid, safeSendMessage } = window.KNOWW_UTILS;
  const {
    POLYMARKET_SEARCH_API_URL,
    POLYMARKET_EVENTS_API_URL,
    ENABLED_SOURCES,
  } = window.KNOWW_CONFIG;

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

  const allEvents: Market[] = [];
  const seenIds = new Set<string>();

  // Search by keywords
  if (query.trim()) {
    const searchUrl = `${POLYMARKET_SEARCH_API_URL}?q=${encodeURIComponent(
      query
    )}&cache=true&search_tags=true&optimized=true&limit_per_type=6&events_status=active&keep_closed_markets=0&closed=false`;

    try {
      const searchResp = await safeSendMessage({
        type: "fetch-text",
        url: searchUrl,
      });

      if (searchResp?.ok && "text" in searchResp && searchResp.text) {
        const json = JSON.parse(searchResp.text) as {
          events?: RawPolymarketEvent[];
        };
        const rawCount = json.events?.length || 0;
        let added = 0;
        for (const event of json.events || []) {
          if (event.closed === true || event.active === false) continue;
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id);
            const market: Market = {
              ...event,
              title: event.title || "",
              source: "polymarket",
              _source: "search",
            };
            allEvents.push(market);
            added++;
          }
        }
        log(
          `Polymarket Search API: ${rawCount} raw events, ${added} active for: ${query}`
        );
      } else {
        log(
          "Polymarket Search API: no valid response",
          searchResp?.ok,
          "error" in (searchResp || {})
            ? (searchResp as { error?: string }).error
            : ""
        );
      }
    } catch (e) {
      log("Polymarket Search API error:", e);
    }
  }

  // Search by tags
  if (matchedTags.length > 0 && isExtensionContextValid()) {
    log("Fetching Polymarket events for tags:", matchedTags);

    const tagPromises = matchedTags.slice(0, 2).map(async (tagSlug) => {
      const tagUrl = `${POLYMARKET_EVENTS_API_URL}?tag_slug=${encodeURIComponent(
        tagSlug
      )}&closed=false&archived=false&limit=5&order=volume24hr&ascending=false&optimized=true`;

      try {
        const tagResp = await safeSendMessage({
          type: "fetch-text",
          url: tagUrl,
        });
        if (tagResp?.ok && "text" in tagResp && tagResp.text) {
          const events = JSON.parse(tagResp.text) as RawPolymarketEvent[];
          const list = Array.isArray(events) ? events : [];
          log(`Tag "${tagSlug}": ${list.length} events returned`);
          return list;
        }
        log(
          `Tag "${tagSlug}": no valid response`,
          tagResp?.ok,
          "error" in (tagResp || {})
            ? (tagResp as { error?: string }).error
            : ""
        );
      } catch (e) {
        log("Tag fetch failed for slug:", tagSlug, e);
      }
      return [];
    });

    const tagResults = await Promise.all(tagPromises);
    let tagAdded = 0;
    for (const events of tagResults) {
      for (const event of events) {
        if (event.closed === true || event.active === false) continue;
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          const market: Market = {
            ...event,
            title: event.title || "",
            source: "polymarket",
            _source: "tag",
          };
          allEvents.push(market);
          tagAdded++;
        }
      }
    }
    log(
      `Polymarket tag search: ${tagAdded} active events from ${matchedTags.length} tags`
    );
  }

  // Final filter: ensure no closed or inactive events and sort by volume
  return allEvents
    .filter((event) => event.closed !== true && event.active !== false)
    .sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0))
    .slice(0, 8);
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
  const deduplicatedMarkets = deduplicateMarkets(allMarkets);

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

  console.log("🧪 Running deduplication tests...\n");
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
      console.log(`✅ PASS: ${test.description}`);
    } else {
      failed++;
      console.log(`❌ FAIL: ${test.description}`);
    }
    console.log(`   Title 1: "${test.title1}"`);
    console.log(`   Title 2: "${test.title2}"`);
    console.log(`   Normalized 1: "${norm1}"`);
    console.log(`   Normalized 2: "${norm2}"`);
    console.log(`   Similarity: ${(similarity * 100).toFixed(1)}%`);
    console.log(
      `   Would merge: ${wouldMerge}, Should merge: ${test.shouldMerge}`
    );
    console.log("");
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  return { passed, failed, total: testCases.length };
}

/**
 * Calculate relevance score between post content and market
 */
function calculateRelevanceScore(postTexts: string[], market: Market): number {
  const { STOP_WORDS } = window.KNOWW_UTILS;
  const combinedText = postTexts.join(" ").toLowerCase();
  const marketTitle = (market.title || "").toLowerCase();
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
// TRENDING MARKETS FALLBACK
// Fetches high-volume active markets when feed-based
// discovery takes too long (>10s)
// ============================================

let trendingMarketsCache: { markets: Market[]; fetchedAt: number } | null =
  null;
const TRENDING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch trending/popular markets sorted by 24h volume.
 * Used as a fallback when the notification stack has no
 * feed-discovered markets after a timeout.
 */
async function fetchTrendingMarkets(): Promise<Market[]> {
  const { log, isExtensionContextValid, safeSendMessage } = window.KNOWW_UTILS;
  const { POLYMARKET_EVENTS_API_URL, ENABLED_SOURCES } = window.KNOWW_CONFIG;

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
      const url = `${POLYMARKET_EVENTS_API_URL}?closed=false&archived=false&limit=10&order=volume24hr&ascending=false`;
      const resp = await safeSendMessage({ type: "fetch-text", url });

      if (resp?.ok && "text" in resp && resp.text) {
        const events = JSON.parse(resp.text) as RawPolymarketEvent[];
        const eventList = Array.isArray(events) ? events : [];
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
  const result = allTrending.slice(0, 10);

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
      for (
        let i = 0;
        i < fullEvent.markets.length && i < market.markets.length;
        i++
      ) {
        const src = fullEvent.markets[i];
        if (src?.clobTokenIds && market.markets[i]) {
          (market.markets[i] as Record<string, unknown>).clobTokenIds =
            src.clobTokenIds;
        }
        if (src?.conditionId && market.markets[i]) {
          (market.markets[i] as Record<string, unknown>).conditionId =
            src.conditionId;
        }
      }
    }

    const idx = isMultiOutcome ? (marketIndex ?? 0) : 0;
    const nestedMarket = fullEvent.markets[idx];
    if (!nestedMarket?.clobTokenIds) return null;

    const tokenIds =
      typeof nestedMarket.clobTokenIds === "string"
        ? JSON.parse(nestedMarket.clobTokenIds)
        : nestedMarket.clobTokenIds;

    const tokenIndex = isMultiOutcome ? 0 : outcomeIndex;
    if (Array.isArray(tokenIds) && tokenIds[tokenIndex]) {
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
