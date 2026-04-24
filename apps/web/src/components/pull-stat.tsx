"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PullStatGridProps {
  /** Number of columns on desktop. On mobile always falls back to 2. */
  cols?: 2 | 3 | 4 | 5 | 6;
  className?: string;
  children: ReactNode;
}

const DESKTOP_COLS: Record<2 | 3 | 4 | 5 | 6, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
  6: "md:grid-cols-6",
};

/**
 * Pull-number grid — no card shells, just tabular-nums anchored to
 * mono captions and separated by hairline rules. Reads like a
 * broadsheet front page's stat band.
 */
export function PullStatGrid({
  cols = 4,
  className,
  children,
}: PullStatGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 border-y border-border/50 divide-x divide-y divide-border/40 md:divide-y-0",
        DESKTOP_COLS[cols],
        className
      )}
    >
      {children}
    </div>
  );
}

interface PullStatProps {
  /** Small-caps mono label above the numeric anchor. */
  label: string;
  /** Main value — typically tabular-nums currency or count. */
  value: ReactNode;
  /** Secondary caption rendered below. */
  caption?: ReactNode;
  /** Optional glyph rendered next to the value (e.g. trend arrow). */
  mark?: ReactNode;
  /** Override value class for colour (e.g. `text-emerald-500`). */
  valueClassName?: string;
  /** Show a skeleton shimmer in place of the value. */
  isLoading?: boolean;
}

export function PullStat({
  label,
  value,
  caption,
  mark,
  valueClassName,
  isLoading = false,
}: PullStatProps) {
  return (
    <div className="px-4 py-4 sm:py-5 flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        {isLoading ? (
          <span
            className="h-8 w-24 rounded bg-muted-foreground/15 animate-pulse"
            aria-hidden
          />
        ) : (
          <>
            <span
              className={cn(
                "text-2xl sm:text-3xl font-semibold tabular-nums text-foreground tracking-[-0.015em]",
                valueClassName
              )}
            >
              {value}
            </span>
            {mark}
          </>
        )}
      </div>
      {caption && (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80 tabular-nums">
          {caption}
        </span>
      )}
    </div>
  );
}

/** Small arrow glyph, matches the hero's mono/tracking aesthetic. */
export function TrendGlyph({ direction }: { direction: "up" | "down" }) {
  return (
    <span aria-hidden className="text-xs font-mono text-muted-foreground/70">
      {direction === "up" ? "↑" : "↓"}
    </span>
  );
}
