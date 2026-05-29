import type { SupportedAsset } from "@knoww/shared-types/bridge";
import { motion } from "framer-motion";
import { ChevronRight, Loader2, Search } from "lucide-react";

interface BridgeSelectionProps {
  isLoading: boolean;
  searchQuery: string;
  filteredBridgeAssets: SupportedAsset[];
  isProcessing: boolean;
  onSearchChange: (query: string) => void;
  onSelectAsset: (asset: SupportedAsset) => void;
}

export function BridgeSelection({
  isLoading,
  searchQuery,
  filteredBridgeAssets,
  isProcessing,
  onSearchChange,
  onSelectAsset,
}: BridgeSelectionProps) {
  return (
    <motion.div
      key="bridge-select"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col"
    >
      {/* Search — bordered input */}
      <div className="relative flex items-center h-9 px-3 gap-2 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2) focus-within:border-(--kwm-hl-3) transition-colors mb-4">
        <Search className="h-3.5 w-3.5 text-(--kwm-ink-3) shrink-0" />
        <input
          type="text"
          placeholder="Search chain or token"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 h-full bg-transparent border-none focus:outline-none text-sm text-(--kwm-ink) placeholder:text-(--kwm-ink-dim)"
        />
      </div>

      {/* Info caption */}
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) mb-3">
        Auto-converted · pUSD on Polygon
      </p>

      {/* Assets List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-(--kwm-ink-3)" />
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1">
          {filteredBridgeAssets.map((asset) => (
            <button
              key={`${asset.chainId}-${asset.token.symbol}-${asset.token.address}`}
              type="button"
              onClick={() => onSelectAsset(asset)}
              disabled={isProcessing}
              className="group w-full flex items-center justify-between gap-4 px-3.5 py-3 border border-(--kwm-hl) rounded-md text-left transition-colors hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-2) disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-dim) shrink-0 w-16 truncate">
                  {asset.chainName}
                </span>
                <span className="text-[14px] font-medium leading-snug text-(--kwm-ink) truncate">
                  {asset.token.symbol}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-(--kwm-ink-dim)">
                    Min
                  </span>
                  <span className="font-mono text-xs text-(--kwm-ink-2) tabular-nums">
                    ${asset.minCheckoutUsd}
                  </span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-(--kwm-ink-3) group-hover:text-(--kwm-ink) transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
