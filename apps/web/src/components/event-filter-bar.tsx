"use client";

import {
  Activity,
  ChevronDown,
  Clock,
  Droplets,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LIQUIDITY_PRESETS,
  STATUS_OPTIONS,
  useEventFilters,
  VOLUME_WINDOW_OPTIONS,
  type VolumeWindow,
} from "@/context/event-filter-context";
import { useTags } from "@/hooks/use-tags";
import { cn } from "@/lib/utils";

// Reusable filter chip component - exported for use in combined filter row
export function FilterChip({
  icon: Icon,
  label,
  value,
  isActive,
  children,
  compact = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  isActive?: boolean;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 font-medium transition-all",
            "active:scale-[0.97] shrink-0",
            compact
              ? "px-2.5 py-1.5 text-[13px] rounded-lg hover:bg-white/70 dark:hover:bg-white/10"
              : "px-3.5 py-2 text-sm rounded-full border border-border/60 hover:border-border bg-background hover:bg-muted/50",
            isActive
              ? compact
                ? "bg-white dark:bg-white/15 text-primary dark:text-primary shadow-sm dark:shadow-none"
                : "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15"
              : compact
                ? "text-gray-600 dark:text-white/70"
                : ""
          )}
        >
          <Icon
            className={cn(
              compact ? "h-3.5 w-3.5" : "h-4 w-4",
              isActive
                ? "text-primary"
                : compact
                  ? "text-gray-500 dark:text-white/60"
                  : "text-muted-foreground"
            )}
          />
          {!compact && (
            <span className="hidden xs:inline text-muted-foreground">
              {label}:
            </span>
          )}
          <span
            className={cn(
              "font-semibold",
              isActive ? "text-primary" : compact ? "dark:text-white/90" : ""
            )}
          >
            {value}
          </span>
          <ChevronDown
            className={cn(
              compact ? "h-3 w-3" : "h-3.5 w-3.5",
              isActive
                ? "text-primary/70"
                : compact
                  ? "text-gray-500 dark:text-white/50"
                  : "text-muted-foreground/60"
            )}
          />
        </button>
      </DropdownMenuTrigger>
      {children}
    </DropdownMenu>
  );
}

// Hook to get filter state and handlers - exported for use in combined filter row
export function useFilterBarState() {
  const {
    filters,
    setVolumeWindow,
    setLiquidity,
    toggleStatus,
    setTagSlugs,
    setDateRange,
    clearAllFilters,
    hasActiveFilters,
  } = useEventFilters();

  const { data: tags } = useTags();

  // Get current filter display values
  const liquidityLabel =
    LIQUIDITY_PRESETS.find((p) => p.value === filters.liquidity)?.label ||
    "Any";
  const volumeWindowLabel =
    VOLUME_WINDOW_OPTIONS.find((o) => o.value === filters.volumeWindow)
      ?.label || "24h";

  // Status display
  const statusLabel =
    filters.status.length === STATUS_OPTIONS.length
      ? "All"
      : filters.status.length === 0
        ? "None"
        : filters.status.length === 1
          ? STATUS_OPTIONS.find((s) => s.value === filters.status[0])?.label
          : `${filters.status.length}`;

  // Tags display
  const tagsLabel =
    filters.tagSlugs.length === 0
      ? "All"
      : filters.tagSlugs.length === 1
        ? tags?.find((t) => t.slug === filters.tagSlugs[0])?.label ||
          filters.tagSlugs[0]
        : `${filters.tagSlugs.length}`;

  // Date range display
  const dateRangeLabel = useMemo(() => {
    const { start, end } = filters.dateRange;
    if (!start && !end) return "All";
    if (start && end) {
      const now = Date.now();
      const diffMs = now - start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays <= 1.1) return "24h";
      if (diffDays <= 7.5 && diffDays >= 6.5) return "7d";
      if (diffDays <= 31 && diffDays >= 28) return "30d";
      return "Custom";
    }
    return "Custom";
  }, [filters.dateRange]);

  // Check if individual filters are active (non-default)
  const isDateActive = dateRangeLabel !== "All";
  const isLiquidityActive = filters.liquidity !== null;
  const isStatusActive = filters.status.length !== STATUS_OPTIONS.length;
  const isTagsActive = filters.tagSlugs.length > 0;
  const isVolumeActive = filters.volumeWindow !== "24h";

  // Handle volume window selection
  const handleVolumeWindowChange = useCallback(
    (window: VolumeWindow) => {
      setVolumeWindow(window);
    },
    [setVolumeWindow]
  );

  const handleLiquidityChange = useCallback(
    (value: number | null) => {
      setLiquidity(value);
    },
    [setLiquidity]
  );

  const handleTagToggle = useCallback(
    (tagSlug: string) => {
      if (filters.tagSlugs.includes(tagSlug)) {
        setTagSlugs(filters.tagSlugs.filter((t) => t !== tagSlug));
      } else {
        setTagSlugs([...filters.tagSlugs, tagSlug]);
      }
    },
    [filters.tagSlugs, setTagSlugs]
  );

  // Date quick presets
  const handleDatePreset = useCallback(
    (preset: "24h" | "week" | "month" | "all") => {
      const now = new Date();
      switch (preset) {
        case "24h":
          setDateRange({
            start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            end: new Date(),
          });
          break;
        case "week":
          setDateRange({
            start: new Date(now.setDate(now.getDate() - 7)),
            end: new Date(),
          });
          break;
        case "month":
          setDateRange({
            start: new Date(now.setMonth(now.getMonth() - 1)),
            end: new Date(),
          });
          break;
        case "all":
          setDateRange({ start: null, end: null });
          break;
      }
    },
    [setDateRange]
  );

  return {
    filters,
    tags,
    liquidityLabel,
    volumeWindowLabel,
    statusLabel,
    tagsLabel,
    dateRangeLabel,
    isDateActive,
    isLiquidityActive,
    isStatusActive,
    isTagsActive,
    isVolumeActive,
    hasActiveFilters,
    handleVolumeWindowChange,
    handleLiquidityChange,
    handleTagToggle,
    handleDatePreset,
    toggleStatus,
    setTagSlugs,
    clearAllFilters,
  };
}

interface EventFilterBarProps {
  className?: string;
}

export function EventFilterBar({ className }: EventFilterBarProps) {
  const {
    filters,
    tags,
    liquidityLabel,
    volumeWindowLabel,
    statusLabel,
    tagsLabel,
    dateRangeLabel,
    isDateActive,
    isLiquidityActive,
    isStatusActive,
    isTagsActive,
    isVolumeActive,
    hasActiveFilters,
    handleVolumeWindowChange,
    handleLiquidityChange,
    handleTagToggle,
    handleDatePreset,
    toggleStatus,
    setTagSlugs,
    clearAllFilters,
  } = useFilterBarState();

  return (
    <div className={cn("relative", className)}>
      <div className="flex items-center gap-2 py-3 overflow-x-auto scrollbar-hide">
        {/* Created At Filter */}
        <FilterChip
          icon={Clock}
          label="Created"
          value={dateRangeLabel}
          isActive={isDateActive}
        >
          <DropdownMenuContent align="start" className="w-36">
            <DropdownMenuCheckboxItem
              checked={dateRangeLabel === "All"}
              onCheckedChange={() => handleDatePreset("all")}
            >
              All time
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={dateRangeLabel === "24h"}
              onCheckedChange={() => handleDatePreset("24h")}
            >
              Last 24h
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={dateRangeLabel === "7d"}
              onCheckedChange={() => handleDatePreset("week")}
            >
              Last 7 days
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={dateRangeLabel === "30d"}
              onCheckedChange={() => handleDatePreset("month")}
            >
              Last 30 days
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </FilterChip>

        {/* Liquidity Filter */}
        <FilterChip
          icon={Droplets}
          label="Liquidity"
          value={liquidityLabel}
          isActive={isLiquidityActive}
        >
          <DropdownMenuContent align="start" className="w-36">
            {LIQUIDITY_PRESETS.map((preset) => (
              <DropdownMenuCheckboxItem
                key={preset.label}
                checked={filters.liquidity === preset.value}
                onCheckedChange={() => handleLiquidityChange(preset.value)}
              >
                {preset.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </FilterChip>

        {/* Status Filter */}
        <FilterChip
          icon={Activity}
          label="Status"
          value={statusLabel || "All"}
          isActive={isStatusActive}
        >
          <DropdownMenuContent align="start" className="w-36">
            {STATUS_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={filters.status.includes(option.value)}
                onCheckedChange={() => toggleStatus(option.value)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </FilterChip>

        {/* Tags Filter */}
        <FilterChip
          icon={Tag}
          label="Tags"
          value={tagsLabel}
          isActive={isTagsActive}
        >
          <DropdownMenuContent
            align="start"
            className="w-48 max-h-64 overflow-y-auto"
          >
            <DropdownMenuCheckboxItem
              checked={filters.tagSlugs.length === 0}
              onCheckedChange={() => setTagSlugs([])}
            >
              All tags
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {tags?.slice(0, 15).map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag.slug}
                checked={filters.tagSlugs.includes(tag.slug)}
                onCheckedChange={() => handleTagToggle(tag.slug)}
              >
                {tag.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </FilterChip>

        {/* Volume Filter */}
        <FilterChip
          icon={SlidersHorizontal}
          label="Volume"
          value={volumeWindowLabel}
          isActive={isVolumeActive}
        >
          <DropdownMenuContent align="start" className="w-36">
            {VOLUME_WINDOW_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={filters.volumeWindow === option.value}
                onCheckedChange={() => handleVolumeWindowChange(option.value)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </FilterChip>

        {/* Clear Filters Button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium text-destructive bg-destructive/10 hover:bg-destructive/15 border border-destructive/20 transition-all active:scale-[0.97] shrink-0"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}
      </div>
    </div>
  );
}
