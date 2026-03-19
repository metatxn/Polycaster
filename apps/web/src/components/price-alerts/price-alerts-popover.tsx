"use client";

import { Activity, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  requestNotificationPermission,
  usePriceAlerts,
} from "@/hooks/use-price-alerts";
import { PriceAlertItem } from "./price-alert-item";
import { PriceAlertsSettings } from "./price-alerts-settings";

interface PriceAlertsPopoverProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PriceAlertsPopover({
  children,
  open,
  onOpenChange,
}: PriceAlertsPopoverProps) {
  const [showSettings, setShowSettings] = useState(false);
  const { alerts, unseenCount, markSeen, markAllSeen, clearAlerts, config } =
    usePriceAlerts();

  const handleRequestPermission = async () => {
    await requestNotificationPermission();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-[340px] p-0 shadow-2xl border border-border bg-background"
        side="right"
        align="start"
        sideOffset={8}
      >
        {showSettings ? (
          <PriceAlertsSettings onBack={() => setShowSettings(false)} />
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Price Alerts</h3>
                  <p className="text-[10px] text-muted-foreground">
                    {alerts.length === 0
                      ? "No alerts"
                      : `${alerts.length} alert${alerts.length > 1 ? "s" : ""}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {alerts.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={clearAlerts}
                    title="Clear all alerts"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowSettings(true)}
                  title="Alert settings"
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Browser notification permission prompt */}
            {typeof window !== "undefined" &&
              "Notification" in window &&
              Notification.permission === "default" &&
              config.browserNotificationsEnabled && (
                <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-xs font-medium">
                        Enable browser notifications
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Get alerts even when this tab is in background
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      onClick={handleRequestPermission}
                    >
                      Enable
                    </Button>
                  </div>
                </div>
              )}

            {/* Mark all as read */}
            {unseenCount > 0 && (
              <div className="px-4 py-2 border-b border-border/50 bg-muted/20">
                <button
                  type="button"
                  onClick={markAllSeen}
                  className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  Mark all as read ({unseenCount})
                </button>
              </div>
            )}

            {/* Alerts List */}
            {alerts.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                  <Activity className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-foreground/80">
                  No alerts yet
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[200px] mx-auto">
                  You&apos;ll be notified when prices move significantly
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[320px]">
                <div className="divide-y divide-border/30">
                  {alerts.slice(0, 20).map((alert) => (
                    <PriceAlertItem
                      key={alert.id}
                      alert={alert}
                      onSeen={() => markSeen(alert.id)}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Footer */}
            {alerts.length > 0 && (
              <div className="px-4 py-2.5 border-t border-border/50 bg-muted/20">
                <p className="text-[10px] text-center text-muted-foreground">
                  Showing latest {Math.min(alerts.length, 20)} alerts
                </p>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
