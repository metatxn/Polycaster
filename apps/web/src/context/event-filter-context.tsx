"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { EventFilterParams } from "@/hooks/use-paginated-events";

// Volume threshold presets
export interface VolumeThreshold {
  value: number | null; // null means "Any"
  label: string;
}

export const VOLUME_24HR_PRESETS: VolumeThreshold[] = [
  { value: null, label: "Any" },
  { value: 100_000, label: "> $100K" },
  { value: 500_000, label: "> $500K" },
  { value: 1_000_000, label: "> $1M" },
  { value: 5_000_000, label: "> $5M" },
];

export const VOLUME_WEEKLY_PRESETS: VolumeThreshold[] = [
  { value: null, label: "Any" },
  { value: 500_000, label: "> $500K" },
  { value: 1_000_000, label: "> $1M" },
  { value: 5_000_000, label: "> $5M" },
  { value: 10_000_000, label: "> $10M" },
];

export const LIQUIDITY_PRESETS: VolumeThreshold[] = [
  { value: null, label: "Any" },
  { value: 50_000, label: "> $50K" },
  { value: 100_000, label: "> $100K" },
  { value: 500_000, label: "> $500K" },
  { value: 1_000_000, label: "> $1M" },
];

export type VolumeWindow = "24h" | "1wk" | "1mo" | "1yr";

// Status filter options
export type StatusFilter = "active" | "live" | "ended" | "closed";

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "live", label: "Live" },
  { value: "ended", label: "Ended" },
  { value: "closed", label: "Closed" },
];

// Volume window options for the Volume filter dropdown
export const VOLUME_WINDOW_OPTIONS: { value: VolumeWindow; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "1wk", label: "7 days" },
  { value: "1mo", label: "30 days" },
  { value: "1yr", label: "1 year" },
];

// Competitiveness presets (stored as 0-100 in UI, converted to 0-1 for API)
export const COMPETITIVENESS_PRESETS = [
  { value: { min: 0, max: 100 }, label: "Any" },
  { value: { min: 66, max: 100 }, label: "High (66-100%)" },
  { value: { min: 33, max: 66 }, label: "Medium (33-66%)" },
  { value: { min: 0, max: 33 }, label: "Low (0-33%)" },
];

// Competitiveness range
export interface CompetitivenessRange {
  min: number; // 0-100
  max: number; // 0-100
}

// Date range
export interface DateRange {
  start: Date | null;
  end: Date | null;
}

// Complete filter state
export interface EventFilters {
  volume24hr: number | null;
  volumeWeekly: number | null;
  volumeWindow: VolumeWindow;
  liquidity: number | null;
  status: StatusFilter[];
  tagSlugs: string[];
  competitiveness: CompetitivenessRange;
  dateRange: DateRange;
}

// Default filter state
export const DEFAULT_FILTERS: EventFilters = {
  volume24hr: null,
  volumeWeekly: null,
  liquidity: null,
  status: ["active"], // Default to showing active events
  tagSlugs: [],
  competitiveness: { min: 0, max: 100 },
  dateRange: { start: null, end: null },
  volumeWindow: "24h",
};

// Context type
interface EventFilterContextType {
  filters: EventFilters;
  setVolume24hr: (value: number | null) => void;
  setVolumeWeekly: (value: number | null) => void;
  setVolumeWindow: (window: VolumeWindow) => void;
  setLiquidity: (value: number | null) => void;
  toggleStatus: (status: StatusFilter) => void;
  setStatus: (status: StatusFilter[]) => void;
  setTagSlugs: (tags: string[]) => void;
  toggleTag: (tagSlug: string) => void;
  setCompetitiveness: (range: CompetitivenessRange) => void;
  setDateRange: (range: DateRange) => void;
  clearAllFilters: () => void;
  activeFilterCount: number;
  hasActiveFilters: boolean;
  // Server-side filter params for API
  serverFilterParams: EventFilterParams;
  // API query params derived from filters
  apiQueryParams: {
    active: boolean;
    closed: boolean;
    tagSlug?: string;
  };
}

const EventFilterContext = createContext<EventFilterContextType | undefined>(
  undefined
);

export function EventFilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS);

  const setVolume24hr = useCallback((value: number | null) => {
    setFilters((prev) => ({ ...prev, volume24hr: value }));
  }, []);

  const setVolumeWeekly = useCallback((value: number | null) => {
    setFilters((prev) => ({ ...prev, volumeWeekly: value }));
  }, []);

  const setVolumeWindow = useCallback((window: VolumeWindow) => {
    setFilters((prev) => ({ ...prev, volumeWindow: window }));
  }, []);

  const setLiquidity = useCallback((value: number | null) => {
    setFilters((prev) => ({ ...prev, liquidity: value }));
  }, []);

  const toggleStatus = useCallback((status: StatusFilter) => {
    setFilters((prev) => {
      const current = prev.status;
      if (current.includes(status)) {
        // Don't allow removing all status filters - keep at least one
        if (current.length === 1) return prev;
        return { ...prev, status: current.filter((s) => s !== status) };
      }
      return { ...prev, status: [...current, status] };
    });
  }, []);

  const setStatus = useCallback((status: StatusFilter[]) => {
    setFilters((prev) => ({ ...prev, status }));
  }, []);

  const setTagSlugs = useCallback((tags: string[]) => {
    setFilters((prev) => ({ ...prev, tagSlugs: tags }));
  }, []);

  const toggleTag = useCallback((tagSlug: string) => {
    setFilters((prev) => {
      const current = prev.tagSlugs;
      if (current.includes(tagSlug)) {
        return { ...prev, tagSlugs: current.filter((t) => t !== tagSlug) };
      }
      return { ...prev, tagSlugs: [...current, tagSlug] };
    });
  }, []);

  const setCompetitiveness = useCallback((range: CompetitivenessRange) => {
    setFilters((prev) => ({ ...prev, competitiveness: range }));
  }, []);

  const setDateRange = useCallback((range: DateRange) => {
    setFilters((prev) => ({ ...prev, dateRange: range }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.volume24hr !== null) count++;
    if (filters.volumeWeekly !== null) count++;
    if (filters.liquidity !== null) count++;
    // Status is always set, so only count if different from default
    if (filters.status.length !== 1 || !filters.status.includes("active")) {
      count++;
    }
    if (filters.tagSlugs.length > 0) count++;
    if (filters.competitiveness.min > 0 || filters.competitiveness.max < 100) {
      count++;
    }
    if (filters.dateRange.start || filters.dateRange.end) count++;
    // Volume window - count if different from default "24h"
    if (filters.volumeWindow !== "24h") count++;
    return count;
  }, [filters]);

  const hasActiveFilters = activeFilterCount > 0;

  // Compute server-side filter params for the API
  const serverFilterParams = useMemo((): EventFilterParams => {
    const params: EventFilterParams = {};

    // Volume filters
    if (filters.volume24hr !== null) {
      params.volume24hrMin = filters.volume24hr;
    }
    if (filters.volumeWeekly !== null) {
      params.volumeWeeklyMin = filters.volumeWeekly;
    }
    if (filters.liquidity !== null) {
      params.liquidityMin = filters.liquidity;
    }

    // Competitiveness (convert from 0-100 to 0-1)
    if (filters.competitiveness.min > 0) {
      params.competitiveMin = filters.competitiveness.min / 100;
    }
    if (filters.competitiveness.max < 100) {
      params.competitiveMax = filters.competitiveness.max / 100;
    }

    // Live/Ended status
    if (filters.status.includes("live") && !filters.status.includes("active")) {
      params.live = true;
    }
    if (
      filters.status.includes("ended") &&
      !filters.status.includes("active")
    ) {
      params.ended = true;
    }

    // Date range filters
    // For "Today" / "This Week" / "This Month" we filter by endDate (events ending after start date)
    // This shows events that are still relevant within the time window
    if (filters.dateRange.start) {
      params.endDateFrom = filters.dateRange.start.toISOString();
    }
    if (filters.dateRange.end) {
      params.startDateTo = filters.dateRange.end.toISOString();
    }

    return params;
  }, [
    filters.volume24hr,
    filters.volumeWeekly,
    filters.liquidity,
    filters.competitiveness,
    filters.status,
    filters.dateRange,
  ]);

  // Compute API query params (active, closed, tagSlug)
  const apiQueryParams = useMemo(() => {
    const params: { active: boolean; closed: boolean; tagSlug?: string } = {
      active: filters.status.includes("active"),
      closed: filters.status.includes("closed"),
    };

    // If only one tag is selected, use it for server-side filtering
    if (filters.tagSlugs.length === 1) {
      params.tagSlug = filters.tagSlugs[0];
    }

    return params;
  }, [filters.status, filters.tagSlugs]);

  const value = useMemo(
    () => ({
      filters,
      setVolume24hr,
      setVolumeWeekly,
      setVolumeWindow,
      setLiquidity,
      toggleStatus,
      setStatus,
      setTagSlugs,
      toggleTag,
      setCompetitiveness,
      setDateRange,
      clearAllFilters,
      activeFilterCount,
      hasActiveFilters,
      serverFilterParams,
      apiQueryParams,
    }),
    [
      filters,
      setVolume24hr,
      setVolumeWeekly,
      setVolumeWindow,
      setLiquidity,
      toggleStatus,
      setStatus,
      setTagSlugs,
      toggleTag,
      setCompetitiveness,
      setDateRange,
      clearAllFilters,
      activeFilterCount,
      hasActiveFilters,
      serverFilterParams,
      apiQueryParams,
    ]
  );

  return (
    <EventFilterContext.Provider value={value}>
      {children}
    </EventFilterContext.Provider>
  );
}

export function useEventFilters() {
  const context = useContext(EventFilterContext);
  if (context === undefined) {
    throw new Error(
      "useEventFilters must be used within an EventFilterProvider"
    );
  }
  return context;
}
