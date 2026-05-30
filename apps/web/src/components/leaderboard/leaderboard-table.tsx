"use client";

import { motion } from "framer-motion";
import { BadgeCheck, Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LeaderboardTrader } from "@/hooks/use-leaderboard";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface LeaderboardTableProps {
  traders: LeaderboardTrader[];
  isLoading?: boolean;
  orderBy: "PNL" | "VOL";
  highlightAddress?: string;
}

/** Editorial rank accent — a hairline color under the tabular-nums
 *  numeral for the top three, nothing else. Keeps the broadsheet feel
 *  without resorting to gradient badges. */
function rankAccentClass(rank: number): string {
  if (rank === 1) return "after:bg-yellow-500/70";
  if (rank === 2) return "after:bg-(--kwm-ink-3)/60";
  if (rank === 3) return "after:bg-amber-600/70";
  return "after:bg-transparent";
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Some traders have a `userName` that's actually a raw wallet address
 *  (often with a suffix like `-1772479215461`). Showing that raw string
 *  at full width overflows on mobile and adds no information. Treat
 *  anything starting with 0x as address-shaped and shorten it. */
function isRawAddressLike(name: string): boolean {
  return /^0x[0-9a-fA-F]{8,}/.test(name);
}

function displayName(trader: LeaderboardTrader): string {
  if (!trader.userName || isRawAddressLike(trader.userName)) {
    return formatAddress(trader.proxyWallet);
  }
  return trader.userName;
}

/** True when the visible display name IS the wallet, so we don't render the
 *  same shortened address twice (display name + address subtitle). */
function nameIsAddress(trader: LeaderboardTrader): boolean {
  return !trader.userName || isRawAddressLike(trader.userName);
}

function getInitials(name: string | null, _address: string) {
  if (name && name.length > 0 && !isRawAddressLike(name)) {
    const parts = name.split(/[\s-]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return "0X";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          className="p-1 text-(--kwm-ink-3)/70 hover:text-(--kwm-ink) transition-colors"
        >
          {copied ? (
            <Check className="h-3 w-3 text-(--kwm-up)" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : "Copy address"}</TooltipContent>
    </Tooltip>
  );
}

export function LeaderboardTable({
  traders,
  isLoading,
  orderBy,
  highlightAddress,
}: LeaderboardTableProps) {
  const router = useRouter();

  const handleRowClick = (proxyWallet: string) => {
    router.push(`/profile/${proxyWallet}`);
  };

  if (isLoading) {
    return (
      <div>
        {[...Array(10)].map((_, i) => (
          <div
            key={`skeleton-${i}`}
            className="flex items-center gap-4 px-3 py-4 border-b border-(--kwm-hl)"
          >
            <Skeleton className="h-5 w-8" />
            <Skeleton className="h-9 w-9 rounded-sm" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (traders.length === 0) {
    return (
      <div className="text-center py-16 border-t border-(--kwm-hl)">
        <p className="font-editorial italic text-xl text-(--kwm-ink-3) mb-2">
          No traders found
        </p>
        <p className="text-sm text-(--kwm-ink-3)">
          Try adjusting your filters.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      {/* Desktop Table — editorial hairline rows */}
      <div className="hidden md:block">
        {/* Column headers */}
        <div className="grid grid-cols-[64px_minmax(0,1fr)_160px_160px_64px] items-center gap-3 px-3 py-2.5 border-y border-(--kwm-hl) font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
          <span className="text-left">Rank</span>
          <span>Trader</span>
          <span
            className={cn(
              "text-right tabular-nums",
              orderBy === "VOL" && "text-(--kwm-ink) font-semibold"
            )}
          >
            Volume
          </span>
          <span
            className={cn(
              "text-right tabular-nums",
              orderBy === "PNL" && "text-(--kwm-ink) font-semibold"
            )}
          >
            P&L
          </span>
          <span className="text-right">Social</span>
        </div>

        {traders.map((trader, index) => {
          const rank = Number.parseInt(trader.rank, 10);
          const isHighlighted =
            highlightAddress?.toLowerCase() ===
            trader.proxyWallet.toLowerCase();
          const isProfitable = trader.pnl >= 0;
          const rankDisplay = rank < 10 ? `0${rank}` : `${rank}`;

          return (
            <motion.div
              key={trader.proxyWallet}
              role="button"
              tabIndex={0}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.015, 0.3) }}
              onClick={() => handleRowClick(trader.proxyWallet)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleRowClick(trader.proxyWallet);
                }
              }}
              className={cn(
                "leaderboard-row group w-full grid grid-cols-[64px_minmax(0,1fr)_160px_160px_64px] items-center gap-3 px-3 py-3.5 border-b border-(--kwm-hl) text-left transition-colors",
                "hover:bg-(--kwm-bg-2) cursor-pointer focus:outline-none focus-visible:bg-(--kwm-bg-2)",
                isHighlighted && "bg-(--kwm-bg-2)"
              )}
            >
              <div
                className={cn(
                  "relative inline-flex items-baseline justify-start pl-1",
                  "after:content-[''] after:absolute after:-bottom-1 after:left-1 after:h-px after:w-6",
                  rankAccentClass(rank)
                )}
              >
                <span
                  className={cn(
                    "font-mono tabular-nums text-(--kwm-ink)",
                    rank <= 3 ? "text-base font-semibold" : "text-sm"
                  )}
                >
                  {rankDisplay}
                </span>
              </div>

              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="h-9 w-9 rounded-sm border border-(--kwm-hl) shrink-0">
                  {trader.profileImage && (
                    <AvatarImage
                      src={trader.profileImage}
                      alt={trader.userName || "Trader"}
                      className="rounded-sm"
                    />
                  )}
                  <AvatarFallback className="rounded-sm bg-(--kwm-bg-3) font-mono text-[10px] uppercase tracking-widest text-(--kwm-ink-2)">
                    {getInitials(trader.userName, trader.proxyWallet)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-sm font-medium text-(--kwm-ink)">
                      {displayName(trader)}
                    </span>
                    {trader.verifiedBadge && (
                      <BadgeCheck className="h-3.5 w-3.5 text-(--kwm-accent) shrink-0" />
                    )}
                  </div>
                  {!nameIsAddress(trader) && (
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
                        {formatAddress(trader.proxyWallet)}
                      </span>
                      <CopyButton text={trader.proxyWallet} />
                    </div>
                  )}
                </div>
              </div>

              <div className="text-right font-mono tabular-nums text-sm text-(--kwm-ink)">
                {formatCurrency(trader.vol)}
              </div>

              <div className="text-right">
                <span
                  className={cn(
                    "font-mono tabular-nums text-sm font-semibold whitespace-nowrap",
                    isProfitable ? "text-(--kwm-up)" : "text-(--kwm-down)"
                  )}
                >
                  {formatCurrency(trader.pnl)}
                </span>
              </div>

              <div className="text-right">
                {trader.xUsername ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={`https://x.com/${trader.xUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center justify-center w-7 h-7 text-(--kwm-ink-3) hover:text-(--kwm-ink) transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>@{trader.xUsername}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-(--kwm-ink-3)/60">—</span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Mobile List — same hairline rows, no cards */}
      <div className="md:hidden border-t border-(--kwm-hl)">
        {traders.map((trader, index) => {
          const rank = Number.parseInt(trader.rank, 10);
          const isHighlighted =
            highlightAddress?.toLowerCase() ===
            trader.proxyWallet.toLowerCase();
          const isProfitable = trader.pnl >= 0;
          const rankDisplay = rank < 10 ? `0${rank}` : `${rank}`;

          return (
            <motion.div
              key={trader.proxyWallet}
              role="button"
              tabIndex={0}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.015, 0.3) }}
              onClick={() => handleRowClick(trader.proxyWallet)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleRowClick(trader.proxyWallet);
                }
              }}
              className={cn(
                "leaderboard-row group w-full flex items-start gap-3 px-2 py-3 border-b border-(--kwm-hl) text-left cursor-pointer",
                "active:bg-(--kwm-bg-2) focus:outline-none focus-visible:bg-(--kwm-bg-2)",
                isHighlighted && "bg-(--kwm-bg-2)"
              )}
            >
              <div
                className={cn(
                  "relative shrink-0 w-8 pt-1",
                  "after:content-[''] after:absolute after:bottom-1 after:left-1 after:h-px after:w-6",
                  rankAccentClass(rank)
                )}
              >
                <span
                  className={cn(
                    "font-mono tabular-nums text-(--kwm-ink) block",
                    rank <= 3 ? "text-base font-semibold" : "text-sm"
                  )}
                >
                  {rankDisplay}
                </span>
              </div>

              <Avatar className="h-10 w-10 rounded-sm border border-(--kwm-hl) shrink-0">
                {trader.profileImage && (
                  <AvatarImage
                    src={trader.profileImage}
                    alt={trader.userName || "Trader"}
                    className="rounded-sm"
                  />
                )}
                <AvatarFallback className="rounded-sm bg-(--kwm-bg-3) font-mono text-[11px] uppercase tracking-widest text-(--kwm-ink-2)">
                  {getInitials(trader.userName, trader.proxyWallet)}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-0.5 min-w-0">
                  <span className="truncate text-sm font-medium min-w-0 flex-1">
                    {displayName(trader)}
                  </span>
                  {trader.verifiedBadge && (
                    <BadgeCheck className="h-3.5 w-3.5 text-(--kwm-accent) shrink-0" />
                  )}
                </div>
                {!nameIsAddress(trader) && (
                  <div className="flex items-center gap-1 mb-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
                      {formatAddress(trader.proxyWallet)}
                    </span>
                    <CopyButton text={trader.proxyWallet} />
                  </div>
                )}
                <div className="flex items-center gap-4 font-mono tabular-nums text-xs">
                  <span className="text-(--kwm-ink)">
                    {formatCurrency(trader.vol)}
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      isProfitable ? "text-(--kwm-up)" : "text-(--kwm-down)"
                    )}
                  >
                    {formatCurrency(trader.pnl)}
                  </span>
                </div>
              </div>

              {trader.xUsername && (
                <Link
                  href={`https://x.com/${trader.xUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 inline-flex items-center justify-center w-7 h-7 text-(--kwm-ink-3) hover:text-(--kwm-ink) transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </motion.div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
