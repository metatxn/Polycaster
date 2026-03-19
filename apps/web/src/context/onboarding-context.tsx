"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClobClient } from "@/hooks/use-clob-client";
import { useClobCredentials } from "@/hooks/use-clob-credentials";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useRelayerClient } from "@/hooks/use-relayer-client";

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
  const { address, isConnected } = useConnection();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const pathname = usePathname();
  const isPrivacyPage =
    pathname === "/privacy" || pathname.startsWith("/privacy/");

  // Track if we've already auto-shown the popup this session
  // This prevents showing it multiple times if user dismisses it
  const hasAutoShownRef = useRef(false);

  // Track previous connection state to detect new connections
  const wasConnectedRef = useRef(false);

  // Check if this wallet has already completed onboarding (from localStorage)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<
    boolean | null
  >(null);

  // Check localStorage on mount and when address changes
  useEffect(() => {
    if (address) {
      const isComplete = isOnboardingComplete(address);
      setHasCompletedOnboarding(isComplete);
      console.log(
        "[OnboardingContext] Checked localStorage for",
        address,
        ":",
        isComplete
      );
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

  const { getUsdcAllowance } = useClobClient();

  // Track USDC approval status
  const [hasUsdcApproval, setHasUsdcApproval] = useState<boolean | null>(null);
  const [isCheckingUsdcApproval, setIsCheckingUsdcApproval] = useState(false);

  // Compute setup status
  const hasProxyWallet = hasDeployedSafeFromRelayer || hasProxyWalletFromHook;
  const proxyAddress = proxyAddressFromHook || null;

  // Track if we've already checked USDC approval for this proxy address
  const checkedProxyAddressRef = useRef<string | null>(null);

  // Check USDC approval when proxy wallet is available
  useEffect(() => {
    const checkApproval = async () => {
      // Skip if no proxy wallet or already checking
      if (!hasProxyWallet || !proxyAddress) return;

      // Skip if we've already checked this proxy address
      if (checkedProxyAddressRef.current === proxyAddress) return;

      checkedProxyAddressRef.current = proxyAddress;
      setIsCheckingUsdcApproval(true);

      try {
        const result = await getUsdcAllowance(proxyAddress);
        const isApproved = result && result.allowance > 0;
        console.log("[OnboardingContext] USDC approval check:", {
          proxyAddress,
          allowance: result?.allowance,
          isApproved,
        });
        setHasUsdcApproval(isApproved);
      } catch (err) {
        console.error(
          "[OnboardingContext] Failed to check USDC approval:",
          err
        );
        setHasUsdcApproval(false);
      } finally {
        setIsCheckingUsdcApproval(false);
      }
    };

    checkApproval();
  }, [hasProxyWallet, proxyAddress, getUsdcAllowance]);

  // User is fully set up when they have: proxy wallet + USDC approval + credentials
  const isFullySetUp =
    hasCredentials && hasProxyWallet && hasUsdcApproval === true;

  // If localStorage says onboarding is complete, we should verify credentials still exist
  // sessionStorage (where credentials are stored) is cleared when browser closes,
  // but localStorage persists. So user may have "completed" onboarding before,
  // but lost their credentials when they closed the browser.
  // Only trust localStorage if credentials actually exist, OR if we're still loading credentials.
  const isSetupCompleteFromStorage =
    hasCompletedOnboarding === true && (hasCredentials || isCredentialsLoading);

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

  // Auto-show onboarding when:
  // 1. User just connected (wasConnected was false, now isConnected is true)
  // 2. Loading has completed
  // 3. User needs trading setup
  // 4. We haven't auto-shown this session yet
  useEffect(() => {
    const justConnected = !wasConnectedRef.current && isConnected;

    // Update the ref for next render
    wasConnectedRef.current = isConnected;

    // If user disconnected, reset the auto-shown flag so it can show again on reconnect
    if (!isConnected) {
      hasAutoShownRef.current = false;
      return;
    }

    // Check if we should auto-show
    if (
      isConnected &&
      !isCheckingSetup &&
      needsTradingSetup &&
      !hasAutoShownRef.current &&
      !isPrivacyPage &&
      justConnected
    ) {
      // Small delay to ensure UI has settled after wallet connection
      const timer = setTimeout(() => {
        setShowOnboarding(true);
        hasAutoShownRef.current = true;
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [isConnected, isCheckingSetup, needsTradingSetup, isPrivacyPage]);

  // Also auto-show if user connects and we detect they need setup after loading completes
  // This handles the case where loading takes time after connection
  useEffect(() => {
    if (
      isConnected &&
      !isCheckingSetup &&
      needsTradingSetup &&
      !hasAutoShownRef.current &&
      !isPrivacyPage &&
      !showOnboarding
    ) {
      // Small delay to ensure UI has settled, matching the delay in the primary effect
      const timer = setTimeout(() => {
        // Double-check conditions haven't changed during the delay
        if (!hasAutoShownRef.current) {
          setShowOnboarding(true);
          hasAutoShownRef.current = true;
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [
    isConnected,
    isCheckingSetup,
    needsTradingSetup,
    showOnboarding,
    isPrivacyPage,
  ]);

  // Never show onboarding on the Privacy Policy page (auto-close if open).
  useEffect(() => {
    if (isPrivacyPage && showOnboarding) {
      setShowOnboarding(false);
    }
  }, [isPrivacyPage, showOnboarding]);

  const handleComplete = useCallback(() => {
    setShowOnboarding(false);

    // Mark onboarding as complete in localStorage
    if (address) {
      markOnboardingComplete(address);
      setHasCompletedOnboarding(true);
      console.log(
        "[OnboardingContext] Marked onboarding complete for",
        address
      );
    }

    // Do a full page reload to ensure all components (especially sidebar)
    // pick up the new state. This is the most reliable way to refresh
    // all the hooks that depend on wallet/proxy state.
    // Small delay to let the dialog close animation finish
    setTimeout(() => {
      window.location.reload();
    }, 300);
  }, [address]);

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

      {/* Single global onboarding dialog */}
      <Dialog open={showOnboarding} onOpenChange={setShowOnboarding}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Setup Trading Account</DialogTitle>
          </DialogHeader>
          <TradingOnboarding onComplete={handleComplete} onSkip={handleSkip} />
        </DialogContent>
      </Dialog>
    </OnboardingContext.Provider>
  );
}
