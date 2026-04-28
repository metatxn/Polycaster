"use client";

import { AlertCircle, Loader2 } from "lucide-react";

interface AllowanceWarningProps {
  totalCost: number;
  hasNoAllowance: boolean;
  isUpdating: boolean;
  onApprove: () => void;
}

export function AllowanceWarning({
  totalCost,
  hasNoAllowance,
  isUpdating,
  onApprove,
}: AllowanceWarningProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-3 bg-foreground/5 border border-border/60">
        <AlertCircle className="h-4 w-4 text-foreground shrink-0" />
        <span className="text-sm text-foreground">
          {hasNoAllowance
            ? "Approve pUSD spending to trade"
            : `Increase allowance to $${totalCost.toFixed(2)}`}
        </span>
      </div>
      <button
        type="button"
        className="w-full h-11 bg-foreground hover:bg-foreground/90 text-background font-mono text-[11px] uppercase tracking-[0.18em] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        onClick={onApprove}
        disabled={isUpdating}
      >
        {isUpdating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Approving…
          </>
        ) : (
          "Approve pUSD"
        )}
      </button>
    </div>
  );
}
