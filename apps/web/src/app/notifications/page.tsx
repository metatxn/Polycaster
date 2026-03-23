"use client";

import {
  Ban,
  Bell,
  CheckCheck,
  Filter,
  Gavel,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { NotificationList } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import {
  type NotificationFilter,
  NotificationType,
  NotificationTypeLabels,
} from "@/types/notifications";

/**
 * Filter options with icons
 */
const filterOptions: Array<{
  value: NotificationFilter;
  label: string;
  icon: typeof Bell;
}> = [
  { value: "all", label: "All Notifications", icon: Bell },
  {
    value: NotificationType.ORDER_FILL,
    label: NotificationTypeLabels[NotificationType.ORDER_FILL],
    icon: ShoppingCart,
  },
  {
    value: NotificationType.ORDER_CANCELLATION,
    label: NotificationTypeLabels[NotificationType.ORDER_CANCELLATION],
    icon: Ban,
  },
  {
    value: NotificationType.MARKET_RESOLVED,
    label: NotificationTypeLabels[NotificationType.MARKET_RESOLVED],
    icon: Gavel,
  },
];

/**
 * Get label for current filter
 */
function getFilterLabel(filter: NotificationFilter): string {
  if (filter === "all") return "All Notifications";
  return NotificationTypeLabels[filter as NotificationType] || "All";
}

export default function NotificationsPage() {
  const {
    notifications,
    allNotifications,
    unreadCount,
    isLoading,
    error,
    filter,
    canViewNotifications,
    fetchNotifications,
    dismissNotification,
    dismissAll,
    setFilter,
  } = useNotifications();

  // Show connect wallet message if not connected
  if (!canViewNotifications) {
    return (
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex items-center justify-center h-16 w-16 rounded-full bg-muted mb-4">
              <Bell className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              Connect Wallet to View Notifications
            </h2>
            <p className="text-muted-foreground text-center max-w-md">
              You need to connect your wallet and set up trading to receive
              notifications about your orders and markets.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6" />
            Notifications
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {unreadCount > 0
              ? `You have ${unreadCount} notification${unreadCount !== 1 ? "s" : ""}`
              : "You're all caught up!"}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchNotifications}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          {/* Mark All as Read */}
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={dismissAll}
              className="gap-2"
            >
              <CheckCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Mark All Read</span>
            </Button>
          )}

          {/* Filter Dropdown */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {getFilterLabel(filter)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filter by Type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {filterOptions.map((option) => {
                const Icon = option.icon;
                const isActive = filter === option.value;
                return (
                  <DropdownMenuItem
                    key={String(option.value)}
                    onClick={() => setFilter(option.value)}
                    className={cn(isActive && "bg-muted")}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {option.label}
                    {isActive && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        ✓
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">
              Failed to load notifications: {error.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchNotifications}
              className="mt-2"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Notifications List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center justify-between">
            <span>
              {filter === "all" ? "All Activity" : getFilterLabel(filter)}
            </span>
            {filter !== "all" && allNotifications.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {notifications.length} of {allNotifications.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <NotificationList
            notifications={notifications}
            isLoading={isLoading}
            onDismiss={dismissNotification}
            showDismiss={true}
            compact={false}
            emptyMessage={
              filter === "all"
                ? "No notifications yet"
                : `No ${getFilterLabel(filter).toLowerCase()} notifications`
            }
          />
        </CardContent>
      </Card>

      {/* Info Footer */}
      <p className="text-xs text-muted-foreground text-center mt-6">
        Notifications are automatically removed after 48 hours
      </p>
    </div>
  );
}
