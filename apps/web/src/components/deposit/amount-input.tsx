import { motion } from "framer-motion";
import { ArrowRight, Info } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { TokenBalance } from "@/hooks/use-wallet-tokens";

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
      className="space-y-6"
    >
      {/* Amount Display */}
      <div className="text-center py-8">
        <div className="flex items-center justify-center gap-2">
          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center overflow-hidden">
            <Image
              src="/usdc-token.webp"
              alt="USDC"
              width={40}
              height={40}
              className="w-full h-full object-cover"
            />
          </div>
          <input
            type="text"
            value={amount}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9.]/g, "");
              onAmountChange(val);
            }}
            placeholder="0.00"
            className="text-5xl font-bold text-primary bg-transparent border-none outline-none w-48 text-center placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      {/* Percentage Buttons */}
      <div className="flex justify-center gap-2">
        {[25, 50, 75, 100].map((percent) => (
          <button
            key={percent}
            type="button"
            onClick={() => onPercentage(percent)}
            className="px-4 py-2 rounded-full bg-gray-100 dark:bg-card hover:bg-gray-200 dark:hover:bg-accent text-sm font-medium text-foreground border border-gray-200 dark:border-border transition-colors"
          >
            {percent === 100 ? "Max" : `${percent}%`}
          </button>
        ))}
      </div>

      {/* Token Info */}
      <div className="flex items-center justify-center gap-2 p-3 rounded-xl bg-gray-100 dark:bg-card border border-gray-200 dark:border-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-muted flex items-center justify-center overflow-hidden">
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
              <span className="text-xs">
                {selectedToken.symbol.slice(0, 2)}
              </span>
            )}
          </div>
          <span className="text-sm text-muted-foreground">You send</span>
          <span className="font-medium text-foreground">
            {selectedToken.symbol}
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/70" />
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center overflow-hidden">
            <Image
              src="/usdc-token.webp"
              alt="USDC"
              width={24}
              height={24}
              className="w-full h-full object-cover"
            />
          </div>
          <span className="text-sm text-muted-foreground">You receive</span>
          <span className="font-medium text-foreground">USDC.e</span>
        </div>
      </div>

      {/* Minimum Deposit Warning */}
      {isBelowMinimum && amount && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-sm text-amber-400">
              Minimum deposit is{" "}
              <span className="font-semibold">${selectedTokenMinDeposit}</span>.
              You entered{" "}
              <span className="font-semibold">
                ${enteredAmountUsd.toFixed(2)}
              </span>
              .
            </p>
          </div>
        </div>
      )}

      {/* Continue Button */}
      <Button
        onClick={onContinue}
        disabled={!isValidAmount}
        className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isBelowMinimum
          ? `Min. $${selectedTokenMinDeposit} required`
          : "Continue"}
      </Button>
    </motion.div>
  );
}
