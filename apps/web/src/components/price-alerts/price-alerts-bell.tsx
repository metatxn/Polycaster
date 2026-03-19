"use client";

import { Activity, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUnseenAlertCount } from "@/hooks/use-price-alerts";
import { cn } from "@/lib/utils";
import { PriceAlertsPopover } from "./price-alerts-popover";

interface PriceAlertsBellProps {
  /** Whether the sidebar is collapsed */
  isCollapsed?: boolean;
  /** Custom class name */
  className?: string;
}

/**
 * Price alerts bell component for the sidebar
 * Shows a badge with unseen alert count
 */
export function PriceAlertsBell({
  isCollapsed = false,
  className,
}: PriceAlertsBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const unseenCount = useUnseenAlertCount();

  const hasAlerts = unseenCount > 0;

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
      {hasAlerts ? (
        <TrendingUp
          className={cn(
            "transition-transform duration-200 shrink-0",
            isCollapsed
              ? "h-5 w-5 group-hover:scale-110"
              : "h-4 w-4 group-hover:scale-110",
            isOpen ? "text-primary-foreground" : "text-amber-500"
          )}
        />
      ) : (
        <Activity
          className={cn(
            "transition-transform duration-200 shrink-0",
            isCollapsed
              ? "h-5 w-5 group-hover:scale-110"
              : "h-4 w-4 group-hover:scale-110",
            isOpen ? "text-primary-foreground" : ""
          )}
        />
      )}
      {!isCollapsed && (
        <>
          <span className="flex-1 text-left">Price Alerts</span>
          {hasAlerts && (
            <span
              className={cn(
                "flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold rounded-full",
                isOpen
                  ? "bg-primary-foreground text-primary"
                  : "bg-amber-500 text-white"
              )}
            >
              {unseenCount > 99 ? "99+" : unseenCount}
            </span>
          )}
          {isOpen && !hasAlerts && (
            <span className="w-2 h-2 rounded-full bg-primary-foreground animate-pulse" />
          )}
        </>
      )}
      {/* Badge on icon only when collapsed */}
      {isCollapsed && hasAlerts && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[9px] font-bold rounded-full",
            isOpen
              ? "bg-primary-foreground text-primary"
              : "bg-amber-500 text-white"
          )}
        >
          {unseenCount > 99 ? "99+" : unseenCount}
        </span>
      )}
    </Button>
  );

  // Wrap in tooltip when collapsed
  if (isCollapsed) {
    return (
      <PriceAlertsPopover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>{bellButton}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            <div className="flex items-center gap-2">
              <span>Price Alerts</span>
              {hasAlerts && (
                <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-amber-500 text-white">
                  {unseenCount > 99 ? "99+" : unseenCount}
                </span>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </PriceAlertsPopover>
    );
  }

  return (
    <PriceAlertsPopover open={isOpen} onOpenChange={setIsOpen}>
      {bellButton}
    </PriceAlertsPopover>
  );
}
