import { m } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
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
  detail: ReactNode;
  comingSoon?: boolean;
  disabled?: boolean;
  recommended?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * Detail-segment helper. The metadata strip mixes three flavors:
 *
 *  - `up` (green): the unambiguously good signal — Instant, free
 *  - `accent` (blue): a capability statement — No limit, All chains
 *  - default (ink-3): neutral constraint — duration, ceiling
 *
 * Color belongs on the *signal* tokens, not the method name.
 */
function Seg({
  tone,
  children,
}: {
  tone?: "up" | "accent";
  children: ReactNode;
}) {
  const color =
    tone === "up"
      ? "text-(--kwm-up)"
      : tone === "accent"
        ? "text-(--kwm-accent)"
        : "text-(--kwm-ink-3)";
  return <span className={color}>{children}</span>;
}

function Sep() {
  return <span className="text-(--kwm-ink-dim) mx-1.5">·</span>;
}

function MethodRow({
  index,
  label,
  detail,
  comingSoon,
  disabled,
  recommended,
  onClick,
}: MethodRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || comingSoon}
      className={cn(
        "group relative w-full flex items-center justify-between gap-4 px-3.5 py-3 border rounded-md text-left transition-colors overflow-hidden",
        disabled || comingSoon
          ? "border-(--kwm-hl) cursor-not-allowed opacity-50"
          : recommended
            ? "border-(--kwm-up-border) bg-(--kwm-up-soft) hover:bg-(--kwm-up-soft) hover:border-(--kwm-up)"
            : "border-(--kwm-hl) hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-2)"
      )}
    >
      {recommended && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-(--kwm-up)"
        />
      )}
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-dim) tabular-nums shrink-0">
          {index}
        </span>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[14px] font-medium leading-snug text-(--kwm-ink) truncate">
            {label}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] truncate">
            {detail}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {comingSoon ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-(--kwm-warn) border border-(--kwm-warn-border) bg-(--kwm-warn-soft) rounded-sm px-1.5 py-0.5">
            Soon
          </span>
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-(--kwm-ink-3) group-hover:text-(--kwm-ink) transition-colors" />
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

  return (
    <m.div
      key="method"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col gap-2"
    >
      <MethodRow
        index="01"
        label={walletLabel}
        detail={
          isConnected ? (
            <>
              <Seg tone="accent">${walletUsd.toFixed(2)}</Seg>
              <Sep />
              <Seg tone="up">Instant</Seg>
            </>
          ) : (
            <>
              <Seg>Not connected</Seg>
              <Sep />
              <Seg tone="up">Instant</Seg>
            </>
          )
        }
        disabled={!isConnected}
        recommended={isConnected}
        onClick={(e) => onSelectMethod("wallet", e)}
      />
      <MethodRow
        index="02"
        label="Transfer Crypto"
        detail={
          <>
            <Seg tone="accent">No limit</Seg>
            <Sep />
            <Seg tone="up">Instant</Seg>
            <Sep />
            <Seg tone="accent">All chains</Seg>
          </>
        }
        onClick={(e) => onSelectMethod("bridge", e)}
      />
      <MethodRow
        index="03"
        label="Deposit with Card"
        detail={
          <>
            <Seg>Up to $50,000</Seg>
            <Sep />
            <Seg>~5 min</Seg>
          </>
        }
        comingSoon
      />
      <MethodRow
        index="04"
        label="Connect Exchange"
        detail={
          <>
            <Seg tone="accent">No limit</Seg>
            <Sep />
            <Seg>~2 min</Seg>
          </>
        }
        comingSoon
      />
      <MethodRow
        index="05"
        label="Deposit with PayPal"
        detail={
          <>
            <Seg>Up to $10,000</Seg>
            <Sep />
            <Seg>~5 min</Seg>
          </>
        }
        comingSoon
      />
    </m.div>
  );
}
