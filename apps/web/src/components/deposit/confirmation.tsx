import { motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Info,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  DepositTransaction,
  QuoteResponse,
  SupportedAsset,
} from "@/hooks/use-bridge";
import type { TokenBalance } from "@/hooks/use-wallet-tokens";
import { formatAddress } from "@/lib/formatters";

interface ConfirmationProps {
  selectedMethod: string | null;
  selectedBridgeAsset: SupportedAsset | null;
  selectedToken: TokenBalance | null;
  isProcessing: boolean;
  bridgeAddress: string;
  amount: string;
  address?: string;
  receiveAmount: string;
  depositError: string | null;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  copied: boolean;
  onCopy: () => void;
  onDeposit: () => void;
  quote?: QuoteResponse | null;
  isLoadingQuote?: boolean;
  depositTransactions?: DepositTransaction[];
  isLoadingDepositStatus?: boolean;
}

/**
 * Get human-readable status text and color for deposit status
 */
function getDepositStatusDisplay(status: DepositTransaction["status"]) {
  switch (status) {
    case "DEPOSIT_DETECTED":
      return { text: "Deposit detected", color: "text-blue-500", icon: Clock };
    case "PROCESSING":
      return { text: "Processing", color: "text-amber-500", icon: RefreshCw };
    case "ORIGIN_TX_CONFIRMED":
      return { text: "Origin confirmed", color: "text-amber-500", icon: Check };
    case "SUBMITTED":
      return { text: "Submitted", color: "text-blue-500", icon: RefreshCw };
    case "COMPLETED":
      return {
        text: "Completed",
        color: "text-green-500",
        icon: CheckCircle2,
      };
    case "FAILED":
      return { text: "Failed", color: "text-red-500", icon: Info };
    default:
      return { text: status, color: "text-muted-foreground", icon: Clock };
  }
}

/**
 * Format milliseconds to human-readable time
 */
function formatCheckoutTime(ms: number): string {
  if (ms < 60000) {
    return `~${Math.ceil(ms / 1000)}s`;
  }
  return `~${Math.ceil(ms / 60000)} min`;
}

export function Confirmation({
  selectedMethod,
  selectedBridgeAsset,
  selectedToken,
  isProcessing,
  bridgeAddress,
  amount,
  address,
  receiveAmount,
  depositError,
  isPending,
  isConfirming,
  isConfirmed,
  copied,
  onCopy,
  onDeposit,
  quote,
  isLoadingQuote,
  depositTransactions,
  isLoadingDepositStatus,
}: ConfirmationProps) {
  // Use quote data for more accurate receive amount if available
  const displayReceiveAmount = quote
    ? (Number(quote.estToTokenBaseUnit) / 1e6).toFixed(2) // USDC.e has 6 decimals
    : receiveAmount;

  // Use quote for estimated time if available
  const estimatedTime = quote
    ? formatCheckoutTime(quote.estCheckoutTimeMs)
    : "< 2 min";
  return (
    <motion.div
      key="confirm"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      {selectedMethod === "bridge" && selectedBridgeAsset ? (
        // Bridge confirmation - show deposit address
        <>
          <div className="text-center py-4">
            <p className="text-3xl font-bold text-primary">
              Deposit {selectedBridgeAsset.token.symbol}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              on {selectedBridgeAsset.chainName}
            </p>
          </div>

          {isProcessing ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : bridgeAddress ? (
            <>
              {/* Deposit Address */}
              <div className="p-4 rounded-xl bg-gray-100 dark:bg-card border border-gray-200 dark:border-border">
                <p className="text-xs text-muted-foreground mb-2">
                  Send {selectedBridgeAsset.token.symbol} to this address
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono break-all text-foreground">
                    {bridgeAddress}
                  </code>
                  <button
                    type="button"
                    onClick={onCopy}
                    className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-accent transition-colors"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                onClick={onCopy}
                className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl"
              >
                {copied ? "Address Copied!" : "Copy Deposit Address"}
              </Button>

              {/* Info */}
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-amber-400 mt-0.5" />
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium text-amber-400">
                      Minimum: ${selectedBridgeAsset.minCheckoutUsd}
                    </p>
                    <p>Assets will be converted to USDC.e on Polygon.</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Failed to get deposit address. Please try again.
            </div>
          )}
        </>
      ) : selectedToken ? (
        // Wallet confirmation - using Polymarket Bridge
        <>
          {/* Amount */}
          <div className="text-center py-4">
            <p className="text-4xl font-bold text-primary">
              ${Number.parseFloat(amount || "0").toFixed(2)}
            </p>
          </div>

          {/* Bridge Info Banner - only show if conversion is actually happening */}
          {selectedToken.symbol !== "USDC.e" && (
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-start gap-2">
                <Zap className="h-4 w-4 text-blue-400 mt-0.5" />
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium text-blue-400">
                    Auto-conversion to USDC.e
                  </p>
                  <p>
                    Your {selectedToken.symbol} will be automatically converted
                    to USDC.e on Polygon via Polymarket Bridge.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Details */}
          <div className="space-y-3 p-4 rounded-xl bg-gray-100 dark:bg-card border border-gray-200 dark:border-border">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Source</span>
              <div className="flex items-center gap-2">
                <span className="text-xl">🦊</span>
                <span className="text-foreground">
                  Wallet ({address ? formatAddress(address) : ""})
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Via</span>
              <div className="flex items-center gap-2">
                <span className="text-xl">🌉</span>
                <span className="text-foreground">Polymarket Bridge</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Destination</span>
              <div className="flex items-center gap-2">
                <span className="text-xl">📊</span>
                <span className="text-foreground">Polymarket Wallet</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Estimated time</span>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-foreground">{estimatedTime}</span>
              </div>
            </div>
          </div>

          {/* Transaction Breakdown */}
          <div className="space-y-2 p-4 rounded-xl bg-gray-100 dark:bg-card border border-gray-200 dark:border-border">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">You send</span>
              <span className="text-foreground">
                {amount} {selectedToken.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                You receive {quote ? "" : "(approx)"}
              </span>
              <div className="flex items-center gap-1">
                {isLoadingQuote ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : null}
                <span className="text-foreground">
                  {quote ? "" : "~"}
                  {displayReceiveAmount} USDC.e
                </span>
              </div>
            </div>
            <div className="border-t border-border pt-2 mt-2">
              {quote?.estFeeBreakdown ? (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground/70">Gas fee</span>
                    <span className="text-muted-foreground">
                      ${quote.estFeeBreakdown.gasUsd.toFixed(4)}
                    </span>
                  </div>
                  {quote.estFeeBreakdown.swapImpactUsd > 0 ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground/70">
                        Swap impact
                      </span>
                      <span className="text-muted-foreground">
                        ${quote.estFeeBreakdown.swapImpactUsd.toFixed(4)}
                      </span>
                    </div>
                  ) : null}
                  {quote.estFeeBreakdown.appFeeUsd > 0 ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground/70">
                        {quote.estFeeBreakdown.appFeeLabel || "App fee"}
                      </span>
                      <span className="text-muted-foreground">
                        ${quote.estFeeBreakdown.appFeeUsd.toFixed(4)}
                      </span>
                    </div>
                  ) : null}
                  {quote.estFeeBreakdown.maxSlippage > 0 ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground/70">
                        Max slippage
                      </span>
                      <span className="text-muted-foreground">
                        {(quote.estFeeBreakdown.maxSlippage * 100).toFixed(2)}%
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between text-sm mt-1 pt-1 border-t border-border/50">
                    <span className="text-muted-foreground/70">
                      Min. received
                    </span>
                    <span className="text-foreground font-medium">
                      {quote.estFeeBreakdown.minReceived.toFixed(2)} USDC.e
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground/70">
                      Network cost
                    </span>
                    <span className="text-muted-foreground">~$0.01</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground/70">Bridge fee</span>
                    <span className="text-muted-foreground">~0.1%</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Error Message */}
          {depositError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 overflow-hidden">
              <p className="text-sm text-red-500 overflow-wrap-anywhere">
                {depositError.length > 150
                  ? `${depositError.slice(0, 150)}...`
                  : depositError}
              </p>
            </div>
          )}

          {/* No Bridge Address Warning */}
          {!bridgeAddress && !isProcessing && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-amber-400" />
                <p className="text-sm text-amber-400">
                  Failed to get bridge address. Please go back and try again.
                </p>
              </div>
            </div>
          )}

          {/* Success Message */}
          {isConfirmed && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                <div className="text-sm text-green-500">
                  <p className="font-medium">Transaction confirmed!</p>
                  <p className="text-xs text-green-400">
                    USDC.e will be credited to your Polymarket wallet shortly.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Deposit Status Tracking - using ternary for conditional render (rendering-conditional-render) */}
          {isConfirmed &&
          depositTransactions &&
          depositTransactions.length > 0 ? (
            <div className="p-4 rounded-xl bg-gray-100 dark:bg-card border border-gray-200 dark:border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-foreground">
                  Bridge Status
                </span>
                {isLoadingDepositStatus ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : null}
              </div>
              <div className="space-y-2">
                {depositTransactions.slice(0, 3).map((tx, index) => {
                  const statusDisplay = getDepositStatusDisplay(tx.status);
                  const StatusIcon = statusDisplay.icon;
                  return (
                    <div
                      key={`${tx.fromAmountBaseUnit}-${tx.createdTimeMs || index}`}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <StatusIcon
                          className={`h-4 w-4 ${statusDisplay.color} ${
                            tx.status === "PROCESSING" ||
                            tx.status === "SUBMITTED"
                              ? "animate-spin"
                              : ""
                          }`}
                        />
                        <span className={statusDisplay.color}>
                          {statusDisplay.text}
                        </span>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {(Number(tx.fromAmountBaseUnit) / 1e6).toFixed(2)} USDC
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Terms */}
          <p className="text-xs text-muted-foreground/70 text-center">
            By clicking Confirm Order, you agree to our{" "}
            <span className="text-primary cursor-pointer hover:underline">
              terms
            </span>
            .
          </p>

          {/* Confirm Button */}
          <Button
            onClick={onDeposit}
            disabled={
              !bridgeAddress ||
              isProcessing ||
              isPending ||
              isConfirming ||
              isConfirmed
            }
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl disabled:opacity-50"
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Confirm in Wallet...
              </span>
            ) : isConfirming ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Confirming...
              </span>
            ) : isConfirmed ? (
              <span className="flex items-center gap-2">
                <Check className="h-4 w-4" />
                Deposit Complete!
              </span>
            ) : !bridgeAddress ? (
              "Loading Bridge..."
            ) : (
              "Confirm Order"
            )}
          </Button>
        </>
      ) : null}
    </motion.div>
  );
}
