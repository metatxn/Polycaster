import {
  resolvePreferredTradingWalletMode,
  SHOW_EOA_OPTION,
  type TradingWalletMode,
} from "@knoww/shared-types/polymarket";

export const TRADING_WALLET_SETUP_REQUIRED_MESSAGE =
  "Create your trading wallet in the side panel before enabling trading.";

export interface TradingWalletSetupState {
  address?: string | null;
  proxyAddress?: string | null;
  walletMode?: string | null;
  isDeployed?: boolean | null;
}

export interface TradingSetupCompletionState extends TradingWalletSetupState {
  hasCredentials?: boolean | null;
}

export function normalizeExtensionTradingWalletMode(
  mode?: string | null
): TradingWalletMode {
  // Delegates to the shared resolver so the EOA gating and the deposit
  // default have exactly one definition; a stored "safe" counts as
  // legacy-safe evidence (it is only ever persisted after a successful
  // on-chain detection).
  return resolvePreferredTradingWalletMode({
    storedMode: mode,
    legacySafeDeployed: mode === "safe",
  });
}

export function isTradingWalletDeploymentRequired(
  state: TradingWalletSetupState
): boolean {
  if (state.walletMode === "eoa" && !SHOW_EOA_OPTION) {
    return Boolean(state.address);
  }
  const mode = normalizeExtensionTradingWalletMode(state.walletMode);
  return Boolean(
    state.address &&
      state.proxyAddress &&
      mode !== "eoa" &&
      state.isDeployed === false
  );
}

export function hasDeployedTradingWallet(
  state: TradingWalletSetupState
): boolean {
  if (state.walletMode === "eoa" && !SHOW_EOA_OPTION) return false;
  const mode = normalizeExtensionTradingWalletMode(state.walletMode);
  if (mode === "eoa") return SHOW_EOA_OPTION && Boolean(state.address);
  return Boolean(
    state.address && state.proxyAddress && state.isDeployed === true
  );
}

export function isTradingSetupComplete(
  state: TradingSetupCompletionState
): boolean {
  return Boolean(state.hasCredentials && hasDeployedTradingWallet(state));
}
