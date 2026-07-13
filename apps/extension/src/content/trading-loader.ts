import type { TradingRuntime } from "./trading-runtime-types";
import { TRADING_WARM_ELIGIBLE_STORAGE_KEY } from "./trading-warm-flag";

export type ImportTradingEntry = () => Promise<{
  createTradingRuntime(): TradingRuntime;
}>;

const defaultImport: ImportTradingEntry = () =>
  import(/* webpackIgnore: true */ chrome.runtime.getURL("content-trading.js"));

let inflight: Promise<TradingRuntime> | null = null;
let loaded: TradingRuntime | null = null;

export function loadTradingRuntime(
  importEntry: ImportTradingEntry = defaultImport
): Promise<TradingRuntime> {
  if (loaded) return Promise.resolve(loaded);
  if (inflight) return inflight;

  const loading = importEntry()
    .then((module) => {
      const runtime = module.createTradingRuntime();
      loaded = runtime;
      if (inflight === loading) inflight = null;
      return runtime;
    })
    .catch((error: unknown) => {
      if (inflight === loading) inflight = null;
      throw error;
    });
  inflight = loading;
  return loading;
}

export function getLoadedRuntime(): TradingRuntime | null {
  return loaded;
}

/**
 * Task 9 keeps the runtime eager while proving the core dispatcher contract.
 * Adopt that already-created singleton without introducing a dynamic import.
 */
export function adoptLoadedTradingRuntime(
  runtime: TradingRuntime
): TradingRuntime {
  if (loaded === runtime) return runtime;
  if (loaded) {
    throw new Error("Cannot adopt a different trading runtime.");
  }
  if (inflight) {
    throw new Error(
      "Cannot adopt a trading runtime while an import is in flight."
    );
  }
  loaded = runtime;
  return runtime;
}

export function prefetchTradingRuntime(
  importEntry: ImportTradingEntry = defaultImport
): void {
  void chrome.storage.local
    .get(TRADING_WARM_ELIGIBLE_STORAGE_KEY)
    .then((result) => {
      if (result?.[TRADING_WARM_ELIGIBLE_STORAGE_KEY] !== true) return;
      void loadTradingRuntime(importEntry).catch(() => {});
    })
    .catch(() => {});
}
