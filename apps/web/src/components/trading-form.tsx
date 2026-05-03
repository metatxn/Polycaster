"use client";

import { formatTradingFormError } from "@knoww/shared-types/trading-errors";
import { useAppKit } from "@reown/appkit/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Loader2,
  Merge,
  MoreHorizontal,
  Split,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wifi,
} from "lucide-react";
import Image from "next/image";
import posthog from "posthog-js";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DepositModal } from "@/components/deposit-modal";
import { useOnboarding } from "@/context/onboarding-context";
import { formatSlippageDisplay } from "@/lib/slippage";
import { AllowanceWarning } from "./trading/allowance-warning";
import { BalanceWarning } from "./trading/balance-warning";
// Sub-components
import { BuySellToggle } from "./trading/buy-sell-toggle";
import { useTradingFormState } from "./trading/hooks/use-trading-form-state";
import { LimitExpiration } from "./trading/limit-expiration";
import { MergeSharesModal } from "./trading/merge-shares-modal";
import { OrderSummary } from "./trading/order-summary";
import { OrderTypeToggle } from "./trading/order-type-toggle";
import { OutcomeSelector } from "./trading/outcome-selector";
import { PriceInput } from "./trading/price-input";
import { SharesInput } from "./trading/shares-input";
import { SplitSharesModal } from "./trading/split-shares-modal";
// Types & Hooks
import type { TradingFormProps } from "./trading/types";

/**
 * TradingForm Component (Refactored)
 *
 * A comprehensive trading form for placing limit and market orders
 * on Polymarket prediction markets.
 */
export function TradingForm(props: TradingFormProps) {
  const {
    marketTitle,
    outcomes,
    selectedOutcomeIndex,
    onOutcomeChange,
    marketImage,
    yesProbability,
    isLiveData = false,
    maxSlippagePercent = 2,
    conditionId,
    disableSticky = false,
  } = props;

  const { open } = useAppKit();
  const { setShowOnboarding } = useOnboarding();
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close more menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node)
      ) {
        setShowMoreMenu(false);
      }
    }
    if (showMoreMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMoreMenu]);

  // Centralized form state and logic
  const {
    side,
    setSide,
    orderType,
    setOrderType,
    limitPrice,
    setLimitPrice,
    shares,
    setShares,
    allowPartialFill,
    setAllowPartialFill,
    expirationType,
    setExpirationType,
    expirationTime,
    setExpirationTime,
    tickSize,
    isLoading,
    operationStep,
    error,
    calculations,
    slippageResult,
    effectiveBalance,
    hasInsufficientBalance,
    hasInsufficientAllowance,
    hasNoAllowance,
    hasMissingTradingApprovals,
    isCheckingTradingApprovals,
    isBelowMarketableBuyMinNotional,
    minShares,
    maxSellShares,
    hasCredentials,
    isConnected,
    handleSetAllowance,
    handleSharesChange,
    handleSubmit,
    hasValidTokenId,
    canFullyFill,
  } = useTradingFormState(props);

  const selectedOutcome = outcomes[selectedOutcomeIndex];

  // Slippage UI calculation
  const slippageDisplay = slippageResult
    ? formatSlippageDisplay(slippageResult, side)
    : null;
  const slippageExceedsMax = slippageResult
    ? slippageResult.slippagePercent > maxSlippagePercent
    : false;
  const formatCents = (price: number) => `${(price * 100).toFixed(1)}¢`;

  // LIMIT orders enforce min_order_size on both sides; MARKET sells can fill smaller.
  const belowLimitMin = orderType === "LIMIT" && shares < minShares;
  const needsApproval =
    (hasMissingTradingApprovals ||
      (side === "BUY" && (hasNoAllowance || hasInsufficientAllowance))) &&
    !hasInsufficientBalance;

  return (
    <div className={disableSticky ? "w-full" : "sticky top-4 w-full"}>
      <div className="border border-border/60 bg-card overflow-hidden">
        {/* Market Header */}
        <div className="flex items-center gap-3 p-4 border-b border-border">
          {marketImage && (
            <div className="relative w-10 h-10 shrink-0">
              <Image
                src={marketImage}
                alt={marketTitle || "Market"}
                fill
                sizes="40px"
                className="rounded-sm object-cover"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm truncate">{marketTitle}</h3>
              {isLiveData && (
                <div className="flex items-center gap-1">
                  <Wifi className="h-3 w-3 text-emerald-500" />
                  <span className="text-[10px] text-emerald-500">Live</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {props.negRisk && (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] border border-red-500/50 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-sm">
                  Neg Risk
                </span>
              )}
              <span className="text-xs text-emerald-500 font-medium">
                {yesProbability != null
                  ? `${yesProbability}% Yes`
                  : `${Math.round((selectedOutcome?.price ?? 0) * 100)}% ${selectedOutcome?.name || "Yes"}`}
              </span>
            </div>
          </div>
        </div>

        {/* Form Controls */}
        <div className="p-4 space-y-3">
          {/* Order Type Toggle with More Menu */}
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <OrderTypeToggle orderType={orderType} onChange={setOrderType} />
            </div>
            {/* More Menu — Split/Merge require a conditionId */}
            {hasCredentials && conditionId && (
              <div className="relative shrink-0" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className={`w-10 h-10 transition-colors flex items-center justify-center border-b ${
                    showMoreMenu
                      ? "border-b-foreground text-foreground"
                      : "border-b-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  title="More options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {/* Dropdown Menu */}
                <AnimatePresence>
                  {showMoreMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-2 z-50 min-w-[140px] bg-card border border-border/60 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setShowSplitModal(true);
                          setShowMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                      >
                        <Split className="h-4 w-4 text-muted-foreground" />
                        Split
                      </button>
                      <div className="h-px bg-border" />
                      <button
                        type="button"
                        onClick={() => {
                          setShowMergeModal(true);
                          setShowMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                      >
                        <Merge className="h-4 w-4 text-muted-foreground" />
                        Merge
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          <BuySellToggle side={side} onChange={setSide} />

          <OutcomeSelector
            outcomes={outcomes}
            selectedOutcomeIndex={selectedOutcomeIndex}
            onOutcomeChange={onOutcomeChange}
          />

          {/* Price Input - Only for limit orders */}
          {orderType === "LIMIT" && (
            <>
              <PriceInput
                price={limitPrice}
                onPriceChange={setLimitPrice}
                tickSize={tickSize}
                bestBid={props.bestBid}
                bestAsk={props.bestAsk}
                side={side}
              />
              <LimitExpiration
                expirationType={expirationType}
                onExpirationTypeChange={setExpirationType}
                expirationTime={expirationTime}
                onExpirationTimeChange={setExpirationTime}
              />
            </>
          )}

          {/* Execution Info - Only for market orders */}
          {orderType === "MARKET" && (
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
              <span>Avg. Price</span>
              <span className="font-mono font-medium text-foreground">
                {slippageDisplay?.avgPrice || formatCents(calculations.price)}
              </span>
              <span>Slippage</span>
              <span
                className={`font-mono font-medium ${
                  slippageExceedsMax ? "text-amber-500" : "text-foreground"
                }`}
              >
                {slippageDisplay?.slippagePercent || "0.00%"}
              </span>
            </div>
          )}

          <SharesInput
            shares={shares}
            onSharesChange={setShares}
            onIncrement={handleSharesChange}
            minShares={minShares}
            effectiveBalance={effectiveBalance}
            price={calculations.price}
            side={side}
            orderType={orderType}
            maxSellShares={maxSellShares}
          />

          {/* Partial Fill Toggle - Only for market orders */}
          {orderType === "MARKET" && (
            <div className="p-3 bg-secondary/30 border border-border/50">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 pr-3">
                  <span className="text-sm font-medium text-foreground">
                    Allow partial fill
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {allowPartialFill
                      ? "Fills available shares, cancels rest (FAK)"
                      : "Must fill entirely or cancel (FOK)"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowPartialFill(!allowPartialFill)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    allowPartialFill ? "bg-emerald-500" : "bg-muted"
                  }`}
                  role="switch"
                  aria-checked={allowPartialFill}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition duration-200 ${
                      allowPartialFill ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          <OrderSummary
            totalCost={calculations.total}
            potentialWin={calculations.potentialWin}
            profitPercent={calculations.returnPercent}
            selectedOutcomeName={selectedOutcome?.name}
            isBelowMinNotional={isBelowMarketableBuyMinNotional}
            side={side}
          />

          {/* Conditional UI Sections */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="flex items-start gap-2.5 p-3 bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <span className="text-sm text-destructive leading-snug wrap-break-word">
                    {formatTradingFormError(error.message)}
                  </span>
                </div>
              </motion.div>
            )}

            {side === "SELL" && maxSellShares <= 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="text-sm text-amber-600 dark:text-amber-400">
                    You don't have any {selectedOutcome?.name || "shares"} to
                    sell
                  </span>
                </div>
              </motion.div>
            )}

            {belowLimitMin && shares > 0 && !error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="flex items-start gap-2.5 p-3 bg-amber-500/10 border border-amber-500/20">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-amber-600 dark:text-amber-400 leading-snug">
                    Limit orders require a minimum of {minShares} share
                    {minShares === 1 ? "" : "s"}.
                  </span>
                </div>
              </motion.div>
            )}

            {hasInsufficientBalance && side === "BUY" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <BalanceWarning
                  totalCost={calculations.total}
                  effectiveBalance={effectiveBalance}
                  onDeposit={() => setShowDepositModal(true)}
                />
              </motion.div>
            )}

            {needsApproval && !hasInsufficientBalance && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <AllowanceWarning
                  totalCost={calculations.total}
                  hasNoAllowance={hasNoAllowance || hasMissingTradingApprovals}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit Action */}
          <div className="pt-1">
            {!isConnected ? (
              <button
                type="button"
                className="w-full h-11 bg-foreground hover:bg-foreground/90 text-background font-mono text-[11px] uppercase tracking-[0.18em] font-semibold transition-colors flex items-center justify-center gap-2"
                onClick={() => open()}
              >
                <Wallet className="h-4 w-4" />
                Connect Wallet to Trade
              </button>
            ) : !hasCredentials ? (
              <button
                type="button"
                className="w-full h-11 bg-foreground hover:bg-foreground/90 text-background font-mono text-[11px] uppercase tracking-[0.18em] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                onClick={() => setShowOnboarding(true)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <Wallet className="h-4 w-4" />
                    Setup Trading Account
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className={`w-full h-11 font-mono text-[11px] uppercase tracking-[0.18em] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  (side === "BUY" && hasInsufficientBalance) ||
                  (side === "SELL" && maxSellShares <= 0) ||
                  isCheckingTradingApprovals ||
                  belowLimitMin
                    ? "bg-muted text-muted-foreground"
                    : needsApproval
                      ? "bg-zinc-800 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100"
                      : side === "BUY"
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                        : "bg-red-600 hover:bg-red-700 text-white"
                }`}
                onClick={async () => {
                  if (needsApproval) {
                    const approved = await handleSetAllowance();
                    if (approved) {
                      toast.success("Approval confirmed", {
                        description: "You can place the order now.",
                      });
                    }
                    return;
                  }

                  const submittedShares = shares;
                  const submittedSide = side;
                  const submittedOrderType = orderType;
                  const submittedOutcome = selectedOutcome?.name;
                  const submittedPrice =
                    orderType === "LIMIT" ? limitPrice : calculations.price;

                  const success = await handleSubmit();
                  if (success) {
                    posthog.capture("order_submitted", {
                      market_title: marketTitle,
                      side: submittedSide,
                      order_type: submittedOrderType,
                      shares: submittedShares,
                      outcome_name: submittedOutcome,
                      total_cost: calculations.total,
                      potential_win: calculations.potentialWin,
                    });

                    const outcomeLabel = submittedOutcome ?? "shares";
                    if (submittedOrderType === "LIMIT") {
                      const intent = submittedSide === "BUY" ? "buy" : "sell";
                      toast.success("Limit order placed", {
                        description: `Resting on the book to ${intent} ${submittedShares} ${outcomeLabel} at ${formatCents(submittedPrice)}.`,
                      });
                    } else {
                      const verb = submittedSide === "BUY" ? "Bought" : "Sold";
                      toast.success("Order filled", {
                        description: `${verb} ${submittedShares} ${outcomeLabel} at market.`,
                      });
                    }
                  }
                  // Failures: inline error banner (already friendly-formatted)
                  // surfaces them; the clob `error` state is set asynchronously
                  // inside the hook, so reading it here would be stale.
                }}
                disabled={
                  isLoading ||
                  isCheckingTradingApprovals ||
                  (side === "BUY" && hasInsufficientBalance) ||
                  (side === "SELL" && maxSellShares <= 0) ||
                  (side === "SELL" && shares > maxSellShares) ||
                  (side === "SELL" && shares <= 0) ||
                  belowLimitMin ||
                  (side === "BUY" && isBelowMarketableBuyMinNotional) ||
                  !selectedOutcome ||
                  !hasValidTokenId ||
                  (orderType === "MARKET" && !canFullyFill)
                }
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {operationStep === "approving"
                      ? "Approving..."
                      : "Placing Order..."}
                  </>
                ) : !hasValidTokenId ? (
                  "Trading not available"
                ) : orderType === "MARKET" && !canFullyFill ? (
                  "Insufficient liquidity"
                ) : side === "SELL" && maxSellShares <= 0 ? (
                  "No position to sell"
                ) : side === "SELL" && shares > maxSellShares ? (
                  `Max ${maxSellShares.toFixed(1)} shares`
                ) : side === "BUY" && hasInsufficientBalance ? (
                  "Insufficient Balance"
                ) : belowLimitMin ? (
                  `Minimum shares: ${minShares}`
                ) : side === "BUY" && isBelowMarketableBuyMinNotional ? (
                  "Minimum order: $1"
                ) : needsApproval ? (
                  "Approve"
                ) : (
                  <>
                    {side === "BUY" ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : (
                      <TrendingDown className="h-4 w-4" />
                    )}
                    {side === "BUY" ? "Buy" : "Sell"} {shares} @{" "}
                    {orderType === "LIMIT"
                      ? `${(limitPrice * 100).toFixed(1)}¢`
                      : "Market"}
                  </>
                )}
              </button>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            By placing an order, you agree to the terms of service.
          </p>
        </div>
      </div>

      <DepositModal
        open={showDepositModal}
        onOpenChange={setShowDepositModal}
      />

      {/* Split Shares Modal */}
      {conditionId && (
        <SplitSharesModal
          open={showSplitModal}
          onOpenChange={setShowSplitModal}
          conditionId={conditionId}
          marketTitle={marketTitle}
          negRisk={props.negRisk}
        />
      )}

      {/* Merge Shares Modal */}
      {conditionId && (
        <MergeSharesModal
          open={showMergeModal}
          onOpenChange={setShowMergeModal}
          conditionId={conditionId}
          yesTokenId={outcomes[0]?.tokenId || ""}
          noTokenId={outcomes[1]?.tokenId || ""}
          marketTitle={marketTitle}
          negRisk={props.negRisk}
        />
      )}
    </div>
  );
}
