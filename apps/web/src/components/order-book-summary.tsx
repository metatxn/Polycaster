"use client";

import { motion } from "framer-motion";
import {
  Activity,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useMemo } from "react";
import { useLastTrade, useOrderBook } from "@/hooks/use-orderbook-store";
import type { ConnectionState } from "@/hooks/use-shared-websocket";
import { cn } from "@/lib/utils";

/**
 * Props for the OrderBookSummary component
 */
export interface OrderBookSummaryProps {
  /** Token ID (asset_id) for the order book */
  tokenId: string;
  /** WebSocket connection state */
  connectionState?: ConnectionState;
  /** Whether to show the connection indicator */
  showConnectionIndicator?: boolean;
  /** Callback when clicked */
  onClick?: () => void;
  /** Additional class names */
  className?: string;
  /** Compact mode for smaller displays */
  compact?: boolean;
}

/**
 * Format price as cents (e.g., 0.725 -> "72.5¢")
 */
function formatCents(price: number | null): string {
  if (price === null) return "—";
  return `${(price * 100).toFixed(1)}¢`;
}

/**
 * Format spread as cents with color indication
 */
function formatSpread(spread: number | null): string {
  if (spread === null) return "—";
  return `${(spread * 100).toFixed(2)}¢`;
}

/**
 * Format size with K/M suffixes
 */
function formatSize(size: number): string {
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1)}M`;
  if (size >= 1_000) return `${(size / 1_000).toFixed(1)}K`;
  return size.toFixed(0);
}

/**
 * Connection status indicator component
 */
function ConnectionIndicator({
  state,
  className,
}: {
  state: ConnectionState;
  className?: string;
}) {
  const statusConfig = {
    connected: {
      icon: Wifi,
      color: "text-emerald-500",
      pulse: false,
      label: "Live",
    },
    connecting: {
      icon: Wifi,
      color: "text-amber-500",
      pulse: true,
      label: "Connecting",
    },
    reconnecting: {
      icon: Wifi,
      color: "text-amber-500",
      pulse: true,
      label: "Reconnecting",
    },
    disconnected: {
      icon: WifiOff,
      color: "text-muted-foreground",
      pulse: false,
      label: "Offline",
    },
    error: {
      icon: WifiOff,
      color: "text-red-500",
      pulse: false,
      label: "Error",
    },
  };

  const config = statusConfig[state];
  const Icon = config.icon;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Icon
        className={cn("h-3 w-3", config.color, config.pulse && "animate-pulse")}
      />
      <span className={cn("text-[10px]", config.color)}>{config.label}</span>
    </div>
  );
}

/**
 * OrderBookSummary Component
 *
 * A compact display of order book data for use in market tables.
 * Shows best bid, best ask, spread, and optionally the last trade.
 *
 * Features:
 * - Real-time updates from WebSocket
 * - Connection status indicator
 * - Last trade price with direction
 * - Click to expand full order book
 */
export function OrderBookSummary({
  tokenId,
  connectionState = "disconnected",
  showConnectionIndicator = true,
  onClick,
  className,
  compact = false,
}: OrderBookSummaryProps) {
  const orderBook = useOrderBook(tokenId);
  const lastTrade = useLastTrade(tokenId);

  // Check if we have valid data
  const hasData =
    orderBook && (orderBook.bids.length > 0 || orderBook.asks.length > 0);

  // Memoize formatted values
  const formattedData = useMemo(() => {
    if (!orderBook) {
      return {
        bestBid: "—",
        bestAsk: "—",
        spread: "—",
        totalBidSize: "0",
        totalAskSize: "0",
      };
    }

    return {
      bestBid: formatCents(orderBook.bestBid),
      bestAsk: formatCents(orderBook.bestAsk),
      spread: formatSpread(orderBook.spread),
      totalBidSize: formatSize(orderBook.totalBidSize),
      totalAskSize: formatSize(orderBook.totalAskSize),
    };
  }, [orderBook]);

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex items-center gap-2 px-2 py-1 rounded-md transition-colors",
          "hover:bg-muted/50",
          onClick && "cursor-pointer",
          className
        )}
      >
        {/* Best Bid */}
        <span className="text-xs font-mono text-emerald-500">
          {formattedData.bestBid}
        </span>
        <span className="text-[10px] text-muted-foreground">/</span>
        {/* Best Ask */}
        <span className="text-xs font-mono text-red-500">
          {formattedData.bestAsk}
        </span>
        {/* Connection indicator */}
        {showConnectionIndicator && (
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connectionState === "connected" && "bg-emerald-500",
              connectionState === "connecting" && "bg-amber-500 animate-pulse",
              connectionState === "reconnecting" &&
                "bg-amber-500 animate-pulse",
              connectionState === "disconnected" && "bg-muted-foreground",
              connectionState === "error" && "bg-red-500"
            )}
          />
        )}
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        "rounded-lg border border-border bg-card/50 p-3 space-y-2",
        onClick && "cursor-pointer hover:bg-muted/30 transition-colors",
        className
      )}
      onClick={onClick}
    >
      {/* Header with connection status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            Order Book
          </span>
        </div>
        {showConnectionIndicator && (
          <ConnectionIndicator state={connectionState} />
        )}
      </div>

      {/* Bid/Ask Display */}
      <div className="grid grid-cols-2 gap-3">
        {/* Bids (Buy orders) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Best Bid</span>
            <span className="text-[10px] text-muted-foreground">
              {formattedData.totalBidSize}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-emerald-500" />
            <span className="text-sm font-mono font-medium text-emerald-500">
              {formattedData.bestBid}
            </span>
          </div>
        </div>

        {/* Asks (Sell orders) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Best Ask</span>
            <span className="text-[10px] text-muted-foreground">
              {formattedData.totalAskSize}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-red-500" />
            <span className="text-sm font-mono font-medium text-red-500">
              {formattedData.bestAsk}
            </span>
          </div>
        </div>
      </div>

      {/* Spread */}
      <div className="flex items-center justify-between pt-1 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground">Spread</span>
        <span className="text-xs font-mono text-muted-foreground">
          {formattedData.spread}
        </span>
      </div>

      {/* Last Trade (if available) */}
      {lastTrade && (
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <span className="text-[10px] text-muted-foreground">Last Trade</span>
          <div className="flex items-center gap-1">
            <span
              className={cn(
                "text-xs font-mono",
                lastTrade.side === "BUY" ? "text-emerald-500" : "text-red-500"
              )}
            >
              {formatCents(lastTrade.price)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              ({formatSize(lastTrade.size)})
            </span>
          </div>
        </div>
      )}

      {/* No data state */}
      {!hasData && connectionState === "connected" && (
        <div className="text-center py-2 text-[10px] text-muted-foreground">
          No orders in book
        </div>
      )}
    </motion.div>
  );
}

/**
 * Inline order book summary for table cells
 */
export function OrderBookInline({
  tokenId,
  connectionState = "disconnected",
  className,
}: {
  tokenId: string;
  connectionState?: ConnectionState;
  className?: string;
}) {
  const orderBook = useOrderBook(tokenId);

  const bestBid = orderBook?.bestBid;
  const bestAsk = orderBook?.bestAsk;

  return (
    <div className={cn("flex items-center gap-2 font-mono text-xs", className)}>
      <span className="text-emerald-500">{formatCents(bestBid ?? null)}</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-red-500">{formatCents(bestAsk ?? null)}</span>
      {connectionState === "connected" && (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      )}
    </div>
  );
}

/**
 * Order book depth bar for visualization
 */
export function OrderBookDepthBar({
  bidPercent,
  askPercent,
  className,
}: {
  bidPercent: number;
  askPercent: number;
  className?: string;
}) {
  const total = bidPercent + askPercent;
  const bidWidth = total > 0 ? (bidPercent / total) * 100 : 50;

  return (
    <div className={cn("h-1.5 rounded-full overflow-hidden flex", className)}>
      <div
        className="bg-emerald-500/30 transition-all duration-300"
        style={{ width: `${bidWidth}%` }}
      />
      <div
        className="bg-red-500/30 transition-all duration-300"
        style={{ width: `${100 - bidWidth}%` }}
      />
    </div>
  );
}
