"use client";

import { AlertCircle } from "lucide-react";

interface AllowanceWarningProps {
  totalCost: number;
  hasNoAllowance: boolean;
}

export function AllowanceWarning({
  totalCost,
  hasNoAllowance,
}: AllowanceWarningProps) {
  return (
    <div className="flex items-start gap-3 p-3 bg-foreground/5 border border-border/60">
      <AlertCircle className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
      <div className="space-y-1">
        <span className="block text-sm text-foreground">
          {hasNoAllowance
            ? "Approve pUSD spending to trade"
            : `Increase allowance to $${totalCost.toFixed(2)}`}
        </span>
        <span className="block text-xs text-muted-foreground">
          Approval is step 1. Place the order after approval succeeds.
        </span>
      </div>
    </div>
  );
}
