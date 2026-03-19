import { motion } from "framer-motion";
import { ChevronRight, Info, Loader2, Search } from "lucide-react";
import type { SupportedAsset } from "@/hooks/use-bridge";
import { cn } from "@/lib/utils";

interface BridgeSelectionProps {
  isLoading: boolean;
  searchQuery: string;
  filteredBridgeAssets: SupportedAsset[];
  isProcessing: boolean;
  onSearchChange: (query: string) => void;
  onSelectAsset: (asset: SupportedAsset) => void;
  getChainConfig: (chainId: string) => { icon: string; gradient: string };
}

export function BridgeSelection({
  isLoading,
  searchQuery,
  filteredBridgeAssets,
  isProcessing,
  onSearchChange,
  onSelectAsset,
  getChainConfig,
}: BridgeSelectionProps) {
  return (
    <motion.div
      key="bridge-select"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-3"
    >
      {/* Search */}
      <div className="relative group">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors" />
        <input
          type="text"
          placeholder="Search chain or token..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-secondary/30 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:outline-none text-sm text-foreground placeholder:text-muted-foreground/50 transition-all"
        />
      </div>

      {/* Info */}
      <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Info className="h-3.5 w-3.5 text-primary" />
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            All deposits are automatically converted to{" "}
            <span className="text-primary font-bold">USDC.e on Polygon</span> at
            the best available rate.
          </p>
        </div>
      </div>

      {/* Assets List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 -mr-1">
          {filteredBridgeAssets.map((asset) => {
            const config = getChainConfig(asset.chainId);
            return (
              <button
                key={`${asset.chainId}-${asset.token.symbol}-${asset.token.address}`}
                type="button"
                onClick={() => onSelectAsset(asset)}
                disabled={isProcessing}
                className="w-full p-3.5 rounded-2xl bg-secondary/30 border border-border hover:bg-secondary/50 hover:border-blue-500/30 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-lg shadow-sm shrink-0",
                        config.gradient
                      )}
                    >
                      <span className="text-white drop-shadow-sm">
                        {config.icon}
                      </span>
                    </div>
                    <div className="text-left min-w-0">
                      <p className="font-bold text-sm text-foreground tracking-tight truncate">
                        {asset.token.symbol}
                      </p>
                      <p className="text-xs text-muted-foreground font-medium truncate">
                        {asset.chainName}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 block mb-0.5">
                        Min
                      </span>
                      <span className="text-xs font-bold text-foreground">
                        ${asset.minCheckoutUsd}
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
