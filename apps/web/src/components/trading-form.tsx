"use client";

import { formatFeeUsd } from "@knoww/shared-types/trading";
import { formatTradingFormError } from "@knoww/shared-types/trading-errors";
import Decimal from "decimal.js";
import { AnimatePresence, m } from "framer-motion";
import {
  AlertCircle,
  ArrowDownToLine,
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
import { formatCents, formatProfitLabel } from "@/lib/formatters";
import { formatSlippageDisplay } from "@/lib/slippage";
import { openWalletModal, preloadWalletModal } from "@/lib/wallet-modal";
import { useTradingFormState } from "./trading/hooks/use-trading-form-state";
import { LimitExpiration } from "./trading/limit-expiration";
import { MergeSharesModal } from "./trading/merge-shares-modal";
import { SplitSharesModal } from "./trading/split-shares-modal";
// Types & Hooks
import type { TradingFormProps } from "./trading/types";

/**
 * Limit-order queue status badge — surfaces where the chosen limit
 * price sits relative to the live best bid/ask, so users immediately
 * understand the trade-off they're making:
 *
 *   BUY:
 *     limit < bid          → "Below bid — may not fill" (muted)
 *     limit ≈ bid          → "At best bid — joins queue" (emerald)
 *     bid < limit < ask    → "Between bid & ask — improves price" (sky)
 *     limit ≥ ask          → "At or above ask — crosses & fills" (amber)
 *
 *   SELL: mirror image — `ask` is the join point, `bid` is the cross.
 *
 * Renders `null` when bid/ask aren't loaded yet so the panel doesn't
 * flash a misleading status before the order book arrives. The 0.05¢
 * tolerance for "at" matches the design's `Math.abs(limitPx - bid) < 0.05`.
 */
function LimitQueueStatusInline({
  limitPrice,
  bestBid,
  bestAsk,
  side,
  tickSize,
}: {
  /** Limit price in 0..1 units (e.g. 0.17 = 17¢). */
  limitPrice: number;
  /** Best bid in 0..1 units, undefined while the book is loading. */
  bestBid?: number | null;
  /** Best ask in 0..1 units, undefined while the book is loading. */
  bestAsk?: number | null;
  side: "BUY" | "SELL";
  /** CLOB tick size in 0..1 units (e.g. 0.001 = 0.1¢ tick). */
  tickSize?: number;
}) {
  if (
    bestBid == null ||
    bestAsk == null ||
    !Number.isFinite(bestBid) ||
    !Number.isFinite(bestAsk)
  ) {
    return null;
  }
  const TOL = 0.0005; // 0.05¢ in price units

  // Build {label, tone} based on where the limit price falls.
  // `tone` keys match the design's `.tk-limit-status.{ok|warn|info|muted}` CSS.
  let label: string;
  let tone: "muted" | "ok" | "info" | "warn";
  if (side === "BUY") {
    if (limitPrice <= bestBid - TOL) {
      label = "Below bid — may not fill";
      tone = "muted";
    } else if (Math.abs(limitPrice - bestBid) <= TOL) {
      label = "At best bid — joins queue";
      tone = "ok";
    } else if (limitPrice < bestAsk) {
      label = "Between bid & ask — improves price";
      tone = "info";
    } else {
      label = "At or above ask — crosses & fills";
      tone = "warn";
    }
  } else {
    if (limitPrice >= bestAsk + TOL) {
      label = "Above ask — may not fill";
      tone = "muted";
    } else if (Math.abs(limitPrice - bestAsk) <= TOL) {
      label = "At best ask — joins queue";
      tone = "ok";
    } else if (limitPrice > bestBid) {
      label = "Between bid & ask — improves price";
      tone = "info";
    } else {
      label = "At or below bid — crosses & fills";
      tone = "warn";
    }
  }

  // parseFloat trims trailing zeros so 0.001 → "0.1¢" while quarter-cent
  // ticks (e.g. 0.0025 on World Cup markets) still render as "0.25¢".
  const tickLabel =
    tickSize && Number.isFinite(tickSize)
      ? `${parseFloat((tickSize * 100).toFixed(2))}¢`
      : "0.1¢";

  return (
    <div role="status" className={`tk-limit-status ${tone}`}>
      <span className="dot" aria-hidden="true" />
      <span className="msg">{label}</span>
      <span className="tick">Tick {tickLabel}</span>
    </div>
  );
}

function formatUsd(amount: number): string {
  try {
    const value = new Decimal(amount);
    return value.isFinite() ? `$${value.toFixed(2)}` : "$0.00";
  } catch {
    return "$0.00";
  }
}

function formatShareQuantity(quantity: number): string {
  try {
    const value = new Decimal(quantity);
    if (!value.isFinite()) return "0";
    const rounded = value.toDecimalPlaces(4);
    return rounded.isInteger()
      ? rounded.toFixed(0)
      : rounded.toFixed().replace(/\.?0+$/, "");
  } catch {
    return "0";
  }
}

function formatMarketBuyAmountInput(amount: number): string {
  return amount > 0 ? String(amount) : "0";
}

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

  const { setShowOnboarding } = useOnboarding();
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await openWalletModal();
    } finally {
      setConnecting(false);
    }
  };

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
    marketBuyAmount,
    setMarketBuyAmount,
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
    minBuyAmount,
    estimatedFeeUsd,
    isFeeEstimateFetching,
    minShares,
    maxSellShares,
    hasCredentials,
    isConnected,
    canTrade,
    handleSetAllowance,
    handleSubmit,
    hasValidTokenId,
    canPlaceMarketOrder,
    partialFill,
    hasInsufficientLiquidity,
    isOrderBookUnavailable,
    isMarketOrderSizeEmpty,
  } = useTradingFormState(props);

  const selectedOutcome = outcomes[selectedOutcomeIndex];

  // MARKET BUY orders are denominated in dollars (the user spends $X and the
  // share count is derived from the book). MARKET SELL and LIMIT stay
  // share-based, so the shares stepper renders for those.
  const isMarketBuy = orderType === "MARKET" && side === "BUY";

  // String mirror of the numeric `marketBuyAmount` so decimals type cleanly,
  // while presets/MAX/reset still drive the canonical number in the hook. Zero
  // renders as "0" (the default empty state), not a blank field.
  const [amountText, setAmountText] = useState<string>("0");
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  useEffect(() => {
    if (!isEditingAmount) {
      setAmountText(formatMarketBuyAmountInput(marketBuyAmount));
    }
  }, [marketBuyAmount, isEditingAmount]);

  // Slippage UI calculation
  const slippageDisplay = slippageResult
    ? formatSlippageDisplay(slippageResult, side)
    : null;
  const slippageExceedsMax = slippageResult
    ? slippageResult.slippagePercent > maxSlippagePercent
    : false;

  // LIMIT orders enforce min_order_size on both sides; MARKET sells can fill smaller.
  const belowLimitMin = orderType === "LIMIT" && shares < minShares;
  const needsApproval =
    (hasMissingTradingApprovals ||
      (side === "BUY" && (hasNoAllowance || hasInsufficientAllowance))) &&
    !hasInsufficientBalance;

  // Bid/ask values in cents (0..100) — used by the limit-mode header
  // refs and the ± stepper. Falls back to the displayed price when the
  // book isn't loaded yet so the input shows something sensible.
  const bestBidCents =
    props.bestBid && Number.isFinite(props.bestBid)
      ? props.bestBid * 100
      : null;
  const bestAskCents =
    props.bestAsk && Number.isFinite(props.bestAsk)
      ? props.bestAsk * 100
      : null;
  const limitPriceCents = limitPrice * 100;
  // Cents per tick (tickSize is in 0..1 units). Falls back to a cent, matching
  // the hook's own default — assuming a 0.1¢ tick here instead would step the
  // price onto a grid a 1¢ market rejects.
  const effectiveTickSize =
    tickSize && Number.isFinite(tickSize) ? tickSize : 0.01;
  const tickCents = effectiveTickSize * 100;
  // ± stepper in tk-limit-input. `setLimitPrice` snaps the result back onto the
  // tick grid and clamps it to [tick, 1 - tick], so the cent arithmetic here
  // cannot drift off-grid or step outside the band the exchange accepts.
  const adjustLimitPrice = (deltaCents: number) => {
    setLimitPrice((limitPriceCents + deltaCents) / 100);
  };
  // `calculations.potentialWin` is already NET profit (shares − cost). The
  // gross return — what lands back if the outcome resolves in your favor —
  // is net + cost, and that's what the "Return" row should show and what
  // `formatProfitLabel` (return − cost) expects to recover the net profit.
  const grossReturn = calculations.potentialWin + calculations.total;
  const profitLabel = formatProfitLabel(grossReturn, calculations.total);
  const totalLabel = formatUsd(calculations.total);
  // For a MARKET BUY the displayed share count is the (fractional) quantity the
  // dollar budget fills, not the `shares` input. A MARKET SELL shows the walked
  // size too, so an FAK partial reads the number we actually sign rather than
  // the number the user typed.
  const displayShares =
    orderType === "MARKET" ? Math.round(calculations.size * 100) / 100 : shares;
  const shareQuantityLabel = formatShareQuantity(displayShares);
  const orderActionLabel = side === "BUY" ? "Buy" : "Sell";
  // Taker fee and the resulting debit. Rendered only when we actually know the
  // number — a failed market-fee lookup returns null, and printing "$0.00" for
  // an unknown fee would be a worse lie than printing nothing (and a total
  // built on it worse still). Orders sign without `maxSpend`, so the fee is
  // charged on top of the typed amount rather than taken out of it.
  const feeRow =
    side === "BUY" && estimatedFeeUsd !== null ? (
      <>
        <div
          className={`tk-sum-row ${isFeeEstimateFetching ? "opacity-60" : ""}`}
        >
          <span className="l">Est. fee</span>
          <span className="v tabular-nums">
            {formatFeeUsd(estimatedFeeUsd)}
          </span>
        </div>
        <div
          className={`tk-sum-row ${isFeeEstimateFetching ? "opacity-60" : ""}`}
        >
          <span className="l">Est. total</span>
          <span className="v tabular-nums">
            {formatUsd(
              new Decimal(calculations.total).plus(estimatedFeeUsd).toNumber()
            )}
          </span>
        </div>
      </>
    ) : null;

  return (
    // data-nosnippet: the trade ticket (Buy/Sell, amounts, wallet prompts) is
    // interactive UI, not descriptive content — keep it out of search snippets.
    <div
      data-nosnippet
      className={disableSticky ? "w-full" : "sticky top-4 w-full"}
    >
      <div className="kw-ticket border border-(--kwm-hl-2) bg-(--kwm-panel) rounded-md overflow-hidden">
        {/* Subject — outcome chip + name + meta */}
        <div className="px-5 pt-4">
          <div className="tk-subject">
            {marketImage ? (
              <div className="relative w-[30px] h-[30px] shrink-0 rounded-[5px] overflow-hidden border border-(--kwm-hl-2)">
                <Image
                  src={marketImage}
                  alt={marketTitle || "Market"}
                  fill
                  sizes="30px"
                  className="object-cover"
                />
              </div>
            ) : (
              <div
                className="tk-flag"
                style={{
                  ["--tk-flag-color" as string]:
                    (selectedOutcome as { color?: string })?.color ??
                    "var(--kwm-accent)",
                }}
              />
            )}
            <div className="tk-subject-info flex-1 min-w-0">
              <div className="nm truncate">{marketTitle}</div>
              <div className="meta">
                {props.negRisk && <span className="neg">Neg Risk</span>}
                <span className="pct">
                  {yesProbability != null
                    ? `${yesProbability}% Yes`
                    : `${Math.round((selectedOutcome?.price ?? 0) * 100)}% ${selectedOutcome?.name || "Yes"}`}
                </span>
                {isLiveData && (
                  <span className="inline-flex items-center gap-1">
                    <Wifi className="h-2.5 w-2.5" />
                    <span>Live price</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Form body */}
        <div className="px-5 pb-5">
          {/* Order Type Tabs — Market / Limit */}
          <div className="flex gap-2 items-stretch">
            <div className="tk-tabs flex-1 min-w-0">
              <button
                type="button"
                className={`tk-tab ${orderType === "MARKET" ? "on" : ""}`}
                onClick={() => setOrderType("MARKET")}
              >
                ◊ Market
              </button>
              <button
                type="button"
                className={`tk-tab ${orderType === "LIMIT" ? "on" : ""}`}
                onClick={() => setOrderType("LIMIT")}
              >
                ↘ Limit
              </button>
            </div>
            {/* More Menu — Split/Merge */}
            {hasCredentials && conditionId && (
              <div className="relative shrink-0 mt-3" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className={`h-[30px] w-9 transition-colors flex items-center justify-center border border-(--kwm-hl) rounded-md ${
                    showMoreMenu
                      ? "text-(--kwm-ink) bg-(--kwm-bg-3)"
                      : "text-(--kwm-ink-3) hover:text-(--kwm-ink)"
                  }`}
                  title="More options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                <AnimatePresence>
                  {showMoreMenu && (
                    <m.div
                      initial={{ opacity: 0, y: -8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-1 z-50 min-w-[140px] bg-(--kwm-panel) border border-(--kwm-hl-2) rounded-md overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setShowSplitModal(true);
                          setShowMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-(--kwm-ink) hover:bg-(--kwm-bg-3) transition-colors"
                      >
                        <Split className="h-3.5 w-3.5 text-(--kwm-ink-3)" />
                        Split
                      </button>
                      <div className="h-px bg-(--kwm-hl)" />
                      <button
                        type="button"
                        onClick={() => {
                          setShowMergeModal(true);
                          setShowMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-(--kwm-ink) hover:bg-(--kwm-bg-3) transition-colors"
                      >
                        <Merge className="h-3.5 w-3.5 text-(--kwm-ink-3)" />
                        Merge
                      </button>
                    </m.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Side — Buy / Sell */}
          <div className="tk-side">
            <button
              type="button"
              className={`buy ${side === "BUY" ? "on" : ""}`}
              onClick={() => setSide("BUY")}
            >
              ↗ Buy
            </button>
            <button
              type="button"
              className={`sell ${side === "SELL" ? "on" : ""}`}
              onClick={() => setSide("SELL")}
            >
              ↙ Sell
            </button>
          </div>

          {/* Prices — YES / NO tile pair. Acts as the outcome selector
              for binary markets — clicking YES selects outcomes[0], NO
              selects outcomes[1]. */}
          {outcomes.length >= 2 && (
            <div className="tk-prices">
              {outcomes.slice(0, 2).map((outcome, idx) => {
                const isYes = idx === 0;
                const isSelected = selectedOutcomeIndex === idx;
                const priceCents = (outcome.price ?? 0) * 100;
                const rawLabel = outcome.name?.trim();
                const normalizedLabel = rawLabel?.toLowerCase();
                const label =
                  normalizedLabel === "yes" || normalizedLabel === "no"
                    ? normalizedLabel.toUpperCase()
                    : rawLabel || (isYes ? "YES" : "NO");
                return (
                  <button
                    key={outcome.tokenId ?? idx}
                    type="button"
                    onClick={() => onOutcomeChange(idx)}
                    className={`tk-price ${isSelected ? "on" : ""} ${isYes ? "yes" : "no"}`}
                  >
                    <span className="lbl">{label}</span>
                    <span className="v tabular-nums">
                      {priceCents.toFixed(1)}
                      <span className="cent">¢</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Limit-mode block — bid/ask refs + ± stepper + queue
              status. Mirrors the design's `.tk-limit` panel. */}
          {orderType === "LIMIT" && (
            <div className="tk-limit">
              <div className="tk-limit-head">
                <span className="lbl-row">Limit Price</span>
                <span className="bidask">
                  <span className="ba">
                    <span className="ba-l">Bid</span>
                    <span className="ba-v up tabular-nums">
                      {bestBidCents != null
                        ? `${bestBidCents.toFixed(1)}¢`
                        : "—"}
                    </span>
                  </span>
                  <span className="ba">
                    <span className="ba-l">Ask</span>
                    <span className="ba-v down tabular-nums">
                      {bestAskCents != null
                        ? `${bestAskCents.toFixed(1)}¢`
                        : "—"}
                    </span>
                  </span>
                </span>
              </div>
              <div className="tk-limit-input">
                <button
                  type="button"
                  className="lim-btn"
                  aria-label="Decrement limit price"
                  onClick={() => adjustLimitPrice(-tickCents)}
                >
                  −
                </button>
                <span className="lim-val">
                  {limitPriceCents.toFixed(1)}
                  <span className="lim-unit">¢</span>
                </span>
                <button
                  type="button"
                  className="lim-btn"
                  aria-label="Increment limit price"
                  onClick={() => adjustLimitPrice(tickCents)}
                >
                  +
                </button>
              </div>
              <LimitQueueStatusInline
                limitPrice={limitPrice}
                bestBid={props.bestBid}
                bestAsk={props.bestAsk}
                side={side}
                tickSize={tickSize}
              />
              <div className="tk-expire">
                <LimitExpiration
                  expirationType={expirationType}
                  onExpirationTypeChange={setExpirationType}
                  expirationTime={expirationTime}
                  onExpirationTimeChange={setExpirationTime}
                />
              </div>
            </div>
          )}

          {/* Execution info — MARKET only. Dashed top border + mono
              micro-caps per the design's `.tk-summary-row`. */}
          {orderType === "MARKET" && (
            <div className="tk-summary-row">
              <span className="uppercase">
                Avg{" "}
                <span className="num tabular-nums">
                  {slippageDisplay?.avgPrice || formatCents(calculations.price)}
                </span>
              </span>
              <span className="uppercase">
                Slippage{" "}
                <span
                  className={`tabular-nums ${slippageExceedsMax ? "text-(--kwm-warn)" : "num"}`}
                >
                  {slippageDisplay?.slippagePercent || "0.00%"}
                </span>
              </span>
            </div>
          )}

          {/* Quantity input. MARKET BUY is dollar-denominated (spend $X →
              derive shares); MARKET SELL and LIMIT use the share stepper. */}
          {isMarketBuy ? (
            <>
              {/* Amount label + cash balance — above the input box. */}
              <div className="amt-lbl">
                <span className="cap">Amount</span>
                <span className="cash tabular-nums">
                  ${(effectiveBalance ?? 0).toFixed(2)} cash
                </span>
              </div>
              {/* Slim input box — just the typed $ value (the order cost). */}
              <div className="tk-amount">
                <span className="cur">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  name="amount"
                  className="tk-amount-input"
                  value={amountText}
                  onFocus={(e) => {
                    setIsEditingAmount(true);
                    e.target.select();
                  }}
                  onBlur={() => {
                    setIsEditingAmount(false);
                    setAmountText(formatMarketBuyAmountInput(marketBuyAmount));
                  }}
                  onChange={(e) => {
                    // Keep digits + a single decimal point.
                    const cleaned = e.target.value
                      .replace(/[^0-9.]/g, "")
                      .replace(/(\..*)\./g, "$1");
                    setIsEditingAmount(true);
                    setAmountText(cleaned);
                    const n = Number.parseFloat(cleaned);
                    setMarketBuyAmount(Number.isFinite(n) ? n : 0);
                  }}
                  aria-label="Order amount in dollars"
                />
              </div>
              {/* Quick-add chips — each adds to the current amount; Max fills
                  to the spendable balance. */}
              <div className="amt-presets">
                {[1, 5, 10, 100].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    className="amt-chip"
                    onClick={() =>
                      setMarketBuyAmount(
                        Math.round((marketBuyAmount + delta) * 100) / 100
                      )
                    }
                  >
                    +${delta}
                  </button>
                ))}
                <button
                  type="button"
                  className="amt-chip max"
                  onClick={() =>
                    setMarketBuyAmount(
                      Math.floor((effectiveBalance ?? 0) * 100) / 100
                    )
                  }
                >
                  Max
                </button>
              </div>
              {marketBuyAmount > 0 && (
                <div className="tk-amount-sub">
                  ≈ {shareQuantityLabel} shares
                </div>
              )}
            </>
          ) : (
            <>
              {/* Shares label + ± stepper — design's `.tk-shares-lbl` +
                  `.tk-stepper` grid (−10 / −1 / input / +1 / +10). */}
              <div className="tk-shares-lbl">
                <span>
                  {orderType === "LIMIT"
                    ? `Shares · limit ${formatCents(limitPrice)}`
                    : `Shares · avg ${slippageDisplay?.avgPrice || formatCents(calculations.price)}`}
                </span>
                {/* LIMIT BUY only — MARKET BUY has its own dollar MAX above. */}
                {side === "BUY" && effectiveBalance && effectiveBalance > 0 && (
                  <button
                    type="button"
                    className="max"
                    onClick={() => {
                      // Max-buy: balance / limit price, floored.
                      if (!calculations.price || calculations.price <= 0)
                        return;
                      const maxByBalance = Math.floor(
                        (effectiveBalance ?? 0) / calculations.price
                      );
                      setShares(Math.max(minShares, maxByBalance));
                    }}
                  >
                    MAX
                  </button>
                )}
                {side === "SELL" && maxSellShares > 0 && (
                  <button
                    type="button"
                    className="max"
                    onClick={() => setShares(maxSellShares)}
                  >
                    MAX
                  </button>
                )}
              </div>
              <div className="tk-stepper">
                <button
                  type="button"
                  className="tk-step-btn"
                  onClick={() => setShares(Math.max(minShares, shares - 10))}
                >
                  −10
                </button>
                <button
                  type="button"
                  className="tk-step-btn"
                  onClick={() => setShares(Math.max(minShares, shares - 1))}
                >
                  −1
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  name="shares"
                  className="tk-step-input"
                  value={shares}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, "");
                    const n = Number.parseInt(raw || "0", 10);
                    setShares(Number.isFinite(n) ? n : 0);
                  }}
                  aria-label="Share quantity"
                />
                <button
                  type="button"
                  className="tk-step-btn"
                  onClick={() => setShares(shares + 1)}
                >
                  +1
                </button>
                <button
                  type="button"
                  className="tk-step-btn"
                  onClick={() => setShares(shares + 10)}
                >
                  +10
                </button>
              </div>
            </>
          )}

          {/* Allow-partial-fill toggle — MARKET only. Design's `.tk-toggle`
              + `.tk-switch` pill with translateX animation. */}
          {orderType === "MARKET" && (
            <div className="tk-toggle">
              <div className="info">
                <span className="l">Allow partial fill</span>
                <span className="s">{allowPartialFill ? "FAK" : "FOK"}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={allowPartialFill}
                aria-label="Allow partial fill"
                className={`tk-switch ${allowPartialFill ? "on" : ""}`}
                onClick={() => setAllowPartialFill(!allowPartialFill)}
              />
            </div>
          )}

          {/* Summary. MARKET orders are deliberately minimal — the amount you
              type IS the cost, so we drop Cost/Profit and lead with one big
              number: the gross Return if the outcome wins (BUY) or the
              Proceeds you'd receive now (SELL). LIMIT keeps the full breakdown
              (Cost + Return + Profit) since its cost isn't typed directly. */}
          {!isBelowMarketableBuyMinNotional &&
            (orderType === "MARKET" ? (
              <>
                <div className="tk-return-hero">
                  <span className="l">
                    {side === "BUY"
                      ? `Return if ${selectedOutcome?.name?.toUpperCase() ?? "YES"}`
                      : "Proceeds"}
                  </span>
                  <span className="row">
                    <span className="v tabular-nums">
                      $
                      {side === "BUY"
                        ? grossReturn.toFixed(2)
                        : calculations.total.toFixed(2)}
                    </span>
                    {side === "BUY" && calculations.total > 0 && (
                      <span className="gain tabular-nums">
                        {calculations.returnPercent}%
                      </span>
                    )}
                  </span>
                </div>
                {feeRow && <div className="tk-summary">{feeRow}</div>}
              </>
            ) : (
              <div className="tk-summary">
                <div className="tk-sum-row">
                  <span className="l">
                    {side === "BUY" ? "Cost" : "Proceeds"}
                  </span>
                  <span
                    className={`v tabular-nums ${side === "SELL" ? "up" : ""}`}
                  >
                    {totalLabel}
                  </span>
                </div>
                {side === "BUY" && (
                  <>
                    <div className="tk-sum-row">
                      <span className="l">
                        Return if{" "}
                        {selectedOutcome?.name?.toUpperCase() ?? "YES"}
                      </span>
                      <span className="v up tabular-nums">
                        ${grossReturn.toFixed(2)}
                      </span>
                    </div>
                    {feeRow}
                    <div className="tk-sum-row profit">
                      <span className="l">Profit</span>
                      <span className="v up tabular-nums">
                        {profitLabel}
                        {calculations.total > 0 && (
                          <span className="ret">
                            {" "}
                            ({calculations.returnPercent}%)
                          </span>
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}

          {/* Conditional UI Sections — all use the design's `.tk-warn`
              variants so colors track the active theme. */}
          <AnimatePresence>
            {error && (
              <m.div
                key="trading-error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="tk-warn error">
                  <AlertCircle className="ic h-4 w-4" />
                  <span className="body">
                    {formatTradingFormError(error.message)}
                  </span>
                </div>
              </m.div>
            )}

            {side === "SELL" && maxSellShares <= 0 && (
              <m.div
                key="no-sell-position"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="tk-warn">
                  <AlertCircle className="ic h-4 w-4" />
                  <span className="body">
                    No {selectedOutcome?.name || "shares"} to sell
                  </span>
                </div>
              </m.div>
            )}

            {belowLimitMin && shares > 0 && !error && (
              <m.div
                key="below-limit-minimum"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="tk-warn">
                  <AlertCircle className="ic h-4 w-4" />
                  <span className="body">
                    Limit orders require {minShares} share
                    {minShares === 1 ? "" : "s"} minimum
                  </span>
                </div>
              </m.div>
            )}

            {/* FAK sized the ticket down to the depth that's actually there.
                Say so in the user's own units — they typed dollars on a BUY
                and shares on a SELL — before they sign for less than they
                asked for. */}
            {partialFill && !error && (
              <m.div
                key="partial-fill"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="tk-warn info">
                  <AlertCircle className="ic h-4 w-4" />
                  <span className="body">
                    {partialFill.requestedUsd !== null
                      ? `Fills ${formatUsd(partialFill.filledUsd)} of ${formatUsd(
                          partialFill.requestedUsd
                        )} (~${formatShareQuantity(partialFill.filledShares)} shares)`
                      : `Fills ~${formatShareQuantity(partialFill.filledShares)} of ${formatShareQuantity(
                          partialFill.requestedShares ?? 0
                        )} shares (${formatUsd(partialFill.filledUsd)})`}
                    <span className="sub">
                      That's all the book has right now. Turn off Allow partial
                      fill to require the full amount.
                    </span>
                  </span>
                </div>
              </m.div>
            )}

            {hasInsufficientBalance && side === "BUY" && (
              <m.div
                key="insufficient-balance"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                {/* Balance context strip — design's `.tk-warn-bal`. Sits
                    directly above the merged amber Deposit CTA so the
                    shortfall and the next action share visual weight. */}
                <div className="tk-warn-bal">
                  <span className="tabular-nums">
                    <span className="h">
                      ${(effectiveBalance ?? 0).toFixed(2)}
                    </span>{" "}
                    <span className="dim">available</span>
                  </span>
                  <span className="tabular-nums dim">
                    short $
                    {(calculations.total - (effectiveBalance ?? 0)).toFixed(2)}
                  </span>
                </div>
              </m.div>
            )}

            {needsApproval && !hasInsufficientBalance && (
              <m.div
                key="trading-approval"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                {/* Informational tone — approval is step 1, not an error. */}
                <div className="tk-warn info">
                  <AlertCircle className="ic h-4 w-4" />
                  <span className="body">
                    {hasNoAllowance || hasMissingTradingApprovals
                      ? "Approve pUSD spending to trade"
                      : `Increase allowance to $${calculations.total.toFixed(2)}`}
                    <span className="sub">
                      Approval is step 1. Place the order after it succeeds.
                    </span>
                  </span>
                </div>
              </m.div>
            )}
          </AnimatePresence>

          {/* Submit Action — design's `.tk-cta` family (`.ready` = filled
              ink action, `.deposit` = amber CTA when insufficient balance). */}
          <div className="pt-1">
            {!isConnected ? (
              <button
                type="button"
                className="tk-cta ready"
                disabled={connecting}
                onMouseEnter={preloadWalletModal}
                onFocus={preloadWalletModal}
                onClick={() => void handleConnect()}
              >
                <Wallet className="h-4 w-4" />
                {connecting ? "Connecting…" : "Connect Wallet to Trade"}
              </button>
            ) : !hasCredentials ? (
              <button
                type="button"
                className="tk-cta ready"
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
            ) : side === "BUY" && hasInsufficientBalance ? (
              /* Merged amber Deposit CTA — opens the deposit modal so
                 the next action is one tap away. */
              <button
                type="button"
                onClick={() => setShowDepositModal(true)}
                className="tk-cta deposit"
              >
                <ArrowDownToLine className="h-4 w-4" />
                Deposit $
                {(calculations.total - (effectiveBalance ?? 0)).toFixed(2)} to
                Buy
              </button>
            ) : (
              <button
                type="button"
                className={`tk-cta ${
                  (side === "SELL" && maxSellShares <= 0) ||
                  isCheckingTradingApprovals ||
                  belowLimitMin
                    ? ""
                    : "ready"
                }`}
                onClick={async () => {
                  if (needsApproval) {
                    posthog.capture("trading_token_approval_requested", {
                      product: "web",
                      surface: "trading_form",
                    });
                    const approved = await handleSetAllowance();
                    if (approved) {
                      posthog.capture("trading_token_approval_succeeded", {
                        product: "web",
                        surface: "trading_form",
                        market_title: marketTitle,
                        side,
                        order_type: orderType,
                      });
                      toast.success("Approval confirmed", {
                        description: "You can place the order now.",
                      });
                    } else {
                      posthog.capture("trading_token_approval_failed", {
                        product: "web",
                        surface: "trading_form",
                      });
                    }
                    return;
                  }

                  const submittedShares = displayShares;
                  const submittedSide = side;
                  const submittedOrderType = orderType;
                  const submittedOutcome = selectedOutcome?.name;
                  const submittedPrice =
                    orderType === "LIMIT" ? limitPrice : calculations.price;
                  const orderProperties = {
                    product: "web",
                    surface: "trading_form",
                    market_title: marketTitle,
                    side: submittedSide,
                    order_type: submittedOrderType,
                    shares: submittedShares,
                    outcome_name: submittedOutcome,
                    order_value: calculations.total,
                    total_cost: calculations.total,
                    potential_win: calculations.potentialWin,
                  };

                  posthog.capture("trade_button_clicked", orderProperties);

                  const success = await handleSubmit();
                  if (!success) {
                    posthog.capture("trade_form_submission_failed", {
                      ...orderProperties,
                      failure_stage: "submission",
                    });
                    return;
                  }

                  posthog.capture("order_submitted", orderProperties);

                  const outcomeLabel = submittedOutcome ?? "shares";
                  if (submittedOrderType === "LIMIT") {
                    const intent = submittedSide === "BUY" ? "buy" : "sell";
                    toast.success("Limit order placed", {
                      description: `Resting on the book to ${intent} ${submittedShares} ${outcomeLabel} at ${formatCents(submittedPrice)}.`,
                    });
                  } else {
                    toast.success("Order submitted", {
                      description: "Check your portfolio for confirmed fills.",
                    });
                  }
                  // Failures: inline error banner (already friendly-formatted)
                  // surfaces them; the clob `error` state is set asynchronously
                  // inside the hook, so reading it here would be stale.
                }}
                disabled={
                  isLoading ||
                  isCheckingTradingApprovals ||
                  // `handleSubmit` returns false immediately when `canTrade`
                  // is false, without calling the CLOB and without setting
                  // `error` — so the click would be silently swallowed. The
                  // gate above only covers `isConnected` and `hasCredentials`;
                  // `canTrade` additionally requires the proxy wallet and the
                  // viem wallet client, both of which resolve asynchronously.
                  !canTrade ||
                  // `hasInsufficientBalance` branch is handled by the
                  // amber Deposit CTA above and doesn't reach this
                  // button, so we don't include it in the disabled set
                  // here.
                  (side === "SELL" && maxSellShares <= 0) ||
                  (side === "SELL" && shares > maxSellShares) ||
                  (side === "SELL" && shares <= 0) ||
                  belowLimitMin ||
                  (side === "BUY" && isBelowMarketableBuyMinNotional) ||
                  !selectedOutcome ||
                  !hasValidTokenId ||
                  (orderType === "MARKET" && !canPlaceMarketOrder)
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
                ) : isMarketOrderSizeEmpty ? (
                  side === "BUY" ? (
                    "Enter amount"
                  ) : (
                    "Enter shares"
                  )
                ) : hasInsufficientLiquidity ? (
                  // Only when the book was actually walked and came up short.
                  // A missing book or an empty amount field falls through to
                  // the specific labels below instead of blaming the market.
                  "Insufficient liquidity"
                ) : isOrderBookUnavailable ? (
                  "Order book unavailable"
                ) : side === "SELL" && maxSellShares <= 0 ? (
                  "No position to sell"
                ) : side === "SELL" && shares > maxSellShares ? (
                  `Max ${maxSellShares.toFixed(1)} shares`
                ) : belowLimitMin ? (
                  `Minimum shares: ${minShares}`
                ) : side === "BUY" && isBelowMarketableBuyMinNotional ? (
                  // Signed without `maxSpend`, so `makerAmount` equals the
                  // amount and the CLOB's $1 floor applies to it directly.
                  `Minimum order: $${minBuyAmount.toFixed(2)}`
                ) : !canTrade ? (
                  // Connected and credentialled, but the proxy wallet or the
                  // wallet client has not resolved yet. Transient on a fresh
                  // load or a reconnect; either way the order cannot be signed.
                  "Preparing wallet…"
                ) : needsApproval ? (
                  "Approve"
                ) : (
                  <>
                    {side === "BUY" ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : (
                      <TrendingDown className="h-4 w-4" />
                    )}
                    {orderActionLabel} {shareQuantityLabel} shares for{" "}
                    {totalLabel}
                  </>
                )}
              </button>
            )}
          </div>

          <p className="tk-terms">
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
