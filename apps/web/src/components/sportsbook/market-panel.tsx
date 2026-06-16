"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Position } from "@/hooks/use-user-positions";
import { type Trade, useUserTrades } from "@/hooks/use-user-trades";
import { formatCents, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  formatPositionPercent,
  formatSignedUsd,
  formatUsd,
  toDecimal,
} from "./format";
import { resolveOutcomeTokenIds } from "./market-parsing";
import type { EventMarket } from "./types";

// ── Lazy chunks (code-split boundary preserved) ───────────────────

const OrderBook = dynamic(
  () =>
    import("@/components/order-book").then((mod) => ({
      default: mod.OrderBook,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[250px] w-full rounded-xl" />,
  }
);

const MarketPriceChart = dynamic(
  () =>
    import("@/components/market-price-chart").then((mod) => ({
      default: mod.MarketPriceChart,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] w-full rounded-xl" />,
  }
);

// ── Sub-components ────────────────────────────────────────────────

function MarketPositionsTable({ positions }: { positions: Position[] }) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[minmax(120px,1fr)_90px_110px_110px_110px_130px] items-center gap-4 border-b border-(--kwm-hl) px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
          <span>Outcome</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Avg Price</span>
          <span className="text-right">Value</span>
          <span className="text-right">Cost</span>
          <span className="text-right">Return</span>
        </div>
        <div className="divide-y divide-border/40">
          {positions.map((position) => {
            const isPositive = toDecimal(position.unrealizedPnl).gte(0);
            return (
              <div
                key={position.id}
                className="grid grid-cols-[minmax(120px,1fr)_90px_110px_110px_110px_130px] items-center gap-4 px-4 py-3 text-xs"
              >
                <span
                  className={cn(
                    "min-w-0 truncate font-semibold",
                    position.outcome.toLowerCase() === "yes"
                      ? "text-(--kwm-up)"
                      : position.outcome.toLowerCase() === "no"
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-(--kwm-ink)"
                  )}
                  title={position.outcome}
                >
                  {position.outcome}
                </span>
                <span className="text-right font-mono font-semibold tabular-nums">
                  {toDecimal(position.size).toFixed(2)}
                </span>
                <span className="text-right font-mono tabular-nums">
                  {formatCents(position.avgPrice)}
                </span>
                <span className="text-right font-mono tabular-nums">
                  {formatUsd(position.currentValue)}
                </span>
                <span className="text-right font-mono tabular-nums">
                  {formatUsd(position.initialValue)}
                </span>
                <span
                  className={cn(
                    "text-right font-mono font-semibold tabular-nums",
                    isPositive
                      ? "text-(--kwm-up)"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {formatSignedUsd(position.unrealizedPnl)}
                  <span className="ml-1 text-[10px] opacity-80">
                    ({formatPositionPercent(position.unrealizedPnlPercent)})
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MarketHistoryTable({ trades }: { trades: Trade[] }) {
  return (
    <div className="divide-y divide-border/40 overflow-hidden rounded-sm border border-(--kwm-hl-2)/50">
      {trades.map((trade) => {
        const verb = trade.side === "BUY" ? "Bought" : "Sold";
        const outcomeColor =
          trade.outcome.toLowerCase() === "yes"
            ? "text-(--kwm-up)"
            : trade.outcome.toLowerCase() === "no"
              ? "text-rose-600 dark:text-rose-400"
              : "text-(--kwm-ink)";
        return (
          <div
            key={trade.id}
            className="flex items-center justify-between gap-4 px-3 py-2 text-xs"
          >
            <span className="min-w-0 font-mono tabular-nums">
              {verb}{" "}
              <span className={cn("font-semibold", outcomeColor)}>
                {toDecimal(trade.size).toFixed(2)} {trade.outcome}
              </span>{" "}
              <span className="text-(--kwm-ink-3)">at</span>{" "}
              <span className="text-(--kwm-ink)">
                {formatCents(trade.price)}
              </span>{" "}
              <span className="text-(--kwm-ink-3)">
                ({formatUsd(trade.usdcAmount)})
              </span>
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              {relativeTime(trade.timestamp, "verbose")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Public types ──────────────────────────────────────────────────

export interface MoneylineChartToken {
  tokenId: string;
  name: string;
  color: string;
}

// ── ExpandedMarketPanel ────────────────────────────────────────────

export function ExpandedMarketPanel({
  market,
  isExpanded,
  defaultOutcomeIndex = 0,
  moneylineChartTokens,
  userPositions,
  tradingAddress,
}: {
  market: EventMarket;
  isExpanded: boolean;
  defaultOutcomeIndex?: number;
  moneylineChartTokens?: MoneylineChartToken[];
  userPositions: Position[];
  tradingAddress?: string;
}) {
  type ExpandedMarketTab = "position" | "history" | "orderbook" | "graph";
  const [activeTab, setActiveTab] = useState<ExpandedMarketTab>("orderbook");
  const outcomeTokens = useMemo(() => resolveOutcomeTokenIds(market), [market]);
  const hasTokenIds = outcomeTokens.some((o) => o.tokenId);
  const { data: tradesData } = useUserTrades({
    userAddress: tradingAddress,
    market: market.conditionId || undefined,
    type: "TRADE",
    limit: 10,
    enabled: isExpanded && !!tradingAddress && !!market.conditionId,
  });
  const marketTrades = tradesData?.trades ?? [];
  const hasPositions = userPositions.length > 0;
  const hasHistory = marketTrades.length > 0;
  const defaultTab: ExpandedMarketTab = hasPositions
    ? "position"
    : hasHistory
      ? "history"
      : "orderbook";

  const chartTokens = useMemo(() => {
    if (moneylineChartTokens && moneylineChartTokens.length > 0) {
      return moneylineChartTokens;
    }
    const colors = [
      "hsl(142, 76%, 36%)",
      "hsl(0, 84%, 60%)",
      "hsl(280, 100%, 70%)",
      "hsl(221, 83%, 53%)",
    ];
    return outcomeTokens
      .filter((o) => o.tokenId)
      .map((o, i) => ({
        tokenId: o.tokenId,
        name: o.name,
        color: colors[i % colors.length],
      }));
  }, [outcomeTokens, moneylineChartTokens]);

  const outcomeNames = useMemo(
    () => chartTokens.map((o) => o.name),
    [chartTokens]
  );
  const outcomePriceStrs = useMemo(
    () => chartTokens.map(() => "0"),
    [chartTokens]
  );

  useEffect(() => {
    if (!isExpanded) return;
    setActiveTab(defaultTab);
  }, [defaultTab, isExpanded]);

  useEffect(() => {
    if (activeTab === "position" && !hasPositions) {
      setActiveTab(defaultTab);
    } else if (activeTab === "history" && !hasHistory) {
      setActiveTab(defaultTab);
    }
  }, [activeTab, defaultTab, hasHistory, hasPositions]);

  if (!isExpanded) return null;

  const tabs: Array<{
    value: ExpandedMarketTab;
    label: string;
  }> = [
    ...(hasPositions
      ? [
          {
            value: "position" as const,
            label: "Position",
          },
        ]
      : []),
    { value: "orderbook", label: "Order Book" },
    { value: "graph", label: "Graph" },
    ...(hasHistory
      ? [
          {
            value: "history" as const,
            label: "History",
          },
        ]
      : []),
  ];

  return (
    <div className="border-t border-(--kwm-hl-2) bg-(--kwm-bg-3)/10">
      <div
        role="tablist"
        aria-label="Market details"
        className="flex min-w-0 items-center border-b border-(--kwm-hl) px-3"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "relative inline-flex min-w-0 items-center gap-1 px-2 py-3 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors shrink",
                isActive
                  ? "text-(--kwm-ink)"
                  : "text-(--kwm-ink-3) hover:text-(--kwm-ink)"
              )}
            >
              {tab.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 -bottom-px h-px bg-foreground"
                />
              )}
            </button>
          );
        })}
      </div>

      {activeTab === "position" && hasPositions && (
        <div className="p-4">
          <MarketPositionsTable positions={userPositions} />
        </div>
      )}

      {activeTab === "history" && hasHistory && (
        <div className="p-4">
          <MarketHistoryTable trades={marketTrades} />
        </div>
      )}

      {activeTab === "orderbook" && (
        <div className="p-4">
          {hasTokenIds ? (
            <OrderBook
              outcomes={outcomeTokens.map((o) => ({
                name: o.name,
                tokenId: o.tokenId,
                price: o.price,
              }))}
              defaultOutcomeIndex={defaultOutcomeIndex}
              useWebSocket
              embedded
              maxLevels={8}
            />
          ) : (
            <p className="font-editorial italic text-base text-(--kwm-ink-3) text-center py-8">
              Order book data unavailable for this market.
            </p>
          )}
        </div>
      )}

      {activeTab === "graph" && (
        <div className="p-4">
          {chartTokens.length > 0 ? (
            <div className="space-y-3">
              {chartTokens.length > 1 && (
                <div className="flex items-center justify-center gap-5 flex-wrap">
                  {chartTokens.map((token) => (
                    <div
                      key={token.tokenId}
                      className="flex items-center gap-2"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-none"
                        style={{ backgroundColor: token.color }}
                      />
                      <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink-3)">
                        {token.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <MarketPriceChart
                tokens={chartTokens}
                outcomes={outcomeNames}
                outcomePrices={outcomePriceStrs}
                defaultTimeRange="1H"
              />
            </div>
          ) : (
            <p className="font-editorial italic text-base text-(--kwm-ink-3) text-center py-8">
              Chart data unavailable for this market.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
