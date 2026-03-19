"use client";

import { Ban, CheckCircle2, Clock, Gavel, ShoppingCart, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type MarketResolvedPayload,
  type Notification,
  NotificationType,
  type OrderCancellationPayload,
  type OrderFillPayload,
} from "@/types/notifications";

interface NotificationItemProps {
  notification: Notification;
  onDismiss?: (id: number) => void;
  showDismiss?: boolean;
  compact?: boolean;
}

/**
 * Get icon and color for notification type
 */
function getNotificationStyle(type: NotificationType) {
  switch (type) {
    case NotificationType.ORDER_FILL:
      return {
        icon: ShoppingCart,
        bgColor: "bg-emerald-500/10",
        iconColor: "text-emerald-500",
        label: "Order Filled",
      };
    case NotificationType.ORDER_CANCELLATION:
      return {
        icon: Ban,
        bgColor: "bg-amber-500/10",
        iconColor: "text-amber-500",
        label: "Order Canceled",
      };
    case NotificationType.MARKET_RESOLVED:
      return {
        icon: Gavel,
        bgColor: "bg-blue-500/10",
        iconColor: "text-blue-500",
        label: "Market Resolved",
      };
    default:
      return {
        icon: CheckCircle2,
        bgColor: "bg-muted",
        iconColor: "text-muted-foreground",
        label: "Notification",
      };
  }
}

/**
 * Format notification message based on type and payload
 */
function formatNotificationMessage(notification: Notification): string {
  const { type, payload } = notification;

  switch (type) {
    case NotificationType.ORDER_FILL: {
      const p = payload as OrderFillPayload;
      const side = p.side === "BUY" ? "bought" : "sold";
      // trader_side may not always be present in API response
      const role = p.trader_side
        ? p.trader_side === "MAKER"
          ? "(maker)"
          : "(taker)"
        : "";
      // Use matched_size (actual API field) with fallback to size for compatibility
      const size = p.matched_size ?? p.size ?? "0";
      // Include outcome (Yes/No) in the message
      const outcome = p.outcome ? ` ${p.outcome}` : "";
      // Ensure consistent price formatting (e.g., $0.50 not $0.5)
      // Price is a string from API, parse and format to 2 decimal places
      const priceNum = Number.parseFloat(p.price);
      const formattedPrice = Number.isNaN(priceNum)
        ? p.price
        : priceNum.toFixed(2);
      return `You ${side} ${size}${outcome} shares at $${formattedPrice}${role ? ` ${role}` : ""}`;
    }
    case NotificationType.ORDER_CANCELLATION: {
      const p = payload as OrderCancellationPayload;
      const reason = p.reason ? `: ${p.reason}` : "";
      return `Order was canceled${reason}`;
    }
    case NotificationType.MARKET_RESOLVED: {
      const p = payload as MarketResolvedPayload;
      const outcome = p.winning_outcome || p.outcome || "Unknown";
      return `Market resolved: ${outcome}`;
    }
    default:
      return "New notification";
  }
}

/**
 * Format relative time (e.g., "2 min ago", "1 hour ago")
 */
function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return "";

  const now = Date.now();
  const diff = now - timestamp * 1000; // Convert seconds to milliseconds

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

/**
 * Individual notification item component
 */
export function NotificationItem({
  notification,
  onDismiss,
  showDismiss = true,
  compact = false,
}: NotificationItemProps) {
  const style = useMemo(
    () => getNotificationStyle(notification.type),
    [notification.type]
  );
  const message = useMemo(
    () => formatNotificationMessage(notification),
    [notification]
  );
  const timeAgo = useMemo(
    () => formatRelativeTime(notification.timestamp),
    [notification.timestamp]
  );

  const Icon = style.icon;

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-xl transition-colors",
        compact ? "p-2" : "p-3",
        "hover:bg-muted/50"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg",
          compact ? "h-8 w-8" : "h-10 w-10",
          style.bgColor
        )}
      >
        <Icon className={cn("h-4 w-4", style.iconColor)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-semibold",
              compact ? "text-xs" : "text-sm",
              style.iconColor
            )}
          >
            {style.label}
          </span>
          {timeAgo && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {timeAgo}
            </span>
          )}
        </div>
        <p
          className={cn(
            "text-muted-foreground leading-snug",
            compact ? "text-xs" : "text-sm",
            "line-clamp-2"
          )}
        >
          {message}
        </p>
      </div>

      {/* Dismiss button */}
      {showDismiss && onDismiss && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
            compact ? "h-6 w-6" : "h-8 w-8"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
        >
          <X className={cn(compact ? "h-3 w-3" : "h-4 w-4")} />
          <span className="sr-only">Dismiss</span>
        </Button>
      )}
    </div>
  );
}
