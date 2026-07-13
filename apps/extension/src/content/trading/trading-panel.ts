/**
 * TradingPanel — renders an inline trading UI below the market card,
 * styled to match the knoww.app web trading form.
 *
 * Layout (order view):
 *   Header → Wallet bar → [Market/Limit toggle + "..." menu] →
 *   [Buy/Sell toggle] → Price (limit) / Slippage (market) →
 *   Shares input → Order summary → Submit
 *
 * Split/Merge accessible via "..." dropdown menu.
 */

import { escapeHtml } from "../html-escape";
import { getNonce, WALLETCONNECT_WALLET_UUID, WalletBridge } from "./bridge";
import { CredentialManager } from "./credentials";
import { mapTradingError } from "./error-mapping";
import {
  closeInlineDeposit,
  configureDepositView,
  disposeDepositController,
  mountInlineDeposit,
  renderDepositForm,
  renderInlineDeposit,
  startDepositFlow,
  syncDepositControllerAccount,
} from "./panel/deposit-view";
import {
  formatCollateralBreakdown,
  formatTokenAmount,
  normalizeUsdChipAmount,
  truncAddr,
} from "./panel/format";
import {
  configureOrderView,
  getAvailableTradingCollateral,
  getDisplayPriceFromOrderBook,
  normalizePrice,
  renderOrderForm,
} from "./panel/order-view";
import {
  capturePanelOrderBookRequest,
  isPanelOrderBookRequestCurrent,
  type PanelOptions,
  panelState,
} from "./panel/panel-state";
import {
  addPortfolioBar,
  type PositionsViewUiPort,
  refreshSplitMergeState,
  renderMergeForm,
  renderSplitForm,
} from "./panel/positions-view";
import {
  addSetupBanner,
  addSetupFlow,
  type SetupViewUiPort,
} from "./panel/setup-view";
import {
  cardSetupFlow,
  isSetupApprovalReadKnown,
  resolveSetupSurfaceMode,
} from "./setup-flow";
import { readSetupComplete, readSetupDismissed } from "./setup-flow-storage";
import { type TradingContext, TradingService } from "./trading-service";

declare const require: (request: string) => unknown;

// Debounce window for the preflight call. The user typing in the shares input
// would otherwise fire one round-trip per keystroke; the preview state stays
// "Checking allowance..." during the debounce so the gate is never wrong.
const LIVE_PANEL_REFRESH_INTERVAL = 10000;

function trackPanelAnalytics(
  event: string,
  properties: Record<string, string | number | boolean | null | undefined> = {}
): void {
  void window.KNOWW_ANALYTICS?.track(event, {
    feature: "trading_panel",
    ...properties,
  });
}

function clearLivePanelRefreshTimer(): void {
  if (panelState.livePanelRefreshTimer) {
    clearTimeout(panelState.livePanelRefreshTimer);
    panelState.livePanelRefreshTimer = null;
  }
}

function pauseLivePanelRefresh(): void {
  panelState.livePanelRefreshEnabled = false;
  clearLivePanelRefreshTimer();
}

function resumeLivePanelRefresh(): void {
  if (!panelState.activePanel?.isConnected || !panelState.panelOpts) return;
  panelState.livePanelRefreshEnabled = true;
  scheduleLivePanelRefresh();
}

function canRefreshLivePanel(): boolean {
  return Boolean(
    panelState.livePanelRefreshEnabled &&
      panelState.activePanel?.isConnected &&
      panelState.panelOpts
  );
}

// ── SVG Icons ──

const I = {
  up: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
  down: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
  zap: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>`,
  more: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,
  split: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>`,
  merge: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/></svg>`,
  close: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  disconnect: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  switchWallet: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>`,
  alert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  wallet: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 7h-1V6a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-8a3 3 0 0 0-3-3ZM5 5h10a1 1 0 0 1 1 1v1H5a1 1 0 0 1 0-2Zm15 11h-2a2 2 0 0 1 0-4h2Z"/></svg>`,
  shield: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3Zm-1 14.5v-2h2v2h-2Zm0-4v-6h2v6h-2Z"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`,
  error: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
  back: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  refresh: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
};

// ── DOM Helpers ──

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const DANGEROUS_CSS_PATTERN =
  /expression\s*\(|url\s*\(\s*(["']?)\s*javascript:|(-moz-binding|-webkit-binding)\s*:|behavior\s*:/i;

function sanitizeCssValue(value: string): string {
  return DANGEROUS_CSS_PATTERN.test(value) ? "" : value;
}

function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const nodes = Array.from(doc.querySelectorAll("*"));

  const forbiddenTags = new Set([
    "script",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
    "base",
    "form",
    "frame",
    "frameset",
    "style",
    "math",
    "noscript",
    "template",
  ]);

  for (const node of nodes) {
    const tagName = node.tagName.toLowerCase();
    if (forbiddenTags.has(tagName)) {
      node.remove();
      continue;
    }

    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value ?? "";
      if (
        /^on/i.test(name) ||
        name === "srcdoc" ||
        ((name === "src" || name === "href" || name === "xlink:href") &&
          /^\s*(javascript|data):/i.test(value))
      ) {
        node.removeAttribute(attr.name);
      } else if (name === "style") {
        const sanitized = sanitizeCssValue(value);
        if (sanitized) {
          node.setAttribute("style", sanitized);
        } else {
          node.removeAttribute("style");
        }
      }
    }
  }

  return doc.body.innerHTML;
}

function elHtml<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  html: string
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  const sanitized = sanitizeHtml(html).trim();
  if (sanitized) {
    n.innerHTML = sanitized;
  }
  return n;
}

function setButtonLoading(btn: HTMLElement, text: string): void {
  btn.innerHTML = `<span class="knoww-tp-spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:6px"></span> ${text}`;
  btn.style.pointerEvents = "none";
  btn.style.opacity = "0.7";
}

function rerender(): void {
  // Inline (stream) deposit re-renders only the deposit form into its host.
  if (panelState.inlineDepositHost) {
    renderInlineDeposit();
    return;
  }
  if (panelState.activePanel && panelState.panelOpts)
    render(
      panelState.activePanel,
      panelState.panelOpts,
      TradingService.getContext()
    );
}

const positionsViewUi: PositionsViewUiPort = {
  el,
  elHtml,
  rerender,
  trackAnalytics: trackPanelAnalytics,
  showToast,
  icons: { back: I.back, alert: I.alert },
};

function syncCardSetupStorage(address: string | null): void {
  if (!address) {
    panelState.cardSetupStorageAddress = null;
    panelState.cardSetupDismissed = false;
    panelState.cardSetupComplete = false;
    panelState.cardSetupStorageToken++;
    return;
  }

  if (panelState.cardSetupStorageAddress === address) return;

  panelState.cardSetupStorageAddress = address;
  panelState.cardSetupDismissed = false;
  panelState.cardSetupComplete = false;
  const token = ++panelState.cardSetupStorageToken;

  // The token is the whole staleness guard: it bumps on every mutation of
  // panelState.cardSetupStorageAddress (including A→null→A resyncs, which an address
  // comparison alone would wrongly pass).
  void Promise.all([readSetupDismissed(address), readSetupComplete(address)])
    .then(([dismissed, complete]) => {
      if (token !== panelState.cardSetupStorageToken) return;
      panelState.cardSetupDismissed = dismissed;
      panelState.cardSetupComplete = complete;
      rerender();
    })
    .catch(() => {
      if (token !== panelState.cardSetupStorageToken) return;
      panelState.cardSetupDismissed = false;
      panelState.cardSetupComplete = false;
    });
}

function unmountMobileQrRoot(): void {
  if (panelState.mobileQrRoot) {
    panelState.mobileQrRoot.unmount();
    panelState.mobileQrRoot = null;
  }
}

function mountMobileQrCode(container: HTMLElement, uri: string): void {
  unmountMobileQrRoot();
  const React = require("react") as typeof import("react");
  const { createRoot } =
    require("react-dom/client") as typeof import("react-dom/client");
  const { default: QRCode } =
    require("react-qr-code") as typeof import("react-qr-code");
  panelState.mobileQrRoot = createRoot(container);
  panelState.mobileQrRoot.render(
    React.createElement(QRCode, {
      value: uri,
      size: 196,
      bgColor: "#ffffff",
      fgColor: "#050505",
      level: "Q",
      title: "WalletConnect QR code",
    })
  );
}

function syncSelectedOutcomePrice(): void {
  if (!panelState.panelOpts) return;
  if (panelState.panelOpts.yesTokenId && panelState.panelOpts.noTokenId) {
    panelState.panelOpts.price =
      panelState.selectedOutcome === "yes"
        ? panelState.yesPrice
        : panelState.noPriceValue;
    return;
  }
  panelState.panelOpts.price = panelState.yesPrice;
}

async function refreshLivePanelData(): Promise<void> {
  if (!canRefreshLivePanel() || !panelState.panelOpts) return;

  const request = capturePanelOrderBookRequest();
  if (!request) return;
  const currentTokenId = request.tokenId;

  const isBinary = Boolean(
    panelState.panelOpts.yesTokenId && panelState.panelOpts.noTokenId
  );
  const siblingTokenId = isBinary
    ? panelState.selectedOutcome === "yes"
      ? panelState.panelOpts.noTokenId
      : panelState.panelOpts.yesTokenId
    : undefined;

  const [currentBook, siblingBook] = await Promise.all([
    TradingService.refreshBalance().then(() => null),
    TradingService.fetchOrderBook(currentTokenId),
    siblingTokenId
      ? TradingService.fetchOrderBook(siblingTokenId, { syncContext: false })
      : Promise.resolve(null),
  ]).then(([, current, sibling]) => [current, sibling] as const);

  // A hidden/replaced panel or an outcome switch invalidates every result
  // captured above. Never project an earlier token's book into the new form.
  if (!isPanelOrderBookRequestCurrent(request)) return;

  if (isBinary) {
    if (panelState.selectedOutcome === "yes") {
      panelState.yesPrice = getDisplayPriceFromOrderBook(
        currentBook,
        panelState.yesPrice
      );
      panelState.noPriceValue = getDisplayPriceFromOrderBook(
        siblingBook,
        panelState.noPriceValue || 1 - panelState.yesPrice
      );
    } else {
      panelState.noPriceValue = getDisplayPriceFromOrderBook(
        currentBook,
        panelState.noPriceValue
      );
      panelState.yesPrice = getDisplayPriceFromOrderBook(
        siblingBook,
        panelState.yesPrice || 1 - panelState.noPriceValue
      );
    }
  } else if (currentBook) {
    panelState.yesPrice = getDisplayPriceFromOrderBook(
      currentBook,
      panelState.yesPrice || panelState.panelOpts.price
    );
  }

  syncSelectedOutcomePrice();
  rerender();
}

function scheduleLivePanelRefresh(): void {
  clearLivePanelRefreshTimer();
  if (!canRefreshLivePanel()) return;

  const run = async () => {
    if (!canRefreshLivePanel()) {
      clearLivePanelRefreshTimer();
      return;
    }
    try {
      await refreshLivePanelData();
    } catch {
      /* ignore live refresh errors */
    } finally {
      if (canRefreshLivePanel()) {
        panelState.livePanelRefreshTimer = setTimeout(
          run,
          LIVE_PANEL_REFRESH_INTERVAL
        );
      }
    }
  };

  panelState.livePanelRefreshTimer = setTimeout(
    run,
    LIVE_PANEL_REFRESH_INTERVAL
  );
}

function createPanel(opts: PanelOptions): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "knoww-trading-panel";
  panel.setAttribute("data-knoww-trading", "true");
  panel.addEventListener("click", (e) => e.stopPropagation());

  panelState.panelOpts = opts;
  panelState.activeSide = opts.side === "SELL" ? "sell" : "buy";
  panelState.activeView = "order";
  panelState.orderMode = "market";
  // Keep limit orders share-based, but prefill market buys with the USD stake
  // when provided (one-click stream trades).
  panelState.marketBuyAmount =
    opts.initialAmountUsd && opts.initialAmountUsd > 0
      ? normalizeUsdChipAmount(opts.initialAmountUsd)
      : 0;
  panelState.selectedShares =
    opts.initialAmountUsd && opts.price > 0
      ? Math.max(1, Math.round(opts.initialAmountUsd / opts.price))
      : 10;
  panelState.limitPrice = normalizePrice(opts.price);
  panelState.expirationPreset = "GTC";
  panelState.splitMergeAmount = "";
  panelState.outcomeBalances = null;
  panelState.outcomeBalancesLoaded = false;
  panelState.outcomeBalancesFetching = false;
  panelState.moreMenuOpen = false;
  panelState.orderApprovalPreview = null;
  panelState.orderApprovalPreviewInFlightKey = null;
  if (panelState.orderApprovalPreviewTimer) {
    clearTimeout(panelState.orderApprovalPreviewTimer);
    panelState.orderApprovalPreviewTimer = null;
  }

  if (opts.isMultiOutcome) {
    panelState.selectedOutcome = "yes";
    panelState.yesPrice = opts.price;
    panelState.noPriceValue = 1 - opts.price;
    opts.outcomeIndex = 0;
  } else {
    panelState.selectedOutcome = opts.outcomeIndex === 1 ? "no" : "yes";
    panelState.yesPrice = opts.outcomeIndex === 0 ? opts.price : 1 - opts.price;
    panelState.noPriceValue =
      opts.outcomeIndex === 1 ? opts.price : 1 - opts.price;
  }

  panelState.lastRenderedErrorToast = null;

  const currentCtx = TradingService.getContext();
  if (
    currentCtx.address &&
    !currentCtx.hasCredentials &&
    (currentCtx.state === "error" ||
      currentCtx.state === "deriving-credentials")
  ) {
    TradingService.resetToConnected();
  }

  render(panel, opts, TradingService.getContext());

  const stateUnsub = TradingService.onStateChange((ctx) => {
    if (
      opts.yesTokenId &&
      opts.noTokenId &&
      ctx.proxyAddress &&
      !panelState.outcomeBalancesLoaded &&
      !panelState.outcomeBalancesFetching
    ) {
      refreshSplitMergeState(opts, positionsViewUi, {
        refreshWallet: false,
        refreshOutcomeBalances: true,
      });
    }
    syncDepositControllerAccount(ctx);
    render(panel, opts, ctx);
  });
  const mobileUnsub = WalletBridge.onMobileConnectionChange(() => rerender());
  panelState.activeUnsubscribe = () => {
    stateUnsub();
    mobileUnsub();
    unmountMobileQrRoot();
  };

  WalletBridge.init();

  // Pre-warm offscreen document so it's ready when the user places a trade
  chrome.runtime
    .sendMessage({ type: "trading:prewarm-offscreen" })
    .catch(() => {});

  if (
    !TradingService.getContext().address &&
    !panelState.sessionRestoreAttempted
  ) {
    panelState.sessionRestoreAttempted = true;
    TradingService.hasActiveSession()
      .then((hasSession) => {
        if (!hasSession) {
          return [];
        }
        return WalletBridge.getAccounts();
      })
      .then((accounts) => {
        if (accounts.length > 0) TradingService.connectWallet();
      })
      .catch(() => {});
  } else if (TradingService.getContext().proxyAddress) {
    TradingService.refreshBalance();
  }

  if (opts.tokenId) {
    TradingService.fetchOrderBook(opts.tokenId);
  }

  if (
    opts.yesTokenId &&
    opts.noTokenId &&
    TradingService.getContext().proxyAddress
  ) {
    refreshSplitMergeState(opts, positionsViewUi, {
      refreshWallet: false,
      refreshOutcomeBalances: true,
    });
  } else if (!opts.yesTokenId || !opts.noTokenId) {
    panelState.outcomeBalancesLoaded = true;
  }

  const closeMenu = () => {
    if (panelState.moreMenuOpen) {
      panelState.moreMenuOpen = false;
      rerender();
    }
  };
  document.addEventListener("click", closeMenu);
  const origUnsub = panelState.activeUnsubscribe;
  panelState.activeUnsubscribe = () => {
    origUnsub();
    document.removeEventListener("click", closeMenu);
  };

  return panel;
}

// ── Section Renderers ──

function addHeader(
  p: HTMLElement,
  opts: PanelOptions,
  ctx?: TradingContext,
  address?: string | null
): void {
  const h = el("div", "knoww-tp-header");
  h.appendChild(el("span", "knoww-tp-title", opts.outcomeName));

  const right = el("div", "knoww-tp-header-right");

  if (address && ctx && ctx.state !== "disconnected") {
    const walletPill = el("div", "knoww-tp-header-wallet");

    const dot = el("span", "knoww-tp-header-dot");
    walletPill.appendChild(dot);

    const addr = el("span", "knoww-tp-header-addr", truncAddr(address));
    walletPill.appendChild(addr);

    const availableCollateral = getAvailableTradingCollateral(ctx);
    const balText = `$${formatTokenAmount(availableCollateral)}`;
    const bal = el(
      "span",
      `knoww-tp-header-bal${availableCollateral < 1 ? " low" : ""}`,
      balText
    );
    bal.title = `Available collateral: ${formatCollateralBreakdown(ctx)}`;
    walletPill.appendChild(bal);

    right.appendChild(walletPill);

    const depositBtn = el("button", "knoww-tp-header-deposit", "Deposit");
    depositBtn.onclick = (e) => {
      e.stopPropagation();
      trackPanelAnalytics("trading_panel_deposit_clicked", {
        marketId: panelState.panelOpts?.market.id,
      });
      panelState.activeView = "deposit";
      startDepositFlow(address);
    };
    right.appendChild(depositBtn);

    const refreshBtn = elHtml("button", "knoww-tp-header-action", I.refresh);
    refreshBtn.title = "Refresh balance";
    refreshBtn.onclick = (e) => {
      e.stopPropagation();
      trackPanelAnalytics("trading_panel_balance_refreshed", {
        marketId: panelState.panelOpts?.market.id,
      });
      refreshBtn.classList.add("spinning");
      TradingService.refreshBalance()
        .then(() => {
          if (
            panelState.panelOpts?.yesTokenId &&
            panelState.panelOpts?.noTokenId
          ) {
            return TradingService.getOutcomeBalances(
              panelState.panelOpts.yesTokenId,
              panelState.panelOpts.noTokenId
            ).then((b) => {
              panelState.outcomeBalances = b;
              panelState.outcomeBalancesLoaded = true;
            });
          }
        })
        .catch(() => {})
        .finally(() => {
          refreshBtn.classList.remove("spinning");
          rerender();
        });
    };
    right.appendChild(refreshBtn);

    const switchBtn = elHtml(
      "button",
      "knoww-tp-header-action",
      I.switchWallet
    );
    switchBtn.title = "Switch wallet";
    switchBtn.onclick = (e) => {
      e.stopPropagation();
      trackPanelAnalytics("wallet_switch_clicked");
      switchBtn.innerHTML = `<span class="knoww-tp-spinner" style="width:14px;height:14px;display:inline-block"></span>`;
      switchBtn.style.pointerEvents = "none";
      switchBtn.style.opacity = "0.7";
      switchBtn.title = "Switching wallet…";
      void TradingService.switchWallet()
        .catch(() => {})
        .finally(() => {
          rerender();
        });
    };
    right.appendChild(switchBtn);

    const dcBtn = elHtml("button", "knoww-tp-header-action", I.disconnect);
    dcBtn.title = "Disconnect wallet";
    dcBtn.onclick = (e) => {
      e.stopPropagation();
      trackPanelAnalytics("wallet_disconnected");
      // Icon-only button in the header — swap the icon for a same-sized spinner
      // instead of injecting "Disconnecting…" text, which would stretch the
      // button and wreck the header layout.
      dcBtn.innerHTML = `<span class="knoww-tp-spinner" style="width:14px;height:14px;display:inline-block"></span>`;
      dcBtn.style.pointerEvents = "none";
      dcBtn.style.opacity = "0.7";
      dcBtn.title = "Disconnecting…";
      void TradingService.disconnect().catch(() => {
        TradingService.reset();
        CredentialManager.clear(address).catch(() => {});
      });
    };
    right.appendChild(dcBtn);
  }

  const closeBtn = elHtml("button", "knoww-tp-close", I.close);
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    trackPanelAnalytics("trading_panel_closed", {
      marketId: panelState.panelOpts?.market.id,
    });
    TradingPanel.hide();
  };
  right.appendChild(closeBtn);

  h.appendChild(right);
  p.appendChild(h);
}

function connectMobileWallet(btn?: HTMLElement): void {
  if (btn) setButtonLoading(btn, "Preparing QR…");
  trackPanelAnalytics("wallet_connect_clicked", {
    walletProvider: "walletconnect_mobile",
  });
  void TradingService.connectWallet(WALLETCONNECT_WALLET_UUID);
}

function addMobileWalletPairing(p: HTMLElement): void {
  const mobileState = WalletBridge.getMobileConnectionState();
  const s = el("div", "knoww-tp-connect-section");
  s.appendChild(elHtml("div", "knoww-tp-wallet-icon", I.wallet));
  s.appendChild(
    el(
      "div",
      "knoww-tp-connect-msg",
      mobileState.qrUri
        ? "Scan with MetaMask Mobile or any WalletConnect wallet"
        : "Preparing mobile wallet connection…"
    )
  );

  if (mobileState.qrUri) {
    const qrWrap = el("div", "knoww-tp-mobile-qr");
    const qr = el("div", "knoww-tp-mobile-qr-code");
    mountMobileQrCode(qr, mobileState.qrUri);
    qrWrap.appendChild(qr);
    qrWrap.appendChild(
      el(
        "div",
        "knoww-tp-mobile-qr-caption",
        "Open your mobile wallet, scan this QR, then approve the connection."
      )
    );
    s.appendChild(qrWrap);
  } else {
    s.appendChild(el("div", "knoww-tp-spinner"));
  }

  if (mobileState.error) {
    s.appendChild(buildInlineErrorParts("Couldn't connect", mobileState.error));
  }

  p.appendChild(s);
}

function addMobileWalletButton(p: HTMLElement): void {
  const btn = elHtml(
    "button",
    "knoww-tp-btn-connect secondary",
    `${I.wallet} Mobile Wallet`
  );
  btn.onclick = (e) => {
    e.stopPropagation();
    connectMobileWallet(btn);
  };
  p.appendChild(btn);
}

function addDisconnected(p: HTMLElement): void {
  if (panelState.disconnectedUnsub) {
    panelState.disconnectedUnsub();
    panelState.disconnectedUnsub = null;
  }

  const existing = p.querySelector(".knoww-tp-connect-section");
  if (existing) existing.remove();

  const mobileState = WalletBridge.getMobileConnectionState();
  if (
    mobileState.status === "initializing" ||
    mobileState.status === "pairing"
  ) {
    addMobileWalletPairing(p);
    return;
  }

  const s = el("div", "knoww-tp-connect-section");
  s.appendChild(elHtml("div", "knoww-tp-wallet-icon", I.wallet));
  s.appendChild(
    el("div", "knoww-tp-connect-msg", "Connect your wallet to start trading")
  );

  const discovered = WalletBridge.getDiscoveredWallets();

  if (discovered.length > 1) {
    const list = el("div", "knoww-tp-wallet-list");
    for (const w of discovered) {
      const item = document.createElement("button");
      item.className = "knoww-tp-wallet-item";
      item.innerHTML = `<img src="${escapeHtml(w.icon)}" alt="" class="knoww-tp-wallet-item-icon" /><span>${escapeHtml(w.name)}</span>`;
      item.onclick = (e) => {
        e.stopPropagation();
        item.style.opacity = "0.6";
        item.style.pointerEvents = "none";
        trackPanelAnalytics("wallet_connect_clicked", {
          walletProvider: w.rdns || w.name,
        });
        TradingService.connectWallet(w.uuid);
      };
      list.appendChild(item);
    }
    s.appendChild(list);
    s.appendChild(el("div", "knoww-tp-connect-divider", "or"));
    addMobileWalletButton(s);
  } else {
    const btn = elHtml(
      "button",
      "knoww-tp-btn-connect",
      `${I.wallet} Connect Wallet`
    );
    btn.onclick = (e) => {
      e.stopPropagation();
      setButtonLoading(btn, "Connecting…");
      trackPanelAnalytics("wallet_connect_clicked", {
        walletProvider: "auto_select",
      });

      window.postMessage(
        { type: "KNOWW_LIST_WALLETS", _n: getNonce() },
        window.location.origin
      );

      let settled = false;
      const unsub = WalletBridge.onWalletsChanged((newWallets) => {
        if (settled) return;
        settled = true;
        unsub();
        clearTimeout(fallback);
        TradingService.connectWallet(
          newWallets.length >= 1 ? newWallets[0].uuid : undefined
        );
      });

      const fallback = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsub();
        const fresh = WalletBridge.getDiscoveredWallets();
        TradingService.connectWallet(
          fresh.length >= 1 ? fresh[0].uuid : undefined
        );
      }, 2000);
    };
    s.appendChild(btn);
    s.appendChild(el("div", "knoww-tp-connect-divider", "or"));
    addMobileWalletButton(s);
  }

  if (mobileState.error) {
    s.appendChild(buildInlineErrorParts("Couldn't connect", mobileState.error));
  }

  panelState.disconnectedUnsub = WalletBridge.onWalletsChanged((newWallets) => {
    if (newWallets.length > 0 && s.isConnected) {
      addDisconnected(p);
    }
  });

  p.appendChild(s);
}

function addLoading(p: HTMLElement, text: string): void {
  const s = el("div", "knoww-tp-loading-section");
  s.appendChild(el("div", "knoww-tp-spinner"));
  s.appendChild(el("div", "knoww-tp-loading-text", text));
  p.appendChild(s);
}

// Bounds the "Loading trading wallet…" spinner (isDeployed still unknown):
// under a sustained RPC outage the resolve never settles, and without a
// deadline a returning credentialed user is stuck on the spinner forever.
const WALLET_RESOLVE_SPINNER_TIMEOUT_MS = 15_000;
function resetWalletResolveSpinnerTimeout(): void {
  panelState.walletResolveLoadingSince = null;
  if (panelState.walletResolveTimeoutTimer !== null) {
    clearTimeout(panelState.walletResolveTimeoutTimer);
    panelState.walletResolveTimeoutTimer = null;
  }
}

function addWalletResolveTimeoutError(p: HTMLElement): void {
  const s = el("div", "knoww-tp-loading-section");
  s.appendChild(
    buildInlineErrorParts(
      "Couldn't load your trading wallet",
      "The network isn't responding. Check your connection and retry."
    )
  );
  const btn = el("button", "knoww-tp-btn-enable", "Retry");
  btn.onclick = (e) => {
    e.stopPropagation();
    resetWalletResolveSpinnerTimeout();
    void TradingService.refreshBalance();
    rerender();
  };
  s.appendChild(btn);
  p.appendChild(s);
}

// Structured inline error card: alert icon + bold title + muted body. Keeping
// the title in alarm-red and the explanatory body in neutral text avoids the
// flat wall-of-red block and mirrors the rich error toast's hierarchy.
function buildInlineErrorParts(
  title: string,
  body?: string | null
): HTMLElement {
  const box = el("div", "knoww-tp-enable-error");
  box.appendChild(elHtml("span", "knoww-tp-enable-error-icon", I.alert));
  const bodyEl = el("div", "knoww-tp-enable-error-body");
  bodyEl.appendChild(el("div", "knoww-tp-enable-error-title", title));
  if (body) {
    bodyEl.appendChild(el("div", "knoww-tp-enable-error-msg", body));
  }
  box.appendChild(bodyEl);
  return box;
}

// Map a raw trading/relayer error into the structured card via the shared
// title/body splitter (same source the rich toast uses).
function buildInlineError(rawMessage: string | null | undefined): HTMLElement {
  const mapped = mapTradingError(rawMessage ?? "");
  return buildInlineErrorParts(mapped.title, mapped.body);
}

const setupViewUi: SetupViewUiPort = {
  el,
  buildInlineError,
  setButtonLoading,
  rerender,
};

configureDepositView({
  el,
  elHtml,
  rerender,
  trackAnalytics: trackPanelAnalytics,
  buildInlineError,
  setButtonLoading,
  setupViewUi,
  icons: {
    refresh: I.refresh,
    alert: I.alert,
    wallet: I.wallet,
    check: I.check,
    back: I.back,
    shield: I.shield,
  },
});

configureOrderView({
  el,
  elHtml,
  rerender,
  trackAnalytics: trackPanelAnalytics,
  showToast,
  pauseLivePanelRefresh,
  resumeLivePanelRefresh,
  scheduleLivePanelRefresh,
  startDepositFlow,
  positionsViewUi,
  icons: {
    zap: I.zap,
    more: I.more,
    split: I.split,
    merge: I.merge,
    up: I.up,
    down: I.down,
    alert: I.alert,
    shield: I.shield,
    check: I.check,
  },
});

// ── Main Render ──

function render(
  panel: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  const { state, address, error } = ctx;
  unmountMobileQrRoot();
  panel.innerHTML = "";

  addHeader(panel, opts, ctx, address);

  if (state === "disconnected" || !address) {
    syncCardSetupStorage(null);
    resetWalletResolveSpinnerTimeout();
    addDisconnected(panel);
    return;
  }
  if (state === "connecting") {
    const mobileState = WalletBridge.getMobileConnectionState();
    if (
      mobileState.status === "initializing" ||
      mobileState.status === "pairing"
    ) {
      addMobileWalletPairing(panel);
      return;
    }
    addLoading(panel, "Connecting wallet...");
    return;
  }
  if (state === "switching-chain") {
    addLoading(panel, "Switching to Polygon...");
    return;
  }
  if (state === "restoring-session") {
    addLoading(panel, "Restoring trading session…");
    return;
  }

  addPortfolioBar(panel, ctx, opts, positionsViewUi);
  syncCardSetupStorage(address);
  const setupFlow = cardSetupFlow(ctx);
  const setupSurfaceMode = resolveSetupSurfaceMode({
    flow: setupFlow,
    persistedComplete: panelState.cardSetupComplete,
    dismissed: panelState.cardSetupDismissed,
    liveCompleteKnown: isSetupApprovalReadKnown(ctx.approvalReadStatus),
  });

  if (ctx.isDeployed !== null || !ctx.proxyAddress) {
    // Wallet resolution settled (or there is nothing to resolve) — clear the
    // spinner deadline so a later resolve doesn't start already expired.
    resetWalletResolveSpinnerTimeout();
  }

  if (state === "deploying") {
    addLoading(panel, "Deploying your trading wallet…");
    return;
  } else if (ctx.isDeployed === null && ctx.proxyAddress) {
    // Initial on-chain deployment check still in flight (first balance fetch).
    // Show a neutral spinner instead of flashing the Deploy gate for ~500ms —
    // but not forever: past the deadline this flips to a retryable error.
    if (panelState.walletResolveLoadingSince === null) {
      panelState.walletResolveLoadingSince = Date.now();
    }
    const waitedMs = Date.now() - panelState.walletResolveLoadingSince;
    if (waitedMs >= WALLET_RESOLVE_SPINNER_TIMEOUT_MS) {
      addWalletResolveTimeoutError(panel);
      return;
    }
    if (panelState.walletResolveTimeoutTimer === null) {
      // Deadline re-render: recovery must not depend on an unrelated ctx
      // update arriving while the RPC is down.
      panelState.walletResolveTimeoutTimer = setTimeout(() => {
        panelState.walletResolveTimeoutTimer = null;
        rerender();
      }, WALLET_RESOLVE_SPINNER_TIMEOUT_MS - waitedMs);
    }
    addLoading(panel, "Loading trading wallet…");
    return;
  } else if (
    ctx.proxyAddress &&
    ctx.isDeployed === true &&
    !ctx.hasTradingApproval &&
    ctx.approvalReadStatus !== "complete" &&
    setupSurfaceMode !== "complete"
  ) {
    addLoading(panel, "Checking approvals...");
    return;
  } else if (state === "deriving-credentials") {
    // CLOB credential signing is in flight — show the neutral spinner, not the
    // setup flow (which would otherwise render since credentials aren't set yet).
    addLoading(panel, "Confirm signature in your wallet...");
    return;
  } else if (state === "approving" && setupSurfaceMode !== "complete") {
    // Approval signature in flight from the setup wizard — a re-render must
    // not rebuild a clickable Approve button mid-signature (double submit).
    // Fully-onboarded users fall through to the order form instead.
    addLoading(panel, "Confirm approval in your wallet...");
    return;
  } else if (
    setupSurfaceMode === "wizard" &&
    panelState.activeView !== "deposit"
  ) {
    // Guided setup (connect → vault → approve → credentials),
    // driven by the shared setup-flow model so the card and the side panel
    // portfolio gate identically. Deploy-before-credentials falls out of the
    // step order. Deposit remains a separate view and contextual BUY prompt.
    addSetupFlow(
      panel,
      ctx,
      {
        errorMessage: state === "error" ? error : null,
        flow: setupFlow,
      },
      setupViewUi
    );
    if (state !== "error") {
      return;
    }
  } else if (panelState.activeView === "deposit") {
    renderDepositForm(panel, ctx);
  } else if (
    state === "ready" ||
    state === "placing-order" ||
    state === "approving" ||
    state === "splitting" ||
    state === "merging" ||
    // A failed action (e.g. a rejected order-time approval top-up) must not
    // blank the panel for a fully-onboarded user: keep the form rendered and
    // let the error toast below surface the failure.
    (state === "error" && setupSurfaceMode === "complete")
  ) {
    if (panelState.activeView === "order") {
      renderOrderForm(panel, opts, ctx);
    } else if (panelState.activeView === "split") {
      renderSplitForm(panel, opts, ctx, positionsViewUi);
    } else if (panelState.activeView === "merge") {
      renderMergeForm(panel, opts, ctx, positionsViewUi);
    }
  } else if (setupSurfaceMode === "banner") {
    // Setup was dismissed ("Skip for now" in the side panel) but is still
    // incomplete and no other surface matched (e.g. state "connected" with no
    // credentials) — render a resume-setup banner instead of an empty body.
    addSetupBanner(panel, ctx, setupViewUi);
  }

  if (error) {
    // Key on the raw error string so we don't re-render the rich toast on
    // each state tick when the underlying error hasn't changed.
    if (
      panelState.lastRenderedErrorToast !== error &&
      panelState.dismissedErrorToast !== error
    ) {
      showRichErrorToast(panel, error);
      panelState.lastRenderedErrorToast = error;
    }
  } else {
    panelState.lastRenderedErrorToast = null;
    panelState.dismissedErrorToast = null;
  }
}

function showToast(
  panel: HTMLElement,
  message: string,
  type: "success" | "error"
): void {
  let toast = panel.querySelector(".knoww-tp-toast") as HTMLElement | null;
  if (!toast) {
    toast = el("div", "knoww-tp-toast");
    panel.appendChild(toast);
  }
  toast.className = `knoww-tp-toast knoww-tp-toast-${type}`;
  const icon = type === "success" ? I.check : I.error;
  toast.innerHTML = `<span class="knoww-tp-toast-icon">${icon}</span><span>${escapeHtml(message)}</span>`;
  setTimeout(() => toast?.remove(), type === "success" ? 3500 : 6000);
}

/**
 * Rich error toast for state-listener driven errors (order rejections,
 * relayer/network failures, session drops). Maps the raw error to a human
 * title + body via the error-mapping module, renders a dismissible toast,
 * and — for unmapped errors — exposes a "Copy details" button so users can
 * forward the raw text to support.
 */
function showRichErrorToast(panel: HTMLElement, rawError: string): void {
  const mapped = mapTradingError(rawError);

  let toast = panel.querySelector(".knoww-tp-toast") as HTMLElement | null;
  if (!toast) {
    toast = el("div", "knoww-tp-toast");
    panel.appendChild(toast);
  }
  toast.className = "knoww-tp-toast knoww-tp-toast-error knoww-tp-toast-rich";

  const copyBtnHtml = mapped.code
    ? `<button type="button" class="knoww-tp-toast-action" data-knoww-copy-error>Copy details</button>`
    : "";

  toast.innerHTML = `
    <span class="knoww-tp-toast-icon">${I.error}</span>
    <div class="knoww-tp-toast-body">
      <div class="knoww-tp-toast-title">${escapeHtml(mapped.title)}</div>
      <div class="knoww-tp-toast-msg">${escapeHtml(mapped.body)}</div>
    </div>
    <div class="knoww-tp-toast-tail">
      ${copyBtnHtml}
      <button type="button" class="knoww-tp-toast-close" aria-label="Dismiss" data-knoww-dismiss>${I.close}</button>
    </div>
  `;

  const dismiss = () => {
    panelState.dismissedErrorToast = rawError;
    toast?.remove();
    if (panelState.lastRenderedErrorToast === rawError) {
      panelState.lastRenderedErrorToast = null;
    }
  };

  toast
    .querySelector<HTMLButtonElement>("[data-knoww-dismiss]")
    ?.addEventListener("click", dismiss);

  const copyBtn = toast.querySelector<HTMLButtonElement>(
    "[data-knoww-copy-error]"
  );
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const payload = mapped.code
        ? `[${mapped.code}] ${mapped.raw}`
        : mapped.raw;
      try {
        await navigator.clipboard.writeText(payload);
        copyBtn.textContent = "Copied";
        copyBtn.disabled = true;
      } catch {
        copyBtn.textContent = "Copy failed";
      }
    });
  }

  // Unmapped errors linger (10s) so users have time to copy; mapped errors
  // auto-dismiss at 8s. Users can always hit × to close immediately.
  const duration = mapped.code ? 10_000 : 8_000;
  setTimeout(dismiss, duration);
}

// ── Public API ──

function clearOverflowOverrides(): void {
  for (const { el: elem, prev } of panelState.overflowOverrides) {
    if (elem.isConnected) {
      elem.style.overflow = prev;
    }
  }
  panelState.overflowOverrides = [];
}

function applyOverflowOverrides(startEl: HTMLElement): void {
  clearOverflowOverrides();
  let current: HTMLElement | null = startEl.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    if (style.overflow === "hidden" || style.overflowY === "hidden") {
      panelState.overflowOverrides.push({
        el: current,
        prev: current.style.overflow,
      });
      current.style.overflow = "visible";
    }
    current = current.parentElement;
  }
}

/**
 * One-click auto-submit: poll for the order submit button to reach its clean
 * "ready to place" state — enabled, with no approve/deposit/loading class —
 * which the panel only shows when fully connected, credentialed, approved and
 * funded. Click it once then. If readiness isn't reached within the window
 * (needs connect / approve / deposit), do nothing and leave the panel open for
 * the user. This reuses the panel's own validation; it never force-places.
 */
function scheduleAutoSubmit(panel: HTMLElement): void {
  let attempts = 0;
  let done = false;
  const tick = (): void => {
    if (done || panelState.activePanel !== panel || !panel.isConnected) return;
    attempts += 1;
    const btn = panel.querySelector<HTMLButtonElement>(
      ".knoww-tp-submit.buy, .knoww-tp-submit.sell"
    );
    const ready =
      btn &&
      !btn.disabled &&
      !btn.classList.contains("approve") &&
      !btn.classList.contains("deposit") &&
      !btn.classList.contains("deposit-needed") &&
      !btn.classList.contains("loading");
    if (ready) {
      done = true;
      btn.click();
      return;
    }
    if (attempts < 24) setTimeout(tick, 250); // up to ~6s
  };
  setTimeout(tick, 300);
}

export const TradingPanel = {
  show(opts: PanelOptions): void {
    this.hide();
    const panel = createPanel(opts);
    const anchor = opts.anchorElement;
    const card = anchor.closest(".knoww-market-card");
    if (card?.parentNode) {
      card.parentNode.insertBefore(panel, card.nextSibling);
    } else {
      anchor.parentNode?.insertBefore(panel, anchor.nextSibling);
    }
    panelState.activePanel = panel;
    panelState.livePanelRefreshEnabled = true;
    applyOverflowOverrides(panel);
    scheduleLivePanelRefresh();
    requestAnimationFrame(() => {
      if (panelState.activePanel === panel && panel.isConnected) {
        panel.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
    if (opts.autoSubmit) scheduleAutoSubmit(panel);
    if (opts.initialView === "deposit") {
      const addr = TradingService.getContext().address;
      if (addr) {
        panelState.activeView = "deposit";
        startDepositFlow(addr);
      }
    }
  },

  hide(): void {
    panelState.livePanelRefreshEnabled = false;
    clearLivePanelRefreshTimer();
    panelState.lastRenderedErrorToast = null;
    panelState.dismissedErrorToast = null;
    if (panelState.settleTimer) {
      clearTimeout(panelState.settleTimer);
      panelState.settleTimer = null;
    }
    disposeDepositController();
    panelState.orderSettling = false;
    if (panelState.activeUnsubscribe) {
      panelState.activeUnsubscribe();
      panelState.activeUnsubscribe = null;
    }
    clearOverflowOverrides();
    if (panelState.activePanel) {
      panelState.activePanel.remove();
      panelState.activePanel = null;
    }
    panelState.panelOpts = null;
  },

  isVisible(): boolean {
    return panelState.activePanel !== null;
  },

  /**
   * Stream surface: render the deposit flow inline inside a stream card's host
   * element (reusing the panel's deposit engine) instead of opening the floating
   * panel. `onClose` fires when the user backs out or the host leaves the DOM.
   */
  mountInlineDeposit(args: {
    host: HTMLElement;
    opts: PanelOptions;
    onClose?: () => void;
  }): void {
    mountInlineDeposit({
      ...args,
      hidePanel: () => this.hide(),
    });
  },

  /** Tear down an inline deposit (e.g. when the card collapses). */
  closeInlineDeposit(host?: HTMLElement): void {
    closeInlineDeposit(host);
  },
};
