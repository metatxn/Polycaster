"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface TopOfBookStripProps {
  marketName: string;
  marketImage?: string;
  yesProbability: number;
  bestBid?: number;
  bestAsk?: number;
  /** Market's last-known YES price (0..1). Used as an instant MID fallback
   *  so the strip doesn't hold on em-dashes while REST seeds the book. */
  fallbackPrice?: number;
  volume?: number | string;
  isLive: boolean;
}

function formatCents(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}¢`;
}

function formatSpread(bid?: number, ask?: number): string {
  if (bid === undefined || ask === undefined) return "—";
  const spread = ask - bid;
  if (!Number.isFinite(spread)) return "—";
  return `${(spread * 100).toFixed(1)}¢`;
}

function formatMid(bid?: number, ask?: number, fallback?: number): string {
  if (bid !== undefined && ask !== undefined) {
    const mid = (bid + ask) / 2;
    if (Number.isFinite(mid)) return `${(mid * 100).toFixed(1)}¢`;
  }
  if (fallback !== undefined && Number.isFinite(fallback)) {
    return `${(fallback * 100).toFixed(1)}¢`;
  }
  return "—";
}

function formatVolume(vol?: number | string): string {
  if (vol === undefined || vol === null) return "—";
  const n = typeof vol === "string" ? Number.parseFloat(vol) : vol;
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

/**
 * Compact terminal-style strip showing selected market's live trading stats.
 * Sits above the chart. All numeric values use mono font.
 */
export function TopOfBookStrip({
  marketName,
  marketImage,
  yesProbability,
  bestBid,
  bestAsk,
  fallbackPrice,
  volume,
  isLive,
}: TopOfBookStripProps) {
  const stats: Array<{ label: string; value: string; tone?: "bid" | "ask" }> = [
    { label: "Bid", value: formatCents(bestBid), tone: "bid" },
    { label: "Ask", value: formatCents(bestAsk), tone: "ask" },
    { label: "Mid", value: formatMid(bestBid, bestAsk, fallbackPrice) },
    { label: "Spread", value: formatSpread(bestBid, bestAsk) },
    { label: "Vol", value: formatVolume(volume) },
  ];

  return (
    <div className="border-t border-b border-border/40">
      <div className="flex flex-col lg:flex-row lg:items-center divide-y divide-border/40 lg:divide-y-0 lg:divide-x">
        {/* Selected market identity */}
        <div className="flex items-center gap-3 py-3 lg:pr-6 lg:flex-1 lg:min-w-0">
          {marketImage ? (
            <div className="relative w-9 h-9 shrink-0 overflow-hidden rounded-sm">
              <Image
                src={marketImage}
                alt={marketName}
                fill
                sizes="36px"
                className="object-cover"
              />
            </div>
          ) : (
            <div className="w-9 h-9 shrink-0 rounded-sm bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {marketName}
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] font-semibold text-emerald-700 dark:text-emerald-300">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  Live
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-semibold tabular-nums leading-none text-foreground">
                {yesProbability.toFixed(0)}
                <span className="text-sm ml-0.5 text-muted-foreground">%</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                Yes
              </span>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-5 lg:flex lg:items-stretch">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center justify-center px-3 lg:px-5 py-2.5 lg:py-3 border-r border-border/40 last:border-r-0 lg:min-w-[96px]"
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                {stat.label}
              </span>
              <span
                className={cn(
                  "mt-1 font-mono text-sm lg:text-base font-semibold tabular-nums leading-none",
                  stat.tone === "bid" &&
                    "text-emerald-700 dark:text-emerald-300",
                  stat.tone === "ask" && "text-red-700 dark:text-red-300",
                  !stat.tone && "text-foreground"
                )}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
