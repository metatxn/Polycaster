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
        return (
          <button
            key={outcome.tokenId}
            type="button"
            className={`flex-1 relative px-4 py-3 rounded-xl border-2 transition-all ${
              selectedOutcomeIndex === idx
                ? green
                  ? "border-emerald-500 bg-emerald-500/5"
                  : "border-red-500 bg-red-500/5"
                : "border-border hover:border-muted-foreground/50 bg-secondary/30"
            }`}
            onClick={() => onOutcomeChange(idx)}
          >
            {selectedOutcomeIndex === idx && (
              <span
                className={`absolute top-2 right-2 h-2 w-2 rounded-full ${
                  green ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
            )}
            <span
              className={`block text-sm font-medium ${
                green
                  ? "text-emerald-600 dark:text-emerald-400"
                  : outcome.name === "No" || idx === 1
                    ? "text-red-600 dark:text-red-400"
                    : "text-foreground"
              }`}
            >
              {outcome.name}
            </span>
            <span className="block text-lg font-semibold font-mono text-foreground mt-0.5">
              {formatPrice(outcome.price)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
