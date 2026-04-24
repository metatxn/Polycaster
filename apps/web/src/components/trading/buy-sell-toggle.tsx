"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type { TradingSide } from "@/types/market";

interface BuySellToggleProps {
  side: TradingSide;
  onChange: (side: TradingSide) => void;
}

export function BuySellToggle({ side, onChange }: BuySellToggleProps) {
  const isBuy = side === "BUY";
  return (
    <div
      role="tablist"
      aria-label="Order side"
      className="flex items-stretch border-b border-border/40"
    >
      <button
        type="button"
        role="tab"
        aria-selected={isBuy}
        onClick={() => onChange("BUY")}
        className={`relative flex-1 inline-flex items-center justify-center gap-1.5 py-3 font-mono text-[11px] uppercase tracking-[0.15em] transition-colors ${
          isBuy
            ? "text-emerald-600 dark:text-emerald-400 font-semibold"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <TrendingUp className="h-3.5 w-3.5" />
        <span>Buy</span>
        {isBuy && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 -bottom-px h-px bg-emerald-500"
          />
        )}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={!isBuy}
        onClick={() => onChange("SELL")}
        className={`relative flex-1 inline-flex items-center justify-center gap-1.5 py-3 font-mono text-[11px] uppercase tracking-[0.15em] transition-colors ${
          !isBuy
            ? "text-red-600 dark:text-red-400 font-semibold"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <TrendingDown className="h-3.5 w-3.5" />
        <span>Sell</span>
        {!isBuy && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 -bottom-px h-px bg-red-500"
          />
        )}
      </button>
    </div>
  );
}
