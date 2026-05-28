"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, TrendingUp, X } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ChromeHeader } from "@/components/app-layout";
import { Navbar } from "@/components/navbar";
import { ProductFooter } from "@/components/product-footer";
import { ProductHero } from "@/components/product-hero";
import { type SearchEvent, useSearch } from "@/hooks/use-search";
import { formatVolume } from "@/lib/formatters";

// Custom hook for debouncing values
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Recent searches stored in localStorage
const RECENT_SEARCHES_KEY = "knoww-recent-searches";
const MAX_RECENT_SEARCHES = 5;

// Last searched markets stored in localStorage
const LAST_SEARCH_MARKETS_KEY = "KNOWW_USER_LAST_SEARCH_MARKET";
const MAX_LAST_MARKETS = 4;

interface LastSearchedMarket {
  id: string;
  slug: string;
  title: string;
  image?: string;
  volume24hr?: number;
  liquidity?: number;
  live?: boolean;
}

function getLastSearchedMarkets(): LastSearchedMarket[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(LAST_SEARCH_MARKETS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addLastSearchedMarket(market: LastSearchedMarket) {
  if (typeof window === "undefined" || !market.id) return;
  try {
    const recent = getLastSearchedMarkets();
    // Remove if already exists (to move to front)
    const filtered = recent.filter((m) => m.id !== market.id);
    const updated = [market, ...filtered].slice(0, MAX_LAST_MARKETS);
    localStorage.setItem(LAST_SEARCH_MARKETS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addRecentSearch(query: string) {
  if (typeof window === "undefined" || !query.trim()) return;
  try {
    const recent = getRecentSearches();
    const filtered = recent.filter(
      (s) => s.toLowerCase() !== query.toLowerCase()
    );
    const updated = [query, ...filtered].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

function removeRecentSearch(query: string) {
  if (typeof window === "undefined") return;
  try {
    const recent = getRecentSearches();
    const updated = recent.filter(
      (s) => s.toLowerCase() !== query.toLowerCase()
    );
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [query, setQuery] = useState(initialQuery);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [lastSearchedMarkets, setLastSearchedMarkets] = useState<
    LastSearchedMarket[]
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load recent searches and last searched markets on mount
  useEffect(() => {
    setRecentSearches(getRecentSearches());
    setLastSearchedMarkets(getLastSearchedMarkets());
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce the search query by 300ms
  const debouncedQuery = useDebouncedValue(query, 300);

  // Use debounced query for API calls
  const { data, isLoading } = useSearch(debouncedQuery, 20);

  // Show loading state while typing (before debounce completes)
  const isTyping = query !== debouncedQuery && query.length >= 2;

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
    },
    []
  );

  const handleClear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  const handleEventClick = useCallback(
    (event: SearchEvent) => {
      if (query.trim()) {
        addRecentSearch(query.trim());
      }
      // Save to last searched markets
      addLastSearchedMarket({
        id: event.id,
        slug: event.slug || event.id,
        title: event.title,
        image: event.image,
        volume24hr: event.volume24hr,
        liquidity: event.liquidity,
        live: event.live,
      });
      posthog.capture("market_search_result_clicked", {
        search_query: query.trim(),
        event_id: event.id,
        event_slug: event.slug || event.id,
        event_title: event.title,
        result_type: "market",
      });
      router.push(`/events/detail/${event.slug || event.id}`);
    },
    [router, query]
  );

  const handleLastMarketClick = useCallback(
    (market: LastSearchedMarket) => {
      router.push(`/events/detail/${market.slug}`);
    },
    [router]
  );

  const handleTagClick = useCallback(
    (slug: string) => {
      if (query.trim()) {
        addRecentSearch(query.trim());
      }
      router.push(`/events/${slug}`);
    },
    [router, query]
  );

  const handleRecentSearchClick = useCallback((searchQuery: string) => {
    setQuery(searchQuery);
  }, []);

  const handleRemoveRecentSearch = useCallback((searchQuery: string) => {
    removeRecentSearch(searchQuery);
    setRecentSearches(getRecentSearches());
  }, []);

  const hasResults =
    (data?.events && data.events.length > 0) ||
    (data?.tags && data.tags.length > 0);

  const showResults = query.length >= 2;
  const showRecentSearches = !showResults && recentSearches.length > 0;
  const showLastSearchedMarkets =
    !showResults && lastSearchedMarkets.length > 0;

  return (
    <div className="kw-app min-h-screen bg-(--kwm-bg) relative overflow-x-hidden selection:bg-(--kwm-ink)/15">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-24">
        <div className="max-w-4xl mx-auto">
          <ProductHero
            breadcrumbs={[
              { label: "Markets", href: "/markets" },
              { label: "Search" },
            ]}
          />

          {/* Search Input — DeFi terminal field with mono caret */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mb-10"
          >
            <label
              htmlFor="search-input"
              className="block font-mono text-[10px] uppercase tracking-[0.14em] mb-2"
              style={{ color: "var(--kwm-ink-3)" }}
            >
              Query
            </label>
            <div className="relative max-w-2xl">
              <input
                id="search-input"
                ref={inputRef}
                type="text"
                placeholder="An event, a candidate, a ticker…"
                value={query}
                onChange={handleInputChange}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md px-3 h-10 pr-10 text-[14px] focus:outline-none focus:ring-1 transition-colors"
                style={{
                  background: "var(--kwm-bg-2)",
                  border: "1px solid var(--kwm-hl-2)",
                  color: "var(--kwm-ink)",
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  aria-label="Clear search"
                  className="absolute right-0 bottom-3 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </motion.div>

          {/* Last Searched Markets */}
          <AnimatePresence mode="wait">
            {showLastSearchedMarkets && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-8"
              >
                <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-3">
                  §&nbsp;&nbsp;Recently Viewed
                </h2>
                <div className="border-t border-border/40">
                  {lastSearchedMarkets.map((market, index) => (
                    <motion.button
                      key={market.id}
                      type="button"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      onClick={() => handleLastMarketClick(market)}
                      className="group w-full flex items-center gap-4 py-3 border-b border-border/40 text-left hover:bg-muted/30 transition-colors"
                    >
                      {market.image ? (
                        <div className="relative w-11 h-11 rounded-sm overflow-hidden shrink-0 bg-muted border border-border/60">
                          <Image
                            src={market.image}
                            alt={market.title}
                            fill
                            sizes="44px"
                            className="object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-11 h-11 rounded-sm bg-muted flex items-center justify-center shrink-0 border border-border/60">
                          <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm line-clamp-1 leading-snug text-foreground group-hover:text-foreground transition-colors">
                          {market.title}
                        </p>
                        <div className="flex items-center gap-4 mt-0.5">
                          {market.volume24hr && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                              {formatVolume(market.volume24hr)} · 24h
                            </span>
                          )}
                          {market.live && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500/75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                              </span>
                              Live
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recent Searches */}
          <AnimatePresence mode="wait">
            {showRecentSearches && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-3">
                  §&nbsp;&nbsp;Recent Searches
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {recentSearches.map((search) => (
                    <div
                      key={search}
                      className="group inline-flex items-center gap-1.5 py-1 text-muted-foreground"
                    >
                      <button
                        type="button"
                        onClick={() => handleRecentSearchClick(search)}
                        className="text-sm hover:text-foreground transition-colors"
                      >
                        {search}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveRecentSearch(search)}
                        className="p-0.5 opacity-40 group-hover:opacity-80 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search Results */}
          <AnimatePresence mode="wait">
            {showResults && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {/* Loading State — row-shaped shimmer matching result geometry */}
                {(isLoading || isTyping) && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-3">
                      §&nbsp;&nbsp;Searching
                    </p>
                    <div className="border-t border-border/40">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="flex items-center gap-4 py-3 border-b border-border/40"
                        >
                          <div className="w-11 h-11 rounded-sm bg-muted-foreground/10 animate-pulse shrink-0" />
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="h-4 w-2/3 rounded bg-muted-foreground/10 animate-pulse" />
                            <div className="h-3 w-1/3 rounded bg-muted-foreground/10 animate-pulse" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No Results */}
                {!isLoading && !isTyping && !hasResults && (
                  <div
                    className="py-10 border-y"
                    style={{ borderColor: "var(--kwm-hl)" }}
                  >
                    <p
                      className="font-mono text-[10px] uppercase tracking-[0.14em] mb-2"
                      style={{ color: "var(--kwm-ink-3)" }}
                    >
                      No matches
                    </p>
                    <p
                      className="text-[14px] leading-snug max-w-md"
                      style={{ color: "var(--kwm-ink)" }}
                    >
                      Nothing on Polymarket matches "{query}". Try a different
                      term or browse by category.
                    </p>
                  </div>
                )}

                {/* Results */}
                {!isLoading && !isTyping && hasResults && (
                  <div className="space-y-8">
                    {/* Tags Section */}
                    {data?.tags && data.tags.length > 0 && (
                      <div>
                        <div className="flex items-baseline justify-between mb-3">
                          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                            §&nbsp;&nbsp;Categories
                          </h2>
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
                            {data.tags.length} total
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                          {data.tags.map((tag) => (
                            <button
                              type="button"
                              key={tag.id}
                              onClick={() => handleTagClick(tag.slug)}
                              className="group inline-flex items-baseline gap-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <span className="border-b border-border/60 pb-0.5 group-hover:border-foreground transition-colors">
                                {tag.label}
                              </span>
                              {tag.event_count && (
                                <span className="font-mono text-[10px] uppercase tracking-[0.12em] opacity-60 tabular-nums">
                                  {tag.event_count}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Events Section */}
                    {data?.events && data.events.length > 0 && (
                      <div>
                        <div className="flex items-baseline justify-between mb-3">
                          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                            §&nbsp;&nbsp;Markets
                          </h2>
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
                            {data.events.length} total
                          </span>
                        </div>
                        <div className="border-t border-border/40">
                          {data.events.map((event, index) => (
                            <motion.button
                              key={event.id}
                              type="button"
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{
                                delay: Math.min(index * 0.02, 0.3),
                              }}
                              onClick={() => handleEventClick(event)}
                              className="group relative overflow-hidden w-full flex items-center gap-4 py-3 border-b border-border/40 text-left hover:bg-muted/30 transition-colors"
                            >
                              {event.topOutcome && (
                                <div
                                  className="absolute inset-0 bg-linear-to-r from-foreground/4 to-transparent dark:from-foreground/6 pointer-events-none"
                                  style={{
                                    width: `${Math.round(event.topOutcome.price * 100)}%`,
                                  }}
                                />
                              )}

                              {event.image ? (
                                <div className="relative w-11 h-11 rounded-sm overflow-hidden shrink-0 bg-muted border border-border/60 z-10">
                                  <Image
                                    src={event.image}
                                    alt={event.title}
                                    fill
                                    sizes="44px"
                                    className="object-cover"
                                  />
                                </div>
                              ) : (
                                <div className="w-11 h-11 rounded-sm bg-muted flex items-center justify-center shrink-0 border border-border/60 z-10">
                                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}

                              <div className="relative flex-1 min-w-0 z-10">
                                <p className="font-medium text-sm line-clamp-1 leading-snug text-foreground">
                                  {event.title}
                                </p>

                                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                  {event.topOutcome && (
                                    <span className="font-mono text-[11px] tabular-nums text-foreground font-semibold">
                                      {Math.round(event.topOutcome.price * 100)}
                                      %
                                      <span className="font-sans font-normal text-muted-foreground ml-1.5 normal-case">
                                        {event.topOutcome.name}
                                      </span>
                                    </span>
                                  )}
                                  {event.volume24hr !== undefined &&
                                    event.volume24hr > 0 && (
                                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                                        <span className="opacity-60 mr-1">
                                          Vol
                                        </span>
                                        {formatVolume(event.volume24hr)}
                                      </span>
                                    )}
                                  {event.liquidity !== undefined &&
                                    event.liquidity > 0 && (
                                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                                        <span className="opacity-60 mr-1">
                                          Liq
                                        </span>
                                        {formatVolume(event.liquidity)}
                                      </span>
                                    )}
                                  {event.live && (
                                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                      <span className="relative flex h-1.5 w-1.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500/75" />
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                                      </span>
                                      Live
                                    </span>
                                  )}
                                  {event.competitive !== undefined &&
                                    event.competitive >= 0.4 && (
                                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">
                                        <span
                                          aria-hidden="true"
                                          className="text-[10px] leading-none opacity-80"
                                        >
                                          ◆
                                        </span>
                                        Hot
                                      </span>
                                    )}
                                </div>
                              </div>
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Results Summary — editorial terminus */}
                    {data?.pagination && (
                      <div className="flex items-center justify-center py-6 border-t border-border/40 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                        <span className="tabular-nums">
                          {data.events?.length || 0}
                        </span>
                        {data.pagination.totalResults >
                          (data.events?.length || 0) && (
                          <span className="tabular-nums">
                            &nbsp;of&nbsp;
                            {data.pagination.totalResults}
                          </span>
                        )}
                        <span className="mx-3 text-border/80">·</span>
                        <span>markets shown</span>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Empty State - No query and no recent data */}
          {!showResults && !showRecentSearches && !showLastSearchedMarkets && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-8 max-w-md"
            >
              <p
                className="font-mono text-[10px] uppercase tracking-[0.14em] mb-2"
                style={{ color: "var(--kwm-ink-3)" }}
              >
                Try searching
              </p>
              <p
                className="text-[14px] leading-snug"
                style={{ color: "var(--kwm-ink)" }}
              >
                An event name, a candidate, a ticker, or a topic — type at least
                two characters to see markets.
              </p>
            </motion.div>
          )}
        </div>
      </main>
      <ProductFooter context="Search" />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
