"use client";

import { formatCurrencyCompact } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface WhalePullNumbersProps {
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  uniqueTraders: number;
  uniqueMarkets: number;
  totalTrades: number;
  buyRatio: number; // 0..1
  sentiment: "bullish" | "bearish" | "neutral";
}

/**
 * Pull-number row — no card shells, just tabular-nums anchored to
 * mono captions and separated by hairline rules. Reads like a
 * broadsheet front page's stat band.
 */
export function WhalePullNumbers({
  totalVolume,
  buyVolume,
  sellVolume,
  uniqueTraders,
  uniqueMarkets,
  totalTrades,
  buyRatio,
  sentiment,
}: WhalePullNumbersProps) {
  const buyPct = Math.round(buyRatio * 100);
  const sellPct = 100 - buyPct;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 border-y border-(--kwm-hl-2)/50 divide-x divide-border/40 md:divide-x">
      <PullStat
        label="Total Volume"
        value={formatCurrencyCompact(totalVolume)}
        caption={`${totalTrades.toLocaleString()} trades · ${uniqueTraders} whales`}
      />
      <PullStat
        label="Buy Pressure"
        value={formatCurrencyCompact(buyVolume)}
        caption={`${buyPct}% of flow`}
        mark={<TrendGlyph direction="up" />}
      />
      <PullStat
        label="Sell Pressure"
        value={formatCurrencyCompact(sellVolume)}
        caption={`${sellPct}% of flow`}
        mark={<TrendGlyph direction="down" />}
      />
      <PullStat
        label="Sentiment"
        value={
          sentiment === "bullish"
            ? "Bullish"
            : sentiment === "bearish"
              ? "Bearish"
              : "Mixed"
        }
        caption={`${uniqueMarkets} markets`}
        valueClassName={cn(
          "font-(family-name:--font-geist) font-semibold tracking-tight",
          sentiment === "bullish" && "text-(--kwm-up)",
          sentiment === "bearish" && "text-(--kwm-down)",
          sentiment === "neutral" && "text-(--kwm-ink-3)"
        )}
      />
    </div>
  );
}

function PullStat({
  label,
  value,
  caption,
  mark,
  valueClassName,
}: {
  label: string;
  value: string;
  caption: string;
  mark?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="px-4 py-4 sm:py-5 flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-2xl sm:text-3xl font-semibold tabular-nums text-(--kwm-ink) tracking-[-0.015em]",
            valueClassName
          )}
        >
          {value}
        </span>
        {mark}
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3) tabular-nums">
        {caption}
      </span>
    </div>
  );
}

function TrendGlyph({ direction }: { direction: "up" | "down" }) {
  return (
    <span aria-hidden className="text-xs font-mono text-(--kwm-ink-3)">
      {direction === "up" ? "↑" : "↓"}
    </span>
  );
}
