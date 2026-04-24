"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Clock,
  Droplets,
  Flame,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { EventCard } from "@/components/event-card";
import {
  EventFilterBar,
  FilterChip,
  useFilterBarState,
} from "@/components/event-filter-bar";
import { MarketSearch } from "@/components/market-search";
import {
  MarketsView,
  TableSkeleton as ProTableSkeleton,
} from "@/components/markets-view";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LIQUIDITY_PRESETS,
  STATUS_OPTIONS,
  useEventFilters,
  VOLUME_WINDOW_OPTIONS,
} from "@/context/event-filter-context";
import { useBreakingEvents } from "@/hooks/use-breaking-events";
import { useNewEvents } from "@/hooks/use-new-events";
import { usePaginatedEvents } from "@/hooks/use-paginated-events";
import { useTrendingEvents } from "@/hooks/use-trending-events";
import { PRIORITY_EVENT_CARD_COUNT } from "@/lib/lcp-images";

// Tab categories
const TAB_CATEGORIES = [
  { label: "All", slug: "categories", icon: Activity },
  { label: "Trending", slug: "trending", icon: Flame },
  { label: "Breaking", slug: "breaking", icon: Zap },
  { label: "New", slug: "new", icon: Sparkles },
];

type ViewMode = "categories" | "trending" | "breaking" | "new";

// Valid ViewMode values for runtime validation
const VALID_VIEW_MODES: ViewMode[] = [
  "categories",
  "trending",
  "breaking",
  "new",
];

/**
 * Type guard to validate if a value is a valid ViewMode
 */
function isValidViewMode(value: unknown): value is ViewMode {
  return (
    typeof value === "string" && VALID_VIEW_MODES.includes(value as ViewMode)
  );
}

import type { InitialHomeData } from "@/lib/server-cache";

// Re-export types from server-cache for backwards compatibility
export type { InitialEvent, InitialHomeData } from "@/lib/server-cache";

// Desktop-only inline filter chips component
function DesktopFilterChips() {
  const {
    filters,
    tags,
    liquidityLabel,
    volumeWindowLabel,
    statusLabel,
    tagsLabel,
    dateRangeLabel,
    isDateActive,
    isLiquidityActive,
    isStatusActive,
    isTagsActive,
    isVolumeActive,
    hasActiveFilters,
    handleVolumeWindowChange,
    handleLiquidityChange,
    handleTagToggle,
    handleDatePreset,
    toggleStatus,
    setTagSlugs,
    clearAllFilters,
  } = useFilterBarState();

  return (
    <div className="flex items-center gap-2">
      {/* Created At Filter */}
      <FilterChip
        icon={Clock}
        label="Created"
        value={dateRangeLabel}
        isActive={isDateActive}
        compact
      >
        <DropdownMenuContent align="start" className="w-36">
          <DropdownMenuCheckboxItem
            checked={dateRangeLabel === "All"}
            onCheckedChange={() => handleDatePreset("all")}
          >
            All time
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={dateRangeLabel === "24h"}
            onCheckedChange={() => handleDatePreset("24h")}
          >
            Last 24h
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={dateRangeLabel === "7d"}
            onCheckedChange={() => handleDatePreset("week")}
          >
            Last 7 days
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={dateRangeLabel === "30d"}
            onCheckedChange={() => handleDatePreset("month")}
          >
            Last 30 days
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </FilterChip>

      {/* Liquidity Filter */}
      <FilterChip
        icon={Droplets}
        label="Liquidity"
        value={liquidityLabel}
        isActive={isLiquidityActive}
        compact
      >
        <DropdownMenuContent align="start" className="w-36">
          {LIQUIDITY_PRESETS.map((preset) => (
            <DropdownMenuCheckboxItem
              key={preset.label}
              checked={filters.liquidity === preset.value}
              onCheckedChange={() => handleLiquidityChange(preset.value)}
            >
              {preset.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </FilterChip>

      {/* Status Filter */}
      <FilterChip
        icon={Activity}
        label="Status"
        value={statusLabel || "All"}
        isActive={isStatusActive}
        compact
      >
        <DropdownMenuContent align="start" className="w-36">
          {STATUS_OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={filters.status.includes(option.value)}
              onCheckedChange={() => toggleStatus(option.value)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </FilterChip>

      {/* Tags Filter */}
      <FilterChip
        icon={Tag}
        label="Tags"
        value={tagsLabel}
        isActive={isTagsActive}
        compact
      >
        <DropdownMenuContent
          align="start"
          className="w-48 max-h-64 overflow-y-auto"
        >
          <DropdownMenuCheckboxItem
            checked={filters.tagSlugs.length === 0}
            onCheckedChange={() => setTagSlugs([])}
          >
            All tags
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {tags?.slice(0, 15).map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag.slug}
              checked={filters.tagSlugs.includes(tag.slug)}
              onCheckedChange={() => handleTagToggle(tag.slug)}
            >
              {tag.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </FilterChip>

      {/* Volume Filter */}
      <FilterChip
        icon={SlidersHorizontal}
        label="Volume"
        value={volumeWindowLabel}
        isActive={isVolumeActive}
        compact
      >
        <DropdownMenuContent align="start" className="w-36">
          {VOLUME_WINDOW_OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={filters.volumeWindow === option.value}
              onCheckedChange={() => handleVolumeWindowChange(option.value)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </FilterChip>

      {/* Clear Filters Button */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearAllFilters}
          className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-destructive hover:bg-destructive/10 transition-[color,background-color,transform] duration-150 active:scale-[0.97] shrink-0"
          title="Clear all filters"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// Event interface for client-side date filtering (fallback if API doesn't support date filters)
interface EventWithDates {
  id: string;
  title: string;
  startDate?: string;
  endDate?: string;
}

interface HomeContentProps {
  initialData?: InitialHomeData | null;
}

export function HomeContent({ initialData }: HomeContentProps) {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view") as ViewMode | null;

  const [viewMode, setViewMode] = useState<ViewMode>("categories");
  const [mounted, setMounted] = useState(false);
  const [loadMoreElement, setLoadMoreElement] = useState<HTMLDivElement | null>(
    null
  );

  // useTransition for non-urgent view mode changes (tab switches)
  // This keeps the UI responsive during state updates
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setMounted(true);
    // Check URL param first, then sessionStorage
    if (viewParam && isValidViewMode(viewParam)) {
      setViewMode(viewParam);
    } else {
      try {
        const saved = sessionStorage.getItem("homeViewMode");
        // Validate saved value before using it
        if (saved && isValidViewMode(saved)) {
          setViewMode(saved);
        }
        // If invalid or null, keep the default "categories" view mode
      } catch {
        // sessionStorage unavailable (incognito, storage blocked, etc.)
      }
    }
  }, [viewParam]);

  useEffect(() => {
    if (mounted) {
      try {
        sessionStorage.setItem("homeViewMode", viewMode);
      } catch {
        // sessionStorage unavailable
      }
    }
  }, [viewMode, mounted]);

  // Get filter context with server-side filter params
  const {
    filters,
    hasActiveFilters,
    clearAllFilters,
    serverFilterParams,
    apiQueryParams,
  } = useEventFilters();

  // Map volume window to API order field
  const volumeOrderField = useMemo(() => {
    switch (filters.volumeWindow) {
      case "1wk":
        return "volume1wk";
      case "1mo":
        return "volume1mo";
      case "1yr":
        return "volume1yr";
      default:
        return "volume24hr";
    }
  }, [filters.volumeWindow]);

  // Client-side date filter as fallback (in case API doesn't support date filtering)
  const applyDateFilter = useCallback(
    <T extends EventWithDates>(events: T[]): T[] => {
      // Only apply client-side date filtering if date range is set
      if (!filters.dateRange.start && !filters.dateRange.end) {
        return events;
      }

      return events.filter((event) => {
        const eventStartDate = event.startDate
          ? new Date(event.startDate)
          : null;
        const eventEndDate = event.endDate ? new Date(event.endDate) : null;

        // If filtering by start date: event must end after the filter start date
        if (filters.dateRange.start && eventEndDate) {
          if (eventEndDate < filters.dateRange.start) return false;
        }

        // If filtering by end date: event must start before the filter end date
        if (filters.dateRange.end && eventStartDate) {
          if (eventStartDate > filters.dateRange.end) return false;
        }

        return true;
      });
    },
    [filters.dateRange]
  );

  // Use server-side filtering for paginated events
  // Only fetch data for the currently active tab to avoid unnecessary API calls
  const {
    data: allPaginatedData,
    isLoading: loadingAllPaginated,
    error: allPaginatedError,
    fetchNextPage: fetchNextAllPaginated,
    hasNextPage: hasNextAllPaginated,
    isFetchingNextPage: isFetchingNextAllPaginated,
  } = usePaginatedEvents({
    limit: 20,
    order: volumeOrderField,
    ascending: false,
    closed: apiQueryParams.closed,
    tagSlug: apiQueryParams.tagSlug,
    filters: serverFilterParams,
    enabled: viewMode === "categories",
    // Terminal view needs sub-market details (groupItemTitle,
    // outcomePrices) to render top-candidate rows; card grid only
    // needs market count.
    fullMarkets: true,
  });

  const {
    data: trendingPaginatedData,
    isLoading: loadingTrending,
    error: trendingError,
    hasNextPage: hasNextTrending,
    fetchNextPage: fetchNextTrending,
    isFetchingNextPage: isFetchingNextTrending,
  } = useTrendingEvents(20, serverFilterParams, viewMode === "trending", true);

  const {
    data: newPaginatedData,
    isLoading: loadingNew,
    error: newError,
    hasNextPage: hasNextNew,
    fetchNextPage: fetchNextNew,
    isFetchingNextPage: isFetchingNextNew,
  } = useNewEvents(20, serverFilterParams, viewMode === "new", true);

  const {
    data: breakingPaginatedData,
    isLoading: loadingBreaking,
    error: breakingError,
    hasNextPage: hasNextBreaking,
    fetchNextPage: fetchNextBreaking,
    isFetchingNextPage: isFetchingNextBreaking,
  } = useBreakingEvents(20, serverFilterParams, viewMode === "breaking", true);

  // Wrap view mode changes in startTransition for non-blocking UI updates
  const handleQuickCategoryClick = (mode: ViewMode) => {
    startTransition(() => {
      setViewMode(mode);
    });
  };

  // Get current events - server handles most filtering, client-side date filter as fallback
  // Use initialData for first render to eliminate loading state
  const getCurrentEvents = () => {
    switch (viewMode) {
      case "categories": {
        // Use initialData if no client data yet (SSR -> hydration)
        const allEvents =
          allPaginatedData?.pages.flatMap((page) => page.events) ||
          (initialData?.events as EventWithDates[]) ||
          [];
        const filteredEvents = applyDateFilter(allEvents);
        // Only show loading if we don't have initial data
        const isLoading = loadingAllPaginated && !initialData?.events?.length;
        return {
          events: filteredEvents,
          isLoading,
          error: allPaginatedError,
          hasMore: hasNextAllPaginated ?? initialData?.hasMore ?? false,
          fetchMore: fetchNextAllPaginated,
          isFetchingMore: isFetchingNextAllPaginated,
        };
      }
      case "trending": {
        const trendingEvents =
          trendingPaginatedData?.pages.flatMap((page) => page.events) || [];
        const filteredEvents = applyDateFilter(trendingEvents);
        const totalTrending =
          trendingPaginatedData?.pages[0]?.totalResults ?? 0;
        const hasMoreTrending =
          (hasNextTrending ?? false) ||
          (totalTrending > 0 && trendingEvents.length < totalTrending);

        return {
          events: filteredEvents,
          isLoading: loadingTrending,
          error: trendingError,
          hasMore: hasMoreTrending,
          fetchMore: fetchNextTrending,
          isFetchingMore: isFetchingNextTrending,
        };
      }
      case "new": {
        const newEvents =
          newPaginatedData?.pages.flatMap((page) => page.events) || [];
        const filteredEvents = applyDateFilter(newEvents);
        const totalNew = newPaginatedData?.pages[0]?.totalResults ?? 0;
        const hasMoreNew =
          (hasNextNew ?? false) ||
          (totalNew > 0 && newEvents.length < totalNew);
        return {
          events: filteredEvents,
          isLoading: loadingNew,
          error: newError,
          hasMore: hasMoreNew,
          fetchMore: fetchNextNew,
          isFetchingMore: isFetchingNextNew,
        };
      }
      case "breaking": {
        const breakingEvents =
          breakingPaginatedData?.pages.flatMap((page) => page.events) || [];
        const filteredEvents = applyDateFilter(breakingEvents);
        const totalBreaking =
          breakingPaginatedData?.pages[0]?.totalResults ?? 0;
        const hasMoreBreaking =
          (hasNextBreaking ?? false) ||
          (totalBreaking > 0 && breakingEvents.length < totalBreaking);
        return {
          events: filteredEvents,
          isLoading: loadingBreaking,
          error: breakingError,
          hasMore: hasMoreBreaking,
          fetchMore: fetchNextBreaking,
          isFetchingMore: isFetchingNextBreaking,
        };
      }
      default:
        return {
          events: [],
          isLoading: false,
          error: null,
          hasMore: false,
          fetchMore: () => {},
          isFetchingMore: false,
        };
    }
  };

  const currentData = getCurrentEvents();

  // Use ref to hold latest fetchMore to avoid recreating IntersectionObserver on each render
  const fetchMoreRef = useRef(currentData.fetchMore);
  fetchMoreRef.current = currentData.fetchMore;

  // Infinite scroll - Re-attach only when element or fetch state changes
  useEffect(() => {
    if (!loadMoreElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;

        if (currentData.hasMore && !currentData.isFetchingMore) {
          fetchMoreRef.current();
        }
      },
      { threshold: 0.1, rootMargin: "400px" }
    );

    observer.observe(loadMoreElement);
    return () => observer.disconnect();
  }, [loadMoreElement, currentData.hasMore, currentData.isFetchingMore]);

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden selection:bg-foreground/15">
      <Navbar />

      {/* Main Content - Added bottom padding for mobile nav, pt aligned with 60px grid */}
      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8">
        {/* Header Row: Title + Live Badge + Leaderboard Button.
            Hidden at lg+ — the terminal view has its own editorial
            header and meta-strip. Mobile/tablet always see this
            header since the terminal view falls back to the card
            grid below lg. */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-5 sm:mb-6 lg:hidden"
        >
          {/* Left: Editorial title — matches the Fraunces italic used
              on sibling pages, just one notch smaller since /markets
              hosts the dense card grid below. */}
          <h1 className="font-editorial italic font-medium text-4xl sm:text-5xl md:text-6xl leading-[1.02] tracking-tight text-foreground">
            Markets
          </h1>

          {/* Right: Sibling views — mono caps with hairline underline
              active states, same grammar as TopNav. */}
          <nav
            aria-label="Market views"
            className="flex items-center flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.15em]"
          >
            <Link
              href="/live"
              className="group inline-flex items-center gap-1.5 py-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500/70" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Live
            </Link>
            <Link
              href="/whales"
              className="group inline-flex items-baseline gap-1.5 py-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Whales</span>
              <span className="text-[9px] tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
                new
              </span>
            </Link>
            <Link
              href="/leaderboard"
              className="group inline-flex items-center py-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              Top Traders
            </Link>
          </nav>
        </motion.div>

        {/* Mobile/Tablet Filter Rows (below lg) */}
        <div className="lg:hidden">
          {/* Tab Pills Row + Search */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex items-center justify-between gap-2 sm:gap-4 mb-2"
          >
            {/* Tab strip — editorial mono caps with underline-active,
                matches the TopNav primary nav pattern. */}
            <div className="relative flex-1 sm:flex-initial">
              <div
                role="tablist"
                aria-label="Market view"
                className="flex items-center gap-5 sm:gap-6 overflow-x-auto scrollbar-hide pb-1 border-b border-border/40"
              >
                {TAB_CATEGORIES.map((tab) => {
                  const isActive = viewMode === tab.slug;
                  return (
                    <button
                      type="button"
                      key={tab.slug}
                      role="tab"
                      aria-selected={isActive}
                      onClick={() =>
                        tab.slug === "categories"
                          ? setViewMode("categories")
                          : handleQuickCategoryClick(tab.slug as ViewMode)
                      }
                      className={`relative shrink-0 py-2 font-mono text-[11px] uppercase tracking-[0.15em] transition-colors ${
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 -bottom-1 h-px bg-foreground"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Search Input */}
            <MarketSearch className="hidden sm:block w-64" />
          </motion.div>

          {/* Filter Bar - Separate row on mobile/tablet */}
          <EventFilterBar />
        </div>

        {/* Events Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={viewMode}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {/* Error State */}
            {currentData.error && (
              <Card className="border-destructive/50 bg-destructive/5 backdrop-blur-sm mb-6">
                <CardHeader>
                  <CardTitle className="text-destructive flex items-center gap-2">
                    <Sparkles className="h-5 w-5" />
                    Oops! Something went wrong
                  </CardTitle>
                  <CardDescription>
                    {currentData.error?.message || "Unable to load markets"}
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            {/* Loading State — skeleton cards sit on paper-grain backdrop so
                the grid reads as "developing in from texture" rather than
                popping out of flat muted rectangles. AnimatePresence handles
                the dissolve when real cards arrive.
                At lg+, MarketsView renders its own TableSkeleton via
                the isTransitioning prop — so we hide the card skeletons
                there to avoid a duplicate. */}
            {currentData.isLoading && !currentData.error && (
              <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5">
                {[...Array(10)].map((_, i) => (
                  <motion.div
                    key={`skeleton-${i}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, filter: "blur(2px)" }}
                    transition={{ delay: i * 0.05, duration: 0.35 }}
                    className="skeleton-grain rounded-2xl sm:rounded-3xl bg-muted/40 border border-border/30 overflow-hidden"
                  >
                    <Skeleton className="aspect-16/10 w-full bg-muted/50" />
                    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
                      <Skeleton className="h-5 sm:h-6 w-4/5 rounded-lg sm:rounded-xl bg-muted/50" />
                      <Skeleton className="h-3 sm:h-4 w-full rounded-md sm:rounded-lg bg-muted/30" />
                      <Skeleton className="h-3 sm:h-4 w-2/3 rounded-md sm:rounded-lg bg-muted/30" />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
            {/* Desktop loading: render the terminal view with its own
                table-shaped skeleton so tab switches don't reveal cards. */}
            {currentData.isLoading && !currentData.error && (
              <div className="hidden lg:block">
                <MarketsView
                  events={[]}
                  viewMode={viewMode}
                  onViewChange={handleQuickCategoryClick}
                  advancedFilters={<DesktopFilterChips />}
                  search={<MarketSearch className="w-56 xl:w-64" />}
                  isTransitioning
                />
              </div>
            )}

            {/* Events Grid. At lg+ we render the trading-terminal
                view, and fall back to the card grid below lg where
                tables don't fit. */}
            {!currentData.isLoading && currentData.events.length > 0 && (
              <>
                <div className="hidden lg:block">
                  <MarketsView
                    events={currentData.events}
                    viewMode={viewMode}
                    onViewChange={handleQuickCategoryClick}
                    advancedFilters={<DesktopFilterChips />}
                    search={<MarketSearch className="w-56 xl:w-64" />}
                    isTransitioning={isPending}
                  />
                </div>
                <div
                  className={`lg:hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5 transition-opacity duration-200 ${
                    isPending ? "opacity-70" : "opacity-100"
                  }`}
                >
                  {currentData.events.map((event, index) => (
                    <EventCard
                      key={`${event.id}-${index}`}
                      event={event}
                      index={index}
                      priority={index < PRIORITY_EVENT_CARD_COUNT}
                    />
                  ))}
                </div>

                {/* Loading More — card-grain skeletons below lg,
                    table-row skeletons at lg+. Split so the two
                    layouts stay visually consistent during infinite
                    scroll. */}
                {currentData.isFetchingMore && (
                  <>
                    <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5 mt-3 sm:mt-5">
                      {[...Array(20)].map((_, i) => (
                        <div
                          key={`loading-${i}`}
                          className="skeleton-grain rounded-2xl sm:rounded-3xl bg-muted/40 border border-border/30 overflow-hidden animate-pulse"
                        >
                          <div className="aspect-16/10 w-full bg-muted/30" />
                          <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
                            <div className="h-5 sm:h-6 w-4/5 rounded-lg sm:rounded-xl bg-muted/30" />
                            <div className="h-3 sm:h-4 w-full rounded-md sm:rounded-lg bg-muted/20" />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden lg:block border-x border-b border-border rounded-b-sm -mt-px">
                      <ProTableSkeleton rows={5} />
                    </div>
                  </>
                )}

                {/* Universal Infinite Scroll Trigger - Placed inside content to ensure re-detection on tab change */}
                {currentData.hasMore && (
                  <div
                    ref={setLoadMoreElement}
                    className="h-20 w-full flex items-center justify-center"
                  >
                    {currentData.isFetchingMore && (
                      <div className="flex gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-foreground animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-1.5 h-1.5 rounded-full bg-foreground animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-1.5 h-1.5 rounded-full bg-foreground animate-bounce" />
                      </div>
                    )}
                  </div>
                )}

                {/* End of results message */}
                {!currentData.hasMore &&
                  !currentData.isFetchingMore &&
                  currentData.events.length > 0 && (
                    <div className="flex justify-center py-10 border-t border-border/30 mt-10">
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {hasActiveFilters
                          ? `${currentData.events.length} markets match your filters`
                          : `End of book — ${currentData.events.length} markets`}
                      </p>
                    </div>
                  )}
              </>
            )}

            {/* Empty State */}
            {!currentData.isLoading &&
              currentData.events.length === 0 &&
              !currentData.error && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-24 border-t border-b border-border/40"
                >
                  <div className="inline-flex items-center justify-center w-14 h-14 border border-border/60 mb-6">
                    <Star className="h-6 w-6 text-muted-foreground/70" />
                  </div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
                    § No Results
                  </p>
                  <h3 className="font-editorial italic font-medium text-2xl sm:text-3xl mb-3">
                    {hasActiveFilters
                      ? "Nothing matches your filters."
                      : "The book is empty right now."}
                  </h3>
                  <p className="text-muted-foreground max-w-md mx-auto text-sm">
                    {hasActiveFilters
                      ? "Try widening your filters — or clear them entirely."
                      : viewMode === "categories"
                        ? "Check back shortly as new markets come online."
                        : `No ${viewMode} markets right now. Try another category.`}
                  </p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] font-semibold underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground transition-colors"
                    >
                      Clear all filters
                    </button>
                  )}
                </motion.div>
              )}
          </motion.div>
        </AnimatePresence>

        {/* Bottom CTA — editorial colophon */}
        <motion.section
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          className="mt-16 sm:mt-24 mb-8 hidden sm:block border-t border-b border-border/40"
        >
          <div className="py-14 sm:py-20 text-center max-w-2xl mx-auto">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-5">
              § Colophon
            </p>
            <h2 className="font-editorial italic font-medium text-3xl sm:text-4xl md:text-5xl leading-[1.05] tracking-tight mb-5">
              Every opinion is a position.
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-md mx-auto mb-8">
              Connect your wallet and start trading real-world events — no
              onboarding, no spectator sport.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-5">
              <Button
                size="lg"
                className="h-11 px-6 sm:px-8 font-mono text-[11px] uppercase tracking-[0.18em] font-semibold bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98] transition-transform"
              >
                <Zap className="mr-2 h-4 w-4" />
                Start Trading
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="h-11 px-4 font-mono text-[11px] uppercase tracking-[0.18em] font-semibold text-foreground hover:bg-foreground/5 underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground transition-colors"
              >
                Learn More
              </Button>
            </div>
          </div>
        </motion.section>
      </main>

      {/* Minimal Footer - Hidden on mobile (bottom nav takes its place) */}
      <footer className="relative z-10 border-t border-border/30 py-6 sm:py-8 bg-background/50 backdrop-blur-xl hidden xl:block">
        <div className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-256x256.png"
              alt="Knoww Logo"
              width={24}
              height={24}
              className="rounded-md"
            />
            <span className="font-bold text-foreground">Knoww</span>
            <span>•</span>
            <span>Powered by Polymarket</span>
          </div>
          <div className="flex items-center gap-4">
            <span>© {new Date().getFullYear()}</span>
            <span className="hidden sm:inline">•</span>
            <span className="hidden sm:inline">
              Decentralized & Unstoppable
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
