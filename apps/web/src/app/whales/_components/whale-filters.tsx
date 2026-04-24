"use client";

import { ChevronDown, Search, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { InsiderSortMode } from "@/hooks/use-insider-activity";
import { cn } from "@/lib/utils";
import {
  INSIDER_SENSITIVITY_OPTIONS,
  INSIDER_SORT_OPTIONS,
  TIME_PERIODS,
  type TimePeriodValue,
  TRADE_SIZE_OPTIONS,
  WHALE_TYPE_FILTERS,
  type WhaleTypeFilter,
} from "../_lib/constants";

type ViewTab = "whales" | "insiders";

interface WhaleFiltersProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;

  timePeriod: TimePeriodValue;
  onTimePeriodChange: (v: TimePeriodValue) => void;

  minTradeSize: string;
  onMinTradeSizeChange: (v: string) => void;

  insiderSensitivity: "conservative" | "balanced" | "aggressive";
  onInsiderSensitivityChange: (
    v: "conservative" | "balanced" | "aggressive"
  ) => void;

  insiderSortMode: InsiderSortMode;
  onInsiderSortModeChange: (v: InsiderSortMode) => void;

  whaleTypeFilter: WhaleTypeFilter;
  onWhaleTypeFilterChange: (v: WhaleTypeFilter) => void;

  walletSearch: string;
  onWalletSearchChange: (v: string) => void;
}

/**
 * Editorial filter strip. Uses the same underline-active language as
 * /events. Time + mode + sensitivity + search all collapse into one
 * hairline-bound bar with a second row for the tab switch.
 */
export function WhaleFilters({
  activeTab,
  onTabChange,
  timePeriod,
  onTimePeriodChange,
  minTradeSize,
  onMinTradeSizeChange,
  insiderSensitivity,
  onInsiderSensitivityChange,
  insiderSortMode,
  onInsiderSortModeChange,
  whaleTypeFilter,
  onWhaleTypeFilterChange,
  walletSearch,
  onWalletSearchChange,
}: WhaleFiltersProps) {
  return (
    <div className="border-y border-border/50">
      {/* Row 1: Tab switch + wallet search */}
      <div className="flex items-center gap-1 py-2 border-b border-border/30">
        <span className="shrink-0 pl-0.5 pr-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 self-center">
          View
        </span>
        <TabPill
          label="Whale Activity"
          isActive={activeTab === "whales"}
          onClick={() => onTabChange("whales")}
        />
        <TabPill
          label="Insider Detection"
          isActive={activeTab === "insiders"}
          onClick={() => onTabChange("insiders")}
        />

        <div className="flex-1" />

        {/* Wallet / name search — underline input, same language as
            /events MarketSearch. Filters both ledgers on the page. */}
        <div className="relative w-56 hidden md:block">
          <Search className="absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
          <input
            type="text"
            placeholder="Filter by wallet or name…"
            value={walletSearch}
            onChange={(e) => onWalletSearchChange(e.target.value)}
            className="w-full h-8 pl-6 pr-6 bg-transparent border-0 border-b border-border/70 focus:border-foreground focus:outline-none text-sm placeholder:text-muted-foreground/60 placeholder:font-editorial placeholder:italic transition-colors"
          />
          {walletSearch && (
            <button
              type="button"
              onClick={() => onWalletSearchChange("")}
              className="absolute right-0 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/70 hover:text-foreground transition-colors"
              aria-label="Clear wallet filter"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Row 2: cross-filters — time window, min trade, mode-specific */}
      <div className="flex items-center gap-1 py-2 overflow-x-auto scrollbar-hide">
        <span className="shrink-0 pl-0.5 pr-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 self-center">
          Filter
        </span>

        {/* Time window — inline pills since there are only 4 */}
        <InlineGroup label="Window">
          {TIME_PERIODS.map((p) => (
            <MiniPill
              key={p.value}
              isActive={timePeriod === p.value}
              onClick={() => onTimePeriodChange(p.value)}
            >
              {p.label}
            </MiniPill>
          ))}
        </InlineGroup>

        <Divider />

        {/* Min trade size — dropdown */}
        <DropdownFilter
          label="Min"
          value={
            TRADE_SIZE_OPTIONS.find((o) => o.value === minTradeSize)?.label ||
            "$100+"
          }
        >
          {TRADE_SIZE_OPTIONS.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={minTradeSize === o.value}
              onCheckedChange={() => onMinTradeSizeChange(o.value)}
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownFilter>

        {activeTab === "whales" && (
          <>
            <Divider />

            <InlineGroup label="Type">
              {WHALE_TYPE_FILTERS.map((t) => (
                <MiniPill
                  key={t.value}
                  isActive={whaleTypeFilter === t.value}
                  onClick={() => onWhaleTypeFilterChange(t.value)}
                >
                  {t.label}
                </MiniPill>
              ))}
            </InlineGroup>
          </>
        )}

        {activeTab === "insiders" && (
          <>
            <Divider />

            <DropdownFilter
              label="Sensitivity"
              value={
                INSIDER_SENSITIVITY_OPTIONS.find(
                  (o) => o.value === insiderSensitivity
                )?.label || "Balanced"
              }
            >
              {INSIDER_SENSITIVITY_OPTIONS.map((o) => (
                <DropdownMenuCheckboxItem
                  key={o.value}
                  checked={insiderSensitivity === o.value}
                  onCheckedChange={() => onInsiderSensitivityChange(o.value)}
                >
                  {o.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownFilter>

            <Divider />

            <DropdownFilter
              label="Sort"
              value={
                INSIDER_SORT_OPTIONS.find((o) => o.value === insiderSortMode)
                  ?.label || "Most Suspicious"
              }
            >
              {INSIDER_SORT_OPTIONS.map((o) => (
                <DropdownMenuCheckboxItem
                  key={o.value}
                  checked={insiderSortMode === o.value}
                  onCheckedChange={() => onInsiderSortModeChange(o.value)}
                >
                  {o.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownFilter>
          </>
        )}
      </div>
    </div>
  );
}

function TabPill({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors active:scale-[0.97] shrink-0",
        isActive
          ? "text-foreground font-semibold"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      {isActive && (
        <span className="absolute inset-x-2 -bottom-px h-px bg-foreground" />
      )}
    </button>
  );
}

function InlineGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-1 shrink-0">
      <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 pr-1">
        {label}
      </span>
      {children}
    </div>
  );
}

function MiniPill({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center px-2 py-1 text-[12px] font-mono tabular-nums transition-colors shrink-0",
        isActive
          ? "text-foreground font-semibold"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
      {isActive && (
        <span className="absolute inset-x-1 -bottom-px h-px bg-foreground" />
      )}
    </button>
  );
}

function DropdownFilter({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-1.5 px-2 py-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors shrink-0 border-b border-dotted border-border/60 hover:border-foreground/60"
        >
          <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-[0.12em] opacity-70">
            {label}
          </span>
          <span className="font-medium text-foreground">{value}</span>
          <ChevronDown
            aria-hidden
            className="h-3 w-3 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Divider() {
  return <span aria-hidden className="h-4 w-px bg-border/60 mx-1 shrink-0" />;
}
