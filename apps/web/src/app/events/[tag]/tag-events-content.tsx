"use client";

import { Sparkles, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ChromeHeader } from "@/components/app-layout";
import {
  EventCard,
  EventCardSkeleton,
  skeletonVisibilityClass,
} from "@/components/event-card";
import { EventFilterBar } from "@/components/event-filter-bar";
import { MarketSearch } from "@/components/market-search";
import { Navbar } from "@/components/navbar";
import { ProductFooter } from "@/components/product-footer";
import { ProductHero } from "@/components/product-hero";
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

function getVolumeOrderField(volumeWindow: string) {
  switch (volumeWindow) {
    case "1wk":
      return "volume1wk";
    case "1mo":
      return "volume1mo";
    case "1yr":
      return "volume1yr";
    default:
      return "volume24hr";
  }
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

  const volumeOrderField = useMemo(
    () => getVolumeOrderField(filters.volumeWindow),
    [filters.volumeWindow]
  );

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
    order: volumeOrderField,
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

  return (
    <div className="kw-app min-h-screen relative overflow-x-hidden">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
        <ProductHero
          breadcrumbs={[
            { label: "Markets", href: "/markets" },
            { label: tagLabel },
          ]}
          rightSlot={
            <>
              <MarketSearch
                className="hidden md:block w-48"
                tagSlug={canonicalTagSlug}
                tagLabel={tagLabel}
              />
              <div className="flex items-baseline gap-1.5 tabular-nums">
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: "var(--kwm-ink)" }}
                >
                  {events.length}
                </span>
                <span className="max-w-[120px] truncate">
                  {hasActiveFilters && allEvents.length > events.length
                    ? `of ${allEvents.length}`
                    : "markets"}
                </span>
              </div>
            </>
          }
        />

        <section className="mb-5 border-b border-border/40 pb-5">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {tagLabel} prediction markets
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {initialTag?.description ||
              `Follow active ${tagLabel.toLowerCase()} events and market outcomes.`}{" "}
            Compare live Polymarket odds, volume, and outcome prices as trader
            expectations change.
          </p>
        </section>

        <EventFilterBar showTags={false} />

        <div className="animate-in fade-in duration-500">
          {error && (
            <Card
              data-nosnippet
              className="border-destructive/50 bg-destructive/5 mb-6"
            >
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
            <div data-nosnippet className="text-center py-24">
              <div
                className="inline-flex items-center justify-center w-12 h-12 rounded-md mb-5"
                style={{ background: "var(--kwm-bg-2)" }}
              >
                <Star
                  className="h-5 w-5"
                  style={{ color: "var(--kwm-ink-3)" }}
                />
              </div>
              <h3
                className="text-[14px] font-semibold mb-1"
                style={{ color: "var(--kwm-ink)" }}
              >
                No markets found
              </h3>
              <p
                className="text-[12px] mb-5 max-w-sm mx-auto"
                style={{ color: "var(--kwm-ink-3)" }}
              >
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
      <ProductFooter context={tagLabel} />
    </div>
  );
}
