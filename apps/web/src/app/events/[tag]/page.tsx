"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Sparkles, Star } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { EventCard } from "@/components/event-card";
import { EventFilterBar } from "@/components/event-filter-bar";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useEventFilters } from "@/context/event-filter-context";
import { usePaginatedEvents } from "@/hooks/use-paginated-events";
import { useTagDetails } from "@/hooks/use-tag-details";

// Event interface for client-side date filtering
interface EventWithDates {
  id: string;
  title: string;
  startDate?: string;
  endDate?: string;
}

export default function TagEventsPage() {
  const router = useRouter();
  const params = useParams();
  const tagSlug = params?.tag as string;

  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Fetch tag details for display name
  const {
    data: tagDetails,
    isLoading: loadingTag,
    error: tagError,
  } = useTagDetails(tagSlug);

  // Get filter context with server-side filter params
  const { filters, hasActiveFilters, serverFilterParams, apiQueryParams } =
    useEventFilters();

  // Client-side date filter as fallback
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
          if (eventEndDate < filters.dateRange.start) return false;
        }

        if (filters.dateRange.end && eventStartDate) {
          if (eventStartDate > filters.dateRange.end) return false;
        }

        return true;
      });
    },
    [filters.dateRange]
  );

  // Fetch paginated events for this category
  const {
    data: allPaginatedData,
    isLoading: loadingEvents,
    error: eventsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePaginatedEvents({
    tagSlug,
    limit: 20,
    order: "volume24hr",
    ascending: false,
    active: apiQueryParams.active,
    closed: apiQueryParams.closed,
    filters: serverFilterParams,
  });

  // Infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage || isFetchingNextPage) return;

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
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Get events with date filter applied
  const allEvents =
    allPaginatedData?.pages.flatMap((page) => page.events) || [];
  const events = applyDateFilter(allEvents);

  const isLoading = loadingTag || loadingEvents;
  const error = tagError?.message || eventsError?.message;

  // Format tag name for display
  const formatTagLabel = (label: string) => {
    return label
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const tagLabel = tagDetails?.label
    ? formatTagLabel(tagDetails.label)
    : tagSlug
      ? formatTagLabel(tagSlug.replace(/-/g, " "))
      : "Markets";

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
      <PageBackground />

      <Navbar />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Explore Markets</span>
          </button>
          <span>/</span>
          <span className="text-foreground font-medium">{tagLabel}</span>
        </div>

        {/* Header Row: Live Badge + Title + Search + Market Count */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-start justify-between gap-4 mb-6"
        >
          {/* Left: Live Badge + Title */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 w-fit">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                Live Markets
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              {tagLabel}
            </h1>
            {tagDetails?.description && (
              <p className="text-sm text-muted-foreground max-w-xl">
                {tagDetails.description}
              </p>
            )}
          </div>

          {/* Right: Search + Market Count */}
          <div className="flex items-center gap-3 shrink-0">
            <MarketSearch className="hidden sm:block w-56" />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border/50 text-sm">
              <span className="font-bold text-foreground">{events.length}</span>
              <span className="text-muted-foreground">active markets</span>
            </div>
          </div>
        </motion.div>

        {/* Filter Bar */}
        <EventFilterBar />

        {/* Events Content */}
        <AnimatePresence mode="wait">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {/* Error State */}
            {error && (
              <Card className="border-destructive/50 bg-destructive/5 backdrop-blur-sm mb-6">
                <CardHeader>
                  <CardTitle className="text-destructive flex items-center gap-2">
                    <Sparkles className="h-5 w-5" />
                    Oops! Something went wrong
                  </CardTitle>
                  <CardDescription>{error}</CardDescription>
                </CardHeader>
              </Card>
            )}

            {/* Loading State */}
            {isLoading && !error && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
                {[...Array(10)].map((_, i) => (
                  <motion.div
                    key={`skeleton-${i}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-3xl bg-card/30 backdrop-blur-sm border border-border/30 overflow-hidden"
                  >
                    <Skeleton className="aspect-16/10 w-full bg-muted/50" />
                    <div className="p-5 space-y-4">
                      <Skeleton className="h-6 w-4/5 rounded-xl bg-muted/50" />
                      <Skeleton className="h-4 w-full rounded-lg bg-muted/30" />
                      <Skeleton className="h-4 w-2/3 rounded-lg bg-muted/30" />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Events Grid */}
            {!isLoading && events.length > 0 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
                  {events.map((event, index) => (
                    <EventCard
                      key={`${event.id}-${index}`}
                      event={event}
                      index={index}
                    />
                  ))}
                </div>

                {/* Loading More */}
                {isFetchingNextPage && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5 mt-5">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={`loading-${i}`}
                        className="rounded-3xl bg-card/30 backdrop-blur-sm border border-border/30 overflow-hidden animate-pulse"
                      >
                        <div className="aspect-16/10 w-full bg-muted/30" />
                        <div className="p-5 space-y-4">
                          <div className="h-6 w-4/5 rounded-xl bg-muted/30" />
                          <div className="h-4 w-full rounded-lg bg-muted/20" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Infinite Scroll Trigger */}
                {hasNextPage && !isFetchingNextPage && (
                  <div ref={loadMoreRef} className="h-20 w-full" />
                )}

                {/* End of results message */}
                {!hasNextPage && !isFetchingNextPage && events.length > 0 && (
                  <div className="flex justify-center py-6">
                    <p className="text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? `Found ${events.length} markets matching your filters`
                        : `Showing all ${events.length} markets`}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Empty State */}
            {!isLoading && events.length === 0 && !error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-20"
              >
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-muted/50 mb-6">
                  <Star className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-bold mb-2">No Markets Found</h3>
                <p className="text-muted-foreground mb-6">
                  {hasActiveFilters
                    ? "Try adjusting your filters to find more markets"
                    : `No active markets in ${tagLabel} right now`}
                </p>
                <Button onClick={() => router.push("/")}>
                  Explore All Markets
                </Button>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
