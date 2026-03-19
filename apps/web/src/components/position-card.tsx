"use client";

import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Position } from "@/hooks/use-user-positions";

/**
 * Props for the PositionCard component
 */
export interface PositionCardProps {
  /** Position data */
  position: Position;
  /** Callback when sell button is clicked */
  onSell?: (position: Position) => void;
  /** Animation delay for staggered entrance */
  delay?: number;
}

/**
 * Format currency value
 */
function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

/**
 * Format percentage
 */
function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * PositionCard Component
 *
 * Displays a single position with market info, current value, and P&L.
 * Includes quick actions for selling and viewing the market.
 */
export function PositionCard({
  position,
  onSell,
  delay = 0,
}: PositionCardProps) {
  const isProfitable = position.unrealizedPnl >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      <Card className="overflow-hidden hover:shadow-lg transition-shadow">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            {/* Market Icon */}
            <div className="relative w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-lg overflow-hidden bg-muted">
              {position.market.icon ? (
                <Image
                  src={position.market.icon}
                  alt={position.market.title}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl sm:text-2xl">
                  📊
                </div>
              )}
            </div>

            {/* Position Info */}
            <div className="flex-1 min-w-0">
              {/* Market Title */}
              <Link
                href={`/markets/${position.market.slug}`}
                className="font-medium text-xs sm:text-sm hover:text-primary transition-colors line-clamp-2 sm:line-clamp-1"
              >
                {position.market.title}
              </Link>

              {/* Outcome */}
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-1">
                <span
                  className={`px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full ${
                    position.outcome.toLowerCase().includes("yes")
                      ? "bg-green-500/20 text-green-600 dark:text-green-400"
                      : "bg-red-500/20 text-red-600 dark:text-red-400"
                  }`}
                >
                  {position.outcome}
                </span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">
                  {position.size.toFixed(2)} shares @{" "}
                  {(position.avgPrice * 100).toFixed(1)}¢
                </span>
              </div>

              {/* Value and P&L */}
              <div className="flex items-center justify-between mt-2 sm:mt-3">
                <div>
                  <div className="text-base sm:text-lg font-bold">
                    {formatCurrency(position.currentValue)}
                  </div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground">
                    Current Value
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`flex items-center gap-0.5 sm:gap-1 text-base sm:text-lg font-bold ${
                      isProfitable ? "text-green-500" : "text-red-500"
                    }`}
                  >
                    {isProfitable ? (
                      <ArrowUpRight className="h-3 w-3 sm:h-4 sm:w-4" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3 sm:h-4 sm:w-4" />
                    )}
                    {formatCurrency(Math.abs(position.unrealizedPnl))}
                  </div>
                  <div
                    className={`text-[10px] sm:text-xs ${
                      isProfitable ? "text-green-500" : "text-red-500"
                    }`}
                  >
                    {formatPercent(position.unrealizedPnlPercent)}
                  </div>
                </div>
              </div>

              {/* Price Info */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-2 sm:mt-3 text-[10px] sm:text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span>Entry:</span>
                  <span className="font-medium text-foreground">
                    {(position.avgPrice * 100).toFixed(1)}¢
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span>Current:</span>
                  <span className="font-medium text-foreground">
                    {(position.currentPrice * 100).toFixed(1)}¢
                  </span>
                </div>
                {position.currentPrice !== position.avgPrice && (
                  <div className="flex items-center gap-0.5">
                    {position.currentPrice > position.avgPrice ? (
                      <TrendingUp className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-green-500" />
                    ) : (
                      <TrendingDown className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-red-500" />
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 mt-3 sm:mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs sm:text-sm h-8 sm:h-9"
                  onClick={() => onSell?.(position)}
                >
                  Sell Position
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-8 w-8 sm:h-9 sm:w-9"
                  asChild
                >
                  <Link href={`/markets/${position.market.slug}`}>
                    <ExternalLink className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/**
 * Compact position card for sidebar or summary views
 */
export function PositionCardCompact({ position }: { position: Position }) {
  const isProfitable = position.unrealizedPnl >= 0;

  return (
    <Link
      href={`/markets/${position.market.slug}`}
      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
    >
      <div className="relative w-8 h-8 shrink-0 rounded overflow-hidden bg-muted">
        {position.market.icon ? (
          <Image
            src={position.market.icon}
            alt={position.market.title}
            fill
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm">
            📊
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{position.outcome}</div>
        <div className="text-xs text-muted-foreground truncate">
          {position.market.title}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium">
          {formatCurrency(position.currentValue)}
        </div>
        <div
          className={`text-xs ${
            isProfitable ? "text-green-500" : "text-red-500"
          }`}
        >
          {formatPercent(position.unrealizedPnlPercent)}
        </div>
      </div>
    </Link>
  );
}
