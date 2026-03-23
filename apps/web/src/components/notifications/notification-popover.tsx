"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCheck,
  RefreshCw,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useOnboarding } from "@/context/onboarding-context";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types/notifications";
import { NotificationList } from "./notification-list";

interface NotificationPopoverProps {
  notifications: Notification[];
  isLoading?: boolean;
  onDismiss?: (id: number) => void;
  onDismissAll?: () => void;
  onRefresh?: () => void;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Popover side - defaults to "right" for sidebar, use "bottom" for navbar */
  side?: "top" | "right" | "bottom" | "left";
  /** Popover alignment - defaults to "start" */
  align?: "start" | "center" | "end";
  /** Whether the user needs to setup trading credentials */
  needsSetup?: boolean;
}

/** Maximum notifications to show in popover */
const MAX_POPOVER_ITEMS = 5;

/**
 * Notification popover component
 * Shows recent notifications with a "Show More" link to the full page
 * Shows setup prompt if credentials are missing
 */
export function NotificationPopover({
  notifications,
  isLoading = false,
  onDismiss,
  onDismissAll,
  onRefresh,
  children,
  open,
  onOpenChange,
  side = "right",
  align = "start",
  needsSetup = false,
}: NotificationPopoverProps) {
  const { setShowOnboarding } = useOnboarding();
  const hasMore = notifications.length > MAX_POPOVER_ITEMS;
  const hasNotifications = notifications.length > 0;

  const handleSetupClick = () => {
    // Close the popover first
    onOpenChange?.(false);
    // Then open the onboarding modal
    setShowOnboarding(true);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={12}
        collisionPadding={16}
        className="w-80 max-w-[calc(100vw-2rem)] p-0 rounded-xl shadow-xl border-border/50"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <h3 className="font-semibold text-sm">Notifications</h3>
          <div className="flex items-center gap-1">
            {!needsSetup && onRefresh && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onRefresh}
                disabled={isLoading}
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
                />
                <span className="sr-only">Refresh</span>
              </Button>
            )}
            {!needsSetup && hasNotifications && onDismissAll && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onDismissAll}
                title="Mark all as read"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span className="sr-only">Mark all as read</span>
              </Button>
            )}
          </div>
        </div>

        {/* Setup Required Message */}
        {needsSetup ? (
          <div className="p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-500/10 mb-4">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <h4 className="font-semibold text-sm mb-2">Setup Required</h4>
            <p className="text-xs text-muted-foreground mb-4">
              Complete your trading account setup to receive notifications about
              your orders and positions.
            </p>
            <Button size="sm" className="gap-2" onClick={handleSetupClick}>
              <Settings className="h-3.5 w-3.5" />
              Setup Trading Account
            </Button>
          </div>
        ) : (
          <>
            {/* Notification List */}
            <div className="max-h-[320px] overflow-y-auto">
              <NotificationList
                notifications={notifications}
                isLoading={isLoading}
                onDismiss={onDismiss}
                showDismiss={true}
                compact={true}
                maxItems={MAX_POPOVER_ITEMS}
                emptyMessage="All caught up!"
              />
            </div>

            {/* Footer - Show More Link */}
            {hasNotifications && (
              <div className="border-t border-border/50 p-2">
                <Link href="/notifications" className="block">
                  <Button
                    variant="ghost"
                    className="w-full justify-between h-9 text-xs font-medium hover:bg-muted/60"
                  >
                    <span>
                      {hasMore
                        ? `View all ${notifications.length} notifications`
                        : "View all notifications"}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
