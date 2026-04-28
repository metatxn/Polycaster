"use client";

import { ChevronLeft, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChromeHeader } from "@/components/app-layout";
import {
  EventCard,
  EventCardSkeleton,
  skeletonVisibilityClass,
} from "@/components/event-card";
import { EventFilterBar } from "@/components/event-filter-bar";
import { MarketSearch } from "@/components/market-search";
import { Navbar } from "@/components/navbar";
import { useEventFilters } from "@/context/event-filter-context";
import { usePaginatedEvents } from "@/hooks/use-paginated-events";
import { PRIORITY_EVENT_CARD_COUNT } from "@/lib/lcp-images";
import type { InitialHomeData } from "@/lib/server-cache";
import { SPORT_CATEGORIES } from "@/lib/sport-categories";
import { cn } from "@/lib/utils";

interface EventWithDates {
  id: string;
  title: string;
  slug?: string;
  startDate?: string;
  endDate?: string;
}

interface SportsContentProps {
  initialData?: InitialHomeData | null;
  /** Sport sub-slug from the URL (`/events/sports/{slug}`). Empty string
   *  means the "All Sports" overview at `/events/sports`. */
  selectedSport?: string;
}

export function SportsContent({
  initialData,
  selectedSport = "",
}: SportsContentProps) {
  const router = useRouter();
  const [loadMoreElement, setLoadMoreElement] = useState<HTMLDivElement | null>(
    null
  );

  const { filters, serverFilterParams, apiQueryParams, hasActiveFilters } =
    useEventFilters();

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

  const applyDateFilter = useCallback(
    <T extends EventWithDates>(events: T[]): T[] => {
      if (!filters.dateRange.start && !filters.dateRange.end) {
        return events;
      }

      return events.filter((event) => {
        const s = event.startDate ? new Date(event.startDate) : null;
        const e = event.endDate ? new Date(event.endDate) : null;

        if (filters.dateRange.start && e && e < filters.dateRange.start) {
          return false;
        }

        if (filters.dateRange.end && s && s > filters.dateRange.end) {
          return false;
        }

        return true;
      });
    },
    [filters.dateRange]
  );

  const sport =
    SPORT_CATEGORIES.find((category) => category.value === selectedSport) ??
    SPORT_CATEGORIES[0];

  const effectiveTagSlug = sport.tagSlug || apiQueryParams.tagSlug || "sports";
  const {
    data: paginatedData,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePaginatedEvents({
    limit: 20,
    order: volumeOrderField,
    ascending: false,
    closed: apiQueryParams.closed,
    tagSlug: effectiveTagSlug,
    filters: serverFilterParams,
    fullMarkets: true,
  });

  const canUseInitialData =
    selectedSport === "" &&
    !hasActiveFilters &&
    !apiQueryParams.closed &&
    volumeOrderField === "volume24hr";
  const fallbackEvents =
    canUseInitialData && initialData?.events?.length
      ? (initialData.events as EventWithDates[])
      : [];
  const rawEvents =
    paginatedData?.pages.flatMap((page) => page.events) ?? fallbackEvents;
  const events = useMemo(
    () => applyDateFilter(rawEvents),
    [applyDateFilter, rawEvents]
  );
  const showLoadingState = isLoading && fallbackEvents.length === 0;
  const hasMore =
    hasNextPage ?? (canUseInitialData ? initialData?.hasMore : false) ?? false;

  useEffect(() => {
    if (!loadMoreElement) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: "400px" }
    );

    observer.observe(loadMoreElement);
    return () => observer.disconnect();
  }, [fetchNextPage, hasMore, isFetchingNextPage, loadMoreElement]);

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground mb-6 animate-in fade-in duration-500">
          <button
            type="button"
            onClick={() => router.push("/markets")}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Markets</span>
          </button>
          <span className="text-border/80">&rsaquo;</span>
          <span className="text-foreground">Sports</span>
          {selectedSport && (
            <>
              <span className="text-border/80">&rsaquo;</span>
              <span className="text-foreground">{sport.label}</span>
            </>
          )}
        </div>

        <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-6">
            <div className="min-w-0 md:flex-1 md:max-w-3xl">
              <h1 className="font-editorial italic font-medium text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.02] tracking-tight text-foreground wrap-break-word">
                {sport.label === "All Sports" ? "Sports" : sport.label}
              </h1>
              <p className="mt-4 text-base sm:text-lg text-muted-foreground font-editorial leading-snug max-w-2xl">
                Live prediction markets across{" "}
                {sport.label === "All Sports"
                  ? "every major league"
                  : sport.label}
                .
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap md:flex-nowrap md:shrink-0 md:pb-1">
              <MarketSearch
                className="hidden md:block w-56"
                tagSlug={sport.tagSlug}
                tagLabel={sport.label === "All Sports" ? "Sports" : sport.label}
              />
              <div className="flex items-baseline gap-2 font-mono tabular-nums">
                <span className="text-2xl font-semibold text-foreground">
                  {events.length}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground max-w-[140px] truncate">
                  {sport.label === "All Sports"
                    ? "sports markets"
                    : `${sport.label} markets`}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 h-px bg-linear-to-r from-border/80 via-border/40 to-transparent" />
        </div>

        {/* Two-level navigation bar: sub-category pills on top, filter
            chips below, bound by a shared hairline so the pair reads as
            one navigation surface with two levels rather than two
            separate rows. */}
        <div className="border-y border-border/50">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-2">
            <span
              aria-hidden
              className="shrink-0 pl-0.5 pr-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 self-center"
            >
              Sport
            </span>
            {SPORT_CATEGORIES.map((category) => {
              const isActive = selectedSport === category.value;

              return (
                <button
                  type="button"
                  key={category.value}
                  onClick={() =>
                    router.push(
                      category.value
                        ? `/events/sports/${category.value}`
                        : "/events/sports"
                    )
                  }
                  className={cn(
                    "relative inline-flex items-center px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors active:scale-[0.97] shrink-0",
                    isActive
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {category.label}
                  {isActive && (
                    <span className="absolute inset-x-2 -bottom-px h-px bg-foreground" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border/30">
            <EventFilterBar showStatus />
          </div>
        </div>

        <div className="animate-in fade-in duration-500">
          {error && (
            <div className="py-10 border-y border-destructive/30 mb-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-destructive mb-3">
                §&nbsp;&nbsp;Feed Error
              </p>
              <p className="kw-editorial italic text-xl md:text-2xl leading-snug text-foreground max-w-xl mb-3">
                Sports markets couldn&apos;t be loaded.
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
                {error?.message || "Unable to load sports markets"}
              </p>
            </div>
          )}

          {showLoadingState && !error && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5">
              {[...Array(10)].map((_, i) => (
                <EventCardSkeleton
                  key={`skeleton-${i}`}
                  className={skeletonVisibilityClass(i)}
                />
              ))}
            </div>
          )}

          {!showLoadingState && events.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5">
                {events.map((event, index) => (
                  <EventCard
                    key={`${event.id}-${index}`}
                    event={event}
                    index={index}
                    priority={index < PRIORITY_EVENT_CARD_COUNT}
                  />
                ))}
              </div>

              {isFetchingNextPage && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5 mt-3 sm:mt-5">
                  {[...Array(10)].map((_, i) => (
                    <EventCardSkeleton
                      key={`loading-${i}`}
                      className={skeletonVisibilityClass(i)}
                    />
                  ))}
                </div>
              )}

              {hasMore && (
                <div
                  ref={setLoadMoreElement}
                  aria-hidden
                  className="h-8 w-full"
                />
              )}

              {!hasMore && !isFetchingNextPage && events.length > 0 && (
                <div className="flex justify-center py-10">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    All {events.length} {sport.label.toLowerCase()} markets
                    shown
                  </p>
                </div>
              )}
            </>
          )}

          {!showLoadingState && !error && events.length === 0 && (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted/50 mb-6">
                <Star className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="font-editorial italic text-2xl font-medium mb-2">
                No {sport.label.toLowerCase()} markets
              </h3>
              <p className="text-muted-foreground max-w-sm mx-auto">
                No active markets found. Try a different sport or check back
                later.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
