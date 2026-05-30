"use client";

import { createLogger } from "@knoww/logger";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const log = createLogger("onboarding-context");

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useConnection } from "wagmi";
import { TradingOnboarding } from "@/components/trading-onboarding";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClobCredentials } from "@/hooks/use-clob-credentials";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useRelayerClient } from "@/hooks/use-relayer-client";
import { checkAllApprovals } from "@/lib/approvals";
import { isOnboardingSuppressedPath } from "./onboarding-route-suppression";

// LocalStorage key for tracking completed onboarding
const ONBOARDING_COMPLETE_KEY = "knoww_onboarding_complete";

/**
 * Check if onboarding is marked as complete for a specific wallet
 */
function isOnboardingComplete(walletAddress: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(ONBOARDING_COMPLETE_KEY);
    if (!stored) return false;
    const completedWallets = JSON.parse(stored) as string[];
    return completedWallets.includes(walletAddress.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Mark onboarding as complete for a specific wallet
 */
function markOnboardingComplete(walletAddress: string): void {
  if (typeof window === "undefined") return;
  try {
    const stored = localStorage.getItem(ONBOARDING_COMPLETE_KEY);
    const completedWallets: string[] = stored ? JSON.parse(stored) : [];
    const lowerAddress = walletAddress.toLowerCase();
    if (!completedWallets.includes(lowerAddress)) {
      completedWallets.push(lowerAddress);
      localStorage.setItem(
        ONBOARDING_COMPLETE_KEY,
        JSON.stringify(completedWallets)
      );
    }
  } catch {
    // Ignore localStorage errors
  }
}

interface OnboardingContextValue {
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  needsTradingSetup: boolean;
  isCheckingSetup: boolean;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return context;
}

interface OnboardingProviderProps {
  children: ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const { address, isConnected, status } = useConnection();
  const [showOnboardingState, setShowOnboardingState] = useState(false);
  const pathname = usePathname();
  const isOnboardingSuppressed = isOnboardingSuppressedPath(pathname);
  const showOnboarding = showOnboardingState && !isOnboardingSuppressed;
  const setShowOnboarding = useCallback(
    (show: boolean) => {
      setShowOnboardingState(show && !isOnboardingSuppressed);
    },
    [isOnboardingSuppressed]
  );

  // Track if we've already auto-shown the popup this session
  // This prevents showing it multiple times if user dismisses it
  const hasAutoShownRef = useRef(false);

  // Check if this wallet has already completed onboarding (from localStorage)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<
    boolean | null
  >(null);

  // Check localStorage on mount and when address changes
  useEffect(() => {
    if (address) {
      const isComplete = isOnboardingComplete(address);
      setHasCompletedOnboarding(isComplete);
      log.debug("localStorage.checked", { address, isComplete });
    } else {
      setHasCompletedOnboarding(null);
    }
  }, [address]);

  // Get setup status from hooks
  const {
    isDeployed: hasProxyWalletFromHook,
    isLoading: isProxyLoading,
    proxyAddress: proxyAddressFromHook,
  } = useProxyWallet();

  const {
    hasDeployedSafe: hasDeployedSafeFromRelayer,
    isLoading: isRelayerLoading,
  } = useRelayerClient();

  const { hasCredentials, isLoading: isCredentialsLoading } =
    useClobCredentials();

  // Track trading approval status. The name `hasUsdcApproval` is retained for
  // backwards compatibility with downstream derived state, but semantically
  // this now means the default app trading approvals are set (pUSD → CTF and
  // both exchanges, USDC.e → Onramp, CTF → both exchanges).
  const [hasUsdcApproval, setHasUsdcApproval] = useState<boolean | null>(null);
  const [isCheckingUsdcApproval, setIsCheckingUsdcApproval] = useState(false);

  // Compute setup status
  const hasProxyWallet = hasDeployedSafeFromRelayer || hasProxyWalletFromHook;
  const proxyAddress = proxyAddressFromHook || null;

  // Track if we've already checked trading approvals for this proxy address
  const checkedProxyAddressRef = useRef<string | null>(null);

  // Check trading approvals when proxy wallet is available. Uses the shared
  // `checkAllApprovals` helper so this gate matches what TradingOnboarding
  // uses — previously this checked USDC.e→CTFExchange (a V1 allowance that
  // can be set without any V2 approval existing), which produced both false
  // positives for V1-only users and false negatives for clean V2 users.
  useEffect(() => {
    const checkApproval = async () => {
      // Skip if no proxy wallet or already checking
      if (!hasProxyWallet || !proxyAddress) return;

      // Skip if we've already checked this proxy address
      if (checkedProxyAddressRef.current === proxyAddress) return;

      checkedProxyAddressRef.current = proxyAddress;
      setIsCheckingUsdcApproval(true);

      try {
        const status = await checkAllApprovals(proxyAddress);
        log.debug("approvals.v2_check", { proxyAddress, ...status });
        setHasUsdcApproval(status.allApproved);
      } catch (err) {
        log.error("approvals.v2_check_failed", { error: err });
        setHasUsdcApproval(false);
      } finally {
        setIsCheckingUsdcApproval(false);
      }
    };

    checkApproval();
  }, [hasProxyWallet, proxyAddress]);

  // User is fully set up when they have: proxy wallet + full V2 approval
  // set + credentials
  const isFullySetUp =
    hasCredentials && hasProxyWallet && hasUsdcApproval === true;

  // If localStorage says onboarding is complete, we should verify credentials still exist
  // sessionStorage (where credentials are stored) is cleared when browser closes,
  // but localStorage persists. So user may have "completed" onboarding before,
  // but lost their credentials when they closed the browser.
  // Only trust localStorage if credentials actually exist, OR if we're still
  // loading credentials, and the current V2 approval set is still valid.
  // This invalidates older V1 completion records that predate pUSD approvals.
  const isSetupCompleteFromStorage =
    hasCompletedOnboarding === true &&
    hasUsdcApproval === true &&
    (hasCredentials || isCredentialsLoading);

  const isCheckingSetup =
    isCredentialsLoading ||
    isProxyLoading ||
    isRelayerLoading ||
    isCheckingUsdcApproval ||
    (hasProxyWallet && hasUsdcApproval === null) || // Still checking USDC approval
    hasCompletedOnboarding === null; // Still checking localStorage

  // Don't need setup if: not connected, still checking, fully set up, OR localStorage says complete
  const needsTradingSetup =
    isConnected &&
    !isCheckingSetup &&
    !isFullySetUp &&
    !isSetupCompleteFromStorage;

  // Auto-show onboarding whenever a connected wallet still needs setup.
  // We don't gate on a `connecting`/`reconnecting` → `connected` transition
  // because Reown AppKit's cookie hydration can deliver `status === "connected"`
  // on the very first render, with no intermediate state to observe. The
  // `hasAutoShownRef` guard (reset on disconnect) ensures we only auto-open
  // once per session — dismissals stick until the next reconnect.
  useEffect(() => {
    if (status === "disconnected") {
      hasAutoShownRef.current = false;
      return;
    }

    if (
      status === "connected" &&
      !isCheckingSetup &&
      needsTradingSetup &&
      !hasAutoShownRef.current &&
      !isOnboardingSuppressed
    ) {
      const timer = setTimeout(() => {
        setShowOnboarding(true);
        hasAutoShownRef.current = true;
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [
    status,
    isCheckingSetup,
    needsTradingSetup,
    isOnboardingSuppressed,
    setShowOnboarding,
  ]);

  // Never show onboarding on routes where the global trading setup dialog
  // interferes with route-specific surfaces.
  useEffect(() => {
    if (isOnboardingSuppressed && showOnboardingState) {
      setShowOnboardingState(false);
    }
  }, [isOnboardingSuppressed, showOnboardingState]);

  const handleComplete = useCallback(() => {
    setShowOnboarding(false);

    // Mark onboarding as complete in localStorage
    if (address) {
      markOnboardingComplete(address);
      setHasCompletedOnboarding(true);
      log.debug("onboarding.marked_complete", { address });
    }

    // Do a full page reload to ensure all components (especially sidebar)
    // pick up the new state. This is the most reliable way to refresh
    // all the hooks that depend on wallet/proxy state.
    // Small delay to let the dialog close animation finish
    setTimeout(() => {
      window.location.reload();
    }, 300);
  }, [address, setShowOnboarding]);

  const handleSkip = () => {
    setShowOnboarding(false);
  };

  return (
    <OnboardingContext.Provider
      value={{
        showOnboarding,
        setShowOnboarding,
        needsTradingSetup,
        isCheckingSetup,
      }}
    >
      {children}

      {/* Single global onboarding dialog. The Radix default close button
          is hidden — the redesigned onboarding renders its own X in the
          header so the chrome stays inside the panel design system. */}
      <Dialog open={showOnboarding} onOpenChange={setShowOnboarding}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/60 backdrop-blur-md"
          className="sm:max-w-md p-0 gap-0 rounded-md overflow-hidden border border-border shadow-[0_40px_80px_-30px_rgba(0,0,0,0.55)]"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Set Up Trading Account</DialogTitle>
            <DialogDescription>
              Complete a few one-time steps — wallet connection, trading wallet
              deployment, and approvals — to start placing orders on Polymarket.
            </DialogDescription>
          </DialogHeader>
          <TradingOnboarding
            onComplete={handleComplete}
            onSkip={handleSkip}
            onClose={handleSkip}
          />
        </DialogContent>
      </Dialog>
    </OnboardingContext.Provider>
  );
}
