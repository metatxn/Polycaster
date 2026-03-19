"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type { TradingSide } from "@/types/market";

interface BuySellToggleProps {
  side: TradingSide;
  onChange: (side: TradingSide) => void;
}

export function BuySellToggle({ side, onChange }: BuySellToggleProps) {
  return (
    <div className="flex rounded-xl border border-border p-1">
      <button
        type="button"
        className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
          side === "BUY"
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("BUY")}
      >
        <TrendingUp className="h-3.5 w-3.5" />
        Buy
      </button>
      <button
        type="button"
        className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
          side === "SELL"
            ? "bg-red-500/10 text-red-600 dark:text-red-400"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("SELL")}
      >
        <TrendingDown className="h-3.5 w-3.5" />
        Sell
      </button>
    </div>
  );
}
