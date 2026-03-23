"use client";

import { AlertCircle, ArrowDownToLine } from "lucide-react";
import { useMemo } from "react";

interface BalanceWarningProps {
  totalCost: number;
  effectiveBalance?: number;
  onDeposit: () => void;
}

export function BalanceWarning({
  totalCost,
  effectiveBalance = 0,
  onDeposit,
}: BalanceWarningProps) {
  const balanceProgress = useMemo(() => {
    if (totalCost <= 0) return 100;
    return Math.min(100, (effectiveBalance / totalCost) * 100);
  }, [effectiveBalance, totalCost]);

  return (
    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Need ${(totalCost - effectiveBalance).toFixed(2)} more
          </span>
        </div>
        <button
          type="button"
          onClick={onDeposit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-linear-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white transition-all shadow-sm shadow-emerald-500/25"
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
          Deposit
        </button>
      </div>

      <div className="h-1.5 bg-amber-500/20 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full transition-all duration-300"
          style={{ width: `${balanceProgress}%` }}
        />
      </div>

      <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
        ${effectiveBalance.toFixed(2)} / ${totalCost.toFixed(2)} USDC.e
      </p>
    </div>
  );
}
