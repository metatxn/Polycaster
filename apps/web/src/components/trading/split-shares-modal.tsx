"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowRight, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCtfOperations } from "@/hooks/use-ctf-operations";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";

interface SplitSharesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Condition ID for the market */
  conditionId: string;
  /** Market question/title for display */
  marketTitle?: string;
  /** Callback after successful split */
  onSuccess?: () => void;
}

export function SplitSharesModal({
  open,
  onOpenChange,
  conditionId,
  onSuccess,
}: SplitSharesModalProps) {
  const {
    proxyAddress,
    usdcBalance,
    refresh: refreshWallet,
  } = useProxyWallet();
  const { splitPosition, isLoading, error, txHash, reset } = useCtfOperations();

  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setAmount("");
      setLocalError(null);
      setIsSuccess(false);
      reset();
    }
  }, [open, reset]);

  // Handle successful transaction
  useEffect(() => {
    if (txHash && !error) {
      setIsSuccess(true);
      refreshWallet();
      onSuccess?.();
      // Close modal after a short delay
      const timer = setTimeout(() => {
        onOpenChange(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [txHash, error, refreshWallet, onSuccess, onOpenChange]);

  const numericAmount = useMemo(() => {
    const parsed = Number.parseFloat(amount);
    return Number.isNaN(parsed) ? 0 : parsed;
  }, [amount]);

  const isValidAmount = useMemo(() => {
    return numericAmount > 0 && numericAmount <= usdcBalance;
  }, [numericAmount, usdcBalance]);

  const handleAmountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      // Allow empty, numbers, and decimals
      if (value === "" || /^\d*\.?\d*$/.test(value)) {
        setAmount(value);
        setLocalError(null);
      }
    },
    []
  );

  const handleMaxClick = useCallback(() => {
    setAmount(usdcBalance.toFixed(2));
    setLocalError(null);
  }, [usdcBalance]);

  const handleSplit = useCallback(async () => {
    if (!proxyAddress || !conditionId) {
      setLocalError("Trading wallet not available");
      return;
    }

    if (!isValidAmount) {
      setLocalError("Please enter a valid amount");
      return;
    }

    setLocalError(null);
    const result = await splitPosition(
      conditionId,
      numericAmount,
      proxyAddress
    );

    if (!result.success) {
      // Check for user rejection
      const errorMsg = result.error?.toLowerCase() || "";
      if (
        errorMsg.includes("user rejected") ||
        errorMsg.includes("user denied") ||
        errorMsg.includes("rejected the request")
      ) {
        setLocalError("Transaction cancelled");
      } else {
        setLocalError(result.error || "Split failed");
      }
    }
  }, [proxyAddress, conditionId, isValidAmount, numericAmount, splitPosition]);

  const displayError = localError || error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[420px] p-0 gap-0 overflow-hidden bg-background border-border"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="relative h-[68px] border-b border-border flex items-center justify-between px-4 shrink-0">
          <div className="w-8" />
          <div className="flex flex-col items-center justify-center flex-1 min-w-0">
            <DialogTitle className="text-[17px] font-semibold text-foreground tracking-tight">
              Split shares
            </DialogTitle>
          </div>
          <div className="w-8 flex items-center justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="p-1.5 -mr-1.5 rounded-full hover:bg-secondary/80 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <DialogDescription className="text-sm text-muted-foreground">
            Split a USDC into a share of Yes and No. You can do this to save
            cost by getting both and just selling the other side.
          </DialogDescription>

          {/* Amount Input */}
          <div className="space-y-2">
            <label
              htmlFor="split-amount"
              className="text-sm font-medium text-foreground"
            >
              Amount
            </label>
            <div className="relative">
              <input
                id="split-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={handleAmountChange}
                placeholder="0"
                disabled={isLoading || isSuccess}
                className="w-full h-12 px-4 bg-secondary/50 border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Available: ${usdcBalance.toFixed(2)} USDC
              </span>
              <button
                type="button"
                onClick={handleMaxClick}
                disabled={isLoading || isSuccess}
                className="text-primary hover:text-primary/80 font-medium disabled:opacity-50"
              >
                Max
              </button>
            </div>
          </div>

          {/* Preview */}
          <AnimatePresence>
            {numericAmount > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="p-3 bg-secondary/30 rounded-lg border border-border"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">You spend</span>
                    <span className="text-foreground font-medium">
                      ${numericAmount.toFixed(2)} USDC
                    </span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">You receive</span>
                    <span className="text-emerald-500 font-medium">
                      {numericAmount.toFixed(2)} Yes
                    </span>
                    <span className="text-muted-foreground">+</span>
                    <span className="text-red-500 font-medium">
                      {numericAmount.toFixed(2)} No
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Message */}
          <AnimatePresence>
            {displayError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
              >
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                <span className="text-sm text-destructive">{displayError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Success Message */}
          <AnimatePresence>
            {isSuccess && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg"
              >
                <span className="text-sm text-emerald-500">
                  ✓ Split successful! Shares added to your portfolio.
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit Button */}
          <button
            type="button"
            onClick={handleSplit}
            disabled={isLoading || !isValidAmount || isSuccess || !proxyAddress}
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Splitting...
              </>
            ) : isSuccess ? (
              "Complete!"
            ) : (
              "Split shares"
            )}
          </button>

          {/* Info Text */}
          <p className="text-xs text-muted-foreground text-center">
            Splitting converts USDC into equal YES and NO shares. You can then
            sell one side to take a position.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
