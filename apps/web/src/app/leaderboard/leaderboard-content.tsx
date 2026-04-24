"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { ProChromeHeader } from "@/components/app-pro-layout";
import { EditorialFooter } from "@/components/editorial-footer";
import { EditorialHero } from "@/components/editorial-hero";
import { FilterChip } from "@/components/event-filter-bar";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { Navbar } from "@/components/navbar";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import {
  type LeaderboardCategory,
  type LeaderboardOrderBy,
  type LeaderboardTimePeriod,
  type LeaderboardTrader,
  useLeaderboard,
} from "@/hooks/use-leaderboard";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { cn } from "@/lib/utils";

const CATEGORIES: {
  value: LeaderboardCategory;
  label: string;
}[] = [
  { value: "OVERALL", label: "Overall" },
  { value: "POLITICS", label: "Politics" },
  { value: "SPORTS", label: "Sports" },
  { value: "CRYPTO", label: "Crypto" },
  { value: "FINANCE", label: "Finance" },
  { value: "TECH", label: "Tech" },
  { value: "CULTURE", label: "Culture" },
  { value: "ECONOMICS", label: "Economics" },
  { value: "WEATHER", label: "Weather" },
  { value: "MENTIONS", label: "Mentions" },
];

const TIME_PERIODS: { value: LeaderboardTimePeriod; label: string }[] = [
  { value: "DAY", label: "Today" },
  { value: "WEEK", label: "This Week" },
  { value: "MONTH", label: "This Month" },
  { value: "ALL", label: "All Time" },
];

const ORDER_OPTIONS: { value: LeaderboardOrderBy; label: string }[] = [
  { value: "PNL", label: "Profit & Loss" },
  { value: "VOL", label: "Volume" },
];

const ITEMS_PER_PAGE = 25;

// Re-export type from server-cache for backwards compatibility
import type { InitialLeaderboardData } from "@/lib/server-cache";

export type { InitialLeaderboardData } from "@/lib/server-cache";

interface LeaderboardContentProps {
  initialData?: InitialLeaderboardData | null;
}

export function LeaderboardContent({ initialData }: LeaderboardContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address } = useConnection();
  const { proxyAddress } = useProxyWallet();

  // Get initial values from URL params
  const initialCategory =
    (searchParams.get("category") as LeaderboardCategory) || "OVERALL";
  const initialTimePeriod =
    (searchParams.get("timePeriod") as LeaderboardTimePeriod) || "DAY";
  const initialOrderBy =
    (searchParams.get("orderBy") as LeaderboardOrderBy) || "PNL";

  const [category, setCategory] =
    useState<LeaderboardCategory>(initialCategory);
  const [timePeriod, setTimePeriod] =
    useState<LeaderboardTimePeriod>(initialTimePeriod);
  const [orderBy, setOrderBy] = useState<LeaderboardOrderBy>(initialOrderBy);

  // Infinite-scroll pagination: fetch one page at a time from the hook
  // and accumulate results in local state. Filter changes reset both.
  const [page, setPage] = useState(1);
  const usingInitialSeed =
    !!initialData &&
    category === "OVERALL" &&
    timePeriod === "DAY" &&
    orderBy === "PNL";
  const [allTraders, setAllTraders] = useState<LeaderboardTrader[]>(() =>
    usingInitialSeed ? initialData.traders : []
  );

  const offset = (page - 1) * ITEMS_PER_PAGE;

  // Skip the client-side fetch for the seeded first page — the SSR'd
  // traders are already rendered.
  const skipInitialQuery = page === 1 && usingInitialSeed;
  const { data, isLoading, error } = useLeaderboard({
    category,
    timePeriod,
    orderBy,
    limit: ITEMS_PER_PAGE,
    offset,
    enabled: !skipInitialQuery,
  });

  // Accumulate traders as pages arrive. Dedupe on proxyWallet so a
  // rapid filter-change race can't insert the same trader twice.
  useEffect(() => {
    if (!data?.traders) return;
    setAllTraders((prev) => {
      if (page === 1) return data.traders;
      const seen = new Set(prev.map((t) => t.proxyWallet));
      const fresh = data.traders.filter((t) => !seen.has(t.proxyWallet));
      return [...prev, ...fresh];
    });
  }, [data, page]);

  // hasMore: the most recent fetched page was full. We don't know the
  // absolute total from the API so we stop loading when the server
  // returns a short page.
  const lastPageSize =
    data?.traders?.length ?? initialData?.traders?.length ?? 0;
  const hasMore = lastPageSize === ITEMS_PER_PAGE;

  const userAddress = proxyAddress || address;

  // Update URL when filters change (page is no longer a URL param —
  // infinite scroll is stateful to the session, not shareable).
  const updateURL = useCallback(
    (newParams: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      for (const [key, value] of Object.entries(newParams)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      router.push(`/leaderboard?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const resetPagination = () => {
    setPage(1);
    setAllTraders([]);
  };

  const handleCategoryChange = (value: LeaderboardCategory) => {
    setCategory(value);
    resetPagination();
    updateURL({ category: value });
  };

  const handleTimePeriodChange = (value: LeaderboardTimePeriod) => {
    setTimePeriod(value);
    resetPagination();
    updateURL({ timePeriod: value });
  };

  const handleOrderByChange = (value: LeaderboardOrderBy) => {
    setOrderBy(value);
    resetPagination();
    updateURL({ orderBy: value });
  };

  // Infinite-scroll sentinel. Fires `setPage(p + 1)` when the element
  // enters the viewport (with a 400px pre-load margin) and we're
  // neither mid-load nor at the end.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (isLoading || !hasMore || allTraders.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isLoading, hasMore, allTraders.length]);

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-x-hidden selection:bg-foreground/15">
      <Navbar />
      <ProChromeHeader />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
        <EditorialHero
          breadcrumbs={[
            { label: "Markets", href: "/markets" },
            { label: "Leaderboard" },
          ]}
          title={<span>Leaderboard</span>}
          subtitle="Who's making money on Polymarket — and who's losing it. Ranked by realised P&L, refreshed every page load."
        />

        {/* Category row — italic Fraunces anchors the active category,
            mono sans keeps the rest in editorial voice. Icons removed
            so the typography itself carries the weight. */}
        <div className="flex items-baseline gap-5 sm:gap-6 overflow-x-auto scrollbar-hide mb-3 -mt-2 pb-2 border-b border-border/40">
          {CATEGORIES.map((cat) => {
            const isActive = category === cat.value;
            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => handleCategoryChange(cat.value)}
                className={cn(
                  "shrink-0 whitespace-nowrap transition-colors",
                  isActive
                    ? "font-editorial italic text-lg sm:text-xl leading-none text-foreground"
                    : "font-mono text-[11px] uppercase tracking-[0.14em] leading-none text-muted-foreground hover:text-foreground"
                )}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 py-1">
          <div className="flex items-center gap-1">
            <FilterChip
              label="Period"
              value={
                TIME_PERIODS.find((p) => p.value === timePeriod)?.label ?? "—"
              }
              isActive={timePeriod !== "DAY"}
            >
              <DropdownMenuContent align="start" className="w-40">
                {TIME_PERIODS.map((period) => (
                  <DropdownMenuCheckboxItem
                    key={period.value}
                    checked={timePeriod === period.value}
                    onCheckedChange={() => handleTimePeriodChange(period.value)}
                  >
                    {period.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </FilterChip>
            <FilterChip
              label="Rank By"
              value={
                ORDER_OPTIONS.find((o) => o.value === orderBy)?.label ?? "—"
              }
              isActive={orderBy !== "PNL"}
            >
              <DropdownMenuContent align="start" className="w-44">
                {ORDER_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={orderBy === option.value}
                    onCheckedChange={() => handleOrderByChange(option.value)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </FilterChip>
          </div>

          {allTraders.length > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
              1–{allTraders.length}
            </span>
          )}
        </div>

        {/* Error State */}
        {error && (
          <div className="text-center py-12 border-y border-destructive/30">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-destructive mb-3">
              Failed to load leaderboard
            </p>
            <p className="font-editorial italic text-lg text-muted-foreground mb-4 max-w-md mx-auto">
              {error.message || "Something went wrong"}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground hover:text-destructive transition-colors underline underline-offset-4 decoration-border"
            >
              Try again
            </button>
          </div>
        )}

        {/* Leaderboard Table — accumulates across pages via infinite
            scroll. The key only changes on filter change so new pages
            don't retrigger the fade-in animation on every append. */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${category}-${timePeriod}-${orderBy}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <LeaderboardTable
              traders={allTraders}
              isLoading={isLoading && allTraders.length === 0}
              orderBy={orderBy}
              highlightAddress={userAddress}
            />
          </motion.div>
        </AnimatePresence>

        {/* Infinite-scroll sentinel + status strip */}
        {allTraders.length > 0 && (
          <>
            <div ref={sentinelRef} aria-hidden className="h-1" />
            <div className="flex items-center justify-center py-8 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
              {isLoading && page > 1 ? (
                <span>Loading more…</span>
              ) : hasMore ? (
                <span>Scroll for more</span>
              ) : (
                <span>§&nbsp;&nbsp;End of leaderboard</span>
              )}
            </div>
          </>
        )}
      </main>

      <EditorialFooter />
    </div>
  );
}
