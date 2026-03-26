import type { UserSettings } from "./settings";
import type {
  Market,
  PolymarketTagsCache,
  KalshiCategoriesCache,
  KalshiKeywordMatcher,
  KeywordExtractionResult,
  MarketSearchResult,
  InjectedMarketEntry,
} from "./market";
import type { BackgroundResponse } from "./chrome-messages";
import type { PlatformAdapter, InjectionPoint } from "./platform";
import type { UserPreferences } from "./preferences";

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
        MIN_AI_CONFIDENCE: number;
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
      getThemeOverride: () => string;
      isDebugMode: () => boolean;
      onSettingsChange: (callback: (settings: UserSettings) => void) => void;
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
