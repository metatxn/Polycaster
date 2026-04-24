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
      {/* Amount Display — Fraunces italic tabular-nums */}
      <div className="flex flex-col items-center py-8 border-y border-border/40">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
          You Deposit
        </span>
        <div className="flex items-baseline gap-1">
          <span className="font-editorial italic text-5xl leading-none text-muted-foreground">
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
            className="font-editorial italic text-5xl leading-none text-foreground bg-transparent border-none outline-none w-44 text-center tabular-nums placeholder:text-muted-foreground/40"
          />
        </div>
      </div>

      {/* Percent strip — underline-active pattern */}
      <div className="flex items-center justify-center gap-6 sm:gap-8 py-4">
        {PERCENTAGES.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onPercentage(p.value)}
            className="font-mono text-[11px] uppercase tracking-[0.14em] leading-none text-muted-foreground hover:text-foreground transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Token pair — hairline row */}
      <div className="flex items-center justify-between gap-4 py-4 border-y border-border/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {selectedToken.logoUrl ? (
              <Image
                src={selectedToken.logoUrl}
                alt={selectedToken.symbol}
                width={24}
                height={24}
                className="w-full h-full object-cover"
                unoptimized
              />
            ) : (
              <span className="font-mono text-[9px] uppercase text-foreground/80">
                {selectedToken.symbol.slice(0, 2)}
              </span>
            )}
          </div>
          <div className="flex flex-col min-w-0 gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              You Send
            </span>
            <span className="text-sm font-medium leading-none text-foreground truncate">
              {selectedToken.symbol}
            </span>
          </div>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
            <Image
              src="/usdc-token.webp"
              alt="pUSD"
              width={24}
              height={24}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex flex-col min-w-0 gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              You Receive
            </span>
            <span className="text-sm font-medium leading-none text-foreground">
              pUSD
            </span>
          </div>
        </div>
      </div>

      {/* Minimum warning — hairline border-l accent instead of rounded panel */}
      {isBelowMinimum && amount && (
        <div className="border-l-2 border-amber-500 pl-3 py-2 mt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-500 mb-1">
            Below Minimum
          </p>
          <p className="text-sm text-foreground leading-snug">
            Minimum deposit is{" "}
            <span className="tabular-nums">${selectedTokenMinDeposit}</span>.
            You entered{" "}
            <span className="tabular-nums">${enteredAmountUsd.toFixed(2)}</span>
            .
          </p>
        </div>
      )}

      {/* Continue — squared decisive action */}
      <button
        type="button"
        onClick={onContinue}
        disabled={!isValidAmount}
        className={cn(
          "mt-6 w-full h-12 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
          isValidAmount
            ? "bg-foreground text-background hover:bg-foreground/90"
            : "bg-muted text-muted-foreground cursor-not-allowed"
        )}
      >
        {isBelowMinimum
          ? `Min · $${selectedTokenMinDeposit} Required`
          : "Continue"}
      </button>
    </motion.div>
  );
}
