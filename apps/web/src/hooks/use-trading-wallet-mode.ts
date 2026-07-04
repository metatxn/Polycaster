"use client";

import {
  normalizeTradingWalletMode,
  resolvePreferredTradingWalletMode,
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
  // A stored "safe" is only ever written after a successful on-chain legacy
  // Safe detection, so honor it synchronously — otherwise legacy-Safe users
  // run in deposit mode (wrong proxy, $0 balances) until the async check
  // lands, and indefinitely if that RPC check fails.
  return resolvePreferredTradingWalletMode({
    storedMode: stored,
    legacySafeDeployed: stored === "safe",
  });
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

    let cancelled = false;
    async function detectLegacySafe() {
      setIsCheckingLegacySafe(true);
      try {
        const ownerAddress = getAddress(connectedAddress) as Address;
        const safeAddress = derivePolymarketSafe(ownerAddress);
        const safeDeployed = await checkIsDeployed(safeAddress);
        if (cancelled) return;
        const key = getStorageKey(connectedAddress);
        const storedMode =
          typeof window !== "undefined" && key
            ? window.localStorage.getItem(key)
            : null;
        // checkIsDeployed swallows RPC failures into `false`, so a stored
        // "safe" (only ever written after a successful detection) counts as
        // legacy-Safe evidence — without it, one failed read would downgrade
        // the whole session to deposit mode.
        const legacySafeDeployed = safeDeployed || storedMode === "safe";
        const preferredMode = resolvePreferredTradingWalletMode({
          storedMode,
          legacySafeDeployed,
        });

        setHasLegacySafe(legacySafeDeployed);
        setLegacySafeAddress(legacySafeDeployed ? safeAddress : null);
        setModeState(preferredMode);

        if (
          typeof window !== "undefined" &&
          key &&
          safeDeployed &&
          storedMode === null
        ) {
          window.localStorage.setItem(key, preferredMode);
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
      setModeState(
        resolvePreferredTradingWalletMode({
          storedMode: detail.mode,
          legacySafeDeployed: hasLegacySafe || detail.mode === "safe",
        })
      );
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== getStorageKey(address)) return;
      setModeState(
        resolvePreferredTradingWalletMode({
          storedMode: event.newValue,
          legacySafeDeployed: hasLegacySafe || event.newValue === "safe",
        })
      );
    };

    window.addEventListener(MODE_CHANGE_EVENT, handleModeChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(MODE_CHANGE_EVENT, handleModeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [address, hasLegacySafe]);

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
