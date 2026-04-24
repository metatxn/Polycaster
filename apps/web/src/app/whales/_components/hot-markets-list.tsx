"use client";

import Image from "next/image";
import Link from "next/link";
import { formatCurrencyCompact } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { HotMarketRow } from "../_lib/aggregates";
import { isAnimatedImageUrl } from "../_lib/formatters";

interface HotMarketsListProps {
  markets: HotMarketRow[];
  /** If a market filter is active on the activity ledger, highlight
   *  it and allow clicking a row to change the filter. */
  activeMarketId?: string | null;
  onMarketSelect?: (conditionId: string | null) => void;
}

/**
 * Hairline-separated list of markets with the highest whale flow in
 * the selected window. Click a row to filter the activity ledger to
 * that market; click again (on the active one) to clear.
 */
export function HotMarketsList({
  markets,
  activeMarketId,
  onMarketSelect,
}: HotMarketsListProps) {
  return (
    <section className="flex flex-col">
      <header className="flex items-baseline justify-between pb-3">
        <h2 className="font-editorial italic text-xl sm:text-2xl text-foreground">
          Hot Markets
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
          {markets.length}
        </span>
      </header>

      <div className="border-y border-border/60 divide-y divide-border/40">
        {markets.length === 0 ? (
          <p className="py-10 px-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            No markets with whale flow in this window
          </p>
        ) : (
          markets.map((m) => (
            <HotMarketRowItem
              key={m.conditionId}
              row={m}
              isActive={activeMarketId === m.conditionId}
              onSelect={onMarketSelect}
            />
          ))
        )}
      </div>

      {onMarketSelect && activeMarketId && (
        <button
          type="button"
          onClick={() => onMarketSelect(null)}
          className="self-start mt-3 inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
        >
          <span aria-hidden>×</span> Clear market filter
        </button>
      )}
    </section>
  );
}

function HotMarketRowItem({
  row,
  isActive,
  onSelect,
}: {
  row: HotMarketRow;
  isActive: boolean;
  onSelect?: (conditionId: string | null) => void;
}) {
  const buyPct = Math.round(row.buyRatio * 100);
  const href = `/events/detail/${row.eventSlug || row.slug}`;

  const content = (
    <div
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 transition-colors",
        isActive ? "bg-muted/60" : "hover:bg-muted/40"
      )}
    >
      <div className="relative w-10 h-10 shrink-0 rounded-md overflow-hidden bg-muted">
        {row.image ? (
          <Image
            src={row.image}
            alt={row.title}
            fill
            sizes="40px"
            className="object-cover"
            unoptimized={isAnimatedImageUrl(row.image)}
          />
        ) : (
          <span className="w-full h-full flex items-center justify-center font-editorial italic text-base text-foreground/30">
            {(row.title || "M").trim().charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm leading-tight line-clamp-2 tracking-[-0.01em] text-foreground">
          {row.title}
        </p>

        <div className="mt-1.5 flex items-center gap-3 font-mono text-[10px] tabular-nums text-muted-foreground">
          <span className="inline-flex items-baseline gap-1">
            <span className="text-foreground font-semibold">
              {formatCurrencyCompact(row.totalVolume)}
            </span>
            <span className="uppercase tracking-[0.12em] text-[9px]">vol</span>
          </span>
          <span className="inline-flex items-baseline gap-1">
            <span className="text-foreground/80">{row.whaleCount}</span>
            <span className="uppercase tracking-[0.12em] text-[9px]">
              {row.whaleCount === 1 ? "whale" : "whales"}
            </span>
          </span>
          <span className="inline-flex items-baseline gap-1">
            <span className="text-foreground/80">{row.tradeCount}</span>
            <span className="uppercase tracking-[0.12em] text-[9px]">
              {row.tradeCount === 1 ? "trade" : "trades"}
            </span>
          </span>
        </div>

        <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono tabular-nums">
          <span className="text-foreground font-semibold">{buyPct}%</span>
          <div className="flex-1 h-0.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground/70"
              style={{ width: `${buyPct}%` }}
            />
          </div>
          <span className="text-muted-foreground/80">{100 - buyPct}%</span>
        </div>
      </div>
    </div>
  );

  // Dual action: clicking the text area navigates to the event detail;
  // clicking a secondary icon (or the whole row when onSelect is
  // provided) filters the activity ledger. Keep it simple — filter
  // on click, navigate on meta-click/contextmenu via the link below.
  if (onSelect) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => onSelect(isActive ? null : row.conditionId)}
          className="w-full text-left"
        >
          {content}
        </button>
        <Link
          href={href}
          className="absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.14em] text-muted-foreground/80 hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          Open
        </Link>
      </div>
    );
  }

  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}
