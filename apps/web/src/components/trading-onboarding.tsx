"use client";

import { useAppKit } from "@reown/appkit/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Loader2,
  PartyPopper,
  Shield,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useClobClient } from "@/hooks/use-clob-client";
import { useClobCredentials } from "@/hooks/use-clob-credentials";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useRelayerClient } from "@/hooks/use-relayer-client";
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
  } = useProxyWallet();
  const { getUsdcAllowance } = useClobClient();

  // Use relayer state as primary source (most reliable after deployment)
  const hasProxyWallet = hasDeployedSafe || hasProxyWalletFromHook;
  const proxyAddress = relayerProxyAddress || computedProxyAddress;

  // Track if USDC is already approved (for returning users)
  const [hasUsdcApproval, setHasUsdcApproval] = useState<boolean | null>(null);
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);

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
      title: "Enable USDC Trading",
      description: "One-time approval to trade with USDC • Free & gasless",
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
   * Check if USDC is already approved for trading
   * This is for returning users who have already completed onboarding
   * IMPORTANT: Must check the PROXY WALLET's allowance, not the EOA's
   */
  const checkUsdcApproval = useCallback(async () => {
    if (!hasProxyWallet || !proxyAddress || isCheckingApproval) return;

    setIsCheckingApproval(true);
    try {
      // Pass the proxy wallet address to check its allowance
      const result = await getUsdcAllowance(proxyAddress);
      // Consider approved if allowance is greater than 0 (any approval exists)
      const isApproved = result && result.allowance > 0;
      console.log("[TradingOnboarding] USDC allowance check:", {
        proxyAddress,
        allowance: result?.allowance,
        isApproved,
      });
      setHasUsdcApproval(isApproved);
    } catch (err) {
      console.error("[TradingOnboarding] Failed to check USDC allowance:", err);
      setHasUsdcApproval(false);
    } finally {
      setIsCheckingApproval(false);
    }
  }, [hasProxyWallet, proxyAddress, isCheckingApproval, getUsdcAllowance]);

  const handleConnectWallet = useCallback(async () => {
    updateStepStatus("connect", "in_progress");
    try {
      await open();
      // The wallet connection is handled by the modal
      // We'll check isConnected in the next render
    } catch {
      updateStepStatus("connect", "error", "Failed to connect wallet");
    }
  }, [open, updateStepStatus]);

  const handleDeploySafe = useCallback(async () => {
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
        err instanceof Error ? err.message : "Failed to deploy wallet"
      );
    }
  }, [deploySafe, updateStepStatus, refreshProxyWallet]);

  const handleApproveUsdc = useCallback(async () => {
    updateStepStatus("approve", "in_progress");
    try {
      const result = await approveUsdcForTrading();
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
        err instanceof Error ? err.message : "Failed to approve USDC"
      );
    }
  }, [approveUsdcForTrading, updateStepStatus]);

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
        "Please complete the USDC approval step first"
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
        err instanceof Error ? err.message : "Failed to setup credentials"
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
      console.log(
        "[TradingOnboarding] All steps completed! Showing celebration"
      );
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
        <CheckCircle2 className="h-5 w-5 text-green-500 dark:text-green-400" />
      );
    }

    if (step.status === "in_progress") {
      return (
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {step.id === "deploy" && "Deploying..."}
            {step.id === "approve" && "Approving..."}
            {step.id === "credentials" && "Setting up..."}
            {step.id === "connect" && "Connecting..."}
          </span>
        </div>
      );
    }

    if (step.status === "error") {
      return <AlertCircle className="h-5 w-5 text-destructive" />;
    }

    if (index !== currentStep) {
      return <ChevronRight className="h-5 w-5 text-muted-foreground" />;
    }

    // Current step actions
    switch (step.id) {
      case "connect":
        return (
          <Button size="sm" onClick={handleConnectWallet} disabled={isLoading}>
            Connect
          </Button>
        );
      case "deploy":
        return (
          <Button size="sm" onClick={handleDeploySafe} disabled={isLoading}>
            Deploy
          </Button>
        );
      case "approve":
        return (
          <Button size="sm" onClick={handleApproveUsdc} disabled={isLoading}>
            Approve
          </Button>
        );
      case "credentials":
        return (
          <Button
            size="sm"
            onClick={handleDeriveCredentials}
            disabled={isLoading}
          >
            Setup
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto relative overflow-hidden border-0 shadow-none rounded-none">
      {/* Celebration Animation Overlay */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="text-center"
            >
              {/* Confetti particles */}
              <div className="relative">
                {[...Array(12)].map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{
                      x: 0,
                      y: 0,
                      scale: 0,
                      rotate: 0,
                    }}
                    animate={{
                      x: Math.cos((i * 30 * Math.PI) / 180) * 80,
                      y: Math.sin((i * 30 * Math.PI) / 180) * 80 - 20,
                      scale: [0, 1, 0.8],
                      rotate: Math.random() * 360,
                    }}
                    transition={{
                      duration: 0.8,
                      delay: i * 0.05,
                      ease: "easeOut",
                    }}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                  >
                    <Sparkles
                      className={`h-4 w-4 ${
                        i % 4 === 0
                          ? "text-yellow-400"
                          : i % 4 === 1
                            ? "text-green-400"
                            : i % 4 === 2
                              ? "text-purple-400"
                              : "text-blue-400"
                      }`}
                    />
                  </motion.div>
                ))}

                {/* Center icon */}
                <motion.div
                  animate={{
                    scale: [1, 1.2, 1],
                    rotate: [0, 10, -10, 0],
                  }}
                  transition={{
                    duration: 0.6,
                    repeat: 2,
                    repeatType: "reverse",
                  }}
                >
                  <PartyPopper className="h-16 w-16 text-yellow-500 mx-auto" />
                </motion.div>
              </div>

              <motion.h3
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-2xl font-bold mt-4 bg-linear-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent"
              >
                You&apos;re All Set! 🎉
              </motion.h3>
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-muted-foreground mt-2"
              >
                Ready to start trading on Polymarket
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">
          {allStepsComplete ? "🎉 Setup Complete!" : "Setup Trading"}
        </CardTitle>
        <CardDescription>
          {allStepsComplete
            ? "Your trading account is ready to go!"
            : "Complete these steps to start trading on Polymarket"}
        </CardDescription>

        {/* Custom Progress Bar with Checkpoints */}
        <div className="pt-3 pb-1">
          <div className="relative">
            {/* Background track */}
            <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-muted/50" />

            {/* Filled progress */}
            <motion.div
              className="absolute top-0 left-0 h-2 rounded-full bg-linear-to-r from-emerald-500 via-green-500 to-teal-500"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />

            {/* Checkpoints */}
            <div className="absolute top-1/2 -translate-y-1/2 w-full flex justify-between px-0">
              {steps.map((step, index) => {
                const stepProgress = ((index + 1) / steps.length) * 100;
                const isCompleted = progress >= stepProgress;
                const isCurrent = index === currentStep;

                return (
                  <div
                    key={step.id}
                    className="relative flex items-center justify-center"
                    style={{
                      left: index === 0 ? "0" : "auto",
                      right: index === steps.length - 1 ? "0" : "auto",
                    }}
                  >
                    <motion.div
                      initial={{ scale: 0.8 }}
                      animate={{ scale: isCompleted || isCurrent ? 1 : 0.9 }}
                      className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                        isCompleted
                          ? "bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-500/30"
                          : isCurrent
                            ? "bg-white dark:bg-gray-900 border-emerald-500 text-emerald-500 shadow-md"
                            : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
                      )}
                    >
                      {isCompleted ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <span className="text-[10px] font-bold">
                          {index + 1}
                        </span>
                      )}
                    </motion.div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step labels below checkpoints */}
          <div className="flex justify-between mt-2">
            {steps.map((step, index) => {
              const stepProgress = ((index + 1) / steps.length) * 100;
              const isCompleted = progress >= stepProgress;
              const isCurrent = index === currentStep;

              return (
                <span
                  key={`label-${step.id}`}
                  className={cn(
                    "text-[9px] font-medium text-center max-w-[60px] leading-tight",
                    isCompleted
                      ? "text-emerald-600 dark:text-emerald-400"
                      : isCurrent
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-gray-400 dark:text-gray-500"
                  )}
                >
                  {step.id === "connect"
                    ? "Connect"
                    : step.id === "deploy"
                      ? "Wallet"
                      : step.id === "approve"
                        ? "USDC"
                        : "API"}
                </span>
              );
            })}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <AnimatePresence>
          {steps.map((step, index) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ delay: index * 0.1 }}
              className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                index === currentStep
                  ? "border-primary bg-primary/5"
                  : step.status === "completed"
                    ? "border-green-500/30 bg-green-500/5"
                    : step.status === "error"
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border"
              }`}
            >
              {/* Step Icon */}
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full ${
                  step.status === "completed"
                    ? "bg-green-500/20 text-green-600 dark:text-green-400"
                    : step.status === "error"
                      ? "bg-destructive/20 text-destructive"
                      : index === currentStep
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                }`}
              >
                {step.icon}
              </div>

              {/* Step Info */}
              <div className="flex-1 min-w-0">
                <p
                  className={`font-medium text-sm ${
                    step.status === "completed"
                      ? "text-green-600 dark:text-green-400"
                      : step.status === "error"
                        ? "text-destructive"
                        : step.status === "in_progress"
                          ? "text-primary"
                          : ""
                  }`}
                >
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {step.errorMessage ||
                    (step.status === "in_progress"
                      ? step.id === "deploy"
                        ? "Creating your secure wallet... This may take 10-30 seconds"
                        : step.id === "approve"
                          ? "Approving USDC... This may take 10-30 seconds"
                          : step.id === "credentials"
                            ? "Generating your trading credentials..."
                            : step.id === "connect"
                              ? "Waiting for wallet connection..."
                              : step.description
                      : step.description)}
                </p>
              </div>

              {/* Step Action */}
              <div className="shrink-0">{getStepAction(step, index)}</div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Proxy Address Display */}
        {proxyAddress && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20"
          >
            <p className="text-xs text-muted-foreground mb-1">
              Your Polymarket Wallet
            </p>
            <a
              href={`https://polygonscan.com/address/${proxyAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
            >
              {proxyAddress.slice(0, 10)}...{proxyAddress.slice(-8)}
              <ExternalLink className="h-3 w-3" />
            </a>
          </motion.div>
        )}

        {/* Info Box - contextual based on current step */}
        <div
          className={`p-3 rounded-lg border ${
            allStepsComplete
              ? "bg-green-500/10 border-green-500/20"
              : "bg-blue-500/10 border-blue-500/20"
          }`}
        >
          <p
            className={`text-xs ${
              allStepsComplete
                ? "text-green-600 dark:text-green-400"
                : "text-blue-600 dark:text-blue-400"
            }`}
          >
            {allStepsComplete ? (
              <>
                <strong>🚀 Ready to Trade:</strong> Your account is fully set
                up! Click the button below to close this dialog and start
                exploring markets.
              </>
            ) : currentStep === 1 ? (
              <>
                <strong>🛡️ Secure Wallet:</strong> Your trading wallet is a
                Gnosis Safe - the most trusted smart contract wallet in crypto.
              </>
            ) : currentStep === 2 ? (
              <>
                <strong>🔐 USDC Approval:</strong> This one-time approval lets
                you trade instantly. Your funds stay in your wallet until you
                place a trade.
              </>
            ) : currentStep === 3 ? (
              <>
                <strong>🔑 API Credentials:</strong> Sign a message to create
                your unique trading credentials. No private keys are shared.
              </>
            ) : (
              <>
                <strong>💡 Gasless Setup:</strong> All setup transactions are
                free! Polymarket covers the gas fees through their relayer.
              </>
            )}
          </p>
        </div>

        {/* Finish Button - show when all steps complete */}
        {allStepsComplete && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Button
              className="w-full bg-linear-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-lg shadow-green-500/25"
              onClick={onComplete}
              size="lg"
            >
              <PartyPopper className="mr-2 h-5 w-5" />
              Start Trading
            </Button>
          </motion.div>
        )}

        {/* Skip Option - only show if not all complete */}
        {onSkip && !allStepsComplete && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={onSkip}
          >
            Skip for now
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
