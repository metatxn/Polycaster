"use client";

import {
  normalizeTradingWalletMode,
  type TradingWalletMode,
} from "@knoww/shared-types/polymarket";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection } from "wagmi";

export type { TradingWalletMode };

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
  return normalizeTradingWalletMode(stored);
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
      isEoaMode: mode === "eoa",
    }),
    [mode, setMode]
  );
}
