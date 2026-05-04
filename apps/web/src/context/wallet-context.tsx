"use client";

import { useAppKit } from "@reown/appkit/react";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { createPublicClient, http, type PublicClient } from "viem";
import { polygon } from "viem/chains";
import {
  type UseWalletClientReturnType,
  useConnection,
  useWalletClient,
} from "wagmi";
import { getRpcUrl } from "@/lib/rpc";

/**
 * Wallet context value
 *
 * Provides a clean abstraction over wagmi with viem clients.
 * Components should use this hook instead of importing wagmi hooks directly.
 *
 * Reference: https://github.com/Polymarket/wagmi-safe-builder-example
 */
interface WalletContextValue {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;

  // Addresses
  eoaAddress: string | null;

  // Clients
  walletClient: UseWalletClientReturnType["data"] | null;
  publicClient: PublicClient;

  // Actions
  connect: () => void;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

// Create a singleton public client for read operations
// Uses Alchemy if configured, falls back to custom RPC or public RPC
const polygonPublicClient = createPublicClient({
  chain: polygon,
  transport: http(getRpcUrl()),
});

/**
 * WalletProvider - Wallet abstraction layer
 *
 * This provider wraps wagmi and provides:
 * 1. Clean API for wallet connection state
 * 2. viem public client for efficient reads
 * 3. Single source of truth for wallet state
 *
 * Benefits:
 * - Components never import wagmi hooks directly
 * - Easy to swap wallet providers in the future
 * - viem clients available to app code
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, isConnecting } = useConnection();
  const { data: walletClient, isLoading: isWalletClientLoading } =
    useWalletClient();
  const { open, close } = useAppKit();

  // EOA address
  const eoaAddress = address || null;

  // Connect wallet via AppKit modal
  const connect = useCallback(() => {
    open();
  }, [open]);

  // Disconnect wallet using AppKit
  const disconnect = useCallback(async () => {
    await close();
  }, [close]);

  const value = useMemo<WalletContextValue>(
    () => ({
      // Connection state
      isConnected,
      isConnecting: isConnecting || isWalletClientLoading,

      // Addresses
      eoaAddress,

      // Clients
      walletClient: walletClient || null,
      publicClient: polygonPublicClient,

      // Actions
      connect,
      disconnect,
    }),
    [
      isConnected,
      isConnecting,
      isWalletClientLoading,
      eoaAddress,
      walletClient,
      connect,
      disconnect,
    ]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

/**
 * Hook to access wallet context
 *
 * Usage:
 * ```tsx
 * const { eoaAddress, isConnected, publicClient, walletClient } = useWallet();
 *
 * // Read data with viem
 * const balance = await publicClient.readContract({...});
 * ```
 */
export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
