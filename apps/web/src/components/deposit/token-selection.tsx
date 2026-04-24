import { motion } from "framer-motion";
import { Loader2, RefreshCw } from "lucide-react";
import Image from "next/image";
import type { TokenBalance } from "@/hooks/use-wallet-tokens";
import { cn } from "@/lib/utils";

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
      className="flex flex-col"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : walletTokens.length === 0 ? (
        <div className="py-12 text-center border-y border-border/40">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
            No Supported Tokens
          </p>
          <p className="text-sm text-foreground mb-5 max-w-[280px] mx-auto leading-relaxed">
            Your wallet is empty on Polygon — or we can't see it yet.
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground hover:text-muted-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            <span className="underline underline-offset-4 decoration-border">
              Retry
            </span>
          </button>
        </div>
      ) : (
        <>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
            Minimum varies by token · typically ${defaultMinDeposit}+
          </p>

          <div className="border-t border-border/40">
            {walletTokens.map((token) => {
              const minDeposit = getMinDepositForToken(token.symbol);
              const isBelowMinimum = token.usdValue < minDeposit;
              return (
                <button
                  key={token.address}
                  type="button"
                  onClick={() => !isBelowMinimum && onSelectToken(token)}
                  disabled={isBelowMinimum}
                  className={cn(
                    "group w-full flex items-center justify-between gap-4 py-3.5 border-b border-border/40 text-left transition-colors",
                    isBelowMinimum
                      ? "cursor-not-allowed opacity-50"
                      : "hover:border-foreground/60"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {token.logoUrl ? (
                        <Image
                          src={token.logoUrl}
                          alt={token.symbol}
                          width={32}
                          height={32}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <span className="font-mono text-[10px] uppercase tracking-widest text-foreground/80">
                          {token.symbol.slice(0, 3)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 gap-1.5">
                      <span className="text-[15px] font-medium leading-none text-foreground truncate">
                        {token.symbol}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
                        {token.balance.toFixed(5)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    {isBelowMinimum && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-500 tabular-nums">
                        Min · ${minDeposit}
                      </span>
                    )}
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        isBelowMinimum
                          ? "text-muted-foreground"
                          : "text-foreground"
                      )}
                    >
                      ${token.usdValue.toFixed(2)}
                    </span>
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
