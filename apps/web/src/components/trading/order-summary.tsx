"use client";

import type { TradingSide } from "@/types/market";

interface OrderSummaryProps {
  totalCost: number;
  potentialWin: number;
  profitPercent: string;
  selectedOutcomeName?: string;
  isBelowMinNotional?: boolean;
  minNotional?: number;
  /** Trading side - affects display labels */
  side?: TradingSide;
}

export function OrderSummary({
  totalCost,
  potentialWin,
  profitPercent,
  selectedOutcomeName,
  isBelowMinNotional,
  minNotional = 1,
  side = "BUY",
}: OrderSummaryProps) {
  const isSell = side === "SELL";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {isSell ? "You Receive" : "Total Cost"}
        </span>
        <span
          className={`text-lg font-semibold ${isSell ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}
        >
          ${totalCost.toFixed(2)}
        </span>
      </div>

      {isBelowMinNotional && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-amber-600 dark:text-amber-400">
            Minimum order value
          </span>
          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
            ${minNotional.toFixed(2)} required
          </span>
        </div>
      )}

      {!isSell && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Potential Return
            </span>
            <span className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
              ${(totalCost + potentialWin).toFixed(2)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Profit if {selectedOutcomeName || "Yes"}
            </span>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              +${potentialWin.toFixed(2)} ({profitPercent}%)
            </span>
          </div>
        </>
      )}

      {isSell && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Selling {selectedOutcomeName || "shares"}
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            Market order
          </span>
        </div>
      )}
    </div>
  );
}
