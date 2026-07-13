import type { Market } from "../types/market";

export interface PanelOpenArgs {
  market: Market;
  outcomeName: string;
  outcomeIndex: number;
  price: number;
  anchorElement: HTMLElement;
  isMultiOutcome: boolean;
  marketIndex?: number;
  amountUsd?: number;
  autoSubmit?: boolean;
  view?: "order" | "deposit";
  streamDeposit?: boolean;
}

export interface StreamBetHydrateArgs {
  market: Market;
  ui: {
    setInlineDepositActive(active: boolean): void;
    showToast(message: string): void;
  };
}

export interface StreamBetHandle {
  dispose(): void;
}

export interface WalletConnectRuntimeState {
  status: string;
  error: string | null;
  qrSvg: string | null;
}

export interface TradingRuntime {
  openTradingPanel(args: PanelOpenArgs): void;
  hideTradingPanel(): void;
  hydrateStreamBet(
    host: HTMLElement,
    args: StreamBetHydrateArgs
  ): StreamBetHandle;
  handlePortfolioMessage(
    message: unknown,
    sendResponse: (response: unknown) => void
  ): boolean;
  handleSigningRequest(message: unknown): boolean;
  getWalletConnectStateSync(): WalletConnectRuntimeState;
  cancelWalletConnect(): Promise<void>;
  /** Retained temporarily for the Task 8 legacy handler path. */
  cancelWalletConnectSync(): void;
  dispose(): void;
}
