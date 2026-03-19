import { motion } from "framer-motion";
import {
  BarChart3,
  Check,
  ExternalLink,
  FileText,
  History,
  Loader2,
  Minus,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
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
import { formatCurrency, formatPrice, timeAgo } from "@/lib/formatters";
import { EmptyState } from "./empty-state";
import type { Trade } from "./types";

function getActivityInfo(
  type: string,
  side?: string | null,
  pnl?: number
): { label: string; icon: React.ElementType; color: string } {
  if (type === "REDEEM") {
    if (pnl && pnl > 0) {
      return {
        label: "Claimed",
        icon: Check,
        color: "text-emerald-500 bg-emerald-500/15",
      };
    }
    return {
      label: "Lost",
      icon: XCircle,
      color: "text-red-500 bg-red-500/15",
    };
  }
  if (type === "DEPOSIT") {
    return {
      label: "Deposited",
      icon: Plus,
      color: "text-sky-500 bg-sky-500/15",
    };
  }
  if (type === "WITHDRAW") {
    return {
      label: "Withdrew",
      icon: Minus,
      color: "text-orange-500 bg-orange-500/15",
    };
  }
  if (side === "BUY") {
    return {
      label: "Bought",
      icon: Plus,
      color: "text-emerald-500 bg-emerald-500/15",
    };
  }
  if (side === "SELL") {
    return {
      label: "Sold",
      icon: Minus,
      color: "text-muted-foreground bg-muted",
    };
  }
  return {
    label: type,
    icon: FileText,
    color: "text-muted-foreground bg-muted",
  };
}

export function HistoryTable({
  trades,
  isLoading,
  searchQuery,
  onCloseLostPosition,
  closingPositionId,
}: {
  trades: Trade[];
  isLoading: boolean;
  searchQuery: string;
  onCloseLostPosition?: (conditionId: string) => void;
  closingPositionId?: string | null;
}) {
  const filteredTrades = trades.filter((t) =>
    t.market.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (filteredTrades.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No trading history"
        description={
          searchQuery
            ? "Try a different search term"
            : "Your trades, deposits, and withdrawals will appear here once you start trading"
        }
        action={
          !searchQuery ? { label: "Start Trading", href: "/" } : undefined
        }
      />
    );
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3 p-4">
        {filteredTrades.map((trade) => {
          const activityInfo = getActivityInfo(
            trade.type,
            trade.side,
            trade.usdcAmount
          );
          const ActivityIcon = activityInfo.icon;
          const isBuy = trade.side === "BUY";
          const isLost = activityInfo.label === "Lost";
          const isClosing = closingPositionId === trade.market.conditionId;

          return (
            <motion.div
              key={trade.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-background border border-border rounded-xl p-4 space-y-3"
            >
              {/* Top row: Activity + Time + Amount */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${activityInfo.color}`}
                  >
                    <ActivityIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      {activityInfo.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {timeAgo(trade.timestamp)}
                    </p>
                  </div>
                </div>
                <p
                  className={`font-semibold ${
                    isBuy
                      ? "text-red-500"
                      : trade.usdcAmount > 0
                        ? "text-emerald-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {isBuy ? "-" : trade.usdcAmount > 0 ? "+" : ""}
                  {trade.usdcAmount > 0
                    ? formatCurrency(trade.usdcAmount)
                    : "-"}
                </p>
              </div>

              {/* Market info row - aligned with activity icon */}
              <div className="flex items-center gap-2">
                <div className="relative w-8 h-8 rounded-full overflow-hidden bg-muted shrink-0">
                  {trade.market.icon ? (
                    <Image
                      src={trade.market.icon}
                      alt={trade.market.title}
                      fill
                      sizes="32px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{trade.market.title}</p>
                  <p className="text-xs text-muted-foreground">
                    <span
                      className={
                        trade.outcome === "Yes"
                          ? "text-emerald-500"
                          : "text-red-500"
                      }
                    >
                      {trade.outcome} {formatPrice(trade.price)}
                    </span>
                    <span className="mx-1">·</span>
                    {trade.size.toFixed(1)} shares
                  </p>
                </div>
                {isLost && onCloseLostPosition && trade.market.conditionId ? (
                  <button
                    type="button"
                    aria-label="Close lost position"
                    title="Close lost position"
                    onClick={() =>
                      onCloseLostPosition(trade.market.conditionId as string)
                    }
                    disabled={isClosing}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 disabled:opacity-50"
                  >
                    {isClosing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                ) : (
                  <a
                    href={`https://polygonscan.com/tx/${trade.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View transaction on Polygonscan"
                    title="View transaction on Polygonscan"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b">
                <TableHead className="w-[120px] min-w-[100px]">
                  Activity
                </TableHead>
                <TableHead className="min-w-[200px]">Market</TableHead>
                <TableHead className="text-right w-[100px] min-w-[80px]">
                  Value
                </TableHead>
                <TableHead className="text-right w-[120px] min-w-[100px]">
                  Time
                </TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTrades.map((trade) => {
                const activityInfo = getActivityInfo(
                  trade.type,
                  trade.side,
                  trade.usdcAmount
                );
                const ActivityIcon = activityInfo.icon;
                const isBuy = trade.side === "BUY";
                const isLost = activityInfo.label === "Lost";
                const isClosing =
                  closingPositionId === trade.market.conditionId;

                return (
                  <TableRow
                    key={trade.id}
                    className="hover:bg-muted/50 transition-colors"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${activityInfo.color}`}
                        >
                          <ActivityIcon className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-sm font-medium">
                          {activityInfo.label}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="relative w-9 h-9 rounded-full overflow-hidden bg-muted shrink-0">
                          {trade.market.icon ? (
                            <Image
                              src={trade.market.icon}
                              alt={trade.market.title}
                              fill
                              sizes="36px"
                              className="object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <BarChart3 className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate max-w-[300px]">
                            {trade.market.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <span
                              className={
                                trade.outcome === "Yes"
                                  ? "text-emerald-500"
                                  : "text-red-500"
                              }
                            >
                              {trade.outcome} {formatPrice(trade.price)}
                            </span>
                            <span className="mx-1.5">·</span>
                            {trade.size.toFixed(1)} shares
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`font-medium ${
                          isBuy
                            ? "text-red-500"
                            : trade.usdcAmount > 0
                              ? "text-emerald-500"
                              : "text-muted-foreground"
                        }`}
                      >
                        {isBuy ? "-" : trade.usdcAmount > 0 ? "+" : ""}
                        {trade.usdcAmount > 0
                          ? formatCurrency(trade.usdcAmount)
                          : "-"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm text-muted-foreground">
                        {timeAgo(trade.timestamp)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {isLost &&
                      onCloseLostPosition &&
                      trade.market.conditionId ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() =>
                                onCloseLostPosition(
                                  trade.market.conditionId as string
                                )
                              }
                              disabled={isClosing}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                            >
                              {isClosing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Close lost position</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <a
                          href={`https://polygonscan.com/tx/${trade.transactionHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TooltipProvider>
      </div>
    </>
  );
}
