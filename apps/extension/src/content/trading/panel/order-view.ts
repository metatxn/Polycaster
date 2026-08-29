import { PUSD_DECIMALS } from "@knoww/shared-types/contracts";
import {
  getGtdExpirationTimestamp,
  ORDER_EXPIRATION_PRESETS,
} from "@knoww/shared-types/orders";
import {
  calculateBuySlippageForAmount,
  calculateSlippage,
  roundDownToTick,
  roundToTick,
  roundUpToTick,
  type SlippageResult,
} from "@knoww/shared-types/slippage";
import {
  estimateFallbackFeeRaw,
  formatFeeUsd,
  MIN_MARKETABLE_BUY_TICKET_USD,
  parsePusdUnits,
} from "@knoww/shared-types/trading";
import { Decimal } from "decimal.js";
import {
  type LoadingMessageInput,
  startLoadingMessageSequence,
} from "../../../loading-messages";
import type { ClobOrderType } from "../../../types/chrome-messages";
import { balanceChanged } from "../../ui/outcome-balances";
import { type TradingContext, TradingService } from "../trading-service";
import {
  formatCollateralBreakdown,
  formatMarketBuyAmountInput,
  formatShareQuantity,
  normalizeUsdChipAmount,
  normalizeUsdInputAmount,
  rawPusdToNumber,
} from "./format";
import { type PanelOptions, panelState } from "./panel-state";
import {
  getPositionSize,
  type PositionsViewUiPort,
  refreshSplitMergeState,
} from "./positions-view";

export interface OrderViewUiPort {
  el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string
  ): HTMLElementTagNameMap[K];
  elHtml<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    html: string
  ): HTMLElementTagNameMap[K];
  rerender(): void;
  trackAnalytics(
    event: string,
    properties?: Record<string, string | number | boolean | null | undefined>
  ): void;
  showToast(
    panel: HTMLElement,
    message: string,
    type: "success" | "error"
  ): void;
  pauseLivePanelRefresh(): void;
  resumeLivePanelRefresh(): void;
  scheduleLivePanelRefresh(): void;
  startDepositFlow(address: string): void;
  positionsViewUi: PositionsViewUiPort;
  icons: {
    zap: string;
    more: string;
    split: string;
    merge: string;
    up: string;
    down: string;
    alert: string;
    shield: string;
    check: string;
  };
}

let orderViewUi: OrderViewUiPort | null = null;
export function configureOrderView(ui: OrderViewUiPort): void {
  orderViewUi = ui;
}
function requireUi(): OrderViewUiPort {
  if (!orderViewUi) throw new Error("Order view UI port is not configured");
  return orderViewUi;
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  return requireUi().el(tag, cls, text);
}
function elHtml<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  html: string
): HTMLElementTagNameMap[K] {
  return requireUi().elHtml(tag, cls, html);
}
function setSubmitLoading(
  button: HTMLButtonElement,
  messages: LoadingMessageInput
): void {
  const spinner = el("span", "knoww-tp-submit-spinner");
  const label = el("span");
  button.replaceChildren(spinner, label);
  startLoadingMessageSequence(label, messages);
  button.disabled = true;
  button.classList.add("loading");
}
function rerender(): void {
  requireUi().rerender();
}
function trackPanelAnalytics(
  event: string,
  properties: Record<string, string | number | boolean | null | undefined> = {}
): void {
  requireUi().trackAnalytics(event, properties);
}
function showToast(
  panel: HTMLElement,
  message: string,
  type: "success" | "error"
): void {
  requireUi().showToast(panel, message, type);
}
function pauseLivePanelRefresh(): void {
  requireUi().pauseLivePanelRefresh();
}
function resumeLivePanelRefresh(): void {
  requireUi().resumeLivePanelRefresh();
}
function scheduleLivePanelRefresh(): void {
  requireUi().scheduleLivePanelRefresh();
}
function startDepositFlow(address: string): void {
  requireUi().startDepositFlow(address);
}
const positionsViewUi: PositionsViewUiPort = {
  el: (...args) => requireUi().positionsViewUi.el(...args),
  elHtml: (...args) => requireUi().positionsViewUi.elHtml(...args),
  rerender: () => requireUi().positionsViewUi.rerender(),
  trackAnalytics: (...args) =>
    requireUi().positionsViewUi.trackAnalytics(...args),
  showToast: (...args) => requireUi().positionsViewUi.showToast(...args),
  get icons() {
    return requireUi().positionsViewUi.icons;
  },
};
const I = {
  get zap(): string {
    return requireUi().icons.zap;
  },
  get more(): string {
    return requireUi().icons.more;
  },
  get split(): string {
    return requireUi().icons.split;
  },
  get merge(): string {
    return requireUi().icons.merge;
  },
  get up(): string {
    return requireUi().icons.up;
  },
  get down(): string {
    return requireUi().icons.down;
  },
  get alert(): string {
    return requireUi().icons.alert;
  },
  get shield(): string {
    return requireUi().icons.shield;
  },
  get check(): string {
    return requireUi().icons.check;
  },
};

const ORDER_APPROVAL_PREVIEW_DEBOUNCE_MS = 200;

function getTrackedOutcomeName(opts: PanelOptions): string {
  if (opts.yesTokenId && opts.noTokenId) {
    return panelState.selectedOutcome === "yes" ? "Yes" : "No";
  }
  return opts.outcomeName;
}

export function getAvailableTradingCollateral(ctx: TradingContext): number {
  return ctx.balance;
}

function getTickSize(): number {
  return TradingService.getContext().tickSize || 0.01;
}

export function normalizePrice(price: number, tick?: number): number {
  const t = tick ?? getTickSize();
  const rounded = roundToTick(price, t);
  return Math.max(t, Math.min(1 - t, Number(rounded.toFixed(4))));
}
function getBestBidAskFromOrderBook(
  orderBook:
    | { bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }
    | null
    | undefined
): {
  bestBid: number | undefined;
  bestAsk: number | undefined;
} {
  if (!orderBook) return { bestBid: undefined, bestAsk: undefined };

  let bestBid: number | undefined;
  if (orderBook.bids?.length) {
    const parsed = orderBook.bids
      .map((l) => parseFloat(l.price))
      .filter((p) => Number.isFinite(p) && p > 0);
    if (parsed.length > 0) bestBid = Math.max(...parsed);
  }

  let bestAsk: number | undefined;
  if (orderBook.asks?.length) {
    const parsed = orderBook.asks
      .map((l) => parseFloat(l.price))
      .filter((p) => Number.isFinite(p) && p > 0);
    if (parsed.length > 0) bestAsk = Math.min(...parsed);
  }

  return { bestBid, bestAsk };
}

export function getDisplayPriceFromOrderBook(
  orderBook:
    | { bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }
    | null
    | undefined,
  fallback: number
): number {
  const { bestBid, bestAsk } = getBestBidAskFromOrderBook(orderBook);
  if (bestBid !== undefined && bestAsk !== undefined) {
    return new Decimal(bestBid).add(bestAsk).div(2).toNumber();
  }
  return bestAsk ?? bestBid ?? fallback;
}

function getEffectivePrice(opts: PanelOptions): number {
  return panelState.orderMode === "limit"
    ? panelState.limitPrice || opts.price
    : opts.price;
}

function isMarketBuyAmountOrder(): boolean {
  return panelState.orderMode === "market" && panelState.activeSide === "buy";
}

function hasCurrentOrderBook(ctx: TradingContext, opts: PanelOptions): boolean {
  return ctx.orderBookTokenId === opts.tokenId;
}

export type MarketOrderBookStatus = "loading" | "unavailable" | "ready";

export function getMarketOrderBookStatus(
  ctx: Pick<
    TradingContext,
    "orderBookTokenId" | "orderBook" | "orderBookError"
  >,
  opts: Pick<PanelOptions, "tokenId">
): MarketOrderBookStatus {
  if (ctx.orderBookTokenId !== opts.tokenId) return "loading";
  if (ctx.orderBookError) return "unavailable";
  return ctx.orderBook ? "ready" : "loading";
}

function getMarketSlippage(ctx: TradingContext, opts: PanelOptions) {
  if (
    panelState.orderMode !== "market" ||
    !ctx.orderBook ||
    !hasCurrentOrderBook(ctx, opts)
  ) {
    return null;
  }

  const slip = isMarketBuyAmountOrder()
    ? calculateBuySlippageForAmount(ctx.orderBook, panelState.marketBuyAmount)
    : panelState.selectedShares > 0
      ? calculateSlippage(
          ctx.orderBook,
          panelState.activeSide === "sell" ? "SELL" : "BUY",
          panelState.selectedShares
        )
      : null;

  if (!slip || slip.fills.length === 0) return null;
  return slip;
}

/**
 * The book came up short, but the user allowed a partial fill (FAK) and the
 * walk did touch real depth. FAK's contract is "fill whatever is available
 * within the price bound, cancel the rest", so this is a placeable order — we
 * just size the ticket down to the fillable portion and say so.
 */
function isPartialFill(slip: SlippageResult | null): boolean {
  return Boolean(
    panelState.orderMode === "market" &&
      panelState.allowPartialFill &&
      slip &&
      !slip.canFill &&
      slip.filledSize > 0 &&
      slip.worstPrice > 0
  );
}

/**
 * Price bound to sign a market order with — the walk's worst price plus a small
 * buffer, snapped to the tick.
 *
 * A partial (FAK) walk still produces a real worst price, so it gets the same
 * bound as a full fill. This matters: `optionalPriceBound` in the SDK shim
 * drops any non-positive price, and the background only forwards a bound when
 * `price > 0`, so returning `undefined`/`0` here would sign the order with no
 * `maxPrice`/`minPrice` at all (unbounded slippage).
 */
function getMarketPriceBound(slip: SlippageResult | null): number | undefined {
  if (!slip || slip.worstPrice <= 0) return undefined;
  if (!slip.canFill && !isPartialFill(slip)) return undefined;

  const tickSize = getTickSize();
  const worst = new Decimal(slip.worstPrice);
  if (panelState.activeSide === "sell") {
    return Math.max(
      tickSize,
      roundDownToTick(worst.mul("0.995").toNumber(), tickSize)
    );
  }
  return Math.min(
    1 - tickSize,
    roundUpToTick(worst.mul("1.005").toNumber(), tickSize)
  );
}

function getOrderShareSize(opts: PanelOptions, ctx: TradingContext): number {
  if (panelState.orderMode !== "market") return panelState.selectedShares;

  const slip = getMarketSlippage(ctx, opts);
  if (isMarketBuyAmountOrder()) return slip?.filledSize ?? 0;
  // A MARKET SELL is entered in shares, but on a partial (FAK) fill only
  // `filledSize` of them clear — and that is the size we sign, so it is the
  // size we show. With no walk to go on, fall back to what the user typed.
  return slip?.filledSize ?? panelState.selectedShares;
}

function getMarketNotional(
  ctx: TradingContext,
  opts: PanelOptions
): number | null {
  const slip = getMarketSlippage(ctx, opts);
  if (!slip) return null;

  return new Decimal(slip.totalNotional).toNumber();
}

function getCost(opts: PanelOptions, ctx?: TradingContext): number {
  if (isMarketBuyAmountOrder()) {
    const marketNotional = ctx ? getMarketNotional(ctx, opts) : null;
    return marketNotional !== null
      ? marketNotional
      : panelState.marketBuyAmount;
  }

  const marketNotional = ctx ? getMarketNotional(ctx, opts) : null;
  if (marketNotional !== null) {
    return marketNotional;
  }

  const price = new Decimal(getEffectivePrice(opts));
  return price.mul(panelState.selectedShares).toNumber();
}

function getFallbackRequiredCollateral(cost: number): number {
  const requiredRaw = parsePusdUnits(new Decimal(cost));
  const feeRaw = estimateFallbackFeeRaw(requiredRaw);
  return rawPusdToNumber((requiredRaw + feeRaw).toString());
}

function getPanelOrderType(): ClobOrderType {
  // "Allow partial fill" is the whole difference between the two immediate
  // order types: FAK takes whatever depth is there and cancels the rest, FOK
  // is all-or-nothing.
  if (panelState.orderMode === "market") {
    return panelState.allowPartialFill ? "FAK" : "FOK";
  }
  return panelState.expirationPreset === "GTC" ? "GTC" : "GTD";
}

/**
 * Whether the current BUY ticket would cross the book, or `undefined` when we
 * cannot yet assert it (a limit order whose bestAsk has not loaded).
 *
 * `undefined` is not `false`: it makes the background fall back to the
 * conservative taker rate rather than mistakenly sizing the order as a maker.
 */
function getIsMarketableBuy(
  ctx: TradingContext,
  opts: PanelOptions
): boolean | undefined {
  if (panelState.activeSide !== "buy") return undefined;
  if (panelState.orderMode === "market") return true;
  const { bestAsk } = getBestBidAsk(ctx, opts);
  return bestAsk === undefined ? undefined : panelState.limitPrice >= bestAsk;
}

/**
 * Taker fee for the ticket as it stands, in USD, or `null` when unknown.
 *
 * Reads the preflight preview the submit button already fetches — the key check
 * makes sure a stale preview from a previous amount never gets shown against
 * the current one. Returns `null` rather than `0` for an unread fee.
 */
function getPreviewedFeeUsd(
  opts: PanelOptions,
  ctx: TradingContext,
  cost: number,
  shares: number
): number | null {
  if (panelState.activeSide !== "buy") return null;
  const key = getOrderApprovalPreviewKey(
    opts,
    cost,
    shares,
    getIsMarketableBuy(ctx, opts)
  );
  if (!key || panelState.orderApprovalPreview?.key !== key) return null;
  return panelState.orderApprovalPreview.estimatedFee;
}

/**
 * Price to quote the preflight at.
 *
 * A market order has no single quoted price, so use the average fill price the
 * ticket implies. Sending `0` — which the collateral math tolerates, since a
 * market BUY is sized by amount, not by price — would collapse the fee estimate
 * to zero: the protocol fee is a curve in `price · (1 − price)`, which is 0 at
 * the endpoints.
 */
function getPreflightPrice(
  opts: PanelOptions,
  cost: number,
  orderSize: number
): number {
  if (panelState.orderMode !== "market") {
    return normalizePrice(panelState.limitPrice || opts.price);
  }
  if (orderSize > 0 && cost > 0) {
    return new Decimal(cost).div(orderSize).toNumber();
  }
  return getEffectivePrice(opts);
}

function getOrderApprovalPreviewKey(
  opts: PanelOptions,
  cost: number,
  orderSize: number,
  isMarketableBuy: boolean | undefined
): string | null {
  if (
    panelState.activeSide !== "buy" ||
    !Number.isFinite(cost) ||
    cost <= 0 ||
    !Number.isFinite(orderSize) ||
    orderSize <= 0
  ) {
    return null;
  }
  const price = getPreflightPrice(opts, cost, orderSize);
  return [
    opts.tokenId,
    opts.conditionId ?? "",
    panelState.activeSide,
    getPanelOrderType(),
    orderSize,
    price,
    new Decimal(cost).toDecimalPlaces(PUSD_DECIMALS).toFixed(),
    // Marketability flips the required collateral (taker vs maker builder
    // fee), so it must invalidate the cached preview. The "?" state covers
    // the case where bestAsk is unavailable for a limit order — the
    // background falls back to taker (the conservative upper bound), and we
    // need to invalidate the preview when bestAsk later loads and we can
    // assert maker confidently.
    isMarketableBuy === undefined ? "?" : isMarketableBuy ? "T" : "M",
  ].join(":");
}

function ensureOrderApprovalPreview(
  opts: PanelOptions,
  cost: number,
  orderSize: number,
  isMarketableBuy: boolean | undefined
): string | null {
  const key = getOrderApprovalPreviewKey(
    opts,
    cost,
    orderSize,
    isMarketableBuy
  );
  if (!key) return null;
  if (
    panelState.orderApprovalPreview?.key === key ||
    panelState.orderApprovalPreviewInFlightKey === key
  ) {
    return key;
  }

  if (panelState.orderApprovalPreviewTimer) {
    clearTimeout(panelState.orderApprovalPreviewTimer);
    panelState.orderApprovalPreviewTimer = null;
  }
  panelState.orderApprovalPreviewInFlightKey = key;

  panelState.orderApprovalPreviewTimer = setTimeout(() => {
    panelState.orderApprovalPreviewTimer = null;
    if (panelState.orderApprovalPreviewInFlightKey !== key) return;

    const orderType = getPanelOrderType();
    const price = getPreflightPrice(opts, cost, orderSize);
    TradingService.getOrderPreflight({
      side: "BUY",
      price,
      size: orderSize,
      amount: cost,
      orderType,
      conditionId: opts.conditionId,
      isMarketableBuy,
    })
      .then((preflight) => {
        // Drop the result if a newer key is now in flight, otherwise a slow
        // earlier request would clobber the fresher preview.
        if (panelState.orderApprovalPreviewInFlightKey !== key) return;
        panelState.orderApprovalPreviewInFlightKey = null;
        panelState.orderApprovalPreview = {
          key,
          requiredCollateral: rawPusdToNumber(preflight.requiredCollateralRaw),
          requiredCollateralRaw: preflight.requiredCollateralRaw,
          estimatedFee:
            preflight.estimatedFeeRaw === null
              ? null
              : rawPusdToNumber(preflight.estimatedFeeRaw),
        };
        rerender();
      })
      .catch(() => {
        if (panelState.orderApprovalPreviewInFlightKey !== key) return;
        panelState.orderApprovalPreviewInFlightKey = null;
        panelState.orderApprovalPreview = {
          key,
          requiredCollateral: getFallbackRequiredCollateral(cost),
          requiredCollateralRaw: "",
          // The preflight is what knows the fee; if it failed we do not have a
          // number worth showing.
          estimatedFee: null,
        };
        rerender();
      });
  }, ORDER_APPROVAL_PREVIEW_DEBOUNCE_MS);

  return key;
}

export function refreshDynamicUI(): void {
  if (!panelState.activePanel || !panelState.panelOpts) return;
  const ctx = TradingService.getContext();
  const opts = panelState.panelOpts;
  const cost = getCost(opts, ctx);

  const form = panelState.activePanel.querySelector(".knoww-tp-form");
  if (!form) return;

  const costDisp = form.querySelector(".knoww-tp-cost-display");
  if (costDisp) costDisp.textContent = `$${new Decimal(cost).toFixed(2)}`;

  const sharesInput = form.querySelector(
    ".knoww-tp-shares-input"
  ) as HTMLInputElement | null;
  if (sharesInput && document.activeElement !== sharesInput) {
    sharesInput.value = String(panelState.selectedShares);
  }

  const amountInput = form.querySelector(
    ".knoww-tp-amount-input"
  ) as HTMLInputElement | null;
  if (amountInput && document.activeElement !== amountInput) {
    amountInput.value = formatMarketBuyAmountInput(panelState.marketBuyAmount);
  }

  const amountSub = form.querySelector(".knoww-tp-amount-sub");
  if (amountSub) {
    const shares = getOrderShareSize(opts, ctx);
    amountSub.textContent =
      panelState.marketBuyAmount > 0 && shares > 0
        ? `≈ ${formatShareQuantity(shares)} shares`
        : "";
  }

  const limitInput = form.querySelector(
    ".knoww-tp-price-field"
  ) as HTMLInputElement | null;
  if (limitInput && document.activeElement !== limitInput) {
    limitInput.value = String(
      Math.round((panelState.limitPrice || opts.price) * 100)
    );
  }

  // Update order position indicator
  const posIndicator = form.querySelector(".knoww-tp-order-position");
  if (posIndicator) {
    const { bestBid, bestAsk } = getBestBidAsk(ctx, opts);
    if (bestBid !== undefined || bestAsk !== undefined) {
      const currentPrice = panelState.limitPrice || opts.price;
      const info = getOrderPositionInfo(currentPrice, bestBid, bestAsk);
      posIndicator.textContent = info.label;
      posIndicator.className = `knoww-tp-order-position ${info.cls}`;
    } else if (!hasCurrentOrderBook(ctx, opts) || !ctx.orderBook) {
      posIndicator.textContent = "Checking live prices for you...";
      posIndicator.className = "knoww-tp-order-position muted";
    } else if (ctx.orderBookError) {
      posIndicator.textContent = "Order book unavailable";
      posIndicator.className = "knoww-tp-order-position muted";
    } else {
      posIndicator.textContent = "Order book is empty";
      posIndicator.className = "knoww-tp-order-position muted";
    }
  }

  const oldDynamic = form.querySelector(".knoww-tp-dynamic");
  const dynamic = el("div", "knoww-tp-dynamic");
  addOrderSummary(dynamic, opts, ctx);
  addBalanceWarning(dynamic, opts, ctx);
  addSubmitButton(dynamic, opts, ctx);
  if (oldDynamic) {
    oldDynamic.replaceWith(dynamic);
  }
}

function switchOutcome(side: "yes" | "no"): void {
  if (!panelState.panelOpts || side === panelState.selectedOutcome) return;
  if (!panelState.panelOpts.yesTokenId || !panelState.panelOpts.noTokenId)
    return;

  panelState.selectedOutcome = side;
  if (side === "yes") {
    panelState.panelOpts.tokenId = panelState.panelOpts.yesTokenId;
    panelState.panelOpts.price = panelState.yesPrice;
    panelState.panelOpts.outcomeIndex = 0;
  } else {
    panelState.panelOpts.tokenId = panelState.panelOpts.noTokenId;
    panelState.panelOpts.price = panelState.noPriceValue;
    panelState.panelOpts.outcomeIndex = 1;
  }

  panelState.limitPrice = normalizePrice(panelState.panelOpts.price);
  TradingService.fetchOrderBook(panelState.panelOpts.tokenId);
  scheduleLivePanelRefresh();
  rerender();
}

function addOutcomeToggle(p: HTMLElement, opts: PanelOptions): void {
  if (!opts.yesTokenId || !opts.noTokenId) return;

  const yesCtx = Math.round(panelState.yesPrice * 100);
  const noCtx = Math.round(panelState.noPriceValue * 100);

  const row = el("div", "knoww-tp-outcome-toggle");

  const yesBtn = el(
    "button",
    `knoww-tp-outcome-btn yes${panelState.selectedOutcome === "yes" ? " active" : ""}`
  );
  yesBtn.innerHTML = `<span class="knoww-tp-outcome-label">Yes</span><span class="knoww-tp-outcome-price">${yesCtx}¢</span>`;
  yesBtn.onclick = (e) => {
    e.stopPropagation();
    trackPanelAnalytics("trading_panel_outcome_toggled", {
      outcome: "yes",
      marketId: opts.market.id,
    });
    switchOutcome("yes");
  };

  const noBtn = el(
    "button",
    `knoww-tp-outcome-btn no${panelState.selectedOutcome === "no" ? " active" : ""}`
  );
  noBtn.innerHTML = `<span class="knoww-tp-outcome-label">No</span><span class="knoww-tp-outcome-price">${noCtx}¢</span>`;
  noBtn.onclick = (e) => {
    e.stopPropagation();
    trackPanelAnalytics("trading_panel_outcome_toggled", {
      outcome: "no",
      marketId: opts.market.id,
    });
    switchOutcome("no");
  };

  row.appendChild(yesBtn);
  row.appendChild(noBtn);
  p.appendChild(row);
}

// ── Order Type Toggle + More Menu ──

function addOrderTypeRow(form: HTMLElement, opts: PanelOptions): void {
  const row = el("div", "knoww-tp-ordertype-row");

  const toggle = el("div", "knoww-tp-ordertype-toggle");
  const mBtn = elHtml(
    "button",
    `knoww-tp-ordertype-btn${panelState.orderMode === "market" ? " active" : ""}`,
    `${I.zap} Market`
  );
  mBtn.onclick = (e) => {
    e.stopPropagation();
    trackPanelAnalytics("trading_panel_order_mode_selected", {
      mode: "market",
      marketId: opts.market.id,
    });
    panelState.orderMode = "market";
    panelState.moreMenuOpen = false;
    rerender();
  };
  const lBtn = el(
    "button",
    `knoww-tp-ordertype-btn${panelState.orderMode === "limit" ? " active" : ""}`,
    "Limit"
  );
  lBtn.onclick = (e) => {
    e.stopPropagation();
    trackPanelAnalytics("trading_panel_order_mode_selected", {
      mode: "limit",
      marketId: opts.market.id,
    });
    panelState.orderMode = "limit";
    panelState.moreMenuOpen = false;
    rerender();
  };
  toggle.appendChild(mBtn);
  toggle.appendChild(lBtn);
  row.appendChild(toggle);

  const hasSplitMerge = !!(
    opts.conditionId &&
    opts.yesTokenId &&
    opts.noTokenId
  );
  if (hasSplitMerge) {
    const wrap = el("div", "knoww-tp-more-wrap");
    const moreBtn = elHtml(
      "button",
      `knoww-tp-more-btn${panelState.moreMenuOpen ? " active" : ""}`,
      I.more
    );
    moreBtn.title = "More options";
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      panelState.moreMenuOpen = !panelState.moreMenuOpen;
      rerender();
    };
    wrap.appendChild(moreBtn);

    if (panelState.moreMenuOpen) {
      const menu = el("div", "knoww-tp-more-menu");
      const splitBtn = elHtml(
        "button",
        "knoww-tp-more-item",
        `${I.split} Split <span class="knoww-tp-tooltip-icon" title="Convert 1 pUSD into 1 Yes and 1 No share">(?)</span>`
      );
      splitBtn.onclick = (e) => {
        e.stopPropagation();
        trackPanelAnalytics("trading_panel_split_opened", {
          marketId: opts.market.id,
        });
        panelState.moreMenuOpen = false;
        panelState.activeView = "split";
        panelState.splitMergeAmount = "";
        refreshSplitMergeState(opts, positionsViewUi, {
          refreshWallet: true,
        });
        rerender();
      };
      menu.appendChild(splitBtn);
      menu.appendChild(el("div", "knoww-tp-more-divider"));
      const mergeBtn = elHtml(
        "button",
        "knoww-tp-more-item",
        `${I.merge} Merge <span class="knoww-tp-tooltip-icon" title="Combine 1 Yes and 1 No share to get 1 USDC back">(?)</span>`
      );
      mergeBtn.onclick = (e) => {
        e.stopPropagation();
        trackPanelAnalytics("trading_panel_merge_opened", {
          marketId: opts.market.id,
        });
        panelState.moreMenuOpen = false;
        panelState.activeView = "merge";
        panelState.splitMergeAmount = "";
        refreshSplitMergeState(opts, positionsViewUi, {
          refreshWallet: true,
          refreshOutcomeBalances: true,
          resetOutcomeBalances: true,
        });
        rerender();
      };
      menu.appendChild(mergeBtn);
      wrap.appendChild(menu);
    }
    row.appendChild(wrap);
  }

  form.appendChild(row);
}

// ── Buy/Sell Toggle ──

function addBuySellToggle(form: HTMLElement): void {
  const toggle = el("div", "knoww-tp-buysell-toggle");
  const buyBtn = elHtml(
    "button",
    `knoww-tp-buysell-btn buy${panelState.activeSide === "buy" ? " active" : ""}`,
    `${I.up} Buy`
  );
  buyBtn.onclick = (e) => {
    e.stopPropagation();
    trackPanelAnalytics("trading_panel_side_selected", {
      side: "buy",
      marketId: panelState.panelOpts?.market.id,
    });
    panelState.activeSide = "buy";
    rerender();
  };
  const sellBtn = elHtml(
    "button",
    `knoww-tp-buysell-btn sell${panelState.activeSide === "sell" ? " active" : ""}`,
    `${I.down} Sell`
  );
  sellBtn.onclick = (e) => {
    e.stopPropagation();
    trackPanelAnalytics("trading_panel_side_selected", {
      side: "sell",
      marketId: panelState.panelOpts?.market.id,
    });
    panelState.activeSide = "sell";
    if (panelState.panelOpts) {
      const pos = getPositionSize(panelState.panelOpts);
      if (pos > 0) panelState.selectedShares = pos;
    }
    rerender();
  };
  toggle.appendChild(buyBtn);
  toggle.appendChild(sellBtn);
  form.appendChild(toggle);
}

// ── Limit Price Input with +/- Steppers ──

function getBestBidAsk(
  ctx: TradingContext,
  opts: PanelOptions
): {
  bestBid: number | undefined;
  bestAsk: number | undefined;
} {
  if (!hasCurrentOrderBook(ctx, opts)) {
    return { bestBid: undefined, bestAsk: undefined };
  }
  return getBestBidAskFromOrderBook(ctx.orderBook);
}

function getOrderPositionInfo(
  price: number,
  bestBid: number | undefined,
  bestAsk: number | undefined
): { label: string; cls: string } {
  if (panelState.activeSide === "buy") {
    if (bestAsk !== undefined && price >= bestAsk) {
      return {
        label: "Crosses spread - will execute immediately",
        cls: "green",
      };
    }
    if (bestBid !== undefined && price > bestBid) {
      return { label: "Above best bid - near top of book", cls: "blue" };
    }
    if (bestBid !== undefined && price === bestBid) {
      return { label: "At best bid - joins queue", cls: "muted" };
    }
    return { label: "Below best bid - deeper in book", cls: "amber" };
  }
  if (bestBid !== undefined && price <= bestBid) {
    return { label: "Crosses spread - will execute immediately", cls: "green" };
  }
  if (bestAsk !== undefined && price < bestAsk) {
    return { label: "Below best ask - near top of book", cls: "blue" };
  }
  if (bestAsk !== undefined && price === bestAsk) {
    return { label: "At best ask - joins queue", cls: "muted" };
  }
  return { label: "Above best ask - deeper in book", cls: "amber" };
}

function addLimitPrice(
  form: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  if (panelState.orderMode !== "limit") return;

  const { bestBid, bestAsk } = getBestBidAsk(ctx, opts);
  const tickSize = ctx.tickSize || 0.01;

  const section = el("div", "knoww-tp-price-section");

  const header = el("div", "knoww-tp-section-header");
  header.appendChild(el("span", "knoww-tp-section-label", "Limit Price"));

  // Bid/Ask quick-set buttons (always show, even while loading)
  const bidAskWrap = el("div", "knoww-tp-bidask-wrap");
  if (bestBid !== undefined) {
    const bidBtn = el(
      "button",
      "knoww-tp-bidask-btn bid",
      `Bid: ${(bestBid * 100).toFixed(1)}¢`
    );
    bidBtn.onclick = (e) => {
      e.stopPropagation();
      panelState.limitPrice = normalizePrice(bestBid, tickSize);
      trackPanelAnalytics("trading_form_limit_price_set", {
        marketId: opts.market.id,
        method: "bid",
        price: panelState.limitPrice,
      });
      rerender();
    };
    bidAskWrap.appendChild(bidBtn);
  }
  if (bestAsk !== undefined) {
    const askBtn = el(
      "button",
      "knoww-tp-bidask-btn ask",
      `Ask: ${(bestAsk * 100).toFixed(1)}¢`
    );
    askBtn.onclick = (e) => {
      e.stopPropagation();
      panelState.limitPrice = normalizePrice(bestAsk, tickSize);
      trackPanelAnalytics("trading_form_limit_price_set", {
        marketId: opts.market.id,
        method: "ask",
        price: panelState.limitPrice,
      });
      rerender();
    };
    bidAskWrap.appendChild(askBtn);
  }
  header.appendChild(bidAskWrap);
  section.appendChild(header);

  const controls = el("div", "knoww-tp-price-controls");
  const minus = el("button", "knoww-tp-price-btn", "−");
  minus.onclick = (e) => {
    e.stopPropagation();
    panelState.limitPrice = normalizePrice(
      (panelState.limitPrice || opts.price) - tickSize,
      tickSize
    );
    trackPanelAnalytics("trading_form_limit_price_set", {
      marketId: opts.market.id,
      method: "stepper_down",
      price: panelState.limitPrice,
    });
    rerender();
  };

  const wrap = el("div", "knoww-tp-price-input-wrap");
  const input = document.createElement("input");
  input.className = "knoww-tp-price-field";
  input.type = "number";
  const tickCents = tickSize * 100;
  input.min = String(tickCents);
  input.max = String(100 - tickCents);
  input.step = String(tickCents);
  const displayPrice = normalizePrice(
    panelState.limitPrice || opts.price,
    tickSize
  );
  input.value =
    tickSize < 0.01
      ? (displayPrice * 100).toFixed(2)
      : (displayPrice * 100).toFixed(1);
  input.oninput = () => {
    const v = parseFloat(input.value);
    if (v >= 1 && v <= 99) {
      panelState.limitPrice = v / 100;
      refreshDynamicUI();
    }
  };
  input.onblur = () => {
    panelState.limitPrice = normalizePrice(panelState.limitPrice, tickSize);
    const centsDisplay =
      tickSize < 0.01
        ? (panelState.limitPrice * 100).toFixed(2)
        : (panelState.limitPrice * 100).toFixed(1);
    input.value = centsDisplay;
    trackPanelAnalytics("trading_form_limit_price_set", {
      marketId: opts.market.id,
      method: "manual",
      price: panelState.limitPrice,
    });
    refreshDynamicUI();
  };
  wrap.appendChild(input);
  wrap.appendChild(el("span", "knoww-tp-price-cent", "¢"));

  const plus = el("button", "knoww-tp-price-btn", "+");
  plus.onclick = (e) => {
    e.stopPropagation();
    panelState.limitPrice = normalizePrice(
      (panelState.limitPrice || opts.price) + tickSize,
      tickSize
    );
    trackPanelAnalytics("trading_form_limit_price_set", {
      marketId: opts.market.id,
      method: "stepper_up",
      price: panelState.limitPrice,
    });
    rerender();
  };

  controls.appendChild(minus);
  controls.appendChild(wrap);
  controls.appendChild(plus);
  section.appendChild(controls);

  // Order position indicator (updated live by refreshDynamicUI)
  if (bestBid !== undefined || bestAsk !== undefined) {
    const currentPrice = panelState.limitPrice || opts.price;
    const info = getOrderPositionInfo(currentPrice, bestBid, bestAsk);
    section.appendChild(
      el("div", `knoww-tp-order-position ${info.cls}`, info.label)
    );
  } else if (!hasCurrentOrderBook(ctx, opts) || !ctx.orderBook) {
    section.appendChild(
      el(
        "div",
        "knoww-tp-order-position muted",
        "Checking live prices for you..."
      )
    );
  } else if (ctx.orderBookError) {
    section.appendChild(
      el("div", "knoww-tp-order-position muted", "Order book unavailable")
    );
  } else {
    section.appendChild(
      el("div", "knoww-tp-order-position muted", "Order book is empty")
    );
  }

  // Tick size info
  section.appendChild(
    el(
      "div",
      "knoww-tp-tick-info",
      `Tick size: ${(tickSize * 100).toFixed(1)}¢`
    )
  );

  // Expiration
  const expBlock = el("div", "knoww-tp-expiration");
  const expHeader = el("div", "knoww-tp-section-header");
  expHeader.appendChild(el("span", "knoww-tp-section-label", "Expiration"));
  expBlock.appendChild(expHeader);

  const expRow = el("div", "knoww-tp-exp-row");
  for (const p of ORDER_EXPIRATION_PRESETS) {
    const btn = el(
      "button",
      `knoww-tp-exp-btn${panelState.expirationPreset === p ? " active" : ""}`,
      p
    );
    btn.onclick = (e) => {
      e.stopPropagation();
      panelState.expirationPreset = p;
      trackPanelAnalytics("trading_form_expiration_changed", {
        marketId: opts.market.id,
        expiration: p,
      });
      rerender();
    };
    expRow.appendChild(btn);
  }
  expBlock.appendChild(expRow);
  expBlock.appendChild(
    el(
      "div",
      "knoww-tp-exp-info",
      panelState.expirationPreset === "GTC"
        ? "Order remains active until filled or cancelled"
        : `Expires in ${panelState.expirationPreset} if not filled`
    )
  );
  section.appendChild(expBlock);
  form.appendChild(section);
}

// ── Slippage Info (Market mode) ──

function addSlippageInfo(
  form: HTMLElement,
  _opts: PanelOptions,
  ctx: TradingContext
): void {
  const slip = getMarketSlippage(ctx, _opts);
  if (!slip) return;

  const row = el("div", "knoww-tp-execution-info");

  const avgG = el("span", "knoww-tp-exec-group");
  avgG.appendChild(el("span", "knoww-tp-exec-label", "Avg. Price"));
  avgG.appendChild(
    el(
      "span",
      "knoww-tp-exec-value",
      `${(slip.avgFillPrice * 100).toFixed(1)}¢`
    )
  );
  row.appendChild(avgG);

  const slipG = el("span", "knoww-tp-exec-group");
  slipG.appendChild(el("span", "knoww-tp-exec-label", "Slippage"));
  slipG.appendChild(
    el(
      "span",
      `knoww-tp-exec-value${slip.slippagePercent > 2 ? " warn" : ""}`,
      `${slip.slippagePercent.toFixed(2)}%`
    )
  );
  row.appendChild(slipG);

  form.appendChild(row);
}

// ── Partial Fill Toggle (Market mode) ──

function addPartialFillToggle(form: HTMLElement, opts: PanelOptions): void {
  if (panelState.orderMode !== "market") return;

  const block = el("div", "knoww-tp-partial-fill");
  const row = el("div", "knoww-tp-pf-row");
  row.appendChild(el("span", "knoww-tp-pf-label", "Allow partial fill"));

  const on = panelState.allowPartialFill;
  const sw = el("button", `knoww-tp-pf-switch${on ? " on" : ""}`);
  sw.setAttribute("type", "button");
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", on ? "true" : "false");
  sw.setAttribute("aria-label", "Allow partial fill");
  sw.appendChild(el("span", "knoww-tp-pf-knob"));
  sw.onclick = (e) => {
    e.stopPropagation();
    panelState.allowPartialFill = !panelState.allowPartialFill;
    trackPanelAnalytics("trading_form_partial_fill_toggled", {
      marketId: opts.market.id,
      allowPartialFill: panelState.allowPartialFill,
    });
    rerender();
  };
  row.appendChild(sw);
  block.appendChild(row);

  block.appendChild(
    el(
      "div",
      "knoww-tp-pf-info",
      on
        ? "Fills whatever the book has right now and cancels the rest (FAK)"
        : "Fills the full amount or nothing at all (FOK)"
    )
  );
  form.appendChild(block);
}

// ── Amount Section ──

function addMarketBuyAmountSection(
  form: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  const section = el("div", "knoww-tp-amount-section market-buy");
  const availableCollateral = getAvailableTradingCollateral(ctx);
  const shares = getOrderShareSize(opts, ctx);

  const header = el("div", "knoww-tp-section-header");
  header.appendChild(el("span", "knoww-tp-section-label", "Amount"));
  header.appendChild(
    el(
      "span",
      "knoww-tp-cash-display",
      `$${new Decimal(availableCollateral).toFixed(2)} cash`
    )
  );
  section.appendChild(header);

  const inputWrap = el("div", "knoww-tp-amount-input-wrap");
  inputWrap.appendChild(el("span", "knoww-tp-amount-currency", "$"));

  const amountInput = document.createElement("input");
  amountInput.className = "knoww-tp-amount-input";
  amountInput.type = "text";
  amountInput.inputMode = "decimal";
  amountInput.name = "amount";
  amountInput.value = formatMarketBuyAmountInput(panelState.marketBuyAmount);
  amountInput.setAttribute("aria-label", "Order amount in dollars");
  amountInput.onfocus = () => {
    amountInput.select();
  };
  amountInput.oninput = () => {
    const cleaned = amountInput.value
      .replace(/[^0-9.]/g, "")
      .replace(/(\..*)\./g, "$1");
    if (cleaned !== amountInput.value) amountInput.value = cleaned;
    panelState.marketBuyAmount = normalizeUsdInputAmount(cleaned);
    trackPanelAnalytics("trading_form_amount_input", {
      marketId: opts.market.id,
      amount: panelState.marketBuyAmount,
      method: "manual",
      side: panelState.activeSide,
    });
    refreshDynamicUI();
  };
  amountInput.onblur = () => {
    amountInput.value = formatMarketBuyAmountInput(panelState.marketBuyAmount);
    refreshDynamicUI();
  };
  inputWrap.appendChild(amountInput);
  section.appendChild(inputWrap);

  const presets = el("div", "knoww-tp-amount-presets");
  for (const delta of [1, 5, 10, 100]) {
    const chip = el("button", "knoww-tp-amount-chip", `+$${delta}`);
    chip.onclick = (e) => {
      e.stopPropagation();
      panelState.marketBuyAmount = normalizeUsdChipAmount(
        new Decimal(panelState.marketBuyAmount).add(delta).toString()
      );
      trackPanelAnalytics("trading_form_amount_adjusted", {
        marketId: opts.market.id,
        amount: panelState.marketBuyAmount,
        delta,
        method: "chip",
        side: panelState.activeSide,
      });
      rerender();
    };
    presets.appendChild(chip);
  }

  const maxBtn = el("button", "knoww-tp-amount-chip max", "Max");
  maxBtn.onclick = (e) => {
    e.stopPropagation();
    panelState.marketBuyAmount = normalizeUsdChipAmount(
      new Decimal(availableCollateral)
        .toDecimalPlaces(2, Decimal.ROUND_FLOOR)
        .toString()
    );
    trackPanelAnalytics("trading_form_amount_max_clicked", {
      marketId: opts.market.id,
      amount: panelState.marketBuyAmount,
      side: panelState.activeSide,
    });
    rerender();
  };
  if (availableCollateral <= 0) maxBtn.disabled = true;
  presets.appendChild(maxBtn);
  section.appendChild(presets);

  section.appendChild(
    el(
      "div",
      "knoww-tp-amount-sub",
      panelState.marketBuyAmount > 0 && shares > 0
        ? `≈ ${formatShareQuantity(shares)} shares`
        : ""
    )
  );

  form.appendChild(section);
}

function addAmountSection(
  form: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  if (isMarketBuyAmountOrder()) {
    addMarketBuyAmountSection(form, opts, ctx);
    return;
  }

  const section = el("div", "knoww-tp-amount-section");
  const effectivePrice = getEffectivePrice(opts);
  const isSell = panelState.activeSide === "sell";
  const positionSize = getPositionSize(opts);
  const cost = getCost(opts, ctx);
  const minShares = isSell ? 1 : Math.max(1, Math.ceil(ctx.minOrderSize));
  const availableCollateral = getAvailableTradingCollateral(ctx);

  // Shares header: "Shares" label on left, cost on right
  const sharesHeader = el("div", "knoww-tp-section-header");
  sharesHeader.appendChild(el("span", "knoww-tp-section-label", "Shares"));
  const costLabel = el("span", "knoww-tp-cost-display", `$${cost.toFixed(2)}`);
  sharesHeader.appendChild(costLabel);
  section.appendChild(sharesHeader);

  // Shares row: [-10] [-1] [input] [+1] [+10] [Max]
  const sharesRow = el("div", "knoww-tp-shares-row");

  const m10 = el("button", "knoww-tp-shares-btn", "-10");
  m10.onclick = (e) => {
    e.stopPropagation();
    adjustShares(-10, minShares);
  };
  if (panelState.selectedShares - 10 < minShares) m10.disabled = true;
  sharesRow.appendChild(m10);

  const m1 = el("button", "knoww-tp-shares-btn", "-1");
  m1.onclick = (e) => {
    e.stopPropagation();
    adjustShares(-1, minShares);
  };
  if (panelState.selectedShares - 1 < minShares) m1.disabled = true;
  sharesRow.appendChild(m1);

  const sharesInput = document.createElement("input");
  sharesInput.className = "knoww-tp-shares-input";
  sharesInput.type = "number";
  sharesInput.min = String(minShares);
  sharesInput.step = isSell ? "0.01" : "1";
  sharesInput.value = String(panelState.selectedShares);
  sharesInput.oninput = () => {
    const v = Number(sharesInput.value);
    if (!Number.isNaN(v) && v > 0) {
      let capped = Math.max(isSell ? 0.01 : minShares, v);
      if (isSell && positionSize > 0) capped = Math.min(capped, positionSize);
      panelState.selectedShares = capped;
      trackPanelAnalytics("trading_form_shares_input", {
        marketId: opts.market.id,
        shares: capped,
        method: "manual",
        side: panelState.activeSide,
      });
      refreshDynamicUI();
    }
  };
  sharesRow.appendChild(sharesInput);

  const p1 = el("button", "knoww-tp-shares-btn", "+1");
  p1.onclick = (e) => {
    e.stopPropagation();
    adjustShares(1, minShares);
  };
  sharesRow.appendChild(p1);

  const p10 = el("button", "knoww-tp-shares-btn", "+10");
  p10.onclick = (e) => {
    e.stopPropagation();
    adjustShares(10, minShares);
  };
  sharesRow.appendChild(p10);

  const maxBtn = el("button", "knoww-tp-max-btn", "Max");
  maxBtn.onclick = (e) => {
    e.stopPropagation();
    if (isSell && positionSize > 0) {
      panelState.selectedShares = positionSize;
    } else if (!isSell && availableCollateral > 0 && effectivePrice > 0) {
      panelState.selectedShares = Math.max(
        minShares,
        Math.floor(availableCollateral / effectivePrice)
      );
    }
    trackPanelAnalytics("trading_form_max_clicked", {
      marketId: opts.market.id,
      shares: panelState.selectedShares,
      side: panelState.activeSide,
    });
    rerender();
  };
  if ((isSell && positionSize <= 0) || (!isSell && availableCollateral <= 0)) {
    maxBtn.disabled = true;
  }
  sharesRow.appendChild(maxBtn);

  section.appendChild(sharesRow);

  form.appendChild(section);
}

function adjustShares(delta: number, minShares: number): void {
  let next = Math.max(minShares, panelState.selectedShares + delta);
  if (panelState.activeSide === "sell" && panelState.panelOpts) {
    const pos = getPositionSize(panelState.panelOpts);
    if (pos > 0) next = Math.min(next, pos);
  }
  panelState.selectedShares = next;
  trackPanelAnalytics("trading_form_shares_adjusted", {
    marketId: panelState.panelOpts?.market.id || "",
    shares: next,
    delta,
    method: "button",
    side: panelState.activeSide,
  });
  rerender();
}

// ── Order Summary ──

function addOrderSummary(
  form: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  const isBuy = panelState.activeSide === "buy";
  const isMarketBuyAmount = isMarketBuyAmountOrder();
  const effectivePrice = getEffectivePrice(opts);
  const shares = getOrderShareSize(opts, ctx);
  const cost = getCost(opts, ctx);
  const minShares = Math.max(1, Math.ceil(ctx.minOrderSize));
  const positionSize = getPositionSize(opts);
  const orderBookStatus =
    panelState.orderMode === "market"
      ? getMarketOrderBookStatus(ctx, opts)
      : "ready";

  const summary = el("div", "knoww-tp-summary");

  // Portfolio position
  if (panelState.outcomeBalances) {
    const posRow = el("div", "knoww-tp-summary-row");
    posRow.appendChild(
      el("span", "knoww-tp-summary-label", `Your ${opts.outcomeName} position`)
    );
    const posVal =
      positionSize > 0
        ? `${new Decimal(positionSize).toFixed(2)} shares ($${new Decimal(positionSize).mul(effectivePrice).toFixed(2)})`
        : "None";
    posRow.appendChild(
      el(
        "span",
        `knoww-tp-summary-value${positionSize > 0 ? " positive" : ""}`,
        posVal
      )
    );
    summary.appendChild(posRow);
  }

  // Primary cash movement for the order.
  const r1 = el("div", "knoww-tp-summary-row");
  r1.appendChild(
    el("span", "knoww-tp-summary-label", isBuy ? "You pay" : "You receive")
  );
  const costDec = new Decimal(cost);
  r1.appendChild(
    el(
      "span",
      `knoww-tp-summary-value lg${!isBuy ? " positive" : ""}`,
      `$${costDec.toFixed(2)}`
    )
  );
  summary.appendChild(r1);

  // Taker fee. Orders are signed without `maxSpend`, so the fee is charged *on
  // top* of what you pay rather than taken out of it — the row plus the total
  // below it are what make the real debit visible instead of a surprise.
  // Omitted when the market's fee details could not be read; "$0.00" would be a
  // worse lie, and a total built on a missing fee would be worse still.
  const estimatedFeeUsd = getPreviewedFeeUsd(opts, ctx, cost, shares);
  if (isBuy && estimatedFeeUsd !== null) {
    const feeRow = el("div", "knoww-tp-summary-row");
    feeRow.appendChild(el("span", "knoww-tp-summary-label", "Est. fee"));
    feeRow.appendChild(
      el("span", "knoww-tp-summary-value sm", formatFeeUsd(estimatedFeeUsd))
    );
    summary.appendChild(feeRow);

    const totalRow = el("div", "knoww-tp-summary-row");
    totalRow.appendChild(el("span", "knoww-tp-summary-label", "Est. total"));
    totalRow.appendChild(
      el(
        "span",
        "knoww-tp-summary-value sm",
        `$${costDec.plus(estimatedFeeUsd).toFixed(2)}`
      )
    );
    summary.appendChild(totalRow);
  }

  if (orderBookStatus !== "ready") {
    const statusRow = el("div", "knoww-tp-summary-row");
    statusRow.appendChild(
      el(
        "span",
        "knoww-tp-summary-label",
        isBuy ? "Payout and profit" : "Order proceeds"
      )
    );
    statusRow.appendChild(
      el(
        "span",
        "knoww-tp-summary-value",
        orderBookStatus === "loading"
          ? "Checking live prices for you..."
          : "Order book unavailable"
      )
    );
    summary.appendChild(statusRow);
    form.appendChild(summary);
    return;
  }

  // FAK sized the ticket down to the depth that is actually there. Say so in
  // the user's own units — they typed dollars on a market BUY and shares on a
  // SELL — before they sign for less than they asked for.
  const marketSlippage = getMarketSlippage(ctx, opts);
  if (marketSlippage && isPartialFill(marketSlippage)) {
    const pfRow = el("div", "knoww-tp-summary-row knoww-tp-warn-row");
    pfRow.appendChild(
      el("span", "knoww-tp-summary-label knoww-tp-warn-text", "Partial fill")
    );
    pfRow.appendChild(
      el(
        "span",
        "knoww-tp-summary-value knoww-tp-warn-text",
        isMarketBuyAmount
          ? `$${new Decimal(marketSlippage.totalNotional).toFixed(2)} of $${new Decimal(panelState.marketBuyAmount).toFixed(2)}`
          : `${formatShareQuantity(marketSlippage.filledSize)} of ${formatShareQuantity(panelState.selectedShares)} shares`
      )
    );
    summary.appendChild(pfRow);
  }

  if (isBuy && !isMarketBuyAmount && shares > 0 && shares < minShares) {
    const minRow = el("div", "knoww-tp-summary-row knoww-tp-warn-row");
    minRow.appendChild(
      el(
        "span",
        "knoww-tp-summary-label knoww-tp-warn-text",
        "Min shares required"
      )
    );
    minRow.appendChild(
      el("span", "knoww-tp-summary-value knoww-tp-warn-text", String(minShares))
    );
    summary.appendChild(minRow);
  }

  if (isBuy) {
    const potentialReturn = new Decimal(shares);
    const r3 = el("div", "knoww-tp-summary-row");
    r3.appendChild(
      el("span", "knoww-tp-summary-label", `Payout if ${opts.outcomeName}`)
    );
    r3.appendChild(
      el(
        "span",
        "knoww-tp-summary-value positive lg",
        `$${potentialReturn.toFixed(2)}`
      )
    );
    summary.appendChild(r3);

    const profit = potentialReturn.sub(costDec);
    const pct = costDec.gt(0) ? profit.div(costDec).mul(100) : new Decimal(0);
    const r4 = el("div", "knoww-tp-summary-row");
    r4.appendChild(el("span", "knoww-tp-summary-label", "Estimated Profit"));
    r4.appendChild(
      el(
        "span",
        "knoww-tp-summary-value positive sm",
        `+$${profit.toFixed(2)} (${pct.toFixed(1)}%)`
      )
    );
    summary.appendChild(r4);
  }

  if (!isBuy) {
    if (positionSize <= 0) {
      const noPos = el("div", "knoww-tp-summary-row knoww-tp-warn-row");
      noPos.appendChild(
        el(
          "span",
          "knoww-tp-summary-label knoww-tp-warn-text",
          "No position to sell"
        )
      );
      noPos.appendChild(
        el("span", "knoww-tp-summary-value knoww-tp-warn-text", "0 shares")
      );
      summary.appendChild(noPos);
    } else if (shares - positionSize > positionSize * 0.01) {
      const overPos = el("div", "knoww-tp-summary-row knoww-tp-warn-row");
      overPos.appendChild(
        el(
          "span",
          "knoww-tp-summary-label knoww-tp-warn-text",
          "Exceeds position"
        )
      );
      overPos.appendChild(
        el(
          "span",
          "knoww-tp-summary-value knoww-tp-warn-text",
          `Max ${positionSize.toFixed(1)} shares`
        )
      );
      summary.appendChild(overPos);
    }
  }

  form.appendChild(summary);
}

// ── Balance Warning ──

function addBalanceWarning(
  form: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  if (panelState.activeSide === "sell") return;
  const { address } = ctx;
  const cost = getCost(opts, ctx);
  const balanceDecimal = new Decimal(getAvailableTradingCollateral(ctx));
  const costDecimal = new Decimal(cost);
  if (costDecimal.lte(balanceDecimal) || balanceDecimal.lt(0)) return;
  if (address && costDecimal.gt(balanceDecimal)) return;

  const w = el("div", "knoww-tp-balance-warn");

  const top = el("div", "knoww-tp-warn-top");
  const left = el("div", "knoww-tp-warn-left");
  left.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
  left.appendChild(
    el(
      "span",
      "knoww-tp-warn-text",
      `Need $${costDecimal.sub(balanceDecimal).toFixed(2)} more`
    )
  );
  top.appendChild(left);
  w.appendChild(top);

  const progress = Decimal.min(100, balanceDecimal.div(costDecimal).mul(100));
  const barBg = el("div", "knoww-tp-warn-bar-bg");
  const barFill = el("div", "knoww-tp-warn-bar-fill");
  barFill.style.width = `${progress.toNumber()}%`;
  barBg.appendChild(barFill);
  w.appendChild(barBg);

  w.appendChild(
    el(
      "div",
      "knoww-tp-warn-detail",
      `$${balanceDecimal.toFixed(2)} / $${costDecimal.toFixed(2)} available (${formatCollateralBreakdown(ctx)})`
    )
  );
  form.appendChild(w);
}

// ── Submit Button ──

function addSubmitButton(
  form: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  const side = panelState.activeSide === "sell" ? "SELL" : "BUY";
  const { state, minOrderSize, usdcAllowance, usdcAllowanceNegRisk } = ctx;
  const isSubmitting = state === "placing-order" || state === "approving";
  const isMarketBuyAmount = isMarketBuyAmountOrder();
  const marketSlippage =
    panelState.orderMode === "market" ? getMarketSlippage(ctx, opts) : null;
  const orderBookStatus =
    panelState.orderMode === "market"
      ? getMarketOrderBookStatus(ctx, opts)
      : "ready";
  const cost = getCost(opts, ctx);
  const availableCollateral = getAvailableTradingCollateral(ctx);
  const noFunds = panelState.activeSide === "buy" && cost > availableCollateral;
  const missingFunds = new Decimal(cost).sub(availableCollateral);
  const shares = getOrderShareSize(opts, ctx);
  const noAmount = isMarketBuyAmount && panelState.marketBuyAmount <= 0;
  const noShares = !isMarketBuyAmount && shares <= 0;
  const minShares = Math.max(1, Math.ceil(minOrderSize));
  const belowMinShares =
    panelState.activeSide === "buy" && !isMarketBuyAmount && shares < minShares;
  // Genuinely un-fillable: either the user demanded all-or-nothing (FOK) or
  // the book has no depth at all to walk into. A short book the user opted
  // into filling partially is a placeable order, not a blocked one.
  const hasInsufficientLiquidity =
    panelState.orderMode === "market" &&
    orderBookStatus === "ready" &&
    !noAmount &&
    marketSlippage?.canFill !== true &&
    !isPartialFill(marketSlippage);
  const relevantAllowance = opts.negRisk ? usdcAllowanceNegRisk : usdcAllowance;
  // Marketability gates which builder fee rate (taker vs maker) the gate sizes
  // against, so it is part of the preview cache key.
  const isMarketableBuy = getIsMarketableBuy(ctx, opts);
  const approvalPreviewKey =
    orderBookStatus !== "ready" || hasInsufficientLiquidity
      ? null
      : ensureOrderApprovalPreview(opts, cost, shares, isMarketableBuy);
  const approvalRequirement =
    approvalPreviewKey &&
    panelState.orderApprovalPreview?.key === approvalPreviewKey
      ? panelState.orderApprovalPreview.requiredCollateral
      : cost;
  const isCheckingApprovalRequirement =
    panelState.activeSide === "buy" &&
    cost > 0 &&
    Boolean(approvalPreviewKey) &&
    panelState.orderApprovalPreview?.key !== approvalPreviewKey;
  const needsApproval =
    panelState.activeSide === "buy" &&
    cost > 0 &&
    !isCheckingApprovalRequirement &&
    relevantAllowance < approvalRequirement;
  // Signed without `maxSpend`, so `makerAmount` equals the amount we submit —
  // which is `cost`, the walked book notional on a partial (FAK) fill, not the
  // typed amount. The CLOB's $1 floor applies to that signed amount directly,
  // so the guard must size against it too (a $10 ticket over $0.60 of depth
  // signs a $0.60 order).
  const belowMinNotional =
    isMarketableBuy && cost < MIN_MARKETABLE_BUY_TICKET_USD;
  const positionSize = getPositionSize(opts);
  const sellBalancesLoading =
    panelState.activeSide === "sell" && !panelState.outcomeBalancesLoaded;
  const noPosition =
    panelState.activeSide === "sell" &&
    panelState.outcomeBalancesLoaded &&
    positionSize <= 0;
  const overPosition =
    panelState.activeSide === "sell" &&
    panelState.outcomeBalances &&
    positionSize > 0 &&
    shares > positionSize;

  const btn = el("button", `knoww-tp-submit ${panelState.activeSide}`);
  btn.setAttribute("type", "button");

  if (panelState.orderSettling) {
    setSubmitLoading(btn, [
      "Checking your order...",
      "Confirming the latest order status...",
      "Keeping the order status updated for you...",
    ]);
  } else if (isSubmitting) {
    setSubmitLoading(
      btn,
      state === "approving"
        ? [
            "Approve in your wallet...",
            "Check your wallet for the approval...",
            "Complete the approval when you're ready...",
          ]
        : [
            "Placing your order...",
            "Sending your order to the market...",
            "Checking the order status for you...",
          ]
    );
  } else if (sellBalancesLoading) {
    setSubmitLoading(btn, "Checking your position...");
  } else if (isCheckingApprovalRequirement) {
    setSubmitLoading(btn, "Checking trade approval...");
  } else if (noAmount) {
    btn.textContent = "Enter Amount";
    btn.disabled = true;
  } else if (orderBookStatus === "loading") {
    setSubmitLoading(btn, "Checking live prices for you...");
  } else if (orderBookStatus === "unavailable") {
    btn.textContent = "Order book unavailable";
    btn.disabled = true;
  } else if (noShares) {
    btn.textContent = "Enter Shares";
    btn.disabled = true;
  } else if (noPosition) {
    btn.textContent = "No position to sell";
    btn.disabled = true;
  } else if (overPosition) {
    btn.textContent = `Max ${positionSize.toFixed(1)} shares`;
    btn.disabled = true;
  } else if (hasInsufficientLiquidity) {
    btn.textContent = "Insufficient liquidity";
    btn.disabled = true;
  } else if (belowMinNotional) {
    btn.textContent = `Minimum order: $${MIN_MARKETABLE_BUY_TICKET_USD.toFixed(2)}`;
    btn.disabled = true;
  } else if (belowMinShares) {
    btn.textContent = `Minimum shares: ${minShares}`;
    btn.disabled = true;
  } else if (noFunds) {
    if (ctx.address) {
      btn.textContent = `Deposit $${missingFunds.toFixed(2)} more`;
      btn.classList.add("deposit");
      btn.classList.add("deposit-needed");
    } else {
      btn.textContent = "Insufficient Balance";
      btn.disabled = true;
    }
  } else if (needsApproval) {
    btn.innerHTML = `${I.shield} Approve pUSD`;
    btn.classList.add("approve");
  } else {
    const icon = panelState.activeSide === "buy" ? I.up : I.down;
    if (isMarketBuyAmount) {
      btn.innerHTML = `${icon} BUY ${formatShareQuantity(shares)} for $${new Decimal(cost).toFixed(2)}`;
    } else {
      const modeLabel =
        panelState.orderMode === "limit"
          ? `${((panelState.limitPrice || opts.price) * 100).toFixed(1)}¢`
          : "Market";
      btn.innerHTML = `${icon} ${side} ${formatShareQuantity(shares)} @ ${modeLabel}`;
    }
  }

  btn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (btn.disabled) {
      let reason = "unknown";
      if (panelState.orderSettling) reason = "settling";
      else if (isSubmitting) reason = "submitting";
      else if (sellBalancesLoading) reason = "loading_position";
      else if (isCheckingApprovalRequirement) reason = "checking_allowance";
      else if (noAmount) reason = "no_amount";
      else if (orderBookStatus === "loading") reason = "loading_order_book";
      else if (orderBookStatus === "unavailable")
        reason = "order_book_unavailable";
      else if (noShares) reason = "no_shares";
      else if (noPosition) reason = "no_position";
      else if (overPosition) reason = "over_position";
      else if (hasInsufficientLiquidity) reason = "insufficient_liquidity";
      else if (belowMinNotional) reason = "below_min_notional";
      else if (belowMinShares) reason = "below_min_shares";
      else if (noFunds) reason = "insufficient_balance";
      trackPanelAnalytics("trading_form_submit_blocked", {
        marketId: opts.market.id,
        reason,
        side: panelState.activeSide,
        shares,
      });
      return;
    }
    const panel =
      panelState.activePanel ??
      (btn.closest('[data-knoww-trading="true"]') as HTMLElement | null);
    if (!panel) return;

    if (noFunds && ctx.address) {
      panelState.activeView = "deposit";
      trackPanelAnalytics("trading_insufficient_balance_deposit_clicked", {
        marketId: opts.market.id,
        missingFunds: missingFunds.toNumber(),
      });
      startDepositFlow(ctx.address);
      return;
    }

    if (needsApproval) {
      pauseLivePanelRefresh();
      trackPanelAnalytics("trading_usdc_approve_started", {
        marketId: opts.market.id,
      });
      try {
        await TradingService.approveUsdc(!!opts.negRisk, approvalRequirement);
        trackPanelAnalytics("trading_usdc_approve_succeeded", {
          marketId: opts.market.id,
        });
        showToast(panel, "Approval updated!", "success");
        TradingService.refreshBalance().catch(() => {});
      } catch (err) {
        trackPanelAnalytics("trading_usdc_approve_failed", {
          marketId: opts.market.id,
          error: err instanceof Error ? err.message : "Approval failed",
        });
        showToast(
          panel,
          err instanceof Error ? err.message : "Approval failed",
          "error"
        );
      } finally {
        resumeLivePanelRefresh();
      }
      return;
    }

    let clobOrderType: ClobOrderType;
    let price: number | undefined;
    let expiration: number | undefined;

    if (panelState.orderMode === "market") {
      clobOrderType = getPanelOrderType();
      // Sign the walk's buffered worst price. Sending nothing here reaches the
      // background as `price: 0`, which forwards no bound at all — a market
      // order with unbounded slippage.
      price = getMarketPriceBound(marketSlippage);
    } else {
      price = normalizePrice(panelState.limitPrice || opts.price);
      if (panelState.expirationPreset === "GTC") {
        clobOrderType = "GTC";
      } else {
        clobOrderType = "GTD";
        expiration = getGtdExpirationTimestamp(panelState.expirationPreset);
      }
    }

    // Immediately show loading state on the button before the async call
    setSubmitLoading(btn, [
      "Placing your order...",
      "Sending your order to the market...",
      "Checking the order status for you...",
    ]);
    pauseLivePanelRefresh();

    try {
      let effectiveSize = shares;
      // On a partial fill the walked size *is* the order — snapping it up to
      // the full position would sign more than the ticket quoted.
      if (
        side === "SELL" &&
        positionSize > 0 &&
        !isPartialFill(marketSlippage)
      ) {
        const diff = Math.abs(shares - positionSize);
        if (diff < positionSize * 0.01 || shares >= positionSize) {
          effectiveSize = positionSize;
        }
      }
      trackPanelAnalytics("market_order_submitted", {
        marketId: opts.market.id,
        marketTitle: opts.market.title || "Untitled Market",
        outcomeName: getTrackedOutcomeName(opts),
        side,
        orderType: clobOrderType,
        shares: effectiveSize,
        totalCost: cost,
      });
      await TradingService.placeOrder({
        tokenId: opts.tokenId,
        conditionId: opts.conditionId,
        outcomeIndex: opts.outcomeIndex,
        side,
        price: price ?? 0,
        size: effectiveSize,
        amount: cost,
        orderType: clobOrderType,
        expiration,
        negRisk: opts.negRisk,
        // Forward the same marketability flag the panel preview gated against,
        // so the background's collateral check uses the same builder fee rate
        // (and therefore the same required-collateral) as the preview.
        isMarketableBuy: side === "BUY" ? isMarketableBuy : undefined,
      });

      const isLimitOrder = clobOrderType === "GTC" || clobOrderType === "GTD";

      if (isLimitOrder) {
        trackPanelAnalytics("market_order_succeeded", {
          marketId: opts.market.id,
          marketTitle: opts.market.title || "Untitled Market",
          outcomeName: getTrackedOutcomeName(opts),
          side,
          orderType: clobOrderType,
          shares: effectiveSize,
          totalCost: cost,
        });
        await TradingService.refreshBalance().catch(() => {});
        if (opts.yesTokenId && opts.noTokenId) {
          await TradingService.getOutcomeBalances(
            opts.yesTokenId,
            opts.noTokenId
          )
            .then((b) => {
              panelState.outcomeBalances = b;
              rerender();
            })
            .catch(() => {});
        }
        rerender();
        showToast(panel, "Limit order placed!", "success");
        resumeLivePanelRefresh();
      } else {
        panelState.orderSettling = true;
        rerender();

        const prevBalance = getAvailableTradingCollateral(ctx);
        const prevYes = panelState.outcomeBalances?.yesBalance ?? "0";
        const prevNo = panelState.outcomeBalances?.noBalance ?? "0";
        const POLL_INTERVAL = 3000;
        const TIMEOUT = 30000;
        const PER_POLL_TIMEOUT = 8000;
        const startTime = Date.now();

        const finishSettling = (message: string, type: "success" | "error") => {
          panelState.orderSettling = false;
          if (panelState.settleTimer) {
            clearTimeout(panelState.settleTimer);
            panelState.settleTimer = null;
          }
          if (type === "success") {
            trackPanelAnalytics("market_order_succeeded", {
              marketId: opts.market.id,
              marketTitle: opts.market.title || "Untitled Market",
              outcomeName: getTrackedOutcomeName(opts),
              side,
              orderType: clobOrderType,
              shares: effectiveSize,
              totalCost: cost,
            });
          }
          showToast(panel, message, type);
          rerender();
          resumeLivePanelRefresh();
        };

        const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
          Promise.race([
            p,
            new Promise<null>((r) => setTimeout(() => r(null), ms)),
          ]);

        const poll = async () => {
          if (!panelState.orderSettling) return;

          if (Date.now() - startTime >= TIMEOUT) {
            finishSettling("Order submitted", "success");
            return;
          }

          try {
            await withTimeout(
              TradingService.refreshBalance(),
              PER_POLL_TIMEOUT
            );
            if (opts.yesTokenId && opts.noTokenId) {
              const newBal = await withTimeout(
                TradingService.getOutcomeBalances(
                  opts.yesTokenId,
                  opts.noTokenId
                ),
                PER_POLL_TIMEOUT
              );
              if (newBal) panelState.outcomeBalances = newBal;
            }
          } catch {
            /* ignore poll errors */
          }

          const newCtx = TradingService.getContext();
          const newYes = panelState.outcomeBalances?.yesBalance ?? "0";
          const newNo = panelState.outcomeBalances?.noBalance ?? "0";
          const collateralChanged =
            Math.abs(getAvailableTradingCollateral(newCtx) - prevBalance) >
            0.001;
          const positionChanged =
            balanceChanged(prevYes, newYes) || balanceChanged(prevNo, newNo);

          if (collateralChanged || positionChanged) {
            finishSettling("Order filled!", "success");

            // Show a success overlay
            const overlay = el("div", "knoww-tp-success-overlay");
            overlay.innerHTML = `
              <div class="knoww-tp-success-icon">${I.check}</div>
              <div class="knoww-tp-success-text">Order Placed Successfully</div>
            `;
            panel.appendChild(overlay);

            // Fade out and remove after 1.5s
            setTimeout(() => {
              overlay.style.opacity = "0";
              setTimeout(() => overlay.remove(), 300);
            }, 1500);

            return;
          }

          panelState.settleTimer = setTimeout(poll, POLL_INTERVAL);
        };

        panelState.settleTimer = setTimeout(poll, POLL_INTERVAL);
      }
    } catch (err) {
      panelState.orderSettling = false;
      if (panelState.settleTimer) {
        clearTimeout(panelState.settleTimer);
        panelState.settleTimer = null;
      }
      trackPanelAnalytics("market_order_failed", {
        marketId: opts.market.id,
        marketTitle: opts.market.title || "Untitled Market",
        outcomeName: getTrackedOutcomeName(opts),
        side,
        orderType: clobOrderType,
        shares,
        totalCost: cost,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      showToast(
        panel,
        err instanceof Error ? err.message : "Order failed",
        "error"
      );
      rerender();
      resumeLivePanelRefresh();
    }
  };

  form.appendChild(btn);
}

// ── Order Form (Buy / Sell) ──

export function renderOrderForm(
  p: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  const form = el("div", "knoww-tp-form");

  addOrderTypeRow(form, opts);
  addBuySellToggle(form);
  addOutcomeToggle(form, opts);
  addLimitPrice(form, opts, ctx);
  addSlippageInfo(form, opts, ctx);
  addAmountSection(form, opts, ctx);
  addPartialFillToggle(form, opts);

  const dynamic = el("div", "knoww-tp-dynamic");
  addOrderSummary(dynamic, opts, ctx);
  addBalanceWarning(dynamic, opts, ctx);
  addSubmitButton(dynamic, opts, ctx);
  form.appendChild(dynamic);

  form.appendChild(
    el(
      "div",
      "knoww-tp-terms",
      "By placing an order, you agree to the terms of service."
    )
  );

  p.appendChild(form);
}
