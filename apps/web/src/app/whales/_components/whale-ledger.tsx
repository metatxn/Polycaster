"use client";

import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { formatCurrencyCompact } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  isBigBetWhale,
  isDirectionalWhale,
  type WhaleRow,
} from "../_lib/aggregates";
import type { WhaleSortColumn, WhaleTypeFilter } from "../_lib/constants";
import {
  displayName,
  formatAddress,
  formatTimeAgo,
  isAnimatedImageUrl,
  isRawAddressLike,
} from "../_lib/formatters";
import { WhaleIcon } from "./whale-icon";

interface WhaleLedgerProps {
  whales: WhaleRow[];
  sort: { column: WhaleSortColumn; direction: "asc" | "desc" };
  onSortChange: (col: WhaleSortColumn) => void;
  walletSearch: string;
  typeFilter: WhaleTypeFilter;
}

/**
 * Sortable broadsheet-style ledger of whale traders. Each row is one
 * trader address with aggregated in-window activity. Click a column
 * header to sort; click the row to open the profile drilldown.
 */
export function WhaleLedger({
  whales,
  sort,
  onSortChange,
  walletSearch,
  typeFilter,
}: WhaleLedgerProps) {
  const filtered = useMemo(() => {
    const q = walletSearch.trim().toLowerCase();
    let base = whales;

    if (typeFilter === "big") {
      base = base.filter(isBigBetWhale);
    } else if (typeFilter === "directional") {
      base = base.filter(isDirectionalWhale);
    }

    if (q) {
      base = base.filter(
        (w) =>
          w.address.toLowerCase().includes(q) ||
          w.name?.toLowerCase().includes(q)
      );
    }

    const sorted = [...base];
    sorted.sort((a, b) => {
      let diff = 0;
      switch (sort.column) {
        case "volume":
          diff = a.totalVolume - b.totalVolume;
          break;
        case "trades":
          diff = a.tradeCount - b.tradeCount;
          break;
        case "buyRatio":
          diff = a.buyRatio - b.buyRatio;
          break;
        case "markets":
          diff = a.marketCount - b.marketCount;
          break;
        case "lastActive":
          diff =
            new Date(a.lastActiveTimestamp).getTime() -
            new Date(b.lastActiveTimestamp).getTime();
          break;
      }
      return sort.direction === "asc" ? diff : -diff;
    });
    return sorted;
  }, [whales, walletSearch, sort, typeFilter]);

  return (
    <section className="flex flex-col">
      <header className="flex items-baseline justify-between pb-3">
        <h2 className="font-editorial italic text-xl sm:text-2xl text-foreground inline-flex items-center gap-2">
          <WhaleIcon className="h-5 w-auto text-foreground/80 -translate-y-px" />
          Whale Ledger
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
          {filtered.length} {filtered.length === 1 ? "trader" : "traders"}
        </span>
      </header>

      <div className="border-y border-border/60">
        {/* Column headers */}
        <div className="hidden sm:grid grid-cols-[auto_minmax(0,1fr)_100px_100px_72px_72px_72px] gap-3 px-3 py-2 border-b border-border/40 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="w-6 text-right">#</span>
          <span>Wallet</span>
          <HeaderCell
            label="Volume"
            column="volume"
            sort={sort}
            onSort={onSortChange}
            align="right"
          />
          <HeaderCell
            label="Buy / Sell"
            column="buyRatio"
            sort={sort}
            onSort={onSortChange}
            align="right"
          />
          <HeaderCell
            label="Trades"
            column="trades"
            sort={sort}
            onSort={onSortChange}
            align="right"
          />
          <HeaderCell
            label="Markets"
            column="markets"
            sort={sort}
            onSort={onSortChange}
            align="right"
          />
          <HeaderCell
            label="Last"
            column="lastActive"
            sort={sort}
            onSort={onSortChange}
            align="right"
          />
        </div>

        {/* Rows */}
        <div className="divide-y divide-border/40">
          {filtered.length === 0 ? (
            <EmptyRow query={walletSearch} />
          ) : (
            filtered.map((w, i) => (
              <WhaleRowItem key={w.address} row={w} index={i} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function WhaleRowItem({ row, index }: { row: WhaleRow; index: number }) {
  const display = displayName(row.name, row.address);
  const hasRealName = !!row.name && !isRawAddressLike(row.name);
  const buyPct = Math.round(row.buyRatio * 100);
  const sellPct = 100 - buyPct;
  const isBig = isBigBetWhale(row);
  const isDirectional = isDirectionalWhale(row);

  return (
    <Link
      href={`/profile/${row.address}`}
      className="group block px-3 py-3 sm:py-2.5 hover:bg-muted/40 transition-colors text-sm"
    >
      {/* Desktop: 7-column hairline grid. Mobile falls through to the
          stacked block below. */}
      <div className="hidden sm:grid grid-cols-[auto_minmax(0,1fr)_100px_100px_72px_72px_72px] gap-3 items-center">
        <span className="w-6 font-mono text-[11px] tabular-nums text-muted-foreground text-right">
          {index + 1}
        </span>

        <div className="flex items-center gap-2 min-w-0">
          <div className="relative w-6 h-6 shrink-0 rounded-sm overflow-hidden bg-muted">
            {row.profileImage ? (
              <Image
                src={row.profileImage}
                alt={display}
                fill
                sizes="24px"
                className="object-cover"
                unoptimized={isAnimatedImageUrl(row.profileImage)}
              />
            ) : (
              <span className="w-full h-full flex items-center justify-center font-mono text-[9px] font-semibold text-foreground/40">
                {row.address.slice(2, 4).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex items-baseline gap-2">
            <span className="truncate font-medium text-foreground group-hover:text-foreground">
              {display}
            </span>
            {hasRealName && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
                {formatAddress(row.address)}
              </span>
            )}
          </div>
          {isBig && (
            <span
              title={`Single trade ≥ ${formatCurrencyCompact(row.biggestTrade)}`}
              className="shrink-0 inline-flex items-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] bg-foreground/85 text-background rounded-sm"
            >
              Big
            </span>
          )}
          {isDirectional && (
            <span
              title={`Net ${row.netDirection === "buy" ? "buyer" : "seller"} · ${Math.round(
                row.convictionRatio * 100
              )}% one-sided`}
              className="shrink-0 inline-flex items-center gap-0.5 px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] border border-foreground/60 text-foreground rounded-sm"
            >
              <span aria-hidden>{row.netDirection === "buy" ? "↑" : "↓"}</span>
              <span>Directional</span>
            </span>
          )}
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors" />
        </div>

        <span className="text-right font-mono tabular-nums font-semibold text-foreground">
          {formatCurrencyCompact(row.totalVolume)}
        </span>

        <div className="text-right font-mono tabular-nums text-[11px] leading-tight">
          <div className="text-foreground">
            <span className="font-semibold">{buyPct}</span>
            <span className="text-muted-foreground/80">/{sellPct}</span>
          </div>
          <div className="mt-0.5 h-0.5 bg-muted rounded-full overflow-hidden ml-auto w-full">
            <div
              className="h-full bg-foreground/70"
              style={{ width: `${buyPct}%` }}
            />
          </div>
        </div>

        <span className="text-right font-mono tabular-nums text-foreground/80">
          {row.tradeCount}
        </span>

        <span className="text-right font-mono tabular-nums text-foreground/80">
          {row.marketCount}
        </span>

        <span className="text-right font-mono tabular-nums text-[11px] text-muted-foreground">
          {formatTimeAgo(row.lastActiveTimestamp)}
        </span>
      </div>

      {/* Mobile: stacked rows — identity, flags, then compact metric strip */}
      <div className="sm:hidden flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <span className="w-5 pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground shrink-0">
            {index + 1}
          </span>
          <div className="relative w-8 h-8 shrink-0 rounded-sm overflow-hidden bg-muted">
            {row.profileImage ? (
              <Image
                src={row.profileImage}
                alt={display}
                fill
                sizes="32px"
                className="object-cover"
                unoptimized={isAnimatedImageUrl(row.profileImage)}
              />
            ) : (
              <span className="w-full h-full flex items-center justify-center font-mono text-[10px] font-semibold text-foreground/40">
                {row.address.slice(2, 4).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium text-foreground">
                {display}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-sm font-semibold text-foreground">
                {formatCurrencyCompact(row.totalVolume)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 flex-wrap">
              {hasRealName && (
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
                  {formatAddress(row.address)}
                </span>
              )}
              {isBig && (
                <span className="inline-flex items-center px-1.5 h-[16px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] bg-foreground/85 text-background rounded-sm">
                  Big
                </span>
              )}
              {isDirectional && (
                <span className="inline-flex items-center gap-0.5 px-1.5 h-[16px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] border border-foreground/60 text-foreground rounded-sm">
                  <span aria-hidden>
                    {row.netDirection === "buy" ? "↑" : "↓"}
                  </span>
                  <span>Directional</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="ml-8 flex items-center gap-3 font-mono text-[10px] tabular-nums">
          <span className="text-foreground">
            <span className="font-semibold">{buyPct}</span>
            <span className="text-muted-foreground/80">/{sellPct}</span>
          </span>
          <div className="flex-1 h-[3px] bg-muted overflow-hidden">
            <div
              className="h-full bg-foreground/70"
              style={{ width: `${buyPct}%` }}
            />
          </div>
        </div>

        <div className="ml-8 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>
            <span className="tabular-nums normal-case text-foreground font-semibold">
              {row.tradeCount}
            </span>{" "}
            trades
          </span>
          <span aria-hidden className="text-border/80">
            ·
          </span>
          <span>
            <span className="tabular-nums normal-case text-foreground font-semibold">
              {row.marketCount}
            </span>{" "}
            markets
          </span>
          <span aria-hidden className="text-border/80">
            ·
          </span>
          <span className="normal-case tabular-nums text-muted-foreground">
            {formatTimeAgo(row.lastActiveTimestamp)}
          </span>
        </div>
      </div>
    </Link>
  );
}

function HeaderCell({
  label,
  column,
  sort,
  onSort,
  align,
}: {
  label: string;
  column: WhaleSortColumn;
  sort: { column: WhaleSortColumn; direction: "asc" | "desc" };
  onSort: (col: WhaleSortColumn) => void;
  align: "left" | "right";
}) {
  const isActive = sort.column === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={cn(
        "inline-flex items-center gap-1 transition-colors hover:text-foreground",
        align === "right" && "justify-end",
        isActive && "text-foreground"
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

function EmptyRow({ query }: { query: string }) {
  return (
    <div className="py-10 px-3 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {query
          ? `No whales match "${query}"`
          : "No whale activity in this window"}
      </p>
    </div>
  );
}
