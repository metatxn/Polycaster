"use client";

import { Zap } from "lucide-react";
import type { OrderTypeSelection } from "@/types/market";

interface OrderTypeToggleProps {
  orderType: OrderTypeSelection;
  onChange: (type: OrderTypeSelection) => void;
}

export function OrderTypeToggle({ orderType, onChange }: OrderTypeToggleProps) {
  return (
    <div className="flex rounded-xl bg-muted p-1">
      <button
        type="button"
        className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
          orderType === "MARKET"
            ? "bg-background text-foreground shadow-md border border-border/50"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("MARKET")}
      >
        <Zap className="h-3.5 w-3.5" />
        Market
      </button>
      <button
        type="button"
        className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
          orderType === "LIMIT"
            ? "bg-background text-foreground shadow-md border border-border/50"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("LIMIT")}
      >
        Limit
      </button>
    </div>
  );
}
