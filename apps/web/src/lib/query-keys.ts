/**
 * Centralized query-key factory for TanStack Query.
 *
 * Every hook reads/writes the cache through these helpers instead of
 * hand-rolling string tuples. The benefits:
 *
 *  - **One spelling per concept.** No more `"openOrders"` vs
 *    `"open-orders"` drift across hooks.
 *  - **Hierarchical invalidation for free.** `qk.orders.all()` is a
 *    prefix of every more-specific orders key, so
 *    `invalidateQueries({ queryKey: qk.orders.all() })` clears the
 *    whole subtree without touching unrelated caches.
 *  - **Type-safe call sites.** Each helper returns `as const`, so
 *    `setQueryData(qk.proxy.byOwner(addr), ...)` keeps its tuple shape
 *    visible to the type checker.
 *
 * The convention is kebab-case for the top-level domain, then
 * progressively narrower path segments. Parameters always come last
 * in the tuple. Optional parameters get their own narrower factory
 * (e.g. `orders.list` vs `orders.all`).
 */

export const qk = {
  // Markets list, "the book", trending/breaking/new ribbons.
  events: {
    all: () => ["events"] as const,
    list: (params: unknown) => ["events", "list", params] as const,
    detail: (slugOrId: string) => ["events", "detail", slugOrId] as const,
    paginated: (params: unknown) => ["events", "paginated", params] as const,
    trending: (limit: number, fullMarkets: boolean, filters: unknown) =>
      ["trending-events", limit, fullMarkets, filters] as const,
    breaking: (limit: number, fullMarkets: boolean, filters: unknown) =>
      ["breaking-events", limit, fullMarkets, filters] as const,
    new: (limit: number, fullMarkets: boolean, filters: unknown) =>
      ["new-events", limit, fullMarkets, filters] as const,
    filtered: (serverParams: unknown, volumeWindow: unknown) =>
      ["filtered-events", serverParams, volumeWindow] as const,
  },

  // A single market or event detail page.
  market: {
    all: () => ["markets"] as const,
    bySlug: (slug: string) => ["market-detail", slug] as const,
    priceHistoryBatch: (
      tokenIds: readonly string[],
      lookbackDays: number,
      fidelity: number
    ) => ["price-history-batch", tokenIds, lookbackDays, fidelity] as const,
  },

  // Tag metadata + tag-scoped market lists.
  tags: {
    all: () => ["tags"] as const,
    details: (slug: string) => ["tag", "details", slug] as const,
    markets: (slug: string, options: unknown) =>
      ["markets-by-tag", slug, options] as const,
  },

  // Sports-specific surfaces.
  sports: {
    list: () => ["sports-list"] as const,
    bySport: (sportTag: string) => ["sports-markets", sportTag] as const,
    teams: (params: unknown) => ["teams", params] as const,
  },

  // User-owned data: positions, orders, P&L.
  orders: {
    all: () => ["openOrders"] as const,
    list: (userAddress: string, market?: string) =>
      ["openOrders", userAddress, market] as const,
  },
  positions: {
    all: () => ["userPositions"] as const,
    list: (
      userAddress: string | undefined,
      options: {
        limit?: number;
        offset?: number;
        market?: string;
        active?: boolean;
      }
    ) =>
      [
        "userPositions",
        userAddress,
        options.limit,
        options.offset,
        options.market,
        options.active,
      ] as const,
    forMarket: (userAddress: string, marketId: string) =>
      ["marketPositions", userAddress, marketId] as const,
  },
  pnl: {
    summary: (userAddress: string) => ["userPnLSummary", userAddress] as const,
    user: (userAddress: string, period: string, includeHistory: boolean) =>
      ["userPnL", userAddress, period, includeHistory] as const,
    history: (userAddress: string, interval: string, fidelity: string) =>
      ["pnlHistory", userAddress, interval, fidelity] as const,
  },

  // Wallets, balances, exchange rates.
  wallet: {
    /** Prefix for ANY usdcBalance subkey — use with `invalidateQueries`. */
    allUsdcBalances: () => ["usdcBalance"] as const,
    tokens: (address: string) => ["wallet-tokens", address] as const,
    usdcBalance: (address: string) => ["usdcBalance", address] as const,
    portfolioValue: (address: string) => ["portfolio-value", address] as const,
    polPrice: () => ["pol-price"] as const,
  },

  // Profiles & social.
  profile: {
    trader: (address: string) => ["traderProfile", address] as const,
    public: (address: string) => ["publicProfile", address] as const,
    topHolders: (marketId: string) => ["topHolders", marketId] as const,
  },

  // Comments — the threaded discussion under an event/market.
  comments: (
    entityType: string,
    entityId: string | number | undefined,
    options: {
      limit: number;
      order: string;
      ascending: boolean;
      holdersOnly: boolean | undefined;
      getReports: boolean;
    }
  ) => ["comments", entityType, entityId, options] as const,

  // Search results (debounced query).
  search: (query: string, limit: number, tagSlug: string | null) =>
    ["search", query, limit, tagSlug] as const,

  // Order book — feeds the trade ticket.
  orderBook: (tokenId: string) => ["orderBook", tokenId] as const,

  // Whale tape + insider detector.
  whales: {
    activity: (params: unknown) => ["whaleActivity", params] as const,
    insiders: (params: unknown) => ["insiderActivity", params] as const,
  },

  // Leaderboard (paginated, category-scoped).
  leaderboard: (params: {
    category: string;
    timePeriod: string;
    orderBy: string;
    limit: number;
    offset: number;
    user?: string;
    userName?: string;
  }) =>
    [
      "leaderboard",
      params.category,
      params.timePeriod,
      params.orderBy,
      params.limit,
      params.offset,
      params.user,
      params.userName,
    ] as const,

  // User account metadata (proxy wallet linkage, profile fields).
  user: {
    details: (address: string | undefined, options: unknown) =>
      ["userDetails", address, options] as const,
    trades: (
      userAddress: string | undefined,
      options: {
        limit?: number;
        offset?: number;
        market?: string;
        type?: string;
        startDate?: string;
        endDate?: string;
      }
    ) =>
      [
        "userTrades",
        userAddress,
        options.limit,
        options.offset,
        options.market,
        options.type,
        options.startDate,
        options.endDate,
      ] as const,
    tradesInfinite: (
      address: string | undefined,
      pageSize: number,
      options: {
        market?: string;
        type?: string;
        startDate?: string;
        endDate?: string;
      }
    ) =>
      [
        "userTradesInfinite",
        address,
        pageSize,
        options.market,
        options.type,
        options.startDate,
        options.endDate,
      ] as const,
  },

  // Proxy wallet resolution — `mode` switches between safe-lookup and
  // deposit-side resolution.
  proxyWallet: {
    /** Prefix for any proxy-wallet subkey. */
    all: () => ["proxy-wallet"] as const,
    byAddress: (address: string | null | undefined) =>
      ["proxy-wallet", address ?? null] as const,
    byAddressMode: (address: string | null | undefined, mode: string) =>
      ["proxy-wallet", address ?? null, mode] as const,
  },

  // Cross-chain bridge metadata.
  bridge: {
    supportedAssets: () => ["bridge-supported-assets"] as const,
    depositAddresses: (proxyAddress: string) =>
      ["bridge-deposit-addresses", proxyAddress] as const,
  },

  // External price feeds (used by deposit / withdraw amount UI).
  tokenPrices: () => ["token-prices"] as const,
} as const;

export type QueryKey = ReturnType<
  | typeof qk.events.all
  | typeof qk.events.trending
  | typeof qk.market.all
  | typeof qk.market.bySlug
  | typeof qk.tags.all
  | typeof qk.orders.all
  | typeof qk.orders.list
  | typeof qk.positions.all
  | typeof qk.pnl.summary
  | typeof qk.wallet.tokens
  | typeof qk.profile.trader
>;
