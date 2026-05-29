"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { VList } from "virtua";
import type { WhaleActivity } from "@/hooks/use-whale-activity";
import { formatCurrencyCompact } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { ActivitySideFilter, ActivitySortColumn } from "../_lib/constants";
import {
  displayName,
  formatTimeAgo,
  isAnimatedImageUrl,
} from "../_lib/formatters";

interface ActivityLedgerProps {
  activities: WhaleActivity[];
  sort: { column: ActivitySortColumn; direction: "asc" | "desc" };
  onSortChange: (col: ActivitySortColumn) => void;

  sideFilter: ActivitySideFilter;
  onSideFilterChange: (v: ActivitySideFilter) => void;

  marketFilter: string | null;
  onMarketFilterChange: (v: string | null) => void;

  /** Human-readable label of the active market filter (for the chip
   *  that sits at the top of the ledger). */
  marketFilterLabel: string | null;

  walletSearch: string;
}

/**
 * Full-width ledger of every whale trade in the window. Columns read
 * left-to-right like a broker tape: Time / Wallet / Side / Market /
 * Size / Price / Amount. Virtualized via `virtua` so 1000+ rows stay
 * smooth.
 */
export function ActivityLedger({
  activities,
  sort,
  onSortChange,
  sideFilter,
  onSideFilterChange,
  marketFilter,
  onMarketFilterChange,
  marketFilterLabel,
  walletSearch,
}: ActivityLedgerProps) {
  const filtered = useMemo(() => {
    const q = walletSearch.trim().toLowerCase();

    let out = activities;
    if (marketFilter) {
      out = out.filter(
        (a) =>
          a.market.conditionId === marketFilter ||
          a.market.slug === marketFilter
      );
    }
    if (sideFilter !== "all") {
      const target = sideFilter.toUpperCase();
      out = out.filter((a) => a.trade.side === target);
    }
    if (q) {
      out = out.filter(
        (a) =>
          a.trader.address.toLowerCase().includes(q) ||
          a.trader.name?.toLowerCase().includes(q) ||
          a.market.title.toLowerCase().includes(q)
      );
    }

    const sorted = [...out];
    sorted.sort((a, b) => {
      let diff = 0;
      switch (sort.column) {
        case "time":
          diff =
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
        case "amount":
          diff = a.trade.usdcAmount - b.trade.usdcAmount;
          break;
        case "price":
          diff = a.trade.price - b.trade.price;
          break;
      }
      return sort.direction === "asc" ? diff : -diff;
    });
    return sorted;
  }, [activities, marketFilter, sideFilter, walletSearch, sort]);

  return (
    <section className="flex flex-col">
      <header className="flex items-end justify-between flex-wrap gap-3 pb-3 border-b border-(--kwm-hl)">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
            § Activity Ledger
          </span>
          <span className="text-(--kwm-ink-dim)">·</span>
          <span className="font-(family-name:--font-geist) text-[18px] font-semibold tracking-tight text-(--kwm-ink) tabular-nums leading-none">
            {filtered.length}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) translate-y-[-2px]">
            {filtered.length === 1 ? "trade" : "trades"}
          </span>
        </div>

        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) tabular-nums">
          {/* Side filter */}
          <div className="inline-flex items-center gap-1">
            <span>Side</span>
            {(["all", "buy", "sell"] as const).map((side) => {
              const label =
                side === "all" ? "All" : side === "buy" ? "Buy" : "Sell";
              const isActive = sideFilter === side;
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => onSideFilterChange(side)}
                  className={cn(
                    "relative inline-grid place-items-center px-1.5 py-1 transition-colors",
                    isActive ? "text-(--kwm-ink)" : "hover:text-(--kwm-ink)"
                  )}
                >
                  <span
                    aria-hidden
                    className="col-start-1 row-start-1 invisible font-semibold"
                  >
                    {label}
                  </span>
                  <span
                    className={cn(
                      "col-start-1 row-start-1",
                      isActive && "font-semibold"
                    )}
                  >
                    {label}
                  </span>
                  {isActive && (
                    <span className="absolute inset-x-1 -bottom-px h-px bg-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {marketFilterLabel && (
        <div className="mb-3 inline-flex items-center self-start gap-2 px-2.5 py-1 border border-(--kwm-hl-2)/70 rounded-sm font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
          <span>Filtered by market:</span>
          <span className="text-(--kwm-ink) normal-case font-sans font-medium tracking-normal">
            {marketFilterLabel}
          </span>
          <button
            type="button"
            onClick={() => onMarketFilterChange(null)}
            aria-label="Clear market filter"
            className="text-(--kwm-ink-3) hover:text-(--kwm-ink) transition-colors"
          >
            ×
          </button>
        </div>
      )}

      <div className="border-y border-(--kwm-hl-2)">
        {/* Column headers */}
        <div className="hidden sm:grid grid-cols-[84px_minmax(0,1fr)_52px_minmax(0,1.5fr)_80px_64px_96px] gap-3 px-3 py-2 border-b border-(--kwm-hl) font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
          <HeaderCell
            label="Time"
            column="time"
            sort={sort}
            onSort={onSortChange}
          />
          <span>Wallet</span>
          <span>Side</span>
          <span>Market</span>
          <span className="text-right">Size</span>
          <HeaderCell
            label="Price"
            column="price"
            sort={sort}
            onSort={onSortChange}
            align="right"
          />
          <HeaderCell
            label="Amount"
            column="amount"
            sort={sort}
            onSort={onSortChange}
            align="right"
          />
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <p className="py-10 px-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
            No trades match these filters
          </p>
        ) : (
          <VList style={{ height: 560 }}>
            {filtered.map((a) => (
              <ActivityRowItem key={a.id} activity={a} />
            ))}
          </VList>
        )}
      </div>
    </section>
  );
}

function ActivityRowItem({ activity }: { activity: WhaleActivity }) {
  const display = displayName(activity.trader.name, activity.trader.address);
  const isBuy = activity.trade.side === "BUY";
  const marketHref = `/events/detail/${activity.market.eventSlug || activity.market.slug}`;

  return (
    <div className="px-3 py-3 sm:py-2 border-b border-(--kwm-hl) text-sm hover:bg-(--kwm-bg-2) transition-colors">
      {/* Desktop: 7-column grid */}
      <div className="hidden sm:grid grid-cols-[84px_minmax(0,1fr)_52px_minmax(0,1.5fr)_80px_64px_96px] gap-3 items-center">
        <span className="font-mono text-[11px] tabular-nums text-(--kwm-ink-3)">
          {formatTimeAgo(activity.timestamp)}
        </span>

        <Link
          href={`/profile/${activity.trader.address}`}
          className="flex items-center gap-2 min-w-0 hover:text-(--kwm-ink) group/wallet"
        >
          <div className="relative w-5 h-5 shrink-0 rounded-sm overflow-hidden bg-(--kwm-bg-3)">
            {activity.trader.profileImage ? (
              <Image
                src={activity.trader.profileImage}
                alt={display}
                fill
                sizes="20px"
                className="object-cover"
                unoptimized={isAnimatedImageUrl(activity.trader.profileImage)}
              />
            ) : (
              <span className="w-full h-full flex items-center justify-center font-mono text-[8px] font-semibold text-(--kwm-ink)/40">
                {activity.trader.address.slice(2, 4).toUpperCase()}
              </span>
            )}
          </div>
          <span className="truncate text-(--kwm-ink) font-medium">
            {display}
          </span>
        </Link>

        <span
          className={cn(
            "inline-flex items-center justify-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] rounded-sm w-fit",
            isBuy
              ? "bg-foreground text-background"
              : "bg-(--kwm-panel) border border-(--kwm-ink)/60 text-(--kwm-ink)"
          )}
        >
          {activity.trade.side}
        </span>

        <Link
          href={marketHref}
          className="truncate text-(--kwm-ink)/85 hover:text-(--kwm-ink) transition-colors"
          title={activity.market.title}
        >
          <span className="truncate block">{activity.market.title}</span>
          {activity.trade.outcome && (
            <span className="block font-mono text-[10px] tabular-nums text-(--kwm-ink-3)">
              {activity.trade.outcome}
            </span>
          )}
        </Link>

        <span className="text-right font-mono tabular-nums text-(--kwm-ink-2)">
          {activity.trade.size.toFixed(0)}
        </span>

        <span className="text-right font-mono tabular-nums text-(--kwm-ink-2)">
          {(activity.trade.price * 100).toFixed(0)}¢
        </span>

        <span className="text-right font-mono tabular-nums font-semibold text-(--kwm-ink)">
          {formatCurrencyCompact(activity.trade.usdcAmount)}
        </span>
      </div>

      {/* Mobile: stacked — time+side+amount / wallet / market+price */}
      <div className="sm:hidden flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3) tabular-nums">
              {formatTimeAgo(activity.timestamp)}
            </span>
            <span
              className={cn(
                "inline-flex items-center justify-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] rounded-sm w-fit",
                isBuy
                  ? "bg-foreground text-background"
                  : "bg-(--kwm-panel) border border-(--kwm-ink)/60 text-(--kwm-ink)"
              )}
            >
              {activity.trade.side}
            </span>
          </div>
          <span className="font-mono tabular-nums font-semibold text-(--kwm-ink)">
            {formatCurrencyCompact(activity.trade.usdcAmount)}
          </span>
        </div>

        <Link
          href={`/profile/${activity.trader.address}`}
          className="flex items-center gap-2 min-w-0 group/wallet"
        >
          <div className="relative w-5 h-5 shrink-0 rounded-sm overflow-hidden bg-(--kwm-bg-3)">
            {activity.trader.profileImage ? (
              <Image
                src={activity.trader.profileImage}
                alt={display}
                fill
                sizes="20px"
                className="object-cover"
                unoptimized={isAnimatedImageUrl(activity.trader.profileImage)}
              />
            ) : (
              <span className="w-full h-full flex items-center justify-center font-mono text-[8px] font-semibold text-(--kwm-ink)/40">
                {activity.trader.address.slice(2, 4).toUpperCase()}
              </span>
            )}
          </div>
          <span className="truncate text-(--kwm-ink) font-medium">
            {display}
          </span>
        </Link>

        <Link
          href={marketHref}
          className="block min-w-0"
          title={activity.market.title}
        >
          <span className="block truncate text-(--kwm-ink)/85 hover:text-(--kwm-ink) transition-colors">
            {activity.market.title}
          </span>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
            {activity.trade.outcome && (
              <span className="tabular-nums">
                {activity.trade.outcome}{" "}
                <span className="text-(--kwm-ink-2)">
                  @ {(activity.trade.price * 100).toFixed(0)}¢
                </span>
              </span>
            )}
            <span aria-hidden className="text-border/80">
              ·
            </span>
            <span className="tabular-nums normal-case">
              {activity.trade.size.toFixed(0)} sh
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}

function HeaderCell({
  label,
  column,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  column: ActivitySortColumn;
  sort: { column: ActivitySortColumn; direction: "asc" | "desc" };
  onSort: (col: ActivitySortColumn) => void;
  align?: "left" | "right";
}) {
  const isActive = sort.column === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={cn(
        "inline-flex items-center gap-1 transition-colors hover:text-(--kwm-ink)",
        align === "right" && "justify-end",
        isActive && "text-(--kwm-ink)"
      )}
    >
      <span>{label}</span>
      {isActive && (
        <span aria-hidden>
          {sort.direction === "desc" ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          )}
        </span>
      )}
    </button>
  );
}
