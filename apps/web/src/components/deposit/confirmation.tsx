import { motion } from "framer-motion";
import { Check, Copy, Loader2 } from "lucide-react";
import type {
  DepositTransaction,
  QuoteResponse,
  SupportedAsset,
} from "@/hooks/use-bridge";
import type { TokenBalance } from "@/hooks/use-wallet-tokens";
import { formatAddress } from "@/lib/formatters";
import { cn } from "@/lib/utils";

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
  isOnChainConfirmed: boolean;
  isConfirmed: boolean;
  copied: boolean;
  onCopy: () => void;
  onDeposit: () => void;
  quote?: QuoteResponse | null;
  isLoadingQuote?: boolean;
  depositTransactions?: DepositTransaction[];
  isLoadingDepositStatus?: boolean;
}

function getDepositStatusText(status: DepositTransaction["status"]): {
  text: string;
  tone: "info" | "warn" | "success" | "error";
} {
  switch (status) {
    case "DEPOSIT_DETECTED":
      return { text: "Deposit detected", tone: "info" };
    case "PROCESSING":
      return { text: "Processing", tone: "warn" };
    case "ORIGIN_TX_CONFIRMED":
      return { text: "Origin confirmed", tone: "warn" };
    case "SUBMITTED":
      return { text: "Submitted", tone: "info" };
    case "COMPLETED":
      return { text: "Completed", tone: "success" };
    case "FAILED":
      return { text: "Failed", tone: "error" };
    default:
      return { text: status, tone: "info" };
  }
}

function formatCheckoutTime(ms: number): string {
  if (ms < 60000) return `~${Math.ceil(ms / 1000)}s`;
  return `~${Math.ceil(ms / 60000)} min`;
}

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}

function DetailRow({ label, children, muted }: DetailRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-border/40">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground shrink-0">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-xs tabular-nums text-right min-w-0 truncate",
          muted ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {children}
      </span>
    </div>
  );
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
  isOnChainConfirmed,
  isConfirmed,
  copied,
  onCopy,
  onDeposit,
  quote,
  isLoadingQuote,
  depositTransactions,
  isLoadingDepositStatus,
}: ConfirmationProps) {
  const displayReceiveAmount = quote
    ? (Number(quote.estToTokenBaseUnit) / 1e6).toFixed(2)
    : receiveAmount;
  const estimatedTime = quote
    ? formatCheckoutTime(quote.estCheckoutTimeMs)
    : "< 2 min";

  return (
    <motion.div
      key="confirm"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col"
    >
      {selectedMethod === "bridge" && selectedBridgeAsset ? (
        <>
          {/* Headline */}
          <div className="flex flex-col items-center py-6 border-y border-border/40 mb-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
              {selectedBridgeAsset.chainName}
            </span>
            <span className="text-2xl font-semibold leading-none text-foreground">
              Deposit {selectedBridgeAsset.token.symbol}
            </span>
          </div>

          {isProcessing ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : bridgeAddress ? (
            <>
              {/* Address block */}
              <div className="border-y border-border/40 py-4 mb-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
                  Send {selectedBridgeAsset.token.symbol} to
                </p>
                <div className="flex items-start gap-3">
                  <code className="flex-1 font-mono text-xs break-all text-foreground leading-relaxed">
                    {bridgeAddress}
                  </code>
                  <button
                    type="button"
                    onClick={onCopy}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Copy address"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Copy CTA */}
              <button
                type="button"
                onClick={onCopy}
                className="w-full h-12 bg-foreground text-background font-mono text-[11px] uppercase tracking-[0.18em] hover:bg-foreground/90 transition-colors"
              >
                {copied ? "Address Copied" : "Copy Deposit Address"}
              </button>

              {/* Min warning — border-l accent */}
              <div className="border-l-2 border-amber-500 pl-3 py-2 mt-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-500 mb-1 tabular-nums">
                  Minimum · ${selectedBridgeAsset.minCheckoutUsd}
                </p>
                <p className="text-sm text-foreground leading-snug">
                  Assets will be converted to pUSD on Polygon — Polymarket's V2
                  trading token.
                </p>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Failed to get deposit address. Please try again.
            </div>
          )}
        </>
      ) : selectedToken ? (
        <>
          {/* Headline amount */}
          <div className="flex flex-col items-center py-6 border-y border-border/40 mb-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
              You Deposit
            </span>
            <div className="flex items-baseline gap-0.5">
              <span className="font-editorial italic text-4xl leading-none text-muted-foreground">
                $
              </span>
              <span className="font-editorial italic text-5xl leading-none text-foreground tabular-nums">
                {Number.parseFloat(amount || "0").toFixed(2)}
              </span>
            </div>
          </div>

          {/* Bridge advisory */}
          {selectedToken.symbol !== "pUSD" && (
            <div className="border-l-2 border-blue-500 pl-3 py-2 mb-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-blue-500 mb-1">
                Auto-Conversion
              </p>
              <p className="text-sm text-foreground leading-snug">
                Your {selectedToken.symbol} routes through Polymarket Bridge and
                lands as pUSD on Polygon.
              </p>
            </div>
          )}

          {/* Route detail */}
          <div className="border-t border-border/40">
            <DetailRow label="Source">
              Wallet · {address ? formatAddress(address) : "—"}
            </DetailRow>
            <DetailRow label="Via">Polymarket Bridge</DetailRow>
            <DetailRow label="Destination">Polymarket Wallet</DetailRow>
            <DetailRow label="Est. Time">{estimatedTime}</DetailRow>
          </div>

          {/* Breakdown */}
          <div className="mt-5 border-t border-border/40">
            <DetailRow label="You Send">
              {amount} {selectedToken.symbol}
            </DetailRow>
            <DetailRow label={quote ? "You Receive" : "You Receive ~"}>
              {isLoadingQuote ? (
                <Loader2 className="h-3 w-3 animate-spin inline" />
              ) : (
                `${quote ? "" : "~"}${displayReceiveAmount} pUSD`
              )}
            </DetailRow>
            {quote?.estFeeBreakdown ? (
              <>
                <DetailRow label="Gas Fee" muted>
                  ${quote.estFeeBreakdown.gasUsd.toFixed(4)}
                </DetailRow>
                {quote.estFeeBreakdown.swapImpactUsd > 0 ? (
                  <DetailRow label="Swap Impact" muted>
                    ${quote.estFeeBreakdown.swapImpactUsd.toFixed(4)}
                  </DetailRow>
                ) : null}
                {quote.estFeeBreakdown.appFeeUsd > 0 ? (
                  <DetailRow
                    label={quote.estFeeBreakdown.appFeeLabel || "App Fee"}
                    muted
                  >
                    ${quote.estFeeBreakdown.appFeeUsd.toFixed(4)}
                  </DetailRow>
                ) : null}
                {quote.estFeeBreakdown.maxSlippage > 0 ? (
                  <DetailRow label="Max Slippage" muted>
                    {(quote.estFeeBreakdown.maxSlippage * 100).toFixed(2)}%
                  </DetailRow>
                ) : null}
                <DetailRow label="Min. Received">
                  {quote.estFeeBreakdown.minReceived.toFixed(2)} pUSD
                </DetailRow>
              </>
            ) : (
              <>
                <DetailRow label="Network Cost" muted>
                  ~$0.01
                </DetailRow>
                <DetailRow label="Bridge Fee" muted>
                  ~0.1%
                </DetailRow>
              </>
            )}
          </div>

          {/* Error */}
          {depositError && (
            <div className="border-l-2 border-red-500 pl-3 py-2 mt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-500 mb-1">
                Transaction Failed
              </p>
              <p className="text-sm text-foreground leading-snug">
                {depositError.length > 150
                  ? `${depositError.slice(0, 150)}…`
                  : depositError}
              </p>
            </div>
          )}

          {/* No bridge address */}
          {!bridgeAddress && !isProcessing && (
            <div className="border-l-2 border-amber-500 pl-3 py-2 mt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-500 mb-1">
                Bridge Address Missing
              </p>
              <p className="text-sm text-foreground leading-snug">
                Go back and try again.
              </p>
            </div>
          )}

          {/* Bridge pending */}
          {isOnChainConfirmed && isConfirming && !isConfirmed && (
            <div className="border-l-2 border-blue-500 pl-3 py-2 mt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-blue-500 mb-1">
                On-Chain Confirmed
              </p>
              <p className="text-sm text-foreground leading-snug">
                Waiting for the bridge to credit pUSD to your Polymarket wallet.
              </p>
            </div>
          )}

          {/* Done */}
          {isConfirmed && (
            <div className="border-l-2 border-emerald-500 pl-3 py-2 mt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-500 mb-1">
                Deposit Complete
              </p>
              <p className="text-sm text-foreground leading-snug">
                pUSD has been credited to your Polymarket wallet.
              </p>
            </div>
          )}

          {/* Bridge tracking */}
          {(isOnChainConfirmed || isConfirmed) &&
          depositTransactions &&
          depositTransactions.length > 0 ? (
            <div className="mt-5 border-t border-border/40">
              <div className="flex items-center justify-between py-2.5 border-b border-border/40">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Bridge Status
                </span>
                {isLoadingDepositStatus ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : null}
              </div>
              {depositTransactions.slice(0, 3).map((tx, index) => {
                const statusDisplay = getDepositStatusText(tx.status);
                const toneClass =
                  statusDisplay.tone === "success"
                    ? "text-emerald-500"
                    : statusDisplay.tone === "error"
                      ? "text-red-500"
                      : statusDisplay.tone === "warn"
                        ? "text-amber-500"
                        : "text-blue-500";
                return (
                  <div
                    key={`${tx.fromAmountBaseUnit}-${tx.createdTimeMs || index}`}
                    className="flex items-center justify-between py-2 border-b border-border/40"
                  >
                    <span
                      className={cn(
                        "font-mono text-[11px] uppercase tracking-[0.14em]",
                        toneClass
                      )}
                    >
                      {statusDisplay.text}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {(Number(tx.fromAmountBaseUnit) / 1e6).toFixed(2)} USDC
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Terms */}
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground text-center mt-6 mb-4">
            By confirming you agree to our{" "}
            <span className="text-foreground cursor-pointer underline underline-offset-4 decoration-border">
              Terms
            </span>
          </p>

          {/* Confirm — decisive emerald */}
          <button
            type="button"
            onClick={onDeposit}
            disabled={
              !bridgeAddress ||
              isProcessing ||
              isPending ||
              isConfirming ||
              isOnChainConfirmed ||
              isConfirmed
            }
            className={cn(
              "w-full h-12 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
              isConfirmed
                ? "bg-emerald-500/20 text-emerald-500 cursor-default"
                : !bridgeAddress ||
                    isProcessing ||
                    isPending ||
                    isConfirming ||
                    isOnChainConfirmed
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-emerald-500 text-white hover:bg-emerald-600"
            )}
          >
            {isPending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Confirm in Wallet
              </span>
            ) : isOnChainConfirmed && isConfirming ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Waiting for Bridge
              </span>
            ) : isConfirming ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Confirming On-Chain
              </span>
            ) : isOnChainConfirmed ? (
              "Bridge Update Pending"
            ) : isConfirmed ? (
              <span className="inline-flex items-center gap-2">
                <Check className="h-3.5 w-3.5" />
                Deposit Complete
              </span>
            ) : !bridgeAddress ? (
              "Loading Bridge"
            ) : (
              "Confirm Deposit"
            )}
          </button>
        </>
      ) : null}
    </motion.div>
  );
}
