"use client";

import { ChevronLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface EditorialHeroProps {
  /** Breadcrumb trail. Last item is treated as current (no link, no hover). */
  breadcrumbs: BreadcrumbItem[];
  /** Rendered inside an h1 with Fraunces italic. Pass a string for plain text
   *  or a ReactNode if you need to slot an icon/accessory next to the word. */
  title: ReactNode;
  /** Optional sub-heading set in Fraunces regular, muted. */
  subtitle?: ReactNode;
  /** Optional right-side meta cluster: live dot, updated age, refresh, etc.
   *  See `HeroLiveDot`, `HeroDataAge`, `HeroRefreshButton` helpers. */
  rightSlot?: ReactNode;
  /** Extra content between hero and bottom hairline (e.g. action row). */
  belowSlot?: ReactNode;
  /** Hide the fade-in animation. Use for pages that already wrap in motion. */
  disableFade?: boolean;
  /** Class applied to the outer wrapper. */
  className?: string;
}

export function EditorialHero({
  breadcrumbs,
  title,
  subtitle,
  rightSlot,
  belowSlot,
  disableFade = false,
  className,
}: EditorialHeroProps) {
  const router = useRouter();
  const firstCrumb = breadcrumbs[0];

  return (
    <div
      className={cn(
        "mb-6",
        !disableFade && "animate-in fade-in duration-500",
        className
      )}
    >
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground mb-6 flex-wrap">
        {firstCrumb?.href ? (
          <Link
            href={firstCrumb.href}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>{firstCrumb.label}</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => router.back()}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
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
              <span className="text-border/80">&rsaquo;</span>
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="hover:text-foreground transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className={cn(isLast && "text-foreground")}>
                  {crumb.label}
                </span>
              )}
            </span>
          );
        })}
      </div>

      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0 md:flex-1 md:max-w-3xl">
          <h1 className="font-editorial italic font-medium text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.02] tracking-tight text-foreground inline-flex items-center gap-3 sm:gap-4 wrap-break-word">
            {title}
          </h1>
          {subtitle && (
            <div className="mt-4 text-base sm:text-lg text-muted-foreground font-editorial leading-snug max-w-2xl">
              {subtitle}
            </div>
          )}
        </div>

        {rightSlot && (
          <div className="flex items-center gap-4 flex-wrap md:flex-nowrap md:shrink-0 md:pb-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            {rightSlot}
          </div>
        )}
      </div>

      {belowSlot}

      <div className="mt-6 h-px bg-linear-to-r from-border/80 via-border/40 to-transparent" />
    </div>
  );
}

/** Animated live-state dot. Pass `null` to hide entirely. */
export function HeroLiveDot({
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
      <span
        className={cn(
          "relative flex h-1.5 w-1.5",
          isLive ? "text-emerald-600" : "text-muted-foreground/50"
        )}
      >
        {isLive && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500/75" />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full h-1.5 w-1.5",
            isLive ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
        />
      </span>
      <span className="text-muted-foreground">
        {isLive ? liveLabel : offlineLabel}
      </span>
    </div>
  );
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/** "Updated Xm ago" freshness indicator. */
export function HeroDataAge({
  dataAgeMs,
  freshThresholdMs = 120_000,
}: {
  dataAgeMs: number | null;
  freshThresholdMs?: number;
}) {
  const isFresh = dataAgeMs !== null && dataAgeMs < freshThresholdMs;
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <span>Updated</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          isFresh ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {dataAgeMs === null ? "—" : formatAge(dataAgeMs)}
      </span>
      <span>ago</span>
    </div>
  );
}

/** Mono-style refresh button, matches the rest of the hero meta row. */
export function HeroRefreshButton({
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
      className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
    >
      <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
      <span>{label}</span>
    </button>
  );
}
