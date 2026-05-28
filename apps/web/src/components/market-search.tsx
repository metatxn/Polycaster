"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Search, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type SearchEvent, useSearch } from "@/hooks/use-search";
import { formatVolume } from "@/lib/formatters";
import { cn } from "@/lib/utils";

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

// Last searched markets stored in localStorage (shared with search page)
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

function addLastSearchedMarket(market: LastSearchedMarket) {
  if (typeof window === "undefined" || !market.id) return;
  try {
    const stored = localStorage.getItem(LAST_SEARCH_MARKETS_KEY);
    const recent: LastSearchedMarket[] = stored ? JSON.parse(stored) : [];
    // Remove if already exists (to move to front)
    const filtered = recent.filter((m) => m.id !== market.id);
    const updated = [market, ...filtered].slice(0, MAX_LAST_MARKETS);
    localStorage.setItem(LAST_SEARCH_MARKETS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

interface MarketSearchProps {
  className?: string;
  placeholder?: string;
  /** Restrict results to events tagged with this slug. When set, the
   *  dropdown only surfaces matches inside the current category and
   *  the empty / footer state reflects the scope. */
  tagSlug?: string;
  /** Display label for the scope (e.g. "Politics", "Sports"). Used in
   *  the placeholder, empty state, and result footer. */
  tagLabel?: string;
  /** Visual treatment. `underline` is the editorial hairline used in
   *  content areas; `boxed` is a pill-shaped filled input for use in
   *  chrome (top nav). Defaults to `underline`. */
  variant?: "underline" | "boxed";
}

export function MarketSearch({
  className,
  placeholder,
  tagSlug,
  tagLabel,
  variant = "underline",
}: MarketSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the search query by 300ms
  const debouncedQuery = useDebouncedValue(query, 300);

  // Scoping is handled server-side via the `tagSlug` arg: our /api/search
  // route fans out to a tag-scoped events endpoint in parallel with the
  // public-search call and merges the results. So we can ask for fewer
  // results and trust they're already on-topic.
  const fetchLimit = 8;
  const { data, isLoading } = useSearch(debouncedQuery, fetchLimit, tagSlug);

  // Show loading state while typing (before debounce completes)
  const isTyping = query !== debouncedQuery && query.length >= 2;

  // Already scoped server-side — just slice to the display cap. We keep
  // the variable name for downstream references.
  const scopedEvents = useMemo(() => {
    if (!data?.events) return [];
    return data.events.slice(0, 8);
  }, [data?.events]);

  const effectivePlaceholder =
    placeholder ??
    (tagLabel ? `Search ${tagLabel.toLowerCase()}…` : "Search markets…");

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      setIsOpen(e.target.value.length >= 2);
    },
    []
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setIsOpen(false);
    inputRef.current?.focus();
  }, []);

  const handleEventClick = useCallback(
    (event: SearchEvent) => {
      // Save to last searched markets in localStorage
      addLastSearchedMarket({
        id: event.id,
        slug: event.slug || event.id,
        title: event.title,
        image: event.image,
        volume24hr: event.volume24hr,
        liquidity: event.liquidity,
        live: event.live,
      });

      setIsOpen(false);
      setQuery("");
      router.push(`/events/detail/${event.slug || event.id}`);
    },
    [router]
  );

  const handleTagClick = useCallback(
    (slug: string) => {
      setIsOpen(false);
      setQuery("");
      router.push(`/events/${slug}`);
    },
    [router]
  );

  // Tags section is scope-dependent: on a scoped page (/events/politics)
  // showing a "Categories" row is redundant — the user is already in one.
  const hasResults =
    scopedEvents.length > 0 || (!tagSlug && data?.tags && data.tags.length > 0);

  const showDropdown = isOpen && query.length >= 2;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Two looks: `underline` is the editorial hairline used inside
          content areas; `boxed` is a pill-shaped filled input meant for
          the top-nav chrome. Both share the same Search icon + X
          affordances; only padding, border, and shape differ. */}
      <div className="relative group">
        <Search
          className={cn(
            "absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70 transition-colors group-focus-within:text-foreground",
            variant === "boxed" ? "left-3.5" : "left-0"
          )}
        />
        <input
          ref={inputRef}
          type="text"
          placeholder={effectivePlaceholder}
          value={query}
          onChange={handleInputChange}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
          className={cn(
            "w-full bg-transparent focus:outline-none text-sm transition-colors",
            variant === "boxed"
              ? "h-10 pl-10 pr-10 bg-muted/30 border border-border/70 rounded-full focus:border-foreground/70 focus:bg-muted/50 placeholder:text-muted-foreground/60"
              : "h-9 pl-6 pr-6 border-0 border-b border-border/70 focus:border-foreground placeholder:text-muted-foreground/60 placeholder:font-editorial placeholder:italic"
          )}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/70 hover:text-foreground transition-colors",
              variant === "boxed" ? "right-3.5" : "right-0"
            )}
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Results Dropdown.
          - `underline` variant: flat panel right-anchored at a fixed
             384px width, sitting flush below the hairline so it reads
             as an extension of the input.
          - `boxed` variant: matches the input's full width and pill
             rounding, with a small gap below so it floats as a
             rounded card under the nav input. */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className={cn(
              "absolute top-full bg-background border border-border/70 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.18)] z-50 overflow-hidden max-h-[70vh] overflow-y-auto",
              variant === "boxed"
                ? "inset-x-0 mt-2 rounded-2xl"
                : "right-0 w-[clamp(320px,24rem,90vw)]"
            )}
          >
            {/* Loading State - show when typing or fetching */}
            {(isLoading || isTyping) && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/70" />
              </div>
            )}

            {/* No Results */}
            {!isLoading && !isTyping && !hasResults && (
              <div className="py-6 px-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground text-center">
                  {tagLabel
                    ? `No ${tagLabel.toLowerCase()} markets for "${query}"`
                    : `No markets for "${query}"`}
                </p>
              </div>
            )}

            {/* Results */}
            {!isLoading && !isTyping && hasResults && (
              <div>
                {/* Events Section */}
                {scopedEvents.length > 0 && (
                  <div>
                    <div className="px-3 pt-3 pb-1.5 text-[10px] font-mono font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {tagLabel ? `${tagLabel} Markets` : "Markets"}
                    </div>
                    <div className="divide-y divide-border/40">
                      {scopedEvents.map((event) => (
                        <button
                          type="button"
                          key={event.id}
                          onClick={() => handleEventClick(event)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left group"
                        >
                          {event.image ? (
                            <div className="relative w-9 h-9 rounded-md overflow-hidden shrink-0 bg-muted ring-1 ring-border/50">
                              <Image
                                src={event.image}
                                alt={event.title}
                                fill
                                sizes="36px"
                                className="object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0 ring-1 ring-border/50">
                              <span className="font-editorial italic text-base text-foreground/30 leading-none">
                                {(event.title || "M")
                                  .trim()
                                  .charAt(0)
                                  .toUpperCase()}
                              </span>
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm line-clamp-1 leading-tight tracking-[-0.01em] group-hover:text-foreground transition-colors">
                              {event.title}
                            </p>

                            <div className="flex items-center gap-2 mt-1 text-[10px] font-mono tabular-nums text-muted-foreground">
                              {event.topOutcome && (
                                <span className="inline-flex items-baseline gap-1 shrink-0">
                                  <span className="text-foreground font-semibold">
                                    {Math.round(event.topOutcome.price * 100)}%
                                  </span>
                                  <span className="truncate max-w-[100px]">
                                    {event.topOutcome.name}
                                  </span>
                                </span>
                              )}
                              {event.volume24hr !== undefined &&
                                event.volume24hr > 0 && (
                                  <span className="inline-flex items-baseline gap-1 shrink-0">
                                    <span className="text-foreground/80">
                                      {formatVolume(event.volume24hr)}
                                    </span>
                                    <span className="uppercase tracking-[0.12em] text-[9px]">
                                      vol
                                    </span>
                                  </span>
                                )}
                              {event.liquidity !== undefined &&
                                event.liquidity > 0 && (
                                  <span className="inline-flex items-baseline gap-1 shrink-0">
                                    <span className="text-foreground/80">
                                      {formatVolume(event.liquidity)}
                                    </span>
                                    <span className="uppercase tracking-[0.12em] text-[9px]">
                                      liq
                                    </span>
                                  </span>
                                )}
                              {event.live && (
                                <span className="inline-flex items-center gap-1 shrink-0 uppercase tracking-[0.14em] text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  <span className="relative flex h-1 w-1">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500/75" />
                                    <span className="relative inline-flex rounded-full h-1 w-1 bg-emerald-500" />
                                  </span>
                                  Live
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags Section — only when we're NOT already inside a
                    tag scope. On /events/politics a "Categories" row
                    would suggest navigating sideways when the user
                    wants to search deeper. */}
                {!tagSlug && data?.tags && data.tags.length > 0 && (
                  <div className="border-t border-border/40">
                    <div className="px-3 pt-3 pb-1.5 text-[10px] font-mono font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Categories
                    </div>
                    <div className="px-3 pb-3 flex flex-wrap gap-x-3 gap-y-1.5">
                      {data.tags.slice(0, 5).map((tag) => (
                        <button
                          type="button"
                          key={tag.id}
                          onClick={() => handleTagClick(tag.slug)}
                          className="inline-flex items-baseline gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <span className="font-medium">{tag.label}</span>
                          {tag.event_count && (
                            <span className="font-mono tabular-nums text-[10px] text-muted-foreground/70">
                              {tag.event_count}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* View All Results — on scoped pages the upstream
                    total counts all markets, not just the current
                    category, so we hide the footer to avoid lying. */}
                {!tagSlug &&
                  data?.pagination &&
                  data.pagination.totalResults > 8 && (
                    <div className="px-3 py-2 border-t border-border/40 bg-muted/20">
                      <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-center text-muted-foreground">
                        Top 8 of {data.pagination.totalResults}
                      </p>
                    </div>
                  )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
