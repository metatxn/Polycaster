"use client";

import { createLogger } from "@knoww/logger";
import { SHOW_EOA_OPTION } from "@knoww/shared-types/polymarket";
import { formatTradingOnboardingError } from "@knoww/shared-types/trading-errors";
import { useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Key, Loader2, Wallet, X, Zap } from "lucide-react";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { useConnection } from "wagmi";
import { useClobCredentials } from "@/hooks/use-clob-credentials";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useRelayerClient } from "@/hooks/use-relayer-client";
import { useTradingWalletMode } from "@/hooks/use-trading-wallet-mode";
import { checkAllApprovals } from "@/lib/approvals";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { openWalletModalStrict } from "@/lib/wallet-modal";

const log = createLogger("trading-onboarding");

/**
 * Trading onboarding — single-modal flow that walks a connected user
 * through the four one-time steps required to place trades on Polymarket:
 * connect, deploy trading vault, approve permissions, generate API keys.
 *
 * Visual system mirrors the `Knoww Setup Trading` design handoff
 * (`.readability/design-pkg/onboarding`): warm-dark panel, mono eyebrow
 * with live pulse + net chip, thin inline stepper, step rows with state
 * pills (`Done` / `Sign →` / `Pending`), inline approve form on the
 * active Approve step. Styles live in `.kw-onboarding` in globals.css.
 *
 * No "Continue / Start Trading" button — the per-step action carries the
 * flow forward, and a quiet `Skip for now` ghost link is the only footer
 * action. When the user signs the final step, `onComplete` fires and the
 * parent context closes the modal.
 */

type StepStatus = "pending" | "in_progress" | "completed" | "error";
type StepId = "connect" | "deploy" | "approve" | "credentials";
type StepState = "done" | "now" | "locked";

interface OnboardingStep {
  id: StepId;
  /** Short name shown in the inline stepper bar (e.g. CONNECT). */
  name: string;
  /** Long mono-caps title rendered in the step row (e.g. CONNECT WALLET). */
  title: string;
  /** Body description rendered below the title. */
  description: string;
  /** Optional 9px green tag rendered after the description (e.g. FREE). */
  tag?: string;
  icon: React.ReactNode;
  status: StepStatus;
  errorMessage?: string;
}

interface TradingOnboardingProps {
  onComplete?: () => void;
  onSkip?: () => void;
  /** When provided, the modal renders a custom close X button that calls
   *  this — separate from the global Dialog's default close button. */
  onClose?: () => void;
}

/* ─────────── icons (scaled for the 40x40 chip) ─────────── */

function VaultIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="3.5"
        width="13"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M9 9L11 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M5 14.5v1.5M13 14.5v1.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 5.2l2 2L8 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─────────── component ─────────── */

export function TradingOnboarding({
  onComplete,
  onSkip,
  onClose,
}: TradingOnboardingProps) {
  const { address, isConnected } = useConnection();
  const queryClient = useQueryClient();
  const {
    mode: walletMode,
    setMode: setWalletMode,
    hasLegacySafe,
    isCheckingLegacySafe,
  } = useTradingWalletMode();
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
    forceRefresh: forceRefreshProxyWallet,
    proxyAddress: computedProxyAddress,
    walletMode: proxyWalletMode,
    usdcBalance,
  } = useProxyWallet();

  const hasProxyWalletFromSelectedMode =
    hasProxyWalletFromHook && proxyWalletMode === walletMode;
  const hasProxyWallet = hasDeployedSafe || hasProxyWalletFromSelectedMode;
  const proxyAddress =
    relayerProxyAddress ||
    (proxyWalletMode === walletMode ? computedProxyAddress : null);

  const showLegacySafeOption = walletMode === "safe" || hasLegacySafe;
  const showDepositOption = !showLegacySafeOption;
  const walletModeOptions = [
    showDepositOption ? { mode: "deposit" as const, label: "Deposit" } : null,
    showLegacySafeOption ? { mode: "safe" as const, label: "Safe" } : null,
    SHOW_EOA_OPTION ? { mode: "eoa" as const, label: "EOA" } : null,
  ].filter((opt): opt is { mode: "deposit" | "safe" | "eoa"; label: string } =>
    Boolean(opt)
  );
  const hasMultipleWalletModes = walletModeOptions.length > 1;
  const netChipLabel =
    walletMode === "eoa"
      ? "EOA · Polygon"
      : walletMode === "safe"
        ? "Knoww Safe"
        : "Knoww Vault";

  const [hasUsdcApproval, setHasUsdcApproval] = useState<boolean | null>(null);
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);
  const [approvalAmount, setApprovalAmount] = useState("100");

  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<OnboardingStep[]>([
    {
      id: "connect",
      name: "Connect",
      title: "Connect Wallet",
      description: "Link the wallet you'll fund and withdraw with.",
      icon: <Wallet className="h-[18px] w-[18px]" strokeWidth={1.2} />,
      status: "pending",
    },
    {
      id: "deploy",
      name: "Vault",
      title: "Create Trading Vault",
      description: "Deploy your gas-free Knoww vault for fast settlement.",
      tag: "FREE",
      icon: <VaultIcon />,
      status: "pending",
    },
    {
      id: "approve",
      name: "Approve",
      title: "Approve Permissions",
      description: "Set USDC and outcome-token allowances. One signature.",
      tag: "FREE",
      icon: <Zap className="h-[18px] w-[18px]" strokeWidth={1.2} />,
      status: "pending",
    },
    {
      id: "credentials",
      name: "API Keys",
      title: "Generate API Keys",
      description: "Sign once to mint your private trading credentials.",
      icon: <Key className="h-[18px] w-[18px]" strokeWidth={1.2} />,
      status: "pending",
    },
  ]);

  /** Track the previous all-complete to fire `onComplete` exactly once on
   *  the incomplete → complete transition (returning users with all four
   *  steps already done on mount should NOT auto-trigger onComplete). */
  const prevAllCompleteRef = useRef<boolean | null>(null);

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
    (stepId: StepId, status: StepStatus, errorMessage?: string) => {
      setSteps((prev) =>
        prev.map((step) =>
          step.id === stepId ? { ...step, status, errorMessage } : step
        )
      );
    },
    []
  );

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
      await openWalletModalStrict();
    } catch (err) {
      updateStepStatus(
        "connect",
        "error",
        formatTradingOnboardingError(err, "Failed to connect wallet")
      );
    }
  }, [updateStepStatus]);

  const handleDeploySafe = useCallback(async () => {
    if (isCheckingLegacySafe) return;
    if (walletMode === "eoa") {
      updateStepStatus("deploy", "completed");
      setCurrentStep(2);
      return;
    }
    updateStepStatus("deploy", "in_progress");
    try {
      const result = await deploySafe();
      if (result.success) {
        posthog.capture("trading_account_created", {
          product: "web",
          surface: "onboarding",
          ...(address ? { wallet_address: getAddress(address) } : {}),
          wallet_mode: walletMode,
        });
        updateStepStatus("deploy", "completed");
        setCurrentStep(2);
        await forceRefreshProxyWallet();
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
  }, [
    address,
    deploySafe,
    updateStepStatus,
    forceRefreshProxyWallet,
    walletMode,
    isCheckingLegacySafe,
  ]);

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
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: qk.wallet.allTradingApprovals(),
          }),
          queryClient.invalidateQueries({
            queryKey: qk.wallet.allUsdcAllowances(),
          }),
        ]);
        posthog.capture("trading_token_approval_succeeded", {
          product: "web",
          surface: "onboarding",
          ...(address ? { wallet_address: getAddress(address) } : {}),
          wallet_mode: walletMode,
        });
        updateStepStatus("approve", "completed");
        setHasUsdcApproval(true);
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
    address,
    approveUsdcForTrading,
    approvalAmount,
    isApprovalAmountValid,
    queryClient,
    updateStepStatus,
    walletMode,
  ]);

  const handleDeriveCredentials = useCallback(async () => {
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
        formatTradingOnboardingError(err, "Failed to set up credentials")
      );
    }
  }, [
    deriveCredentials,
    updateStepStatus,
    onComplete,
    hasProxyWallet,
    hasUsdcApproval,
  ]);

  // Connect → mark complete + advance
  useEffect(() => {
    if (isConnected && steps[0].status !== "completed") {
      updateStepStatus("connect", "completed");
      setCurrentStep(1);
    }
  }, [isConnected, steps, updateStepStatus]);

  // Deploy → mark complete + advance + kick off approval check
  useEffect(() => {
    if (hasProxyWallet) {
      if (steps[1].status !== "completed") {
        updateStepStatus("deploy", "completed");
      }
      if (currentStep < 2) {
        setCurrentStep(2);
      }
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

  // Approve → mark complete + advance if returning user already approved
  useEffect(() => {
    if (hasUsdcApproval === true && steps[2].status !== "completed") {
      updateStepStatus("approve", "completed");
      if (currentStep < 3) {
        setCurrentStep(3);
      }
    }
  }, [hasUsdcApproval, steps, currentStep, updateStepStatus]);

  // Credentials → mark complete if returning user already has credentials
  useEffect(() => {
    if (hasCredentials && steps[3].status !== "completed") {
      updateStepStatus("credentials", "completed");
    }
  }, [hasCredentials, steps, updateStepStatus]);

  const allStepsComplete = steps.every((s) => s.status === "completed");

  // Fire onComplete exactly once on the incomplete → complete transition.
  useEffect(() => {
    if (prevAllCompleteRef.current === null) {
      prevAllCompleteRef.current = allStepsComplete;
      return;
    }
    const wasIncomplete = prevAllCompleteRef.current === false;
    const nowComplete = allStepsComplete === true;
    if (wasIncomplete && nowComplete) {
      log.debug("steps.all_complete");
      onComplete?.();
    }
    prevAllCompleteRef.current = allStepsComplete;
  }, [allStepsComplete, onComplete]);

  const isLoading = isRelayerLoading || isClobLoading || isCheckingApproval;
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const total = steps.length;

  const stateFor = (index: number): StepState => {
    const step = steps[index];
    if (step.status === "completed") return "done";
    if (index === currentStep) return "now";
    return "locked";
  };

  /** Per-step action handler. The active step has a per-step CTA (or the
   *  inline Approve form), prior steps render Done, and locked steps
   *  render Pending. */
  const handleStepAction = (id: StepId) => {
    switch (id) {
      case "connect":
        return handleConnectWallet();
      case "deploy":
        return handleDeploySafe();
      case "approve":
        return handleApproveUsdc();
      case "credentials":
        return handleDeriveCredentials();
    }
  };

  return (
    <div className="kw-app">
      <div className="kw-onboarding">
        {/* Header */}
        <header className="px-5 pt-4 pb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="kwo-eyebrow">
              <span className="kwo-pulse" aria-hidden="true" />
              <span className="kwo-sec">§</span>
              <span>Set up trading</span>
              <span style={{ color: "var(--kwm-ink-dim)" }}>·</span>
              <span className="font-mono" style={{ color: "var(--kwm-ink-3)" }}>
                {String(completedSteps).padStart(2, "0")} /{" "}
                {String(total).padStart(2, "0")}
              </span>
              <span className="kwo-net" title={netChipLabel}>
                <span className="kwo-net-dot" aria-hidden="true" />
                {netChipLabel}
              </span>
            </span>
            <h1 className="kwo-title">A few steps, then you're trading.</h1>
            <p className="kwo-sub">
              Complete these once. Knoww remembers — you won't see this again.
            </p>

            {hasMultipleWalletModes && !allStepsComplete && (
              <div className="kwo-mode">
                {walletModeOptions.map((opt) => (
                  <button
                    key={opt.mode}
                    type="button"
                    aria-pressed={walletMode === opt.mode}
                    onClick={() => setWalletMode(opt.mode)}
                    className={cn(
                      "kwo-mode-chip",
                      walletMode === opt.mode && "on"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              className="kwo-x"
              aria-label="Close"
              onClick={onClose}
            >
              <X className="h-3 w-3" strokeWidth={1.4} />
            </button>
          )}
        </header>

        {/* Inline thin stepper */}
        <div className="kwo-stepper mt-3 mx-5">
          {steps.map((s, i) => {
            const st = stateFor(i);
            return (
              <span key={s.id} className="contents">
                <div className={cn("kwo-sb-node", st)}>
                  <span className="kwo-sb-bullet">
                    {st === "done" ? (
                      <CheckGlyph size={9} />
                    ) : (
                      <span className="kwo-sb-num">{i + 1}</span>
                    )}
                  </span>
                  <span className="kwo-sb-label">{s.name}</span>
                </div>
                {i < steps.length - 1 && (
                  <span
                    className={cn("kwo-sb-line", i < currentStep && "on")}
                    aria-hidden="true"
                  />
                )}
              </span>
            );
          })}
        </div>

        {/* Step rows */}
        <div className="px-5 pt-4 pb-1 flex flex-col">
          {steps.map((s, i) => {
            const st = stateFor(i);
            const isExpandedApprove = st === "now" && s.id === "approve";
            return (
              <div
                key={s.id}
                className={cn(
                  "kwo-step",
                  st,
                  isExpandedApprove && "kwo-step-expanded"
                )}
              >
                <span className="kwo-rail" aria-hidden="true" />
                <div className="kwo-icon">{s.icon}</div>

                <div className="kwo-body">
                  <div className="kwo-step-title">
                    <span className="kwo-idx">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{s.title}</span>
                  </div>
                  <div className="kwo-step-desc">
                    {s.description}
                    {s.tag && st !== "done" && (
                      <span className="kwo-tag">{s.tag}</span>
                    )}
                  </div>

                  {s.errorMessage && (
                    <p className="kwo-error">{s.errorMessage}</p>
                  )}

                  {isExpandedApprove && (
                    <div className="kwo-approve-form">
                      <div className="kwo-af-row">
                        <div className="kwo-af-field">
                          <label
                            className="kwo-af-label"
                            htmlFor="kwo-approval-amount"
                          >
                            Approval limit
                          </label>
                          <div className="kwo-af-input">
                            <input
                              id="kwo-approval-amount"
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
                              aria-invalid={!isApprovalAmountValid}
                              aria-label="Approval limit"
                            />
                            <span className="kwo-af-unit">USDC</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="kwo-go"
                          onClick={() => handleStepAction("approve")}
                          disabled={isLoading || !isApprovalAmountValid}
                        >
                          {s.status === "in_progress" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              Approve <span className="kwo-arr">→</span>
                            </>
                          )}
                        </button>
                      </div>
                      <p className="kwo-af-help">
                        ERC-20 allowances use this cap. Outcome-token sell
                        permissions are binary — granted once as an operator
                        approval.
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  {st === "done" && (
                    <span className="kwo-step-state">
                      <span className="kwo-ck">
                        <CheckGlyph />
                      </span>
                      Done
                    </span>
                  )}
                  {st === "now" && s.id !== "approve" && (
                    <button
                      type="button"
                      className="kwo-go"
                      onClick={() => handleStepAction(s.id)}
                      aria-label={
                        s.id === "deploy" && isCheckingLegacySafe
                          ? "Checking wallet"
                          : undefined
                      }
                      disabled={
                        isLoading || (s.id === "deploy" && isCheckingLegacySafe)
                      }
                    >
                      {s.status === "in_progress" ||
                      (s.id === "deploy" && isCheckingLegacySafe) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          Sign <span className="kwo-arr">→</span>
                        </>
                      )}
                    </button>
                  )}
                  {st === "locked" && (
                    <span className="kwo-step-state">
                      <span className="kwo-ck">—</span>
                      Pending
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Proxy address — preserved for users who want to verify their
            vault on-chain. Only shown once the vault is deployed. */}
        {proxyAddress && !allStepsComplete && (
          <div className="px-5 pt-2 pb-1">
            <a
              href={`https://polygonscan.com/address/${proxyAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] tracking-[0.14em] uppercase hover:opacity-80 transition-opacity"
              style={{ color: "var(--kwm-ink-3)" }}
            >
              Vault {proxyAddress.slice(0, 6)}…{proxyAddress.slice(-4)} ↗
            </a>
          </div>
        )}

        {/* Footer — Skip ghost link only */}
        <div className="px-5 pt-3 pb-5 flex items-center justify-center">
          {onSkip && !allStepsComplete && (
            <button type="button" className="kwo-skip" onClick={onSkip}>
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
