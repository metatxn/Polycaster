"use client";

import { createLogger } from "@knoww/logger";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "wagmi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getAvailableTokensForChain,
  resolveDestTokenAddress,
  useWithdraw,
  WITHDRAW_CHAIN_IDS,
  WITHDRAW_TOKEN_CONFIGS,
  type WithdrawTokenId,
} from "@/hooks/use-withdraw";
import { cn } from "@/lib/utils";

const log = createLogger("withdraw-modal");

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWithdrawComplete?: () => void;
}

const TOKEN_DISPLAY: Record<
  WithdrawTokenId,
  { icon: string | null; fallback: string }
> = {
  usdc: { icon: "/usdc-token.webp", fallback: "USDC" },
  "usdc-e": { icon: "/usdc-token.webp", fallback: "USDC" },
  usdt: { icon: null, fallback: "USDT" },
  dai: { icon: null, fallback: "DAI" },
  eth: { icon: null, fallback: "ETH" },
  pol: { icon: null, fallback: "POL" },
  sol: { icon: null, fallback: "SOL" },
};

const WITHDRAW_CHAINS = [
  { id: "polygon", name: "Polygon", code: "POLYGON" },
  { id: "ethereum", name: "Ethereum", code: "ETH" },
  { id: "base", name: "Base", code: "BASE" },
  { id: "arbitrum", name: "Arbitrum", code: "ARB" },
  { id: "optimism", name: "Optimism", code: "OPT" },
  { id: "bsc", name: "BSC", code: "BSC" },
  { id: "solana", name: "Solana", code: "SOL" },
] as const;

type WithdrawChain = (typeof WITHDRAW_CHAINS)[number];

const CHAIN_EXPLORER_URLS: Record<WithdrawChain["id"], string> = {
  polygon: "https://polygonscan.com/tx/",
  ethereum: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  bsc: "https://bscscan.com/tx/",
  solana: "https://explorer.solana.com/tx/",
};

const CHAIN_EXPLORER_NAMES: Record<WithdrawChain["id"], string> = {
  polygon: "Polygonscan",
  ethereum: "Etherscan",
  base: "Basescan",
  arbitrum: "Arbiscan",
  optimism: "Optimism Explorer",
  bsc: "BscScan",
  solana: "Solana Explorer",
};

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

interface AccentNoteProps {
  color: "blue" | "amber" | "emerald" | "red";
  caption: string;
  children: React.ReactNode;
}

/**
 * Accent note — bordered+tinted callout for advisories. Theme-safe via
 * the `--kwm-*` signal tokens so all 9 themes get correct contrast.
 */
function AccentNote({ color, caption, children }: AccentNoteProps) {
  const palette = {
    blue: {
      border: "border-(--kwm-accent)/40",
      bg: "bg-(--kwm-accent-soft)",
      text: "text-(--kwm-accent)",
    },
    amber: {
      border: "border-(--kwm-warn-border)",
      bg: "bg-(--kwm-warn-soft)",
      text: "text-(--kwm-warn)",
    },
    emerald: {
      border: "border-(--kwm-up-border)",
      bg: "bg-(--kwm-up-soft)",
      text: "text-(--kwm-up)",
    },
    red: {
      border: "border-(--kwm-down)/40",
      bg: "bg-(--kwm-down-soft)",
      text: "text-(--kwm-down)",
    },
  }[color];

  return (
    <div
      className={cn("px-3 py-2 border rounded-md", palette.border, palette.bg)}
    >
      <p
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.14em] mb-1",
          palette.text
        )}
      >
        {caption}
      </p>
      <p className="text-sm text-(--kwm-ink) leading-snug">{children}</p>
    </div>
  );
}

export function WithdrawModal({
  open,
  onOpenChange,
  onWithdrawComplete,
}: WithdrawModalProps) {
  const { address } = useConnection();
  const {
    withdraw,
    reset,
    fetchWithdrawQuote,
    state,
    error,
    isWithdrawing,
    usdcBalance,
    canWithdraw,
    bridgeTokenIndex,
    quote,
    isLoadingQuote,
    bridgeTracking,
  } = useWithdraw();

  const [recipientAddress, setRecipientAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [selectedTokenId, setSelectedTokenId] =
    useState<WithdrawTokenId>("usdc");
  const [selectedChain, setSelectedChain] = useState<WithdrawChain>(
    WITHDRAW_CHAINS[0]
  );
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const completionNotifiedRef = useRef(false);

  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false);
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false);

  const availableTokens = useMemo(
    () => getAvailableTokensForChain(bridgeTokenIndex, selectedChain.id),
    [bridgeTokenIndex, selectedChain.id]
  );

  const selectedTokenConfig = WITHDRAW_TOKEN_CONFIGS[selectedTokenId];
  const selectedTokenDisplay = TOKEN_DISPLAY[selectedTokenId];

  useEffect(() => {
    if (!availableTokens.includes(selectedTokenId)) {
      setSelectedTokenId(availableTokens[0]);
    }
  }, [availableTokens, selectedTokenId]);

  useEffect(() => {
    if (!open) {
      setRecipientAddress("");
      setAmount("");
      setSelectedTokenId("usdc");
      setSelectedChain(WITHDRAW_CHAINS[0]);
      setTxHash(null);
      setShowSuccess(false);
      completionNotifiedRef.current = false;
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (
      state === "confirmed" ||
      state === "bridging" ||
      state === "bridge_complete"
    ) {
      setShowSuccess(true);
    }
  }, [state]);

  useEffect(() => {
    if (
      completionNotifiedRef.current ||
      (state !== "confirmed" &&
        state !== "bridging" &&
        state !== "bridge_complete")
    ) {
      return;
    }

    completionNotifiedRef.current = true;
    onWithdrawComplete?.();
  }, [state, onWithdrawComplete]);

  const amountNum = useMemo(() => Number.parseFloat(amount) || 0, [amount]);

  const isValidAmount = useMemo(() => {
    return amountNum > 0 && amountNum <= usdcBalance;
  }, [amountNum, usdcBalance]);

  const isValidAddress = useMemo(() => {
    if (!recipientAddress) return false;
    if (selectedChain.id === "solana") {
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
      return base58Regex.test(recipientAddress);
    }
    return /^0x[a-fA-F0-9]{40}$/.test(recipientAddress);
  }, [recipientAddress, selectedChain.id]);

  const isCrossChain = useMemo(
    () => selectedChain.id !== "polygon",
    [selectedChain.id]
  );

  const canProceed = useMemo(() => {
    return isValidAmount && amountNum >= 2 && isValidAddress && canWithdraw;
  }, [isValidAmount, amountNum, isValidAddress, canWithdraw]);

  const withdrawDebugParams = useMemo(() => {
    const toChainId = WITHDRAW_CHAIN_IDS[selectedChain.id] || "137";
    const resolvedToTokenAddress = resolveDestTokenAddress(
      bridgeTokenIndex,
      toChainId,
      selectedTokenId
    );
    const fallbackToTokenAddress =
      toChainId === "137" ? selectedTokenConfig.address : "";
    const toTokenAddress = resolvedToTokenAddress || fallbackToTokenAddress;

    return {
      amount,
      amountNum,
      recipientAddress,
      selectedChainId: selectedChain.id,
      selectedChainName: selectedChain.name,
      selectedTokenId,
      selectedTokenSymbol: selectedTokenConfig.symbol,
      toChainId,
      toTokenAddress,
      resolvedToTokenAddress,
      fallbackToTokenAddress,
      canProceed,
      canWithdraw,
      isValidAddress,
      isValidAmount,
      availableBalance: usdcBalance,
      quoteId: quote?.quoteId,
      quoteEstToTokenBaseUnit: quote?.estToTokenBaseUnit,
      quoteEstOutputUsd: quote?.estOutputUsd,
    };
  }, [
    amount,
    amountNum,
    recipientAddress,
    selectedChain.id,
    selectedChain.name,
    selectedTokenId,
    selectedTokenConfig.symbol,
    selectedTokenConfig.address,
    bridgeTokenIndex,
    canProceed,
    canWithdraw,
    isValidAddress,
    isValidAmount,
    usdcBalance,
    quote?.quoteId,
    quote?.estToTokenBaseUnit,
    quote?.estOutputUsd,
  ]);

  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (quoteTimerRef.current) {
      clearTimeout(quoteTimerRef.current);
    }

    const toChainId = WITHDRAW_CHAIN_IDS[selectedChain.id] || "137";
    const toTokenAddress =
      resolveDestTokenAddress(bridgeTokenIndex, toChainId, selectedTokenId) ||
      (toChainId === "137"
        ? WITHDRAW_TOKEN_CONFIGS[selectedTokenId].address
        : "");

    if (
      !amountNum ||
      amountNum <= 0 ||
      !toTokenAddress ||
      !recipientAddress ||
      !isValidAddress
    ) {
      return;
    }

    quoteTimerRef.current = setTimeout(() => {
      fetchWithdrawQuote(amount, toChainId, toTokenAddress, recipientAddress);
    }, 600);

    return () => {
      if (quoteTimerRef.current) {
        clearTimeout(quoteTimerRef.current);
      }
    };
  }, [
    amount,
    amountNum,
    selectedChain.id,
    selectedTokenId,
    recipientAddress,
    isValidAddress,
    bridgeTokenIndex,
    fetchWithdrawQuote,
  ]);

  const estimatedReceive = useMemo(() => {
    if (quote) {
      const tokenConfig = WITHDRAW_TOKEN_CONFIGS[selectedTokenId];
      const baseUnit = BigInt(quote.estToTokenBaseUnit);
      const divisor = BigInt(10 ** tokenConfig.decimals);
      const whole = baseUnit / divisor;
      const remainder = baseUnit % divisor;
      const decimalStr = remainder
        .toString()
        .padStart(tokenConfig.decimals, "0");
      const significantDecimals = Math.min(tokenConfig.decimals, 6);
      return `${whole}.${decimalStr.slice(0, significantDecimals)}`;
    }
    if (!amountNum || amountNum <= 0) return "—";
    return `~${amountNum.toFixed(2)}`;
  }, [quote, amountNum, selectedTokenId]);

  const estimatedTime = useMemo(() => {
    if (quote) {
      const seconds = Math.round(quote.estCheckoutTimeMs / 1000);
      if (seconds < 60) return `~${seconds}s`;
      return `~${Math.round(seconds / 60)} min`;
    }
    return isCrossChain ? "10–30 min" : "~5 min";
  }, [quote, isCrossChain]);

  const totalFeeUsd = useMemo(() => {
    if (!quote) return null;
    const fee = quote.estFeeBreakdown;
    const total = fee.appFeeUsd + fee.fillCostUsd + fee.gasUsd;
    if (total < 0.01) return "Free";
    return `$${total.toFixed(2)}`;
  }, [quote]);

  const HIGH_IMPACT_BPS_THRESHOLD = 0.1;
  const highImpactPercent = useMemo(() => {
    if (!quote) return null;
    const impact = quote.estFeeBreakdown.totalImpact;
    return impact > HIGH_IMPACT_BPS_THRESHOLD ? impact : null;
  }, [quote]);

  const LARGE_WITHDRAWAL_THRESHOLD_USD = 50_000;
  const isLargeWithdrawal = amountNum > LARGE_WITHDRAWAL_THRESHOLD_USD;

  const explorerChainId =
    state === "bridge_complete" && bridgeTracking.transactionHash
      ? selectedChain.id
      : "polygon";
  const explorerTxHash =
    state === "bridge_complete" && bridgeTracking.transactionHash
      ? bridgeTracking.transactionHash
      : txHash;
  const explorerLabel =
    state === "bridge_complete" && bridgeTracking.transactionHash
      ? `View destination on ${CHAIN_EXPLORER_NAMES[explorerChainId]}`
      : `View source transfer on ${CHAIN_EXPLORER_NAMES.polygon}`;

  const handleUseConnected = useCallback(() => {
    if (address) setRecipientAddress(address);
  }, [address]);

  const handleMaxAmount = useCallback(() => {
    setAmount(usdcBalance.toFixed(6));
  }, [usdcBalance]);

  const handlePercentage = useCallback(
    (percent: number) => {
      const value = (usdcBalance * percent) / 100;
      setAmount(value.toFixed(6));
    },
    [usdcBalance]
  );

  const selectedChainId = selectedChain.id;

  const handleWithdraw = useCallback(async () => {
    log.info("submit.clicked", withdrawDebugParams);
    if (!canProceed) {
      log.warn("submit.blocked", withdrawDebugParams);
      return;
    }
    const result = await withdraw({
      amount,
      destinationAddress: recipientAddress,
      tokenId: selectedTokenId,
      chainId: selectedChainId,
    });
    log.info("submit.result", {
      ...withdrawDebugParams,
      success: result.success,
      transactionHash: result.transactionHash,
      bridgeDepositAddress: result.bridgeDepositAddress,
      error: result.error,
    });
    if (result.transactionHash) setTxHash(result.transactionHash);
  }, [
    canProceed,
    withdrawDebugParams,
    amount,
    recipientAddress,
    withdraw,
    selectedTokenId,
    selectedChainId,
  ]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const getButtonLabel = (): React.ReactNode => {
    if (state === "signing")
      return (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Creating Bridge Withdrawal
        </span>
      );
    if (state === "submitting")
      return (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Sending to Bridge
        </span>
      );
    if (state === "pending")
      return (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Bridge Routing Funds
        </span>
      );
    if (!recipientAddress) return "Enter Recipient Address";
    if (!isValidAddress) return "Invalid Address";
    if (!amount || amountNum <= 0) return "Enter Amount";
    if (amountNum < 2) return "Minimum · $2";
    if (amountNum > usdcBalance) return "Insufficient Balance";
    return "Withdraw";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/60 backdrop-blur-md"
        className="sm:max-w-[440px] max-h-[calc(100dvh-32px)] p-0 gap-0 overflow-hidden rounded-md border border-border shadow-[0_40px_80px_-30px_rgba(0,0,0,0.55)] flex flex-col bg-(--kwm-panel)"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="kw-app flex flex-col flex-1 min-h-0 bg-(--kwm-panel) text-(--kwm-ink)">
          {/* Header — mono-caps eyebrow + clean sans balance title,
              matching the deposit modal and onboarding chrome. */}
          <div className="relative flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-(--kwm-hl) shrink-0">
            <div className="w-7 flex items-center justify-start">
              {showSuccess ? null : (
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-(--kwm-hl) text-(--kwm-ink-2) hover:text-(--kwm-ink) hover:border-(--kwm-hl-2) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--kwm-ink) focus-visible:ring-offset-2 focus-visible:ring-offset-(--kwm-panel)"
                  aria-label="Go back"
                >
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.4} />
                </button>
              )}
            </div>
            <div className="flex flex-col items-center justify-center flex-1 min-w-0 gap-0.5">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
                <span className="text-(--kwm-ink-2)">§</span>
                <span>Withdraw</span>
                <span className="text-(--kwm-ink-dim)">·</span>
                <span className="text-(--kwm-ink-3)">
                  {showSuccess ? "Sent" : "Form"}
                </span>
              </span>
              <DialogTitle className="font-(family-name:--font-geist) text-[15px] font-semibold tracking-tight text-(--kwm-ink) leading-tight truncate max-w-full">
                ${usdcBalance.toFixed(2)}{" "}
                <span className="font-normal text-(--kwm-ink-3) text-[12px]">
                  balance
                </span>
              </DialogTitle>
              <DialogDescription className="sr-only">
                Withdraw funds from your Polymarket trading wallet.
              </DialogDescription>
            </div>
            <div className="w-7 flex items-center justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-(--kwm-hl) text-(--kwm-ink-2) hover:text-(--kwm-ink) hover:border-(--kwm-hl-2) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--kwm-ink) focus-visible:ring-offset-2 focus-visible:ring-offset-(--kwm-panel)"
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.4} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-5 py-5 flex-1 min-h-0 overflow-y-auto">
            <AnimatePresence mode="wait">
              {showSuccess ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col"
                >
                  {/* Success headline — clean Geist sans (no italic) */}
                  <div className="flex flex-col items-center py-6 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2) mb-4">
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.14em] mb-2",
                        state === "bridge_complete"
                          ? "text-(--kwm-up)"
                          : "text-(--kwm-accent)"
                      )}
                    >
                      {state === "bridge_complete"
                        ? "Withdrawal Complete"
                        : "Sent to Bridge"}
                    </span>
                    <span className="text-lg font-semibold leading-snug text-(--kwm-ink) text-center max-w-[300px] tracking-tight">
                      {state === "bridge_complete"
                        ? `Your ${selectedTokenConfig.symbol} landed on ${selectedChain.name}.`
                        : `${amount} pUSD sent to the bridge - ${selectedTokenConfig.symbol} is arriving shortly.`}
                    </span>
                  </div>

                  {/* Tracking strip */}
                  {state !== "bridge_complete" && bridgeTracking.status ? (
                    <div className="flex items-center justify-center gap-2 border border-(--kwm-hl) rounded-md py-2.5 mb-4 bg-(--kwm-bg-2)">
                      <Loader2 className="h-3 w-3 animate-spin text-(--kwm-accent)" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
                        {bridgeTracking.status === "DEPOSIT_DETECTED" &&
                          "Deposit detected"}
                        {bridgeTracking.status === "PROCESSING" &&
                          "Bridge processing"}
                        {bridgeTracking.status === "ORIGIN_TX_CONFIRMED" &&
                          "Origin confirmed"}
                        {bridgeTracking.status === "SUBMITTED" &&
                          `Submitting · ${selectedChain.code}`}
                      </span>
                    </div>
                  ) : null}

                  {state !== "bridge_complete" && !bridgeTracking.status ? (
                    <div className="flex items-center justify-center gap-2 border border-(--kwm-hl) rounded-md py-2.5 mb-4 bg-(--kwm-bg-2)">
                      <Loader2 className="h-3 w-3 animate-spin text-(--kwm-accent)" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
                        Waiting for Bridge
                      </span>
                    </div>
                  ) : null}

                  {/* Explorer link */}
                  {explorerTxHash ? (
                    <a
                      href={`${CHAIN_EXPLORER_URLS[explorerChainId]}${explorerTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-ink-2) hover:text-(--kwm-ink) transition-colors mb-4"
                    >
                      <span className="underline underline-offset-4 decoration-(--kwm-hl)">
                        {explorerLabel}
                      </span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}

                  {/* Close CTA */}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-full h-11 rounded-md bg-(--kwm-ink) text-(--kwm-bg) font-mono text-[11px] uppercase tracking-[0.18em] font-semibold hover:opacity-90 transition-colors"
                  >
                    {state === "bridge_complete" ? "Done" : "Close"}
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col"
                >
                  {/* Recipient Address — bordered input card */}
                  <div className="mb-4">
                    <label
                      htmlFor="recipient-address"
                      className="block font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) mb-2"
                    >
                      Recipient Address
                    </label>
                    <div className="flex items-center gap-3 px-3 h-10 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2) focus-within:border-(--kwm-hl-3) transition-colors">
                      <input
                        id="recipient-address"
                        type="text"
                        value={recipientAddress}
                        onChange={(e) => setRecipientAddress(e.target.value)}
                        placeholder={
                          selectedChain.id === "solana"
                            ? "Solana address"
                            : "0x..."
                        }
                        className="flex-1 min-w-0 h-full bg-transparent border-none focus:outline-none font-mono text-sm text-(--kwm-ink) placeholder:text-(--kwm-ink-dim)"
                      />
                      {selectedChain.id !== "solana" && address ? (
                        <button
                          type="button"
                          onClick={handleUseConnected}
                          className="shrink-0 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink) hover:opacity-80 transition-opacity"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-(--kwm-up)" />
                          Use Connected
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Amount — clean Geist sans large display */}
                  <div className="mb-3">
                    <div className="flex items-baseline justify-between mb-2">
                      <label
                        htmlFor="withdraw-amount"
                        className="block font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)"
                      >
                        Amount · {selectedTokenConfig.symbol}
                      </label>
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) tabular-nums">
                        Balance · {usdcBalance.toFixed(2)} pUSD
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 px-3.5 py-3 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2) focus-within:border-(--kwm-hl-3) transition-colors">
                      <input
                        id="withdraw-amount"
                        type="text"
                        value={amount}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9.]/g, "");
                          const val = raw.replace(/\.(?=.*\.)/g, "");
                          setAmount(val);
                        }}
                        placeholder="0.00"
                        className="flex-1 min-w-0 h-10 bg-transparent border-none focus:outline-none font-(family-name:--font-geist) text-3xl font-semibold tracking-tight text-(--kwm-ink) tabular-nums placeholder:text-(--kwm-ink-dim)"
                      />
                      <button
                        type="button"
                        onClick={handleMaxAmount}
                        className="shrink-0 h-7 px-2 rounded-sm font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) hover:text-(--kwm-ink) hover:bg-(--kwm-bg-3) transition-colors"
                      >
                        Max
                      </button>
                    </div>
                    <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-dim) tabular-nums">
                      ${amountNum > 0 ? amountNum.toFixed(2) : "0.00"}
                    </p>
                  </div>

                  {/* Percent strip — small ghost buttons */}
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {[25, 50, 75, 100].map((percent) => (
                      <button
                        key={percent}
                        type="button"
                        onClick={() => handlePercentage(percent)}
                        className="h-8 px-3 rounded-md border border-(--kwm-hl) font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-ink-3) hover:text-(--kwm-ink) hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-2) transition-colors"
                      >
                        {percent === 100 ? "Max" : `${percent}`}
                      </button>
                    ))}
                  </div>

                  {/* Token + Chain pickers — bordered dropdowns */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
                        Receive Token
                      </span>
                      <DropdownMenu
                        open={tokenDropdownOpen}
                        onOpenChange={setTokenDropdownOpen}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between gap-2 h-10 px-3 rounded-md border border-(--kwm-hl) bg-(--kwm-bg-2) hover:border-(--kwm-hl-3) transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {selectedTokenDisplay.icon ? (
                                <Image
                                  src={selectedTokenDisplay.icon}
                                  alt={selectedTokenConfig.symbol}
                                  width={20}
                                  height={20}
                                  className="rounded-full shrink-0"
                                />
                              ) : null}
                              <span className="text-sm font-medium text-(--kwm-ink) truncate">
                                {selectedTokenConfig.symbol}
                              </span>
                            </div>
                            <ChevronDown className="h-3.5 w-3.5 text-(--kwm-ink-3)" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className="kw-app w-(--radix-dropdown-menu-trigger-width) min-w-(--radix-dropdown-menu-trigger-width) bg-(--kwm-panel) border border-(--kwm-hl-2) rounded-md p-1 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.55)]"
                        >
                          {availableTokens.map((tokenId) => {
                            const config = WITHDRAW_TOKEN_CONFIGS[tokenId];
                            const display = TOKEN_DISPLAY[tokenId];
                            const isActive = selectedTokenId === tokenId;
                            return (
                              <DropdownMenuItem
                                key={tokenId}
                                onClick={() => setSelectedTokenId(tokenId)}
                                className="flex items-center gap-2 cursor-pointer rounded-sm focus:bg-(--kwm-bg-3) text-(--kwm-ink)"
                              >
                                {display.icon ? (
                                  <Image
                                    src={display.icon}
                                    alt={config.symbol}
                                    width={18}
                                    height={18}
                                    className="rounded-full shrink-0"
                                  />
                                ) : (
                                  <span className="w-[18px] h-[18px] shrink-0 rounded-full bg-(--kwm-bg-3) flex items-center justify-center font-mono text-[8px] uppercase tracking-widest text-(--kwm-ink-2)">
                                    {display.fallback.slice(0, 2)}
                                  </span>
                                )}
                                <div className="flex flex-col min-w-0">
                                  <span
                                    className={cn(
                                      "text-sm font-medium leading-none",
                                      isActive
                                        ? "text-(--kwm-ink)"
                                        : "text-(--kwm-ink-2)"
                                    )}
                                  >
                                    {config.symbol}
                                  </span>
                                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-(--kwm-ink-3) truncate mt-1">
                                    {config.name}
                                  </span>
                                </div>
                                {isActive ? (
                                  <Check className="h-3.5 w-3.5 text-(--kwm-ink) ml-auto shrink-0" />
                                ) : null}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
                        {isCrossChain ? "Destination" : "Chain"}
                      </span>
                      <DropdownMenu
                        open={chainDropdownOpen}
                        onOpenChange={setChainDropdownOpen}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between gap-2 h-10 px-3 rounded-md border border-(--kwm-hl) bg-(--kwm-bg-2) hover:border-(--kwm-hl-3) transition-colors"
                          >
                            <span className="text-sm font-medium text-(--kwm-ink) truncate">
                              {selectedChain.name}
                            </span>
                            <ChevronDown className="h-3.5 w-3.5 text-(--kwm-ink-3)" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className="kw-app w-(--radix-dropdown-menu-trigger-width) min-w-(--radix-dropdown-menu-trigger-width) bg-(--kwm-panel) border border-(--kwm-hl-2) rounded-md p-1 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.55)]"
                        >
                          {WITHDRAW_CHAINS.map((chain) => {
                            const isActive = selectedChain.id === chain.id;
                            return (
                              <DropdownMenuItem
                                key={chain.id}
                                onClick={() => setSelectedChain(chain)}
                                className="flex items-center justify-between cursor-pointer rounded-sm focus:bg-(--kwm-bg-3) text-(--kwm-ink)"
                              >
                                <span className="text-sm font-medium text-(--kwm-ink) truncate">
                                  {chain.name}
                                </span>
                                {isActive ? (
                                  <Check className="h-3.5 w-3.5 text-(--kwm-ink) shrink-0" />
                                ) : null}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Info note */}
                  <div className="mb-3">
                    <AccentNote color="blue" caption="Polymarket Bridge">
                      {isCrossChain
                        ? `pUSD converts to ${selectedTokenConfig.symbol} and routes to ${selectedChain.name} — typically 10–30 minutes.`
                        : `pUSD converts to ${selectedTokenConfig.symbol} on Polygon.`}
                    </AccentNote>
                  </div>

                  {/* High-impact warning */}
                  {highImpactPercent !== null ? (
                    <div className="mb-3">
                      <AccentNote
                        color="amber"
                        caption={`Output Differs · ${highImpactPercent.toFixed(2)}%`}
                      >
                        Bridge quote shows more than 10bp swap impact — confirm
                        the estimated receive amount before proceeding.
                      </AccentNote>
                    </div>
                  ) : null}

                  {/* Large-withdrawal advisory */}
                  {isLargeWithdrawal ? (
                    <div className="mb-3">
                      <AccentNote color="amber" caption="Large Withdrawal">
                        Polymarket recommends splitting withdrawals over $
                        {LARGE_WITHDRAWAL_THRESHOLD_USD.toLocaleString()} into
                        smaller portions for better routing and execution.
                      </AccentNote>
                    </div>
                  ) : null}

                  {/* Summary — bordered card with hairline detail rows */}
                  <div className="mb-4 px-3.5 py-1 border border-(--kwm-hl) rounded-md bg-(--kwm-bg-2)">
                    <DetailRow label="You Receive">
                      {isLoadingQuote ? (
                        <Loader2 className="h-3 w-3 animate-spin inline" />
                      ) : (
                        `${estimatedReceive} ${selectedTokenConfig.symbol}`
                      )}
                    </DetailRow>
                    <DetailRow label="Destination">
                      {selectedChain.name}
                    </DetailRow>
                    <DetailRow label="Fee" muted>
                      {isLoadingQuote ? (
                        <Loader2 className="h-3 w-3 animate-spin inline" />
                      ) : (
                        (totalFeeUsd ?? "Free · Gasless")
                      )}
                    </DetailRow>
                    <DetailRow label="Est. Time" muted>
                      {isLoadingQuote ? (
                        <Loader2 className="h-3 w-3 animate-spin inline" />
                      ) : (
                        estimatedTime
                      )}
                    </DetailRow>
                  </div>

                  {/* Error */}
                  {error ? (
                    <div className="mb-3">
                      <AccentNote color="red" caption="Withdrawal Failed">
                        {error}
                      </AccentNote>
                    </div>
                  ) : null}

                  {/* Withdraw CTA — green when actionable */}
                  <button
                    type="button"
                    onClick={handleWithdraw}
                    disabled={!canProceed || isWithdrawing}
                    className={cn(
                      "w-full h-11 rounded-md font-mono text-[11px] uppercase tracking-[0.18em] font-semibold transition-colors",
                      isWithdrawing
                        ? "bg-(--kwm-up-soft) text-(--kwm-up) cursor-wait border border-(--kwm-up-border)"
                        : canProceed
                          ? "bg-(--kwm-up) text-(--kwm-bg) hover:opacity-90"
                          : "bg-(--kwm-bg-3) text-(--kwm-ink-dim) cursor-not-allowed border border-(--kwm-hl)"
                    )}
                  >
                    {getButtonLabel()}
                  </button>

                  {state === "pending" && txHash ? (
                    <div className="flex justify-center mt-3">
                      <a
                        href={`${CHAIN_EXPLORER_URLS.polygon}${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-2) hover:text-(--kwm-ink) transition-colors"
                      >
                        <span className="underline underline-offset-4 decoration-(--kwm-hl)">
                          Track on {CHAIN_EXPLORER_NAMES.polygon}
                        </span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
