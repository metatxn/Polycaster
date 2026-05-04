"use client";

import {
  normalizeTradingWalletMode,
  type TradingWalletMode,
} from "@knoww/shared-types/polymarket";
import { derivePolymarketSafe } from "@knoww/shared-types/relayer";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Address, getAddress } from "viem";
import { useConnection } from "wagmi";
import { checkIsDeployed } from "@/lib/rpc";

export type { TradingWalletMode };

const STORAGE_KEY = "knoww_trading_wallet_mode";
const MODE_CHANGE_EVENT = "knoww:trading-wallet-mode-change";

function getStorageKey(address?: string | null): string | null {
  if (!address) return null;
  return `${STORAGE_KEY}_${address.toLowerCase()}`;
}

function readStoredMode(address?: string | null): TradingWalletMode {
  if (typeof window === "undefined") return "deposit";
  const key = getStorageKey(address);
  if (!key) return "deposit";
  const stored = window.localStorage.getItem(key);
  if (!stored) return "deposit";
  return normalizeTradingWalletMode(stored);
}

function hasStoredMode(address?: string | null): boolean {
  if (typeof window === "undefined") return false;
  const key = getStorageKey(address);
  if (!key) return false;
  return window.localStorage.getItem(key) !== null;
}

export function useTradingWalletMode() {
  const { address } = useConnection();
  const [mode, setModeState] = useState<TradingWalletMode>(() =>
    readStoredMode(address)
  );
  const [hasLegacySafe, setHasLegacySafe] = useState(false);
  const [isCheckingLegacySafe, setIsCheckingLegacySafe] = useState(false);
  const [legacySafeAddress, setLegacySafeAddress] = useState<Address | null>(
    null
  );

  useEffect(() => {
    setModeState(readStoredMode(address));
    setHasLegacySafe(false);
    setIsCheckingLegacySafe(false);
    setLegacySafeAddress(null);
  }, [address]);

  useEffect(() => {
    if (!address) return;
    const connectedAddress = address;
    const storedModeExists = hasStoredMode(connectedAddress);

    let cancelled = false;
    async function detectLegacySafe() {
      setIsCheckingLegacySafe(true);
      try {
        const ownerAddress = getAddress(connectedAddress) as Address;
        const safeAddress = derivePolymarketSafe(ownerAddress);
        const safeDeployed = await checkIsDeployed(safeAddress);
        if (cancelled) return;

        setHasLegacySafe(safeDeployed);
        setLegacySafeAddress(safeDeployed ? safeAddress : null);

        if (safeDeployed && !storedModeExists) {
          setModeState("safe");
          if (typeof window !== "undefined") {
            const key = getStorageKey(connectedAddress);
            if (key) window.localStorage.setItem(key, "safe");
          }
        }
      } catch {
        if (!cancelled) {
          setHasLegacySafe(false);
          setLegacySafeAddress(null);
        }
        // Leave the selected/default mode unchanged when legacy detection fails.
      } finally {
        if (!cancelled) setIsCheckingLegacySafe(false);
      }
    }

    detectLegacySafe();

    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleModeChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          address?: string | null;
          mode?: TradingWalletMode;
        }>
      ).detail;
      if (
        !detail?.address ||
        detail.address.toLowerCase() !== address?.toLowerCase()
      ) {
        return;
      }
      setModeState(normalizeTradingWalletMode(detail.mode));
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== getStorageKey(address)) return;
      setModeState(normalizeTradingWalletMode(event.newValue));
    };

    window.addEventListener(MODE_CHANGE_EVENT, handleModeChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(MODE_CHANGE_EVENT, handleModeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [address]);

  const setMode = useCallback(
    (nextMode: TradingWalletMode) => {
      const normalizedMode = normalizeTradingWalletMode(nextMode);
      setModeState(normalizedMode);
      if (typeof window === "undefined") return;
      const key = getStorageKey(address);
      if (!key) return;
      window.localStorage.setItem(key, normalizedMode);
      window.dispatchEvent(
        new CustomEvent(MODE_CHANGE_EVENT, {
          detail: { address, mode: normalizedMode },
        })
      );
    },
    [address]
  );

  return useMemo(
    () => ({
      mode,
      setMode,
      isSafeMode: mode === "safe",
      isDepositMode: mode === "deposit",
      isEoaMode: mode === "eoa",
      hasLegacySafe,
      isCheckingLegacySafe,
      legacySafeAddress,
    }),
    [mode, setMode, hasLegacySafe, isCheckingLegacySafe, legacySafeAddress]
  );
}
