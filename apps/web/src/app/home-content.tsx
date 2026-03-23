"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Clock,
  Crown,
  Droplets,
  Fish,
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
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
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
    active: apiQueryParams.active,
    closed: apiQueryParams.closed,
    tagSlug: apiQueryParams.tagSlug,
    filters: serverFilterParams,
    enabled: viewMode === "categories",
  });

  const {
    data: trendingPaginatedData,
    isLoading: loadingTrending,
    error: trendingError,
    hasNextPage: hasNextTrending,
    fetchNextPage: fetchNextTrending,
    isFetchingNextPage: isFetchingNextTrending,
  } = useTrendingEvents(20, serverFilterParams, viewMode === "trending");

  const {
    data: newPaginatedData,
    isLoading: loadingNew,
    error: newError,
    hasNextPage: hasNextNew,
    fetchNextPage: fetchNextNew,
    isFetchingNextPage: isFetchingNextNew,
  } = useNewEvents(20, serverFilterParams, viewMode === "new");

  const {
    data: breakingPaginatedData,
    isLoading: loadingBreaking,
    error: breakingError,
    hasNextPage: hasNextBreaking,
    fetchNextPage: fetchNextBreaking,
    isFetchingNextPage: isFetchingNextBreaking,
  } = useBreakingEvents(20, serverFilterParams, viewMode === "breaking");

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
          hasMore: hasNextAllPaginated ?? (initialData?.totalResults ?? 0) > 20,
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
    <div className="min-h-screen bg-background relative overflow-x-hidden selection:bg-purple-500/30">
      <PageBackground />

      <Navbar />

      {/* Main Content - Added bottom padding for mobile nav, pt aligned with 60px grid */}
      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8">
        {/* Header Row: Title + Live Badge + Leaderboard Button */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-end justify-between mb-4 sm:mb-6"
        >
          {/* Left: Title */}
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight leading-none">
            Explore Markets
          </h1>

          {/* Right: Live Badge + Leaderboard Button - All capsule shaped, aligned to baseline */}
          <div className="flex items-end gap-2 sm:gap-2.5">
            {/* Live Markets Badge - Clickable - Visible on all screens */}
            <Link href="/live">
              <div className="flex items-center justify-center gap-1.5 sm:gap-2 h-9 sm:h-10 px-3 sm:px-4 rounded-full bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-500/40 transition-[background-color,border-color,transform] duration-150 cursor-pointer active:scale-95">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-xs sm:text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  Live
                </span>
              </div>
            </Link>

            {/* Whale Tracker Badge - Highlighted */}
            <Link href="/whales">
              <div className="relative flex items-center justify-center gap-1.5 sm:gap-2 h-9 sm:h-10 px-3 sm:px-4 rounded-full bg-linear-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 transition-[background-color,transform,box-shadow] duration-150 cursor-pointer active:scale-95 shadow-md hover:shadow-lg hover:shadow-cyan-500/30">
                <Fish className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white" />
                <span className="text-xs sm:text-sm font-bold text-white">
                  <span className="sm:hidden">🐋</span>
                  <span className="hidden sm:inline">Whales</span>
                </span>
                {/* NEW badge */}
                <span className="absolute -top-1.5 -right-1 px-1.5 py-0.5 text-[9px] font-bold bg-amber-500 text-white rounded-full shadow-sm animate-pulse">
                  NEW
                </span>
              </div>
            </Link>

            {/* Top Traders Badge - Shows "Top" on mobile, "Top Traders" on larger screens */}
            <Link href="/leaderboard">
              <div className="flex items-center justify-center gap-1.5 sm:gap-2 h-9 sm:h-10 px-3 sm:px-4 rounded-full bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-500/40 transition-[background-color,border-color,transform] duration-150 cursor-pointer active:scale-95">
                <Crown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-500" />
                <span className="text-xs sm:text-sm font-semibold text-amber-600 dark:text-amber-400">
                  <span className="sm:hidden">Top</span>
                  <span className="hidden sm:inline">Top Traders</span>
                </span>
              </div>
            </Link>
          </div>
        </motion.div>

        {/* Combined Filter Row - Desktop (lg+) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="hidden lg:flex items-center gap-4 mb-4"
        >
          {/* Filter Container */}
          <div className="flex items-center gap-2 p-1.5 bg-gray-100/80 dark:bg-white/5 rounded-2xl border border-gray-200/60 dark:border-white/8">
            {/* Tab Pills - Quick Filters */}
            <div className="flex items-center gap-0.5 shrink-0">
              {TAB_CATEGORIES.map((tab) => {
                const isActive = viewMode === tab.slug;
                const Icon = tab.icon;
                return (
                  <button
                    type="button"
                    key={tab.slug}
                    onClick={() =>
                      tab.slug === "categories"
                        ? setViewMode("categories")
                        : handleQuickCategoryClick(tab.slug as ViewMode)
                    }
                    className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold text-[13px] whitespace-nowrap transition-[color,background-color,box-shadow,transform] duration-200 shrink-0 active:scale-[0.97] ${
                      isActive
                        ? "bg-white dark:bg-white/15 text-gray-900 dark:text-white shadow-sm dark:shadow-none"
                        : "text-gray-500 dark:text-white/60 hover:text-gray-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/8"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Subtle Divider */}
            <div className="h-5 w-px bg-gray-300/60 dark:bg-white/15 mx-0.5 shrink-0" />

            {/* Filter Chips - Advanced Filters */}
            <DesktopFilterChips />
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search Input - Separate */}
          <MarketSearch className="w-56 xl:w-64" />
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
            {/* Tab Pills - Scrollable on mobile */}
            <div className="relative flex-1 sm:flex-initial">
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-muted/30 rounded-full p-1 overflow-x-auto scrollbar-hide border border-gray-200/50 dark:border-transparent">
                {TAB_CATEGORIES.map((tab) => {
                  const isActive = viewMode === tab.slug;
                  const Icon = tab.icon;
                  return (
                    <button
                      type="button"
                      key={tab.slug}
                      onClick={() =>
                        tab.slug === "categories"
                          ? setViewMode("categories")
                          : handleQuickCategoryClick(tab.slug as ViewMode)
                      }
                      className={`relative flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full font-semibold text-xs sm:text-sm whitespace-nowrap transition-[color,background-color,box-shadow,transform] duration-200 shrink-0 active:scale-95 ${
                        isActive
                          ? "bg-gray-900 dark:bg-primary text-white dark:text-primary-foreground shadow-md"
                          : "text-gray-600 dark:text-muted-foreground hover:text-gray-900 dark:hover:text-foreground hover:bg-white/80 dark:hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      {tab.label}
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

            {/* Loading State */}
            {currentData.isLoading && !currentData.error && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5">
                {[...Array(10)].map((_, i) => (
                  <motion.div
                    key={`skeleton-${i}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-2xl sm:rounded-3xl bg-card/30 backdrop-blur-sm border border-border/30 overflow-hidden"
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

            {/* Events Grid */}
            {!currentData.isLoading && currentData.events.length > 0 && (
              <>
                <div
                  className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5 transition-opacity duration-200 ${
                    isPending ? "opacity-70" : "opacity-100"
                  }`}
                >
                  {currentData.events.map((event, index) => (
                    <EventCard
                      key={`${event.id}-${index}`}
                      event={event}
                      index={index}
                      priority={index < 4}
                    />
                  ))}
                </div>

                {/* Loading More */}
                {currentData.isFetchingMore && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5 mt-3 sm:mt-5">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={`loading-${i}`}
                        className="rounded-2xl sm:rounded-3xl bg-card/30 backdrop-blur-sm border border-border/30 overflow-hidden animate-pulse"
                      >
                        <div className="aspect-16/10 w-full bg-muted/30" />
                        <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
                          <div className="h-5 sm:h-6 w-4/5 rounded-lg sm:rounded-xl bg-muted/30" />
                          <div className="h-3 sm:h-4 w-full rounded-md sm:rounded-lg bg-muted/20" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Universal Infinite Scroll Trigger - Placed inside content to ensure re-detection on tab change */}
                {currentData.hasMore && (
                  <div
                    ref={setLoadMoreElement}
                    className="h-20 w-full flex items-center justify-center"
                  >
                    {currentData.isFetchingMore && (
                      <div className="flex gap-2">
                        <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-2 h-2 rounded-full bg-primary animate-bounce" />
                      </div>
                    )}
                  </div>
                )}

                {/* End of results message */}
                {!currentData.hasMore &&
                  !currentData.isFetchingMore &&
                  currentData.events.length > 0 && (
                    <div className="flex justify-center py-10 border-t border-border/10 mt-10">
                      <p className="text-sm text-muted-foreground bg-muted/30 px-4 py-2 rounded-full border border-border/20">
                        {hasActiveFilters
                          ? `Found ${currentData.events.length} markets matching your filters`
                          : `Showing all ${currentData.events.length} markets`}
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
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-20"
                >
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-muted/50 mb-6">
                    <Star className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <h3 className="text-2xl font-black mb-2">
                    {hasActiveFilters
                      ? "No Matching Markets"
                      : "No Markets Found"}
                  </h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    {hasActiveFilters
                      ? "No markets match your current filters. Try adjusting or clearing your filters."
                      : viewMode === "categories"
                        ? "No markets available right now. Check back soon!"
                        : `Looks like there are no ${viewMode} markets right now. Check back soon or explore other categories!`}
                  </p>
                  {hasActiveFilters && (
                    <Button
                      variant="outline"
                      onClick={clearAllFilters}
                      className="mt-4 rounded-xl"
                    >
                      Clear All Filters
                    </Button>
                  )}
                </motion.div>
              )}
          </motion.div>
        </AnimatePresence>

        {/* Bottom CTA Section - Hidden on mobile to reduce clutter */}
        <motion.section
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          className="mt-12 sm:mt-20 mb-8 hidden sm:block"
        >
          <div className="relative overflow-hidden rounded-3xl sm:rounded-4xl bg-linear-to-br from-purple-500/10 via-blue-500/5 to-emerald-500/10 border border-white/10 p-6 sm:p-8 md:p-12">
            {/* Background Glow */}
            <div className="absolute top-0 right-0 w-64 sm:w-96 h-64 sm:h-96 bg-purple-500/20 rounded-full blur-[80px] sm:blur-[100px] -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 sm:w-64 h-48 sm:h-64 bg-blue-500/20 rounded-full blur-[60px] sm:blur-[80px] translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10 text-center max-w-2xl mx-auto">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight mb-3 sm:mb-4">
                Ready to make your{" "}
                <span className="bg-clip-text text-transparent bg-linear-to-r from-purple-500 to-blue-500">
                  predictions
                </span>
                ?
              </h2>
              <p className="text-muted-foreground text-sm sm:text-lg mb-6 sm:mb-8">
                Connect your wallet and start trading on real-world events.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                <Button
                  size="lg"
                  className="rounded-xl sm:rounded-2xl px-6 sm:px-8 font-bold shadow-lg shadow-primary/25 active:scale-95 transition-transform"
                >
                  <Zap className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
                  Start Trading
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-xl sm:rounded-2xl px-6 sm:px-8 font-bold active:scale-95 transition-transform"
                >
                  Learn More
                </Button>
              </div>
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
