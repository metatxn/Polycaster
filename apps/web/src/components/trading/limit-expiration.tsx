"use client";

import { format } from "date-fns";
import { CalendarIcon, Clock } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type LimitExpirationType = "GTC" | "GTD";

interface LimitExpirationProps {
  expirationType: LimitExpirationType;
  onExpirationTypeChange: (type: LimitExpirationType) => void;
  expirationTime: number; // in seconds
  onExpirationTimeChange: (seconds: number) => void;
}

// Preset expiration options in seconds
const EXPIRATION_PRESETS = [
  { label: "1h", value: 3600 },
  { label: "4h", value: 14400 },
  { label: "24h", value: 86400 },
  { label: "7d", value: 604800 },
  { label: "30d", value: 2592000 },
];

// Time options for the time picker
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

export function LimitExpiration({
  expirationType,
  onExpirationTypeChange,
  expirationTime,
  onExpirationTimeChange,
}: LimitExpirationProps) {
  const [isCustom, setIsCustom] = useState(false);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [customHour, setCustomHour] = useState(12);
  const [customMinute, setCustomMinute] = useState(0);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const isExpirationEnabled = expirationType === "GTD";

  const formatExpirationDisplay = (seconds: number): string => {
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  // Check if current expiration matches a preset
  const isPresetSelected = useMemo(() => {
    return EXPIRATION_PRESETS.some((preset) => preset.value === expirationTime);
  }, [expirationTime]);

  // Calculate custom expiration date from current expirationTime
  const customExpirationDate = useMemo(() => {
    if (isCustom && !isPresetSelected) {
      const date = new Date(Date.now() + expirationTime * 1000);
      return date;
    }
    return undefined;
  }, [expirationTime, isCustom, isPresetSelected]);

  // Handle toggle change
  const handleToggleChange = useCallback(() => {
    if (isExpirationEnabled) {
      onExpirationTypeChange("GTC");
    } else {
      onExpirationTypeChange("GTD");
      // Set default to 24h when enabling
      if (!expirationTime || expirationTime < 60) {
        onExpirationTimeChange(86400);
      }
    }
  }, [
    isExpirationEnabled,
    onExpirationTypeChange,
    expirationTime,
    onExpirationTimeChange,
  ]);

  // Handle preset selection
  const handlePresetClick = useCallback(
    (value: number) => {
      setIsCustom(false);
      setCustomDate(undefined);
      onExpirationTimeChange(value);
    },
    [onExpirationTimeChange]
  );

  // Handle custom date/time selection
  const handleCustomDateSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) return;
      setCustomDate(date);

      // Combine date with selected time
      const selectedDateTime = new Date(date);
      selectedDateTime.setHours(customHour, customMinute, 0, 0);

      // Calculate seconds from now
      const now = new Date();
      const diffSeconds = Math.floor(
        (selectedDateTime.getTime() - now.getTime()) / 1000
      );

      // Minimum 1 minute in the future
      if (diffSeconds > 60) {
        onExpirationTimeChange(diffSeconds);
        setIsCustom(true);
      }
    },
    [customHour, customMinute, onExpirationTimeChange]
  );

  // Handle time change
  const handleTimeChange = useCallback(
    (hour: number, minute: number) => {
      setCustomHour(hour);
      setCustomMinute(minute);

      if (customDate) {
        const selectedDateTime = new Date(customDate);
        selectedDateTime.setHours(hour, minute, 0, 0);

        const now = new Date();
        const diffSeconds = Math.floor(
          (selectedDateTime.getTime() - now.getTime()) / 1000
        );

        if (diffSeconds > 60) {
          onExpirationTimeChange(diffSeconds);
        }
      }
    },
    [customDate, onExpirationTimeChange]
  );

  // Format the custom date for display
  const formattedCustomDate = useMemo(() => {
    if (customDate) {
      const dateWithTime = new Date(customDate);
      dateWithTime.setHours(customHour, customMinute, 0, 0);
      return format(dateWithTime, "MMM d, yyyy 'at' h:mm a");
    }
    if (customExpirationDate) {
      return format(customExpirationDate, "MMM d, yyyy 'at' h:mm a");
    }
    return "Select date & time";
  }, [customDate, customHour, customMinute, customExpirationDate]);

  // Minimum date is today
  const minDate = new Date();
  minDate.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-3">
      {/* Set Expiration Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Set Expiration
          </span>
        </div>
        <button
          type="button"
          onClick={handleToggleChange}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isExpirationEnabled ? "bg-emerald-500" : "bg-muted"
          )}
          role="switch"
          aria-checked={isExpirationEnabled}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition duration-200",
              isExpirationEnabled ? "translate-x-4" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {/* Expiration Options - Only show when enabled */}
      {isExpirationEnabled ? (
        <div className="space-y-2">
          {/* Preset buttons + Custom */}
          <div className="flex flex-wrap gap-1.5">
            {EXPIRATION_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-lg transition-all",
                  expirationTime === preset.value && !isCustom
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                    : "bg-secondary/50 text-muted-foreground hover:text-foreground border border-transparent"
                )}
                onClick={() => handlePresetClick(preset.value)}
              >
                {preset.label}
              </button>
            ))}

            {/* Custom button with popover */}
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5",
                    isCustom
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                      : "bg-secondary/50 text-muted-foreground hover:text-foreground border border-transparent"
                  )}
                >
                  <CalendarIcon className="h-3 w-3" />
                  Custom
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div className="p-3 space-y-3">
                  {/* Calendar */}
                  <Calendar
                    mode="single"
                    selected={customDate}
                    onSelect={handleCustomDateSelect}
                    disabled={(date) => date < minDate}
                    initialFocus
                  />

                  {/* Time Picker */}
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Select Time
                    </p>
                    <div className="flex gap-2">
                      {/* Hour Select */}
                      <div className="flex-1">
                        <select
                          value={customHour}
                          onChange={(e) =>
                            handleTimeChange(
                              Number.parseInt(e.target.value, 10),
                              customMinute
                            )
                          }
                          className="w-full h-9 px-2 text-sm bg-secondary/50 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring/50"
                        >
                          {HOURS.map((hour) => (
                            <option key={hour} value={hour}>
                              {hour.toString().padStart(2, "0")}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="flex items-center text-muted-foreground">
                        :
                      </span>
                      {/* Minute Select */}
                      <div className="flex-1">
                        <select
                          value={customMinute}
                          onChange={(e) =>
                            handleTimeChange(
                              customHour,
                              Number.parseInt(e.target.value, 10)
                            )
                          }
                          className="w-full h-9 px-2 text-sm bg-secondary/50 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring/50"
                        >
                          {MINUTES.map((minute) => (
                            <option key={minute} value={minute}>
                              {minute.toString().padStart(2, "0")}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Confirm Button */}
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    disabled={!customDate}
                    onClick={() => setIsCalendarOpen(false)}
                  >
                    Confirm
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Expiration info */}
          {isCustom && customDate ? (
            <p className="text-[10px] text-muted-foreground">
              Expires on {formattedCustomDate}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Expires in {formatExpirationDisplay(expirationTime)} if not filled
            </p>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          Order remains active until filled or manually cancelled
        </p>
      )}
    </div>
  );
}
