"use client";

import { AnimatePresence } from "framer-motion";
import { ArrowLeft, X } from "lucide-react";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { polygon } from "viem/chains";
import { useConnection } from "wagmi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { USDC_E_ADDRESS as POLYGON_USDC_E_ADDRESS } from "@/constants/contracts";
import {
  type DepositTransaction,
  type QuoteResponse,
  type SupportedAsset,
  useBridge,
} from "@/hooks/use-bridge";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { type TokenBalance, useWalletTokens } from "@/hooks/use-wallet-tokens";

import { AmountInput } from "./deposit/amount-input";
import { BridgeSelection } from "./deposit/bridge-selection";
import { Confirmation } from "./deposit/confirmation";
import { MethodSelection } from "./deposit/method-selection";
import { TokenSelection } from "./deposit/token-selection";
import type { DepositMethod, DepositStep } from "./deposit/types";

interface DepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CHAIN_CONFIG: Record<string, { icon: string; gradient: string }> = {
  "137": { icon: "⬡", gradient: "from-purple-500 to-violet-600" },
  "1": { icon: "⟠", gradient: "from-blue-500 to-indigo-600" },
  "42161": { icon: "🔷", gradient: "from-sky-400 to-blue-600" },
  "8453": { icon: "🔵", gradient: "from-blue-500 to-blue-700" },
  "10": { icon: "🔴", gradient: "from-red-500 to-rose-600" },
  "43114": { icon: "🔺", gradient: "from-red-500 to-red-700" },
  "56": { icon: "⛓️", gradient: "from-yellow-400 to-amber-600" },
};

export function DepositModal({ open, onOpenChange }: DepositModalProps) {
  const { address, isConnected } = useConnection();
  const { usdcBalance: polymarketBalance, refresh: refreshProxyWallet } =
    useProxyWallet();
  const {
    tokens: walletTokens,
    isLoading: loadingTokens,
    refresh: refreshTokens,
  } = useWalletTokens({ enabled: open });
  const {
    supportedAssets,
    isLoading: loadingBridge,
    getSupportedAssets,
    createDepositAddresses,
    getDepositStatus,
    isLoadingDepositStatus,
  } = useBridge();

  const [isPending, setIsPending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isOnChainConfirmed, setIsOnChainConfirmed] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [txError, setTxError] = useState<Error | null>(null);

  const [step, setStep] = useState<DepositStep>("method");
  const [selectedMethod, setSelectedMethod] = useState<DepositMethod | null>(
    null
  );
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [selectedBridgeAsset, setSelectedBridgeAsset] =
    useState<SupportedAsset | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [bridgeAddress, setBridgeAddress] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [depositTransactions, setDepositTransactions] = useState<
    DepositTransaction[]
  >([]);
  const quoteFetchedRef = useRef<string | null>(null);
  const [isLoadingQuoteLocal, setIsLoadingQuoteLocal] = useState(false);

  const depositContextRef = useRef({
    address,
    selectedToken,
    amount,
    selectedMethod,
  });
  depositContextRef.current = {
    address,
    selectedToken,
    amount,
    selectedMethod,
  };

  useEffect(() => {
    if (!open) {
      setStep("method");
      setSelectedMethod(null);
      setSelectedToken(null);
      setSelectedBridgeAsset(null);
      setAmount("");
      setBridgeAddress("");
      setCopied(false);
      setSearchQuery("");
      setIsProcessing(false);
      setDepositError(null);
      setIsPending(false);
      setIsConfirming(false);
      setIsOnChainConfirmed(false);
      setIsConfirmed(false);
      setTxError(null);
      setQuote(null);
      setDepositTransactions([]);
      quoteFetchedRef.current = null;
      setIsLoadingQuoteLocal(false);
    }
  }, [open]);

  useEffect(() => {
    if (isConfirmed) {
      setIsProcessing(false);
      refreshTokens();
      void refreshProxyWallet();
      setTimeout(() => onOpenChange(false), 1500);
    }
  }, [isConfirmed, refreshTokens, refreshProxyWallet, onOpenChange]);

  useEffect(() => {
    if (txError) {
      // Clean up error message for better UX
      let errorMessage = txError?.message || "Transaction failed";

      // Handle common error patterns
      if (errorMessage.includes("Timed out while waiting for transaction")) {
        errorMessage =
          "Transaction confirmation timed out. Please check your wallet or Polygonscan for the transaction status.";
      } else if (
        errorMessage.includes("User rejected") ||
        errorMessage.includes("user rejected")
      ) {
        errorMessage = "Transaction was rejected.";
      } else if (errorMessage.includes("insufficient funds")) {
        errorMessage = "Insufficient funds for this transaction.";
      }

      setDepositError(errorMessage);
      setIsProcessing(false);
    }
  }, [txError]);

  useEffect(() => {
    if (
      open &&
      (step === "bridge-select" || step === "token") &&
      supportedAssets.length === 0
    ) {
      getSupportedAssets();
    }
  }, [open, step, supportedAssets.length, getSupportedAssets]);

  const getMinDepositForToken = useCallback(
    (tokenSymbol: string): number => {
      const matchingAssets = supportedAssets.filter(
        (asset) =>
          asset.token.symbol.toUpperCase() === tokenSymbol.toUpperCase() ||
          (tokenSymbol.toUpperCase() === "USDC.E" &&
            asset.token.symbol.toUpperCase() === "USDC") ||
          (tokenSymbol.toUpperCase() === "USDC" &&
            asset.token.symbol.toUpperCase() === "USDC")
      );
      if (matchingAssets.length === 0) return 45;
      return Math.min(...matchingAssets.map((a) => a.minCheckoutUsd));
    },
    [supportedAssets]
  );

  const defaultMinDeposit = useMemo(() => {
    if (supportedAssets.length === 0) return 45;
    return Math.min(...supportedAssets.map((a) => a.minCheckoutUsd));
  }, [supportedAssets]);

  const filteredBridgeAssets = useMemo(() => {
    if (!searchQuery.trim()) return supportedAssets;
    const query = searchQuery.toLowerCase();
    return supportedAssets.filter(
      (asset) =>
        asset.token.symbol.toLowerCase().includes(query) ||
        asset.token.name.toLowerCase().includes(query) ||
        asset.chainName.toLowerCase().includes(query)
    );
  }, [supportedAssets, searchQuery]);

  const handleSelectMethod = useCallback(
    (method: DepositMethod, e?: React.MouseEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      setSelectedMethod(method);
      if (method === "wallet") setStep("token");
      else if (method === "bridge") setStep("bridge-select");
    },
    []
  );

  const handleSelectToken = useCallback(
    async (token: TokenBalance) => {
      setSelectedToken(token);
      setIsProcessing(true);
      setDepositError(null);
      setBridgeAddress("");
      let resolvedDepositAddress = "";

      try {
        const addresses = await createDepositAddresses();
        if (addresses && addresses.length > 0) {
          const matching = addresses.find(
            (addr) =>
              addr.chainId === "137" &&
              addr.tokenSymbol.toUpperCase() === token.symbol.toUpperCase()
          );
          if (matching) resolvedDepositAddress = matching.depositAddress;
          else {
            const polygonUsdc = addresses.find(
              (addr) =>
                addr.chainId === "137" &&
                addr.tokenSymbol.toUpperCase() === "USDC"
            );
            if (polygonUsdc)
              resolvedDepositAddress = polygonUsdc.depositAddress;
            else {
              const polygonAddr = addresses.find(
                (addr) => addr.chainId === "137"
              );
              if (polygonAddr)
                resolvedDepositAddress = polygonAddr.depositAddress;
              else setDepositError("No deposit address available for Polygon.");
            }
          }
        } else setDepositError("Failed to get deposit addresses.");
      } catch (err) {
        setDepositError(
          err instanceof Error ? err.message : "Failed to get deposit address."
        );
      } finally {
        setIsProcessing(false);
      }

      if (!resolvedDepositAddress) return;
      setBridgeAddress(resolvedDepositAddress);
      setStep("amount");
    },
    [createDepositAddresses]
  );

  const handleSelectBridgeAsset = useCallback(
    async (asset: SupportedAsset) => {
      setSelectedBridgeAsset(asset);
      setIsProcessing(true);
      try {
        const addresses = await createDepositAddresses();
        if (addresses && addresses.length > 0) {
          const matching =
            addresses.find(
              (addr) =>
                addr.chainId === asset.chainId &&
                addr.tokenSymbol === asset.token.symbol
            ) || addresses.find((addr) => addr.chainId === asset.chainId);
          if (matching) setBridgeAddress(matching.depositAddress);
        }
      } catch (err) {
        console.error("Failed to get bridge address:", err);
      } finally {
        setIsProcessing(false);
        setStep("confirm");
      }
    },
    [createDepositAddresses]
  );

  const handlePercentage = useCallback(
    (percent: number) => {
      if (!selectedToken) return;
      const value = (selectedToken.balance * percent) / 100;
      setAmount(
        value.toFixed(selectedToken.decimals > 6 ? 6 : selectedToken.decimals)
      );
    },
    [selectedToken]
  );

  const handleCopy = useCallback(() => {
    if (bridgeAddress) {
      navigator.clipboard.writeText(bridgeAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [bridgeAddress]);

  const handleDeposit = useCallback(async () => {
    if (!selectedToken || !amount || !bridgeAddress) return;
    if (typeof window === "undefined" || !window.ethereum) return;

    let waitingForBridge = false;

    setDepositError(null);
    setIsProcessing(true);
    setIsPending(true);
    setTxError(null);
    setIsOnChainConfirmed(false);
    setIsConfirmed(false);
    setDepositTransactions([]);

    try {
      const { createWalletClient, createPublicClient, custom, http } =
        await import("viem");
      const amountInWei = parseUnits(amount, selectedToken.decimals);
      const walletClient = createWalletClient({
        chain: polygon,
        // biome-ignore lint/suspicious/noExplicitAny: window.ethereum is not typed
        transport: custom(window.ethereum as any),
      });
      const [account] = await walletClient.requestAddresses();
      const isNativeToken =
        selectedToken.symbol === "POL" ||
        selectedToken.symbol === "MATIC" ||
        selectedToken.address ===
          "0x0000000000000000000000000000000000000000" ||
        selectedToken.address === "native";

      let hash: `0x${string}`;
      if (isNativeToken) {
        hash = await walletClient.sendTransaction({
          account,
          to: bridgeAddress as `0x${string}`,
          value: amountInWei,
          chain: polygon,
        });
      } else {
        hash = await walletClient.writeContract({
          account,
          address: selectedToken.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [bridgeAddress as `0x${string}`, amountInWei],
          chain: polygon,
        });
      }

      setIsPending(false);
      setIsConfirming(true);
      const { getRpcUrl } = await import("@/lib/rpc");
      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl(), {
          retryCount: 2,
          retryDelay: 2000,
        }),
      });
      // Use longer polling interval to avoid rate limiting (5 seconds instead of default 1 second)
      // Also increase timeout to 3 minutes for slower confirmations
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        pollingInterval: 5_000, // Poll every 5 seconds
        timeout: 180_000, // 3 minute timeout
        confirmations: 1, // Wait for 1 confirmation
      });
      if (receipt.status === "success") {
        setIsOnChainConfirmed(true);
        waitingForBridge = true;
        posthog.capture("deposit_initiated", {
          token_symbol: selectedToken.symbol,
          amount,
          wallet_address: address,
          deposit_method: selectedMethod,
        });
      } else throw new Error("Transaction failed on-chain");
    } catch (err) {
      setTxError(err instanceof Error ? err : new Error("Transaction failed"));
      setIsProcessing(false);
    } finally {
      setIsPending(false);
      if (!waitingForBridge) {
        setIsConfirming(false);
      }
    }
  }, [selectedToken, amount, bridgeAddress, selectedMethod, address]);

  const handleBack = useCallback(() => {
    if (step === "token" || step === "bridge-select") {
      setStep("method");
      setSelectedMethod(null);
      setSearchQuery("");
    } else if (step === "amount") {
      setStep("token");
      setSelectedToken(null);
      setAmount("");
      setQuote(null);
    } else if (step === "confirm") {
      if (selectedMethod === "bridge") {
        setStep("bridge-select");
        setSelectedBridgeAsset(null);
        setBridgeAddress("");
      } else {
        setStep("amount");
        setQuote(null);
      }
    }
  }, [step, selectedMethod]);

  // Fetch quote once when arriving at the confirm step.
  // Uses a direct fetch + dedup ref to avoid re-render loops that occur when
  // routing through useMutation (mutateAsync flips isPending which re-renders
  // every useBridge consumer and can cascade back into this effect).
  const tokenAddress = selectedToken?.address;
  const tokenDecimals = selectedToken?.decimals;

  useEffect(() => {
    if (
      step !== "confirm" ||
      !tokenAddress ||
      tokenDecimals === undefined ||
      !amount ||
      !bridgeAddress
    ) {
      return;
    }

    const numAmount = Number.parseFloat(amount);
    if (Number.isNaN(numAmount) || numAmount <= 0) return;

    const amountBaseUnit = parseUnits(amount, tokenDecimals).toString();
    const cacheKey = `${tokenAddress}-${amountBaseUnit}-${bridgeAddress}`;

    if (quoteFetchedRef.current === cacheKey) return;
    quoteFetchedRef.current = cacheKey;

    let cancelled = false;
    const controller = new AbortController();

    setIsLoadingQuoteLocal(true);

    fetch("https://bridge.polymarket.com/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAmountBaseUnit: amountBaseUnit,
        fromChainId: "137",
        fromTokenAddress: tokenAddress,
        recipientAddress: bridgeAddress,
        toChainId: "137",
        toTokenAddress: POLYGON_USDC_E_ADDRESS,
      }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Quote request failed: ${res.status}`);
        return res.json() as Promise<QuoteResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setQuote(data);
          setIsLoadingQuoteLocal(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err.name !== "AbortError") {
            console.warn("Failed to fetch quote:", err);
          }
          setQuote(null);
          setIsLoadingQuoteLocal(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [step, amount, bridgeAddress, tokenAddress, tokenDecimals]);

  // Reset the dedup key when leaving the confirm step so a fresh quote is
  // fetched if the user navigates back and returns with different params.
  useEffect(() => {
    if (step !== "confirm") {
      quoteFetchedRef.current = null;
    }
  }, [step]);

  // Poll deposit status after transaction is confirmed
  const shouldPollStatus =
    isOnChainConfirmed && isConfirming && !isConfirmed && !!bridgeAddress;

  useEffect(() => {
    if (!shouldPollStatus) return;

    let cancelled = false;
    const startedAt = Date.now();
    const BRIDGE_TIMEOUT_MS = 3 * 60 * 1000;

    const checkTimeout = () => {
      if (cancelled) return;
      if (Date.now() - startedAt >= BRIDGE_TIMEOUT_MS) {
        cancelled = true;
        setDepositError(
          "Transaction confirmed on-chain, but bridge credit is taking longer than expected. Please check again shortly."
        );
        setIsConfirming(false);
        setIsProcessing(false);
      }
    };

    const fetchStatus = () => {
      getDepositStatus(bridgeAddress)
        .then((data) => {
          if (cancelled) return;

          setDepositTransactions(data);

          const hasFailed = data.some((tx) => tx.status === "FAILED");
          if (hasFailed) {
            cancelled = true;
            setDepositError(
              "Transaction confirmed on-chain, but bridge processing failed. Contact support if funds do not arrive."
            );
            setIsConfirming(false);
            setIsProcessing(false);
            return;
          }

          const hasCompleted = data.some((tx) => tx.status === "COMPLETED");
          if (hasCompleted) {
            cancelled = true;
            setIsConfirming(false);
            setIsConfirmed(true);
            setIsProcessing(false);
            const ctx = depositContextRef.current;
            posthog.capture("deposit_completed", {
              wallet_address: ctx.address,
              token_symbol: ctx.selectedToken?.symbol,
              amount: ctx.amount,
              deposit_method: ctx.selectedMethod,
            });
          }
        })
        .catch(() => {})
        .finally(checkTimeout);
    };

    fetchStatus();

    const interval = setInterval(fetchStatus, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [shouldPollStatus, bridgeAddress, getDepositStatus]);

  const receiveAmount = useMemo(() => {
    if (!amount || !selectedToken) return "0";
    const numAmount = Number.parseFloat(amount);
    if (Number.isNaN(numAmount)) return "0";
    if (["USDC", "USDC.e", "DAI", "USDT"].includes(selectedToken.symbol))
      return numAmount.toFixed(2);
    const ratio = selectedToken.usdValue / selectedToken.balance;
    return (numAmount * ratio).toFixed(2);
  }, [amount, selectedToken]);

  const enteredAmountUsd = useMemo(() => {
    if (!amount || !selectedToken) return 0;
    const numAmount = Number.parseFloat(amount);
    if (Number.isNaN(numAmount)) return 0;
    if (["USDC", "USDC.e", "DAI", "USDT"].includes(selectedToken.symbol))
      return numAmount;
    const ratio = selectedToken.usdValue / selectedToken.balance;
    return numAmount * ratio;
  }, [amount, selectedToken]);

  const selectedTokenMinDeposit = useMemo(() => {
    if (!selectedToken) return defaultMinDeposit;
    return getMinDepositForToken(selectedToken.symbol);
  }, [selectedToken, defaultMinDeposit, getMinDepositForToken]);

  const isBelowMinimum = useMemo(() => {
    if (!amount || enteredAmountUsd === 0) return false;
    return enteredAmountUsd < selectedTokenMinDeposit;
  }, [amount, enteredAmountUsd, selectedTokenMinDeposit]);

  const isValidAmount = useMemo(() => {
    if (!amount || !selectedToken) return false;
    const numAmount = Number.parseFloat(amount);
    if (Number.isNaN(numAmount) || numAmount <= 0) return false;
    if (numAmount > selectedToken.balance) return false;
    if (isBelowMinimum) return false;
    return true;
  }, [amount, selectedToken, isBelowMinimum]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[420px] p-0 gap-0 overflow-hidden bg-background border-border"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="relative h-[68px] border-b border-border flex items-center justify-between px-4 shrink-0">
          <div className="w-8 flex items-center justify-start">
            {step !== "method" && (
              <button
                type="button"
                onClick={handleBack}
                className="p-1.5 -ml-1.5 rounded-full hover:bg-secondary/80 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5 text-foreground" />
              </button>
            )}
          </div>
          <div className="flex flex-col items-center justify-center flex-1 min-w-0">
            <DialogTitle className="text-[17px] font-semibold text-foreground tracking-tight">
              Deposit
            </DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground font-medium mt-0.5">
              Balance: ${polymarketBalance?.toFixed(2) || "0.00"}
            </DialogDescription>
          </div>
          <div className="w-8 flex items-center justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="p-1.5 -mr-1.5 rounded-full hover:bg-secondary/80 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="p-4 max-h-[calc(100vh-120px)] overflow-y-auto">
          <AnimatePresence mode="wait">
            {step === "method" && (
              <MethodSelection
                isConnected={isConnected}
                address={address}
                walletTokens={walletTokens}
                onSelectMethod={handleSelectMethod}
              />
            )}
            {step === "token" && (
              <TokenSelection
                isLoading={loadingTokens}
                walletTokens={walletTokens}
                defaultMinDeposit={defaultMinDeposit}
                onRefresh={refreshTokens}
                onSelectToken={handleSelectToken}
                getMinDepositForToken={getMinDepositForToken}
              />
            )}
            {step === "bridge-select" && (
              <BridgeSelection
                isLoading={loadingBridge}
                searchQuery={searchQuery}
                filteredBridgeAssets={filteredBridgeAssets}
                isProcessing={isProcessing}
                onSearchChange={setSearchQuery}
                onSelectAsset={handleSelectBridgeAsset}
                getChainConfig={(chainId) =>
                  CHAIN_CONFIG[chainId] || {
                    icon: "🔗",
                    gradient: "from-gray-400 to-gray-600",
                  }
                }
              />
            )}
            {step === "amount" && selectedToken && (
              <AmountInput
                amount={amount}
                selectedToken={selectedToken}
                isBelowMinimum={isBelowMinimum}
                selectedTokenMinDeposit={selectedTokenMinDeposit}
                enteredAmountUsd={enteredAmountUsd}
                isValidAmount={isValidAmount}
                onAmountChange={setAmount}
                onPercentage={handlePercentage}
                onContinue={() => setStep("confirm")}
              />
            )}
            {step === "confirm" && (
              <Confirmation
                selectedMethod={selectedMethod}
                selectedBridgeAsset={selectedBridgeAsset}
                selectedToken={selectedToken}
                isProcessing={isProcessing}
                bridgeAddress={bridgeAddress}
                amount={amount}
                address={address}
                receiveAmount={receiveAmount}
                depositError={depositError}
                isPending={isPending}
                isConfirming={isConfirming}
                isOnChainConfirmed={isOnChainConfirmed}
                isConfirmed={isConfirmed}
                copied={copied}
                onCopy={handleCopy}
                onDeposit={handleDeposit}
                quote={quote}
                isLoadingQuote={isLoadingQuoteLocal}
                depositTransactions={depositTransactions}
                isLoadingDepositStatus={isLoadingDepositStatus}
              />
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
