"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useConnection } from "wagmi";
import {
  type ApiKeyCreds,
  useClobCredentials,
} from "@/hooks/use-clob-credentials";
import { useRelayerClient } from "@/hooks/use-relayer-client";
import { clearSession, getStoredSession, storeSession } from "@/lib/session";

/**
 * Trading session state
 * Tracks the complete onboarding and trading state for a user
 */
export interface TradingSession {
  eoaAddress: string;
  safeAddress: string | null;
  apiCredentials: ApiKeyCreds | null;
  isSafeDeployed: boolean;
  hasApprovals: boolean;
  isComplete: boolean;
}

/**
 * Trading session steps
 */
export type TradingStep =
  | "disconnected"
  | "connecting"
  | "deploying_safe"
  | "setting_approvals"
  | "deriving_credentials"
  | "ready"
  | "error";

/**
 * Trading context value
 */
interface TradingContextValue {
  // Session state
  session: TradingSession | null;
  currentStep: TradingStep;
  isInitializing: boolean;
  isLoading: boolean;
  error: string | null;

  // Addresses
  eoaAddress: string | null;
  safeAddress: string | null;

  // Status flags
  isConnected: boolean;
  isSafeDeployed: boolean;
  hasCredentials: boolean;
  hasApprovals: boolean;
  canTrade: boolean;

  // Actions
  initializeTradingSession: () => Promise<void>;
  deploySafe: () => Promise<{ success: boolean; error?: string }>;
  setApprovals: () => Promise<{ success: boolean; error?: string }>;
  deriveCredentials: () => Promise<ApiKeyCreds>;
  endTradingSession: () => void;
  refreshSession: () => void;
}

const TradingContext = createContext<TradingContextValue | null>(null);

/**
 * TradingProvider - Centralized trading state management
 *
 * This provider consolidates all trading-related state and operations:
 * - Wallet connection status
 * - Safe wallet deployment
 * - Token approvals
 * - API credentials
 * - Trading readiness
 *
 * Reference: https://github.com/Polymarket/wagmi-safe-builder-example
 */
export function TradingProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useConnection();

  // Use existing hooks
  const relayerClient = useRelayerClient();
  const clobCredentials = useClobCredentials();

  // Local state
  const [currentStep, setCurrentStep] = useState<TradingStep>("disconnected");
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasApprovals, setHasApprovals] = useState(false);

  // Derived state
  const eoaAddress = address || null;
  const safeAddress = relayerClient.proxyAddress;
  const isSafeDeployed = relayerClient.hasDeployedSafe;
  const hasCredentials = clobCredentials.hasCredentials;
  const isLoading = relayerClient.isLoading || clobCredentials.isLoading;

  // Can trade when all prerequisites are met
  const canTrade = useMemo(() => {
    return (
      isConnected &&
      isSafeDeployed &&
      !!safeAddress &&
      hasCredentials &&
      hasApprovals
    );
  }, [isConnected, isSafeDeployed, safeAddress, hasCredentials, hasApprovals]);

  // Build session object
  const session = useMemo<TradingSession | null>(() => {
    if (!eoaAddress) return null;

    return {
      eoaAddress,
      safeAddress,
      apiCredentials: clobCredentials.credentials,
      isSafeDeployed,
      hasApprovals,
      isComplete: canTrade,
    };
  }, [
    eoaAddress,
    safeAddress,
    clobCredentials.credentials,
    isSafeDeployed,
    hasApprovals,
    canTrade,
  ]);

  // Update step based on state
  useEffect(() => {
    if (!isConnected) {
      setCurrentStep("disconnected");
    } else if (error) {
      setCurrentStep("error");
    } else if (canTrade) {
      setCurrentStep("ready");
    } else if (!isSafeDeployed) {
      setCurrentStep("deploying_safe");
    } else if (!hasApprovals) {
      setCurrentStep("setting_approvals");
    } else if (!hasCredentials) {
      setCurrentStep("deriving_credentials");
    } else {
      setCurrentStep("ready");
    }
  }, [
    isConnected,
    isSafeDeployed,
    hasApprovals,
    hasCredentials,
    canTrade,
    error,
  ]);

  // Load stored session on mount
  useEffect(() => {
    if (eoaAddress) {
      const storedSession = getStoredSession(eoaAddress);
      if (storedSession) {
        console.log("[TradingProvider] Loaded stored session:", storedSession);
        setHasApprovals(storedSession.hasApprovals);
      }
    }
  }, [eoaAddress]);

  // Check approvals status when safe is deployed
  useEffect(() => {
    async function checkApprovals() {
      if (isSafeDeployed && safeAddress) {
        // Check stored session first for quick load
        const storedSession = eoaAddress ? getStoredSession(eoaAddress) : null;
        if (storedSession?.hasApprovals) {
          setHasApprovals(true);
          return;
        }

        // Check actual on-chain approvals
        try {
          const { checkAllApprovals } = await import("@/lib/approvals");
          const status = await checkAllApprovals(safeAddress);
          console.log("[TradingProvider] Approval status:", status);
          setHasApprovals(status.allApproved);
        } catch (err) {
          console.error("[TradingProvider] Failed to check approvals:", err);
          // Fall back to assuming approvals are set if safe is deployed
          setHasApprovals(true);
        }
      } else {
        setHasApprovals(false);
      }
    }

    checkApprovals();
  }, [isSafeDeployed, safeAddress, eoaAddress]);

  // Persist session when it changes
  useEffect(() => {
    if (eoaAddress && safeAddress && isSafeDeployed) {
      storeSession({
        eoaAddress,
        safeAddress,
        hasApprovals,
      });
      console.log("[TradingProvider] Session persisted");
    }
  }, [eoaAddress, safeAddress, isSafeDeployed, hasApprovals]);

  /**
   * Deploy Safe wallet
   */
  const deploySafe = useCallback(async () => {
    setError(null);
    const result = await relayerClient.deploySafe();
    if (!result.success && result.error) {
      setError(result.error);
    }
    return result;
  }, [relayerClient]);

  /**
   * Set token approvals
   */
  const setApprovals = useCallback(async () => {
    setError(null);
    const result = await relayerClient.approveUsdcForTrading();
    if (result.success) {
      setHasApprovals(true);
    } else if (result.error) {
      setError(result.error);
    }
    return result;
  }, [relayerClient]);

  /**
   * Derive API credentials
   */
  const deriveCredentials = useCallback(async () => {
    setError(null);
    try {
      return await clobCredentials.deriveCredentials();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to derive credentials";
      setError(errorMessage);
      throw err;
    }
  }, [clobCredentials]);

  /**
   * Initialize full trading session
   * Runs through all setup steps automatically
   */
  const initializeTradingSession = useCallback(async () => {
    if (!isConnected || !eoaAddress) {
      setError("Wallet not connected");
      return;
    }

    setIsInitializing(true);
    setError(null);

    try {
      // Step 1: Deploy Safe if needed
      if (!isSafeDeployed) {
        setCurrentStep("deploying_safe");
        const deployResult = await deploySafe();
        if (!deployResult.success) {
          throw new Error(deployResult.error || "Failed to deploy Safe");
        }
      }

      // Step 2: Set approvals if needed
      if (!hasApprovals) {
        setCurrentStep("setting_approvals");
        const approvalResult = await setApprovals();
        if (!approvalResult.success) {
          throw new Error(approvalResult.error || "Failed to set approvals");
        }
      }

      // Step 3: Derive credentials if needed
      if (!hasCredentials) {
        setCurrentStep("deriving_credentials");
        await deriveCredentials();
      }

      setCurrentStep("ready");
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Trading session initialization failed";
      setError(errorMessage);
      setCurrentStep("error");
    } finally {
      setIsInitializing(false);
    }
  }, [
    isConnected,
    eoaAddress,
    isSafeDeployed,
    hasApprovals,
    hasCredentials,
    deploySafe,
    setApprovals,
    deriveCredentials,
  ]);

  /**
   * End trading session (clear state and stored session)
   */
  const endTradingSession = useCallback(() => {
    if (eoaAddress) {
      clearSession(eoaAddress);
    }
    clobCredentials.clearCredentials();
    setHasApprovals(false);
    setError(null);
    setCurrentStep("disconnected");
  }, [clobCredentials, eoaAddress]);

  /**
   * Refresh session state
   */
  const refreshSession = useCallback(() => {
    relayerClient.checkSafeDeployment();
    clobCredentials.refresh();
  }, [relayerClient, clobCredentials]);

  const value: TradingContextValue = {
    // Session state
    session,
    currentStep,
    isInitializing,
    isLoading,
    error,

    // Addresses
    eoaAddress,
    safeAddress,

    // Status flags
    isConnected,
    isSafeDeployed,
    hasCredentials,
    hasApprovals,
    canTrade,

    // Actions
    initializeTradingSession,
    deploySafe,
    setApprovals,
    deriveCredentials,
    endTradingSession,
    refreshSession,
  };

  return (
    <TradingContext.Provider value={value}>{children}</TradingContext.Provider>
  );
}

/**
 * Hook to access trading context
 */
export function useTrading() {
  const context = useContext(TradingContext);
  if (!context) {
    throw new Error("useTrading must be used within a TradingProvider");
  }
  return context;
}
