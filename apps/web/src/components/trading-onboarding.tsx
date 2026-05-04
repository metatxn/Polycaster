"use client";

import { createLogger } from "@knoww/logger";
import { formatTradingOnboardingError } from "@knoww/shared-types/trading-errors";
import { useAppKit } from "@reown/appkit/react";
import Decimal from "decimal.js";
import { AnimatePresence, motion } from "framer-motion";

const log = createLogger("trading-onboarding");

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Loader2,
  Shield,
  Wallet,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { useClobCredentials } from "@/hooks/use-clob-credentials";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useRelayerClient } from "@/hooks/use-relayer-client";
import { useTradingWalletMode } from "@/hooks/use-trading-wallet-mode";
import { checkAllApprovals } from "@/lib/approvals";
import { cn } from "@/lib/utils";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  status: "pending" | "in_progress" | "completed" | "error";
  errorMessage?: string;
}

interface TradingOnboardingProps {
  onComplete?: () => void;
  onSkip?: () => void;
}

export function TradingOnboarding({
  onComplete,
  onSkip,
}: TradingOnboardingProps) {
  const { isConnected } = useConnection();
  const { open } = useAppKit();
  const { mode: walletMode, setMode: setWalletMode } = useTradingWalletMode();
  const {
    deploySafe,
    approveUsdcForTrading,
    isLoading: isRelayerLoading,
    proxyAddress: relayerProxyAddress,
    hasDeployedSafe,
  } = useRelayerClient();
  const {
    deriveCredentials,
    hasCredentials,
    isLoading: isClobLoading,
  } = useClobCredentials();
  const {
    isDeployed: hasProxyWalletFromHook,
    refresh: refreshProxyWallet,
    proxyAddress: computedProxyAddress,
    usdcBalance,
  } = useProxyWallet();

  // Use relayer state as primary source (most reliable after deployment)
  const hasProxyWallet = hasDeployedSafe || hasProxyWalletFromHook;
  const proxyAddress = relayerProxyAddress || computedProxyAddress;

  // Track if USDC is already approved (for returning users)
  const [hasUsdcApproval, setHasUsdcApproval] = useState<boolean | null>(null);
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);
  const [approvalAmount, setApprovalAmount] = useState("100");

  // Celebration state - only show when user actively completes the final step
  const [showCelebration, setShowCelebration] = useState(false);
  // Track the previous allStepsComplete state to detect transition from incomplete -> complete
  const prevAllCompleteRef = useRef<boolean | null>(null);

  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<OnboardingStep[]>([
    {
      id: "connect",
      title: "Connect Wallet",
      description: "Connect your wallet to get started",
      icon: <Wallet className="h-5 w-5" />,
      status: "pending",
    },
    {
      id: "deploy",
      title: "Create Trading Wallet",
      description: "Deploy your secure Polymarket wallet • Free & gasless",
      icon: <Shield className="h-5 w-5" />,
      status: "pending",
    },
    {
      id: "approve",
      title: "Approve Trading Permissions",
      description:
        "Set limited pUSD/USDC.e allowances and outcome-token permissions • Free & gasless",
      icon: <Zap className="h-5 w-5" />,
      status: "pending",
    },
    {
      id: "credentials",
      title: "Setup API Access",
      description: "Sign to generate your trading credentials",
      icon: <CheckCircle2 className="h-5 w-5" />,
      status: "pending",
    },
  ]);

  useEffect(() => {
    setHasUsdcApproval(null);
    setSteps((prev) =>
      prev.map((step) => {
        if (step.id === "connect") {
          return { ...step, status: isConnected ? "completed" : "pending" };
        }
        if (step.id === "deploy") {
          return {
            ...step,
            status:
              walletMode === "eoa" && isConnected ? "completed" : "pending",
          };
        }
        return { ...step, status: "pending", errorMessage: undefined };
      })
    );
    setCurrentStep(isConnected ? (walletMode === "eoa" ? 2 : 1) : 0);
  }, [walletMode, isConnected]);

  useEffect(() => {
    if (usdcBalance > 0) {
      setApprovalAmount(new Decimal(usdcBalance).toDecimalPlaces(2).toString());
    }
  }, [usdcBalance]);

  const isApprovalAmountValid = (() => {
    try {
      const decimal = new Decimal(approvalAmount || "0");
      return decimal.isFinite() && decimal.gt(0);
    } catch {
      return false;
    }
  })();

  const updateStepStatus = useCallback(
    (
      stepId: string,
      status: OnboardingStep["status"],
      errorMessage?: string
    ) => {
      setSteps((prev) =>
        prev.map((step) =>
          step.id === stepId ? { ...step, status, errorMessage } : step
        )
      );
    },
    []
  );

  /**
   * Check if the default app trading approvals are already set on the Safe.
   *
   * The default app trading setup requires 6 approvals (see `checkAllApprovals` in
   * `@/lib/approvals`):
   *   pUSD → CTF, CTF Exchange V2, Neg Risk Exchange V2
   *   USDC.e → CollateralOnramp (for on-demand wrap on BUY)
   *   CTF setApprovalForAll → both CLOB exchanges (needed for SELL)
   *
   * Returning users with legacy V1 (USDC.e-only) approvals must re-run the
   * batch to unlock V2 settlement — hence we check the trading target set, not
   * just one USDC allowance.
   */
  const checkUsdcApproval = useCallback(async () => {
    if (!hasProxyWallet || !proxyAddress || isCheckingApproval) return;

    setIsCheckingApproval(true);
    try {
      const status = await checkAllApprovals(proxyAddress);
      log.debug("approvals.status", { status });
      setHasUsdcApproval(status.allApproved);
    } catch (err) {
      log.error("approvals.check_failed", { error: err });
      setHasUsdcApproval(false);
    } finally {
      setIsCheckingApproval(false);
    }
  }, [hasProxyWallet, proxyAddress, isCheckingApproval]);

  const handleConnectWallet = useCallback(async () => {
    updateStepStatus("connect", "in_progress");
    try {
      await open();
      // The wallet connection is handled by the modal
      // We'll check isConnected in the next render
    } catch (err) {
      updateStepStatus(
        "connect",
        "error",
        formatTradingOnboardingError(err, "Failed to connect wallet")
      );
    }
  }, [open, updateStepStatus]);

  const handleDeploySafe = useCallback(async () => {
    if (walletMode === "eoa") {
      updateStepStatus("deploy", "completed");
      setCurrentStep(2);
      return;
    }

    updateStepStatus("deploy", "in_progress");
    try {
      const result = await deploySafe();
      if (result.success) {
        updateStepStatus("deploy", "completed");
        setCurrentStep(2);
        // Refresh proxy wallet state to pick up the new address
        await refreshProxyWallet();
      } else {
        updateStepStatus("deploy", "error", result.error);
      }
    } catch (err) {
      updateStepStatus(
        "deploy",
        "error",
        formatTradingOnboardingError(err, "Failed to deploy wallet")
      );
    }
  }, [deploySafe, updateStepStatus, refreshProxyWallet, walletMode]);

  const handleApproveUsdc = useCallback(async () => {
    if (!isApprovalAmountValid) {
      updateStepStatus(
        "approve",
        "error",
        "Enter an approval amount greater than 0"
      );
      return;
    }

    updateStepStatus("approve", "in_progress");
    try {
      const result = await approveUsdcForTrading(approvalAmount);
      if (result.success) {
        updateStepStatus("approve", "completed");
        setHasUsdcApproval(true); // Mark as approved after successful transaction
        setCurrentStep(3);
      } else {
        updateStepStatus("approve", "error", result.error);
      }
    } catch (err) {
      updateStepStatus(
        "approve",
        "error",
        formatTradingOnboardingError(err, "Failed to submit approval batch")
      );
    }
  }, [
    approveUsdcForTrading,
    approvalAmount,
    isApprovalAmountValid,
    updateStepStatus,
  ]);

  const handleDeriveCredentials = useCallback(async () => {
    // Ensure previous steps are completed
    if (!hasProxyWallet) {
      updateStepStatus(
        "credentials",
        "error",
        "Please complete the wallet deployment step first"
      );
      return;
    }

    if (hasUsdcApproval === false) {
      updateStepStatus(
        "credentials",
        "error",
        "Please complete the approvals step first"
      );
      return;
    }

    updateStepStatus("credentials", "in_progress");
    try {
      await deriveCredentials();
      updateStepStatus("credentials", "completed");
      onComplete?.();
    } catch (err) {
      updateStepStatus(
        "credentials",
        "error",
        formatTradingOnboardingError(err, "Failed to setup credentials")
      );
    }
  }, [
    deriveCredentials,
    updateStepStatus,
    onComplete,
    hasProxyWallet,
    hasUsdcApproval,
  ]);

  // Update connect step when wallet connects
  useEffect(() => {
    if (isConnected && steps[0].status !== "completed") {
      updateStepStatus("connect", "completed");
      setCurrentStep(1);
    }
  }, [isConnected, steps, updateStepStatus]);

  // Update deploy step if proxy wallet is already deployed
  // Also trigger USDC approval check for returning users
  useEffect(() => {
    if (hasProxyWallet) {
      if (steps[1].status !== "completed") {
        updateStepStatus("deploy", "completed");
      }
      // Move to approve step if we're still on deploy step
      if (currentStep < 2) {
        setCurrentStep(2);
      }
      // Check if USDC is already approved (for returning users)
      if (hasUsdcApproval === null) {
        checkUsdcApproval();
      }
    }
  }, [
    hasProxyWallet,
    steps,
    currentStep,
    updateStepStatus,
    hasUsdcApproval,
    checkUsdcApproval,
  ]);

  // Update approve step if USDC is already approved (for returning users only)
  useEffect(() => {
    if (hasUsdcApproval === true && steps[2].status !== "completed") {
      updateStepStatus("approve", "completed");
      // Move to credentials step
      if (currentStep < 3) {
        setCurrentStep(3);
      }
    }
  }, [hasUsdcApproval, steps, currentStep, updateStepStatus]);

  // Update credentials step if already has credentials (but DON'T auto-close)
  useEffect(() => {
    if (hasCredentials && steps[3].status !== "completed") {
      updateStepStatus("credentials", "completed");
      // Don't auto-close - let user see the completed state or continue with other steps
    }
  }, [hasCredentials, steps, updateStepStatus]);

  // Check if all steps are complete
  const allStepsComplete = steps.every((s) => s.status === "completed");

  // Trigger celebration ONLY when user actively completes the final step
  // (transition from not-all-complete to all-complete)
  // Don't show for returning users who already had everything complete
  useEffect(() => {
    // On first render, just record the initial state without triggering celebration
    if (prevAllCompleteRef.current === null) {
      prevAllCompleteRef.current = allStepsComplete;
      return;
    }

    // Only trigger celebration on transition from incomplete -> complete
    const wasIncomplete = prevAllCompleteRef.current === false;
    const nowComplete = allStepsComplete === true;

    if (wasIncomplete && nowComplete) {
      log.debug("steps.all_complete");
      setShowCelebration(true);
      // Auto-hide celebration after 3 seconds
      const timer = setTimeout(() => setShowCelebration(false), 3000);
      prevAllCompleteRef.current = allStepsComplete;
      return () => clearTimeout(timer);
    }

    prevAllCompleteRef.current = allStepsComplete;
  }, [allStepsComplete]);

  const isLoading = isRelayerLoading || isClobLoading || isCheckingApproval;
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const progress = (completedSteps / steps.length) * 100;

  const getStepAction = (step: OnboardingStep, index: number) => {
    if (step.status === "completed") {
      return (
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
      );
    }

    if (step.status === "in_progress") {
      return (
        <Loader2 className="h-4 w-4 animate-spin text-foreground shrink-0" />
      );
    }

    if (step.status === "error") {
      return (
        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
      );
    }

    if (index !== currentStep) {
      return (
        <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      );
    }

    const ctaClass =
      "h-8 px-3 font-mono text-[11px] uppercase tracking-[0.16em] font-semibold bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors";

    switch (step.id) {
      case "connect":
        return (
          <button
            type="button"
            onClick={handleConnectWallet}
            disabled={isLoading}
            className={ctaClass}
          >
            Connect
          </button>
        );
      case "deploy":
        return (
          <button
            type="button"
            onClick={handleDeploySafe}
            disabled={isLoading}
            className={ctaClass}
          >
            Deploy
          </button>
        );
      case "approve":
        return (
          <button
            type="button"
            onClick={handleApproveUsdc}
            disabled={isLoading || !isApprovalAmountValid}
            className={ctaClass}
          >
            {walletMode === "eoa" ? "Approve Caps" : "Approve"}
          </button>
        );
      case "credentials":
        return (
          <button
            type="button"
            onClick={handleDeriveCredentials}
            disabled={isLoading}
            className={ctaClass}
          >
            Setup
          </button>
        );
      default:
        return null;
    }
  };

  const getDisplayStep = (step: OnboardingStep): OnboardingStep => {
    if (step.id === "deploy" && walletMode === "eoa") {
      return {
        ...step,
        title: "Use Connected Wallet",
        description: "Trade directly from your EOA. Requires POL for gas.",
        icon: <Wallet className="h-5 w-5" />,
      };
    }

    if (step.id === "approve" && walletMode === "eoa") {
      return {
        ...step,
        description:
          "Approve limited spending caps on-chain. MetaMask will show one prompt per token or operator.",
      };
    }

    return step;
  };

  const contextCopy = (): string | null => {
    if (allStepsComplete) return null;
    if (currentStep === 1)
      return walletMode === "safe"
        ? "Your trading wallet is a Gnosis Safe controlled by your connected wallet. Polymarket's relayer pays the gas for setup and trading operations."
        : "Your connected wallet is the trading wallet. This is simpler, but approvals and on-chain operations require POL for gas.";
    if (currentStep === 2)
      return walletMode === "safe"
        ? "Choose the ERC-20 approval limit for pUSD and USDC.e. Outcome-token sell permissions are binary, so they are granted as operator approvals."
        : "EOA approvals are normal Polygon transactions. MetaMask describes ERC-20 allowances as permission to withdraw tokens; the spender should be a Polymarket contract such as CTF, CTFExchange, NegRiskExchange, or CollateralOnramp.";
    if (currentStep === 3)
      return "Sign a message to create your unique trading credentials. No private keys are shared.";
    return "All setup transactions are gasless — Polymarket covers the gas fees through their relayer.";
  };

  return (
    <div className="relative w-full max-w-md mx-auto bg-background">
      {/* Celebration — quiet editorial moment */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="text-center px-6"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-4">
                § Setup Complete
              </p>
              <h3 className="font-editorial italic font-medium text-4xl leading-[1.05] tracking-tight">
                You&apos;re set.
              </h3>
              <p className="text-sm text-muted-foreground mt-3">
                Ready to start trading on Polymarket.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="px-6 pt-7 pb-5 border-b border-border/40">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-3">
          § {allStepsComplete ? "Setup Complete" : "Setup Trading"}
        </p>
        <h2 className="font-editorial italic font-medium text-3xl sm:text-4xl leading-[1.05] tracking-tight">
          {allStepsComplete ? "You're set." : "A few steps, then trade."}
        </h2>
        <p className="text-sm text-muted-foreground mt-3">
          {allStepsComplete
            ? "Your trading account is ready."
            : "Complete these once to start trading on Polymarket."}
        </p>

        {!allStepsComplete && (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setWalletMode("safe")}
              className={cn(
                "border px-3 py-3 text-left transition-colors",
                walletMode === "safe"
                  ? "border-foreground bg-foreground/5"
                  : "border-border/60 hover:border-foreground/40"
              )}
            >
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-foreground">
                <Shield className="h-3.5 w-3.5" />
                Safe
              </span>
              <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground">
                Gasless smart wallet. Best for most users.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setWalletMode("eoa")}
              className={cn(
                "border px-3 py-3 text-left transition-colors",
                walletMode === "eoa"
                  ? "border-foreground bg-foreground/5"
                  : "border-border/60 hover:border-foreground/40"
              )}
            >
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-foreground">
                <Wallet className="h-3.5 w-3.5" />
                EOA
              </span>
              <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground">
                Trade from this wallet. You pay Polygon gas.
              </span>
            </button>
          </div>
        )}

        {/* Hairline progress track with checkpoints */}
        <div className="pt-6">
          <div className="relative">
            <div className="absolute top-1/2 -translate-y-1/2 h-px w-full bg-border/60" />
            <motion.div
              className="absolute top-1/2 -translate-y-1/2 h-px bg-foreground"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
            <div className="relative flex justify-between">
              {steps.map((step, index) => {
                const stepProgress = ((index + 1) / steps.length) * 100;
                const isCompleted = progress >= stepProgress;
                const isCurrent = index === currentStep;
                return (
                  <div
                    key={step.id}
                    className="flex items-center justify-center"
                  >
                    <div
                      className={cn(
                        "flex items-center justify-center w-5 h-5 tabular-nums border transition-colors",
                        isCompleted
                          ? "bg-foreground border-foreground text-background"
                          : isCurrent
                            ? "bg-background border-foreground text-foreground"
                            : "bg-background border-border/60 text-muted-foreground/70"
                      )}
                    >
                      {isCompleted ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <span className="font-mono text-[9px] font-semibold">
                          {index + 1}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between mt-2.5">
            {steps.map((step, index) => {
              const stepProgress = ((index + 1) / steps.length) * 100;
              const isCompleted = progress >= stepProgress;
              const isCurrent = index === currentStep;
              const label =
                step.id === "connect"
                  ? "Connect"
                  : step.id === "deploy"
                    ? "Wallet"
                    : step.id === "approve"
                      ? "Approvals"
                      : "API";
              return (
                <span
                  key={`label-${step.id}`}
                  className={cn(
                    "font-mono text-[9px] uppercase tracking-[0.14em] text-center max-w-[60px] leading-tight transition-colors",
                    isCompleted || isCurrent
                      ? "text-foreground"
                      : "text-muted-foreground/60"
                  )}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step rows — hairline-divided */}
      <div className="divide-y divide-border/40">
        {steps.map((step, index) => {
          const displayStep = getDisplayStep(step);
          const isCurrent = index === currentStep;
          const isCompleted = step.status === "completed";
          const isError = step.status === "error";
          const isInProgress = step.status === "in_progress";

          const progressCopy =
            step.id === "deploy"
              ? walletMode === "eoa"
                ? "Using your connected wallet"
                : "Creating your secure wallet — 10–30 seconds"
              : step.id === "approve"
                ? walletMode === "eoa"
                  ? "Waiting for wallet approval transactions"
                  : "Submitting approval batch — 10–30 seconds"
                : step.id === "credentials"
                  ? "Generating your trading credentials…"
                  : step.id === "connect"
                    ? "Waiting for wallet connection…"
                    : displayStep.description;

          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={cn(
                "flex items-center gap-4 px-6 py-4 transition-colors",
                isCurrent && !isCompleted && "bg-foreground/3"
              )}
            >
              {/* Step icon — hairline square */}
              <div
                className={cn(
                  "flex items-center justify-center w-10 h-10 border shrink-0 transition-colors",
                  isCompleted
                    ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-300"
                    : isError
                      ? "border-red-600/40 text-red-700 dark:text-red-300"
                      : isCurrent || isInProgress
                        ? "border-foreground/60 text-foreground"
                        : "border-border/60 text-muted-foreground/60"
                )}
              >
                {displayStep.icon}
              </div>

              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "font-mono text-[11px] uppercase tracking-[0.14em] font-semibold",
                    isCompleted
                      ? "text-emerald-700 dark:text-emerald-300"
                      : isError
                        ? "text-red-700 dark:text-red-300"
                        : isInProgress || isCurrent
                          ? "text-foreground"
                          : "text-muted-foreground"
                  )}
                >
                  {displayStep.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {step.errorMessage ||
                    (isInProgress ? progressCopy : displayStep.description)}
                </p>
                {step.id === "approve" && isCurrent && !isCompleted && (
                  <div className="mt-3 space-y-1.5">
                    <label
                      htmlFor="approval-amount"
                      className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      Approval limit
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="approval-amount"
                        type="text"
                        inputMode="decimal"
                        value={approvalAmount}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "" || /^\d*\.?\d*$/.test(value)) {
                            setApprovalAmount(value);
                          }
                        }}
                        disabled={isLoading}
                        className="h-9 w-28 border border-border bg-background px-2 text-sm tabular-nums text-foreground outline-none focus:border-foreground disabled:opacity-50"
                        aria-invalid={!isApprovalAmountValid}
                      />
                      <span className="text-xs text-muted-foreground">
                        pUSD / USDC.e
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {walletMode === "eoa"
                        ? "MetaMask will call these spending cap requests. The cap is limited to the amount above; outcome-token sell permissions are binary and cannot be amount-limited."
                        : "ERC-20 allowances use this limit. Outcome-token sell permissions are binary and cannot be amount-limited."}
                    </p>
                  </div>
                )}
              </div>

              <div className="shrink-0">{getStepAction(step, index)}</div>
            </motion.div>
          );
        })}
      </div>

      {/* Meta row — proxy address + contextual copy */}
      <div className="px-6 py-5 space-y-4 border-t border-border/40">
        {proxyAddress && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-1.5"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              § Your Polymarket Wallet
            </p>
            <a
              href={`https://polygonscan.com/address/${proxyAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-foreground hover:underline decoration-foreground/40 underline-offset-4"
            >
              <span>
                {proxyAddress.slice(0, 10)}…{proxyAddress.slice(-8)}
              </span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </motion.div>
        )}

        {contextCopy() && (
          <p className="font-editorial italic text-sm text-muted-foreground leading-relaxed">
            {contextCopy()}
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-6 pb-6 space-y-2">
        {allStepsComplete && (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            type="button"
            onClick={onComplete}
            className="w-full h-11 bg-foreground text-background hover:bg-foreground/90 font-mono text-[11px] uppercase tracking-[0.18em] font-semibold transition-colors"
          >
            Start Trading
          </motion.button>
        )}

        {onSkip && !allStepsComplete && (
          <button
            type="button"
            onClick={onSkip}
            className="w-full h-10 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border hover:decoration-foreground/60"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
