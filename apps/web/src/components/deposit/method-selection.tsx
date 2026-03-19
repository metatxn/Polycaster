import { motion } from "framer-motion";
import { ChevronRight, CreditCard, RefreshCw, Zap } from "lucide-react";
import type { TokenBalance } from "@/hooks/use-wallet-tokens";
import { formatAddress } from "@/lib/formatters";
import type { DepositMethod } from "./types";

interface MethodSelectionProps {
  isConnected: boolean;
  address?: string;
  walletTokens: TokenBalance[];
  onSelectMethod: (method: DepositMethod, e?: React.MouseEvent) => void;
}

export function MethodSelection({
  isConnected,
  address,
  walletTokens,
  onSelectMethod,
}: MethodSelectionProps) {
  return (
    <motion.div
      key="method"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-2"
    >
      {/* Wallet Option */}
      <button
        type="button"
        onClick={(e) => onSelectMethod("wallet", e)}
        disabled={!isConnected}
        className="w-full p-4 rounded-xl bg-gray-100 dark:bg-card hover:bg-gray-200 dark:hover:bg-accent border border-gray-200 dark:border-border transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <span className="text-xl">🦊</span>
            </div>
            <div className="text-left">
              <p className="font-medium text-foreground">
                Wallet ({address ? formatAddress(address) : "Not connected"})
              </p>
              <p className="text-sm text-muted-foreground">
                {walletTokens.length > 0
                  ? `$${walletTokens
                      .reduce((s, t) => s + t.usdValue, 0)
                      .toFixed(2)}`
                  : "Connect wallet"}{" "}
                • Instant
              </p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 py-2">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground/70">more</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Transfer Crypto (Bridge) */}
      <button
        type="button"
        onClick={(e) => onSelectMethod("bridge", e)}
        className="w-full p-4 rounded-xl bg-gray-100 dark:bg-card hover:bg-gray-200 dark:hover:bg-accent border border-gray-200 dark:border-border transition-all group"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Zap className="h-5 w-5 text-blue-400" />
            </div>
            <div className="text-left">
              <p className="font-medium text-foreground">Transfer Crypto</p>
              <p className="text-sm text-muted-foreground">
                No limit • Instant
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1">
              {["⟠", "⬡", "🔷", "🔵"].map((icon, i) => (
                <span
                  key={i}
                  className="w-5 h-5 rounded-full bg-gray-200 dark:bg-muted flex items-center justify-center text-xs border border-gray-300 dark:border-border"
                >
                  {icon}
                </span>
              ))}
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
        </div>
      </button>

      {/* Card - Coming Soon */}
      <button
        type="button"
        disabled
        className="w-full p-4 rounded-xl bg-gray-100 dark:bg-card border border-gray-200 dark:border-border opacity-60 cursor-not-allowed"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-muted/50 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-left">
              <p className="font-medium text-foreground">Deposit with Card</p>
              <p className="text-sm text-muted-foreground">$50,000 • 5 min</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-200 dark:bg-muted text-muted-foreground">
            Coming Soon
          </span>
        </div>
      </button>

      {/* Exchange - Coming Soon */}
      <button
        type="button"
        disabled
        className="w-full p-4 rounded-xl bg-gray-100 dark:bg-card border border-gray-200 dark:border-border opacity-60 cursor-not-allowed"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-muted/50 flex items-center justify-center">
              <RefreshCw className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-left">
              <p className="font-medium text-foreground">Connect Exchange</p>
              <p className="text-sm text-muted-foreground">No limit • 2 min</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-200 dark:bg-muted text-muted-foreground">
            Coming Soon
          </span>
        </div>
      </button>

      {/* PayPal - Coming Soon */}
      <button
        type="button"
        disabled
        className="w-full p-4 rounded-xl bg-gray-100 dark:bg-card border border-gray-200 dark:border-border opacity-60 cursor-not-allowed"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
              <span className="text-lg font-bold text-blue-400">P</span>
            </div>
            <div className="text-left">
              <p className="font-medium text-foreground">Deposit with PayPal</p>
              <p className="text-sm text-muted-foreground">$10,000 • 5 min</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-200 dark:bg-muted text-muted-foreground">
            Coming Soon
          </span>
        </div>
      </button>
    </motion.div>
  );
}
