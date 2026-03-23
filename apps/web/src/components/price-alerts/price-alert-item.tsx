"use client";

import { AlertTriangle, Fish, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AlertType, PriceAlert } from "@/hooks/use-price-alerts";
import { cn } from "@/lib/utils";

interface PriceAlertItemProps {
  alert: PriceAlert;
  onSeen: () => void;
}

const alertIcons: Record<AlertType, React.ReactNode> = {
  DIP: <TrendingDown className="w-5 h-5" />,
  SPIKE: <TrendingUp className="w-5 h-5" />,
  WHALE_ENTRY: <Fish className="w-5 h-5" />,
  WHALE_EXIT: <Fish className="w-5 h-5" />,
  ARB_OPPORTUNITY: <span className="text-base">💰</span>,
  SPREAD_WARNING: <AlertTriangle className="w-5 h-5" />,
};

const alertStyles: Record<
  AlertType,
  { bg: string; iconBg: string; iconColor: string; badge: string }
> = {
  DIP: {
    bg: "hover:bg-red-500/5",
    iconBg: "bg-red-500/10",
    iconColor: "text-red-500",
    badge: "bg-red-500/10 text-red-500",
  },
  SPIKE: {
    bg: "hover:bg-emerald-500/5",
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-500",
  },
  WHALE_ENTRY: {
    bg: "hover:bg-blue-500/5",
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-500",
    badge: "bg-blue-500/10 text-blue-500",
  },
  WHALE_EXIT: {
    bg: "hover:bg-orange-500/5",
    iconBg: "bg-orange-500/10",
    iconColor: "text-orange-500",
    badge: "bg-orange-500/10 text-orange-500",
  },
  ARB_OPPORTUNITY: {
    bg: "hover:bg-yellow-500/5",
    iconBg: "bg-yellow-500/10",
    iconColor: "text-yellow-500",
    badge: "bg-yellow-500/10 text-yellow-500",
  },
  SPREAD_WARNING: {
    bg: "hover:bg-amber-500/5",
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-500",
    badge: "bg-amber-500/10 text-amber-500",
  },
};

const alertLabels: Record<AlertType, string> = {
  DIP: "Price Dip",
  SPIKE: "Price Spike",
  WHALE_ENTRY: "Whale Entry",
  WHALE_EXIT: "Whale Exit",
  ARB_OPPORTUNITY: "Arb Opportunity",
  SPREAD_WARNING: "Spread Warning",
};

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  // Handle edge case where timestamp is in the future
  if (seconds < 0) return "Just now";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatAssetId(assetId: string): string {
  // If it looks like a hex string (starts with 0x or is very long), truncate it nicely
  if (assetId.startsWith("0x") || assetId.length > 20) {
    return `${assetId.slice(0, 6)}...${assetId.slice(-4)}`;
  }
  return assetId;
}

function getDisplayTitle(alert: PriceAlert): string {
  const { marketTitle, assetId } = alert;

  // If marketTitle is empty or looks like a raw asset ID, format it nicely
  if (
    !marketTitle ||
    marketTitle.startsWith("Asset ") ||
    marketTitle.startsWith("0x")
  ) {
    return `Token ${formatAssetId(assetId)}`;
  }

  return marketTitle;
}

export function PriceAlertItem({ alert, onSeen }: PriceAlertItemProps) {
  // Use ref to store the latest onSeen callback without causing effect re-runs
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;

  // Mark as seen after 2 seconds of being visible
  useEffect(() => {
    if (!alert.seen) {
      const timer = setTimeout(() => onSeenRef.current(), 2000);
      return () => clearTimeout(timer);
    }
  }, [alert.seen]);

  const magnitudePercent = (alert.magnitude * 100).toFixed(1);
  const styles = alertStyles[alert.type];
  const displayTitle = getDisplayTitle(alert);

  return (
    <div
      className={cn(
        "px-3 py-2.5 transition-colors cursor-pointer",
        styles.bg,
        !alert.seen && "bg-muted/30"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
            styles.iconBg,
            styles.iconColor
          )}
        >
          {alertIcons[alert.type]}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded",
                styles.badge
              )}
            >
              {alertLabels[alert.type]}
            </span>
            <div className="flex items-center gap-1.5">
              {!alert.seen && (
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              )}
              <span className="text-[10px] text-muted-foreground">
                {formatTimeAgo(alert.timestamp)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-1.5">
            <p className="text-sm font-medium truncate max-w-[140px]">
              {displayTitle}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Only show arrow/magnitude for price-related alerts (DIP/SPIKE) */}
              {(alert.type === "DIP" || alert.type === "SPIKE") && (
                <span
                  className={cn(
                    "text-sm font-bold",
                    alert.type === "DIP" ? "text-red-500" : "text-emerald-500"
                  )}
                >
                  {alert.type === "DIP" ? "↓" : "↑"}
                  {magnitudePercent}%
                </span>
              )}
              {/* Show contextual info for non-price alerts */}
              {alert.type === "WHALE_ENTRY" && alert.metadata?.tradeSize && (
                <span className="text-sm font-bold text-blue-500">
                  +${alert.metadata.tradeSize.toLocaleString()}
                </span>
              )}
              {alert.type === "WHALE_EXIT" && alert.metadata?.tradeSize && (
                <span className="text-sm font-bold text-orange-500">
                  -${alert.metadata.tradeSize.toLocaleString()}
                </span>
              )}
              {alert.type === "ARB_OPPORTUNITY" && (
                <span className="text-sm font-bold text-yellow-500">
                  {(alert.magnitude * 100).toFixed(0)}¢ gap
                </span>
              )}
              {alert.type === "SPREAD_WARNING" && (
                <span className="text-sm font-bold text-amber-500">
                  {magnitudePercent}% spread
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                ${alert.currentPrice.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
