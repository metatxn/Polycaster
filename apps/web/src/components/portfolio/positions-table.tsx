import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  LayoutGrid,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency, formatPercent, formatPrice } from "@/lib/formatters";
import { EmptyState } from "./empty-state";
import { SortableHeader } from "./sortable-header";
import type { PnLFilter, Position, SortDirection, SortField } from "./types";

export function PositionsTable({
  positions,
  isLoading,
  searchQuery,
  pnlFilter,
  sortField,
  sortDirection,
  onSort,
  onSell,
}: {
  positions: Position[];
  isLoading: boolean;
  searchQuery: string;
  pnlFilter: PnLFilter;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  onSell?: (position: Position) => void;
}) {
  // Filter and sort positions
  const filteredPositions = useMemo(() => {
    let result = positions.filter((p) =>
      p.market.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Apply P&L filter
    if (pnlFilter === "profit") {
      result = result.filter((p) => p.unrealizedPnl >= 0);
    } else if (pnlFilter === "loss") {
      result = result.filter((p) => p.unrealizedPnl < 0);
    }

    // Apply sorting
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

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (filteredPositions.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="No positions found"
        description={
          searchQuery || pnlFilter !== "all"
            ? "Try adjusting your search or filters"
            : "Start trading to build your portfolio and see your positions here"
        }
        action={
          !searchQuery && pnlFilter === "all"
            ? { label: "Explore Markets", href: "/" }
            : undefined
        }
        secondaryAction={
          !searchQuery && pnlFilter === "all"
            ? { label: "View Trending", href: "/?sort=trending" }
            : undefined
        }
      />
    );
  }

  // Calculate totals
  const totalBet = filteredPositions.reduce(
    (sum, p) => sum + p.initialValue,
    0
  );
  const totalToWin = filteredPositions.reduce(
    (sum, p) => sum + p.size * (1 - p.avgPrice),
    0
  );
  const totalValue = filteredPositions.reduce(
    (sum, p) => sum + p.currentValue,
    0
  );
  const totalPnl = filteredPositions.reduce(
    (sum, p) => sum + p.unrealizedPnl,
    0
  );
  const totalPnlPercent = totalBet > 0 ? (totalPnl / totalBet) * 100 : 0;

  return (
    <TooltipProvider>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3 p-4">
        {filteredPositions.map((position) => {
          const isProfit = position.unrealizedPnl >= 0;
          const toWin = position.size * (1 - position.avgPrice);

          return (
            <motion.div
              key={position.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-background border border-border rounded-xl p-4 space-y-3"
            >
              <Link
                href={`/events/detail/${position.market.eventSlug}`}
                className="flex items-start gap-3"
              >
                <div className="relative w-12 h-12 rounded-full overflow-hidden bg-muted shrink-0">
                  {position.market.icon ? (
                    <Image
                      src={position.market.icon}
                      alt={position.market.title}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BarChart3 className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm line-clamp-2 leading-tight">
                    {position.market.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        position.outcome === "Yes"
                          ? "bg-emerald-500/15 text-emerald-500"
                          : "bg-red-500/15 text-red-500"
                      }`}
                    >
                      {position.outcome}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {position.size.toFixed(1)} shares
                    </span>
                  </div>
                </div>
              </Link>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Avg → Now
                  </p>
                  <p className="text-sm font-medium">
                    <span className="text-muted-foreground">
                      {formatPrice(position.avgPrice)}
                    </span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span
                      className={
                        position.currentPrice > position.avgPrice
                          ? "text-emerald-500"
                          : position.currentPrice < position.avgPrice
                            ? "text-red-500"
                            : ""
                      }
                    >
                      {formatPrice(position.currentPrice)}
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Value
                  </p>
                  <p className="text-sm font-bold">
                    {formatCurrency(position.currentValue)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Bet / To Win
                  </p>
                  <p className="text-sm">
                    {formatCurrency(position.initialValue)} /{" "}
                    {formatCurrency(toWin)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    P&L
                  </p>
                  <p
                    className={`text-sm font-medium flex items-center justify-end gap-1 ${
                      isProfit ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {isProfit ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    {formatCurrency(position.unrealizedPnl, true)}
                    <span className="text-xs opacity-80">
                      ({formatPercent(position.unrealizedPnlPercent)})
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="default"
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => onSell?.(position)}
                >
                  Sell
                </Button>
                <Button asChild size="sm" variant="outline" className="flex-1">
                  <Link href={`/events/detail/${position.market.eventSlug}`}>
                    Trade
                  </Link>
                </Button>
              </div>
            </motion.div>
          );
        })}

        {/* Mobile Total Summary */}
        <div className="bg-muted/50 rounded-xl p-4 border border-border">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Portfolio Summary
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">
                Total Bet
              </p>
              <p className="font-semibold">{formatCurrency(totalBet)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase">
                Total Value
              </p>
              <p className="font-semibold">{formatCurrency(totalValue)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">
                To Win
              </p>
              <p className="font-medium">{formatCurrency(totalToWin)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase">
                Total P&L
              </p>
              <p
                className={`font-semibold ${
                  totalPnl >= 0 ? "text-emerald-500" : "text-red-500"
                }`}
              >
                {formatCurrency(totalPnl, true)} (
                {formatPercent(totalPnlPercent)})
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b">
              <TableHead className="w-[40%] min-w-[200px]">
                <SortableHeader
                  label="Market"
                  field="name"
                  currentSort={sortField}
                  onSort={onSort}
                />
              </TableHead>
              <TableHead className="text-center min-w-[100px]">
                <Tooltip>
                  <TooltipTrigger className="cursor-help">
                    Avg → Now
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                    Your average buy price → Current market price
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="text-right min-w-[80px]">Bet</TableHead>
              <TableHead className="text-right min-w-[80px]">To Win</TableHead>
              <TableHead className="min-w-[100px]">
                <div className="flex justify-end">
                  <SortableHeader
                    label="Value"
                    field="value"
                    currentSort={sortField}
                    onSort={onSort}
                    tooltip="Current market value of your position"
                  />
                </div>
              </TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPositions.map((position) => {
              const isProfit = position.unrealizedPnl >= 0;
              const toWin = position.size * (1 - position.avgPrice);

              return (
                <TableRow
                  key={position.id}
                  className="group hover:bg-muted/50 transition-colors"
                >
                  <TableCell>
                    <Link
                      href={`/events/detail/${position.market.eventSlug}`}
                      className="flex items-center gap-3"
                    >
                      <div className="relative w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0">
                        {position.market.icon ? (
                          <Image
                            src={position.market.icon}
                            alt={position.market.title}
                            fill
                            sizes="40px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <BarChart3 className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate max-w-[280px] group-hover:text-primary transition-colors">
                          {position.market.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span
                            className={
                              position.outcome === "Yes"
                                ? "text-emerald-500"
                                : "text-red-500"
                            }
                          >
                            {position.outcome} {formatPrice(position.avgPrice)}
                          </span>
                          <span className="mx-1.5">·</span>
                          {position.size.toFixed(1)} shares
                        </p>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-muted-foreground">
                      {formatPrice(position.avgPrice)}
                    </span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span
                      className={
                        position.currentPrice > position.avgPrice
                          ? "text-emerald-500"
                          : position.currentPrice < position.avgPrice
                            ? "text-red-500"
                            : ""
                      }
                    >
                      {formatPrice(position.currentPrice)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(position.initialValue)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(toWin)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="font-medium">
                      {formatCurrency(position.currentValue)}
                    </div>
                    <div
                      className={`text-xs flex items-center justify-end gap-0.5 ${
                        isProfit ? "text-emerald-500" : "text-red-500"
                      }`}
                    >
                      {isProfit ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {formatCurrency(position.unrealizedPnl, true)} (
                      {formatPercent(position.unrealizedPnlPercent)})
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-red-600 hover:bg-red-700 text-white h-8"
                        onClick={() => onSell?.(position)}
                      >
                        Sell
                      </Button>
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-8"
                      >
                        <Link
                          href={`/events/detail/${position.market.eventSlug}`}
                        >
                          Trade
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="bg-muted/30">
              <TableCell className="font-semibold">
                Total ({filteredPositions.length})
              </TableCell>
              <TableCell></TableCell>
              <TableCell className="text-right font-semibold">
                {formatCurrency(totalBet)}
              </TableCell>
              <TableCell className="text-right font-semibold">
                {formatCurrency(totalToWin)}
              </TableCell>
              <TableCell className="text-right">
                <div className="font-semibold">
                  {formatCurrency(totalValue)}
                </div>
                <div
                  className={`text-xs flex items-center justify-end gap-0.5 ${
                    totalPnl >= 0 ? "text-emerald-500" : "text-red-500"
                  }`}
                >
                  {totalPnl >= 0 ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {formatCurrency(totalPnl, true)} (
                  {formatPercent(totalPnlPercent)})
                </div>
              </TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </TooltipProvider>
  );
}
