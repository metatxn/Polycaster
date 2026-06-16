"use client";

import { useState } from "react";
import { InteractiveLineChart } from "@/components/pnl-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { type PnLInterval, usePnLHistory } from "@/hooks/use-pnl-history";
import { formatCurrencyCompact, formatPercent } from "@/lib/formatters";

const INTERVAL_OPTIONS: { value: PnLInterval; label: string }[] = [
  { value: "6h", label: "6H" },
  { value: "12h", label: "12H" },
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "all", label: "All" },
];

const INTERVAL_LABEL: Record<PnLInterval, string> = {
  "6h": "6h",
  "12h": "12h",
  "1d": "today",
  "1w": "this week",
  "1m": "this month",
  all: "all-time",
  max: "all-time",
};

interface PortfolioPnlCardProps {
  userAddress?: string;
  chartHeight?: number;
}

export function PortfolioPnlCard({
  userAddress,
  chartHeight = 120,
}: PortfolioPnlCardProps) {
  const [selectedInterval, setSelectedInterval] = useState<PnLInterval>("all");
  const { data, isLoading, error } = usePnLHistory({
    userAddress,
    interval: selectedInterval,
    fidelity:
      selectedInterval === "6h" ||
      selectedInterval === "12h" ||
      selectedInterval === "1d"
        ? "1h"
        : "1d",
  });

  const hasData = data?.data && data.data.length > 0;
  const periodChange = data?.summary?.change ?? 0;
  const periodChangePercent = data?.summary?.changePercent ?? 0;
  const isPositive = periodChange >= 0;
  const periodLabel = INTERVAL_LABEL[selectedInterval];

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 sm:p-5 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Profit / Loss
        </span>
        <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide font-mono text-[10px] uppercase tracking-[0.14em]">
          {INTERVAL_OPTIONS.map((opt) => {
            const isActive = selectedInterval === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelectedInterval(opt.value)}
                aria-pressed={isActive}
                className={`px-2 py-1 rounded-md whitespace-nowrap transition-colors shrink-0 ${
                  isActive
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="w-full" style={{ height: chartHeight }} />
        </>
      ) : error ? (
        <div
          role="status"
          className="flex items-center text-muted-foreground font-editorial italic text-sm"
          style={{ height: chartHeight }}
        >
          <p>Failed to load P&amp;L data.</p>
        </div>
      ) : !hasData ? (
        <div className="flex flex-col gap-2 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            No data yet
          </p>
          <p className="font-editorial italic text-base text-muted-foreground leading-snug">
            Your P&amp;L curve shows up here once you've traded.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={`text-2xl sm:text-3xl font-semibold tabular-nums tracking-[-0.015em] ${
                isPositive ? "text-emerald-500" : "text-red-500"
              }`}
            >
              {formatCurrencyCompact(periodChange)}
            </span>
            <span
              className={`font-mono text-[11px] uppercase tracking-[0.12em] tabular-nums ${
                isPositive ? "text-emerald-500" : "text-red-500"
              }`}
            >
              {formatPercent(periodChangePercent)}
              <span className="ml-1 text-muted-foreground">{periodLabel}</span>
            </span>
          </div>
          <InteractiveLineChart data={data.data} height={chartHeight} />
        </>
      )}
    </div>
  );
}
