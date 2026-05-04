"use client";

import { SearchBar } from "@/components/portfolio/search-bar";
import { TabNav } from "@/components/portfolio/tab-nav";
import type { PnLFilter, TabType } from "@/components/portfolio/types";

interface PortfolioLedgerHeaderProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  positionCount: number | undefined;
  orderCount: number | undefined;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  pnlFilter: PnLFilter;
  onPnlFilterChange: (filter: PnLFilter) => void;
}

const PLACEHOLDERS: Record<TabType, string> = {
  positions: "Search markets...",
  orders: "Search orders...",
  history: "Search history...",
};

export function PortfolioLedgerHeader({
  activeTab,
  onTabChange,
  positionCount,
  orderCount,
  searchQuery,
  onSearchChange,
  pnlFilter,
  onPnlFilterChange,
}: PortfolioLedgerHeaderProps) {
  return (
    <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
      <div className="lg:flex-1 lg:min-w-0">
        <TabNav
          activeTab={activeTab}
          onTabChange={onTabChange}
          positionCount={positionCount}
          orderCount={orderCount}
        />
      </div>
      <div className="lg:flex-1 lg:max-w-xl lg:pb-1">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder={PLACEHOLDERS[activeTab]}
          pnlFilter={pnlFilter}
          onPnlFilterChange={onPnlFilterChange}
          showFilter={activeTab === "positions"}
        />
      </div>
    </div>
  );
}
