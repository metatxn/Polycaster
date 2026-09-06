import {
  parseGammaStringArray,
  resolveNegRisk,
} from "@knoww/shared-types/polymarket";
import type { Market } from "../../types/market";
import { resolveSelectedMarketIndex } from "../market-token-resolution";
import type {
  PanelOpenArgs,
  StreamBetHandle,
  StreamBetHydrateArgs,
  WalletConnectRuntimeState,
} from "../trading-runtime-types";
import {
  buildStreamBetting,
  configureStreamTradingPort,
  disposeStreamBetting,
  resetStreamTradingPort,
  type StreamOption,
} from "../ui/stream-bet-ui";
import { WALLETCONNECT_WALLET_UUID, WalletBridge } from "./bridge";
import { ExtensionSession } from "./extension-session";
import { isTradingWalletDeploymentRequired } from "./setup-gates";
import { TradingPanel } from "./trading-panel";
import { TradingService } from "./trading-service";
import { renderWalletConnectQrSvg } from "./walletconnect-qr";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      shortMessage?: unknown;
    };
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.shortMessage === "string"
          ? candidate.shortMessage
          : "";
    const code =
      typeof candidate.code === "string" || typeof candidate.code === "number"
        ? String(candidate.code)
        : "";
    return [message, code].filter(Boolean).join(" ");
  }
  return "";
}

function formatWalletPromptError(error: unknown): string {
  const message = getErrorMessage(error);
  if (
    /user rejected|request rejected|rejected the request|denied|4001/i.test(
      message
    )
  ) {
    return "Wallet prompt rejected.";
  }
  return message || "Wallet request failed.";
}

function openTradingSetupSidePanel(showToast: (message: string) => void): void {
  void window.KNOWW_UTILS.safeSendMessage({
    type: "KNOWW_OPEN_EXTENSION_SIDEPANEL",
    view: "portfolio",
  }).then((response?: { ok?: boolean; error?: string }) => {
    if (response?.ok === true) return;
    showToast(
      response?.error || "Open the Knoww side panel to finish trading setup."
    );
  });
}

async function connectAndAuthorizePortfolioWallet(
  walletUuid?: string
): Promise<string> {
  await TradingService.connectWallet(walletUuid);
  const address = TradingService.getContext().address;
  if (!address) {
    throw new Error("Wallet connection was cancelled.");
  }
  await ExtensionSession.ensureAuthorized(address);
  return address;
}

async function switchAndAuthorizePortfolioWallet(): Promise<string> {
  await TradingService.switchWallet();
  const address = TradingService.getContext().address;
  if (!address) {
    throw new Error("Wallet switch was cancelled.");
  }
  await ExtensionSession.ensureAuthorized(address);
  return address;
}

/**
 * Extract the CLOB token ID for a given outcome index from a market.
 * Returns null if the market is Kalshi or the token ID is unavailable.
 */
function getTokenIdForOutcome(
  market: Market,
  outcomeIndex: number,
  marketIndex = 0
): string | null {
  if (market.source === "kalshi") return null;
  if (!market.markets || market.markets.length === 0) return null;

  const nestedMarket = market.markets[marketIndex] ?? market.markets[0];
  if (!nestedMarket?.clobTokenIds) return null;
  if (
    nestedMarket.active === false ||
    nestedMarket.closed === true ||
    nestedMarket.acceptingOrders === false
  ) {
    return null;
  }

  return parseGammaStringArray(nestedMarket.clobTokenIds)[outcomeIndex] ?? null;
}

/**
 * Extract token ID for a multi-outcome item by its market index.
 */
function getTokenIdForMultiOutcome(
  market: Market,
  marketIndex: number
): string | null {
  if (market.source === "kalshi") return null;
  if (!market.markets) return null;

  const nestedMarket = market.markets[marketIndex];
  if (!nestedMarket?.clobTokenIds) return null;
  if (
    nestedMarket.active === false ||
    nestedMarket.closed === true ||
    nestedMarket.acceptingOrders === false
  ) {
    return null;
  }

  return parseGammaStringArray(nestedMarket.clobTokenIds)[0] ?? null;
}

/**
 * Resolve a token ID — tries locally first, then fetches from the events API.
 * Opens the TradingPanel once resolved, or logs a warning if it can't.
 */
async function resolveTokenAndShowPanel(
  market: Market,
  outcomeName: string,
  outcomeIndex: number,
  price: number,
  anchorElement: HTMLElement,
  isMultiOutcome: boolean,
  marketIndex?: number,
  tradeOpts?: {
    amountUsd?: number;
    autoSubmit?: boolean;
    view?: "order" | "deposit";
    streamDeposit?: boolean;
  }
): Promise<void> {
  const { log } = window.KNOWW_UTILS;
  const panelAnchor =
    anchorElement.closest<HTMLElement>(".knoww-market-card") ?? anchorElement;
  const preferredMarketIndex = marketIndex ?? outcomeIndex;
  const resolvedMarketIndex = isMultiOutcome
    ? resolveSelectedMarketIndex(
        market.markets ?? [],
        outcomeName,
        preferredMarketIndex
      )
    : (marketIndex ?? 0);

  let tokenId = isMultiOutcome
    ? getTokenIdForMultiOutcome(market, resolvedMarketIndex)
    : getTokenIdForOutcome(market, outcomeIndex, resolvedMarketIndex);

  // Search/trending data can retain a syntactically valid token after Gamma
  // has replaced or reordered the event's sub-markets. Refresh Polymarket
  // token identity before opening; keep the local token only as a degraded
  // fallback when the current event cannot be reached.
  if (market.source === "polymarket") {
    anchorElement.style.opacity = "0.6";
    anchorElement.style.pointerEvents = "none";
    try {
      const refreshedTokenId = await window.KNOWW_API.fetchClobTokenIds(
        market,
        outcomeIndex,
        isMultiOutcome,
        resolvedMarketIndex
      );
      if (refreshedTokenId) tokenId = refreshedTokenId;
    } finally {
      anchorElement.style.opacity = "";
      anchorElement.style.pointerEvents = "";
    }
  }

  if (tokenId) {
    const idx = resolvedMarketIndex;
    const nestedMarket = market.markets?.[idx];
    let conditionId: string | undefined;
    let yesTokenId: string | undefined;
    let noTokenId: string | undefined;

    if (nestedMarket) {
      conditionId = nestedMarket.conditionId as string | undefined;
      const ids = parseGammaStringArray(nestedMarket.clobTokenIds);
      if (ids.length >= 2) {
        yesTokenId = ids[0];
        noTokenId = ids[1];
      }
    }

    TradingPanel.show({
      market,
      outcomeName,
      outcomeIndex,
      price,
      side: "BUY",
      tokenId: tokenId as string,
      negRisk: resolveNegRisk(nestedMarket, market),
      isMultiOutcome,
      anchorElement: panelAnchor,
      conditionId,
      yesTokenId,
      noTokenId,
      initialAmountUsd: tradeOpts?.amountUsd,
      autoSubmit: tradeOpts?.autoSubmit,
      initialView: tradeOpts?.view,
      streamDeposit: tradeOpts?.streamDeposit,
    });
    void window.KNOWW_ANALYTICS?.track("trading_panel_opened", {
      marketId: market.id,
      source: market.source || "polymarket",
      outcomeName,
      isMultiOutcome,
    });
    log(`Trading panel opened for ${outcomeName}`);
  } else {
    void window.KNOWW_ANALYTICS?.track("trading_panel_open_failed", {
      reason: "token_unresolved",
      marketId: market.id,
      outcomeName,
    });
    log(
      "Could not resolve tokenId for",
      outcomeName,
      "— cannot open trading panel"
    );
  }
}

// Color palette for multi-option markets — bright variants for dark-theme readability

async function resolveOrderTokens(
  market: Market,
  outcomeIndex: number,
  isMulti: boolean,
  marketIndex: number
): Promise<{ tokenId?: string; conditionId?: string; negRisk: boolean }> {
  let tokenId: string | undefined =
    (isMulti
      ? getTokenIdForMultiOutcome(market, marketIndex)
      : getTokenIdForOutcome(market, outcomeIndex, marketIndex)) ?? undefined;
  if (market.source === "polymarket") {
    const refreshedTokenId = await window.KNOWW_API.fetchClobTokenIds(
      market,
      outcomeIndex,
      isMulti,
      marketIndex
    );
    if (refreshedTokenId) tokenId = refreshedTokenId;
  }
  const nestedMarket = market.markets?.[marketIndex];
  let conditionId: string | undefined;
  const negRisk = resolveNegRisk(nestedMarket, market);
  if (nestedMarket) {
    conditionId = nestedMarket.conditionId as string | undefined;
  }
  return { tokenId, conditionId, negRisk };
}

/** Place a market BUY for the selected stream outcome. Throws on failure. */
async function submitStreamMarketOrder(
  market: Market,
  opt: StreamOption,
  stake: number
): Promise<void> {
  const ctx = TradingService.getContext();
  const tokens = await resolveOrderTokens(
    market,
    opt.outcomeIndex,
    opt.isMulti,
    opt.marketIndex
  );
  if (!tokens.tokenId) throw new Error("Could not resolve market token");
  const shares = Math.max(
    ctx.minOrderSize || 5,
    Math.round(stake / Math.max(opt.price, 0.01))
  );
  await TradingService.placeOrder({
    tokenId: tokens.tokenId,
    conditionId: tokens.conditionId,
    outcomeIndex: opt.outcomeIndex,
    side: "BUY",
    price: 0,
    size: shares,
    amount: stake,
    orderType: "FAK",
    negRisk: tokens.negRisk,
    isMarketableBuy: true,
  });
}

async function submitStreamMarketSell(
  market: Market,
  opt: StreamOption,
  shares: number
): Promise<void> {
  const tokens = await resolveOrderTokens(
    market,
    opt.outcomeIndex,
    opt.isMulti,
    opt.marketIndex
  );
  if (!tokens.tokenId) throw new Error("Could not resolve market token");
  await TradingService.placeOrder({
    tokenId: tokens.tokenId,
    conditionId: tokens.conditionId,
    outcomeIndex: opt.outcomeIndex,
    side: "SELL",
    price: 0,
    size: shares,
    amount: 0,
    orderType: "FAK",
    negRisk: tokens.negRisk,
    isMarketableBuy: false,
  });
}

export function initializeTradingGlue(): void {
  configureStreamTradingPort({
    getContext: () => TradingService.getContext(),
    refreshBalance: () => TradingService.refreshBalance(),
    resolveOrderTokens,
    placeBuy: submitStreamMarketOrder,
    placeSell: ({ market, option, shares }) =>
      submitStreamMarketSell(market, option, shares),
    getOutcomeBalances: (yesTokenId, noTokenId) =>
      TradingService.getOutcomeBalances(yesTokenId, noTokenId),
    mountInlineDeposit: (args) => TradingPanel.mountInlineDeposit(args),
    closeInlineDeposit: (host) => TradingPanel.closeInlineDeposit(host),
    ensureReady: () => TradingService.ensureReady(),
    isDeploymentRequired: () =>
      isTradingWalletDeploymentRequired(TradingService.getContext()),
    isNegRisk: (market, marketIndex) =>
      resolveNegRisk(market.markets?.[marketIndex], market),
    approveUsdc: (negRisk) => TradingService.approveUsdc(negRisk),
    openSetupSidePanel: (showToast) => openTradingSetupSidePanel(showToast),
    onStateChange: (callback) => TradingService.onStateChange(() => callback()),
  });
}

export function openTradingPanel(args: PanelOpenArgs): void {
  void resolveTokenAndShowPanel(
    args.market,
    args.outcomeName,
    args.outcomeIndex,
    args.price,
    args.anchorElement,
    args.isMultiOutcome,
    args.marketIndex,
    {
      amountUsd: args.amountUsd,
      autoSubmit: args.autoSubmit,
      view: args.view,
      streamDeposit: args.streamDeposit,
    }
  );
}

export function hideTradingPanel(): void {
  TradingPanel.hide();
}

export function hydrateStreamBet(
  host: HTMLElement,
  args: StreamBetHydrateArgs
): StreamBetHandle {
  const element = buildStreamBetting(args.market, args.ui);
  host.replaceChildren(element);
  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeStreamBetting(element);
      element.remove();
    },
  };
}

export function getWalletConnectStateSync(): WalletConnectRuntimeState {
  const wcState = WalletBridge.getMobileConnectionState();
  let qrSvg: string | null = null;
  if (wcState.qrUri) {
    try {
      qrSvg = renderWalletConnectQrSvg(wcState.qrUri);
    } catch {
      return {
        status: "error",
        error: "The wallet QR code could not be rendered. Please retry.",
        qrSvg: null,
      };
    }
  }
  return { status: wcState.status, error: wcState.error, qrSvg };
}

export function cancelWalletConnectSync(): void {
  void cancelWalletConnect().catch(() => {});
}

export function cancelWalletConnect(): Promise<void> {
  return WalletBridge.cancelMobileConnect();
}

export function disposeTradingGlue(): void {
  TradingPanel.closeInlineDeposit();
  TradingPanel.hide();
  resetStreamTradingPort();
}

export interface PortfolioUiMessage {
  type?: string;
  address?: string;
  walletUuid?: string;
  approvalAmount?: unknown;
}

export function handlePortfolioMessage(
  message: PortfolioUiMessage,
  sendResponse: (response: { success: boolean; data?: unknown }) => void
): boolean {
  if (message?.type === "KNOWW_GET_PORTFOLIO_WALLETS") {
    const waitForWallets = new Promise<void>((resolve) => {
      const existing = WalletBridge.getDiscoveredWallets();
      if (existing.length > 0) {
        resolve();
        return;
      }
      let unsubscribe = (): void => {};
      const finish = () => {
        unsubscribe();
        resolve();
      };
      const timeoutId = setTimeout(finish, 700);
      unsubscribe = WalletBridge.onWalletsChanged(() => {
        clearTimeout(timeoutId);
        finish();
      });
    });

    void waitForWallets.then(() => {
      sendResponse({
        success: true,
        data: { wallets: WalletBridge.getDiscoveredWallets() },
      });
    });
    return true;
  }

  if (message?.type === "KNOWW_GET_PORTFOLIO_CONNECTED_WALLET") {
    void (async () => {
      const hadCachedAddress = Boolean(TradingService.getContext().address);
      const address = await TradingService.getConnectedWalletAddress();
      sendResponse({
        success: true,
        data: {
          address,
          status: address
            ? "connected"
            : hadCachedAddress
              ? "disconnected"
              : "unavailable",
        },
      });
    })();
    return true;
  }

  if (message?.type === "KNOWW_CONNECT_PORTFOLIO_WALLET") {
    if (message.walletUuid === WALLETCONNECT_WALLET_UUID) {
      sendResponse({ success: true, data: { status: "started" } });
      void (async () => {
        try {
          await connectAndAuthorizePortfolioWallet(message.walletUuid);
        } catch {
          // WalletConnect pairing errors are exposed through the polled
          // bridge state; installed-wallet failures are returned below.
        }
      })();
      return false;
    }

    void (async () => {
      try {
        const address = await connectAndAuthorizePortfolioWallet(
          message.walletUuid
        );
        sendResponse({ success: true, data: { address } });
      } catch (err) {
        sendResponse({
          success: false,
          data: { error: formatWalletPromptError(err) },
        });
      }
    })();
    return true;
  }

  if (message?.type === "KNOWW_SWITCH_PORTFOLIO_WALLET") {
    void (async () => {
      try {
        const address = await switchAndAuthorizePortfolioWallet();
        sendResponse({ success: true, data: { address } });
      } catch (err) {
        sendResponse({
          success: false,
          data: { error: formatWalletPromptError(err) },
        });
      }
    })();
    return true;
  }

  if (message?.type === "KNOWW_PORTFOLIO_REAUTH") {
    void (async () => {
      try {
        let address = TradingService.getContext().address;
        if (!address) {
          await TradingService.connectWallet();
          address = TradingService.getContext().address;
        }
        if (!address) {
          throw new Error("Connect your wallet to continue.");
        }
        // Drop any stale token so ensureAuthorized always re-signs a fresh
        // challenge instead of short-circuiting on a present-but-dead token.
        await ExtensionSession.clear();
        await ExtensionSession.ensureAuthorized(address);
        sendResponse({ success: true, data: { address } });
      } catch (err) {
        sendResponse({
          success: false,
          data: {
            error:
              err instanceof Error ? err.message : "Re-authorization failed",
          },
        });
      }
    })();
    return true;
  }

  if (message?.type === "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT") {
    cancelWalletConnectSync();
    sendResponse({ success: true, data: { status: "cancelled" } });
    return false;
  }

  if (message?.type === "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE") {
    const wcState = getWalletConnectStateSync();
    sendResponse({
      success: true,
      data: wcState,
    });
    return false;
  }

  if (message?.type === "KNOWW_ENABLE_PORTFOLIO_TRADING") {
    const requestedAddress =
      typeof message.address === "string" ? message.address : "";
    sendResponse({
      success: true,
      data: { status: "started" },
    });
    void (async () => {
      if (!requestedAddress) {
        throw new Error("Missing wallet address");
      }

      const currentAddress = TradingService.getContext().address;
      if (
        !currentAddress ||
        currentAddress.toLowerCase() !== requestedAddress.toLowerCase()
      ) {
        await TradingService.connectWallet();
      }

      const connectedAddress = TradingService.getContext().address;
      if (
        !connectedAddress ||
        connectedAddress.toLowerCase() !== requestedAddress.toLowerCase()
      ) {
        throw new Error("Connected wallet does not match portfolio wallet");
      }

      await TradingService.deriveCredentials();
    })().catch(() => {});
    return false;
  }

  if (message?.type === "KNOWW_APPROVE_PORTFOLIO_TRADING") {
    const requestedAddress =
      typeof message.address === "string" ? message.address : "";
    const rawApprovalAmount = (message as { approvalAmount?: unknown })
      .approvalAmount;
    const rawAmount =
      typeof rawApprovalAmount === "string" ? rawApprovalAmount : "";
    void (async () => {
      if (!requestedAddress) {
        throw new Error("Missing wallet address");
      }

      const currentAddress = TradingService.getContext().address;
      if (
        !currentAddress ||
        currentAddress.toLowerCase() !== requestedAddress.toLowerCase()
      ) {
        await TradingService.connectWallet();
      }

      const connectedAddress = TradingService.getContext().address;
      if (
        !connectedAddress ||
        connectedAddress.toLowerCase() !== requestedAddress.toLowerCase()
      ) {
        throw new Error("Connected wallet does not match portfolio wallet");
      }

      const amount = Number(rawAmount);
      await TradingService.approveUsdc(
        false,
        Number.isFinite(amount) && amount > 0 ? amount : undefined
      );
      sendResponse({
        success: true,
        data: { status: "approved" },
      });
    })().catch((err) => {
      sendResponse({
        success: false,
        data: {
          error: err instanceof Error ? err.message : "Approval failed",
        },
      });
    });
    return true;
  }

  return false;
}
