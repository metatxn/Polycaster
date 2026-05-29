"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { ChromeHeader } from "@/components/app-layout";
import { FilterChip } from "@/components/event-filter-bar";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { Navbar } from "@/components/navbar";
import { ProductFooter } from "@/components/product-footer";
import {
  ProductDataAge,
  ProductHero,
  ProductRefreshButton,
} from "@/components/product-hero";
import {
  DropdownMenuContent,
  DropdownMenuItem,
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
  { value: "PNL", label: "P&L" },
  { value: "VOL", label: "Volume" },
];

const ITEMS_PER_PAGE = 25;

// Re-export type from server-cache for backwards compatibility
import type { InitialLeaderboardData } from "@/lib/server-cache";

export type { InitialLeaderboardData } from "@/lib/server-cache";

/**
 * Editorial dropdown menu — replaces shadcn's `DropdownMenuCheckboxItem`
 * (radio-dot check marks, rounded panel) with mono-caps items and an
 * underline-active marker that matches the rest of the editorial voice.
 */
function EditorialDropdown<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <DropdownMenuContent
      align="start"
      className="min-w-36 rounded-none border border-(--kwm-hl-2) bg-(--kwm-panel) backdrop-blur-sm p-0 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
    >
      {options.map((option) => {
        const isActive = selected === option.value;
        return (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onSelect(option.value)}
            className={cn(
              "rounded-none px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] focus:bg-foreground/5 focus:text-(--kwm-ink)",
              isActive ? "text-(--kwm-ink)" : "text-(--kwm-ink-3)"
            )}
          >
            <span
              className={cn(
                "relative",
                isActive &&
                  "after:absolute after:left-0 after:-bottom-0.5 after:h-px after:w-full after:bg-foreground"
              )}
            >
              {option.label}
            </span>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  );
}

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
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } =
    useLeaderboard({
      category,
      timePeriod,
      orderBy,
      limit: ITEMS_PER_PAGE,
      offset,
      enabled: !skipInitialQuery,
    });

  // Tick the "updated Xs ago" meta so it counts forward between refetches.
  // When seeded from SSR the first client fetch is skipped, so
  // dataUpdatedAt stays 0 until the first refetch — fall back to the
  // mount timestamp so the meta still reads sensibly on arrival.
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const effectiveUpdatedAt = dataUpdatedAt || mountedAt;
  const dataAgeMs = now - effectiveUpdatedAt;

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
    <div className="kw-app min-h-screen flex flex-col bg-(--kwm-bg) relative overflow-x-hidden selection:bg-(--kwm-ink)/15">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
        <ProductHero
          breadcrumbs={[
            { label: "Markets", href: "/markets" },
            { label: "Leaderboard" },
          ]}
          rightSlot={
            <>
              <ProductDataAge dataAgeMs={dataAgeMs} />
              <ProductRefreshButton
                onRefresh={() => refetch()}
                isFetching={isFetching}
              />
            </>
          }
        />

        {/* Category row — DeFi tabs. Active category gets a green
            underline; mono micro-caps across the board so the rhythm
            stays consistent with the rest of the product surface. */}
        <div
          className="flex items-center gap-5 sm:gap-6 overflow-x-auto scrollbar-hide mb-4 -mt-1 pb-2 border-b"
          style={{ borderColor: "var(--kwm-hl)" }}
        >
          {CATEGORIES.map((cat) => {
            const isActive = category === cat.value;
            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => handleCategoryChange(cat.value)}
                className={cn(
                  "shrink-0 whitespace-nowrap py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] leading-none transition-colors relative"
                )}
                style={{
                  color: isActive ? "var(--kwm-up)" : "var(--kwm-ink-3)",
                }}
              >
                {cat.label}
                {isActive && (
                  <span
                    className="absolute left-0 right-0 bottom-[-9px] h-px"
                    style={{ background: "var(--kwm-up)" }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 py-1 kwm-pills">
          <div className="flex items-center gap-1">
            <FilterChip
              label="Period"
              value={
                TIME_PERIODS.find((p) => p.value === timePeriod)?.label ?? "—"
              }
              isActive={timePeriod !== "DAY"}
            >
              <EditorialDropdown
                options={TIME_PERIODS}
                selected={timePeriod}
                onSelect={handleTimePeriodChange}
              />
            </FilterChip>
            <FilterChip
              label="Rank By"
              value={
                ORDER_OPTIONS.find((o) => o.value === orderBy)?.label ?? "—"
              }
              isActive={orderBy !== "PNL"}
            >
              <EditorialDropdown
                options={ORDER_OPTIONS}
                selected={orderBy}
                onSelect={handleOrderByChange}
              />
            </FilterChip>
          </div>

          {allTraders.length > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) tabular-nums">
              1–{allTraders.length}
            </span>
          )}
        </div>

        {/* Error State */}
        {error && (
          <div className="py-12 border-y border-destructive/30">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-destructive mb-3">
              Failed to load leaderboard
            </p>
            <p className="font-editorial text-lg leading-snug text-(--kwm-ink) mb-4 max-w-md">
              {error.message || "Something went wrong"}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-ink) hover:text-destructive transition-colors underline underline-offset-4 decoration-border"
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
            <div className="flex items-center justify-center py-8 font-mono text-[10px] uppercase tracking-[0.2em] text-(--kwm-ink-3)/70">
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

      <ProductFooter context="Leaderboard" />
    </div>
  );
}
