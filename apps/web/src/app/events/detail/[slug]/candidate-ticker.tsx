"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface CandidateTickerMarket {
  id: string;
  groupItemTitle: string;
  yesProbability: number;
  yesPrice: string;
}

interface CandidateTickerProps {
  markets: CandidateTickerMarket[];
  selectedMarketId: string;
  onSelectMarket: (id: string) => void;
}

function formatCents(price: string): string {
  const n = Number.parseFloat(price);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}¢`;
}

/**
 * Horizontal scrollable strip of candidates for multi-outcome events.
 * Compact terminal-style chips: each shows image, name, probability %, and
 * YES price. Clicking a chip selects that market for the chart and trading
 * panel. Auto-scrolls the selected chip into view.
 */
export function CandidateTicker({
  markets,
  selectedMarketId,
  onSelectMarket,
}: CandidateTickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, []);

  if (markets.length === 0) return null;

  return (
    <div className="border-t border-b border-border/40">
      <div className="flex items-center gap-2 py-2">
        <span className="text-muted-foreground/60">§</span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground">
          Candidates
        </span>
        <span className="relative flex h-1.5 w-1.5 ml-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
        </span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums text-muted-foreground">
          {markets.length} total
        </span>
      </div>
      <div
        ref={scrollRef}
        className="flex items-stretch overflow-x-auto scrollbar-hide border-t border-border/40"
      >
        {markets.map((m) => {
          const isSelected = m.id === selectedMarketId;
          const pct = Math.max(0, Math.min(100, m.yesProbability));
          return (
            <button
              key={m.id}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              onClick={() => onSelectMarket(m.id)}
              className={cn(
                "relative flex-1 flex flex-col gap-1 px-3 py-2.5 text-left transition-colors min-w-[160px] border-r border-border/40 last:border-r-0",
                isSelected
                  ? "text-foreground"
                  : "text-foreground hover:bg-foreground/2"
              )}
            >
              {isSelected && (
                <span className="absolute inset-x-0 -top-px h-px bg-foreground" />
              )}
              <div className="truncate text-xs font-semibold leading-tight">
                {m.groupItemTitle}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-lg font-semibold tabular-nums leading-none">
                  {pct.toFixed(0)}%
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground leading-none">
                  {formatCents(m.yesPrice)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
