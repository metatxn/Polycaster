import { motion } from "framer-motion";
import { ChevronRight, Loader2, Search } from "lucide-react";
import type { SupportedAsset } from "@/hooks/use-bridge";

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
      {/* Search — underline input */}
      <div className="relative flex items-center border-b border-border/60 focus-within:border-foreground transition-colors mb-5">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder="Search chain or token"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 h-10 pl-3 bg-transparent border-none focus:outline-none text-sm text-foreground placeholder:text-muted-foreground/70 placeholder:font-mono placeholder:text-[11px] placeholder:uppercase placeholder:tracking-[0.14em]"
        />
      </div>

      {/* Info caption */}
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Auto-converted · pUSD on Polygon
      </p>

      {/* Assets List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border-t border-border/40 max-h-[400px] overflow-y-auto">
          {filteredBridgeAssets.map((asset) => (
            <button
              key={`${asset.chainId}-${asset.token.symbol}-${asset.token.address}`}
              type="button"
              onClick={() => onSelectAsset(asset)}
              disabled={isProcessing}
              className="group w-full flex items-center justify-between gap-4 py-3.5 border-b border-border/40 text-left transition-colors hover:border-foreground/60 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground shrink-0 w-16 truncate">
                  {asset.chainName}
                </span>
                <span className="text-[15px] font-medium leading-none text-foreground truncate">
                  {asset.token.symbol}
                </span>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                    Min
                  </span>
                  <span className="font-mono text-xs text-foreground tabular-nums">
                    ${asset.minCheckoutUsd}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
