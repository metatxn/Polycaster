"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      <div className="flex items-center gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
        <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <span className="text-sm text-blue-600 dark:text-blue-400">
          {hasNoAllowance
            ? "Approve USDC.e spending to trade"
            : `Increase allowance to $${totalCost.toFixed(2)}`}
        </span>
      </div>
      <Button
        type="button"
        className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl"
        onClick={onApprove}
        disabled={isUpdating}
      >
        {isUpdating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Approving...
          </>
        ) : (
          "Approve USDC.e"
        )}
      </Button>
    </div>
  );
}
