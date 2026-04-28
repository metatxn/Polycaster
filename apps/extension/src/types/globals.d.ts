import type { BackgroundResponse } from "./chrome-messages";
import type {
  InjectedMarketEntry,
  KalshiCategoriesCache,
  KalshiKeywordMatcher,
  KeywordExtractionResult,
  Market,
  MarketSearchResult,
  PolymarketTagsCache,
} from "./market";
import type { InjectionPoint, PlatformAdapter } from "./platform";
import type { UserPreferences } from "./preferences";
import type { UserSettings } from "./settings";

interface RelevanceTelemetryCandidate {
  id: string;
  title: string;
  source: "polymarket" | "kalshi" | string;
  hybridScore: number;
  gatePassed: boolean;
  gateReason?: string;
  xencoderScore?: number;
  finalRank?: number;
  shown: boolean;
  validator?: "passed" | "rejected" | "unavailable" | "error";
  feedback?: "good" | "bad";
  feedbackAt?: number;
}

interface RelevanceTelemetryEvent {
  id: string;
  timestamp: number;
  pageUrl: string;
  postKey?: string;
  platform: string;
  sourceTextPreview: string;
  searchQuery: string;
  matchedTags: string[];
  scoringMode: "hybrid" | "lexical" | "heuristic";
  candidates: RelevanceTelemetryCandidate[];
}

interface RelevanceTelemetryFeedback {
  id: string;
  timestamp: number;
  pageUrl: string;
  platform: string;
  postKey?: string;
  marketId: string;
  marketTitle: string;
  source: string;
  feedback: "good" | "bad";
}

interface RelevanceTelemetryExport {
  exportedAt: number;
  pageUrl: string;
  platform: string;
  events: RelevanceTelemetryEvent[];
  feedback: RelevanceTelemetryFeedback[];
}

/**
 * Ethereum provider interface (EIP-1193)
 */
interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    callback: (...args: unknown[]) => void
  ) => void;
  isMetaMask?: boolean;
}

/**
 * NTH Inserter API
 */
interface NthInserterApi {
  htmlToElement: (html: string) => Element | null;
  isOurCard: (el: Element) => boolean;
  insertAfter: (target: Element, nodeToInsert: Element) => void;
  getXSelectors: () => { itemSelector: string; containerSelector: string };
  getLinkedInSelectors: () => {
    itemSelector: string;
    containerSelector: string;
  };
  getQuoraSelectors: () => {
    itemSelector: string;
    containerSelector: string;
  };
  getPlatformSelectors: () => {
    itemSelector: string;
    containerSelector: string;
  };
}

/**
 * Extend the Window interface with Knoww globals
 */
declare global {
  interface Window {
    // Core modules
    KNOWW_CONFIG: {
      DEV_MODE: boolean;
      POLYMARKET_SEARCH_API_URL: string;
      POLYMARKET_TAGS_API_URL: string;
      POLYMARKET_EVENTS_API_URL: string;
      POLYMARKET_EVENTS_KEYSET_API_URL: string;
      KALSHI_BASE_URL: string;
      KALSHI_EVENTS_API_URL: string;
      KALSHI_MARKETS_API_URL: string;
      KALSHI_TAGS_API_URL: string;
      KALSHI_SERIES_API_URL: string;
      KALSHI_SEARCH_API_URL: string;
      KALSHI_WEB_URL: string;
      KNOWW_APP_URL: string;
      ENABLED_SOURCES: {
        polymarket: boolean;
        kalshi: boolean;
      };
      CONFIG: {
        POSTS_TO_ANALYZE: number;
        MIN_RELEVANCE_SCORE: number;
        COOLDOWN_POSTS: number;
        USE_AI_EXTRACTION: boolean;
      };
      TAGS_CACHE_DURATION: number;
      DEFAULT_USER_SETTINGS: UserSettings;
      getUserSettings: () => UserSettings;
      loadUserSettings: () => Promise<UserSettings>;
      isPlatformEnabled: (platformName: string) => boolean;
      isSourceEnabled: (sourceName: string) => boolean;
      isNotificationStackEnabled: () => boolean;
      isUsageAnalyticsEnabled: () => boolean;
      getThemeOverride: () => string;
      isDebugMode: () => boolean;
      onSettingsChange: (callback: (settings: UserSettings) => void) => void;
    };

    KNOWW_ANALYTICS: {
      track: (
        event: string,
        properties?: Record<
          string,
          string | number | boolean | null | undefined
        >
      ) => Promise<void>;
    };

    KNOWW_RELEVANCE_TELEMETRY: {
      record: (
        event: Omit<RelevanceTelemetryEvent, "id" | "timestamp" | "pageUrl">
      ) => void;
      recordFeedback: (input: {
        postKey?: string;
        marketId: string;
        marketTitle: string;
        source: string;
        feedback: "good" | "bad";
      }) => void;
      get: () => RelevanceTelemetryEvent[];
      getFeedback: () => RelevanceTelemetryFeedback[];
      clear: () => void;
      export: () => RelevanceTelemetryExport;
    };

    KNOWW_UTILS: {
      log: (...args: unknown[]) => void;
      isEnglishText: (text: string) => boolean;
      isExtensionContextValid: () => boolean;
      safeSendMessage: (message: unknown) => Promise<BackgroundResponse>;
      extractPostText: (postElement: Element) => string;
      getEventEmoji: (event: Market) => string;
      STOP_WORDS: Set<string>;
      scheduleIdle: (cb: () => void, timeout?: number) => void;
      LRUSet: new (
        maxSize: number
      ) => {
        has: (key: string) => boolean;
        add: (key: string) => void;
        size: number;
        clear: () => void;
      };
    };

    KNOWW_API: {
      fetchPolymarketTags: () => Promise<PolymarketTagsCache | null>;
      extractMatchingTags: (
        text: string,
        tagsData: PolymarketTagsCache
      ) => string[];
      extractBasicKeywords: (text: string) => string;
      extractSearchKeywords: (text: string) => Promise<KeywordExtractionResult>;
      extractKeywordsWithAI: (text: string) => Promise<{
        keywords: string;
        topics: string[];
        entities: string[];
        confidence: number;
      } | null>;
      searchPolymarketEvents: (
        query: string,
        matchedTags?: string[]
      ) => Promise<Market[]>;
      searchAllMarkets: (
        query: string,
        matchedTags?: string[]
      ) => Promise<Market[]>;
      calculateRelevanceScore: (postTexts: string[], market: Market) => number;
      validateMarketRelevance: (
        postText: string,
        market: Market
      ) => Promise<{
        relevant: boolean;
        reason: string;
        confidence: number;
      } | null>;
      deduplicateMarkets: (markets: Market[]) => Market[];
      // Trending fallback
      fetchTrendingMarkets: () => Promise<Market[]>;
      // Trading data enrichment
      fetchClobTokenIds: (
        market: Market,
        outcomeIndex: number,
        isMultiOutcome: boolean,
        marketIndex?: number
      ) => Promise<string | null>;
      // Memory optimization utilities
      clearTagsCache: () => void;
      getCacheStats: () => {
        tagsCount: number;
        tagsCacheAge: number;
        regexCount: number;
      };
      // DEV_MODE only - test utilities (optional, only present when DEV_MODE is true)
      normalizeTitle?: (title: string) => string;
      testDeduplicationLogic?: () => {
        passed: number;
        failed: number;
        total: number;
      } | null;
      calculateTitleSimilarity?: (str1: string, str2: string) => number;
      levenshteinDistance?: (str1: string, str2: string) => number;
    };

    KNOWW_UI: {
      createInlineMarketCard: (
        market: Market,
        score: number,
        topics: string[]
      ) => HTMLElement;
      getMarketEmoji: (market: Market) => string;
      buildMarketUrl: (
        market: Market,
        outcomeIndex?: number,
        side?: string
      ) => string;
      buildKnowwUrl: (
        market: Market,
        outcomeIndex?: number,
        side?: string
      ) => string;
      buildKnowwUrlForOutcome: (
        market: Market,
        outcomeData: unknown,
        side?: string
      ) => string;
      buildKalshiUrl: (market: Market) => string;
      createNotificationStack: () => HTMLElement;
      createNotificationItem: (
        entry: InjectedMarketEntry,
        index: number
      ) => HTMLElement;
      updateNotificationStack: (markets: InjectedMarketEntry[]) => void;
      scrollToMarket: (
        cardRefOrElement: WeakRef<HTMLElement> | HTMLElement | null | undefined,
        marketId: string,
        market?: Market
      ) => void;
      initNotificationStack: () => void;
      fetchAndCacheTrending: () => Promise<void>;
      cancelTrendingFetchTimer: () => void;
      SOURCE_CONFIG: Record<
        string,
        { name: string; color: string; bgColor: string; icon: string }
      >;
    };

    KNOWW_INJECTION: {
      analyzePostAndFindMarket: (post: Element) => Promise<{
        markets: MarketSearchResult[];
        topics: string[];
        postText: string;
      } | null>;
      injectMarketCard: (
        targetPost: Element,
        market: Market,
        score: number,
        topics: string[]
      ) => boolean;
      injectMarketCards: (
        targetPost: Element,
        marketsData: MarketSearchResult[],
        topics: string[]
      ) => boolean;
      processVisiblePosts: (options: { itemSelector: string }) => Promise<void>;
      watchFeed: (containerSelector: string, itemSelector: string) => void;
      getInjectedMarketIds: () => Set<string>;
      getInjectedMarkets: () => InjectedMarketEntry[];
      pruneStaleMarkets: () => void;
      // Memory optimization utilities
      clearProcessedPostsCache: () => void;
      clearInjectedMarketIdsCache: () => void;
      runMemoryCleanup: (force?: boolean) => void;
      startCleanupInterval: () => void;
      stopCleanupInterval: () => void;
      markClicked: (marketId: string) => void;
      restoreTrackedMarket: (postKey: string, marketId: string) => boolean;
      // Stats for debugging
      getMemoryStats: () => {
        processedPostKeys: number;
        injectedMarketIds: number;
        injectedMarkets: number;
        pendingQueue: number;
        totalPostsProcessed: number;
      };
    };

    KNOWW_PLATFORM: {
      registerPlatform: (adapter: PlatformAdapter) => void;
      detectPlatform: () => PlatformAdapter | null;
      getCurrentPlatform: () => PlatformAdapter | null;
      getPlatform: (name: string) => PlatformAdapter | null;
      getRegisteredPlatforms: () => string[];
      isSupportedPlatform: () => boolean;
      getPlatformName: () => string;
      getSelectors: () => { item: string; container: string; text?: string };
      extractPostText: (postElement: Element) => string;
      findInjectionPoint: (postElement: Element) => InjectionPoint | null;
      getCardStyles: () => Record<string, unknown>;
      resetPlatformCache: () => void;
    };

    KNOWW_KALSHI: {
      fetchKalshiCategories: () => Promise<KalshiCategoriesCache | null>;
      buildKalshiKeywordMap: (tagsByCategories: Record<string, string[]>) => {
        keywordMatchers: KalshiKeywordMatcher[];
        keywordMap: Map<string, string>;
      };
      extractMatchingKalshiCategories: (
        text: string,
        categoriesData: KalshiCategoriesCache
      ) => string[];
      normalizeKalshiMarket: (market: unknown) => Market;
      normalizeKalshiEvent: (event: unknown, markets?: unknown[]) => Market;
      normalizeKalshiSeriesResult: (result: unknown) => Market;
      searchKalshiEvents: (
        query: string,
        categories?: string[]
      ) => Promise<Market[]>;
      buildKalshiUrl: (market: Market) => string;
    };

    KNOWW_STYLES: {
      injectInlineStyles: () => void;
      injectMetamaskBridge: () => void;
    };

    KNOWW_PREFERENCES: {
      loadPreferences: () => Promise<UserPreferences>;
      getPreferences: () => UserPreferences;
      recordClick: (market: Market) => void;
      recordIgnore: (market: Market) => void;
      getPreferenceBoost: (market: Market) => number;
      resetPreferences: () => Promise<void>;
    };

    // Platform adapters
    KNOWW_TWITTER: PlatformAdapter;
    KNOWW_LINKEDIN: PlatformAdapter;
    KNOWW_REDDIT: PlatformAdapter;
    KNOWW_QUORA: PlatformAdapter;

    // Settings listeners
    KNOWW_SETTINGS_LISTENERS: Array<(settings: UserSettings) => void>;

    // Injection watcher
    KNOWW_INJECTION_WATCHER?: {
      stop: () => void;
    };

    // Legacy inserter API
    NTH_INSERTER: NthInserterApi;

    // MetaMask bridge flag (legacy)
    __TOI_MM_BRIDGE__?: boolean;

    // Page bridge flag (new structured bridge)
    __KNOWW_BRIDGE__?: boolean;

    // Per-injection nonce shared between content script and page bridge
    __KNOWW_BRIDGE_NONCE__?: string;

    // Ethereum provider (MetaMask)
    ethereum?: EthereumProvider;
  }
}
