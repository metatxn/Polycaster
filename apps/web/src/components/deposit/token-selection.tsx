import { isPusdToken } from "@knoww/shared-types/bridge";
import { m } from "framer-motion";
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
    <m.div
      key="token"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-(--kwm-ink-3)" />
        </div>
      ) : walletTokens.length === 0 ? (
        <div className="py-12 text-center border border-(--kwm-hl) rounded-md">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) mb-3">
            No Supported Tokens
          </p>
          <p className="text-sm text-(--kwm-ink) mb-5 max-w-[280px] mx-auto leading-relaxed">
            Your wallet is empty on Polygon — or we can't see it yet.
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-(--kwm-hl) font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-ink) hover:border-(--kwm-hl-2) hover:bg-(--kwm-bg-2) transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      ) : (
        <>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) mb-3">
            Minimum varies by token · typically ${defaultMinDeposit}+
          </p>

          <div className="flex flex-col gap-2">
            {walletTokens.map((token) => {
              const isDirectPusdDeposit = isPusdToken(
                token.symbol,
                token.address
              );
              const minDeposit = getMinDepositForToken(token.symbol);
              const isUnsupported =
                token.depositSupported === false && !isDirectPusdDeposit;
              const isBelowMinimum = token.usdValue < minDeposit;
              const isDisabled = isUnsupported || isBelowMinimum;
              return (
                <button
                  key={token.address}
                  type="button"
                  onClick={() => !isDisabled && onSelectToken(token)}
                  disabled={isDisabled}
                  className={cn(
                    "group w-full flex items-center justify-between gap-4 px-3.5 py-3 border border-(--kwm-hl) rounded-md text-left transition-colors",
                    isDisabled
                      ? "cursor-not-allowed opacity-50"
                      : "hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-2)"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-(--kwm-bg-3) flex items-center justify-center overflow-hidden shrink-0 border border-(--kwm-hl)">
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
                        <span className="font-mono text-[10px] uppercase tracking-widest text-(--kwm-ink-2)">
                          {token.symbol.slice(0, 3)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 gap-0.5">
                      <span className="text-[14px] font-medium leading-snug text-(--kwm-ink) truncate">
                        {token.symbol}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3) tabular-nums">
                        {token.balance.toFixed(5)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isUnsupported ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) tabular-nums">
                        {token.depositDisabledReason || "Unsupported"}
                      </span>
                    ) : isBelowMinimum ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-warn) tabular-nums">
                        Min · ${minDeposit}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        isDisabled ? "text-(--kwm-ink-3)" : "text-(--kwm-ink)"
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
    </m.div>
  );
}
