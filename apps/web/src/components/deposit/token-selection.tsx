import { motion } from "framer-motion";
import { Info, Loader2, RefreshCw } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { TokenBalance } from "@/hooks/use-wallet-tokens";

interface TokenSelectionProps {
  isLoading: boolean;
  walletTokens: TokenBalance[];
  defaultMinDeposit: number;
  onRefresh: () => void;
  onSelectToken: (token: TokenBalance) => void;
  getMinDepositForToken: (symbol: string) => number;
}

export function TokenSelection({
  isLoading,
  walletTokens,
  defaultMinDeposit,
  onRefresh,
  onSelectToken,
  getMinDepositForToken,
}: TokenSelectionProps) {
  return (
    <motion.div
      key="token"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-3"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : walletTokens.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">No tokens found</p>
          <p className="text-sm text-muted-foreground/70">
            Your wallet doesn't have any supported tokens on Polygon
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={onRefresh}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      ) : (
        <>
          {/* Minimum deposit info */}
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-3">
            <div className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-amber-400" />
              <p className="text-xs text-muted-foreground">
                Minimum deposit varies by token (typically{" "}
                <span className="text-amber-400 font-medium">
                  ${defaultMinDeposit}+
                </span>
                )
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {walletTokens.map((token) => {
              const minDeposit = getMinDepositForToken(token.symbol);
              const isBelowMinimum = token.usdValue < minDeposit;
              return (
                <button
                  key={token.address}
                  type="button"
                  onClick={() => !isBelowMinimum && onSelectToken(token)}
                  disabled={isBelowMinimum}
                  className={`w-full p-3 rounded-xl border transition-all ${
                    isBelowMinimum
                      ? "bg-gray-100 dark:bg-card border-gray-200 dark:border-border opacity-50 cursor-not-allowed"
                      : "bg-gray-100 dark:bg-card border-blue-500/30 hover:border-blue-500/50 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-muted flex items-center justify-center overflow-hidden">
                        {token.logoUrl ? (
                          <Image
                            src={token.logoUrl}
                            alt={token.symbol}
                            width={36}
                            height={36}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <span className="text-sm font-medium">
                            {token.symbol.slice(0, 2)}
                          </span>
                        )}
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-foreground">
                          {token.symbol}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {token.balance.toFixed(5)} {token.symbol}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      {isBelowMinimum && (
                        <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">
                          Min ${minDeposit}
                        </span>
                      )}
                      <span
                        className={`font-medium ${
                          isBelowMinimum
                            ? "text-muted-foreground"
                            : "text-foreground"
                        }`}
                      >
                        ${token.usdValue.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </motion.div>
  );
}
