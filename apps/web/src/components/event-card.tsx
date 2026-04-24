"use client";

import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  isGameFinished,
  isGameLive,
  LiveGameBadge,
} from "@/components/live-game-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LiveGameState } from "@/hooks/use-sports-websocket";
import { formatVolume } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface EventCardProps {
  event: {
    id: string;
    slug?: string;
    title: string;
    description?: string;
    image?: string;
    volume?: string;
    volume24hr?: number | string;
    volume1wk?: number | string;
    volume1mo?: number | string;
    volume1yr?: number | string;
    liquidity?: number | string;
    liquidityClob?: number | string;
    competitive?: number;
    live?: boolean;
    ended?: boolean;
    active?: boolean;
    closed?: boolean;
    negRisk?: boolean;
    startDate?: string;
    endDate?: string;
    markets?: Array<{
      id: string;
      question?: string;
      outcomes?: string;
      outcomePrices?: string;
      groupItemTitle?: string;
    }>;
    tags?: Array<string | { id?: string; slug?: string; label?: string }>;
  };
  index?: number;
  priority?: boolean;
  /** Live game data from sports websocket, if available */
  liveGame?: LiveGameState | null;
}

export function EventCard({
  event,
  index = 0,
  priority = false,
  liveGame,
}: EventCardProps) {
  // Prefer slug for SEO-friendly URLs, fallback to ID
  const href = event.slug
    ? `/events/detail/${event.slug}`
    : event.id
      ? `/events/detail/${event.id}`
      : "#";
  const marketCount = event.markets?.length || 0;
  const hasLiveGame = liveGame
    ? isGameLive(liveGame.status)
    : event.live === true;
  const hasFinishedGame = liveGame
    ? isGameFinished(liveGame.status)
    : event.ended === true;

  const volume1wk =
    typeof event.volume1wk === "string"
      ? Number.parseFloat(event.volume1wk)
      : event.volume1wk || 0;

  // HOT badge: weekly volume > $5M (trending market)
  const isHot = volume1wk > 5_000_000;

  // Dynamic padding-right on the title block: one slot per corner chip,
  // so cards with a single chip don't over-reserve and 4-chip clusters
  // don't crowd the title's first line. Each chip averages ~38px incl.
  // gap; the cluster sits at top-right with gap-1 (4px) between items.
  const chipCount =
    (hasLiveGame ? 1 : 0) +
    (hasFinishedGame ? 1 : 0) +
    (isHot ? 1 : 0) +
    (event.negRisk ? 1 : 0);

  // Matchup titles ("X vs Y") read as natural italic phrases — let
  // them carry Fraunces so the grid doesn't fall off the hero's
  // typographic cliff. Tournament/listing titles stay tight sans.
  const isMatchup = /\s+vs\.?\s+/i.test(event.title || "");
  const titlePaddingRight =
    chipCount === 0
      ? ""
      : chipCount === 1
        ? "pr-12 sm:pr-14"
        : chipCount === 2
          ? "pr-20 sm:pr-24"
          : chipCount === 3
            ? "pr-28 sm:pr-32"
            : "pr-36 sm:pr-40";

  // Extract top outcomes for the Polymarket-style list: for multi-market
  // events (e.g. "World Cup Winner" with 32 teams), each market is a
  // candidate — use its `groupItemTitle` + YES price. For single-market
  // events (binary Yes/No or head-to-head), parse `outcomes` and
  // `outcomePrices` to show both sides.
  const displayOutcomes = (() => {
    const markets = event.markets || [];
    if (markets.length === 0) return [];

    const parseJson = <T,>(v: string | undefined): T | null => {
      if (!v) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    };

    if (markets.length > 1) {
      // Use groupItemTitle when available (clean candidate name, e.g.
      // "Brazil", "Gavin Newsom"). When absent, fall back to `question`
      // but strip any common prefix across markets so rows don't all
      // read as near-identical strings.
      const rawNames = markets.map((m) => m.groupItemTitle || m.question || "");
      const hasGroupTitles = markets.every((m) => Boolean(m.groupItemTitle));

      let names = rawNames;
      if (!hasGroupTitles && rawNames.length > 1) {
        // Longest common prefix across all names.
        let prefix = rawNames[0];
        for (const n of rawNames.slice(1)) {
          while (prefix && !n.startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
          }
          if (!prefix) break;
        }
        if (prefix.length >= 4) {
          // Strip the prefix plus any leading separator junk (" - ",
          // ": ", etc.) that would otherwise render as " — ? 50%".
          // If stripping leaves the name empty (happens when one
          // market's full question IS the shared prefix), fall back
          // to the original — truncate will handle overflow.
          names = rawNames.map((n) => {
            const remainder = n
              .slice(prefix.length)
              .replace(/^[\s\-:–—|,/]+/, "")
              .trim();
            return remainder || n;
          });
        }
      }

      return markets
        .map((m, i) => {
          const prices = parseJson<string[]>(m.outcomePrices) || [];
          const price = Number.parseFloat(prices[0] || "0");
          return {
            name: names[i] || rawNames[i],
            price: Number.isFinite(price) ? price : 0,
          };
        })
        .filter((o) => o.name && o.price > 0)
        .sort((a, b) => b.price - a.price)
        .slice(0, 3);
    }

    const m = markets[0];
    const names = parseJson<string[]>(m.outcomes) || [];
    const prices = parseJson<string[]>(m.outcomePrices) || [];
    return names
      .map((name, i) => {
        const price = Number.parseFloat(prices[i] || "0");
        return {
          name,
          price: Number.isFinite(price) ? price : 0,
        };
      })
      .filter((o) => o.name)
      .slice(0, 3);
  })();

  // Parse liquidity - prefer liquidityClob (CLOB liquidity) over liquidity (AMM)
  const liquidity =
    typeof event.liquidityClob === "string"
      ? Number.parseFloat(event.liquidityClob)
      : typeof event.liquidityClob === "number"
        ? event.liquidityClob
        : typeof event.liquidity === "string"
          ? Number.parseFloat(event.liquidity)
          : event.liquidity || 0;

  // Only run entry animation on the initial page of cards. Cards appended via
  // infinite-scroll skip the animation to avoid extra main-thread work and to
  // keep the grid visually stable as the user scrolls.
  const animateEntry = index < 20;

  return (
    <motion.div
      initial={animateEntry ? { opacity: 0, y: 20 } : false}
      animate={animateEntry ? { opacity: 1, y: 0 } : undefined}
      transition={
        animateEntry
          ? {
              duration: 0.4,
              delay: Math.min(index * 0.03, 0.3),
              ease: [0.23, 1, 0.32, 1],
            }
          : undefined
      }
      whileTap={{ scale: 0.98 }}
      className="h-full"
    >
      <Link
        href={href}
        className="group relative block h-full w-full text-left cursor-pointer"
      >
        {/* Card container — flat cream surface; no shadow, border does
            the framing. Hover is a hairline reveal at the footer edge
            (see the .group-hover span below), not a lift. */}
        <div className="relative h-full bg-card border border-border/60 transition-colors duration-200 ease-out sm:group-hover:border-foreground/30 contain-[layout] p-3 sm:p-4 flex flex-col gap-3 overflow-hidden">
          {/* Hairline reveal — anchored to the bottom of the card,
              extends left-to-right on hover. Replaces the generic
              lift/shadow pair with an editorial tell. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-4 sm:inset-x-5 bottom-0 h-px bg-foreground origin-left scale-x-0 transition-transform duration-300 ease-out sm:group-hover:scale-x-100"
          />

          {/* Top-right chip cluster — four chips share a single
              template (mono caps, ink fill, same padding/height). Only
              color + content differentiate. */}
          {chipCount > 0 && (
            <div className="absolute top-2 sm:top-3 right-2 sm:right-3 flex items-center gap-1">
              {hasLiveGame && (
                <span className="inline-flex items-center gap-1 px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] bg-emerald-500 text-white rounded-sm">
                  <span className="relative flex h-1 w-1">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex rounded-full h-1 w-1 bg-white" />
                  </span>
                  Live
                </span>
              )}
              {hasFinishedGame && (
                <span className="inline-flex items-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] bg-foreground/85 text-background rounded-sm">
                  Final
                </span>
              )}
              {isHot && (
                <span className="inline-flex items-center gap-1 px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] bg-foreground/85 text-background rounded-sm">
                  <Flame className="w-2.5 h-2.5 text-orange-400" />
                  Hot
                </span>
              )}
              {event.negRisk && (
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] bg-foreground/85 text-background rounded-sm cursor-help">
                        NR
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={8}
                      className="bg-foreground text-background border-transparent font-medium text-xs px-2.5 py-1.5 rounded-md [&>svg]:hidden"
                    >
                      Negative Risk Market
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}

          {/* Top row: thumbnail + title. Thumbnail is naked against
              cream — no ring — so the image silhouette reads directly.
              For fallback letters, Fraunces italic echoes the hero. */}
          <div className="flex items-start gap-3">
            <div className="relative w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-md overflow-hidden bg-muted">
              {event.image ? (
                <Image
                  src={event.image}
                  alt={event.title}
                  fill
                  priority={priority}
                  fetchPriority={priority ? "high" : undefined}
                  sizes="56px"
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="font-editorial italic text-xl sm:text-2xl text-foreground/30 leading-none">
                    {(event.title || "M").trim().charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>

            <div className={cn("flex-1 min-w-0", titlePaddingRight)}>
              <h3
                className={cn(
                  "leading-snug line-clamp-2 wrap-break-word text-foreground transition-colors duration-200 sm:group-hover:text-foreground",
                  // Matchup-style titles ("Rockets vs. Lakers",
                  // "Elche CF vs. Club Atlético") get Fraunces italic
                  // to thread the hero's typographic voice into the
                  // grid. Long tournament names stay tight sans where
                  // density matters more than character.
                  isMatchup
                    ? "font-editorial italic text-[15px] sm:text-base tracking-[-0.005em]"
                    : "font-semibold text-sm sm:text-[15px] tracking-[-0.015em]"
                )}
              >
                {event.title || "Untitled Event"}
              </h3>
            </div>
          </div>

          {(hasLiveGame || hasFinishedGame) && liveGame && (
            <LiveGameBadge game={liveGame} />
          )}

          {displayOutcomes.length > 0 && (
            <div className="space-y-1.5">
              {displayOutcomes.map((o, i) => {
                const pct = Math.max(0, Math.min(100, o.price * 100));
                // Hide the proportion bar for resolved / near-resolved
                // outcomes — a full or empty bar is visual noise and
                // reads as redundant once the percentage is shown. The
                // bar earns its space only when there's a meaningful
                // in-play proportion to convey.
                const showBar = pct > 1 && pct < 99;
                const isLeader = i === 0;
                return (
                  <div key={`${o.name}-${i}`} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs">
                      <span
                        className={cn(
                          "truncate flex-1 min-w-0",
                          isLeader
                            ? "text-foreground font-semibold"
                            : "text-foreground/75 font-medium"
                        )}
                      >
                        {o.name}
                      </span>
                      <span
                        className={cn(
                          "font-mono tabular-nums shrink-0",
                          isLeader
                            ? "text-foreground font-bold text-[12px] sm:text-[13px]"
                            : "text-foreground/75 font-semibold"
                        )}
                      >
                        {pct < 1
                          ? "<1%"
                          : pct > 99 && pct < 100
                            ? ">99%"
                            : `${Math.round(pct)}%`}
                      </span>
                    </div>
                    {showBar && (
                      <div
                        className={cn(
                          "bg-muted rounded-full overflow-hidden",
                          isLeader ? "h-[3px]" : "h-0.5"
                        )}
                      >
                        <div
                          className={cn(
                            "h-full transition-[width] duration-500",
                            isLeader ? "bg-foreground" : "bg-foreground/50"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(event.volume || liquidity > 0 || marketCount > 0) && (
            <div className="flex items-center gap-3 mt-auto pt-2.5 border-t border-border/40 text-[10px] sm:text-[11px] font-mono tabular-nums text-muted-foreground">
              {event.volume && (
                <span className="inline-flex items-baseline gap-1">
                  <span className="text-foreground font-semibold">
                    {formatVolume(event.volume)}
                  </span>
                  <span className="uppercase tracking-[0.12em] text-[9px]">
                    vol
                  </span>
                </span>
              )}
              {liquidity > 0 && (
                <span className="inline-flex items-baseline gap-1">
                  <span className="text-foreground/80">
                    {formatVolume(liquidity.toString())}
                  </span>
                  <span className="uppercase tracking-[0.12em] text-[9px]">
                    liq
                  </span>
                </span>
              )}
              {marketCount > 0 && (
                <span className="ml-auto inline-flex items-baseline gap-1">
                  <span className="text-foreground/80">{marketCount}</span>
                  <span className="uppercase tracking-[0.12em] text-[9px]">
                    {marketCount === 1 ? "mkt" : "mkts"}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  );
}

/**
 * Loading skeleton that mirrors the EventCard layout: thumbnail + title
 * block, three outcome rows with mini bars, and the data footer. Kept
 * in this file so any structural change to the card naturally drags the
 * skeleton along with it.
 *
 * Accepts a className so grid renderers can stamp out extra skeletons
 * that only light up at wider breakpoints (keeps the skeleton row count
 * aligned with the visible grid column count).
 */
/**
 * Visibility class for the Nth skeleton in a loading grid, sized to
 * show ~2 rows at each breakpoint — matching the 1/2/3/4/5-col responsive
 * grid so we never load 5 skeletons into a 4-col layout (the original
 * bug that looked like a hanging orphan).
 *
 * Render 10 skeletons and pass the index here; indices beyond the
 * breakpoint's row budget are `hidden` until the viewport upgrades.
 */
export function skeletonVisibilityClass(index: number): string {
  // i 0-3: always (1 col × 4 rows, or 2 col × 2 rows)
  if (index < 4) return "";
  // i 4-5: revealed at lg (3 cols × 2 rows = 6)
  if (index < 6) return "hidden lg:block";
  // i 6-7: revealed at xl (4 cols × 2 rows = 8)
  if (index < 8) return "hidden xl:block";
  // i 8-9: revealed at 2xl (5 cols × 2 rows = 10)
  return "hidden 2xl:block";
}

export function EventCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-card border border-border/60 p-3 sm:p-4 flex flex-col gap-3 h-full",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <Skeleton className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-md bg-foreground/10" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-3 w-14 bg-foreground/10 rounded-sm" />
          <Skeleton className="h-4 w-[85%] bg-foreground/10 rounded" />
          <Skeleton className="h-4 w-[55%] bg-foreground/10 rounded" />
        </div>
      </div>

      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Skeleton
                className="h-3 bg-foreground/10 rounded"
                style={{ width: `${[55, 45, 40][i]}%` }}
              />
              <Skeleton className="h-3 w-8 bg-foreground/10 rounded" />
            </div>
            <Skeleton className="h-0.5 w-full bg-foreground/5 rounded-full" />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-auto pt-2.5 border-t border-border/40">
        <Skeleton className="h-3 w-16 bg-foreground/10 rounded" />
        <Skeleton className="h-3 w-14 bg-foreground/10 rounded" />
        <Skeleton className="h-3 w-10 bg-foreground/10 rounded ml-auto" />
      </div>
    </div>
  );
}
