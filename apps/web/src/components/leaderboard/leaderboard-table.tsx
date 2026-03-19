"use client";

import { motion } from "framer-motion";
import {
  BadgeCheck,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Medal,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

function getRankIcon(rank: number) {
  switch (rank) {
    case 1:
      return <Crown className="h-4 w-4 text-yellow-500" />;
    case 2:
      return <Medal className="h-4 w-4 text-gray-400" />;
    case 3:
      return <Medal className="h-4 w-4 text-amber-600" />;
    default:
      return null;
  }
}

function getRankBadgeClass(rank: number) {
  switch (rank) {
    case 1:
      return "bg-gradient-to-r from-yellow-500 to-amber-500 text-white shadow-lg shadow-yellow-500/30";
    case 2:
      return "bg-gradient-to-r from-gray-400 to-gray-500 text-white shadow-lg shadow-gray-400/30";
    case 3:
      return "bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg shadow-amber-600/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getInitials(name: string | null, _address: string) {
  if (name && name.length > 0) {
    const parts = name.split(/[\s-]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return "0x";
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
          className="p-1 rounded hover:bg-muted/60 transition-colors"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
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
      <div className="space-y-3">
        {[...Array(10)].map((_, i) => (
          <div
            key={`skeleton-${i}`}
            className="flex items-center gap-4 p-4 rounded-xl bg-card/50 border border-border/30"
          >
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (traders.length === 0) {
    return (
      <div className="text-center py-12">
        <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">No traders found</h3>
        <p className="text-muted-foreground">
          Try adjusting your filters to see more results.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      {/* Desktop Table */}
      <div className="hidden md:block rounded-xl border border-border/50 overflow-hidden bg-card/30 backdrop-blur-sm">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border/50">
              <TableHead className="w-[80px] text-center">Rank</TableHead>
              <TableHead className="w-[40%]">Trader</TableHead>
              <TableHead className="w-[20%] text-right">
                <span
                  className={orderBy === "VOL" ? "text-primary font-bold" : ""}
                >
                  Volume
                </span>
              </TableHead>
              <TableHead className="w-[20%] text-right">
                <span
                  className={orderBy === "PNL" ? "text-primary font-bold" : ""}
                >
                  P&L
                </span>
              </TableHead>
              <TableHead className="w-[80px] text-center">Social</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {traders.map((trader, index) => {
              const rank = Number.parseInt(trader.rank, 10);
              const isHighlighted =
                highlightAddress?.toLowerCase() ===
                trader.proxyWallet.toLowerCase();
              const isProfitable = trader.pnl >= 0;

              return (
                <motion.tr
                  key={trader.proxyWallet}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  onClick={() => handleRowClick(trader.proxyWallet)}
                  className={cn(
                    "group hover:bg-muted/50 transition-colors border-border/30 cursor-pointer",
                    isHighlighted && "bg-primary/5 hover:bg-primary/10"
                  )}
                >
                  <TableCell className="text-center">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 flex justify-center shrink-0">
                        {getRankIcon(rank)}
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold",
                          getRankBadgeClass(rank)
                        )}
                      >
                        {rank}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-9 w-9 border-2 border-border/50 shrink-0">
                        {trader.profileImage && (
                          <AvatarImage
                            src={trader.profileImage}
                            alt={trader.userName || "Trader"}
                          />
                        )}
                        <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-500 text-white text-xs font-bold">
                          {getInitials(trader.userName, trader.proxyWallet)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="font-semibold truncate text-sm">
                            {trader.userName ||
                              formatAddress(trader.proxyWallet)}
                          </span>
                          {trader.verifiedBadge && (
                            <BadgeCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground font-mono">
                            {formatAddress(trader.proxyWallet)}
                          </span>
                          <CopyButton text={trader.proxyWallet} />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-medium text-sm">
                      {formatCurrency(trader.vol)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right pr-4">
                    <div className="inline-flex items-center gap-1 justify-end">
                      {isProfitable ? (
                        <TrendingUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      )}
                      <span
                        className={cn(
                          "font-bold text-sm whitespace-nowrap",
                          isProfitable ? "text-emerald-500" : "text-red-500"
                        )}
                      >
                        {isProfitable ? "+" : ""}
                        {formatCurrency(trader.pnl)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {trader.xUsername ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            href={`https://x.com/${trader.xUsername}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent>@{trader.xUsername}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </motion.tr>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {traders.map((trader, index) => {
          const rank = Number.parseInt(trader.rank, 10);
          const isHighlighted =
            highlightAddress?.toLowerCase() ===
            trader.proxyWallet.toLowerCase();
          const isProfitable = trader.pnl >= 0;

          return (
            <motion.div
              key={trader.proxyWallet}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              onClick={() => handleRowClick(trader.proxyWallet)}
              className={cn(
                "p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm cursor-pointer active:scale-[0.98] transition-all",
                isHighlighted && "border-primary/50 bg-primary/5"
              )}
            >
              <div className="flex items-start gap-3">
                {/* Rank Badge */}
                <div className="flex items-center gap-1 shrink-0">
                  <div className="w-5 flex justify-center shrink-0">
                    {getRankIcon(rank)}
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold",
                      getRankBadgeClass(rank)
                    )}
                  >
                    {rank}
                  </span>
                </div>

                {/* Avatar */}
                <Avatar className="h-10 w-10 border-2 border-border/50 shrink-0">
                  {trader.profileImage && (
                    <AvatarImage
                      src={trader.profileImage}
                      alt={trader.userName || "Trader"}
                    />
                  )}
                  <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-500 text-white font-bold text-sm">
                    {getInitials(trader.userName, trader.proxyWallet)}
                  </AvatarFallback>
                </Avatar>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="font-semibold truncate text-sm">
                      {trader.userName || formatAddress(trader.proxyWallet)}
                    </span>
                    {trader.verifiedBadge && (
                      <BadgeCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-xs text-muted-foreground font-mono">
                      {formatAddress(trader.proxyWallet)}
                    </span>
                    <CopyButton text={trader.proxyWallet} />
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground text-xs">
                        Vol:
                      </span>
                      <span className="font-medium text-xs">
                        {formatCurrency(trader.vol)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground text-xs">
                        P&L:
                      </span>
                      <span
                        className={cn(
                          "font-bold text-xs flex items-center gap-0.5",
                          isProfitable ? "text-emerald-500" : "text-red-500"
                        )}
                      >
                        {isProfitable ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {isProfitable ? "+" : ""}
                        {formatCurrency(trader.pnl)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Social Link */}
                {trader.xUsername && (
                  <Link
                    href={`https://x.com/${trader.xUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                  >
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <ExternalLink className="h-3 w-3" />@
                      {trader.xUsername.length > 8
                        ? `${trader.xUsername.slice(0, 8)}...`
                        : trader.xUsername}
                    </Badge>
                  </Link>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
