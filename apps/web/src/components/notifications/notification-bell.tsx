"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import { useConnection } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import { NotificationPopover } from "./notification-popover";

interface NotificationBellProps {
  /** Whether the sidebar is collapsed */
  isCollapsed?: boolean;
  /** Custom class name */
  className?: string;
}

/**
 * Notification bell component with status indicators:
 * - Red dot: Credentials missing (needs trading setup)
 * - Green badge with count: New notifications available
 */
export function NotificationBell({
  isCollapsed = false,
  className,
}: NotificationBellProps) {
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

  const bellButton = (
    <Button
      variant="ghost"
      className={cn(
        "relative group w-full flex items-center gap-3 py-2.5 text-sm font-bold rounded-xl transition-all duration-300",
        isCollapsed ? "justify-center px-2" : "px-3",
        isOpen
          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60 dark:hover:bg-muted/40",
        className
      )}
    >
      <div className="relative">
        <Bell
          className={cn(
            "transition-transform duration-200 shrink-0",
            isCollapsed
              ? "h-5 w-5 group-hover:scale-110"
              : "h-4 w-4 group-hover:scale-110",
            isOpen ? "text-primary-foreground" : ""
          )}
        />
        {/* Red dot indicator - needs setup */}
        {needsSetup && (
          <span
            className={cn(
              "absolute -top-1 -right-1 flex items-center justify-center w-3 h-3 rounded-full",
              "bg-red-500 border-2 border-background",
              "animate-pulse"
            )}
            title="Setup required"
          />
        )}
        {/* Green badge with count - has notifications */}
        {!needsSetup && hasNotifications && (
          <span
            className={cn(
              "absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full",
              isOpen
                ? "bg-primary-foreground text-primary"
                : "bg-emerald-500 text-white"
            )}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>
      {!isCollapsed && (
        <>
          <span className="flex-1 text-left">Notifications</span>
          {needsSetup && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-medium">
              Setup
            </span>
          )}
          {!needsSetup && isOpen && (
            <span className="w-2 h-2 rounded-full bg-primary-foreground animate-pulse" />
          )}
        </>
      )}
    </Button>
  );

  // Wrap in tooltip when collapsed
  if (isCollapsed) {
    return (
      <NotificationPopover
        notifications={notifications}
        isLoading={isLoading}
        onDismiss={dismissNotification}
        onDismissAll={dismissAll}
        onRefresh={fetchNotifications}
        open={isOpen}
        onOpenChange={setIsOpen}
        needsSetup={needsSetup}
      >
        <Tooltip>
          <TooltipTrigger asChild>{bellButton}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            <div className="flex items-center gap-2">
              <span>Notifications</span>
              {needsSetup ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
                  Setup required
                </span>
              ) : (
                hasNotifications && (
                  <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-emerald-500 text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </NotificationPopover>
    );
  }

  return (
    <NotificationPopover
      notifications={notifications}
      isLoading={isLoading}
      onDismiss={dismissNotification}
      onDismissAll={dismissAll}
      onRefresh={fetchNotifications}
      open={isOpen}
      onOpenChange={setIsOpen}
      needsSetup={needsSetup}
    >
      {bellButton}
    </NotificationPopover>
  );
}
