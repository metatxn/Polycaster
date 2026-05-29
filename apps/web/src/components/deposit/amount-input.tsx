import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import type { TokenBalance } from "@/hooks/use-wallet-tokens";
import { cn } from "@/lib/utils";

interface AmountInputProps {
  amount: string;
  selectedToken: TokenBalance;
  isBelowMinimum: boolean;
  selectedTokenMinDeposit: number;
  enteredAmountUsd: number;
  isValidAmount: boolean;
  onAmountChange: (value: string) => void;
  onPercentage: (percent: number) => void;
  onContinue: () => void;
}

const PERCENTAGES: { value: number; label: string }[] = [
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 75, label: "75" },
  { value: 100, label: "Max" },
];

export function AmountInput({
  amount,
  selectedToken,
  isBelowMinimum,
  selectedTokenMinDeposit,
  enteredAmountUsd,
  isValidAmount,
  onAmountChange,
  onPercentage,
  onContinue,
}: AmountInputProps) {
  return (
    <motion.div
      key="amount"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col"
    >
      {/* Amount Display — clean Geist tabular-nums (no italic Fraunces) */}
      <div className="flex flex-col items-center py-7 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2)">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) mb-3">
          You Deposit
        </span>
        <div className="flex items-baseline gap-1">
          <span className="font-(family-name:--font-geist) text-4xl leading-none text-(--kwm-ink-3) font-medium tracking-tight">
            $
          </span>
          <input
            type="text"
            value={amount}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9.]/g, "");
              onAmountChange(val);
            }}
            placeholder="0.00"
            className="font-(family-name:--font-geist) text-4xl leading-none text-(--kwm-ink) bg-transparent border-none outline-none w-44 text-center tabular-nums placeholder:text-(--kwm-ink-dim) font-medium tracking-tight"
          />
        </div>
      </div>

      {/* Percent strip — small ghost buttons */}
      <div className="grid grid-cols-4 gap-2 mt-3">
        {PERCENTAGES.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onPercentage(p.value)}
            className="h-8 px-3 rounded-md border border-(--kwm-hl) font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-ink-3) hover:text-(--kwm-ink) hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-2) transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Token pair — bordered card */}
      <div className="flex items-center justify-between gap-4 mt-4 px-3.5 py-3 border border-(--kwm-hl) rounded-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-full bg-(--kwm-bg-3) flex items-center justify-center overflow-hidden shrink-0 border border-(--kwm-hl)">
            {selectedToken.logoUrl ? (
              <Image
                src={selectedToken.logoUrl}
                alt={selectedToken.symbol}
                width={28}
                height={28}
                className="w-full h-full object-cover"
                unoptimized
              />
            ) : (
              <span className="font-mono text-[9px] uppercase text-(--kwm-ink-2)">
                {selectedToken.symbol.slice(0, 2)}
              </span>
            )}
          </div>
          <div className="flex flex-col min-w-0 gap-0.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-(--kwm-ink-dim)">
              You Send
            </span>
            <span className="text-sm font-medium leading-snug text-(--kwm-ink) truncate">
              {selectedToken.symbol}
            </span>
          </div>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-(--kwm-ink-3) shrink-0" />
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-full bg-(--kwm-bg-3) flex items-center justify-center overflow-hidden shrink-0 border border-(--kwm-hl)">
            <Image
              src="/usdc-token.webp"
              alt="pUSD"
              width={28}
              height={28}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex flex-col min-w-0 gap-0.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-(--kwm-ink-dim)">
              You Receive
            </span>
            <span className="text-sm font-medium leading-snug text-(--kwm-ink)">
              pUSD
            </span>
          </div>
        </div>
      </div>

      {/* Minimum warning — amber `.tk-warn`-style strip */}
      {isBelowMinimum && amount && (
        <div className="mt-3 px-3 py-2 border border-(--kwm-warn-border) bg-(--kwm-warn-soft) rounded-md">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-warn) mb-1">
            Below Minimum
          </p>
          <p className="text-sm text-(--kwm-ink) leading-snug">
            Minimum deposit is{" "}
            <span className="tabular-nums font-medium">
              ${selectedTokenMinDeposit}
            </span>
            . You entered{" "}
            <span className="tabular-nums">${enteredAmountUsd.toFixed(2)}</span>
            .
          </p>
        </div>
      )}

      {/* Continue CTA — design's `.tk-cta.ready` pattern (filled ink) */}
      <button
        type="button"
        onClick={onContinue}
        disabled={!isValidAmount}
        className={cn(
          "mt-5 w-full h-11 rounded-md font-mono text-[11px] uppercase tracking-[0.18em] font-semibold transition-colors",
          isValidAmount
            ? "bg-(--kwm-ink) text-(--kwm-bg) hover:opacity-90"
            : "bg-(--kwm-bg-3) text-(--kwm-ink-dim) cursor-not-allowed border border-(--kwm-hl)"
        )}
      >
        {isBelowMinimum
          ? `Min · $${selectedTokenMinDeposit} Required`
          : "Continue"}
      </button>
    </motion.div>
  );
}
