"use client";

import { isWalletRejectionError } from "@knoww/shared-types/trading-errors";
import { AnimatePresence, m } from "framer-motion";
import { AlertCircle, ArrowRight, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { CONTRACTS, PUSD_DECIMALS } from "@/constants/contracts";
import { useCtfOperations } from "@/hooks/use-ctf-operations";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";

interface SplitSharesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Condition ID for the market */
  conditionId: string;
  /** Market question/title for display */
  marketTitle?: string;
  /** Whether this market uses the negative-risk CTF adapter */
  negRisk?: boolean;
  /** Callback after successful split */
  onSuccess?: () => void;
}

export function SplitSharesModal({
  open,
  onOpenChange,
  conditionId,
  negRisk = false,
  onSuccess,
}: SplitSharesModalProps) {
  const { proxyAddress, refresh: refreshWallet } = useProxyWallet();
  const { splitPosition, isLoading, error, txHash, reset } = useCtfOperations();

  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [pusdBalance, setPusdBalance] = useState(0);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  useEffect(() => {
    if (!open || !proxyAddress) return;

    let cancelled = false;
    setIsLoadingBalance(true);

    const fetchPusdBalance = async () => {
      const [{ createPublicClient, erc20Abi, formatUnits, http }, { polygon }] =
        await Promise.all([import("viem"), import("@/lib/chains")]);
      const { getRpcUrl } = await import("@/lib/rpc");
      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl()),
      });
      const balance = await publicClient.readContract({
        address: CONTRACTS.PUSD,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [proxyAddress as `0x${string}`],
      });
      if (!cancelled) {
        setPusdBalance(Number(formatUnits(balance, PUSD_DECIMALS)));
      }
    };

    fetchPusdBalance()
      .catch(() => {
        if (!cancelled) setPusdBalance(0);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBalance(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, proxyAddress]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setAmount("");
      setLocalError(null);
      setIsSuccess(false);
      setPusdBalance(0);
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
    return numericAmount > 0 && numericAmount <= pusdBalance;
  }, [numericAmount, pusdBalance]);

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
    setAmount(pusdBalance.toFixed(2));
    setLocalError(null);
  }, [pusdBalance]);

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
      proxyAddress,
      negRisk
    );

    if (!result.success) {
      if (isWalletRejectionError(result.error)) {
        setLocalError("Transaction cancelled");
      } else {
        setLocalError(result.error || "Split failed");
      }
    }
  }, [
    proxyAddress,
    conditionId,
    isValidAmount,
    numericAmount,
    splitPosition,
    negRisk,
  ]);

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
            Split pUSD into Yes and No shares. You can do this to save cost by
            getting both and just selling the other side.
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
                Available:{" "}
                {isLoadingBalance
                  ? "Loading..."
                  : `$${pusdBalance.toFixed(2)} pUSD`}
              </span>
              <button
                type="button"
                onClick={handleMaxClick}
                disabled={isLoading || isSuccess || isLoadingBalance}
                className="text-primary hover:text-primary/80 font-medium disabled:opacity-50"
              >
                Max
              </button>
            </div>
          </div>

          {/* Preview */}
          <AnimatePresence>
            {numericAmount > 0 && (
              <m.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="p-3 bg-secondary/30 rounded-lg border border-border"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">You spend</span>
                    <span className="text-foreground font-medium">
                      ${numericAmount.toFixed(2)} pUSD
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
              </m.div>
            )}
          </AnimatePresence>

          {/* Error Message */}
          <AnimatePresence>
            {displayError && (
              <m.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
              >
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                <span className="text-sm text-destructive">{displayError}</span>
              </m.div>
            )}
          </AnimatePresence>

          {/* Success Message */}
          <AnimatePresence>
            {isSuccess && (
              <m.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg"
              >
                <span className="text-sm text-emerald-500">
                  ✓ Split successful! Shares added to your portfolio.
                </span>
              </m.div>
            )}
          </AnimatePresence>

          {/* Submit Button */}
          <button
            type="button"
            onClick={handleSplit}
            disabled={
              isLoading ||
              isLoadingBalance ||
              !isValidAmount ||
              isSuccess ||
              !proxyAddress
            }
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
            Splitting converts pUSD into equal YES and NO shares. You can then
            sell one side to take a position.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
