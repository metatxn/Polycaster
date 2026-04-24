"use client";

import { ChevronLeft, Sparkles, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ProChromeHeader } from "@/components/app-pro-layout";
import {
  EventCard,
  EventCardSkeleton,
  skeletonVisibilityClass,
} from "@/components/event-card";
import { EventFilterBar } from "@/components/event-filter-bar";
import { MarketSearch } from "@/components/market-search";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useEventFilters } from "@/context/event-filter-context";
import { usePaginatedEvents } from "@/hooks/use-paginated-events";
import { PRIORITY_EVENT_CARD_COUNT } from "@/lib/lcp-images";
import type { InitialHomeData, InitialTagData } from "@/lib/server-cache";
import { formatTagLabel, normalizeTagSlug } from "@/lib/tag-slugs";

interface EventWithDates {
  id: string;
  title: string;
  startDate?: string;
  endDate?: string;
}

interface TagEventsContentProps {
  tagSlug: string;
  initialData?: InitialHomeData | null;
  initialTag?: InitialTagData | null;
}

export function TagEventsContent({
  tagSlug,
  initialData,
  initialTag,
}: TagEventsContentProps) {
  const router = useRouter();
  const canonicalTagSlug = normalizeTagSlug(tagSlug);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const { filters, hasActiveFilters, serverFilterParams, apiQueryParams } =
    useEventFilters();

  const applyDateFilter = useCallback(
    <T extends EventWithDates>(events: T[]): T[] => {
      if (!filters.dateRange.start && !filters.dateRange.end) {
        return events;
      }

      return events.filter((event) => {
        const eventStartDate = event.startDate
          ? new Date(event.startDate)
          : null;
        const eventEndDate = event.endDate ? new Date(event.endDate) : null;

        if (filters.dateRange.start && eventEndDate) {
          if (eventEndDate < filters.dateRange.start) {
            return false;
          }
        }

        if (filters.dateRange.end && eventStartDate) {
          if (eventStartDate > filters.dateRange.end) {
            return false;
          }
        }

        return true;
      });
    },
    [filters.dateRange]
  );

  const {
    data: allPaginatedData,
    isLoading: loadingEvents,
    error: eventsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePaginatedEvents({
    tagSlug: canonicalTagSlug,
    limit: 20,
    order: "volume24hr",
    ascending: false,
    closed: apiQueryParams.closed,
    filters: serverFilterParams,
    fullMarkets: true,
  });

  const canUseInitialData = !hasActiveFilters && !apiQueryParams.closed;
  const fallbackEvents =
    canUseInitialData && initialData?.events?.length
      ? (initialData.events as EventWithDates[])
      : [];

  const allEvents = useMemo(
    () =>
      allPaginatedData?.pages.flatMap((page) => page.events) ?? fallbackEvents,
    [allPaginatedData, fallbackEvents]
  );
  const events = useMemo(
    () => applyDateFilter(allEvents),
    [allEvents, applyDateFilter]
  );
  const isLoading = loadingEvents && fallbackEvents.length === 0;
  const hasMore =
    hasNextPage ?? (canUseInitialData ? initialData?.hasMore : false) ?? false;

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || isFetchingNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [fetchNextPage, hasMore, isFetchingNextPage]);

  const error = eventsError?.message;
  const tagLabel = initialTag?.label ?? formatTagLabel(canonicalTagSlug);
  const tagDescription = initialTag?.description;

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <Navbar />
      <ProChromeHeader />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
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
          <span className="text-foreground">{tagLabel}</span>
        </div>

        <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-6">
            <div className="min-w-0 md:flex-1 md:max-w-3xl">
              <h1 className="font-editorial italic font-medium text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.02] tracking-tight text-foreground wrap-break-word">
                {tagLabel}
              </h1>
              {tagDescription && (
                <p className="mt-4 text-base sm:text-lg text-muted-foreground font-editorial leading-snug max-w-2xl">
                  {tagDescription}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap md:flex-nowrap md:shrink-0 md:pb-1">
              <MarketSearch
                className="hidden md:block w-56"
                tagSlug={canonicalTagSlug}
                tagLabel={tagLabel}
              />
              <div className="flex items-baseline gap-2 font-mono tabular-nums">
                <span className="text-2xl font-semibold text-foreground">
                  {events.length}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground max-w-[120px] truncate">
                  {hasActiveFilters && allEvents.length > events.length
                    ? `of ${allEvents.length}`
                    : `${tagLabel} markets`}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 h-px bg-linear-to-r from-border/80 via-border/40 to-transparent" />
        </div>

        <EventFilterBar />

        <div className="animate-in fade-in duration-500">
          {error && (
            <Card className="border-destructive/50 bg-destructive/5 mb-6">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Oops! Something went wrong
                </CardTitle>
                <CardDescription>{error}</CardDescription>
              </CardHeader>
            </Card>
          )}

          {isLoading && !error && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
              {[...Array(10)].map((_, i) => (
                <EventCardSkeleton
                  key={`skeleton-${i}`}
                  className={skeletonVisibilityClass(i)}
                />
              ))}
            </div>
          )}

          {!isLoading && events.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5 mt-5">
                  {[...Array(10)].map((_, i) => (
                    <EventCardSkeleton
                      key={`loading-${i}`}
                      className={skeletonVisibilityClass(i)}
                    />
                  ))}
                </div>
              )}

              {hasMore && !isFetchingNextPage && (
                <div ref={loadMoreRef} className="h-20 w-full" />
              )}

              {!hasMore && !isFetchingNextPage && events.length > 0 && (
                <div className="flex justify-center py-10">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    {hasActiveFilters
                      ? `${events.length} markets match your filters`
                      : `All ${events.length} markets shown`}
                  </p>
                </div>
              )}
            </>
          )}

          {!isLoading && events.length === 0 && !error && (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted/50 mb-6">
                <Star className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="font-editorial italic text-2xl font-medium mb-2">
                No markets found
              </h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                {hasActiveFilters
                  ? "Try adjusting your filters to find more markets"
                  : `No active markets in ${tagLabel} right now`}
              </p>
              <Button onClick={() => router.push("/markets")}>
                Explore All Markets
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
