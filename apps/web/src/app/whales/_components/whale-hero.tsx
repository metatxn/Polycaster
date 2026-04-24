"use client";

import { ChevronLeft, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { WhaleIcon } from "./whale-icon";

interface WhaleHeroProps {
  /** Either "Whale Activity" or "Insider Detection" — reflects the
   *  current tab for the breadcrumb's second crumb. */
  section: string;
  /** Milliseconds since the data was last updated. Used to render a
   *  freshness indicator. */
  dataAgeMs: number | null;
  /** Websocket connection state for the live tape. Only meaningful on
   *  the Whales tab; caller may pass null on Insiders. */
  isLive: boolean | null;
  isFetching: boolean;
  onRefresh: () => void;
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export function WhaleHero({
  section,
  dataAgeMs,
  isLive,
  isFetching,
  onRefresh,
}: WhaleHeroProps) {
  const router = useRouter();
  const isFresh = dataAgeMs !== null && dataAgeMs < 120_000;

  return (
    <div className="mb-6 animate-in fade-in duration-500">
      {/* Breadcrumb — matches /events treatment */}
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground mb-6">
        <button
          type="button"
          onClick={() => router.push("/markets")}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Markets</span>
        </button>
        <span className="text-border/80">&rsaquo;</span>
        <span className="text-foreground">Whales</span>
        <span className="text-border/80">&rsaquo;</span>
        <span className="text-foreground">{section}</span>
      </div>

      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0 md:flex-1 md:max-w-3xl">
          <h1 className="font-editorial italic font-medium text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.02] tracking-tight text-foreground inline-flex items-center gap-3 sm:gap-4 wrap-break-word">
            <span>Whales</span>
            <WhaleIcon
              className="h-7 sm:h-9 md:h-11 lg:h-14 w-auto text-foreground/80"
              aria-hidden
            />
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground font-editorial leading-snug max-w-2xl">
            A live ledger of the largest traders on Polymarket. Watch where the
            deep pockets are going before the price catches up.
          </p>
        </div>

        {/* Right-side meta: live indicator + data freshness + refresh */}
        <div className="flex items-center gap-4 flex-wrap md:flex-nowrap md:shrink-0 md:pb-1 font-mono text-[10px] uppercase tracking-[0.14em]">
          {isLive !== null && (
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
                {isLive ? "Live tape" : "Offline"}
              </span>
            </div>
          )}

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

          <button
            type="button"
            onClick={onRefresh}
            disabled={isFetching}
            className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-3 w-3", isFetching && "animate-spin")}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="mt-6 h-px bg-linear-to-r from-border/80 via-border/40 to-transparent" />
    </div>
  );
}
