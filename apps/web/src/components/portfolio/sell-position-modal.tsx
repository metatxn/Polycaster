"use client";

import { createLogger } from "@knoww/logger";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Loader2,
  Minus,
  Plus,
  TrendingDown,
} from "lucide-react";

const log = createLogger("sell-position-modal");

import Image from "next/image";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSellPosition } from "@/hooks/use-sell-position";
import { formatCurrency, formatPercent, formatPrice } from "@/lib/formatters";
import type { Position } from "./types";

interface SellPositionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
  onSellSuccess?: () => void;
}

export function SellPositionModal({
  open,
  onOpenChange,
  position,
  onSellSuccess,
}: SellPositionModalProps) {
  const router = useRouter();

  const {
    shares,
    setShares,
    isLoading,
    isSubmitting,
    error,
    canTrade,
    sellEstimate,
    handleSharesChange,
    setMaxShares,
    executeSell,
    resetShares,
  } = useSellPosition({
    position,
    onSellSuccess: (result) => {
      if (position) {
        posthog.capture("sell_position_submitted", {
          market_title: position.market.title,
          outcome: position.outcome,
          shares_sold: result.shares,
          estimated_proceeds: result.estimatedProceeds,
          estimated_price: result.estimatedPrice,
          unrealized_pnl: position.unrealizedPnl,
        });
      }
      toast.success("Sell order filled", {
        description: `Estimated proceeds: ${formatCurrency(result.estimatedProceeds)}.`,
      });
      onSellSuccess?.();
      onOpenChange(false);
    },
    onSellError: (err) => {
      log.error("sell.failed", { error: err });
    },
  });

  // Reset shares when modal opens with new position
  useEffect(() => {
    if (open && position) {
      resetShares();
    }
  }, [open, position, resetShares]);

  if (!position) return null;

  const maxShares = position.size;

  // Handle modify order - redirect to event page with pre-filled SELL
  const handleModifyOrder = () => {
    const params = new URLSearchParams({
      side: "SELL",
      shares: shares.toString(),
      outcome: position.outcome.toLowerCase(),
    });
    // Add conditionId to select the correct market on the event page
    if (position.conditionId) {
      params.set("conditionId", position.conditionId);
    }
    // `scroll: false` keeps the current scroll position. Without it, Next.js
    // resets scroll to 0 on the param change; then the dialog's focus
    // restoration to the off-screen Sell Position button triggers a smooth
    // scrollIntoView — so the page jumps up and then animates back down,
    // which reads as "the trading panel moved".
    router.push(
      `/events/detail/${position.market.eventSlug}?${params.toString()}`,
      { scroll: false }
    );
    onOpenChange(false);
  };

  // Handle quick sell
  const handleQuickSell = async () => {
    await executeSell();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />
            Sell Position
          </DialogTitle>
          <DialogDescription className="sr-only">
            Sell shares from this position using a market order or modify the
            order details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Market Info */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border">
            <div className="relative w-12 h-12 rounded-full overflow-hidden bg-muted shrink-0">
              {position.market.icon ? (
                <Image
                  src={position.market.icon}
                  alt={position.market.title}
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <BarChart3 className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm line-clamp-2 leading-tight">
                {position.market.title}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    position.outcome === "Yes"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-red-500/15 text-red-700 dark:text-red-300"
                  }`}
                >
                  {position.outcome}
                </span>
              </div>
            </div>
          </div>

          {/* Position Details */}
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/50 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Your Position
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">
                  Shares
                </p>
                <p className="font-semibold">{position.size.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase">
                  Avg Price
                </p>
                <p className="font-semibold">
                  {formatPrice(position.avgPrice)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">
                  Current Price
                </p>
                <p
                  className={`font-semibold ${
                    position.currentPrice > position.avgPrice
                      ? "text-emerald-600 dark:text-emerald-400"
                      : position.currentPrice < position.avgPrice
                        ? "text-red-600 dark:text-red-400"
                        : ""
                  }`}
                >
                  {formatPrice(position.currentPrice)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase">
                  Value
                </p>
                <p className="font-semibold">
                  {formatCurrency(position.currentValue)}
                </p>
              </div>
            </div>
            <div className="pt-2 border-t border-border/50">
              <div className="flex justify-between items-center">
                <p className="text-[10px] text-muted-foreground uppercase">
                  Unrealized P&L
                </p>
                <p
                  className={`font-semibold ${
                    position.unrealizedPnl >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatCurrency(position.unrealizedPnl)} (
                  {formatPercent(position.unrealizedPnlPercent)})
                </p>
              </div>
            </div>
          </div>

          {/* Shares to Sell */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Shares to Sell</label>
              <button
                type="button"
                onClick={setMaxShares}
                className="text-xs text-primary hover:underline"
              >
                Max
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => handleSharesChange(-10)}
                disabled={shares <= 1}
              >
                <span className="text-xs font-medium">-10</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => handleSharesChange(-1)}
                disabled={shares <= 1}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <input
                type="number"
                value={shares}
                onChange={(e) => {
                  const val = Number.parseFloat(e.target.value) || 0;
                  setShares(Math.max(1, Math.min(maxShares, val)));
                }}
                className="flex-1 h-10 text-center font-mono text-lg font-semibold bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                min={1}
                max={maxShares}
                step={0.01}
              />
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => handleSharesChange(1)}
                disabled={shares >= maxShares}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => handleSharesChange(10)}
                disabled={shares >= maxShares}
              >
                <span className="text-xs font-medium">+10</span>
              </Button>
            </div>
          </div>

          {/* Sell Estimate */}
          <div className="p-3 rounded-lg border border-border space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Est. Price</span>
              <span className="font-mono font-medium">
                {formatPrice(sellEstimate.estimatedPrice)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">You Receive</span>
              <span className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(sellEstimate.estimatedProceeds)}
              </span>
            </div>
            {sellEstimate.slippagePercent > 1 && (
              <div className="flex justify-between items-center text-amber-600 dark:text-amber-400">
                <span className="text-sm">Slippage</span>
                <span className="text-sm font-medium">
                  {sellEstimate.slippagePercent.toFixed(2)}%
                </span>
              </div>
            )}
            {!sellEstimate.canFill && shares > 0 && (
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs">
                <AlertCircle className="h-3 w-3" />
                <span>Order may not fully fill at current liquidity</span>
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-sm text-destructive">{error.message}</span>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 pt-2">
            <Button
              className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-medium"
              onClick={handleQuickSell}
              disabled={
                isSubmitting ||
                isLoading ||
                !canTrade ||
                shares <= 0 ||
                shares > maxShares
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Selling...
                </>
              ) : (
                <>
                  <TrendingDown className="mr-2 h-4 w-4" />
                  Quick Sell (Market Order)
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={handleModifyOrder}
              disabled={isSubmitting}
            >
              Modify Order
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            Quick Sell executes a market order immediately. Use Modify Order for
            limit orders or custom pricing.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
