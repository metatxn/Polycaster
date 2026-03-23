"use client";

import { Bell, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types/notifications";
import { NotificationItem } from "./notification-item";

interface NotificationListProps {
  notifications: Notification[];
  isLoading?: boolean;
  onDismiss?: (id: number) => void;
  showDismiss?: boolean;
  compact?: boolean;
  emptyMessage?: string;
  maxItems?: number;
  className?: string;
}

/**
 * Reusable notification list component
 * Used in both the popover and the dedicated page
 */
export function NotificationList({
  notifications,
  isLoading = false,
  onDismiss,
  showDismiss = true,
  compact = false,
  emptyMessage = "No notifications",
  maxItems,
  className,
}: NotificationListProps) {
  // Apply max items limit if specified
  const displayedNotifications = maxItems
    ? notifications.slice(0, maxItems)
    : notifications;

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-8 text-muted-foreground",
          className
        )}
      >
        <Loader2 className="h-6 w-6 animate-spin mb-2" />
        <p className="text-sm">Loading notifications...</p>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-8 text-muted-foreground",
          className
        )}
      >
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-muted mb-3">
          <Bell className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">{emptyMessage}</p>
        <p className="text-xs mt-1">
          You&apos;ll see order fills, cancellations, and market resolutions
          here
        </p>
      </div>
    );
  }

  return (
    <div className={cn("divide-y divide-border/50", className)}>
      {displayedNotifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onDismiss={onDismiss}
          showDismiss={showDismiss}
          compact={compact}
        />
      ))}
    </div>
  );
}
