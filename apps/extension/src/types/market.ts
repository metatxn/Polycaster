/**
 * Market tag interface
 */
export interface Tag {
  slug?: string;
  label?: string;
}

/**
 * Polymarket tag from API response
 * Example: {"id":"103166","label":"NEH","slug":"neh","createdAt":"2026-01-16T01:57:15.202417Z","updatedAt":"2026-01-16T19:20:18.713107Z","requiresTranslation":false}
 */
export interface PolymarketTag {
  id?: string;
  slug?: string;
  label?: string;
  createdAt?: string;
  updatedAt?: string;
  requiresTranslation?: boolean;
}

/**
 * Market outcome interface
 */
export interface Outcome {
  id?: string;
  title?: string;
  name?: string;
  price?: number;
  outcomePrices?: string;
}

/**
 * Polymarket nested market from search API response
 * Example from /public-search API
 */
export interface PolymarketNestedMarket {
  active?: boolean;
  archived?: boolean;
  bestAsk?: number;
  bestBid?: number;
  closed?: boolean;
  groupItemTitle?: string;
  lastTradePrice?: number;
  outcomePrices?: string[];
  outcomes?: string[];
  question?: string;
  slug?: string;
  spread?: number;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  neg_risk?: boolean;
  enable_neg_risk?: boolean;
}

/**
 * Polymarket event from search API response
 * Example from /public-search API
 */
export interface PolymarketSearchEvent {
  id: string;
  active?: boolean;
  archived?: boolean;
  closed?: boolean;
  endDate?: string;
  ended?: boolean;
  image?: string;
  markets?: PolymarketNestedMarket[];
  slug?: string;
  title?: string;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  description?: string;
  startDate?: string;
  tags?: Tag[];
  _source?: "search" | "tag";
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  neg_risk?: boolean;
  enable_neg_risk?: boolean;
}

/**
 * Polymarket search API response
 */
export interface PolymarketSearchResponse {
  events?: PolymarketSearchEvent[];
  markets?: PolymarketSearchEvent[];
}

/**
 * Kalshi market from search API response
 * Example from /v1/search/series API
 */
export interface KalshiSearchMarket {
  ticker: string;
  yes_subtitle?: string;
  no_subtitle?: string;
  yes_bid?: number;
  yes_ask?: number;
  last_price?: number;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price_dollars?: string;
  price_delta?: number;
  close_ts?: string;
  expected_expiration_ts?: string;
  open_ts?: string;
  rulebook_variables?: Record<string, unknown>;
  result?: string;
  custom_strike?: Record<string, string>;
  score?: number;
  market_id?: string;
  title?: string;
  potential_payout_from_100_dollars?: {
    yes: string;
    no: string;
  };
  image_url_dark_mode?: string;
  image_url_light_mode?: string;
  background_color_light_mode?: string;
  background_color_dark_mode?: string;
  image_scale?: number;
  structured_target_id?: string;
  previous_price?: number;
  previous_price_dollars?: string;
}

/**
 * Kalshi product metadata
 */
export interface KalshiProductMetadata {
  "1v1_title"?: string;
  categories?: string[];
  competition?: string;
  competition_scope?: string;
  custom_image_url?: string;
  league?: string;
  metadata_structure?: string;
  promoted_milestone_id?: string;
  scope?: string;
  subcategories?: Record<string, string[]>;
  live_title?: string;
  live_title_competition_specific?: string;
}

/**
 * Kalshi series/event from search API response
 * Example from /v1/search/series API
 */
export interface KalshiSearchSeries {
  series_ticker: string;
  series_title?: string;
  event_ticker: string;
  event_subtitle?: string;
  event_title?: string;
  category?: string;
  product_metadata?: KalshiProductMetadata;
  product_metadata_derived?: {
    competition?: string;
    general_title_super?: string;
    live_title?: string;
    live_title_competition_specific?: string;
    order_panel_title?: string;
    trading_page_title?: string;
    trading_page_title_super?: string;
  };
  total_series_volume?: number;
  total_volume?: number;
  total_market_count?: number;
  active_market_count?: number;
  markets?: KalshiSearchMarket[];
  is_trending?: boolean;
  is_new?: boolean;
  is_closing?: boolean;
  is_price_delta?: boolean;
  search_score?: number;
  fee_type?: string;
  fee_multiplier?: number;
  general_title_super?: string;
  milestone_id?: string;
}

/**
 * Kalshi search API response
 */
export interface KalshiSearchResponse {
  total_results_count: number;
  current_page: KalshiSearchSeries[];
}

/**
 * Nested market interface (for multi-outcome events)
 * Unified for both Polymarket and Kalshi
 */
export interface NestedMarket {
  id?: string;
  question?: string;
  outcomePrices?: string | string[] | number[];
  volume?: string | number;
  volume24hr?: number;
  clobTokenIds?: string;
  conditionId?: string;
  ticker?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  groupItemTitle?: string;
  outcomes?: string[];
  // Kalshi-specific nested market fields
  yes_subtitle?: string;
  no_subtitle?: string;
  yes_bid?: number;
  yes_ask?: number;
  last_price?: number;
  image_url_dark_mode?: string;
  image_url_light_mode?: string;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  neg_risk?: boolean;
  enable_neg_risk?: boolean;
}

/**
 * Unified market interface that works for both Polymarket and Kalshi
 * This is the normalized format used internally by the extension
 */
export interface Market {
  // Required identifiers
  id: string;
  title: string;
  source: "polymarket" | "kalshi";

  // Common optional fields
  slug?: string;
  image?: string;
  volume?: number;
  volume24hr?: number;
  outcomes?: Outcome[];
  tags?: Tag[];
  closed?: boolean;
  active?: boolean;
  markets?: NestedMarket[];

  // Polymarket-specific
  description?: string;
  startDate?: string;
  endDate?: string;
  liquidity?: number;
  _source?: "search" | "tag";
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  neg_risk?: boolean;
  enable_neg_risk?: boolean;

  // Kalshi-specific
  ticker?: string;
  eventTicker?: string;
  category?: string;
  subtitle?: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  open_interest?: number;
  status?: string;

  // Internal tracking fields
  _kalshiSearchScore?: number;
  _kalshiLastPrice?: number;
  _contextReason?: string;
  _aiConfidence?: number;

  // Allow additional properties for API responses
  [key: string]: unknown;
}

/**
 * Search result with relevance score
 */
export interface MarketSearchResult {
  market: Market;
  score: number;
  source: "polymarket" | "kalshi";
}

/**
 * Precompiled keyword regex entry for efficient tag matching
 */
export interface KeywordRegexEntry {
  regex: RegExp;
  tagSlug: string;
}

/**
 * Polymarket tags cache structure
 * MEMORY: Only stores derived maps needed for matching.
 * slugs/labels Sets were removed as they were never used after map construction.
 */
export interface PolymarketTagsCache {
  list: PolymarketTag[];
  keywordMap: Map<string, string>;
  /** Precompiled regex map for efficient tag extraction */
  keywordRegexMap: Map<string, KeywordRegexEntry>;
}

/**
 * Kalshi keyword matcher with precompiled regex
 */
export interface KalshiKeywordMatcher {
  keyword: string;
  category: string;
  regex: RegExp;
}

/**
 * Kalshi categories cache structure
 */
export interface KalshiCategoriesCache {
  categories: KalshiCategory[];
  keywordMatchers: KalshiKeywordMatcher[];
  /** Fast token-based lookup for simple keywords */
  keywordMap?: Map<string, string>;
}

/**
 * Kalshi category
 */
export interface KalshiCategory {
  category: string;
  subcategory?: string;
  tags?: string[];
}

/**
 * Keyword extraction result
 */
export interface KeywordExtractionResult {
  keywords: string;
  matchedTags: string[];
  entities?: string[];
  confidence?: number;
  source: "ai" | "rules" | "none";
}

/**
 * Injected market tracking entry
 */
export interface InjectedMarketEntry {
  market: Market;
  cardRef: WeakRef<HTMLElement> | { deref: () => HTMLElement | undefined };
  postKey?: string;
  timestamp: number;
  isInViewport?: boolean;
  lastVisibleAt?: number;
}
