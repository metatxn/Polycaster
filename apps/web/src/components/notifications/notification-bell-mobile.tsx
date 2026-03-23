"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import { useConnection } from "wagmi";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import { NotificationPopover } from "./notification-popover";

/**
 * Mobile notification bell component for the navbar
 * Compact design optimized for smaller screens
 *
 * Indicators:
 * - Red dot: Credentials missing (needs trading setup)
 * - Green badge with count: New notifications available
 */
export function NotificationBellMobile() {
  const [isOpen, setIsOpen] = useState(false);
  const { isConnected } = useConnection();

  const {
    notifications,
    unreadCount,
    isLoading,
    canViewNotifications,
    dismissNotification,
    dismissAll,
    fetchNotifications,
  } = useNotifications();

  // Don't render if wallet is not connected
  if (!isConnected) {
    return null;
  }

  // Determine indicator state
  const needsSetup = !canViewNotifications;
  const hasNotifications = unreadCount > 0;

  return (
    <NotificationPopover
      notifications={notifications}
      isLoading={isLoading}
      onDismiss={dismissNotification}
      onDismissAll={dismissAll}
      onRefresh={fetchNotifications}
      open={isOpen}
      onOpenChange={setIsOpen}
      side="bottom"
      align="end"
      needsSetup={needsSetup}
    >
      <Button variant="ghost" size="icon" className="relative h-9 w-9">
        <Bell className="h-4 w-4" />
        {/* Red dot indicator - needs setup */}
        {needsSetup && (
          <span
            className={cn(
              "absolute top-1 right-1 flex items-center justify-center w-2.5 h-2.5 rounded-full",
              "bg-red-500 border-2 border-background",
              "animate-pulse"
            )}
          />
        )}
        {/* Green badge with count - has notifications */}
        {!needsSetup && hasNotifications && (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[9px] font-bold rounded-full",
              "bg-emerald-500 text-white"
            )}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
        <span className="sr-only">Notifications</span>
      </Button>
    </NotificationPopover>
  );
}
