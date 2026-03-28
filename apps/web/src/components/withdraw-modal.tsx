"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
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
import { Button } from "@/components/ui/button";
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

/**
 * Display metadata for each token in the withdrawal dropdown.
 * `icon` is either a path to a public image or null (uses `emoji` fallback).
 */
const TOKEN_DISPLAY: Record<
  WithdrawTokenId,
  { emoji: string; icon: string | null; color: string }
> = {
  usdc: { emoji: "$", icon: "/usdc-token.webp", color: "#2775CA" },
  "usdc-e": { emoji: "$", icon: "/usdc-token.webp", color: "#2775CA" },
  usdt: { emoji: "₮", icon: null, color: "#26A17B" },
  dai: { emoji: "◈", icon: null, color: "#F5AC37" },
  eth: { emoji: "⟠", icon: null, color: "#627EEA" },
  pol: { emoji: "⬡", icon: null, color: "#8247E5" },
  sol: { emoji: "◎", icon: null, color: "#9945FF" },
};

// Supported chains for withdrawal
const WITHDRAW_CHAINS = [
  {
    id: "polygon",
    name: "Polygon",
    icon: "⬡",
    gradient: "from-purple-500 to-violet-600",
  },
  {
    id: "ethereum",
    name: "Ethereum",
    icon: "⟠",
    gradient: "from-blue-500 to-indigo-600",
  },
  {
    id: "base",
    name: "Base",
    icon: "🔵",
    gradient: "from-blue-500 to-blue-700",
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    icon: "🔷",
    gradient: "from-sky-400 to-blue-600",
  },
  {
    id: "optimism",
    name: "Optimism",
    icon: "🔴",
    gradient: "from-red-500 to-rose-600",
  },
  {
    id: "bsc",
    name: "BSC",
    icon: "⛓️",
    gradient: "from-yellow-400 to-amber-600",
  },
  {
    id: "solana",
    name: "Solana",
    icon: "◎",
    gradient: "from-purple-400 to-violet-600",
  },
] as const;

type WithdrawChain = (typeof WITHDRAW_CHAINS)[number];

// Block explorer URLs for each supported chain
const CHAIN_EXPLORER_URLS: Record<WithdrawChain["id"], string> = {
  polygon: "https://polygonscan.com/tx/",
  ethereum: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  bsc: "https://bscscan.com/tx/",
  solana: "https://explorer.solana.com/tx/",
};

// Explorer display names for each chain
const CHAIN_EXPLORER_NAMES: Record<WithdrawChain["id"], string> = {
  polygon: "Polygonscan",
  ethereum: "Etherscan",
  base: "Basescan",
  arbitrum: "Arbiscan",
  optimism: "Optimism Explorer",
  bsc: "BscScan",
  solana: "Solana Explorer",
};

/**
 * Get status display info based on withdrawal state
 */

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

  // Form state
  const [recipientAddress, setRecipientAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [selectedTokenId, setSelectedTokenId] =
    useState<WithdrawTokenId>("usdc");
  const [selectedChain, setSelectedChain] = useState<WithdrawChain>(
    WITHDRAW_CHAINS[0]
  );
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Dropdown open states
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false);
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false);

  const availableTokens = useMemo(
    () => getAvailableTokensForChain(bridgeTokenIndex, selectedChain.id),
    [bridgeTokenIndex, selectedChain.id]
  );

  const selectedTokenConfig = WITHDRAW_TOKEN_CONFIGS[selectedTokenId];
  const selectedTokenDisplay = TOKEN_DISPLAY[selectedTokenId];

  // When the chain changes, ensure the selected token is still valid
  useEffect(() => {
    if (!availableTokens.includes(selectedTokenId)) {
      setSelectedTokenId(availableTokens[0]);
    }
  }, [availableTokens, selectedTokenId]);

  // Reset state when modal opens/closes
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

  // Show success view once relayer confirms (bridge tracking starts automatically)
  useEffect(() => {
    if (
      state === "confirmed" ||
      state === "bridging" ||
      state === "bridge_complete"
    ) {
      setShowSuccess(true);
    }
  }, [state]);

  // Validation
  const amountNum = useMemo(() => Number.parseFloat(amount) || 0, [amount]);

  const isValidAmount = useMemo(() => {
    return amountNum > 0 && amountNum <= usdcBalance;
  }, [amountNum, usdcBalance]);

  const isValidAddress = useMemo(() => {
    if (!recipientAddress) return false;

    // Solana addresses are base58 encoded, typically 32-44 characters
    if (selectedChain.id === "solana") {
      // Base58 character set (excludes 0, O, I, l to avoid confusion)
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
      return base58Regex.test(recipientAddress);
    }

    // EVM chains use 0x-prefixed 40 hex character addresses
    return /^0x[a-fA-F0-9]{40}$/.test(recipientAddress);
  }, [recipientAddress, selectedChain.id]);

  const canProceed = useMemo(() => {
    return isValidAmount && amountNum >= 2 && isValidAddress && canWithdraw;
  }, [isValidAmount, amountNum, isValidAddress, canWithdraw]);

  const isCrossChain = useMemo(
    () => selectedChain.id !== "polygon",
    [selectedChain.id]
  );

  // Debounced quote fetching
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

  // Derive display values from quote or fallback
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
    if (!amountNum || amountNum <= 0) return "-";
    return `~${amountNum.toFixed(2)}`;
  }, [quote, amountNum, selectedTokenId]);

  const estimatedTime = useMemo(() => {
    if (quote) {
      const seconds = Math.round(quote.estCheckoutTimeMs / 1000);
      if (seconds < 60) return `~${seconds}s`;
      return `~${Math.round(seconds / 60)} min`;
    }
    return isCrossChain ? "10-30 minutes" : "~5 minutes";
  }, [quote, isCrossChain]);

  const totalFeeUsd = useMemo(() => {
    if (!quote) return null;
    const fee = quote.estFeeBreakdown;
    const total = fee.appFeeUsd + fee.fillCostUsd + fee.gasUsd;
    if (total < 0.01) return "Free";
    return `$${total.toFixed(2)}`;
  }, [quote]);

  // Handlers
  const handleUseConnected = useCallback(() => {
    if (address) {
      setRecipientAddress(address);
    }
  }, [address]);

  const handleMaxAmount = useCallback(() => {
    // Use 6 decimals to match USDC token precision and avoid truncation
    setAmount(usdcBalance.toFixed(6));
  }, [usdcBalance]);

  const handlePercentage = useCallback(
    (percent: number) => {
      const value = (usdcBalance * percent) / 100;
      // Use 6 decimals to match USDC token precision and avoid truncation
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

    if (result.transactionHash) {
      setTxHash(result.transactionHash);
    }
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

  const getButtonContent = (): {
    text: string | React.ReactNode;
    variant: "default" | "disabled" | "active";
  } => {
    if (state === "signing") {
      return {
        text: (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating bridge withdrawal...
          </span>
        ),
        variant: "active",
      };
    }
    if (state === "submitting") {
      return {
        text: (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending to bridge...
          </span>
        ),
        variant: "active",
      };
    }
    if (state === "pending") {
      return {
        text: (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Bridge is routing your funds...
          </span>
        ),
        variant: "active",
      };
    }
    if (!recipientAddress)
      return { text: "Enter Recipient Address", variant: "disabled" };
    if (!isValidAddress)
      return { text: "Invalid Address", variant: "disabled" };
    if (!amount || amountNum <= 0)
      return { text: "Enter Amount", variant: "disabled" };
    if (amountNum < 2) return { text: "Minimum $2", variant: "disabled" };
    if (amountNum > usdcBalance)
      return { text: "Insufficient Balance", variant: "disabled" };
    return { text: "Withdraw", variant: "default" };
  };

  const buttonContent = getButtonContent();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[420px] p-0 gap-0 overflow-hidden bg-background border-border"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header - matching deposit modal style */}
        <div className="relative h-[68px] border-b border-border flex items-center justify-between px-4 shrink-0">
          <div className="w-8 flex items-center justify-start">
            {showSuccess ? null : (
              <button
                type="button"
                onClick={handleClose}
                className="p-1.5 -ml-1.5 rounded-full hover:bg-secondary/80 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5 text-foreground" />
              </button>
            )}
          </div>
          <div className="flex flex-col items-center justify-center flex-1 min-w-0">
            <DialogTitle className="text-[17px] font-semibold text-foreground tracking-tight">
              Withdraw
            </DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground font-medium mt-0.5">
              Balance: ${usdcBalance.toFixed(2)}
            </DialogDescription>
          </div>
          <div className="w-8 flex items-center justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 -mr-1.5 rounded-full hover:bg-secondary/80 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[calc(100vh-120px)] overflow-y-auto">
          <AnimatePresence mode="wait">
            {showSuccess ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="py-8 text-center space-y-4"
              >
                <div className="flex justify-center">
                  <div
                    className={cn(
                      "w-16 h-16 rounded-full flex items-center justify-center",
                      state === "bridge_complete"
                        ? "bg-emerald-500/20"
                        : "bg-blue-500/20"
                    )}
                  >
                    {state === "bridge_complete" ? (
                      <Check className="h-8 w-8 text-emerald-500" />
                    ) : (
                      <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-foreground">
                    {state === "bridge_complete"
                      ? "Withdrawal Complete!"
                      : "Sent to Bridge!"}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    {state === "bridge_complete"
                      ? `Your ${selectedTokenConfig.symbol} has arrived on ${selectedChain.name}.`
                      : `${amount} USDC.e sent to Polymarket Bridge. Your ${selectedTokenConfig.symbol} will arrive on ${selectedChain.name} shortly.`}
                  </p>
                </div>

                {/* Bridge tracking progress */}
                {state !== "bridge_complete" && bridgeTracking.status ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-400 shrink-0" />
                    <span className="text-sm text-muted-foreground">
                      {bridgeTracking.status === "DEPOSIT_DETECTED" &&
                        "Deposit detected by bridge..."}
                      {bridgeTracking.status === "PROCESSING" &&
                        "Bridge is processing your funds..."}
                      {bridgeTracking.status === "ORIGIN_TX_CONFIRMED" &&
                        "Origin transaction confirmed..."}
                      {bridgeTracking.status === "SUBMITTED" &&
                        `Submitting to ${selectedChain.name}...`}
                    </span>
                  </div>
                ) : null}

                {state !== "bridge_complete" && !bridgeTracking.status ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-400 shrink-0" />
                    <span className="text-sm text-muted-foreground">
                      Waiting for bridge to detect deposit...
                    </span>
                  </div>
                ) : null}

                {txHash ? (
                  <a
                    href={`${CHAIN_EXPLORER_URLS.polygon}${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
                  >
                    View on {CHAIN_EXPLORER_NAMES.polygon}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
                <Button
                  onClick={handleClose}
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl"
                >
                  {state === "bridge_complete" ? "Done" : "Close"}
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-5"
              >
                {/* Recipient Address */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Recipient address
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={recipientAddress}
                      onChange={(e) => setRecipientAddress(e.target.value)}
                      placeholder={
                        selectedChain.id === "solana"
                          ? "Solana address..."
                          : "0x..."
                      }
                      className="flex-1 min-w-0 h-12 px-4 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary font-mono text-sm truncate"
                    />
                    {selectedChain.id !== "solana" ? (
                      <button
                        type="button"
                        onClick={handleUseConnected}
                        className="shrink-0 flex items-center gap-1.5 px-3 h-12 rounded-xl bg-secondary border border-border hover:bg-secondary/80 text-sm font-medium text-foreground transition-colors"
                      >
                        <span className="text-orange-400">🦊</span>
                        <span className="hidden sm:inline">Use connected</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Amount */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Amount
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={amount}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9.]/g, "");
                        const val = raw.replace(/\.(?=.*\.)/g, "");
                        setAmount(val);
                      }}
                      placeholder="0.00"
                      className="w-full h-12 px-4 pr-28 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary text-lg font-medium"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {selectedTokenConfig.symbol}
                      </span>
                      <button
                        type="button"
                        onClick={handleMaxAmount}
                        className="px-2 py-1 rounded-md bg-primary/20 hover:bg-primary/30 text-primary text-xs font-semibold transition-colors"
                      >
                        Max
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      ${amountNum > 0 ? amountNum.toFixed(2) : "0.00"}
                    </span>
                    <span>Balance: {usdcBalance.toFixed(2)} USDC</span>
                  </div>
                </div>

                {/* Quick Percentage Buttons */}
                <div className="flex gap-2">
                  {[25, 50, 75, 100].map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      onClick={() => handlePercentage(percent)}
                      className="flex-1 py-2 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-sm font-medium text-foreground transition-colors"
                    >
                      {percent === 100 ? "Max" : `${percent}%`}
                    </button>
                  ))}
                </div>

                {/* Token & Chain Selection */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Receive Token */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Receive token
                    </label>
                    <DropdownMenu
                      open={tokenDropdownOpen}
                      onOpenChange={setTokenDropdownOpen}
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="w-full h-12 px-3 rounded-xl bg-secondary border border-border flex items-center justify-between hover:bg-secondary/80 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {selectedTokenDisplay.icon ? (
                              <Image
                                src={selectedTokenDisplay.icon}
                                alt={selectedTokenConfig.symbol}
                                width={24}
                                height={24}
                                className="rounded-full"
                              />
                            ) : (
                              <span
                                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                style={{
                                  backgroundColor: selectedTokenDisplay.color,
                                }}
                              >
                                {selectedTokenDisplay.emoji}
                              </span>
                            )}
                            <span className="font-medium text-foreground">
                              {selectedTokenConfig.symbol}
                            </span>
                          </div>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[220px] bg-popover border-border"
                      >
                        {availableTokens.map((tokenId) => {
                          const config = WITHDRAW_TOKEN_CONFIGS[tokenId];
                          const display = TOKEN_DISPLAY[tokenId];
                          return (
                            <DropdownMenuItem
                              key={tokenId}
                              onClick={() => setSelectedTokenId(tokenId)}
                              className={cn(
                                "flex items-center gap-2 cursor-pointer",
                                selectedTokenId === tokenId && "bg-primary/10"
                              )}
                            >
                              {display.icon ? (
                                <Image
                                  src={display.icon}
                                  alt={config.symbol}
                                  width={20}
                                  height={20}
                                  className="rounded-full"
                                />
                              ) : (
                                <span
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                                  style={{ backgroundColor: display.color }}
                                >
                                  {display.emoji}
                                </span>
                              )}
                              <div className="flex flex-col min-w-0">
                                <span className="text-foreground text-sm">
                                  {config.symbol}
                                </span>
                                <span className="text-muted-foreground text-[10px] truncate">
                                  {config.name}
                                </span>
                              </div>
                              {selectedTokenId === tokenId ? (
                                <Check className="h-4 w-4 text-primary ml-auto shrink-0" />
                              ) : null}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Destination Chain */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      {isCrossChain ? "Destination chain" : "Receive chain"}
                    </label>
                    <DropdownMenu
                      open={chainDropdownOpen}
                      onOpenChange={setChainDropdownOpen}
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="w-full h-12 px-3 rounded-xl bg-secondary border border-border flex items-center justify-between hover:bg-secondary/80 transition-colors"
                        >
                          <span className="font-medium text-foreground">
                            {selectedChain.name}
                          </span>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[200px] bg-popover border-border"
                      >
                        {WITHDRAW_CHAINS.map((chain) => (
                          <DropdownMenuItem
                            key={chain.id}
                            onClick={() => setSelectedChain(chain)}
                            className={cn(
                              "flex items-center justify-between cursor-pointer",
                              selectedChain.id === chain.id && "bg-primary/10"
                            )}
                          >
                            <span className="text-foreground">
                              {chain.name}
                            </span>
                            {selectedChain.id === chain.id ? (
                              <Check className="h-4 w-4 text-primary" />
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Info note */}
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <p className="text-xs text-blue-400">
                    {isCrossChain
                      ? `Cross-chain withdrawal via Polymarket Bridge. Your USDC.e will be converted to ${selectedTokenConfig.symbol} and routed to ${selectedChain.name}. This typically takes 10-30 minutes.`
                      : `Your USDC.e will be converted to ${selectedTokenConfig.symbol} via Polymarket Bridge.`}
                  </p>
                </div>

                {/* Summary */}
                <div className="space-y-3 pt-2 border-t border-border">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      You will receive
                    </span>
                    <span className="text-foreground font-medium">
                      {isLoadingQuote ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
                      ) : (
                        `${estimatedReceive} ${selectedTokenConfig.symbol}`
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Destination</span>
                    <span className="text-foreground font-medium">
                      {selectedChain.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Fee</span>
                    <span className="text-muted-foreground">
                      {isLoadingQuote ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
                      ) : (
                        (totalFeeUsd ?? "Free (gasless)")
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Est. time</span>
                    <span className="text-muted-foreground">
                      {isLoadingQuote ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
                      ) : (
                        estimatedTime
                      )}
                    </span>
                  </div>
                </div>

                {/* Error display */}
                {error ? (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <p className="text-sm text-destructive">{error}</p>
                    </div>
                  </div>
                ) : null}

                {/* Withdraw Button */}
                <Button
                  onClick={handleWithdraw}
                  disabled={!canProceed || isWithdrawing}
                  className={cn(
                    "w-full h-12 font-semibold rounded-xl transition-all",
                    isWithdrawing
                      ? "bg-emerald-600/80 text-white cursor-wait"
                      : canProceed
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  {buttonContent.text}
                </Button>

                {state === "pending" && txHash ? (
                  <div className="flex justify-center">
                    <a
                      href={`${CHAIN_EXPLORER_URLS.polygon}${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                    >
                      Track on {CHAIN_EXPLORER_NAMES.polygon}
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
