import { m } from "framer-motion";
import { BarChart3, ExternalLink, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency, formatPrice, timeAgo } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import type { Trade } from "./types";

const DESKTOP_GRID =
  "grid grid-cols-[120px_minmax(0,1fr)_112px_112px_64px] items-center gap-3";

type ActivityTone = "profit" | "loss" | "in" | "out" | "neutral";

function getActivity(
  type: string,
  side?: string | null,
  amount?: number,
  isLostPosition = false
): { label: string; tone: ActivityTone } {
  if (type === "REDEEM") {
    if (isLostPosition) return { label: "Lost", tone: "loss" };
    if (amount && amount > 0) return { label: "Claimed", tone: "profit" };
    return { label: "Redeemed", tone: "neutral" };
  }
  if (type === "DEPOSIT") return { label: "Deposited", tone: "in" };
  if (type === "WITHDRAW") return { label: "Withdrew", tone: "out" };
  if (side === "BUY") return { label: "Bought", tone: "in" };
  if (side === "SELL") return { label: "Sold", tone: "neutral" };
  return { label: type, tone: "neutral" };
}

const TONE_DOT: Record<ActivityTone, string> = {
  profit: "bg-emerald-500",
  loss: "bg-red-500",
  in: "bg-emerald-500/80",
  out: "bg-amber-500",
  neutral: "bg-muted-foreground/60",
};

const TONE_LABEL: Record<ActivityTone, string> = {
  profit: "text-emerald-600 dark:text-emerald-400",
  loss: "text-red-600 dark:text-red-400",
  in: "text-foreground",
  out: "text-foreground",
  neutral: "text-muted-foreground",
};

function ActivityLabel({ label, tone }: { label: string; tone: ActivityTone }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", TONE_DOT[tone])}
      />
      <span
        className={cn(
          "font-mono text-[11px] uppercase tracking-[0.14em] font-semibold",
          TONE_LABEL[tone]
        )}
      >
        {label}
      </span>
    </span>
  );
}

function tradeHref(trade: Trade): string | null {
  const slug = trade.market.eventSlug || trade.market.slug;
  if (!slug) return null;
  const base = `/events/detail/${slug}`;
  return trade.market.conditionId
    ? `${base}?conditionId=${trade.market.conditionId}`
    : base;
}

function TradeIcon({ trade, size }: { trade: Trade; size: number }) {
  if (!trade.market.icon) {
    return (
      <div
        className="rounded-sm bg-muted border border-border/50 flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    <div
      className="relative rounded-sm overflow-hidden bg-muted border border-border/50 shrink-0"
      style={{ width: size, height: size }}
    >
      <Image
        src={trade.market.icon}
        alt={trade.market.title}
        fill
        sizes={`${size}px`}
        className="object-cover"
      />
    </div>
  );
}

function ValueCell({ trade }: { trade: Trade }) {
  const isBuy = trade.side === "BUY";
  const isPositive = !isBuy && trade.usdcAmount > 0;
  const isNegative = isBuy;
  const hasAmount = trade.usdcAmount > 0;

  return (
    <span
      className={cn(
        "font-mono tabular-nums text-sm font-semibold whitespace-nowrap",
        isNegative
          ? "text-red-600 dark:text-red-400"
          : isPositive
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-muted-foreground"
      )}
    >
      {hasAmount ? (
        <>
          {isNegative ? "−" : "+"}
          {formatCurrency(trade.usdcAmount)}
        </>
      ) : (
        "—"
      )}
    </span>
  );
}

export function HistoryTable({
  trades,
  isLoading,
  searchQuery,
  onCloseLostPosition,
  closingPositionIds,
  closedPositionIds,
}: {
  trades: Trade[];
  isLoading: boolean;
  searchQuery: string;
  onCloseLostPosition?: (conditionId: string, negRisk?: boolean) => void;
  closingPositionIds?: ReadonlySet<string>;
  /**
   * Conditions already redeemed this session. The synthetic lost row outlives
   * a successful close by the Data API's 10–30s indexing window; keeping the
   * button disabled prevents a duplicate (0-payout) redeem submission.
   */
  closedPositionIds?: ReadonlySet<string>;
}) {
  const filteredTrades = trades.filter((t) =>
    t.market.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="border-t border-border/40">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-4 border-b border-border/40"
          >
            <div className="h-3 w-20 rounded bg-muted-foreground/10 animate-pulse" />
            <div className="h-9 w-9 rounded-sm bg-muted-foreground/10 animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-muted-foreground/10 animate-pulse" />
            </div>
            <div className="h-4 w-16 rounded bg-muted-foreground/10 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (filteredTrades.length === 0) {
    return (
      <EmptyState
        title="No trading history"
        description={
          searchQuery
            ? "Try a different search term."
            : "Your trades, deposits, and redemptions will show up here once you start."
        }
        action={
          !searchQuery
            ? { label: "Start trading", href: "/markets" }
            : undefined
        }
      />
    );
  }

  return (
    <TooltipProvider>
      {/* Desktop — hairline grid */}
      <div className="hidden md:block">
        <div
          className={cn(
            DESKTOP_GRID,
            "px-3 py-2.5 border-y border-border/40 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
          )}
        >
          <span>Activity</span>
          <span>Market</span>
          <span className="text-right tabular-nums">Value</span>
          <span className="text-right">Time</span>
          <span className="text-right">Tx</span>
        </div>

        {filteredTrades.map((trade, index) => {
          const activity = getActivity(
            trade.type,
            trade.side,
            trade.usdcAmount,
            trade.isLostPosition === true
          );
          const href = tradeHref(trade);
          const isLost = trade.isLostPosition === true;
          const isClosing = Boolean(
            trade.market.conditionId &&
              closingPositionIds?.has(trade.market.conditionId)
          );
          const isClosed = Boolean(
            trade.market.conditionId &&
              closedPositionIds?.has(trade.market.conditionId)
          );
          const outcomeColor =
            trade.outcome === "Yes"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400";

          return (
            <m.div
              key={trade.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.015, 0.3) }}
              className={cn(
                DESKTOP_GRID,
                "px-3 py-3.5 border-b border-border/40 hover:bg-muted/30 transition-colors"
              )}
            >
              <ActivityLabel label={activity.label} tone={activity.tone} />

              {href ? (
                <Link
                  href={href}
                  className="flex items-center gap-3 min-w-0 group"
                >
                  <TradeIcon trade={trade} size={32} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate text-foreground">
                      {trade.market.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em]">
                      <span className={outcomeColor}>
                        {trade.outcome} {formatPrice(trade.price)}
                      </span>
                      <span className="text-muted-foreground/60">·</span>
                      <span className="tabular-nums text-muted-foreground">
                        {trade.size.toFixed(1)} shares
                      </span>
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-3 min-w-0">
                  <TradeIcon trade={trade} size={32} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate text-foreground">
                      {trade.market.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em]">
                      <span className={outcomeColor}>
                        {trade.outcome} {formatPrice(trade.price)}
                      </span>
                      <span className="text-muted-foreground/60">·</span>
                      <span className="tabular-nums text-muted-foreground">
                        {trade.size.toFixed(1)} shares
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="text-right">
                <ValueCell trade={trade} />
              </div>

              <div className="text-right font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                {timeAgo(trade.timestamp)}
              </div>

              <div className="flex items-center justify-end">
                {isLost && onCloseLostPosition && trade.market.conditionId ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() =>
                          onCloseLostPosition(
                            trade.market.conditionId as string,
                            trade.market.negRisk ?? false
                          )
                        }
                        disabled={isClosing || isClosed}
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                        aria-label="Close lost position"
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
                    aria-label="View transaction on Polygonscan"
                    className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </m.div>
          );
        })}
      </div>

      {/* Mobile — hairline stacked rows */}
      <div className="md:hidden border-t border-border/40">
        {filteredTrades.map((trade, index) => {
          const activity = getActivity(
            trade.type,
            trade.side,
            trade.usdcAmount,
            trade.isLostPosition === true
          );
          const href = tradeHref(trade);
          const isLost = trade.isLostPosition === true;
          const isClosing = Boolean(
            trade.market.conditionId &&
              closingPositionIds?.has(trade.market.conditionId)
          );
          const isClosed = Boolean(
            trade.market.conditionId &&
              closedPositionIds?.has(trade.market.conditionId)
          );
          const outcomeColor =
            trade.outcome === "Yes"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400";

          return (
            <m.div
              key={trade.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.015, 0.3) }}
              className="border-b border-border/40 py-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <ActivityLabel label={activity.label} tone={activity.tone} />
                <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                  <span>{timeAgo(trade.timestamp)}</span>
                  <ValueCell trade={trade} />
                </div>
              </div>

              <div className="flex items-start gap-3">
                {href ? (
                  <Link href={href} className="shrink-0">
                    <TradeIcon trade={trade} size={40} />
                  </Link>
                ) : (
                  <TradeIcon trade={trade} size={40} />
                )}
                <div className="flex-1 min-w-0">
                  {href ? (
                    <Link
                      href={href}
                      className="text-sm truncate block text-foreground"
                    >
                      {trade.market.title}
                    </Link>
                  ) : (
                    <p className="text-sm truncate text-foreground">
                      {trade.market.title}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em]">
                    <span className={outcomeColor}>
                      {trade.outcome} {formatPrice(trade.price)}
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <span className="tabular-nums text-muted-foreground">
                      {trade.size.toFixed(1)} shares
                    </span>
                  </div>
                </div>

                {isLost && onCloseLostPosition && trade.market.conditionId ? (
                  <button
                    type="button"
                    onClick={() =>
                      onCloseLostPosition(
                        trade.market.conditionId as string,
                        trade.market.negRisk ?? false
                      )
                    }
                    disabled={isClosing || isClosed}
                    aria-label="Close lost position"
                    className="shrink-0 inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
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
                    className="shrink-0 inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </m.div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
