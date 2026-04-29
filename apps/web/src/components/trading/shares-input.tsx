"use client";

import type { OrderTypeSelection, TradingSide } from "@/types/market";

interface SharesInputProps {
  shares: number;
  onSharesChange: (shares: number) => void;
  onIncrement: (delta: number) => void;
  minShares: number;
  effectiveBalance?: number;
  price: number;
  side: TradingSide;
  orderType: OrderTypeSelection;
  /** Maximum shares user can sell (their position size) */
  maxSellShares?: number;
}

export function SharesInput({
  shares,
  onSharesChange,
  onIncrement,
  minShares,
  effectiveBalance,
  price,
  side,
  orderType,
  maxSellShares,
}: SharesInputProps) {
  // LIMIT orders enforce the market's min_order_size on BOTH sides — the CLOB
  // rejects sub-minimum sells with "Size (X) lower than the minimum: Y".
  // MARKET sells can step down to 1 (a partial fill of an existing position).
  const effectiveMinShares =
    orderType === "LIMIT" ? minShares : side === "SELL" ? 1 : minShares;

  const handleMaxClick = () => {
    if (side === "SELL") {
      // For SELL, use the user's position size
      if (maxSellShares && maxSellShares > 0) {
        onSharesChange(maxSellShares);
      }
    } else {
      // For BUY, calculate based on balance
      if (effectiveBalance && price > 0) {
        const maxShares = Math.floor(effectiveBalance / price);
        onSharesChange(Math.max(minShares, maxShares));
      }
    }
  };

  // Determine if Max button should be disabled
  const isMaxDisabled =
    side === "SELL"
      ? !maxSellShares || maxSellShares <= 0
      : !effectiveBalance || price <= 0;

  const stepperClass =
    "px-2.5 py-2 text-xs font-mono tabular-nums text-muted-foreground border border-border/60 hover:bg-secondary/50 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Shares
        </span>
        <button
          type="button"
          className={`font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
            isMaxDisabled
              ? "text-muted-foreground/50 cursor-not-allowed"
              : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 underline underline-offset-4 decoration-border"
          }`}
          onClick={handleMaxClick}
          disabled={isMaxDisabled}
        >
          Max
        </button>
      </div>

      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          className={stepperClass}
          onClick={() => onIncrement(-10)}
          disabled={shares - 10 < effectiveMinShares}
        >
          −10
        </button>
        <button
          type="button"
          className={stepperClass}
          onClick={() => onIncrement(-1)}
          disabled={shares - 1 < effectiveMinShares}
        >
          −1
        </button>

        <input
          type="number"
          value={shares}
          onChange={(e) => {
            const val = Number.parseFloat(e.target.value);
            if (!Number.isNaN(val)) {
              onSharesChange(Math.max(effectiveMinShares, val));
            }
          }}
          min={effectiveMinShares}
          step={side === "SELL" && orderType === "MARKET" ? 0.01 : 1}
          className="flex-1 min-w-0 bg-secondary/30 border border-border/60 px-2 py-2.5 text-center text-base font-semibold font-mono tabular-nums text-foreground focus:outline-none focus:border-foreground transition-colors"
        />

        <button
          type="button"
          className={stepperClass}
          onClick={() => onIncrement(1)}
        >
          +1
        </button>
        <button
          type="button"
          className={stepperClass}
          onClick={() => onIncrement(10)}
        >
          +10
        </button>
      </div>
    </div>
  );
}
