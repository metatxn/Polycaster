"use client";

import { motion } from "framer-motion";
import { ChevronLeft, Radio, Sparkles, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EventCard } from "@/components/event-card";
import { EventFilterBar } from "@/components/event-filter-bar";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEventFilters } from "@/context/event-filter-context";
import { usePaginatedEvents } from "@/hooks/use-paginated-events";
import { cn } from "@/lib/utils";

// ── Sports categories (matches Polymarket's full list) ──────────────

const SPORT_CATEGORIES = [
  { label: "All Sports", value: "", tagSlug: "sports" },
  { label: "NBA", value: "nba", tagSlug: "nba" },
  { label: "NCAAB", value: "ncaab", tagSlug: "ncaab" },
  { label: "NHL", value: "nhl", tagSlug: "nhl" },
  { label: "Soccer", value: "soccer", tagSlug: "soccer" },
  { label: "Esports", value: "esports", tagSlug: "esports" },
  { label: "Tennis", value: "tennis", tagSlug: "tennis" },
  { label: "Cricket", value: "cricket", tagSlug: "cricket" },
  { label: "UFC", value: "ufc", tagSlug: "ufc" },
  { label: "Football", value: "nfl", tagSlug: "nfl" },
  { label: "Baseball", value: "baseball", tagSlug: "baseball" },
  { label: "Rugby", value: "rugby", tagSlug: "rugby" },
  { label: "Lacrosse", value: "lacrosse", tagSlug: "lacrosse" },
  { label: "Boxing", value: "boxing", tagSlug: "boxing" },
  { label: "Golf", value: "golf", tagSlug: "golf" },
  { label: "Formula 1", value: "f1", tagSlug: "f1" },
  { label: "Table Tennis", value: "table-tennis", tagSlug: "table-tennis" },
  { label: "Chess", value: "chess", tagSlug: "chess" },
] as const;

interface EventWithDates {
  id: string;
  title: string;
  slug?: string;
  startDate?: string;
  endDate?: string;
}

export default function SportsPage() {
  const router = useRouter();
  const [loadMoreElement, setLoadMoreElement] = useState<HTMLDivElement | null>(
    null
  );
  const [selectedSport, setSelectedSport] = useState("");

  const { filters, serverFilterParams, apiQueryParams } = useEventFilters();

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
      if (!filters.dateRange.start && !filters.dateRange.end) return events;
      return events.filter((event) => {
        const s = event.startDate ? new Date(event.startDate) : null;
        const e = event.endDate ? new Date(event.endDate) : null;
        if (filters.dateRange.start && e && e < filters.dateRange.start)
          return false;
        if (filters.dateRange.end && s && s > filters.dateRange.end)
          return false;
        return true;
      });
    },
    [filters.dateRange]
  );

  // Resolve selected sport config
  const sport =
    SPORT_CATEGORIES.find((c) => c.value === selectedSport) ??
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
    active: apiQueryParams.active ?? true,
    closed: apiQueryParams.closed,
    tagSlug: effectiveTagSlug,
    filters: serverFilterParams,
  });

  const rawEvents =
    paginatedData?.pages.flatMap((page) => page.events || page) || [];
  const events = useMemo(
    () => applyDateFilter(rawEvents),
    [rawEvents, applyDateFilter]
  );

  // Infinite scroll
  useEffect(() => {
    if (!loadMoreElement) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: "400px" }
    );
    observer.observe(loadMoreElement);
    return () => observer.disconnect();
  }, [loadMoreElement, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden selection:bg-purple-500/30">
      <PageBackground />
      <Navbar />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8">
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
          <span className="text-foreground font-medium">Sports</span>
        </div>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-between mb-5"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl animate-pulse" />
              <div className="relative flex items-center justify-center w-11 h-11 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                <Radio className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
                Sports Markets
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Explore active sports prediction markets
              </p>
            </div>
          </div>
        </motion.div>

        {/* Sport Category Filters */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mb-1"
        >
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-3">
            {SPORT_CATEGORIES.map((cat) => {
              const isActive = selectedSport === cat.value;

              return (
                <button
                  type="button"
                  key={cat.value}
                  onClick={() => setSelectedSport(cat.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-full border whitespace-nowrap transition-all active:scale-[0.97] shrink-0",
                    isActive
                      ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15"
                      : "border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-muted/50"
                  )}
                >
                  <span
                    className={cn("font-semibold", isActive && "text-primary")}
                  >
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Filter Bar */}
        <EventFilterBar />

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Error */}
          {error && (
            <Card className="border-destructive/50 bg-destructive/5 backdrop-blur-sm mb-6">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Oops! Something went wrong
                </CardTitle>
                <CardDescription>
                  {error?.message || "Unable to load sports markets"}
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {/* Loading */}
          {isLoading && !error && (
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
          {!isLoading && events.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5">
                {events.map((event, index) => (
                  <EventCard
                    key={`${event.id}-${index}`}
                    event={event}
                    index={index}
                    priority={index < 4}
                  />
                ))}
              </div>

              {isFetchingNextPage && (
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

              {hasNextPage && (
                <div
                  ref={setLoadMoreElement}
                  className="h-20 w-full flex items-center justify-center"
                >
                  {isFetchingNextPage && (
                    <div className="flex gap-2">
                      <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                      <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                      <div className="w-2 h-2 rounded-full bg-primary animate-bounce" />
                    </div>
                  )}
                </div>
              )}

              {!hasNextPage && !isFetchingNextPage && events.length > 0 && (
                <div className="flex justify-center py-10 border-t border-border/10 mt-10">
                  <p className="text-sm text-muted-foreground bg-muted/30 px-4 py-2 rounded-full border border-border/20">
                    Showing all {events.length} {sport.label.toLowerCase()}{" "}
                    markets
                  </p>
                </div>
              )}
            </>
          )}

          {/* Empty */}
          {!isLoading && !error && events.length === 0 && (
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader className="text-center py-12">
                <div className="mx-auto w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                  <Star className="h-8 w-8 text-muted-foreground" />
                </div>
                <CardTitle className="text-xl">
                  No {sport.label} Markets
                </CardTitle>
                <CardDescription className="max-w-sm mx-auto">
                  No active markets found for {sport.label}. Try a different
                  sport or check back later.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </motion.div>
      </main>
    </div>
  );
}
