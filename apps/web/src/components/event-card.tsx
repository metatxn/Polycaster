"use client";

import { motion } from "framer-motion";
import {
  AlertCircle,
  Droplet,
  Flame,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  isGameFinished,
  isGameLive,
  LiveGameBadge,
} from "@/components/live-game-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LiveGameState } from "@/hooks/use-sports-websocket";
import { formatVolume } from "@/lib/formatters";

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

  // Parse volume values
  const volume24hr =
    typeof event.volume24hr === "string"
      ? Number.parseFloat(event.volume24hr)
      : event.volume24hr || 0;
  const volume1wk =
    typeof event.volume1wk === "string"
      ? Number.parseFloat(event.volume1wk)
      : event.volume1wk || 0;

  // Badge calculations based on volume thresholds:
  // - Lightning bolt (⚡): 24hr volume > $1M (high activity)
  // - HOT badge: weekly volume > $5M (trending market)
  const isHighVolume = volume24hr > 1_000_000; // > $1M 24hr shows lightning
  const isHot = volume1wk > 5_000_000; // > $5M weekly shows HOT badge

  // Parse liquidity - prefer liquidityClob (CLOB liquidity) over liquidity (AMM)
  const liquidity =
    typeof event.liquidityClob === "string"
      ? Number.parseFloat(event.liquidityClob)
      : typeof event.liquidityClob === "number"
        ? event.liquidityClob
        : typeof event.liquidity === "string"
          ? Number.parseFloat(event.liquidity)
          : event.liquidity || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: Math.min(index * 0.03, 0.3),
        ease: [0.23, 1, 0.32, 1],
      }}
      whileTap={{ scale: 0.98 }}
      className="h-full"
    >
      <Link
        href={href}
        className="group relative block h-full w-full text-left cursor-pointer"
      >
        {/* Outer glow on hover - hidden on touch devices */}
        <div className="absolute -inset-px rounded-2xl sm:rounded-[1.75rem] bg-linear-to-br from-purple-500/0 via-blue-500/0 to-emerald-500/0 group-hover:from-purple-500/30 group-hover:via-blue-500/30 group-hover:to-emerald-500/30 dark:group-hover:from-purple-500/50 dark:group-hover:via-blue-500/50 dark:group-hover:to-emerald-500/50 opacity-0 group-hover:opacity-100 transition-all duration-500 blur-xl hidden sm:block" />

        {/* Card Container - Enhanced mobile styling */}
        <div className="relative h-full rounded-2xl sm:rounded-3xl bg-white dark:bg-card/60 backdrop-blur-xl border border-gray-200 dark:border-white/8 overflow-hidden transition-all duration-300 sm:duration-500 group-hover:border-gray-300 dark:group-hover:border-white/20 group-hover:bg-white dark:group-hover:bg-card/80 shadow-md shadow-gray-200/50 dark:shadow-black/20 group-hover:shadow-lg sm:group-hover:shadow-xl group-hover:shadow-gray-300/50 dark:group-hover:shadow-purple-500/10 group-active:shadow-sm group-active:scale-[0.99] sm:group-active:scale-100">
          {/* Rainbow border effect on hover - desktop only */}
          <div className="absolute inset-0 rounded-2xl sm:rounded-3xl p-px bg-linear-to-br from-purple-500/0 via-transparent to-blue-500/0 group-hover:from-purple-400/20 group-hover:via-pink-400/15 group-hover:to-blue-400/20 dark:group-hover:from-purple-500/30 dark:group-hover:via-pink-500/20 dark:group-hover:to-blue-500/30 transition-all duration-500 pointer-events-none hidden sm:block" />

          {/* Image Section with Overlay */}
          <div className="relative aspect-16/10 w-full overflow-hidden">
            {event.image ? (
              <Image
                src={event.image}
                alt={event.title}
                fill
                priority={priority}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 20vw"
                className="object-cover transition-all duration-500 sm:duration-700 ease-out sm:group-hover:scale-110 sm:group-hover:brightness-110"
              />
            ) : (
              <div className="w-full h-full bg-linear-to-br from-purple-500/30 via-blue-500/20 to-emerald-500/30 flex items-center justify-center relative overflow-hidden">
                {/* Animated background pattern */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-size-[20px_20px] opacity-50" />
                <span className="relative text-4xl sm:text-5xl opacity-90 sm:group-hover:scale-125 transition-transform duration-300">
                  📊
                </span>
              </div>
            )}

            {/* Gradient Overlay - Only in dark mode for readability */}
            <div className="absolute inset-0 bg-linear-to-t from-transparent dark:from-background/80 via-transparent to-transparent dark:via-background/20 transition-all duration-300" />

            {/* Top Left Badges - Smaller on mobile */}
            <div className="absolute top-2 sm:top-3 left-2 sm:left-3 flex items-center gap-1.5 sm:gap-2">
              {hasLiveGame && (
                <span className="relative px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-wider bg-emerald-500 text-white rounded-md sm:rounded-lg shadow-lg shadow-emerald-500/30 border border-emerald-400/30 flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                  </span>
                  Live
                </span>
              )}
              {hasFinishedGame && (
                <span className="px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-zinc-600/80 text-white rounded-md sm:rounded-lg backdrop-blur-md border border-white/10">
                  Final
                </span>
              )}
              {event.negRisk && (
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="px-1.5 sm:px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-rose-500/90 text-white rounded-md sm:rounded-lg shadow-lg shadow-rose-500/30 border border-rose-400/30 flex items-center gap-1 cursor-help">
                        <AlertCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={8}
                      className="bg-rose-500 text-white border-rose-400 font-bold text-xs px-2.5 py-1.5 rounded-lg [&>svg]:hidden"
                    >
                      Negative Risk Market
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>

            {/* Hot Badge & Market Count - Top Right */}
            <div className="absolute top-2 sm:top-3 right-2 sm:right-3 flex items-center gap-1.5 sm:gap-2">
              {isHot && (
                <span className="px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-wider bg-linear-to-r from-orange-500 to-red-500 text-white rounded-md sm:rounded-lg shadow-lg shadow-orange-500/30 border border-orange-400/30 flex items-center gap-1 animate-pulse">
                  <Flame className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                  HOT
                </span>
              )}
              {marketCount > 0 && (
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-gray-900/70 dark:bg-black/60 text-white rounded-md sm:rounded-lg backdrop-blur-xl border border-gray-700/30 dark:border-white/10 cursor-help">
                        {marketCount}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={8}
                      className="bg-gray-900 dark:bg-black/90 text-white border-gray-700/50 dark:border-white/20 font-bold text-xs px-2.5 py-1.5 rounded-lg [&>svg]:hidden"
                    >
                      {marketCount} Market{marketCount !== 1 ? "s" : ""}{" "}
                      Available
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>

            {/* Volume Badge - Bottom Left */}
            {event.volume && (
              <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3">
                <div className="relative group/volume">
                  {/* Glow effect - desktop only */}
                  <div className="absolute inset-0 bg-emerald-500/30 rounded-full blur-md opacity-0 sm:group-hover:opacity-100 transition-opacity hidden sm:block" />
                  <div className="relative flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-emerald-600/90 dark:bg-black/70 backdrop-blur-xl rounded-full border border-emerald-500/30 dark:border-white/10 shadow-lg sm:group-hover/volume:border-emerald-400/50 transition-all">
                    <TrendingUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-emerald-100 dark:text-emerald-400" />
                    <span className="text-[10px] sm:text-xs font-black text-white tracking-wide">
                      {formatVolume(event.volume)}
                    </span>
                    {isHighVolume && (
                      <Zap className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-yellow-300 dark:text-yellow-400 animate-pulse" />
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Liquidity Badge - Bottom Right */}
            {liquidity > 0 && (
              <div className="absolute bottom-2 sm:bottom-3 right-2 sm:right-3">
                <div className="relative group/liquidity">
                  {/* Glow effect - desktop only */}
                  <div className="absolute inset-0 bg-blue-500/30 rounded-full blur-md opacity-0 sm:group-hover:opacity-100 transition-opacity hidden sm:block" />
                  <div className="relative flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-blue-600/90 dark:bg-black/70 backdrop-blur-xl rounded-full border border-blue-500/30 dark:border-white/10 shadow-lg sm:group-hover/liquidity:border-blue-400/50 transition-all">
                    <Droplet className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-blue-100 dark:text-blue-400" />
                    <span className="text-[10px] sm:text-xs font-black text-white tracking-wide">
                      {formatVolume(liquidity.toString())}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Content Section */}
          <div className="p-3 sm:p-5 space-y-2 sm:space-y-3 relative">
            {/* Subtle gradient glow on hover - desktop only */}
            <div className="absolute inset-0 bg-linear-to-t from-primary/5 to-transparent opacity-0 sm:group-hover:opacity-100 transition-opacity duration-500 pointer-events-none hidden sm:block" />

            <h3 className="relative font-bold sm:font-black text-sm sm:text-base md:text-lg leading-tight line-clamp-2 sm:group-hover:text-transparent sm:group-hover:bg-clip-text sm:group-hover:bg-linear-to-r sm:group-hover:from-foreground sm:group-hover:to-primary transition-all duration-300 wrap-break-word tracking-tight">
              {event.title || "Untitled Event"}
            </h3>

            {/* Live game scoreboard — only for in-progress or finished games */}
            {(hasLiveGame || hasFinishedGame) && liveGame && (
              <LiveGameBadge game={liveGame} />
            )}

            {/* Show description unless game badge is displayed */}
            {event.description && !hasLiveGame && !hasFinishedGame && (
              <p className="relative text-[11px] sm:text-xs font-medium text-muted-foreground line-clamp-2 leading-relaxed wrap-break-word opacity-80 sm:opacity-70 sm:group-hover:opacity-100 transition-opacity">
                {event.description}
              </p>
            )}
          </div>

          {/* Bottom Animated Border - desktop only */}
          <div className="absolute bottom-0 left-0 right-0 h-0.5 sm:h-1 overflow-hidden">
            <div className="h-full w-full bg-linear-to-r from-purple-500 via-blue-500 to-emerald-500 transform -translate-x-full sm:group-hover:translate-x-0 transition-transform duration-700 ease-out" />
          </div>

          {/* Corner Sparkle on Hover - Bottom Right to avoid overlap - desktop only */}
          <div className="absolute bottom-14 sm:bottom-16 right-3 sm:right-4 opacity-0 sm:group-hover:opacity-100 transition-all duration-500 sm:group-hover:rotate-12 hidden sm:block">
            <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-400/60" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
