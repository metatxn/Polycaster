import { m } from "framer-motion";
import { BarChart3, CircleDollarSign, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency, formatPercent, formatPrice } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { SortableHeader } from "./sortable-header";
import type { PnLFilter, Position, SortDirection, SortField } from "./types";

const DESKTOP_GRID =
  "grid grid-cols-[minmax(0,1fr)_100px_88px_88px_128px_120px] items-center gap-3";

function marketHref(position: Position): string {
  const base = `/events/detail/${position.market.eventSlug}`;
  return position.conditionId
    ? `${base}?conditionId=${position.conditionId}`
    : base;
}

function MarketIcon({ position, size }: { position: Position; size: number }) {
  return (
    <div
      className="relative rounded-sm overflow-hidden bg-muted border border-border/50 shrink-0"
      style={{ width: size, height: size }}
    >
      {position.market.icon ? (
        <Image
          src={position.market.icon}
          alt={position.market.title}
          fill
          sizes={`${size}px`}
          className="object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function OutcomeLabel({ position }: { position: Position }) {
  const isYes = position.outcome === "Yes";
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.12em]",
        isYes
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400"
      )}
    >
      {position.outcome} {formatPrice(position.avgPrice)}
    </span>
  );
}

function canRedeemPosition(position: Position): boolean {
  return Boolean(position.redeemable && position.currentPrice > 0);
}

function positionMetrics(position: Position) {
  return {
    canRedeem: canRedeemPosition(position),
    isProfit: position.unrealizedPnl >= 0,
    toWin: position.size * (1 - position.avgPrice),
    priceDrift:
      position.currentPrice > position.avgPrice
        ? "text-emerald-600 dark:text-emerald-400"
        : position.currentPrice < position.avgPrice
          ? "text-red-600 dark:text-red-400"
          : "text-muted-foreground",
  };
}

function PositionMarketLink({
  position,
  iconSize,
  compact = false,
}: {
  position: Position;
  iconSize: number;
  compact?: boolean;
}) {
  return (
    <Link
      href={marketHref(position)}
      className={cn(
        "flex min-w-0 gap-3",
        compact ? "items-start" : "items-center group"
      )}
    >
      <MarketIcon position={position} size={iconSize} />
      <div className={cn(compact ? "flex-1" : "", "min-w-0")}>
        <p
          className={cn(
            "font-medium text-sm text-foreground",
            compact
              ? "line-clamp-2 leading-tight"
              : "truncate group-hover:text-foreground transition-colors"
          )}
        >
          {position.market.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <OutcomeLabel position={position} />
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
            · {position.size.toFixed(1)} shares
          </span>
        </div>
      </div>
    </Link>
  );
}

function PricePair({
  position,
  priceDrift,
  mobile = false,
}: {
  position: Position;
  priceDrift: string;
  mobile?: boolean;
}) {
  return (
    <div
      className={cn(
        "font-mono tabular-nums text-xs",
        mobile ? "flex items-center gap-1.5" : "text-center"
      )}
    >
      {mobile ? (
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          Avg→Now
        </span>
      ) : null}
      <span className="text-muted-foreground">
        {formatPrice(position.avgPrice)}
      </span>
      <span className={cn("text-muted-foreground/60", mobile ? "" : "mx-1")}>
        →
      </span>
      <span className={priceDrift}>{formatPrice(position.currentPrice)}</span>
    </div>
  );
}

function PositionValuePnl({
  position,
  isProfit,
  compact = false,
}: {
  position: Position;
  isProfit: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn("font-mono tabular-nums", compact ? "" : "text-right")}>
      <div
        className={cn(
          compact ? "font-semibold text-sm" : "font-medium",
          "text-foreground"
        )}
      >
        {formatCurrency(position.currentValue)}
      </div>
      <div
        className={cn(
          "text-[11px] font-semibold",
          compact ? "" : "whitespace-nowrap",
          isProfit
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400"
        )}
      >
        {formatCurrency(position.unrealizedPnl)}
        <span className="ml-1 opacity-70">
          ({formatPercent(position.unrealizedPnlPercent)})
        </span>
      </div>
    </div>
  );
}

function PositionActions({
  position,
  canRedeem,
  isRedeemDisabled,
  isRedeeming,
  mobile = false,
  onSell,
  onRedeem,
}: {
  position: Position;
  canRedeem: boolean;
  isRedeemDisabled: boolean;
  isRedeeming: boolean;
  mobile?: boolean;
  onSell?: (position: Position) => void;
  onRedeem?: (position: Position) => void;
}) {
  if (canRedeem) {
    return (
      <div
        className={cn(
          "flex items-center",
          mobile ? "pt-2 border-t border-border/30" : "justify-end"
        )}
      >
        <button
          type="button"
          onClick={() => onRedeem?.(position)}
          disabled={isRedeemDisabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-emerald-700 transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300"
        >
          {isRedeeming ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CircleDollarSign aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          Redeem
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center",
        mobile ? "gap-6 pt-2 border-t border-border/30" : "justify-end gap-4"
      )}
    >
      <button
        type="button"
        onClick={() => onSell?.(position)}
        className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors underline underline-offset-4 decoration-border hover:decoration-red-500/60"
      >
        Sell
      </button>
      <Link
        href={marketHref(position)}
        className="group inline-flex items-baseline gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground transition-colors hover:text-muted-foreground"
      >
        <span className="underline underline-offset-4 decoration-border group-hover:decoration-foreground transition-colors">
          Trade
        </span>
        <span
          aria-hidden="true"
          className="translate-y-px transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </Link>
    </div>
  );
}

export function PositionsTable({
  positions,
  isLoading,
  searchQuery,
  pnlFilter,
  sortField,
  sortDirection,
  onSort,
  onSell,
  onRedeem,
  redeemingPositionIds = new Set<string>(),
}: {
  positions: Position[];
  isLoading: boolean;
  searchQuery: string;
  pnlFilter: PnLFilter;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  onSell?: (position: Position) => void;
  onRedeem?: (position: Position) => void;
  redeemingPositionIds?: ReadonlySet<string>;
}) {
  const filteredPositions = useMemo(() => {
    let result = positions.filter((p) =>
      p.market.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (pnlFilter === "profit") {
      result = result.filter((p) => p.unrealizedPnl >= 0);
    } else if (pnlFilter === "loss") {
      result = result.filter((p) => p.unrealizedPnl < 0);
    }

    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "value":
          comparison = a.currentValue - b.currentValue;
          break;
        case "pnl":
          comparison = a.unrealizedPnl - b.unrealizedPnl;
          break;
        case "name":
          comparison = a.market.title.localeCompare(b.market.title);
          break;
        default:
          comparison = 0;
      }
      return sortDirection === "desc" ? -comparison : comparison;
    });

    return result;
  }, [positions, searchQuery, pnlFilter, sortField, sortDirection]);

  const positionRows = useMemo(
    () =>
      filteredPositions.map((position) => ({
        position,
        metrics: positionMetrics(position),
      })),
    [filteredPositions]
  );

  if (isLoading) {
    return (
      <div className="border-t border-border/40">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-4 border-b border-border/40"
          >
            <div className="h-9 w-9 rounded-sm bg-muted-foreground/10 animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-muted-foreground/10 animate-pulse" />
            </div>
            <div className="h-4 w-20 rounded bg-muted-foreground/10 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (filteredPositions.length === 0) {
    return (
      <EmptyState
        title="No positions"
        description={
          searchQuery || pnlFilter !== "all"
            ? "Try a different search term or clear the filter."
            : "Nothing open yet. Find a market and take a side to start your book."
        }
        action={
          !searchQuery && pnlFilter === "all"
            ? { label: "Explore markets", href: "/markets" }
            : undefined
        }
        secondaryAction={
          !searchQuery && pnlFilter === "all"
            ? { label: "View trending", href: "/markets?sort=trending" }
            : undefined
        }
      />
    );
  }

  const totalBet = positionRows.reduce(
    (sum, row) => sum + row.position.initialValue,
    0
  );
  const totalToWin = positionRows.reduce(
    (sum, row) => sum + row.metrics.toWin,
    0
  );
  const totalValue = positionRows.reduce(
    (sum, row) => sum + row.position.currentValue,
    0
  );
  const totalPnl = positionRows.reduce(
    (sum, row) => sum + row.position.unrealizedPnl,
    0
  );
  const totalPnlPercent = totalBet > 0 ? (totalPnl / totalBet) * 100 : 0;

  return (
    <TooltipProvider>
      {/* Desktop — editorial hairline grid */}
      <div className="hidden md:block">
        <div
          className={cn(
            DESKTOP_GRID,
            "px-3 py-2.5 border-y border-border/40 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
          )}
        >
          <SortableHeader
            label="Market"
            field="name"
            currentSort={sortField}
            onSort={onSort}
          />
          <Tooltip>
            <TooltipTrigger className="cursor-help text-center">
              Avg → Now
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[200px]">
              Your average buy price → current market price
            </TooltipContent>
          </Tooltip>
          <span className="text-right tabular-nums">Bet</span>
          <span className="text-right tabular-nums">To Win</span>
          <div className="flex justify-end">
            <SortableHeader
              label="Value / P&L"
              field="value"
              currentSort={sortField}
              onSort={onSort}
            />
          </div>
          <span className="text-right">Actions</span>
        </div>

        {positionRows.map(({ position, metrics }, index) => {
          const { canRedeem, isProfit, priceDrift, toWin } = metrics;
          const isRedeeming = redeemingPositionIds.has(position.id);
          const isRedeemDisabled = !onRedeem || isRedeeming;

          return (
            <m.div
              key={position.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.015, 0.3) }}
              className={cn(
                DESKTOP_GRID,
                "px-3 py-3.5 border-b border-border/40 hover:bg-muted/30 transition-colors"
              )}
            >
              <PositionMarketLink position={position} iconSize={36} />

              <PricePair position={position} priceDrift={priceDrift} />

              <div className="text-right font-mono tabular-nums text-sm text-foreground">
                {formatCurrency(position.initialValue)}
              </div>

              <div className="text-right font-mono tabular-nums text-sm text-muted-foreground">
                {formatCurrency(toWin)}
              </div>

              <PositionValuePnl position={position} isProfit={isProfit} />

              <PositionActions
                position={position}
                canRedeem={canRedeem}
                isRedeemDisabled={isRedeemDisabled}
                isRedeeming={isRedeeming}
                onSell={onSell}
                onRedeem={onRedeem}
              />
            </m.div>
          );
        })}

        {/* Totals — hairline-anchored summary row */}
        <div
          className={cn(
            DESKTOP_GRID,
            "px-3 py-3 border-t border-t-border/60 border-b border-b-border/40 bg-muted/10"
          )}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Total{" "}
            <span className="tabular-nums opacity-70">
              ({filteredPositions.length})
            </span>
          </div>
          <span aria-hidden="true" />
          <div className="text-right font-mono tabular-nums text-sm font-semibold text-foreground">
            {formatCurrency(totalBet)}
          </div>
          <div className="text-right font-mono tabular-nums text-sm text-muted-foreground">
            {formatCurrency(totalToWin)}
          </div>
          <div className="text-right font-mono tabular-nums">
            <div className="text-sm font-semibold text-foreground">
              {formatCurrency(totalValue)}
            </div>
            <div
              className={cn(
                "text-[11px] font-semibold whitespace-nowrap",
                totalPnl >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              {formatCurrency(totalPnl)}
              <span className="ml-1 opacity-70">
                ({formatPercent(totalPnlPercent)})
              </span>
            </div>
          </div>
          <span aria-hidden="true" />
        </div>
      </div>

      {/* Mobile — hairline stacked rows */}
      <div className="md:hidden border-t border-border/40">
        {positionRows.map(({ position, metrics }, index) => {
          const { canRedeem, isProfit, priceDrift, toWin } = metrics;
          const isRedeeming = redeemingPositionIds.has(position.id);
          const isRedeemDisabled = !onRedeem || isRedeeming;

          return (
            <m.div
              key={position.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.015, 0.3) }}
              className="border-b border-border/40 py-4 space-y-3"
            >
              <PositionMarketLink position={position} iconSize={44} compact />

              <div className="flex items-baseline justify-between gap-3 font-mono tabular-nums text-xs">
                <PricePair position={position} priceDrift={priceDrift} mobile />
                <div className="text-right">
                  <PositionValuePnl
                    position={position}
                    isProfit={isProfit}
                    compact
                  />
                </div>
              </div>

              <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <span>
                  Bet{" "}
                  <span className="tabular-nums normal-case text-foreground ml-1">
                    {formatCurrency(position.initialValue)}
                  </span>
                </span>
                <span>
                  To Win{" "}
                  <span className="tabular-nums normal-case text-foreground ml-1">
                    {formatCurrency(toWin)}
                  </span>
                </span>
              </div>

              <PositionActions
                position={position}
                canRedeem={canRedeem}
                isRedeemDisabled={isRedeemDisabled}
                isRedeeming={isRedeeming}
                mobile
                onSell={onSell}
                onRedeem={onRedeem}
              />
            </m.div>
          );
        })}

        {/* Mobile Totals */}
        <div className="py-4 mt-2 border-t border-t-border/60 border-b border-b-border/40">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-3">
            §&nbsp;&nbsp;Portfolio Summary
            <span className="tabular-nums ml-1.5 opacity-70">
              ({filteredPositions.length})
            </span>
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <div>
              Bet{" "}
              <span className="tabular-nums normal-case text-foreground font-semibold ml-1">
                {formatCurrency(totalBet)}
              </span>
            </div>
            <div className="text-right">
              Value{" "}
              <span className="tabular-nums normal-case text-foreground font-semibold ml-1">
                {formatCurrency(totalValue)}
              </span>
            </div>
            <div>
              To Win{" "}
              <span className="tabular-nums normal-case text-foreground ml-1">
                {formatCurrency(totalToWin)}
              </span>
            </div>
            <div className="text-right">
              P&amp;L{" "}
              <span
                className={cn(
                  "tabular-nums normal-case font-semibold ml-1",
                  totalPnl >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                )}
              >
                {formatCurrency(totalPnl)}{" "}
                <span className="opacity-70">
                  ({formatPercent(totalPnlPercent)})
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
