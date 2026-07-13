import type {
  PanelOpenArgs,
  StreamBetHandle,
  StreamBetHydrateArgs,
  TradingRuntime,
} from "../trading-runtime-types";
import {
  delegateSigningRequest,
  installSigningLifecycle,
  WalletBridge,
} from "./bridge";
import {
  cancelWalletConnect,
  cancelWalletConnectSync,
  disposeTradingGlue,
  getWalletConnectStateSync,
  handlePortfolioMessage,
  hideTradingPanel,
  hydrateStreamBet,
  initializeTradingGlue,
  openTradingPanel,
  type PortfolioUiMessage,
} from "./trading-glue";
import { installTradingServiceListeners } from "./trading-service";

export type { TradingRuntime } from "../trading-runtime-types";

let activeRuntime: TradingRuntime | null = null;

export function createTradingRuntime(): TradingRuntime {
  if (activeRuntime) return activeRuntime;

  const disposeBridge = WalletBridge.init();
  const disposeServiceListeners = installTradingServiceListeners();
  const disposeSigningLifecycle = installSigningLifecycle();
  initializeTradingGlue();
  const streamHandles = new Set<StreamBetHandle>();
  let disposed = false;

  const runtime: TradingRuntime = {
    openTradingPanel(args: PanelOpenArgs): void {
      openTradingPanel(args);
    },

    hideTradingPanel(): void {
      hideTradingPanel();
    },

    hydrateStreamBet(
      host: HTMLElement,
      args: StreamBetHydrateArgs
    ): StreamBetHandle {
      const underlying = hydrateStreamBet(host, args);
      let handleDisposed = false;
      const handle: StreamBetHandle = {
        dispose(): void {
          if (handleDisposed) return;
          handleDisposed = true;
          streamHandles.delete(handle);
          underlying.dispose();
        },
      };
      streamHandles.add(handle);
      return handle;
    },

    handlePortfolioMessage(message, sendResponse): boolean {
      return handlePortfolioMessage(
        message as PortfolioUiMessage,
        sendResponse as (response: { success: boolean; data?: unknown }) => void
      );
    },

    handleSigningRequest(message): boolean {
      return delegateSigningRequest(message);
    },

    getWalletConnectStateSync,
    cancelWalletConnect,
    cancelWalletConnectSync,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const handle of [...streamHandles]) handle.dispose();
      disposeTradingGlue();
      disposeSigningLifecycle();
      disposeServiceListeners();
      disposeBridge();
      if (activeRuntime === runtime) activeRuntime = null;
    },
  };

  activeRuntime = runtime;
  return runtime;
}
