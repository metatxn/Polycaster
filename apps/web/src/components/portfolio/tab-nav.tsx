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
    { id: "orders", label: "Open orders", count: orderCount },
    { id: "history", label: "History" },
  ];

  return (
    <div className="flex items-center border-b border-border overflow-x-auto">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`relative shrink-0 px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === tab.id
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2">
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  activeTab === tab.id
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {tab.count}
              </span>
            )}
          </span>
          {activeTab === tab.id && (
            <motion.div
              layoutId="activeTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
            />
          )}
        </button>
      ))}
    </div>
  );
}
