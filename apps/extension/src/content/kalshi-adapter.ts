// ============================================
// KALSHI ADAPTER
// Handles Kalshi API calls and data normalization
// ============================================

import type {
  KalshiCategoriesCache,
  KalshiKeywordMatcher,
  Market,
} from "../types/market";

// Extended Kalshi categories cache (internal use with raw data)
interface KalshiCategoriesCacheInternal {
  raw: Record<string, string[]>;
  categories: string[];
  keywordMatchers: KalshiKeywordMatcher[];
  keywordMap: Map<string, string>;
}

// Raw Kalshi market from API
interface RawKalshiMarket {
  ticker?: string;
  event_ticker?: string;
  title?: string;
  subtitle?: string;
  yes_sub_title?: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  liquidity?: number;
  status?: string;
  result?: string;
  created_time?: string;
  open_time?: string;
  close_time?: string;
  expiration_time?: string;
  rules_primary?: string;
  rules_secondary?: string;
  can_close_early?: boolean;
  icon_url_light_mode?: string;
  icon_url_dark_mode?: string;
  image_url?: string;
  background_color_light_mode?: string;
  yes_subtitle?: string;
  no_subtitle?: string;
}

// Raw Kalshi event from API
interface RawKalshiEvent {
  event_ticker?: string;
  series_ticker?: string;
  title?: string;
  sub_title?: string;
  category?: string;
  mutually_exclusive?: boolean;
}

// Raw Kalshi series from v1 search API
interface RawKalshiSeries {
  event_ticker?: string;
  series_ticker?: string;
  event_title?: string;
  series_title?: string;
  event_subtitle?: string;
  category?: string;
  markets?: RawKalshiMarket[];
  total_market_count?: number;
  active_market_count?: number;
  total_volume?: number;
  total_series_volume?: number;
  is_trending?: boolean;
  is_new?: boolean;
  is_closing?: boolean;
  search_score?: number;
  image_url?: string;
  icon_url?: string;
  thumbnail_url?: string;
  event_image_url?: string;
}

// Cache for Kalshi categories/tags
let kalshiCategoriesCache: KalshiCategoriesCacheInternal | null = null;
let kalshiCategoriesLastFetched = 0;

/**
 * Check if a keyword is simple enough for token-based matching
 */
function isSimpleKeyword(keyword: string): boolean {
  return /^[a-z0-9]+$/.test(keyword);
}

/**
 * Fetch and cache Kalshi categories/tags
 */
async function fetchKalshiCategories(): Promise<KalshiCategoriesCache | null> {
  const { log, isExtensionContextValid, safeSendMessage } = window.KNOWW_UTILS;
  const { KALSHI_TAGS_API_URL, TAGS_CACHE_DURATION } = window.KNOWW_CONFIG;
  const now = Date.now();

  // Return cached data if still valid
  if (
    kalshiCategoriesCache &&
    now - kalshiCategoriesLastFetched < TAGS_CACHE_DURATION
  ) {
    return {
      categories: kalshiCategoriesCache.categories.map((c) => ({
        category: c,
      })),
      keywordMatchers: kalshiCategoriesCache.keywordMatchers,
      keywordMap: kalshiCategoriesCache.keywordMap,
    };
  }

  if (!isExtensionContextValid()) {
    log("Extension context invalidated, cannot fetch Kalshi categories");
    return kalshiCategoriesCache
      ? {
          categories: kalshiCategoriesCache.categories.map((c) => ({
            category: c,
          })),
          keywordMatchers: kalshiCategoriesCache.keywordMatchers,
          keywordMap: kalshiCategoriesCache.keywordMap,
        }
      : null;
  }

  try {
    const resp = await safeSendMessage({
      type: "fetch-text",
      url: KALSHI_TAGS_API_URL,
    });

    if (resp?.ok && "text" in resp && resp.text) {
      const data = JSON.parse(resp.text) as {
        tags_by_categories?: Record<string, string[]>;
      };
      const tagsByCategories = data.tags_by_categories || {};

      // Build keyword maps (token + regex)
      const { keywordMatchers, keywordMap } =
        buildKalshiKeywordMap(tagsByCategories);

      kalshiCategoriesCache = {
        raw: tagsByCategories,
        categories: Object.keys(tagsByCategories),
        keywordMatchers,
        keywordMap,
      };
      kalshiCategoriesLastFetched = now;
      log("Cached Kalshi categories:", Object.keys(tagsByCategories).length);
      return {
        categories: kalshiCategoriesCache.categories.map((c) => ({
          category: c,
        })),
        keywordMatchers,
        keywordMap,
      };
    }
  } catch (e) {
    log("Failed to fetch Kalshi categories:", e);
  }

  return kalshiCategoriesCache
    ? {
        categories: kalshiCategoriesCache.categories.map((c) => ({
          category: c,
        })),
        keywordMatchers: kalshiCategoriesCache.keywordMatchers,
        keywordMap: kalshiCategoriesCache.keywordMap,
      }
    : null;
}

/**
 * Build keyword-to-category mapping for Kalshi with precompiled regexes
 */
function buildKalshiKeywordMap(tagsByCategories: Record<string, string[]>): {
  keywordMatchers: KalshiKeywordMatcher[];
  keywordMap: Map<string, string>;
} {
  const keywordToCategory = new Map<string, string>();
  const complexKeywords = new Map<string, string>();

  const addKeyword = (keyword: string, category: string): void => {
    const normalized = keyword.toLowerCase();
    if (!normalized) return;

    if (isSimpleKeyword(normalized)) {
      keywordToCategory.set(normalized, category);
    } else {
      complexKeywords.set(normalized, category);
    }
  };

  // Map each tag to its category
  for (const [category, tags] of Object.entries(tagsByCategories)) {
    if (!tags || !Array.isArray(tags)) continue;

    // Add category itself as a keyword
    addKeyword(category, category);

    for (const tag of tags) {
      if (tag && typeof tag === "string") {
        addKeyword(tag, category);
        // Also add without spaces for compound words
        addKeyword(tag.toLowerCase().replace(/\s+/g, ""), category);
      }
    }
  }

  // Add custom keyword mappings for Kalshi-specific terms
  const customMappings: Record<string, string> = {
    // Crypto
    bitcoin: "Crypto",
    btc: "Crypto",
    ethereum: "Crypto",
    eth: "Crypto",
    solana: "Crypto",
    sol: "Crypto",
    dogecoin: "Crypto",
    doge: "Crypto",
    shiba: "Crypto",

    // Politics
    trump: "Politics",
    biden: "Politics",
    election: "Politics",
    congress: "Politics",
    senate: "Politics",
    scotus: "Politics",
    "supreme court": "Politics",

    // Economics
    fed: "Economics",
    "federal reserve": "Economics",
    inflation: "Economics",
    interest: "Economics",
    gdp: "Economics",
    unemployment: "Economics",
    jobs: "Economics",

    // Sports
    nfl: "Sports",
    nba: "Sports",
    mlb: "Sports",
    nhl: "Sports",
    "super bowl": "Sports",
    football: "Sports",
    basketball: "Sports",
    baseball: "Sports",
    hockey: "Sports",
    soccer: "Sports",
    ufc: "Sports",
    mma: "Sports",
    tennis: "Sports",
    golf: "Sports",

    // Financials
    "s&p": "Financials",
    sp500: "Financials",
    nasdaq: "Financials",
    "dow jones": "Financials",
    stocks: "Financials",
    treasury: "Financials",

    // Climate
    hurricane: "Climate and Weather",
    weather: "Climate and Weather",
    temperature: "Climate and Weather",
    climate: "Climate and Weather",

    // Entertainment
    oscars: "Entertainment",
    grammys: "Entertainment",
    emmys: "Entertainment",
    movies: "Entertainment",
    music: "Entertainment",

    // Tech
    ai: "Science and Technology",
    "artificial intelligence": "Science and Technology",
    openai: "Science and Technology",
    chatgpt: "Science and Technology",
    space: "Science and Technology",
    spacex: "Science and Technology",
    nasa: "Science and Technology",

    // Companies
    apple: "Companies",
    google: "Companies",
    tesla: "Companies",
    amazon: "Companies",
    microsoft: "Companies",
    nvidia: "Companies",
    meta: "Companies",
    "elon musk": "Companies",
    musk: "Companies",
  };

  for (const [keyword, category] of Object.entries(customMappings)) {
    addKeyword(keyword.toLowerCase(), category);
  }

  // Precompile regexes for complex keywords only
  const matchers: KalshiKeywordMatcher[] = [];
  for (const [keyword, category] of complexKeywords) {
    try {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escapedKeyword}\\b`, "i");
      matchers.push({ keyword, category, regex });
    } catch {
      // Invalid regex pattern, skip this keyword
    }
  }

  return { keywordMatchers: matchers, keywordMap: keywordToCategory };
}

/**
 * Extract matching Kalshi categories from text using precompiled matchers
 */
function extractMatchingKalshiCategories(
  text: string,
  categoriesData: KalshiCategoriesCache
): string[] {
  if (!categoriesData) return [];

  const lower = text.toLowerCase();
  const tokenMatchedCategories = new Set<string>();
  const phraseMatchedCategories = new Set<string>();

  // Fast path: token-based lookup for simple keywords
  // Cap at 15 to avoid unnecessary work on long posts while keeping a good selection pool
  if (categoriesData.keywordMap?.size) {
    const tokens = lower.match(/[a-z0-9]+/g) || [];
    for (const token of tokens) {
      const category = categoriesData.keywordMap.get(token);
      if (category) {
        tokenMatchedCategories.add(category);
        if (tokenMatchedCategories.size >= 15) break;
      }
    }
  }

  // Regex pass for complex multi-word keywords (more specific, higher quality)
  // Cap at 10 — phrase matches are prioritized in the final result
  if (categoriesData.keywordMatchers?.length) {
    for (const matcher of categoriesData.keywordMatchers) {
      if (matcher.regex.test(lower)) {
        phraseMatchedCategories.add(matcher.category);
        if (phraseMatchedCategories.size >= 10) break;
      }
    }
  }

  // Prioritize phrase matches, then fill remaining slots with token matches.
  const merged = new Set(phraseMatchedCategories);
  for (const cat of tokenMatchedCategories) merged.add(cat);
  return Array.from(merged).slice(0, 5);
}

/**
 * Normalize a Kalshi market to unified format
 */
function normalizeKalshiMarket(market: unknown): Market {
  const m = market as RawKalshiMarket;
  // Convert cents to decimal (Kalshi uses 0-100 cents, we want 0-1)
  const yesPrice = (m.yes_bid || 0) / 100;
  const noPrice = (m.no_bid || 0) / 100;

  // Extract category from event_ticker (e.g., "KXBTCD-26JAN12" -> "KXBTCD")
  const eventTickerParts = (m.event_ticker || "").split("-");
  const seriesPrefix = eventTickerParts[0] || "";

  // Map series prefix to category
  const categoryMap: Record<string, string> = {
    KXBTC: "Crypto",
    KXETH: "Crypto",
    KXSOL: "Crypto",
    KXDOGE: "Crypto",
    KXNFL: "Sports",
    KXNBA: "Sports",
    KXMLB: "Sports",
    KXNHL: "Sports",
    KXUFC: "Sports",
    KXPRES: "Politics",
    KXSEN: "Politics",
    KXHOUSE: "Politics",
    KXFED: "Economics",
    KXCPI: "Economics",
    KXGDP: "Economics",
    KXSP: "Financials",
    KXNAS: "Financials",
    KXHUR: "Climate and Weather",
    KXTEMP: "Climate and Weather",
  };

  let category = "Other";
  for (const [prefix, cat] of Object.entries(categoryMap)) {
    if (seriesPrefix.startsWith(prefix)) {
      category = cat;
      break;
    }
  }

  return {
    // Identifiers
    id: m.ticker || "",
    source: "kalshi",
    ticker: m.ticker,
    eventTicker: m.event_ticker,

    // Display
    title: m.title || "Untitled Market",
    subtitle: m.subtitle || m.yes_sub_title || "",
    slug: m.ticker,

    // Outcomes (Kalshi is always Yes/No binary)
    outcomes: [
      { id: "yes", title: "Yes", price: yesPrice },
      { id: "no", title: "No", price: noPrice },
    ],

    // Markets (for compatibility with Polymarket format)
    markets: [
      {
        id: m.ticker || "",
        question: m.title,
        conditionId: m.ticker,
        outcomePrices: [yesPrice.toString(), noPrice.toString()],
        volume: m.volume,
        volume24hr: m.volume_24h,
        active: m.status === "active" || m.status === "open",
      },
    ],

    // Volume & Liquidity
    volume: m.volume || 0,
    volume24hr: m.volume_24h || 0,

    // Category & Tags
    category: category,
    tags: [{ slug: category.toLowerCase(), label: category }],

    // Status
    active: m.status === "active" || m.status === "open",
    closed: m.status === "closed" || m.status === "settled",
  };
}

/**
 * Normalize a Kalshi event to unified format
 */
function normalizeKalshiEvent(event: unknown, markets: unknown[] = []): Market {
  const e = event as RawKalshiEvent;
  const normalizedMarkets = markets.map(normalizeKalshiMarket);

  // Calculate total volume from markets
  const totalVolume = normalizedMarkets.reduce(
    (sum, m) => sum + (m.volume24hr || 0),
    0
  );

  // Get the first market's prices for display
  const firstMarket = normalizedMarkets[0];
  const yesPrice = firstMarket?.outcomes?.[0]?.price ?? 0.5;
  const noPrice = firstMarket?.outcomes?.[1]?.price ?? 0.5;

  return {
    // Identifiers
    id: e.event_ticker || "",
    source: "kalshi",
    eventTicker: e.event_ticker,

    // Display
    title: e.title || "Untitled Event",
    subtitle: e.sub_title || "",
    slug: e.event_ticker,

    // Outcomes
    outcomes: [
      { id: "yes", title: "Yes", price: yesPrice },
      { id: "no", title: "No", price: noPrice },
    ],

    // Markets
    markets: normalizedMarkets.map((m) => ({
      id: m.id,
      question: m.title,
      conditionId: m.ticker,
      outcomePrices: m.outcomes?.map((o) => o.price?.toString() || "0"),
      volume: m.volume,
      volume24hr: m.volume24hr,
      active: m.active,
    })),

    // Volume
    volume24hr: totalVolume,

    // Category
    category: e.category || "Other",
    tags: [
      {
        slug: (e.category || "other").toLowerCase(),
        label: e.category || "Other",
      },
    ],

    // Status
    active: true,
    closed: false,
  };
}

/**
 * Normalize a Kalshi series/event from the v1 search API
 */
function normalizeKalshiSeriesResult(result: unknown): Market {
  const series = result as RawKalshiSeries;
  const noop = () => {};
  const { log } = window.KNOWW_UTILS || { log: noop };
  const markets = series.markets || [];
  const firstMarket = markets[0];

  // Debug: Log image-related fields from the API response
  const imageFields = {
    series_image_url: series.image_url,
    series_icon_url: series.icon_url,
    market_icon_light: firstMarket?.icon_url_light_mode,
    market_icon_dark: firstMarket?.icon_url_dark_mode,
    series_thumbnail: series.thumbnail_url,
    event_image: series.event_image_url,
  };
  log("🔍 Kalshi image fields:", imageFields);

  // Convert cents to decimal (Kalshi uses 0-100 cents)
  const yesPrice = (firstMarket?.yes_bid || 50) / 100;
  const noPrice = 1 - yesPrice;
  const lastPrice = (firstMarket?.last_price || 50) / 100;

  // Normalize all markets in the series
  const normalizedMarkets = markets.map((m) => ({
    id: m.ticker || "",
    question: m.title,
    conditionId: m.ticker,
    ticker: m.ticker,
    outcomePrices: [
      ((m.yes_bid || 50) / 100).toString(),
      ((100 - (m.yes_bid || 50)) / 100).toString(),
    ],
    volume: 0,
    volume24hr: 0,
    active: true,
    groupItemTitle: m.yes_subtitle || m.title || "",
  }));

  return {
    // Identifiers
    id: series.event_ticker || "",
    source: "kalshi",
    ticker: firstMarket?.ticker || series.event_ticker,
    eventTicker: series.event_ticker,

    // Display
    title: series.event_title || series.series_title || "Untitled Event",
    subtitle: series.event_subtitle || "",
    slug: series.event_ticker,

    // Outcomes
    outcomes: [
      { id: "yes", title: "Yes", price: yesPrice },
      { id: "no", title: "No", price: noPrice },
    ],

    // Markets
    markets: normalizedMarkets,

    // Volume & Liquidity
    volume: series.total_volume || 0,
    volume24hr: series.total_volume || 0,

    // Category & Tags
    category: series.category || "Other",
    tags: [
      {
        slug: (series.category || "other").toLowerCase(),
        label: series.category || "Other",
      },
    ],

    // Status flags
    active: (series.active_market_count || 0) > 0,

    // Visual - try multiple possible image field names from Kalshi API
    image:
      series.image_url ||
      series.icon_url ||
      series.thumbnail_url ||
      series.event_image_url ||
      firstMarket?.icon_url_light_mode ||
      firstMarket?.icon_url_dark_mode ||
      firstMarket?.image_url ||
      undefined,

    // Additional metadata
    _kalshiSearchScore: series.search_score,
    _kalshiLastPrice: lastPrice,
  };
}

/**
 * Check if a Kalshi market title is relevant to the search query
 */
function isKalshiResultRelevant(title: string, query: string): boolean {
  if (!title || !query) return false;

  const { STOP_WORDS } = window.KNOWW_UTILS;
  const titleLower = title.toLowerCase();
  const queryLower = query.toLowerCase();

  // Extract significant words (3+ chars, not common words)
  const queryWords = queryLower
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  // If no significant words remain after filtering (e.g., query was "the new year"),
  // trust the upstream Kalshi API's relevance scoring and allow all results through.
  // Returning false here would incorrectly reject valid results for queries like "new year".
  if (queryWords.length === 0) return true;

  // Check if at least one significant query word appears in the title
  const matchCount = queryWords.filter((word) =>
    titleLower.includes(word)
  ).length;

  // Require at least 1 word match, or 30% of query words for longer queries
  const minMatches = Math.max(1, Math.floor(queryWords.length * 0.3));

  return matchCount >= minMatches;
}

/**
 * Search Kalshi events/markets using the v1 search API
 */
async function searchKalshiEvents(
  query: string,
  categories: string[] = []
): Promise<Market[]> {
  const { log, isExtensionContextValid, safeSendMessage } = window.KNOWW_UTILS;
  const { KALSHI_SEARCH_API_URL, ENABLED_SOURCES } = window.KNOWW_CONFIG;

  // Check if Kalshi is enabled
  if (!ENABLED_SOURCES?.kalshi) {
    log("Kalshi source is disabled");
    return [];
  }

  if (!query.trim() && categories.length === 0) {
    log("Kalshi search: no query or categories provided");
    return [];
  }

  if (!isExtensionContextValid()) {
    log("Extension context invalidated, cannot search Kalshi");
    return [];
  }

  const allResults: Market[] = [];
  const seenTickers = new Set<string>();

  // Use the v1 search API (same as Kalshi platform uses)
  const searchQuery = query.trim() || categories.join(" ");

  try {
    const params = new URLSearchParams({
      query: searchQuery,
      order_by: "querymatch",
      page_size: "15",
      fuzzy_threshold: "4",
      with_milestones: "true",
    });

    const url = `${KALSHI_SEARCH_API_URL}?${params.toString()}`;
    log("Kalshi search URL:", url);

    const resp = await safeSendMessage({ type: "fetch-text", url });

    if (resp?.ok && "text" in resp && resp.text) {
      const data = JSON.parse(resp.text) as {
        current_page?: RawKalshiSeries[];
        total_results_count?: number;
      };
      const series = data.current_page || [];

      log(
        `🟠 Kalshi API response: ${series.length} series (total: ${data.total_results_count})`
      );

      let skippedNoActive = 0;
      let skippedDuplicate = 0;
      let skippedIrrelevant = 0;

      for (const item of series) {
        // Skip if we've already seen this event
        if (item.event_ticker && seenTickers.has(item.event_ticker)) {
          skippedDuplicate++;
          continue;
        }
        if (item.event_ticker) {
          seenTickers.add(item.event_ticker);
        }

        // Skip series with no active markets
        if (item.active_market_count === 0) {
          skippedNoActive++;
          continue;
        }

        // Check if the result is actually relevant to the query
        const title = item.event_title || item.series_title || "";
        if (!isKalshiResultRelevant(title, searchQuery)) {
          skippedIrrelevant++;
          log(`  ⏭️ Skipping irrelevant: "${title.slice(0, 40)}..."`);
          continue;
        }

        const normalized = normalizeKalshiSeriesResult(item);
        allResults.push(normalized);

        // Debug: Log each normalized result
        log(
          `  🟠 Kalshi: "${normalized.title?.slice(0, 50)}" (id: ${
            normalized.id
          }, source: ${normalized.source})`
        );
      }

      if (
        skippedNoActive > 0 ||
        skippedDuplicate > 0 ||
        skippedIrrelevant > 0
      ) {
        log(
          `  Skipped: ${skippedNoActive} no active, ${skippedDuplicate} duplicates, ${skippedIrrelevant} irrelevant`
        );
      }
    } else {
      log(
        "❌ Kalshi search failed:",
        resp && "error" in resp ? resp.error : "unknown error"
      );
    }
  } catch (e) {
    log("Kalshi search error:", e);
  }

  // Sort by search score
  allResults.sort((a, b) => {
    const scoreA =
      (a as Market & { _kalshiSearchScore?: number })._kalshiSearchScore || 0;
    const scoreB =
      (b as Market & { _kalshiSearchScore?: number })._kalshiSearchScore || 0;
    return scoreB - scoreA;
  });

  log(`Kalshi returning ${allResults.length} results`);
  return allResults.slice(0, 10);
}

/**
 * Build Kalshi market URL
 */
function buildKalshiUrl(market: Market): string {
  const { KALSHI_WEB_URL } = window.KNOWW_CONFIG;
  const baseUrl = KALSHI_WEB_URL || "https://kalshi.com";

  // Kalshi URL format: https://kalshi.com/markets/{ticker}
  // or for events: https://kalshi.com/events/{event_ticker}
  if (market.eventTicker) {
    return `${baseUrl}/events/${market.eventTicker}`;
  }

  return `${baseUrl}/markets/${market.ticker || market.id}`;
}

// Export Kalshi adapter functions
export const KNOWW_KALSHI = {
  fetchKalshiCategories,
  buildKalshiKeywordMap,
  extractMatchingKalshiCategories,
  normalizeKalshiMarket,
  normalizeKalshiEvent,
  normalizeKalshiSeriesResult,
  searchKalshiEvents,
  buildKalshiUrl,
};

window.KNOWW_KALSHI = KNOWW_KALSHI;
