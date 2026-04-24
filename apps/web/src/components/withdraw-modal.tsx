"use client";

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

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

interface AccentNoteProps {
  color: "blue" | "amber" | "emerald" | "red";
  caption: string;
  children: React.ReactNode;
}

function AccentNote({ color, caption, children }: AccentNoteProps) {
  const borderClass = {
    blue: "border-blue-500",
    amber: "border-amber-500",
    emerald: "border-emerald-500",
    red: "border-red-500",
  }[color];
  const captionClass = {
    blue: "text-blue-500",
    amber: "text-amber-500",
    emerald: "text-emerald-500",
    red: "text-red-500",
  }[color];

  return (
    <div className={cn("border-l-2 pl-3 py-2", borderClass)}>
      <p
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.14em] mb-1",
          captionClass
        )}
      >
        {caption}
      </p>
      <p className="text-sm text-foreground leading-snug">{children}</p>
    </div>
  );
}

export function WithdrawModal({ open, onOpenChange }: WithdrawModalProps) {
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

  const canProceed = useMemo(() => {
    return isValidAmount && amountNum >= 2 && isValidAddress && canWithdraw;
  }, [isValidAmount, amountNum, isValidAddress, canWithdraw]);

  const isCrossChain = useMemo(
    () => selectedChain.id !== "polygon",
    [selectedChain.id]
  );

  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (quoteTimerRef.current) {
      clearTimeout(quoteTimerRef.current);
    }

    const toChainId = WITHDRAW_CHAIN_IDS[selectedChain.id] || "137";
    const toTokenAddress = resolveDestTokenAddress(
      bridgeTokenIndex,
      toChainId,
      selectedTokenId
    );

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
    if (!canProceed) return;
    const result = await withdraw({
      amount,
      destinationAddress: recipientAddress,
      tokenId: selectedTokenId,
      chainId: selectedChainId,
    });
    if (result.transactionHash) setTxHash(result.transactionHash);
  }, [
    canProceed,
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
        className="sm:max-w-[440px] max-h-[calc(100dvh-32px)] p-0 gap-0 overflow-hidden bg-background border-border/60 rounded-none flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
          <div className="w-6 flex items-center justify-start">
            {showSuccess ? null : (
              <button
                type="button"
                onClick={handleClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-col items-center justify-center flex-1 min-w-0 gap-1">
            <DialogTitle className="font-editorial italic text-2xl leading-none text-foreground">
              Withdraw
            </DialogTitle>
            <DialogDescription className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
              Balance · ${usdcBalance.toFixed(2)}
            </DialogDescription>
          </div>
          <div className="w-6 flex items-center justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
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
                {/* Editorial success headline */}
                <div className="flex flex-col items-center py-8 border-y border-border/40 mb-5">
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-[0.14em] mb-3",
                      state === "bridge_complete"
                        ? "text-emerald-500"
                        : "text-blue-500"
                    )}
                  >
                    {state === "bridge_complete"
                      ? "Withdrawal Complete"
                      : "Sent to Bridge"}
                  </span>
                  <span className="text-xl font-semibold leading-snug text-foreground text-center max-w-[300px]">
                    {state === "bridge_complete"
                      ? `Your ${selectedTokenConfig.symbol} landed on ${selectedChain.name}.`
                      : `${amount} pUSD routed to ${selectedChain.name} — arriving shortly.`}
                  </span>
                </div>

                {/* Tracking strip */}
                {state !== "bridge_complete" && bridgeTracking.status ? (
                  <div className="flex items-center justify-center gap-2 border-y border-border/40 py-3 mb-5">
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
                  <div className="flex items-center justify-center gap-2 border-y border-border/40 py-3 mb-5">
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Waiting for Bridge
                    </span>
                  </div>
                ) : null}

                {/* Explorer link */}
                {txHash ? (
                  <a
                    href={`${CHAIN_EXPLORER_URLS.polygon}${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground hover:text-muted-foreground transition-colors mb-5"
                  >
                    <span className="underline underline-offset-4 decoration-border">
                      View on {CHAIN_EXPLORER_NAMES.polygon}
                    </span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}

                {/* Close CTA */}
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-full h-12 bg-foreground text-background font-mono text-[11px] uppercase tracking-[0.18em] hover:bg-foreground/90 transition-colors"
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
                {/* Recipient Address — underline input */}
                <div className="mb-6">
                  <label
                    htmlFor="recipient-address"
                    className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2"
                  >
                    Recipient Address
                  </label>
                  <div className="flex items-center gap-3 border-b border-border/60 focus-within:border-foreground transition-colors">
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
                      className="flex-1 min-w-0 h-10 bg-transparent border-none focus:outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/70"
                    />
                    {selectedChain.id !== "solana" && address ? (
                      <button
                        type="button"
                        onClick={handleUseConnected}
                        className="shrink-0 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground hover:text-muted-foreground transition-colors"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="underline underline-offset-4 decoration-border">
                          Use Connected
                        </span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Amount — large italic with underline input */}
                <div className="mb-5">
                  <div className="flex items-baseline justify-between mb-2">
                    <label
                      htmlFor="withdraw-amount"
                      className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      Amount · {selectedTokenConfig.symbol}
                    </label>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
                      Balance · {usdcBalance.toFixed(2)} pUSD
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 border-b border-border/60 focus-within:border-foreground transition-colors">
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
                      className="flex-1 min-w-0 h-12 bg-transparent border-none focus:outline-none font-editorial italic text-3xl text-foreground tabular-nums placeholder:text-muted-foreground/40"
                    />
                    <button
                      type="button"
                      onClick={handleMaxAmount}
                      className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground hover:text-muted-foreground transition-colors underline underline-offset-4 decoration-border"
                    >
                      Max
                    </button>
                  </div>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
                    ${amountNum > 0 ? amountNum.toFixed(2) : "0.00"}
                  </p>
                </div>

                {/* Percent strip */}
                <div className="flex items-center gap-6 sm:gap-8 py-3 border-y border-border/40 mb-6">
                  {[25, 50, 75, 100].map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      onClick={() => handlePercentage(percent)}
                      className="font-mono text-[11px] uppercase tracking-[0.14em] leading-none text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {percent === 100 ? "Max" : `${percent}`}
                    </button>
                  ))}
                </div>

                {/* Token + Chain pickers — hairline dropdowns */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Receive Token
                    </span>
                    <DropdownMenu
                      open={tokenDropdownOpen}
                      onOpenChange={setTokenDropdownOpen}
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="w-full flex items-center justify-between h-10 border-b border-border/60 hover:border-foreground transition-colors"
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
                            <span className="text-sm font-medium text-foreground truncate">
                              {selectedTokenConfig.symbol}
                            </span>
                          </div>
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-(--radix-dropdown-menu-trigger-width) min-w-(--radix-dropdown-menu-trigger-width) bg-popover border-border/60 rounded-none"
                      >
                        {availableTokens.map((tokenId) => {
                          const config = WITHDRAW_TOKEN_CONFIGS[tokenId];
                          const display = TOKEN_DISPLAY[tokenId];
                          const isActive = selectedTokenId === tokenId;
                          return (
                            <DropdownMenuItem
                              key={tokenId}
                              onClick={() => setSelectedTokenId(tokenId)}
                              className="flex items-center gap-2 cursor-pointer rounded-none focus:bg-muted/60"
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
                                <span className="w-[18px] h-[18px] shrink-0 rounded-full bg-muted flex items-center justify-center font-mono text-[8px] uppercase tracking-widest text-foreground/80">
                                  {display.fallback.slice(0, 2)}
                                </span>
                              )}
                              <div className="flex flex-col min-w-0">
                                <span
                                  className={cn(
                                    "text-sm font-medium leading-none",
                                    isActive
                                      ? "text-foreground"
                                      : "text-foreground/90"
                                  )}
                                >
                                  {config.symbol}
                                </span>
                                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground truncate mt-1">
                                  {config.name}
                                </span>
                              </div>
                              {isActive ? (
                                <Check className="h-3.5 w-3.5 text-foreground ml-auto shrink-0" />
                              ) : null}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {isCrossChain ? "Destination" : "Chain"}
                    </span>
                    <DropdownMenu
                      open={chainDropdownOpen}
                      onOpenChange={setChainDropdownOpen}
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="w-full flex items-center justify-between h-10 border-b border-border/60 hover:border-foreground transition-colors"
                        >
                          <span className="text-sm font-medium text-foreground truncate">
                            {selectedChain.name}
                          </span>
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-(--radix-dropdown-menu-trigger-width) min-w-(--radix-dropdown-menu-trigger-width) bg-popover border-border/60 rounded-none"
                      >
                        {WITHDRAW_CHAINS.map((chain) => {
                          const isActive = selectedChain.id === chain.id;
                          return (
                            <DropdownMenuItem
                              key={chain.id}
                              onClick={() => setSelectedChain(chain)}
                              className="flex items-center justify-between cursor-pointer rounded-none focus:bg-muted/60"
                            >
                              <span className="text-sm font-medium text-foreground truncate">
                                {chain.name}
                              </span>
                              {isActive ? (
                                <Check className="h-3.5 w-3.5 text-foreground shrink-0" />
                              ) : null}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Info note */}
                <div className="mb-5">
                  <AccentNote color="blue" caption="Polymarket Bridge">
                    {isCrossChain
                      ? `pUSD converts to ${selectedTokenConfig.symbol} and routes to ${selectedChain.name} — typically 10–30 minutes.`
                      : `pUSD converts to ${selectedTokenConfig.symbol} on Polygon.`}
                  </AccentNote>
                </div>

                {/* High-impact warning */}
                {highImpactPercent !== null ? (
                  <div className="mb-5">
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
                  <div className="mb-5">
                    <AccentNote color="amber" caption="Large Withdrawal">
                      Polymarket recommends splitting withdrawals over $
                      {LARGE_WITHDRAWAL_THRESHOLD_USD.toLocaleString()} into
                      smaller portions for better routing and execution.
                    </AccentNote>
                  </div>
                ) : null}

                {/* Summary — hairline detail rows */}
                <div className="border-t border-border/40 mb-5">
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
                  <div className="mb-5">
                    <AccentNote color="red" caption="Withdrawal Failed">
                      {error}
                    </AccentNote>
                  </div>
                ) : null}

                {/* Withdraw button — decisive emerald */}
                <button
                  type="button"
                  onClick={handleWithdraw}
                  disabled={!canProceed || isWithdrawing}
                  className={cn(
                    "w-full h-12 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
                    isWithdrawing
                      ? "bg-emerald-500/60 text-white cursor-wait"
                      : canProceed
                        ? "bg-emerald-500 text-white hover:bg-emerald-600"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  {getButtonLabel()}
                </button>

                {state === "pending" && txHash ? (
                  <div className="flex justify-center mt-4">
                    <a
                      href={`${CHAIN_EXPLORER_URLS.polygon}${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground hover:text-muted-foreground transition-colors"
                    >
                      <span className="underline underline-offset-4 decoration-border">
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
      </DialogContent>
    </Dialog>
  );
}
