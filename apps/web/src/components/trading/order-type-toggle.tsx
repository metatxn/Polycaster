"use client";

import { Zap } from "lucide-react";
import type { OrderTypeSelection } from "@/types/market";

interface OrderTypeToggleProps {
  orderType: OrderTypeSelection;
  onChange: (type: OrderTypeSelection) => void;
}

const OPTIONS: { value: OrderTypeSelection; label: string; icon?: boolean }[] =
  [
    { value: "MARKET", label: "Market", icon: true },
    { value: "LIMIT", label: "Limit" },
  ];

export function OrderTypeToggle({ orderType, onChange }: OrderTypeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Order type"
      className="flex items-stretch border-b border-border/40"
    >
      {OPTIONS.map((opt) => {
        const isActive = orderType === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.value)}
            className={`relative flex-1 inline-flex items-center justify-center gap-1.5 py-3 font-mono text-[11px] uppercase tracking-[0.15em] transition-colors ${
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.icon && <Zap className="h-3 w-3" />}
            <span>{opt.label}</span>
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-px bg-foreground"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
