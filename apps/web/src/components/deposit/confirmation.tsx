import {
  type DepositTransaction,
  formatCheckoutTime,
  getDepositStatusDisplay,
  type QuoteResponse,
  type SupportedAsset,
} from "@knoww/shared-types/bridge";
import { motion } from "framer-motion";
import { Check, Copy, Loader2 } from "lucide-react";
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
  isWalletReady: boolean;
  copied: boolean;
  onCopy: () => void;
  onDeposit: () => void;
  quote?: QuoteResponse | null;
  isLoadingQuote?: boolean;
  depositTransactions?: DepositTransaction[];
  isLoadingDepositStatus?: boolean;
}

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}

function DetailRow({ label, children, muted }: DetailRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-(--kwm-hl) last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) shrink-0">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-xs tabular-nums text-right min-w-0 truncate",
          muted ? "text-(--kwm-ink-dim)" : "text-(--kwm-ink)"
        )}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * Accent note — small bordered+tinted callout used for advisories
 * (info / warn / error / success). Theme-safe via the `--kwm-*` signal
 * tokens.
 */
function AccentNote({
  tone,
  caption,
  children,
}: {
  tone: "info" | "warn" | "error" | "success";
  caption: string;
  children: React.ReactNode;
}) {
  const palette = {
    info: {
      border: "border-(--kwm-accent)/40",
      bg: "bg-(--kwm-accent-soft)",
      text: "text-(--kwm-accent)",
    },
    warn: {
      border: "border-(--kwm-warn-border)",
      bg: "bg-(--kwm-warn-soft)",
      text: "text-(--kwm-warn)",
    },
    error: {
      border: "border-(--kwm-down)/40",
      bg: "bg-(--kwm-down-soft)",
      text: "text-(--kwm-down)",
    },
    success: {
      border: "border-(--kwm-up-border)",
      bg: "bg-(--kwm-up-soft)",
      text: "text-(--kwm-up)",
    },
  }[tone];

  return (
    <div
      className={cn(
        "mt-4 px-3 py-2 border rounded-md",
        palette.border,
        palette.bg
      )}
    >
      <p
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.14em] mb-1 tabular-nums",
          palette.text
        )}
      >
        {caption}
      </p>
      <p className="text-sm text-(--kwm-ink) leading-snug">{children}</p>
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
  isWalletReady,
  copied,
  onCopy,
  onDeposit,
  quote,
  isLoadingQuote,
  depositTransactions,
  isLoadingDepositStatus,
}: ConfirmationProps) {
  const isDirectPusdDeposit = selectedToken?.symbol === "pUSD";
  const displayReceiveAmount = quote
    ? (Number(quote.estToTokenBaseUnit) / 1e6).toFixed(2)
    : receiveAmount;
  const estimatedTime = quote
    ? formatCheckoutTime(quote.estCheckoutTimeMs)
    : isDirectPusdDeposit
      ? "On-chain"
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
          <div className="flex flex-col items-center py-5 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2)">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) mb-2">
              {selectedBridgeAsset.chainName}
            </span>
            <span className="text-2xl font-semibold leading-none text-(--kwm-ink) tracking-tight">
              Deposit {selectedBridgeAsset.token.symbol}
            </span>
          </div>

          {isProcessing ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-(--kwm-ink-3)" />
            </div>
          ) : bridgeAddress ? (
            <>
              {/* Address block */}
              <div className="mt-4 px-3.5 py-3 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2)">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) mb-2">
                  Send {selectedBridgeAsset.token.symbol} to
                </p>
                <div className="flex items-start gap-3">
                  <code className="flex-1 font-mono text-xs break-all text-(--kwm-ink) leading-relaxed">
                    {bridgeAddress}
                  </code>
                  <button
                    type="button"
                    onClick={onCopy}
                    className="shrink-0 text-(--kwm-ink-3) hover:text-(--kwm-ink) transition-colors"
                    aria-label="Copy address"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-(--kwm-up)" />
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
                className="mt-4 w-full h-11 rounded-md bg-(--kwm-ink) text-(--kwm-bg) font-mono text-[11px] uppercase tracking-[0.18em] font-semibold hover:opacity-90 transition-colors"
              >
                {copied ? "Address Copied" : "Copy Deposit Address"}
              </button>

              <AccentNote
                tone="warn"
                caption={`Minimum · $${selectedBridgeAsset.minCheckoutUsd}`}
              >
                Assets will be converted to pUSD on Polygon — Polymarket's V2
                trading token.
              </AccentNote>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-(--kwm-ink-3)">
              Failed to get deposit address. Please try again.
            </div>
          )}
        </>
      ) : selectedToken ? (
        <>
          {/* Headline amount — clean Geist sans (no italic Fraunces) */}
          <div className="flex flex-col items-center py-5 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2)">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) mb-2">
              You Deposit
            </span>
            <div className="flex items-baseline gap-0.5 font-(family-name:--font-geist) font-semibold tracking-tight">
              <span className="text-3xl leading-none text-(--kwm-ink-3)">
                $
              </span>
              <span className="text-4xl leading-none text-(--kwm-ink) tabular-nums">
                {Number.parseFloat(amount || "0").toFixed(2)}
              </span>
            </div>
          </div>

          {/* Bridge advisory */}
          {!isDirectPusdDeposit && (
            <AccentNote tone="info" caption="Auto-Conversion">
              Your {selectedToken.symbol} routes through Polymarket Bridge and
              lands as pUSD on Polygon.
            </AccentNote>
          )}

          {/* Route detail */}
          <div className="mt-4 px-3.5 py-1 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2)">
            <DetailRow label="Source">
              Wallet · {address ? formatAddress(address) : "—"}
            </DetailRow>
            <DetailRow label="Via">
              {isDirectPusdDeposit ? "Direct transfer" : "Polymarket Bridge"}
            </DetailRow>
            <DetailRow label="Destination">Polymarket Wallet</DetailRow>
            <DetailRow label="Est. Time">{estimatedTime}</DetailRow>
          </div>

          {/* Breakdown */}
          <div className="mt-3 px-3.5 py-1 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2)">
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
            {isDirectPusdDeposit ? (
              <DetailRow label="Network Cost" muted>
                Polygon gas
              </DetailRow>
            ) : quote?.estFeeBreakdown ? (
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
            <AccentNote tone="error" caption="Transaction Failed">
              {depositError.length > 150
                ? `${depositError.slice(0, 150)}…`
                : depositError}
            </AccentNote>
          )}

          {/* No bridge address */}
          {!bridgeAddress && !isProcessing && (
            <AccentNote tone="warn" caption="Bridge Address Missing">
              Go back and try again.
            </AccentNote>
          )}

          {/* Bridge pending */}
          {isOnChainConfirmed && isConfirming && !isConfirmed && (
            <AccentNote tone="info" caption="On-Chain Confirmed">
              {isDirectPusdDeposit
                ? "Waiting for the direct pUSD transfer to finalize."
                : "Waiting for the bridge to credit pUSD to your Polymarket wallet."}
            </AccentNote>
          )}

          {/* Done */}
          {isConfirmed && (
            <AccentNote tone="success" caption="Deposit Complete">
              pUSD has been credited to your Polymarket wallet.
            </AccentNote>
          )}

          {/* Bridge tracking */}
          {(isOnChainConfirmed || isConfirmed) &&
          depositTransactions &&
          depositTransactions.length > 0 ? (
            <div className="mt-4 px-3.5 py-2 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2)">
              <div className="flex items-center justify-between py-1.5 border-b border-(--kwm-hl)">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
                  Bridge Status
                </span>
                {isLoadingDepositStatus ? (
                  <Loader2 className="h-3 w-3 animate-spin text-(--kwm-ink-3)" />
                ) : null}
              </div>
              {depositTransactions.slice(0, 3).map((tx, index) => {
                const statusDisplay = getDepositStatusDisplay(tx.status);
                const toneClass =
                  statusDisplay.tone === "success"
                    ? "text-(--kwm-up)"
                    : statusDisplay.tone === "error"
                      ? "text-(--kwm-down)"
                      : statusDisplay.tone === "warn"
                        ? "text-(--kwm-warn)"
                        : "text-(--kwm-accent)";
                return (
                  <div
                    key={`${tx.fromAmountBaseUnit}-${tx.createdTimeMs || index}`}
                    className="flex items-center justify-between py-2 border-b border-(--kwm-hl) last:border-b-0"
                  >
                    <span
                      className={cn(
                        "font-mono text-[11px] uppercase tracking-[0.14em]",
                        toneClass
                      )}
                    >
                      {statusDisplay.text}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-(--kwm-ink-3)">
                      {(Number(tx.fromAmountBaseUnit) / 1e6).toFixed(2)} USDC
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Terms */}
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-dim) text-center mt-5 mb-3">
            By confirming you agree to our{" "}
            <span className="text-(--kwm-ink-3) cursor-pointer underline underline-offset-4 decoration-(--kwm-hl)">
              Terms
            </span>
          </p>

          {/* Confirm — green when actionable, neutral disabled */}
          <button
            type="button"
            onClick={onDeposit}
            disabled={
              !bridgeAddress ||
              !isWalletReady ||
              isProcessing ||
              isPending ||
              isConfirming ||
              isOnChainConfirmed ||
              isConfirmed
            }
            className={cn(
              "w-full h-11 rounded-md font-mono text-[11px] uppercase tracking-[0.18em] font-semibold transition-colors",
              isConfirmed
                ? "bg-(--kwm-up-soft) text-(--kwm-up) cursor-default border border-(--kwm-up-border)"
                : !bridgeAddress ||
                    !isWalletReady ||
                    isProcessing ||
                    isPending ||
                    isConfirming ||
                    isOnChainConfirmed
                  ? "bg-(--kwm-bg-3) text-(--kwm-ink-dim) cursor-not-allowed border border-(--kwm-hl)"
                  : "bg-(--kwm-up) text-(--kwm-bg) hover:opacity-90"
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
                {isDirectPusdDeposit ? "Finalizing" : "Waiting for Bridge"}
              </span>
            ) : isConfirming ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Confirming On-Chain
              </span>
            ) : isOnChainConfirmed ? (
              isDirectPusdDeposit ? (
                "Finalizing"
              ) : (
                "Bridge Update Pending"
              )
            ) : isConfirmed ? (
              <span className="inline-flex items-center gap-2">
                <Check className="h-3.5 w-3.5" />
                Deposit Complete
              </span>
            ) : !bridgeAddress ? (
              isDirectPusdDeposit ? (
                "Loading Wallet"
              ) : (
                "Loading Bridge"
              )
            ) : !isWalletReady ? (
              "Wallet Loading"
            ) : (
              "Confirm Deposit"
            )}
          </button>
        </>
      ) : null}
    </motion.div>
  );
}
