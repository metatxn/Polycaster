"use client";

import { ChevronLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Product hero — DeFi/financial-terminal counterpart to `EditorialHero`.
 *
 * Mirrors EditorialHero's prop API so product routes can swap one for the
 * other without rewiring callers. Differences:
 *
 *  - Title is small mono-caps (not 7xl italic Fraunces). The hero competes
 *    less with the data below it.
 *  - Subtitle is a single muted line, not an editorial pull quote.
 *  - Breadcrumb + right meta share the same mono micro-caps rhythm so the
 *    surface reads as one consolidated utility row.
 *  - Bottom hairline uses the `--kwm-hl` token from `.kw-app` so it tracks
 *    the active theme.
 *
 * Must be rendered inside a `.kw-app` ancestor to pick up Geist + the
 * scoped token system.
 */

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface ProductHeroProps {
  breadcrumbs: BreadcrumbItem[];
  rightSlot?: ReactNode;
  belowSlot?: ReactNode;
  className?: string;
}

/**
 * Single-row breadcrumb + meta strip. Mirrors the markets `<UtilityBar>`
 * grammar: route identity is carried by the last breadcrumb crumb (so a
 * separate H1 is redundant), with optional right-aligned meta (search,
 * counts, freshness, refresh). Bottom hairline closes the strip; pass
 * `belowSlot` for any extra action row (e.g. a search input on /live).
 */
export function ProductHero({
  breadcrumbs,
  rightSlot,
  belowSlot,
  className,
}: ProductHeroProps) {
  const router = useRouter();
  const firstCrumb = breadcrumbs[0];

  return (
    <div className={cn("mb-5", className)}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div
          className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] flex-wrap"
          style={{ color: "var(--kwm-ink-3)" }}
        >
          {firstCrumb?.href ? (
            <Link
              href={firstCrumb.href}
              className="flex items-center gap-1 transition-colors hover:text-[var(--kwm-ink)]"
            >
              <ChevronLeft className="h-3 w-3" />
              <span>{firstCrumb.label}</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1 transition-colors hover:text-[var(--kwm-ink)]"
            >
              <ChevronLeft className="h-3 w-3" />
              <span>{firstCrumb?.label ?? "Back"}</span>
            </button>
          )}
          {breadcrumbs.slice(1).map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 2;
            return (
              <span
                key={`${crumb.label}-${idx}`}
                className="flex items-center gap-2"
              >
                <span style={{ color: "var(--kwm-hl-2)" }}>&rsaquo;</span>
                {crumb.href && !isLast ? (
                  <Link
                    href={crumb.href}
                    className="transition-colors hover:text-[var(--kwm-ink)]"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    style={isLast ? { color: "var(--kwm-ink)" } : undefined}
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {rightSlot && (
          <div
            className="flex items-center gap-3 flex-wrap md:flex-nowrap md:shrink-0 font-mono text-[10px] uppercase tracking-[0.14em]"
            style={{ color: "var(--kwm-ink-3)" }}
          >
            {rightSlot}
          </div>
        )}
      </div>

      {belowSlot}

      <div className="mt-4 h-px" style={{ background: "var(--kwm-hl)" }} />
    </div>
  );
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** "Updated Xs ago" meta — mono compact, ticks every second when paired
 *  with a re-rendering parent. */
export function ProductDataAge({
  dataAgeMs,
  freshThresholdMs = 120_000,
}: {
  dataAgeMs: number | null;
  freshThresholdMs?: number;
}) {
  const isFresh = dataAgeMs !== null && dataAgeMs < freshThresholdMs;
  return (
    <div className="flex items-center gap-1.5">
      <span>Updated</span>
      <span
        className="font-semibold tabular-nums"
        style={{
          color: isFresh ? "var(--kwm-ink)" : "var(--kwm-ink-3)",
        }}
      >
        {dataAgeMs === null ? "—" : formatAge(dataAgeMs)}
      </span>
      <span>ago</span>
    </div>
  );
}

export function ProductRefreshButton({
  onRefresh,
  isFetching = false,
  label = "Refresh",
}: {
  onRefresh: () => void;
  isFetching?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isFetching}
      className="inline-flex items-center gap-1 px-2 py-1 transition-colors disabled:opacity-50 hover:text-[var(--kwm-ink)]"
    >
      <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
      <span>{label}</span>
    </button>
  );
}

export function ProductLiveDot({
  isLive,
  liveLabel = "Live",
  offlineLabel = "Offline",
}: {
  isLive: boolean | null;
  liveLabel?: string;
  offlineLabel?: string;
}) {
  if (isLive === null) return null;
  return (
    <div className="flex items-center gap-1.5">
      {isLive ? (
        <span className="kwm-pulse" />
      ) : (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--kwm-ink-dim)" }}
        />
      )}
      <span>{isLive ? liveLabel : offlineLabel}</span>
    </div>
  );
}
