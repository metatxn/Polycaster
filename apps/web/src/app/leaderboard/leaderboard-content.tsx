"use client";

import { AnimatePresence, m } from "framer-motion";
import { useRouter } from "next/navigation";
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
import { useNow } from "@/hooks/use-now";
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
      onCloseAutoFocus={(event) => {
        // Radix re-focuses the trigger when the menu closes, and the
        // browser's native focus-reveal scrolls (centers) the trigger back
        // into view — if the user has scrolled the filter chip off-screen
        // this yanks the viewport back up (scrollY clamps to 0 here).
        // Re-focus manually with preventScroll so keyboard users keep
        // their tab position without the page jumping. The content's
        // aria-labelledby is the trigger's id (Radix wires it up).
        event.preventDefault();
        const content = event.target as HTMLElement | null;
        const triggerId = content?.getAttribute("aria-labelledby");
        const trigger = triggerId ? document.getElementById(triggerId) : null;
        trigger?.focus({ preventScroll: true });
      }}
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

/** Ticking "updated Xs ago" leaf — re-renders only this label (every 5s)
 *  instead of the whole leaderboard page (every second). */
function LeaderboardDataAge({ updatedAt }: { updatedAt: number }) {
  const now = useNow(5_000);
  return <ProductDataAge dataAgeMs={now - updatedAt} />;
}

interface LeaderboardContentProps {
  initialData?: InitialLeaderboardData | null;
  /** Initial filter values read server-side from searchParams to avoid
   *  re-suspending useSearchParams() on every URL change (which resets scroll). */
  initialCategory?: LeaderboardCategory;
  initialTimePeriod?: LeaderboardTimePeriod;
  initialOrderBy?: LeaderboardOrderBy;
}

export function LeaderboardContent({
  initialData,
  initialCategory: initialCategoryProp = "OVERALL",
  initialTimePeriod: initialTimePeriodProp = "DAY",
  initialOrderBy: initialOrderByProp = "PNL",
}: LeaderboardContentProps) {
  const router = useRouter();
  const { address } = useConnection();
  const { proxyAddress } = useProxyWallet();

  const [category, setCategory] =
    useState<LeaderboardCategory>(initialCategoryProp);
  const [timePeriod, setTimePeriod] = useState<LeaderboardTimePeriod>(
    initialTimePeriodProp
  );
  const [orderBy, setOrderBy] =
    useState<LeaderboardOrderBy>(initialOrderByProp);

  // Infinite-scroll pagination: fetch one page at a time from the hook
  // and accumulate results in local state.
  const [page, setPage] = useState(1);

  // The SSR seed only stands in for the default view's FIRST page-1 fetch.
  // Once the user changes any filter the seed rows are replaced, so coming
  // back to the default combination must run a real query — otherwise the
  // query stays disabled and the previous filter's rows linger forever.
  const [seedConsumed, setSeedConsumed] = useState(false);

  // Filter changes deliberately do NOT clear `allTraders`: the query keeps
  // the previous rows via `keepPreviousData`, and the accumulation effect
  // below swaps them once fresh page-1 data lands. Clearing here would
  // collapse the table to a short skeleton mid-fetch, shrink the document,
  // and let the browser clamp scrollY to 0.
  const resetPagination = () => {
    setPage(1);
    setSeedConsumed(true);
  };

  // Sync filter state when the server-provided props change. On browser
  // back/forward (popstate) Next re-renders page.tsx with the restored
  // URL's searchParams, but useState ignores prop changes after mount —
  // without this the URL and the rendered view desync. This is React's
  // "adjust state during render" pattern (intentionally not an effect, so
  // children never see the stale frame). When the user changes a dropdown
  // the handlers set state BEFORE pushing the URL, so the props that come
  // back equal current state and the inner sync no-ops.
  const [prevInitial, setPrevInitial] = useState({
    category: initialCategoryProp,
    timePeriod: initialTimePeriodProp,
    orderBy: initialOrderByProp,
  });
  if (
    prevInitial.category !== initialCategoryProp ||
    prevInitial.timePeriod !== initialTimePeriodProp ||
    prevInitial.orderBy !== initialOrderByProp
  ) {
    setPrevInitial({
      category: initialCategoryProp,
      timePeriod: initialTimePeriodProp,
      orderBy: initialOrderByProp,
    });
    // Only force state when it actually differs from the URL — a late RSC
    // response for a dropdown change the client already applied must not
    // reset pagination the user has since scrolled through.
    if (
      category !== initialCategoryProp ||
      timePeriod !== initialTimePeriodProp ||
      orderBy !== initialOrderByProp
    ) {
      setCategory(initialCategoryProp);
      setTimePeriod(initialTimePeriodProp);
      setOrderBy(initialOrderByProp);
      // Mirror exactly what the dropdown handlers do on a filter change.
      resetPagination();
    }
  }

  const usingInitialSeed =
    !!initialData &&
    !seedConsumed &&
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
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    isPlaceholderData,
    dataUpdatedAt,
  } = useLeaderboard({
    category,
    timePeriod,
    orderBy,
    limit: ITEMS_PER_PAGE,
    offset,
    enabled: !skipInitialQuery,
  });

  // When seeded from SSR the first client fetch is skipped, so
  // dataUpdatedAt stays 0 until the first refetch — fall back to the
  // mount timestamp so the meta still reads sensibly on arrival.
  // The "updated Xs ago" ticking lives in the LeaderboardDataAge leaf so
  // it doesn't re-render the whole page every second.
  const [mountedAt] = useState(() => Date.now());
  const effectiveUpdatedAt = dataUpdatedAt || mountedAt;

  // Accumulate traders as pages arrive. Dedupe on proxyWallet so a
  // rapid filter-change race can't insert the same trader twice.
  // Placeholder frames are skipped: with `keepPreviousData` the hook
  // re-serves the PREVIOUS queryKey's rows while a new filter/page is in
  // flight — acting on those here would overwrite the accumulated list
  // with stale data (e.g. replace 3 accumulated pages with the old
  // combo's last page). Page-1 of a new filter combo therefore swaps the
  // old rows only once real data for that combo lands.
  useEffect(() => {
    if (!data?.traders || isPlaceholderData) return;
    setAllTraders((prev) => {
      if (page === 1) return data.traders;
      const seen = new Set(prev.map((t) => t.proxyWallet));
      const fresh = data.traders.filter((t) => !seen.has(t.proxyWallet));
      return [...prev, ...fresh];
    });
  }, [data, page, isPlaceholderData]);

  // hasMore: the most recent fetched page was full. We don't know the
  // absolute total from the API so we stop loading when the server
  // returns a short page.
  const lastPageSize =
    data?.traders?.length ??
    (usingInitialSeed ? initialData.traders.length : 0);
  const hasMore = lastPageSize === ITEMS_PER_PAGE;

  const userAddress = proxyAddress || address;

  // Update URL when filters change (page is no longer a URL param —
  // infinite scroll is stateful to the session, not shareable).
  // Build params from current local state + overrides so we never need
  // useSearchParams() here — that hook would re-suspend the Suspense
  // boundary on every URL change and cause a scroll-to-0 reset.
  const updateURL = useCallback(
    (newParams: Record<string, string>) => {
      const params = new URLSearchParams();
      // Seed from current local state
      if (category !== "OVERALL") params.set("category", category);
      if (timePeriod !== "DAY") params.set("timePeriod", timePeriod);
      if (orderBy !== "PNL") params.set("orderBy", orderBy);
      // Apply overrides
      for (const [key, value] of Object.entries(newParams)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      const qs = params.toString();
      router.push(`/leaderboard${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, category, timePeriod, orderBy]
  );

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
  // neither mid-load nor at the end. `isPlaceholderData` also blocks it:
  // while a new filter/page is fetching, `data` (and thus `hasMore`)
  // describes the previous queryKey, so advancing the page would skip the
  // pending page-1 swap and append onto stale rows.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    // `error` blocks re-arming: with old rows kept on screen during a
    // failed fetch, an armed sentinel would keep incrementing the page
    // against a failing API. The error strip's "Try again" is the retry.
    if (
      isLoading ||
      isPlaceholderData ||
      error ||
      !hasMore ||
      allTraders.length === 0
    )
      return;
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
  }, [isLoading, isPlaceholderData, error, hasMore, allTraders.length]);

  return (
    <div className="kw-app min-h-screen flex flex-col bg-(--kwm-bg) relative overflow-x-hidden selection:bg-(--kwm-ink)/15">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
        <h1 className="sr-only">Leaderboard</h1>

        <ProductHero
          breadcrumbs={[
            { label: "Markets", href: "/markets" },
            { label: "Leaderboard" },
          ]}
          rightSlot={
            <>
              <LeaderboardDataAge updatedAt={effectiveUpdatedAt} />
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
                aria-pressed={isActive}
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
          <m.div
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
          </m.div>
        </AnimatePresence>

        {/* Infinite-scroll sentinel + status strip */}
        {allTraders.length > 0 && (
          <>
            <div ref={sentinelRef} aria-hidden className="h-1" />
            <div className="flex items-center justify-center py-8 font-mono text-[10px] uppercase tracking-[0.2em] text-(--kwm-ink-3)">
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
