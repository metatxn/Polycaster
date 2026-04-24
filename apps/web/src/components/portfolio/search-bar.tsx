import { Search, X } from "lucide-react";
import type { PnLFilter } from "./types";

const PNL_FILTERS: { value: PnLFilter; label: string; underline: string }[] = [
  { value: "all", label: "All", underline: "bg-foreground" },
  { value: "profit", label: "Profit", underline: "bg-emerald-500" },
  { value: "loss", label: "Loss", underline: "bg-red-500" },
];

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
    <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
      {/* Editorial underline input — no shadcn shell */}
      <div className="relative flex-1 max-w-md">
        <Search
          aria-hidden
          className="absolute left-0 bottom-2.5 h-3.5 w-3.5 text-muted-foreground"
        />
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="w-full border-0 border-b border-border/70 bg-transparent rounded-none pl-5 pr-7 pb-2 pt-1 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground transition-colors"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-0 bottom-2 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* PnL filter — mono-caps buttons with hairline active underline */}
      {showFilter && onPnlFilterChange && (
        <div className="flex items-center gap-5">
          {PNL_FILTERS.map((filter) => {
            const isActive = pnlFilter === filter.value;
            return (
              <button
                type="button"
                key={filter.value}
                onClick={() => onPnlFilterChange(filter.value)}
                className={`relative shrink-0 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {filter.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 -bottom-px h-px ${filter.underline}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
