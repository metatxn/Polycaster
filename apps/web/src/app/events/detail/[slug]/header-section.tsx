"use client";

import type { LucideIcon } from "lucide-react";
import { Clock, Share2, Trophy } from "lucide-react";
import Image from "next/image";
import { NegRiskBadge } from "@/components/neg-risk-badge";
import { cn } from "@/lib/utils";

interface HeaderSectionProps {
  event: {
    title: string;
    image?: string;
    volume?: number | string;
    endDate?: string;
    negRisk?: boolean;
  };
  isScrolled: boolean;
  formatVolume: (vol?: number | string) => string;
  totalMarketsCount: number;
  openMarkets: unknown[];
  closedMarkets: unknown[];
}

function StatItem({
  icon: Icon,
  label,
  value,
  compact = false,
  className,
}: {
  icon?: LucideIcon;
  label?: string;
  value: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 shrink-0 transition-colors",
        compact ? "text-[10px] sm:text-[11px]" : "text-xs sm:text-[13px]",
        className
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "shrink-0 text-muted-foreground/60",
            compact ? "h-2.5 w-2.5" : "h-3 w-3"
          )}
        />
      )}
      <span className="font-mono uppercase tracking-[0.12em] font-semibold tabular-nums text-foreground">
        {value}
        {label && !compact && (
          <span className="ml-1.5 text-muted-foreground/70">{label}</span>
        )}
      </span>
    </div>
  );
}

export function HeaderSection({
  event,
  isScrolled,
  formatVolume,
  totalMarketsCount,
  openMarkets,
  closedMarkets,
}: HeaderSectionProps) {
  return (
    <div
      className={cn(
        "lg:sticky lg:top-0 z-30 -mx-4 px-4 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 transition-all duration-300",
        isScrolled
          ? "lg:bg-background/80 lg:backdrop-blur-md lg:border-b lg:border-border/40 lg:shadow-xs lg:py-3 lg:mb-4 py-4 mb-6"
          : "bg-transparent py-4 mb-6"
      )}
    >
      <div className="space-y-3 sm:space-y-4">
        {/* Title Row with Image, Title, and Action Buttons */}
        <div className="flex items-start gap-3 md:gap-4">
          {event.image && (
            <div
              className={cn(
                "relative shrink-0 aspect-video overflow-hidden rounded-sm border border-border/60 transition-all duration-300",
                isScrolled
                  ? "lg:w-16 w-20 sm:w-24 md:w-28"
                  : "w-20 sm:w-24 md:w-28"
              )}
            >
              <Image
                src={event.image}
                alt={event.title}
                fill
                sizes="(max-width: 640px) 80px, (max-width: 768px) 96px, 112px"
                className="object-cover"
              />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div
              className={cn(
                "flex-1 min-w-0",
                // On md (tablet): Always use flex layout for bottom alignment
                // On lg (desktop): Only use flex layout when not scrolled
                "md:h-20 md:flex md:flex-col md:justify-between",
                isScrolled && "lg:h-auto lg:block"
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h1
                    className={cn(
                      "font-editorial italic font-medium leading-[1.05] tracking-tight transition-all duration-300 flex-1 min-w-0",
                      isScrolled
                        ? "lg:text-[28px] text-2xl sm:text-3xl md:text-4xl"
                        : "text-2xl sm:text-3xl md:text-[38px]"
                    )}
                  >
                    {event.title}
                  </h1>

                  {/* Action Buttons - Icon only on mobile/tablet, with text on desktop */}
                  <div
                    className={cn(
                      "flex items-center gap-1.5 shrink-0 transition-all duration-300",
                      isScrolled ? "lg:scale-90 scale-100" : "scale-100"
                    )}
                  >
                    {/* Neg Risk Icon - Only on mobile (md and below) */}
                    {event.negRisk && (
                      <NegRiskBadge iconOnly className="md:hidden" />
                    )}
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center justify-center rounded-md text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent/60 hover:text-foreground",
                        "h-8 w-8 lg:h-8 lg:w-auto lg:px-2.5 lg:gap-1.5"
                      )}
                      onClick={async () => {
                        if (typeof window !== "undefined" && navigator.share) {
                          try {
                            await navigator.share({
                              title: event.title,
                              url: window.location.href,
                            });
                          } catch (err) {
                            if ((err as Error).name !== "AbortError") {
                              console.error("Share failed:", err);
                            }
                          }
                        }
                      }}
                    >
                      <Share2 className="h-4 w-4" />
                      <span className="hidden lg:inline">Share</span>
                    </button>
                  </div>
                </div>
                {/* Compact Stats Row - visible only when scrolled on large desktop (lg+) */}
                <div
                  className={cn(
                    "flex flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 transition-all duration-300",
                    isScrolled
                      ? "lg:opacity-100 lg:translate-x-0 lg:w-auto lg:h-auto lg:overflow-visible lg:pointer-events-auto lg:mt-1 mt-1.5 opacity-0 -translate-x-2 pointer-events-none w-0 h-0 overflow-hidden"
                      : "opacity-0 -translate-x-2 pointer-events-none w-0 h-0 overflow-hidden"
                  )}
                >
                  <StatItem
                    icon={Trophy}
                    value={formatVolume(event.volume)}
                    compact
                  />
                  {event.endDate && (
                    <StatItem
                      icon={Clock}
                      value={new Date(event.endDate).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                        }
                      )}
                      compact
                    />
                  )}
                  <StatItem value={`${totalMarketsCount} mkts`} compact />
                  {closedMarkets.length > 0 && (
                    <StatItem
                      value={`${openMarkets.length} open · ${closedMarkets.length} closed`}
                      compact
                    />
                  )}
                  {event.negRisk && <NegRiskBadge />}
                </div>
              </div>

              {/* Full Stats Row for Tablet and Desktop - bottom-aligned with avatar
                    - On md (tablet): Always visible (no sticky header)
                    - On lg (desktop): Hidden when scrolled (compact stats appear in sticky header instead)
                */}
              <div
                className={cn(
                  "hidden md:flex flex-wrap items-center gap-2 mt-2 text-muted-foreground",
                  isScrolled && "lg:hidden"
                )}
              >
                <StatItem
                  icon={Trophy}
                  value={formatVolume(event.volume)}
                  label="Vol."
                  className="text-xs sm:text-sm"
                />
                {event.endDate && (
                  <StatItem
                    icon={Clock}
                    value={new Date(event.endDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    className="text-xs sm:text-sm"
                  />
                )}
                <StatItem
                  value={`${totalMarketsCount} market${
                    totalMarketsCount !== 1 ? "s" : ""
                  }`}
                  className="text-xs sm:text-sm"
                />
                {closedMarkets.length > 0 && (
                  <StatItem
                    value={`${openMarkets.length} open • ${closedMarkets.length} closed`}
                    className="text-xs sm:text-sm"
                  />
                )}
                {event.negRisk && <NegRiskBadge />}
              </div>
            </div>
          </div>
        </div>

        {/* Full Stats Row - Only shown on mobile (below md), hidden on tablet and desktop */}
        <div className="md:hidden">
          <div
            className={cn(
              "text-muted-foreground flex flex-wrap items-center gap-1.5"
            )}
          >
            <StatItem
              icon={Trophy}
              value={formatVolume(event.volume)}
              label="Vol."
              className="text-[11px] xs:text-xs sm:text-sm shrink-0"
            />
            {event.endDate && (
              <StatItem
                icon={Clock}
                value={new Date(event.endDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                className="text-[11px] xs:text-xs sm:text-sm shrink-0"
              />
            )}
            <StatItem
              value={`${totalMarketsCount} market${
                totalMarketsCount !== 1 ? "s" : ""
              }`}
              className="text-[11px] xs:text-xs sm:text-sm shrink-0"
            />
            {closedMarkets.length > 0 && (
              <StatItem
                value={`${openMarkets.length} open • ${closedMarkets.length} closed`}
                className="text-[11px] xs:text-xs sm:text-sm shrink-0"
              />
            )}
            {/* NegRiskBadge is shown next to share button on mobile, so hide it here */}
          </div>
        </div>
      </div>
    </div>
  );
}
