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
import { useCallback, useEffect, useMemo, useState } from "react";
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
  useWithdraw,
  type WithdrawState,
  type WithdrawTokenId,
} from "@/hooks/use-withdraw";
import { cn } from "@/lib/utils";

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Supported tokens for withdrawal
const WITHDRAW_TOKENS: Array<{
  id: WithdrawTokenId;
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
}> = [
  {
    id: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    icon: "/usdc-token.webp",
    decimals: 6,
  },
  {
    id: "usdc-e",
    symbol: "USDC.e",
    name: "Bridged USDC",
    icon: "/usdc-token.webp",
    decimals: 6,
  },
];

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

type WithdrawToken = (typeof WITHDRAW_TOKENS)[number];
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
function getStatusDisplay(state: WithdrawState): {
  icon: React.ReactNode;
  text: string;
  colorClass: string;
} {
  switch (state) {
    case "signing":
      return {
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        text: "Waiting for signature...",
        colorClass: "text-yellow-500",
      };
    case "submitting":
      return {
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        text: "Submitting transaction...",
        colorClass: "text-blue-500",
      };
    case "pending":
      return {
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        text: "Processing withdrawal...",
        colorClass: "text-blue-500",
      };
    case "confirmed":
      return {
        icon: <Check className="h-4 w-4" />,
        text: "Withdrawal confirmed!",
        colorClass: "text-emerald-500",
      };
    case "failed":
      return {
        icon: <AlertCircle className="h-4 w-4" />,
        text: "Withdrawal failed",
        colorClass: "text-red-500",
      };
    default:
      return {
        icon: null,
        text: "",
        colorClass: "",
      };
  }
}

export function WithdrawModal({ open, onOpenChange }: WithdrawModalProps) {
  const { address } = useConnection();
  const {
    withdraw,
    reset,
    state,
    error,
    isWithdrawing,
    usdcBalance,
    canWithdraw,
  } = useWithdraw();

  // Form state
  const [recipientAddress, setRecipientAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [selectedToken, setSelectedToken] = useState<WithdrawToken>(
    WITHDRAW_TOKENS[0]
  );
  const [selectedChain, setSelectedChain] = useState<WithdrawChain>(
    WITHDRAW_CHAINS[0]
  );
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Dropdown open states
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false);
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setRecipientAddress("");
      setAmount("");
      setSelectedToken(WITHDRAW_TOKENS[0]);
      setSelectedChain(WITHDRAW_CHAINS[0]);
      setTxHash(null);
      setShowSuccess(false);
      reset();
    }
  }, [open, reset]);

  // Handle successful withdrawal
  useEffect(() => {
    if (state === "confirmed") {
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
    return isValidAmount && isValidAddress && canWithdraw;
  }, [isValidAmount, isValidAddress, canWithdraw]);

  // Estimate received amount (for now, 1:1 for same token)
  const estimatedReceive = useMemo(() => {
    if (!amountNum || amountNum <= 0) return "-";
    // In future, integrate with bridge API for cross-chain quotes
    return amountNum.toFixed(2);
  }, [amountNum]);

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

  // Extract primitive dependency for rerender-dependencies best practice
  const selectedTokenId = selectedToken.id;

  const handleWithdraw = useCallback(async () => {
    if (!canProceed) return;

    const result = await withdraw({
      amount,
      destinationAddress: recipientAddress,
      tokenId: selectedTokenId,
    });

    // Set transaction hash if available (for both success and pending states)
    if (result.transactionHash) {
      setTxHash(result.transactionHash);
    }
  }, [canProceed, amount, recipientAddress, withdraw, selectedTokenId]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const statusDisplay = getStatusDisplay(state);

  // Determine button text
  const getButtonText = () => {
    if (isWithdrawing) {
      return (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Processing...
        </span>
      );
    }
    if (!recipientAddress) return "Enter Recipient Address";
    if (!isValidAddress) return "Invalid Address";
    if (!amount || amountNum <= 0) return "Enter Amount";
    if (amountNum > usdcBalance) return "Insufficient Balance";
    return "Withdraw";
  };

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
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="h-8 w-8 text-emerald-500" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-foreground">
                    Withdrawal Complete!
                  </h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    {amount} {selectedToken.symbol} sent to your wallet
                  </p>
                </div>
                {txHash && CHAIN_EXPLORER_URLS[selectedChain.id] ? (
                  <a
                    href={`${CHAIN_EXPLORER_URLS[selectedChain.id]}${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
                  >
                    View on {CHAIN_EXPLORER_NAMES[selectedChain.id]}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
                <Button
                  onClick={handleClose}
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl"
                >
                  Done
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
                    <button
                      type="button"
                      onClick={handleUseConnected}
                      className="shrink-0 flex items-center gap-1.5 px-3 h-12 rounded-xl bg-secondary border border-border hover:bg-secondary/80 text-sm font-medium text-foreground transition-colors"
                    >
                      <span className="text-orange-400">🦊</span>
                      <span className="hidden sm:inline">Use connected</span>
                    </button>
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
                        {selectedToken.symbol}
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
                            <Image
                              src={selectedToken.icon}
                              alt={selectedToken.symbol}
                              width={24}
                              height={24}
                              className="rounded-full"
                            />
                            <span className="font-medium text-foreground">
                              {selectedToken.symbol}
                            </span>
                          </div>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[200px] bg-popover border-border"
                      >
                        {WITHDRAW_TOKENS.map((token) => (
                          <DropdownMenuItem
                            key={token.id}
                            onClick={() => setSelectedToken(token)}
                            className={cn(
                              "flex items-center gap-2 cursor-pointer",
                              selectedToken.id === token.id && "bg-primary/10"
                            )}
                          >
                            <Image
                              src={token.icon}
                              alt={token.symbol}
                              width={20}
                              height={20}
                              className="rounded-full"
                            />
                            <span className="text-foreground">
                              {token.symbol}
                            </span>
                            {selectedToken.id === token.id ? (
                              <Check className="h-4 w-4 text-primary ml-auto" />
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Receive Chain */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Receive chain
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

                {/* Swap info note for native USDC */}
                {selectedToken.id === "usdc" ? (
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <p className="text-xs text-blue-400">
                      Your USDC.e will be automatically swapped to native USDC
                      via Uniswap V3 (max 0.1% slippage).
                    </p>
                  </div>
                ) : null}

                {/* Summary */}
                <div className="space-y-3 pt-2 border-t border-border">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      You will receive
                    </span>
                    <span className="text-foreground font-medium">
                      ~{estimatedReceive} {selectedToken.symbol}
                    </span>
                  </div>
                  {selectedToken.id === "usdc" ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Swap fee</span>
                      <span className="text-muted-foreground">0.01%</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Network fee</span>
                    <span className="text-muted-foreground">
                      Free (gasless)
                    </span>
                  </div>
                </div>

                {/* Status display during transaction */}
                {state !== "idle" ? (
                  <div
                    className={cn(
                      "p-3 rounded-xl bg-secondary border border-border",
                      statusDisplay.colorClass
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {statusDisplay.icon}
                      <span className="text-sm font-medium">
                        {statusDisplay.text}
                      </span>
                    </div>
                    {/* Show transaction link for pending state */}
                    {state === "pending" &&
                    txHash &&
                    CHAIN_EXPLORER_URLS[selectedChain.id] ? (
                      <a
                        href={`${CHAIN_EXPLORER_URLS[selectedChain.id]}${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                      >
                        Track on {CHAIN_EXPLORER_NAMES[selectedChain.id]}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                ) : null}

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
                    canProceed && !isWithdrawing
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  {getButtonText()}
                </Button>

                {/* Liquidity warning for large USDC withdrawals */}
                {selectedToken.id === "usdc" && amountNum > 10000 ? (
                  <p className="text-xs text-center text-amber-500">
                    Large withdrawals may experience liquidity issues. Consider
                    withdrawing USDC.e directly or splitting into smaller
                    amounts.
                  </p>
                ) : null}

                {/* Note about cross-chain */}
                {selectedChain.id !== "polygon" ? (
                  <p className="text-xs text-center text-amber-500">
                    Cross-chain withdrawals may take 10-30 minutes
                  </p>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
