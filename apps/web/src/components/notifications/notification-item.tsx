"use client";

import { Ban, CheckCircle2, Clock, Gavel, ShoppingCart, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/formatters";
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
      return formatUnknownNotification(payload);
  }
}

/**
 * Fallback formatter for notification types the CLOB API sends that aren't in
 * our known enum (1/2/4). Rather than a blank "New notification", surface any
 * human-readable text the payload carries so the user sees something useful.
 */
function formatUnknownNotification(payload: Notification["payload"]): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    // Prefer an explicit human-readable string the API may provide.
    for (const key of ["message", "title", "text", "description", "body"]) {
      const value = p[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    // Otherwise surface an outcome (e.g. resolution / redemption events).
    if (typeof p.outcome === "string" && p.outcome.trim()) {
      return `Outcome: ${p.outcome.trim()}`;
    }
  }
  return "New notification";
}

function getNotificationMarketTitle(notification: Notification): string | null {
  const { payload } = notification;
  if (!payload || typeof payload !== "object") return null;

  const p = payload as Record<string, unknown>;
  for (const key of ["question", "name", "market", "title"]) {
    const value = p[key];
    if (typeof value !== "string") continue;

    const title = value.trim();
    if (!title || /^0x[a-fA-F0-9]{32,}$/.test(title)) continue;
    return title;
  }

  return null;
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
  const marketTitle = useMemo(
    () => getNotificationMarketTitle(notification),
    [notification]
  );
  // Notification timestamps arrive as unix seconds; `relativeTime` expects
  // ms. Missing timestamps stay "" so the time element doesn't render.
  const timeAgo = useMemo(
    () =>
      notification.timestamp
        ? relativeTime(notification.timestamp * 1000, "verbose")
        : "",
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
        {marketTitle && (
          <p
            className={cn(
              "font-medium leading-snug text-foreground",
              compact ? "text-xs" : "text-sm",
              "line-clamp-2"
            )}
          >
            {marketTitle}
          </p>
        )}
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
