import { ArrowDownRight, ArrowUpRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { PnLFilter } from "./types";

export function SearchBar({
  value,
  onChange,
  placeholder = "Search",
  pnlFilter,
  onPnlFilterChange,
  showFilter = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  pnlFilter?: PnLFilter;
  onPnlFilterChange?: (filter: PnLFilter) => void;
  showFilter?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-9 h-10 bg-background"
        />
      </div>
      {showFilter && onPnlFilterChange && (
        <div className="flex items-center gap-1.5 p-1 bg-muted/50 rounded-lg">
          <button
            type="button"
            onClick={() => onPnlFilterChange("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              pnlFilter === "all"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onPnlFilterChange("profit")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${
              pnlFilter === "profit"
                ? "bg-emerald-500/15 text-emerald-500 shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ArrowUpRight className="h-3 w-3" />
            Profit
          </button>
          <button
            type="button"
            onClick={() => onPnlFilterChange("loss")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${
              pnlFilter === "loss"
                ? "bg-red-500/15 text-red-500 shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ArrowDownRight className="h-3 w-3" />
            Loss
          </button>
        </div>
      )}
    </div>
  );
}
