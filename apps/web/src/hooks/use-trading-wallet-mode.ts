"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection } from "wagmi";

export type TradingWalletMode = "safe" | "eoa";

const STORAGE_KEY = "knoww_trading_wallet_mode";
const MODE_CHANGE_EVENT = "knoww:trading-wallet-mode-change";

function getStorageKey(address?: string | null): string | null {
  if (!address) return null;
  return `${STORAGE_KEY}_${address.toLowerCase()}`;
}

function readStoredMode(address?: string | null): TradingWalletMode {
  if (typeof window === "undefined") return "safe";
  const key = getStorageKey(address);
  if (!key) return "safe";
  const stored = window.localStorage.getItem(key);
  return stored === "eoa" ? "eoa" : "safe";
}

export function useTradingWalletMode() {
  const { address } = useConnection();
  const [mode, setModeState] = useState<TradingWalletMode>(() =>
    readStoredMode(address)
  );

  useEffect(() => {
    setModeState(readStoredMode(address));
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
      setModeState(detail.mode === "eoa" ? "eoa" : "safe");
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== getStorageKey(address)) return;
      setModeState(event.newValue === "eoa" ? "eoa" : "safe");
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
      setModeState(nextMode);
      if (typeof window === "undefined") return;
      const key = getStorageKey(address);
      if (!key) return;
      window.localStorage.setItem(key, nextMode);
      window.dispatchEvent(
        new CustomEvent(MODE_CHANGE_EVENT, {
          detail: { address, mode: nextMode },
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
      isEoaMode: mode === "eoa",
    }),
    [mode, setMode]
  );
}
