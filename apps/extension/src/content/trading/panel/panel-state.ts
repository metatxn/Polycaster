import type { ExpirationPreset } from "@knoww/shared-types/orders";
import type { Root } from "react-dom/client";
import type { FundingController, FundingState } from "../../../funding";
import type { Market } from "../../../types/market";
import type { OutcomeBalances } from "../../ui/outcome-balances";

export interface PanelOptions {
  market: Market;
  outcomeName: string;
  outcomeIndex: number;
  price: number;
  side: "BUY" | "SELL";
  tokenId: string;
  negRisk?: boolean;
  isMultiOutcome?: boolean;
  anchorElement: HTMLElement;
  conditionId?: string;
  yesTokenId?: string;
  noTokenId?: string;
  /** Pre-fill the order with this USD stake (converted to shares). */
  initialAmountUsd?: number;
  /** Submit once the panel reaches its fully-ready order state. */
  autoSubmit?: boolean;
  /** Open directly in a specific view. */
  initialView?: "order" | "deposit";
  /** The deposit view was opened from a stream card shortfall action. */
  streamDeposit?: boolean;
}

export interface PanelOrderBookRequest {
  panel: HTMLElement;
  options: PanelOptions;
  tokenId: string;
  selectedOutcome: "yes" | "no";
}

export type OrderMode = "market" | "limit";
export type TradeSide = "buy" | "sell";
export type ActiveView = "order" | "split" | "merge" | "deposit";

interface PanelState {
  activePanel: HTMLElement | null;
  panelOpts: PanelOptions | null;
  inlineDepositHost: HTMLElement | null;
  inlineDepositUnsub: (() => void) | null;
  inlineDepositOnClose: (() => void) | null;
  activeUnsubscribe: (() => void) | null;
  mobileQrRoot: Root | null;
  activeSide: TradeSide;
  activeView: ActiveView;
  orderMode: OrderMode;
  selectedShares: number;
  marketBuyAmount: number;
  limitPrice: number;
  expirationPreset: ExpirationPreset;
  splitMergeAmount: string;
  outcomeBalances: OutcomeBalances | null;
  outcomeBalancesLoaded: boolean;
  outcomeBalancesFetching: boolean;
  moreMenuOpen: boolean;
  orderSettling: boolean;
  settleTimer: ReturnType<typeof setTimeout> | null;
  orderApprovalPreview: {
    key: string;
    requiredCollateral: number;
    requiredCollateralRaw: string;
  } | null;
  orderApprovalPreviewInFlightKey: string | null;
  orderApprovalPreviewTimer: ReturnType<typeof setTimeout> | null;
  cardSetupStorageAddress: string | null;
  cardSetupDismissed: boolean;
  cardSetupComplete: boolean;
  cardSetupStorageToken: number;
  depositController: FundingController | null;
  depositControllerUnsub: (() => void) | null;
  depositPrevStep: FundingState["step"] | null;
  depositDoneReturnTimer: ReturnType<typeof setTimeout> | null;
  depositInitiatedTxHashes: Set<string>;
  selectedOutcome: "yes" | "no";
  yesPrice: number;
  noPriceValue: number;
  sessionRestoreAttempted: boolean;
  lastRenderedErrorToast: string | null;
  dismissedErrorToast: string | null;
  livePanelRefreshTimer: ReturnType<typeof setTimeout> | null;
  livePanelRefreshEnabled: boolean;
  disconnectedUnsub: (() => void) | null;
  walletResolveLoadingSince: number | null;
  walletResolveTimeoutTimer: ReturnType<typeof setTimeout> | null;
  cachedPrices: Record<string, number> | null;
  pricesFetchedAt: number;
  overflowOverrides: Array<{ el: HTMLElement; prev: string }>;
}

/**
 * Stable mutable state container for the single trading-panel runtime.
 * Consumers intentionally access fields through this object so resets remain
 * explicit and references held by extracted views stay live.
 */
export const panelState: PanelState = {
  activePanel: null,
  panelOpts: null,
  inlineDepositHost: null,
  inlineDepositUnsub: null,
  inlineDepositOnClose: null,
  activeUnsubscribe: null,
  mobileQrRoot: null,
  activeSide: "buy",
  activeView: "order",
  orderMode: "market",
  selectedShares: 10,
  marketBuyAmount: 0,
  limitPrice: 0,
  expirationPreset: "GTC",
  splitMergeAmount: "",
  outcomeBalances: null,
  outcomeBalancesLoaded: false,
  outcomeBalancesFetching: false,
  moreMenuOpen: false,
  orderSettling: false,
  settleTimer: null,
  orderApprovalPreview: null,
  orderApprovalPreviewInFlightKey: null,
  orderApprovalPreviewTimer: null,
  cardSetupStorageAddress: null,
  cardSetupDismissed: false,
  cardSetupComplete: false,
  cardSetupStorageToken: 0,
  depositController: null,
  depositControllerUnsub: null,
  depositPrevStep: null,
  depositDoneReturnTimer: null,
  depositInitiatedTxHashes: new Set<string>(),
  selectedOutcome: "yes",
  yesPrice: 0,
  noPriceValue: 0,
  sessionRestoreAttempted: false,
  lastRenderedErrorToast: null,
  dismissedErrorToast: null,
  livePanelRefreshTimer: null,
  livePanelRefreshEnabled: false,
  disconnectedUnsub: null,
  walletResolveLoadingSince: null,
  walletResolveTimeoutTimer: null,
  cachedPrices: null,
  pricesFetchedAt: 0,
  overflowOverrides: [],
};

export function capturePanelOrderBookRequest(): PanelOrderBookRequest | null {
  const panel = panelState.activePanel;
  const options = panelState.panelOpts;
  if (!panel || !options?.tokenId) return null;

  return {
    panel,
    options,
    tokenId: options.tokenId,
    selectedOutcome: panelState.selectedOutcome,
  };
}

export function isPanelOrderBookRequestCurrent(
  request: PanelOrderBookRequest
): boolean {
  return (
    panelState.activePanel === request.panel &&
    panelState.panelOpts === request.options &&
    panelState.panelOpts.tokenId === request.tokenId &&
    panelState.selectedOutcome === request.selectedOutcome
  );
}
