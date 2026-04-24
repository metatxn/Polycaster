"use client";

import { formatPrice } from "@/lib/formatters";
import type { OutcomeData } from "@/types/market";

interface OutcomeSelectorProps {
  outcomes: OutcomeData[];
  selectedOutcomeIndex: number;
  onOutcomeChange: (index: number) => void;
}

function isGreenOutcome(name: string, idx: number): boolean {
  if (name === "Yes") return true;
  if (name === "No") return false;
  return idx === 0;
}

export function OutcomeSelector({
  outcomes,
  selectedOutcomeIndex,
  onOutcomeChange,
}: OutcomeSelectorProps) {
  return (
    <div className="flex gap-2">
      {outcomes.map((outcome, idx) => {
        const green = isGreenOutcome(outcome.name, idx);
        const isActive = selectedOutcomeIndex === idx;
        return (
          <button
            key={outcome.tokenId || `outcome-${idx}`}
            type="button"
            className={`group flex-1 relative px-4 py-3 border transition-colors text-left ${
              isActive
                ? green
                  ? "border-emerald-500 bg-emerald-500/5"
                  : "border-red-500 bg-red-500/5"
                : "border-border/60 hover:border-foreground/40 bg-transparent"
            }`}
            onClick={() => onOutcomeChange(idx)}
          >
            {isActive && (
              <span
                aria-hidden
                className={`absolute top-2 right-2 h-1.5 w-1.5 rounded-full ${
                  green ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
            )}
            <span
              className={`block font-mono text-[10px] uppercase tracking-[0.14em] ${
                green
                  ? "text-emerald-600 dark:text-emerald-400"
                  : outcome.name === "No" || idx === 1
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground"
              }`}
            >
              {outcome.name}
            </span>
            <span className="block text-lg font-semibold font-mono tabular-nums text-foreground mt-0.5">
              {formatPrice(outcome.price)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
