import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { TokenBalance } from "@/hooks/use-wallet-tokens";
import { formatAddress } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { DepositMethod } from "./types";

interface MethodSelectionProps {
  isConnected: boolean;
  address?: string;
  walletTokens: TokenBalance[];
  onSelectMethod: (method: DepositMethod, e?: React.MouseEvent) => void;
}

interface MethodRowProps {
  index: string;
  label: string;
  detail: string;
  comingSoon?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

function MethodRow({
  index,
  label,
  detail,
  comingSoon,
  disabled,
  onClick,
}: MethodRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || comingSoon}
      className={cn(
        "group w-full flex items-baseline justify-between gap-4 py-4 border-b border-border/40 text-left transition-colors",
        disabled || comingSoon
          ? "cursor-not-allowed opacity-50"
          : "hover:border-foreground/60"
      )}
    >
      <div className="flex items-baseline gap-4 min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums shrink-0 pt-[3px]">
          {index}
        </span>
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[15px] font-medium leading-none text-foreground truncate">
            {label}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground truncate">
            {detail}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {comingSoon ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Coming Soon
          </span>
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        )}
      </div>
    </button>
  );
}

export function MethodSelection({
  isConnected,
  address,
  walletTokens,
  onSelectMethod,
}: MethodSelectionProps) {
  const walletUsd = walletTokens.reduce((s, t) => s + t.usdValue, 0);
  const walletLabel = address
    ? `Wallet · ${formatAddress(address)}`
    : "Connect wallet";
  const walletDetail = isConnected
    ? `$${walletUsd.toFixed(2)} · Instant`
    : "Not connected · Instant";

  return (
    <motion.div
      key="method"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="border-t border-border/40"
    >
      <MethodRow
        index="01"
        label={walletLabel}
        detail={walletDetail}
        disabled={!isConnected}
        onClick={(e) => onSelectMethod("wallet", e)}
      />
      <MethodRow
        index="02"
        label="Transfer Crypto"
        detail="No limit · Instant · All chains"
        onClick={(e) => onSelectMethod("bridge", e)}
      />
      <MethodRow
        index="03"
        label="Deposit with Card"
        detail="Up to $50,000 · ~5 min"
        comingSoon
      />
      <MethodRow
        index="04"
        label="Connect Exchange"
        detail="No limit · ~2 min"
        comingSoon
      />
      <MethodRow
        index="05"
        label="Deposit with PayPal"
        detail="Up to $10,000 · ~5 min"
        comingSoon
      />
    </motion.div>
  );
}
