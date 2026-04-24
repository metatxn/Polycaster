import { motion } from "framer-motion";
import type { TabType } from "./types";

export function TabNav({
  activeTab,
  onTabChange,
  positionCount,
  orderCount,
}: {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  positionCount?: number;
  orderCount?: number;
}) {
  const tabs: { id: TabType; label: string; count?: number }[] = [
    { id: "positions", label: "Positions", count: positionCount },
    { id: "orders", label: "Open Orders", count: orderCount },
    { id: "history", label: "History" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Portfolio section"
      className="flex items-center gap-5 sm:gap-6 overflow-x-auto scrollbar-hide border-b border-border/40"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            type="button"
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={`relative shrink-0 py-3 font-mono text-[11px] uppercase tracking-[0.15em] whitespace-nowrap transition-colors ${
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-baseline gap-1.5">
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="font-mono text-[10px] tabular-nums opacity-60">
                  {tab.count}
                </span>
              )}
            </span>
            {isActive && (
              <motion.span
                layoutId="portfolioTabUnderline"
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-px bg-foreground"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
