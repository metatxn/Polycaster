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

import { USDC_E_ADDRESS } from "@knoww/shared-types/contracts";
import { POLYGON_CHAIN_ID_HEX } from "@knoww/shared-types/polymarket";
import { calculateSlippage, roundToTick } from "@knoww/shared-types/slippage";
import type { ClobOrderType } from "../../types/chrome-messages";
import type { Market } from "../../types/market";
import { escapeHtml } from "../utils";
import { getNonce, WalletBridge } from "./bridge";
import {
  CHAIN_METADATA,
  createDepositAddresses,
  type DepositAddress,
  type DepositTransaction,
  fetchDepositStatus,
  fetchQuote,
  fetchSupportedAssets,
  formatCheckoutTime,
  getDefaultMinDeposit,
  getDepositStatusDisplay,
  getMinDepositForToken,
  type QuoteResponse,
  type SupportedAsset,
} from "./bridge-api";
import { CredentialManager } from "./credentials";
import { type TradingContext, TradingService } from "./trading-service";

const DEPOSIT_TOKENS: Array<{
  symbol: string;
  address: string;
  decimals: number;
}> = [
  { symbol: "USDC.e", address: USDC_E_ADDRESS, decimals: 6 },
  {
    symbol: "USDC",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
  {
    symbol: "USDT",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    decimals: 6,
  },
  {
    symbol: "DAI",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    decimals: 18,
  },
  {
    symbol: "WETH",
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    decimals: 18,
  },
];
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

// ── Types ──

interface PanelOptions {
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
}

type OrderMode = "market" | "limit";
type TradeSide = "buy" | "sell";
type ActiveView = "order" | "split" | "merge" | "deposit";
type ExpirationPreset = "GTC" | "1h" | "4h" | "24h" | "7d" | "30d";

interface DepositToken {
  symbol: string;
  amount: number;
  usdValue: number;
  address: string;
  decimals: number;
}

type DepositStep = "method" | "token" | "bridge-select" | "amount" | "confirm";
type DepositMethod = "wallet" | "bridge";

type DepositState =
  | "idle"
  | "loading-balances"
  | "loading-bridge"
  | "ready"
  | "pending"
  | "confirming"
  | "success"
  | "error";

// ── Module State ──

let activePanel: HTMLElement | null = null;
let panelOpts: PanelOptions | null = null;
let activeUnsubscribe: (() => void) | null = null;

let activeSide: TradeSide = "buy";
let activeView: ActiveView = "order";
let orderMode: OrderMode = "market";
let selectedShares = 10;
let limitPrice = 0;
let expirationPreset: ExpirationPreset = "GTC";
let splitMergeAmount = 0;
let outcomeBalances: {
  yesBalance: number;
  noBalance: number;
  minBalance: number;
} | null = null;
let outcomeBalancesLoaded = false;
let outcomeBalancesFetching = false;
let moreMenuOpen = false;

let orderSettling = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

let depositState: DepositState = "idle";
let depositStep: DepositStep = "method";
let depositMethod: DepositMethod | null = null;
let depositTokens: DepositToken[] = [];
let depositSelected: DepositToken | null = null;
let depositAmount = "";
let depositError: string | null = null;
let depositBridgeAddress = "";
let depositBridgeAssets: SupportedAsset[] = [];
let depositSelectedBridgeAsset: SupportedAsset | null = null;
let depositBridgeSearchQuery = "";
let depositQuote: QuoteResponse | null = null;
let depositIsLoadingQuote = false;
let depositTransactions: DepositTransaction[] = [];
let depositAddressesCache: DepositAddress[] = [];
let depositIsPending = false;
let depositIsConfirming = false;
let depositIsConfirmed = false;
let depositTxConfirmed = false;
let depositStatusPollTimer: ReturnType<typeof setTimeout> | null = null;

let selectedOutcome: "yes" | "no" = "yes";
let yesPrice = 0;

let sessionRestoreAttempted = false;

const MIN_MARKETABLE_BUY_NOTIONAL_USD = 1;

function getTickSize(): number {
  return TradingService.getContext().tickSize || 0.01;
}

function normalizePrice(price: number, tick?: number): number {
  const t = tick ?? getTickSize();
  const rounded = roundToTick(price, t);
  return Math.max(t, Math.min(1 - t, Number(rounded.toFixed(4))));
}

const EXPIRATION_MAP: Record<ExpirationPreset, number> = {
  GTC: 0,
  "1h": 3600,
  "4h": 14400,
  "24h": 86400,
  "7d": 604800,
  "30d": 2592000,
};

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
  alert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  wallet: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 7h-1V6a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-8a3 3 0 0 0-3-3ZM5 5h10a1 1 0 0 1 1 1v1H5a1 1 0 0 1 0-2Zm15 11h-2a2 2 0 0 1 0-4h2Z"/></svg>`,
  shield: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3Zm-1 14.5v-2h2v2h-2Zm0-4v-6h2v6h-2Z"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`,
  error: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
  back: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  refresh: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
};

// ── DOM Helpers ──

function truncAddr(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

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
    "svg",
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
        name === "style" ||
        name === "srcdoc" ||
        ((name === "src" || name === "href" || name === "xlink:href") &&
          /^\s*(javascript|data):/i.test(value))
      ) {
        node.removeAttribute(attr.name);
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
  if (activePanel && panelOpts)
    render(activePanel, panelOpts, TradingService.getContext());
}

function getEffectivePrice(opts: PanelOptions): number {
  return orderMode === "limit" ? limitPrice || opts.price : opts.price;
}

function getCost(opts: PanelOptions): number {
  const price = getEffectivePrice(opts);
  if (activeSide === "buy") return price * selectedShares;
  const sellPrice = 1 - price;
  return sellPrice * selectedShares;
}

function refreshDynamicUI(): void {
  if (!activePanel || !panelOpts) return;
  const ctx = TradingService.getContext();
  const opts = panelOpts;
  const cost = getCost(opts);

  const form = activePanel.querySelector(".knoww-tp-form");
  if (!form) return;

  const costDisp = form.querySelector(".knoww-tp-cost-display");
  if (costDisp) costDisp.textContent = `$${cost.toFixed(2)}`;

  const sharesInput = form.querySelector(
    ".knoww-tp-shares-input"
  ) as HTMLInputElement | null;
  if (sharesInput && document.activeElement !== sharesInput) {
    sharesInput.value = String(selectedShares);
  }

  const limitInput = form.querySelector(
    ".knoww-tp-price-field"
  ) as HTMLInputElement | null;
  if (limitInput && document.activeElement !== limitInput) {
    limitInput.value = String(Math.round((limitPrice || opts.price) * 100));
  }

  // Update order position indicator
  const posIndicator = form.querySelector(".knoww-tp-order-position");
  if (posIndicator) {
    const { bestBid, bestAsk } = getBestBidAsk(ctx);
    if (bestBid !== undefined || bestAsk !== undefined) {
      const currentPrice = limitPrice || opts.price;
      const info = getOrderPositionInfo(currentPrice, bestBid, bestAsk);
      posIndicator.textContent = info.label;
      posIndicator.className = `knoww-tp-order-position ${info.cls}`;
    } else if (!ctx.orderBook) {
      posIndicator.textContent = "Loading order book...";
      posIndicator.className = "knoww-tp-order-position muted";
    } else {
      posIndicator.textContent = "Order book is empty";
      posIndicator.className = "knoww-tp-order-position muted";
    }
  }

  const oldDynamic = form.querySelector(".knoww-tp-dynamic");
  const dynamic = el("div", "knoww-tp-dynamic");
  addOrderSummary(dynamic, opts, ctx);
  addBalanceWarning(dynamic, ctx.balance);
  addSubmitButton(dynamic, opts, ctx);
  if (oldDynamic) {
    oldDynamic.replaceWith(dynamic);
  }
}

function refreshSplitMergeState(
  opts: PanelOptions,
  {
    refreshWallet = true,
    refreshOutcomeBalances = false,
    resetOutcomeBalances = false,
  }: {
    refreshWallet?: boolean;
    refreshOutcomeBalances?: boolean;
    resetOutcomeBalances?: boolean;
  } = {}
): void {
  if (refreshWallet) {
    TradingService.refreshBalance().catch(() => {});
  }

  if (!refreshOutcomeBalances || !opts.yesTokenId || !opts.noTokenId) {
    return;
  }

  if (resetOutcomeBalances) {
    outcomeBalances = null;
    outcomeBalancesLoaded = false;
    rerender();
  }

  if (outcomeBalancesFetching) {
    return;
  }

  outcomeBalancesFetching = true;
  TradingService.getOutcomeBalances(opts.yesTokenId, opts.noTokenId)
    .then((balances) => {
      outcomeBalances = balances;
      outcomeBalancesLoaded = true;
    })
    .catch(() => {
      outcomeBalancesLoaded = true;
    })
    .finally(() => {
      outcomeBalancesFetching = false;
      rerender();
    });
}

// ── Panel Lifecycle ──

function createPanel(opts: PanelOptions): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "knoww-trading-panel";
  panel.setAttribute("data-knoww-trading", "true");
  panel.addEventListener("click", (e) => e.stopPropagation());

  panelOpts = opts;
  activeSide = opts.side === "SELL" ? "sell" : "buy";
  activeView = "order";
  orderMode = "market";
  selectedShares = 10;
  limitPrice = normalizePrice(opts.price);
  expirationPreset = "GTC";
  splitMergeAmount = 0;
  outcomeBalances = null;
  outcomeBalancesLoaded = false;
  outcomeBalancesFetching = false;
  moreMenuOpen = false;
  depositState = "idle";
  depositTokens = [];
  depositSelected = null;
  depositAmount = "";
  depositError = null;

  if (opts.isMultiOutcome) {
    selectedOutcome = "yes";
    yesPrice = opts.price;
    opts.outcomeIndex = 0;
  } else {
    selectedOutcome = opts.outcomeIndex === 1 ? "no" : "yes";
    yesPrice = opts.outcomeIndex === 0 ? opts.price : 1 - opts.price;
  }

  const currentCtx = TradingService.getContext();
  if (
    currentCtx.address &&
    !currentCtx.credentials &&
    (currentCtx.state === "error" ||
      currentCtx.state === "deriving-credentials")
  ) {
    TradingService.resetToConnected();
  }

  render(panel, opts, TradingService.getContext());

  const unsub = TradingService.onStateChange((ctx) => {
    if (
      opts.yesTokenId &&
      opts.noTokenId &&
      ctx.proxyAddress &&
      !outcomeBalancesLoaded &&
      !outcomeBalancesFetching
    ) {
      refreshSplitMergeState(opts, {
        refreshWallet: false,
        refreshOutcomeBalances: true,
      });
    }
    render(panel, opts, ctx);
  });
  activeUnsubscribe = unsub;

  WalletBridge.init();

  // Pre-warm offscreen document so it's ready when the user places a trade
  chrome.runtime
    .sendMessage({ type: "trading:prewarm-offscreen" })
    .catch(() => {});

  if (!TradingService.getContext().address && !sessionRestoreAttempted) {
    sessionRestoreAttempted = true;
    WalletBridge.getAccounts()
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
    refreshSplitMergeState(opts, {
      refreshWallet: false,
      refreshOutcomeBalances: true,
    });
  } else if (!opts.yesTokenId || !opts.noTokenId) {
    outcomeBalancesLoaded = true;
  }

  const closeMenu = () => {
    if (moreMenuOpen) {
      moreMenuOpen = false;
      rerender();
    }
  };
  document.addEventListener("click", closeMenu);
  const origUnsub = activeUnsubscribe;
  activeUnsubscribe = () => {
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

    const balText = `$${formatTokenAmount(ctx.balance)}`;
    const bal = el(
      "span",
      `knoww-tp-header-bal${ctx.balance < 1 ? " low" : ""}`,
      balText
    );
    walletPill.appendChild(bal);

    right.appendChild(walletPill);

    const depositBtn = el("button", "knoww-tp-header-deposit", "Deposit");
    depositBtn.onclick = (e) => {
      e.stopPropagation();
      activeView = "deposit";
      startDepositFlow(address);
    };
    right.appendChild(depositBtn);

    const refreshBtn = elHtml("button", "knoww-tp-header-action", I.refresh);
    refreshBtn.title = "Refresh balance";
    refreshBtn.onclick = (e) => {
      e.stopPropagation();
      refreshBtn.classList.add("spinning");
      TradingService.refreshBalance()
        .then(() => {
          if (panelOpts?.yesTokenId && panelOpts?.noTokenId) {
            return TradingService.getOutcomeBalances(
              panelOpts.yesTokenId,
              panelOpts.noTokenId
            ).then((b) => {
              outcomeBalances = b;
              outcomeBalancesLoaded = true;
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

    const dcBtn = elHtml("button", "knoww-tp-header-action", I.disconnect);
    dcBtn.title = "Disconnect wallet";
    dcBtn.onclick = (e) => {
      e.stopPropagation();
      TradingService.reset();
      CredentialManager.clear(address).catch(() => {});
    };
    right.appendChild(dcBtn);
  }

  const closeBtn = elHtml("button", "knoww-tp-close", I.close);
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    TradingPanel.hide();
  };
  right.appendChild(closeBtn);

  h.appendChild(right);
  p.appendChild(h);
}

function switchOutcome(side: "yes" | "no"): void {
  if (!panelOpts || side === selectedOutcome) return;
  if (!panelOpts.yesTokenId || !panelOpts.noTokenId) return;

  selectedOutcome = side;
  const noPrice = 1 - yesPrice;

  if (side === "yes") {
    panelOpts.tokenId = panelOpts.yesTokenId;
    panelOpts.price = yesPrice;
    panelOpts.outcomeIndex = 0;
  } else {
    panelOpts.tokenId = panelOpts.noTokenId;
    panelOpts.price = noPrice;
    panelOpts.outcomeIndex = 1;
  }

  limitPrice = normalizePrice(panelOpts.price);
  TradingService.fetchOrderBook(panelOpts.tokenId);
  rerender();
}

function addOutcomeToggle(p: HTMLElement, opts: PanelOptions): void {
  if (!opts.yesTokenId || !opts.noTokenId) return;

  const noPrice = 1 - yesPrice;
  const yesCtx = Math.round(yesPrice * 100);
  const noCtx = Math.round(noPrice * 100);

  const row = el("div", "knoww-tp-outcome-toggle");

  const yesBtn = el(
    "button",
    `knoww-tp-outcome-btn yes${selectedOutcome === "yes" ? " active" : ""}`
  );
  yesBtn.innerHTML = `<span class="knoww-tp-outcome-label">Yes</span><span class="knoww-tp-outcome-price">${yesCtx}¢</span>`;
  yesBtn.onclick = (e) => {
    e.stopPropagation();
    switchOutcome("yes");
  };

  const noBtn = el(
    "button",
    `knoww-tp-outcome-btn no${selectedOutcome === "no" ? " active" : ""}`
  );
  noBtn.innerHTML = `<span class="knoww-tp-outcome-label">No</span><span class="knoww-tp-outcome-price">${noCtx}¢</span>`;
  noBtn.onclick = (e) => {
    e.stopPropagation();
    switchOutcome("no");
  };

  row.appendChild(yesBtn);
  row.appendChild(noBtn);
  p.appendChild(row);
}

function formatTokenAmount(amount: number): string {
  if (amount <= 0) return "0.00";
  if (amount < 0.01) return "<0.01";
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(2);
}

function addPortfolioBar(
  p: HTMLElement,
  _ctx: TradingContext,
  opts: PanelOptions
): void {
  const yesPos = outcomeBalances?.yesBalance ?? 0;
  const noPos = outcomeBalances?.noBalance ?? 0;
  const POS_THRESHOLD = 0.01;
  const showYes = yesPos >= POS_THRESHOLD;
  const showNo = noPos >= POS_THRESHOLD;

  if (!showYes && !showNo) return;

  const yesPrice = opts.outcomeIndex === 0 ? opts.price : 1 - opts.price;
  const noPrice = 1 - yesPrice;
  const yesValue = yesPos * yesPrice;
  const noValue = noPos * noPrice;

  const yesLabel = opts.outcomeIndex === 0 ? opts.outcomeName : "Yes";
  const noLabel = opts.outcomeIndex === 0 ? "No" : opts.outcomeName;

  const portfolio = el("div", "knoww-tp-portfolio-bar");

  if (showYes) {
    const yRow = el("div", "knoww-tp-portfolio-row");
    yRow.appendChild(el("span", "knoww-tp-portfolio-label", `${yesLabel}`));
    yRow.appendChild(
      el(
        "span",
        "knoww-tp-portfolio-value positive",
        `${yesPos.toFixed(1)} @ $${yesPrice.toFixed(2)} · $${yesValue.toFixed(2)}`
      )
    );
    portfolio.appendChild(yRow);
  }
  if (showNo) {
    const nRow = el("div", "knoww-tp-portfolio-row");
    nRow.appendChild(el("span", "knoww-tp-portfolio-label", `${noLabel}`));
    nRow.appendChild(
      el(
        "span",
        "knoww-tp-portfolio-value positive",
        `${noPos.toFixed(1)} @ $${noPrice.toFixed(2)} · $${noValue.toFixed(2)}`
      )
    );
    portfolio.appendChild(nRow);
  }

  p.appendChild(portfolio);
}

let disconnectedUnsub: (() => void) | null = null;

function addDisconnected(p: HTMLElement): void {
  if (disconnectedUnsub) {
    disconnectedUnsub();
    disconnectedUnsub = null;
  }

  const existing = p.querySelector(".knoww-tp-connect-section");
  if (existing) existing.remove();

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
        TradingService.connectWallet(w.uuid);
      };
      list.appendChild(item);
    }
    s.appendChild(list);
  } else {
    const btn = elHtml(
      "button",
      "knoww-tp-btn-connect",
      `${I.wallet} Connect Wallet`
    );
    btn.onclick = (e) => {
      e.stopPropagation();
      setButtonLoading(btn, "Connecting…");

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
  }

  disconnectedUnsub = WalletBridge.onWalletsChanged((newWallets) => {
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

function addEnableTrading(p: HTMLElement): void {
  const s = el("div", "knoww-tp-enable-section");
  s.appendChild(elHtml("div", "knoww-tp-shield-icon", I.shield));
  s.appendChild(
    el(
      "div",
      "knoww-tp-enable-msg",
      "Sign a message to enable trading on Polymarket"
    )
  );
  const btn = el("button", "knoww-tp-btn-enable", "Enable Trading");
  btn.onclick = (e) => {
    e.stopPropagation();
    setButtonLoading(btn, "Waiting for signature…");
    TradingService.deriveCredentials();
  };
  s.appendChild(btn);
  p.appendChild(s);
}

// ── Order Type Toggle + More Menu ──

function addOrderTypeRow(form: HTMLElement, opts: PanelOptions): void {
  const row = el("div", "knoww-tp-ordertype-row");

  const toggle = el("div", "knoww-tp-ordertype-toggle");
  const mBtn = elHtml(
    "button",
    `knoww-tp-ordertype-btn${orderMode === "market" ? " active" : ""}`,
    `${I.zap} Market`
  );
  mBtn.onclick = (e) => {
    e.stopPropagation();
    orderMode = "market";
    moreMenuOpen = false;
    rerender();
  };
  const lBtn = el(
    "button",
    `knoww-tp-ordertype-btn${orderMode === "limit" ? " active" : ""}`,
    "Limit"
  );
  lBtn.onclick = (e) => {
    e.stopPropagation();
    orderMode = "limit";
    moreMenuOpen = false;
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
      `knoww-tp-more-btn${moreMenuOpen ? " active" : ""}`,
      I.more
    );
    moreBtn.title = "More options";
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      moreMenuOpen = !moreMenuOpen;
      rerender();
    };
    wrap.appendChild(moreBtn);

    if (moreMenuOpen) {
      const menu = el("div", "knoww-tp-more-menu");
      const splitBtn = elHtml(
        "button",
        "knoww-tp-more-item",
        `${I.split} Split <span class="knoww-tp-tooltip-icon" title="Convert 1 USDC into 1 Yes and 1 No share">(?)</span>`
      );
      splitBtn.onclick = (e) => {
        e.stopPropagation();
        moreMenuOpen = false;
        activeView = "split";
        splitMergeAmount = 0;
        refreshSplitMergeState(opts, { refreshWallet: true });
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
        moreMenuOpen = false;
        activeView = "merge";
        splitMergeAmount = 0;
        refreshSplitMergeState(opts, {
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
    `knoww-tp-buysell-btn buy${activeSide === "buy" ? " active" : ""}`,
    `${I.up} Buy`
  );
  buyBtn.onclick = (e) => {
    e.stopPropagation();
    activeSide = "buy";
    rerender();
  };
  const sellBtn = elHtml(
    "button",
    `knoww-tp-buysell-btn sell${activeSide === "sell" ? " active" : ""}`,
    `${I.down} Sell`
  );
  sellBtn.onclick = (e) => {
    e.stopPropagation();
    activeSide = "sell";
    if (panelOpts) {
      const pos = getPositionSize(panelOpts);
      if (pos > 0) selectedShares = pos;
    }
    rerender();
  };
  toggle.appendChild(buyBtn);
  toggle.appendChild(sellBtn);
  form.appendChild(toggle);
}

// ── Limit Price Input with +/- Steppers ──

function getBestBidAsk(ctx: TradingContext): {
  bestBid: number | undefined;
  bestAsk: number | undefined;
} {
  const ob = ctx.orderBook;
  if (!ob) return { bestBid: undefined, bestAsk: undefined };

  let bestBid: number | undefined;
  if (ob.bids?.length) {
    const parsed = ob.bids
      .map((l) => parseFloat(l.price))
      .filter((p) => Number.isFinite(p) && p > 0);
    if (parsed.length > 0) bestBid = Math.max(...parsed);
  }

  let bestAsk: number | undefined;
  if (ob.asks?.length) {
    const parsed = ob.asks
      .map((l) => parseFloat(l.price))
      .filter((p) => Number.isFinite(p) && p > 0);
    if (parsed.length > 0) bestAsk = Math.min(...parsed);
  }

  return { bestBid, bestAsk };
}

function getOrderPositionInfo(
  price: number,
  bestBid: number | undefined,
  bestAsk: number | undefined
): { label: string; cls: string } {
  if (activeSide === "buy") {
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
  if (orderMode !== "limit") return;

  const { bestBid, bestAsk } = getBestBidAsk(ctx);
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
      limitPrice = normalizePrice(bestBid, tickSize);
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
      limitPrice = normalizePrice(bestAsk, tickSize);
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
    limitPrice = normalizePrice(
      (limitPrice || opts.price) - tickSize,
      tickSize
    );
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
  const displayPrice = normalizePrice(limitPrice || opts.price, tickSize);
  input.value =
    tickSize < 0.01
      ? (displayPrice * 100).toFixed(2)
      : (displayPrice * 100).toFixed(1);
  input.oninput = () => {
    const v = parseFloat(input.value);
    if (v >= 1 && v <= 99) {
      limitPrice = v / 100;
      refreshDynamicUI();
    }
  };
  input.onblur = () => {
    limitPrice = normalizePrice(limitPrice, tickSize);
    const centsDisplay =
      tickSize < 0.01
        ? (limitPrice * 100).toFixed(2)
        : (limitPrice * 100).toFixed(1);
    input.value = centsDisplay;
    refreshDynamicUI();
  };
  wrap.appendChild(input);
  wrap.appendChild(el("span", "knoww-tp-price-cent", "¢"));

  const plus = el("button", "knoww-tp-price-btn", "+");
  plus.onclick = (e) => {
    e.stopPropagation();
    limitPrice = normalizePrice(
      (limitPrice || opts.price) + tickSize,
      tickSize
    );
    rerender();
  };

  controls.appendChild(minus);
  controls.appendChild(wrap);
  controls.appendChild(plus);
  section.appendChild(controls);

  // Order position indicator (updated live by refreshDynamicUI)
  if (bestBid !== undefined || bestAsk !== undefined) {
    const currentPrice = limitPrice || opts.price;
    const info = getOrderPositionInfo(currentPrice, bestBid, bestAsk);
    section.appendChild(
      el("div", `knoww-tp-order-position ${info.cls}`, info.label)
    );
  } else {
    section.appendChild(
      el("div", "knoww-tp-order-position muted", "Loading order book...")
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
  const presets: ExpirationPreset[] = ["GTC", "1h", "4h", "24h", "7d", "30d"];
  for (const p of presets) {
    const btn = el(
      "button",
      `knoww-tp-exp-btn${expirationPreset === p ? " active" : ""}`,
      p
    );
    btn.onclick = (e) => {
      e.stopPropagation();
      expirationPreset = p;
      rerender();
    };
    expRow.appendChild(btn);
  }
  expBlock.appendChild(expRow);
  expBlock.appendChild(
    el(
      "div",
      "knoww-tp-exp-info",
      expirationPreset === "GTC"
        ? "Order remains active until filled or cancelled"
        : `Expires in ${expirationPreset} if not filled`
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
  if (orderMode !== "market" || !ctx.orderBook || selectedShares <= 0) return;

  const side = activeSide === "sell" ? "SELL" : "BUY";
  const slip = calculateSlippage(ctx.orderBook, side, selectedShares);
  if (slip.fills.length === 0) return;

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

// ── Amount Section ──

function addAmountSection(
  form: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  const section = el("div", "knoww-tp-amount-section");
  const effectivePrice = getEffectivePrice(opts);
  const isSell = activeSide === "sell";
  const positionSize = getPositionSize(opts);
  const cost = getCost(opts);
  const minShares = isSell ? 1 : Math.max(1, Math.ceil(ctx.minOrderSize));

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
  if (selectedShares - 10 < minShares) m10.disabled = true;
  sharesRow.appendChild(m10);

  const m1 = el("button", "knoww-tp-shares-btn", "-1");
  m1.onclick = (e) => {
    e.stopPropagation();
    adjustShares(-1, minShares);
  };
  if (selectedShares - 1 < minShares) m1.disabled = true;
  sharesRow.appendChild(m1);

  const sharesInput = document.createElement("input");
  sharesInput.className = "knoww-tp-shares-input";
  sharesInput.type = "number";
  sharesInput.min = String(minShares);
  sharesInput.step = isSell ? "0.01" : "1";
  sharesInput.value = String(selectedShares);
  sharesInput.oninput = () => {
    const v = Number(sharesInput.value);
    if (!Number.isNaN(v) && v > 0) {
      let capped = Math.max(isSell ? 0.01 : minShares, v);
      if (isSell && positionSize > 0) capped = Math.min(capped, positionSize);
      selectedShares = capped;
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
      selectedShares = positionSize;
    } else if (!isSell && ctx.balance > 0 && effectivePrice > 0) {
      selectedShares = Math.max(
        minShares,
        Math.floor(ctx.balance / effectivePrice)
      );
    }
    rerender();
  };
  if ((isSell && positionSize <= 0) || (!isSell && ctx.balance <= 0)) {
    maxBtn.disabled = true;
  }
  sharesRow.appendChild(maxBtn);

  section.appendChild(sharesRow);

  form.appendChild(section);
}

function getPositionSize(opts: PanelOptions): number {
  if (!outcomeBalances) return 0;
  if (opts.outcomeIndex === 0) return outcomeBalances.yesBalance;
  return outcomeBalances.noBalance;
}

function adjustShares(delta: number, minShares: number): void {
  let next = Math.max(minShares, selectedShares + delta);
  if (activeSide === "sell" && panelOpts) {
    const pos = getPositionSize(panelOpts);
    if (pos > 0) next = Math.min(next, pos);
  }
  selectedShares = next;
  rerender();
}

// ── Order Summary ──

function addOrderSummary(
  form: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  const isBuy = activeSide === "buy";
  const effectivePrice = getEffectivePrice(opts);
  const shares = selectedShares;
  const cost = getCost(opts);
  const minShares = Math.max(1, Math.ceil(ctx.minOrderSize));
  const positionSize = getPositionSize(opts);

  const summary = el("div", "knoww-tp-summary");

  // Portfolio position
  if (outcomeBalances) {
    const posRow = el("div", "knoww-tp-summary-row");
    posRow.appendChild(
      el("span", "knoww-tp-summary-label", `Your ${opts.outcomeName} position`)
    );
    const posVal =
      positionSize > 0
        ? `${positionSize.toFixed(2)} shares ($${(positionSize * effectivePrice).toFixed(2)})`
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

  // Total Cost (buy) or You Receive (sell)
  const r1 = el("div", "knoww-tp-summary-row");
  r1.appendChild(
    el("span", "knoww-tp-summary-label", isBuy ? "Total Cost" : "You Receive")
  );
  r1.appendChild(
    el(
      "span",
      `knoww-tp-summary-value lg${!isBuy ? " positive" : ""}`,
      `$${cost.toFixed(2)}`
    )
  );
  summary.appendChild(r1);

  if (isBuy && shares > 0 && shares < minShares) {
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
    // Potential Return = shares (each share pays $1 if outcome wins)
    const potentialReturn = shares;
    const r3 = el("div", "knoww-tp-summary-row");
    r3.appendChild(el("span", "knoww-tp-summary-label", "Potential Return"));
    r3.appendChild(
      el(
        "span",
        "knoww-tp-summary-value positive lg",
        `$${potentialReturn.toFixed(2)}`
      )
    );
    summary.appendChild(r3);

    // Profit = potential return - cost
    const profit = potentialReturn - cost;
    const pct = cost > 0 ? (profit / cost) * 100 : 0;
    const r4 = el("div", "knoww-tp-summary-row");
    r4.appendChild(
      el("span", "knoww-tp-summary-label", `Profit if ${opts.outcomeName}`)
    );
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

function addBalanceWarning(form: HTMLElement, balance: number): void {
  if (!panelOpts || activeSide === "sell") return;
  const cost = getCost(panelOpts);
  if (cost <= balance || balance < 0) return;

  const w = el("div", "knoww-tp-balance-warn");

  const top = el("div", "knoww-tp-warn-top");
  const left = el("div", "knoww-tp-warn-left");
  left.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
  left.appendChild(
    el(
      "span",
      "knoww-tp-warn-text",
      `Need $${(cost - balance).toFixed(2)} more`
    )
  );
  top.appendChild(left);
  const ctx = TradingService.getContext();
  if (ctx.address) {
    const addr = ctx.address;
    const depBtn = el("button", "knoww-tp-warn-deposit-btn", "Deposit");
    depBtn.onclick = (e) => {
      e.stopPropagation();
      activeView = "deposit";
      startDepositFlow(addr);
    };
    top.appendChild(depBtn);
  }
  w.appendChild(top);

  const progress = Math.min(100, (balance / cost) * 100);
  const barBg = el("div", "knoww-tp-warn-bar-bg");
  const barFill = el("div", "knoww-tp-warn-bar-fill");
  barFill.style.width = `${progress}%`;
  barBg.appendChild(barFill);
  w.appendChild(barBg);

  w.appendChild(
    el(
      "div",
      "knoww-tp-warn-detail",
      `$${balance.toFixed(2)} / $${cost.toFixed(2)} USDC.e`
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
  const side = activeSide === "sell" ? "SELL" : "BUY";
  const { balance, state, minOrderSize, usdcAllowance, usdcAllowanceNegRisk } =
    ctx;
  const isSubmitting = state === "placing-order" || state === "approving";
  const cost = getCost(opts);
  const noFunds = activeSide === "buy" && cost > balance;
  const noShares = selectedShares <= 0;
  const shares = selectedShares;
  const minShares = Math.max(1, Math.ceil(minOrderSize));
  const belowMinShares = activeSide === "buy" && shares < minShares;
  const relevantAllowance = opts.negRisk ? usdcAllowanceNegRisk : usdcAllowance;
  const needsApproval =
    activeSide === "buy" && cost > 0 && relevantAllowance < cost;
  const { bestAsk } = getBestBidAsk(ctx);
  const isMarketableBuy =
    activeSide === "buy" &&
    (orderMode === "market" ||
      (orderMode === "limit" &&
        bestAsk !== undefined &&
        limitPrice >= bestAsk));
  const belowMinNotional =
    isMarketableBuy && cost < MIN_MARKETABLE_BUY_NOTIONAL_USD;
  const positionSize = getPositionSize(opts);
  const sellBalancesLoading = activeSide === "sell" && !outcomeBalancesLoaded;
  const noPosition =
    activeSide === "sell" && outcomeBalancesLoaded && positionSize <= 0;
  const overPosition =
    activeSide === "sell" &&
    outcomeBalances &&
    positionSize > 0 &&
    shares > positionSize;

  const btn = el("button", `knoww-tp-submit ${activeSide}`);

  if (orderSettling) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Settling...`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (isSubmitting) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> ${state === "approving" ? "Approving..." : "Placing Order..."}`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (sellBalancesLoading) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Loading position...`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (noShares) {
    btn.textContent = "Enter Shares";
    btn.disabled = true;
  } else if (noPosition) {
    btn.textContent = "No position to sell";
    btn.disabled = true;
  } else if (overPosition) {
    btn.textContent = `Max ${positionSize.toFixed(1)} shares`;
    btn.disabled = true;
  } else if (belowMinNotional) {
    btn.textContent = `Minimum order: $${MIN_MARKETABLE_BUY_NOTIONAL_USD}`;
    btn.disabled = true;
  } else if (belowMinShares) {
    btn.textContent = `Minimum shares: ${minShares}`;
    btn.disabled = true;
  } else if (noFunds) {
    btn.textContent = "Insufficient Balance";
    btn.disabled = true;
  } else if (needsApproval) {
    btn.innerHTML = `${I.shield} Approve USDC`;
    btn.classList.add("approve");
  } else {
    const icon = activeSide === "buy" ? I.up : I.down;
    const modeLabel =
      orderMode === "limit"
        ? `${((limitPrice || opts.price) * 100).toFixed(1)}¢`
        : "Market";
    btn.innerHTML = `${icon} ${side} ${shares} @ ${modeLabel}`;
  }

  btn.onclick = async (e) => {
    e.stopPropagation();
    if (btn.disabled || !activePanel) return;
    const panel = activePanel;

    if (needsApproval) {
      try {
        await TradingService.approveUsdc(!!opts.negRisk);
        showToast(panel, "USDC approved!", "success");
        TradingService.refreshBalance().catch(() => {});
      } catch (err) {
        showToast(
          panel,
          err instanceof Error ? err.message : "Approval failed",
          "error"
        );
      }
      return;
    }

    let clobOrderType: ClobOrderType;
    let price: number | undefined;
    let expiration: number | undefined;

    if (orderMode === "market") {
      clobOrderType = "FAK";
      price = undefined;
    } else {
      price = normalizePrice(limitPrice || opts.price);
      if (expirationPreset === "GTC") {
        clobOrderType = "GTC";
      } else {
        clobOrderType = "GTD";
        expiration =
          Math.floor(Date.now() / 1000) + EXPIRATION_MAP[expirationPreset] + 60;
      }
    }

    // Immediately show loading state on the button before the async call
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Placing Order...`;
    btn.disabled = true;
    btn.classList.add("loading");

    try {
      let effectiveSize = shares;
      if (side === "SELL" && positionSize > 0) {
        const diff = Math.abs(shares - positionSize);
        if (diff < positionSize * 0.01 || shares >= positionSize) {
          effectiveSize = positionSize;
        }
      }
      await TradingService.placeOrder({
        tokenId: opts.tokenId,
        outcomeIndex: opts.outcomeIndex,
        side,
        price: price ?? 0,
        size: effectiveSize,
        amount: cost,
        orderType: clobOrderType,
        expiration,
        negRisk: opts.negRisk,
      });

      const isLimitOrder = clobOrderType === "GTC" || clobOrderType === "GTD";

      if (isLimitOrder) {
        showToast(panel, "Limit order placed!", "success");
        TradingService.refreshBalance().catch(() => {});
        if (opts.yesTokenId && opts.noTokenId) {
          TradingService.getOutcomeBalances(opts.yesTokenId, opts.noTokenId)
            .then((b) => {
              outcomeBalances = b;
              rerender();
            })
            .catch(() => {});
        }
        rerender();
      } else {
        orderSettling = true;
        rerender();

        const prevBalance = ctx.balance;
        const prevYes = outcomeBalances?.yesBalance ?? 0;
        const prevNo = outcomeBalances?.noBalance ?? 0;
        const POLL_INTERVAL = 3000;
        const TIMEOUT = 30000;
        const PER_POLL_TIMEOUT = 8000;
        const startTime = Date.now();

        const finishSettling = (message: string, type: "success" | "error") => {
          orderSettling = false;
          if (settleTimer) {
            clearTimeout(settleTimer);
            settleTimer = null;
          }
          showToast(panel, message, type);
          rerender();
        };

        const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
          Promise.race([
            p,
            new Promise<null>((r) => setTimeout(() => r(null), ms)),
          ]);

        const poll = async () => {
          if (!orderSettling) return;

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
              if (newBal) outcomeBalances = newBal;
            }
          } catch {
            /* ignore poll errors */
          }

          const newCtx = TradingService.getContext();
          const newYes = outcomeBalances?.yesBalance ?? 0;
          const newNo = outcomeBalances?.noBalance ?? 0;
          const balanceChanged = Math.abs(newCtx.balance - prevBalance) > 0.001;
          const positionChanged =
            Math.abs(newYes - prevYes) > 0.001 ||
            Math.abs(newNo - prevNo) > 0.001;

          if (balanceChanged || positionChanged) {
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

          settleTimer = setTimeout(poll, POLL_INTERVAL);
        };

        settleTimer = setTimeout(poll, POLL_INTERVAL);
      }
    } catch (err) {
      orderSettling = false;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      showToast(
        panel,
        err instanceof Error ? err.message : "Order failed",
        "error"
      );
      rerender();
    }
  };

  form.appendChild(btn);
}

// ── Order Form (Buy / Sell) ──

function renderOrderForm(
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

  const dynamic = el("div", "knoww-tp-dynamic");
  addOrderSummary(dynamic, opts, ctx);
  addBalanceWarning(dynamic, ctx.balance);
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

// ── Split Form ──

function renderSplitForm(
  p: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  if (!opts.conditionId) {
    p.appendChild(
      el("div", "knoww-tp-info-msg", "Split is not available for this market.")
    );
    return;
  }

  const { balance, state } = ctx;
  const isSplitting = state === "splitting";
  const form = el("div", "knoww-tp-form");

  const back = elHtml(
    "button",
    "knoww-tp-back-btn",
    `${I.back} Back to trading`
  );
  back.onclick = (e) => {
    e.stopPropagation();
    activeView = "order";
    rerender();
  };
  form.appendChild(back);

  const info = el("div", "knoww-tp-info-box");
  info.innerHTML = `<strong>Split:</strong> Convert USDC into equal YES + NO shares.<br>1 USDC → 1 YES + 1 NO`;
  form.appendChild(info);

  const header = el("div", "knoww-tp-section-header");
  header.appendChild(el("span", "knoww-tp-section-label", "Amount (USDC)"));
  form.appendChild(header);

  const inputRow = el("div", "knoww-tp-input-row");
  const input = document.createElement("input");
  input.className = "knoww-tp-input-field";
  input.type = "number";
  input.min = "0.01";
  input.step = "0.01";
  input.placeholder = "0.00";
  if (splitMergeAmount > 0) input.value = String(splitMergeAmount);
  input.oninput = () => {
    splitMergeAmount = Math.max(0, Number(input.value));
    rerender();
  };
  const maxBtn = el("button", "knoww-tp-max-btn", "Max");
  maxBtn.onclick = (e) => {
    e.stopPropagation();
    splitMergeAmount = balance;
    input.value = String(balance);
    rerender();
  };
  inputRow.appendChild(input);
  inputRow.appendChild(maxBtn);
  form.appendChild(inputRow);

  if (splitMergeAmount > 0) {
    const summary = el("div", "knoww-tp-summary");
    const r1 = el("div", "knoww-tp-summary-row");
    r1.appendChild(el("span", "knoww-tp-summary-label", "You spend"));
    r1.appendChild(
      el(
        "span",
        "knoww-tp-summary-value",
        `${splitMergeAmount.toFixed(2)} USDC`
      )
    );
    summary.appendChild(r1);
    const r2 = el("div", "knoww-tp-summary-row");
    r2.appendChild(el("span", "knoww-tp-summary-label", "You receive"));
    r2.appendChild(
      el(
        "span",
        "knoww-tp-summary-value positive",
        `${splitMergeAmount.toFixed(2)} YES + ${splitMergeAmount.toFixed(2)} NO`
      )
    );
    summary.appendChild(r2);
    form.appendChild(summary);
  }

  if (splitMergeAmount > balance) {
    const w = el("div", "knoww-tp-balance-warn");
    const top = el("div", "knoww-tp-warn-top");
    const left = el("div", "knoww-tp-warn-left");
    left.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
    left.appendChild(
      el("span", "knoww-tp-warn-text", "Insufficient USDC balance")
    );
    top.appendChild(left);
    w.appendChild(top);
    form.appendChild(w);
  }

  const btn = el("button", "knoww-tp-submit split");
  if (isSplitting) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Splitting...`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (splitMergeAmount <= 0) {
    btn.textContent = "Enter Amount";
    btn.disabled = true;
  } else if (splitMergeAmount > balance) {
    btn.textContent = "Insufficient Balance";
    btn.disabled = true;
  } else {
    btn.textContent = `Split ${splitMergeAmount.toFixed(2)} USDC`;
  }
  btn.onclick = async (e) => {
    e.stopPropagation();
    if (btn.disabled || !opts.conditionId || !activePanel) return;
    const panel = activePanel;
    try {
      await TradingService.splitPosition(
        opts.conditionId,
        splitMergeAmount,
        opts.yesTokenId,
        opts.noTokenId
      );
      showToast(panel, "Split completed!", "success");
      refreshSplitMergeState(opts, {
        refreshWallet: true,
        refreshOutcomeBalances: true,
      });
    } catch (err) {
      showToast(
        panel,
        err instanceof Error ? err.message : "Split failed",
        "error"
      );
    }
  };
  form.appendChild(btn);
  p.appendChild(form);
}

// ── Merge Form ──

function renderMergeForm(
  p: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  if (!opts.conditionId || !opts.yesTokenId || !opts.noTokenId) {
    p.appendChild(
      el("div", "knoww-tp-info-msg", "Merge is not available for this market.")
    );
    return;
  }

  const { state } = ctx;
  const isMerging = state === "merging";
  const maxMerge = outcomeBalances ? outcomeBalances.minBalance : 0;
  const form = el("div", "knoww-tp-form");

  const back = elHtml(
    "button",
    "knoww-tp-back-btn",
    `${I.back} Back to trading`
  );
  back.onclick = (e) => {
    e.stopPropagation();
    activeView = "order";
    rerender();
  };
  form.appendChild(back);

  const info = el("div", "knoww-tp-info-box");
  info.innerHTML = `<strong>Merge:</strong> Convert equal YES + NO shares back into USDC.<br>1 YES + 1 NO → 1 USDC`;
  form.appendChild(info);

  if (outcomeBalances) {
    const summary = el("div", "knoww-tp-summary");
    const yRow = el("div", "knoww-tp-summary-row");
    yRow.appendChild(el("span", "knoww-tp-summary-label", "YES balance"));
    yRow.appendChild(
      el(
        "span",
        "knoww-tp-summary-value",
        outcomeBalances.yesBalance.toFixed(2)
      )
    );
    summary.appendChild(yRow);
    const nRow = el("div", "knoww-tp-summary-row");
    nRow.appendChild(el("span", "knoww-tp-summary-label", "NO balance"));
    nRow.appendChild(
      el("span", "knoww-tp-summary-value", outcomeBalances.noBalance.toFixed(2))
    );
    summary.appendChild(nRow);
    const mRow = el("div", "knoww-tp-summary-row");
    mRow.appendChild(el("span", "knoww-tp-summary-label", "Max merge"));
    mRow.appendChild(
      el("span", "knoww-tp-summary-value positive", maxMerge.toFixed(2))
    );
    summary.appendChild(mRow);
    form.appendChild(summary);
  } else {
    form.appendChild(
      el(
        "div",
        "knoww-tp-info-msg",
        outcomeBalancesLoaded ? "Balances unavailable." : "Loading balances..."
      )
    );
  }

  const header = el("div", "knoww-tp-section-header");
  header.appendChild(el("span", "knoww-tp-section-label", "Amount to merge"));
  form.appendChild(header);

  const inputRow = el("div", "knoww-tp-input-row");
  const input = document.createElement("input");
  input.className = "knoww-tp-input-field";
  input.type = "number";
  input.min = "0.01";
  input.step = "0.01";
  input.placeholder = "0.00";
  if (splitMergeAmount > 0) input.value = String(splitMergeAmount);
  input.oninput = () => {
    splitMergeAmount = Math.max(0, Number(input.value));
    rerender();
  };
  const maxBtn = el("button", "knoww-tp-max-btn", "Max");
  maxBtn.onclick = (e) => {
    e.stopPropagation();
    splitMergeAmount = maxMerge;
    input.value = String(maxMerge);
    rerender();
  };
  inputRow.appendChild(input);
  inputRow.appendChild(maxBtn);
  form.appendChild(inputRow);

  if (splitMergeAmount > 0) {
    const preview = el("div", "knoww-tp-summary");
    const r1 = el("div", "knoww-tp-summary-row");
    r1.appendChild(el("span", "knoww-tp-summary-label", "You spend"));
    r1.appendChild(
      el(
        "span",
        "knoww-tp-summary-value",
        `${splitMergeAmount.toFixed(2)} YES + ${splitMergeAmount.toFixed(2)} NO`
      )
    );
    preview.appendChild(r1);
    const r2 = el("div", "knoww-tp-summary-row");
    r2.appendChild(el("span", "knoww-tp-summary-label", "You receive"));
    r2.appendChild(
      el(
        "span",
        "knoww-tp-summary-value positive",
        `${splitMergeAmount.toFixed(2)} USDC`
      )
    );
    preview.appendChild(r2);
    form.appendChild(preview);
  }

  if (splitMergeAmount > maxMerge && outcomeBalances) {
    const w = el("div", "knoww-tp-balance-warn");
    const top = el("div", "knoww-tp-warn-top");
    const left = el("div", "knoww-tp-warn-left");
    left.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
    left.appendChild(
      el("span", "knoww-tp-warn-text", "Amount exceeds available balance")
    );
    top.appendChild(left);
    w.appendChild(top);
    form.appendChild(w);
  }

  const btn = el("button", "knoww-tp-submit merge");
  if (isMerging) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Merging...`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (splitMergeAmount <= 0) {
    btn.textContent = "Enter Amount";
    btn.disabled = true;
  } else if (splitMergeAmount > maxMerge && outcomeBalances) {
    btn.textContent = "Insufficient Shares";
    btn.disabled = true;
  } else {
    btn.textContent = `Merge ${splitMergeAmount.toFixed(2)} shares`;
  }
  btn.onclick = async (e) => {
    e.stopPropagation();
    if (btn.disabled || !opts.conditionId || !activePanel) return;
    const panel = activePanel;
    try {
      await TradingService.mergePositions(
        opts.conditionId,
        splitMergeAmount,
        opts.yesTokenId,
        opts.noTokenId
      );
      showToast(panel, "Merge completed!", "success");
      refreshSplitMergeState(opts, {
        refreshWallet: true,
        refreshOutcomeBalances: true,
      });
    } catch (err) {
      showToast(
        panel,
        err instanceof Error ? err.message : "Merge failed",
        "error"
      );
    }
  };
  form.appendChild(btn);
  p.appendChild(form);
}

// ── Deposit Flow ──

function resetDepositState(): void {
  depositState = "idle";
  depositStep = "method";
  depositMethod = null;
  depositTokens = [];
  depositSelected = null;
  depositAmount = "";
  depositError = null;
  depositBridgeAddress = "";
  depositBridgeAssets = [];
  depositSelectedBridgeAsset = null;
  depositBridgeSearchQuery = "";
  depositQuote = null;
  depositIsLoadingQuote = false;
  depositTransactions = [];
  depositAddressesCache = [];
  depositIsPending = false;
  depositIsConfirming = false;
  depositIsConfirmed = false;
  depositTxConfirmed = false;
  if (depositStatusPollTimer) {
    clearTimeout(depositStatusPollTimer);
    depositStatusPollTimer = null;
  }
  if (depositPollTimer) {
    clearTimeout(depositPollTimer);
    depositPollTimer = null;
  }
}

const BALANCE_OF_SIG = "0x70a08231";

function encodeBalanceOfCall(owner: string): string {
  return (
    BALANCE_OF_SIG + owner.toLowerCase().replace("0x", "").padStart(64, "0")
  );
}

function parseBalanceHex(hex: string, decimals: number): number {
  if (!hex || hex === "0x" || hex === "0x0") return 0;
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!clean || clean === "0") return 0;
  const raw = BigInt(`0x${clean}`);
  const scale = 10n ** BigInt(decimals);
  const integerPart = raw / scale;
  const remainder = raw % scale;
  const fracStr = remainder.toString().padStart(decimals, "0");
  return Number(`${integerPart}.${fracStr}`);
}

async function waitForTxReceipt(
  txHash: string,
  pollingInterval = 5000,
  timeout = 180_000
): Promise<{ status: "success" | "reverted" }> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const receipt = await WalletBridge.getTransactionReceipt(txHash);
      if (receipt?.status) {
        return { status: receipt.status === "0x1" ? "success" : "reverted" };
      }
    } catch {
      // RPC error — retry
    }
    await new Promise((r) => setTimeout(r, pollingInterval));
  }
  throw new Error(
    "Transaction confirmation timed out. Check your wallet or Polygonscan."
  );
}

const STABLECOINS = new Set(["USDC", "USDC.e", "USDC.E", "USDT", "DAI"]);

let cachedPrices: Record<string, number> | null = null;
let pricesFetchedAt = 0;
const PRICE_CACHE_TTL = 5 * 60 * 1000;

async function fetchTokenPrices(): Promise<Record<string, number>> {
  if (cachedPrices && Date.now() - pricesFetchedAt < PRICE_CACHE_TTL) {
    return cachedPrices;
  }
  const baseUrl = window.KNOWW_CONFIG?.KNOWW_APP_URL || "https://knoww.app";
  const data = await new Promise<{ prices?: Record<string, number> }>(
    (resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "fetch-json",
          url: `${baseUrl}/api/price/tokens`,
          method: "GET",
        },
        (response: { ok: boolean; data?: unknown; error?: string }) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "Price fetch failed"));
            return;
          }
          resolve(response.data as { prices?: Record<string, number> });
        }
      );
    }
  );
  if (data?.prices) {
    cachedPrices = data.prices;
    pricesFetchedAt = Date.now();
    return data.prices;
  }
  throw new Error("No prices in response");
}

function getTokenPrice(symbol: string, prices: Record<string, number>): number {
  if (prices[symbol] !== undefined) return prices[symbol];
  if (STABLECOINS.has(symbol)) return 1;
  return 0;
}

async function ensurePolygonChain(): Promise<void> {
  try {
    const chainId = await WalletBridge.getChainId();
    if (chainId !== POLYGON_CHAIN_ID_HEX) {
      await WalletBridge.switchChain(POLYGON_CHAIN_ID_HEX);
    }
  } catch {
    throw new Error("Please switch your wallet to Polygon network.");
  }
}

async function fetchEoaBalancesViaWallet(
  eoaAddress: string
): Promise<DepositToken[]> {
  await ensurePolygonChain();

  let prices: Record<string, number> = {};
  try {
    prices = await fetchTokenPrices();
  } catch {
    // Price API unavailable — stablecoins still get $1 via getTokenPrice
  }

  const callData = encodeBalanceOfCall(eoaAddress);
  const tokens: DepositToken[] = [];

  const erc20Results = await Promise.allSettled(
    DEPOSIT_TOKENS.map((tok) => WalletBridge.ethCall(tok.address, callData))
  );

  for (let i = 0; i < DEPOSIT_TOKENS.length; i++) {
    const res = erc20Results[i];
    if (res.status !== "fulfilled") continue;
    const amount = parseBalanceHex(res.value, DEPOSIT_TOKENS[i].decimals);
    if (amount > 0) {
      const price = getTokenPrice(DEPOSIT_TOKENS[i].symbol, prices);
      tokens.push({
        symbol: DEPOSIT_TOKENS[i].symbol,
        amount,
        usdValue: amount * price,
        address: DEPOSIT_TOKENS[i].address,
        decimals: DEPOSIT_TOKENS[i].decimals,
      });
    }
  }

  try {
    const polHex = await WalletBridge.getBalance(eoaAddress);
    const polAmount = parseBalanceHex(polHex, 18);
    if (polAmount > 0) {
      const polPrice = getTokenPrice("POL", prices);
      tokens.push({
        symbol: "POL",
        amount: polAmount,
        usdValue: polAmount * polPrice,
        address: "native",
        decimals: 18,
      });
    }
  } catch {
    // POL balance fetch failed, skip
  }

  tokens.sort((a, b) => b.usdValue - a.usdValue);
  return tokens;
}

function startDepositFlow(eoaAddress: string): void {
  resetDepositState();
  depositState = "loading-balances";
  depositStep = "method";
  rerender();

  const loadBalances = fetchEoaBalancesViaWallet(eoaAddress)
    .then((tokens) => {
      depositTokens = tokens;
    })
    .catch((err) => {
      depositError =
        err instanceof Error ? err.message : "Failed to load balances";
    });

  const loadAssets = fetchSupportedAssets()
    .then((assets) => {
      depositBridgeAssets = assets;
    })
    .catch(() => {
      // Non-critical: bridge selection will just show empty list
    });

  Promise.all([loadBalances, loadAssets]).then(() => {
    depositState = "ready";
    rerender();
  });
}

function encodeErc20Transfer(to: string, amountHex: string): string {
  const toStripped = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const amtStripped = amountHex.replace("0x", "").padStart(64, "0");
  return `${ERC20_TRANSFER_SELECTOR}${toStripped}${amtStripped}`;
}

function toHex(n: bigint): string {
  return `0x${n.toString(16)}`;
}

function parseTokenAmount(input: string, decimals: number): bigint {
  const parts = input.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
}

let depositPollTimer: ReturnType<typeof setTimeout> | null = null;

function depositHandleBack(): void {
  if (depositStep === "token" || depositStep === "bridge-select") {
    depositStep = "method";
    depositMethod = null;
    depositBridgeSearchQuery = "";
  } else if (depositStep === "amount") {
    depositStep = "token";
    depositSelected = null;
    depositAmount = "";
    depositQuote = null;
  } else if (depositStep === "confirm") {
    if (depositMethod === "bridge") {
      depositStep = "bridge-select";
      depositSelectedBridgeAsset = null;
      depositBridgeAddress = "";
    } else {
      depositStep = "amount";
      depositQuote = null;
    }
  }
  depositError = null;
  rerender();
}

async function depositSelectMethod(method: DepositMethod): Promise<void> {
  depositMethod = method;
  if (method === "wallet") {
    depositStep = "token";
  } else if (method === "bridge") {
    depositStep = "bridge-select";
    if (depositBridgeAssets.length === 0) {
      depositState = "loading-bridge";
      rerender();
      try {
        depositBridgeAssets = await fetchSupportedAssets();
      } catch {
        // will show empty list
      }
      depositState = "ready";
    }
  }
  rerender();
}

async function depositSelectToken(
  token: DepositToken,
  proxyAddress: string
): Promise<void> {
  depositSelected = token;
  depositError = null;
  depositBridgeAddress = "";
  depositState = "loading-bridge";
  rerender();

  try {
    if (depositAddressesCache.length === 0) {
      depositAddressesCache = await createDepositAddresses(proxyAddress);
    }
    const addrs = depositAddressesCache;
    if (addrs.length > 0) {
      const matching =
        addrs.find(
          (a) =>
            a.chainId === "137" &&
            a.tokenSymbol.toUpperCase() === token.symbol.toUpperCase()
        ) ||
        addrs.find(
          (a) => a.chainId === "137" && a.tokenSymbol.toUpperCase() === "USDC"
        ) ||
        addrs.find((a) => a.chainId === "137");
      if (matching) depositBridgeAddress = matching.depositAddress;
      else depositError = "No deposit address available for Polygon.";
    } else {
      depositError = "Failed to get deposit addresses.";
    }
  } catch (err) {
    depositError =
      err instanceof Error ? err.message : "Failed to get deposit address.";
  }

  depositState = "ready";
  if (!depositError) depositStep = "amount";
  rerender();
}

async function depositSelectBridgeAsset(
  asset: SupportedAsset,
  proxyAddress: string
): Promise<void> {
  depositSelectedBridgeAsset = asset;
  depositState = "loading-bridge";
  rerender();

  try {
    if (depositAddressesCache.length === 0) {
      depositAddressesCache = await createDepositAddresses(proxyAddress);
    }
    const addrs = depositAddressesCache;
    if (addrs.length > 0) {
      const matching =
        addrs.find(
          (a) =>
            a.chainId === asset.chainId && a.tokenSymbol === asset.token.symbol
        ) || addrs.find((a) => a.chainId === asset.chainId);
      if (matching) depositBridgeAddress = matching.depositAddress;
    }
  } catch (err) {
    console.error("Failed to get bridge address:", err);
  }

  depositState = "ready";
  depositStep = "confirm";
  rerender();
}

function depositFetchQuote(): void {
  if (
    !depositSelected ||
    !depositBridgeAddress ||
    !depositAmount ||
    depositIsLoadingQuote
  )
    return;
  const numAmount = parseFloat(depositAmount);
  if (!numAmount || numAmount <= 0) return;

  const amountBaseUnit = parseTokenAmount(
    depositAmount,
    depositSelected.decimals
  ).toString();

  depositIsLoadingQuote = true;
  rerender();

  fetchQuote({
    fromAmountBaseUnit: amountBaseUnit,
    fromChainId: "137",
    fromTokenAddress: depositSelected.address,
    recipientAddress: depositBridgeAddress,
    toChainId: "137",
    toTokenAddress: USDC_E_ADDRESS,
  })
    .then((q) => {
      depositQuote = q;
      depositIsLoadingQuote = false;
      rerender();
    })
    .catch(() => {
      depositQuote = null;
      depositIsLoadingQuote = false;
      rerender();
    });
}

async function executeDeposit(ctx: TradingContext): Promise<void> {
  if (!depositSelected || !ctx.address || !depositBridgeAddress) return;
  const numAmount = parseFloat(depositAmount);
  if (!numAmount || numAmount <= 0 || numAmount > depositSelected.amount)
    return;

  depositIsPending = true;
  depositError = null;
  rerender();

  try {
    const amountBig = parseTokenAmount(depositAmount, depositSelected.decimals);

    let txHash: string;
    if (depositSelected.address === "native") {
      txHash = await WalletBridge.sendTransaction({
        from: ctx.address,
        to: depositBridgeAddress,
        value: toHex(amountBig),
      });
    } else {
      const data = encodeErc20Transfer(depositBridgeAddress, toHex(amountBig));
      txHash = await WalletBridge.sendTransaction({
        from: ctx.address,
        to: depositSelected.address,
        data,
      });
    }

    depositIsPending = false;
    depositIsConfirming = true;
    depositTxConfirmed = false;
    rerender();

    // Phase 1: Wait for on-chain transaction confirmation
    const receipt = await waitForTxReceipt(txHash);
    if (receipt.status === "reverted") {
      depositIsConfirming = false;
      depositError = "Transaction reverted on-chain";
      rerender();
      return;
    }

    // Phase 2: On-chain confirmed — now poll for bridge credit
    depositTxConfirmed = true;
    rerender();

    const prevBalance = ctx.balance;
    const POLL_INTERVAL = 5000;
    const BRIDGE_TIMEOUT = 180_000;
    const bridgeStart = Date.now();

    const pollBridgeCredit = async () => {
      try {
        await TradingService.refreshBalance();
      } catch {
        /* ignore */
      }

      if (depositBridgeAddress) {
        try {
          depositTransactions = await fetchDepositStatus(depositBridgeAddress);
          rerender();
        } catch {
          /* ignore */
        }
      }

      const newCtx = TradingService.getContext();
      const balanceChanged = newCtx.balance > prevBalance + 0.001;
      const timedOut = Date.now() - bridgeStart >= BRIDGE_TIMEOUT;

      if (balanceChanged || timedOut) {
        if (depositPollTimer) {
          clearTimeout(depositPollTimer);
          depositPollTimer = null;
        }
        depositIsConfirming = false;
        depositIsConfirmed = true;
        rerender();
        setTimeout(() => {
          activeView = "order";
          resetDepositState();
          rerender();
        }, 3000);
        return;
      }

      depositPollTimer = setTimeout(pollBridgeCredit, POLL_INTERVAL);
    };

    depositPollTimer = setTimeout(pollBridgeCredit, POLL_INTERVAL);
  } catch (err) {
    depositIsPending = false;
    depositIsConfirming = false;
    depositTxConfirmed = false;
    const msg = err instanceof Error ? err.message : "Transaction failed";
    if (msg.includes("User rejected") || msg.includes("user rejected")) {
      depositError = "Transaction rejected";
    } else {
      depositError = msg;
    }
    rerender();
  }
}

function computeReceiveAmount(): string {
  if (!depositAmount || !depositSelected) return "0";
  const numAmount = parseFloat(depositAmount);
  if (Number.isNaN(numAmount)) return "0";
  if (
    ["USDC", "USDC.e", "USDC.E", "DAI", "USDT"].includes(depositSelected.symbol)
  )
    return numAmount.toFixed(2);
  return (
    (depositSelected.usdValue / depositSelected.amount) *
    numAmount
  ).toFixed(2);
}

function computeEnteredAmountUsd(): number {
  if (!depositAmount || !depositSelected) return 0;
  const numAmount = parseFloat(depositAmount);
  if (Number.isNaN(numAmount)) return 0;
  if (
    ["USDC", "USDC.e", "USDC.E", "DAI", "USDT"].includes(depositSelected.symbol)
  )
    return numAmount;
  return (depositSelected.usdValue / depositSelected.amount) * numAmount;
}

// ── Deposit Form Renderers ──

function renderDepositMethodStep(form: HTMLElement, ctx: TradingContext): void {
  // Wallet option
  const walletBtn = el("button", "knoww-tp-deposit-method-btn");
  const walletLeft = el("div", "knoww-tp-deposit-method-left");
  const walletIcon = el("div", "knoww-tp-deposit-method-icon wallet");
  walletIcon.textContent = "🦊";
  walletLeft.appendChild(walletIcon);
  const walletInfo = el("div", "knoww-tp-deposit-method-info");
  const walletName = el("div", "knoww-tp-deposit-method-name");
  walletName.textContent = ctx.address
    ? `Wallet (${truncAddr(ctx.address)})`
    : "Wallet (Not connected)";
  walletInfo.appendChild(walletName);
  const totalUsd = depositTokens.reduce((s, t) => s + t.usdValue, 0);
  let walletSubText: string;
  if (depositTokens.length > 0) {
    walletSubText = `$${totalUsd.toFixed(2)} • Instant`;
  } else if (ctx.address) {
    walletSubText = "No tokens found";
  } else {
    walletSubText = "Connect wallet";
  }
  const walletSub = el("div", "knoww-tp-deposit-method-sub", walletSubText);
  walletInfo.appendChild(walletSub);
  walletLeft.appendChild(walletInfo);
  walletBtn.appendChild(walletLeft);
  walletBtn.appendChild(
    elHtml(
      "span",
      "knoww-tp-deposit-method-chevron",
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`
    )
  );
  walletBtn.onclick = (e) => {
    e.stopPropagation();
    depositSelectMethod("wallet");
  };
  form.appendChild(walletBtn);

  // Divider
  const divider = el("div", "knoww-tp-deposit-divider");
  divider.appendChild(el("span", "knoww-tp-deposit-divider-line"));
  divider.appendChild(el("span", "knoww-tp-deposit-divider-text", "more"));
  divider.appendChild(el("span", "knoww-tp-deposit-divider-line"));
  form.appendChild(divider);

  // Bridge option
  const bridgeBtn = el("button", "knoww-tp-deposit-method-btn");
  const bridgeLeft = el("div", "knoww-tp-deposit-method-left");
  const bridgeIcon = el("div", "knoww-tp-deposit-method-icon bridge");
  bridgeIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>`;
  bridgeLeft.appendChild(bridgeIcon);
  const bridgeInfo = el("div", "knoww-tp-deposit-method-info");
  bridgeInfo.appendChild(
    el("div", "knoww-tp-deposit-method-name", "Transfer Crypto")
  );
  bridgeInfo.appendChild(
    el("div", "knoww-tp-deposit-method-sub", "No limit • Instant")
  );
  bridgeLeft.appendChild(bridgeInfo);
  bridgeBtn.appendChild(bridgeLeft);
  const chainIcons = el("div", "knoww-tp-deposit-chain-icons");
  for (const icon of ["⟠", "⬡", "🔷", "🔵"]) {
    chainIcons.appendChild(el("span", "knoww-tp-deposit-chain-dot", icon));
  }
  bridgeBtn.appendChild(chainIcons);
  bridgeBtn.appendChild(
    elHtml(
      "span",
      "knoww-tp-deposit-method-chevron",
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`
    )
  );
  bridgeBtn.onclick = (e) => {
    e.stopPropagation();
    depositSelectMethod("bridge");
  };
  form.appendChild(bridgeBtn);

  // Card - Coming Soon
  const cardBtn = el("button", "knoww-tp-deposit-method-btn disabled");
  cardBtn.disabled = true;
  const cardLeft = el("div", "knoww-tp-deposit-method-left");
  const cardIcon = el("div", "knoww-tp-deposit-method-icon card");
  cardIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
  cardLeft.appendChild(cardIcon);
  const cardInfo = el("div", "knoww-tp-deposit-method-info");
  cardInfo.appendChild(
    el("div", "knoww-tp-deposit-method-name", "Deposit with Card")
  );
  cardInfo.appendChild(
    el("div", "knoww-tp-deposit-method-sub", "$50,000 • 5 min")
  );
  cardLeft.appendChild(cardInfo);
  cardBtn.appendChild(cardLeft);
  cardBtn.appendChild(
    el("span", "knoww-tp-deposit-coming-soon", "Coming Soon")
  );
  form.appendChild(cardBtn);

  // Exchange - Coming Soon
  const exchBtn = el("button", "knoww-tp-deposit-method-btn disabled");
  exchBtn.disabled = true;
  const exchLeft = el("div", "knoww-tp-deposit-method-left");
  const exchIcon = el("div", "knoww-tp-deposit-method-icon exchange");
  exchIcon.innerHTML = I.refresh;
  exchLeft.appendChild(exchIcon);
  const exchInfo = el("div", "knoww-tp-deposit-method-info");
  exchInfo.appendChild(
    el("div", "knoww-tp-deposit-method-name", "Connect Exchange")
  );
  exchInfo.appendChild(
    el("div", "knoww-tp-deposit-method-sub", "No limit • 2 min")
  );
  exchLeft.appendChild(exchInfo);
  exchBtn.appendChild(exchLeft);
  exchBtn.appendChild(
    el("span", "knoww-tp-deposit-coming-soon", "Coming Soon")
  );
  form.appendChild(exchBtn);
}

function renderDepositTokenStep(form: HTMLElement, ctx: TradingContext): void {
  if (depositState === "loading-balances") {
    const loader = el("div", "knoww-tp-loading-section");
    loader.appendChild(el("div", "knoww-tp-spinner"));
    loader.appendChild(
      el("div", "knoww-tp-loading-text", "Loading wallet balances...")
    );
    form.appendChild(loader);
    return;
  }

  if (depositError) {
    const errRow = el("div", "knoww-tp-deposit-error");
    errRow.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
    errRow.appendChild(el("span", "", depositError));
    form.appendChild(errRow);
  }

  const MIN_BALANCE_USD = 2;

  if (depositTokens.length === 0) {
    const empty = el("div", "knoww-tp-deposit-empty");
    empty.appendChild(elHtml("span", "knoww-tp-deposit-empty-icon", I.wallet));
    empty.appendChild(
      el("div", "knoww-tp-deposit-empty-text", "No tokens found in your wallet")
    );
    empty.appendChild(
      el(
        "div",
        "knoww-tp-deposit-empty-sub",
        depositError
          ? "There was an issue fetching your balances. Please try again."
          : "Make sure you have tokens on Polygon network."
      )
    );
    form.appendChild(empty);
    return;
  }

  // Min deposit info banner
  const minDeposit = getDefaultMinDeposit(depositBridgeAssets);
  const infoBanner = el("div", "knoww-tp-deposit-info-banner warn");
  infoBanner.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:#f59e0b"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
  infoBanner.appendChild(
    el(
      "span",
      "",
      `Minimum deposit varies by token (typically $${minDeposit}+)`
    )
  );
  form.appendChild(infoBanner);

  const tokenList = el("div", "knoww-tp-deposit-token-list");
  for (const tok of depositTokens) {
    const minDep = getMinDepositForToken(depositBridgeAssets, tok.symbol);
    const isBelowMinDeposit = tok.usdValue < minDep;
    const isBelowMinBalance = tok.usdValue < MIN_BALANCE_USD;
    const isDisabled = isBelowMinDeposit || isBelowMinBalance;
    const row = el(
      "button",
      `knoww-tp-deposit-token-row${isDisabled ? " below-min" : ""}`
    );
    const dot = el("span", "knoww-tp-deposit-token-dot");
    const colorMap: Record<string, string> = {
      "usdc.e": "#2687d1",
      usdc: "#2687d1",
      usdt: "#26a17b",
      dai: "#f3ba2f",
      weth: "#627eea",
      pol: "#8247e5",
    };
    dot.style.backgroundColor = colorMap[tok.symbol.toLowerCase()] ?? "#a0a0a0";
    row.appendChild(dot);
    const symCol = el("div", "knoww-tp-deposit-token-info");
    symCol.appendChild(el("span", "knoww-tp-deposit-token-sym", tok.symbol));
    symCol.appendChild(
      el(
        "span",
        "knoww-tp-deposit-token-amt",
        `${tok.amount.toFixed(5)} ${tok.symbol}`
      )
    );
    row.appendChild(symCol);
    const rightCol = el("div", "knoww-tp-deposit-token-right");
    if (isDisabled) {
      const badgeAmount = isBelowMinBalance ? MIN_BALANCE_USD : minDep;
      rightCol.appendChild(
        el("span", "knoww-tp-deposit-min-badge", `Min $${badgeAmount}`)
      );
    }
    rightCol.appendChild(
      el("span", "knoww-tp-deposit-token-usd", `$${tok.usdValue.toFixed(2)}`)
    );
    row.appendChild(rightCol);
    if (isDisabled) {
      row.disabled = true;
    } else {
      row.onclick = (e) => {
        e.stopPropagation();
        if (ctx.proxyAddress) {
          depositSelectToken(tok, ctx.proxyAddress);
        }
      };
    }
    tokenList.appendChild(row);
  }
  form.appendChild(tokenList);
}

function renderDepositBridgeSelectStep(
  form: HTMLElement,
  ctx: TradingContext
): void {
  if (depositState === "loading-bridge") {
    const loader = el("div", "knoww-tp-loading-section");
    loader.appendChild(el("div", "knoww-tp-spinner"));
    loader.appendChild(el("div", "knoww-tp-loading-text", "Loading assets..."));
    form.appendChild(loader);
    return;
  }

  // Search input
  const searchWrap = el("div", "knoww-tp-deposit-search-wrap");
  const searchInput = document.createElement("input");
  searchInput.className = "knoww-tp-deposit-search";
  searchInput.type = "text";
  searchInput.placeholder = "Search chain or token...";
  searchInput.value = depositBridgeSearchQuery;
  searchInput.setAttribute("data-bridge-search", "true");
  searchInput.oninput = (e) => {
    depositBridgeSearchQuery = (e.target as HTMLInputElement).value;
    rerender();
    const restored = activePanel?.querySelector<HTMLInputElement>(
      "[data-bridge-search]"
    );
    if (restored) restored.focus();
  };
  searchWrap.appendChild(searchInput);
  form.appendChild(searchWrap);

  // Info banner
  const infoBanner = el("div", "knoww-tp-deposit-info-banner info");
  infoBanner.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:var(--knoww-accent, #1d9bf0)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
  infoBanner.appendChild(
    elHtml(
      "span",
      "",
      `All deposits are automatically converted to <strong style="color:var(--knoww-accent, #1d9bf0)">USDC.e on Polygon</strong> at the best available rate.`
    )
  );
  form.appendChild(infoBanner);

  // Filter assets
  const query = depositBridgeSearchQuery.toLowerCase().trim();
  const filtered = query
    ? depositBridgeAssets.filter(
        (a) =>
          a.token.symbol.toLowerCase().includes(query) ||
          a.token.name.toLowerCase().includes(query) ||
          a.chainName.toLowerCase().includes(query)
      )
    : depositBridgeAssets;

  const list = el("div", "knoww-tp-deposit-bridge-list");
  for (const asset of filtered) {
    const meta = CHAIN_METADATA[asset.chainId] || {
      name: `Chain ${asset.chainId}`,
      icon: "🔗",
      color: "#888",
    };
    const row = el("button", "knoww-tp-deposit-bridge-row");
    const chainIcon = el("div", "knoww-tp-deposit-bridge-icon");
    chainIcon.style.background = meta.color;
    chainIcon.textContent = meta.icon;
    row.appendChild(chainIcon);
    const info = el("div", "knoww-tp-deposit-bridge-info");
    info.appendChild(
      el("div", "knoww-tp-deposit-bridge-sym", asset.token.symbol)
    );
    info.appendChild(
      el("div", "knoww-tp-deposit-bridge-chain", asset.chainName)
    );
    row.appendChild(info);
    const right = el("div", "knoww-tp-deposit-bridge-right");
    right.appendChild(el("span", "knoww-tp-deposit-bridge-min-label", "MIN"));
    right.appendChild(
      el("span", "knoww-tp-deposit-bridge-min-val", `$${asset.minCheckoutUsd}`)
    );
    row.appendChild(right);
    row.appendChild(
      elHtml(
        "span",
        "knoww-tp-deposit-method-chevron",
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`
      )
    );
    row.onclick = (e) => {
      e.stopPropagation();
      if (ctx.proxyAddress) {
        depositSelectBridgeAsset(asset, ctx.proxyAddress);
      }
    };
    list.appendChild(row);
  }
  form.appendChild(list);
}

function renderDepositAmountStep(form: HTMLElement): void {
  if (!depositSelected) return;

  // Large amount input centered
  const amtCenter = el("div", "knoww-tp-deposit-amt-center");
  const amtInput = document.createElement("input");
  amtInput.className = "knoww-tp-deposit-amt-input";
  amtInput.type = "text";
  amtInput.placeholder = "0.00";
  amtInput.value = depositAmount;
  amtInput.setAttribute("data-deposit-amt", "true");
  amtInput.oninput = (e) => {
    depositAmount = (e.target as HTMLInputElement).value.replace(
      /[^0-9.]/g,
      ""
    );
    depositError = null;
    rerender();
    const restored =
      activePanel?.querySelector<HTMLInputElement>("[data-deposit-amt]");
    if (restored) restored.focus();
  };
  amtCenter.appendChild(amtInput);
  form.appendChild(amtCenter);

  // Percentage presets
  const presets = el("div", "knoww-tp-deposit-presets");
  for (const pct of [25, 50, 75, 100]) {
    const label = pct === 100 ? "Max" : `${pct}%`;
    const btn = el("button", "knoww-tp-deposit-preset-btn", label);
    btn.onclick = (e) => {
      e.stopPropagation();
      if (!depositSelected) return;
      const val = (depositSelected.amount * pct) / 100;
      depositAmount =
        pct === 100
          ? depositSelected.amount.toString()
          : val.toFixed(
              depositSelected.decimals > 6 ? 6 : depositSelected.decimals
            );
      rerender();
    };
    presets.appendChild(btn);
  }
  form.appendChild(presets);

  // Send → Receive summary
  const sendRecv = el("div", "knoww-tp-deposit-send-recv");
  const sendSide = el("span", "", `You send: ${depositSelected.symbol}`);
  const arrow = elHtml(
    "span",
    "",
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`
  );
  const recvSide = el("span", "", "You receive: USDC.e");
  sendRecv.appendChild(sendSide);
  sendRecv.appendChild(arrow);
  sendRecv.appendChild(recvSide);
  form.appendChild(sendRecv);

  // Minimum deposit/balance warnings
  const enteredUsd = computeEnteredAmountUsd();
  const minDep = getMinDepositForToken(
    depositBridgeAssets,
    depositSelected.symbol
  );
  const MIN_AMOUNT_USD = 2;
  const isBelowMinBalance = enteredUsd > 0 && enteredUsd < MIN_AMOUNT_USD;
  const isBelowMinDeposit = enteredUsd > 0 && enteredUsd < minDep;

  if (depositAmount && isBelowMinBalance) {
    const warn = el("div", "knoww-tp-deposit-info-banner warn");
    warn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:#f59e0b"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    warn.appendChild(
      el(
        "span",
        "",
        `Minimum amount is $${MIN_AMOUNT_USD}. You entered $${enteredUsd.toFixed(2)}.`
      )
    );
    form.appendChild(warn);
  } else if (depositAmount && isBelowMinDeposit) {
    const warn = el("div", "knoww-tp-deposit-info-banner warn");
    warn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:#f59e0b"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    warn.appendChild(
      el(
        "span",
        "",
        `Minimum deposit is $${minDep}. You entered $${enteredUsd.toFixed(2)}.`
      )
    );
    form.appendChild(warn);
  }

  // Continue button
  const numAmt = parseFloat(depositAmount) || 0;
  const overBalance = numAmt > depositSelected.amount;
  const isValid =
    numAmt > 0 && !overBalance && !isBelowMinBalance && !isBelowMinDeposit;

  const btn = el("button", "knoww-tp-submit deposit");
  if (isBelowMinBalance) {
    btn.textContent = `Min. $${MIN_AMOUNT_USD} required`;
    btn.disabled = true;
  } else if (isBelowMinDeposit) {
    btn.textContent = `Min. $${minDep} required`;
    btn.disabled = true;
  } else if (overBalance) {
    btn.textContent = "Insufficient balance";
    btn.disabled = true;
  } else if (numAmt <= 0) {
    btn.textContent = "Enter amount";
    btn.disabled = true;
  } else {
    btn.textContent = "Continue";
  }
  btn.onclick = (e) => {
    e.stopPropagation();
    if (!isValid) return;
    depositStep = "confirm";
    depositFetchQuote();
    rerender();
  };
  form.appendChild(btn);
}

function renderDepositConfirmStep(
  form: HTMLElement,
  ctx: TradingContext
): void {
  if (depositMethod === "bridge" && depositSelectedBridgeAsset) {
    // Bridge confirmation: show deposit address
    form.appendChild(
      el(
        "div",
        "knoww-tp-deposit-confirm-title",
        `Deposit ${depositSelectedBridgeAsset.token.symbol}`
      )
    );
    form.appendChild(
      el(
        "div",
        "knoww-tp-deposit-confirm-sub",
        `on ${depositSelectedBridgeAsset.chainName}`
      )
    );

    if (depositState === "loading-bridge") {
      const loader = el("div", "knoww-tp-loading-section");
      loader.appendChild(el("div", "knoww-tp-spinner"));
      form.appendChild(loader);
      return;
    }

    if (depositBridgeAddress) {
      // Deposit address box
      const addrBox = el("div", "knoww-tp-deposit-addr-box");
      addrBox.appendChild(
        el(
          "div",
          "knoww-tp-deposit-addr-label",
          `Send ${depositSelectedBridgeAsset.token.symbol} to this address`
        )
      );
      const addrRow = el("div", "knoww-tp-deposit-addr-row");
      const code = el(
        "code",
        "knoww-tp-deposit-addr-code",
        depositBridgeAddress
      );
      addrRow.appendChild(code);
      const copyBtn = el("button", "knoww-tp-deposit-copy-btn");
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(depositBridgeAddress);
        copyBtn.innerHTML = I.check;
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        }, 2000);
      };
      addrRow.appendChild(copyBtn);
      addrBox.appendChild(addrRow);
      form.appendChild(addrBox);

      // Copy full address button
      const copyFullBtn = el("button", "knoww-tp-submit deposit");
      copyFullBtn.textContent = "Copy Deposit Address";
      copyFullBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(depositBridgeAddress);
        copyFullBtn.textContent = "Address Copied!";
        setTimeout(() => {
          copyFullBtn.textContent = "Copy Deposit Address";
        }, 2000);
      };
      form.appendChild(copyFullBtn);

      // Min info
      const minInfo = el("div", "knoww-tp-deposit-info-banner warn");
      minInfo.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:#f59e0b"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
      const minText = el("div", "");
      minText.appendChild(
        el("div", "", `Minimum: $${depositSelectedBridgeAsset.minCheckoutUsd}`)
      );
      minText.appendChild(
        el("div", "", "Assets will be converted to USDC.e on Polygon.")
      );
      minText.style.fontSize = "11px";
      minInfo.appendChild(minText);
      form.appendChild(minInfo);
    } else {
      form.appendChild(
        el(
          "div",
          "knoww-tp-deposit-status-sub",
          "Failed to get deposit address. Please try again."
        )
      );
    }
    return;
  }

  // Wallet confirmation with quote
  if (!depositSelected) return;

  const displayReceiveAmt = depositQuote
    ? (Number(depositQuote.estToTokenBaseUnit) / 1e6).toFixed(2)
    : computeReceiveAmount();
  const estimatedTime = depositQuote
    ? formatCheckoutTime(depositQuote.estCheckoutTimeMs)
    : "< 2 min";

  // Amount display
  form.appendChild(
    el(
      "div",
      "knoww-tp-deposit-confirm-amount",
      `$${parseFloat(depositAmount || "0").toFixed(2)}`
    )
  );

  // Auto-conversion banner
  if (depositSelected.symbol !== "USDC.e") {
    const banner = el("div", "knoww-tp-deposit-info-banner info");
    banner.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:var(--knoww-accent, #1d9bf0)"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>`;
    const text = el("div", "");
    text.appendChild(el("div", "", "Auto-conversion to USDC.e"));
    text.appendChild(
      el(
        "div",
        "",
        `Your ${depositSelected.symbol} will be automatically converted to USDC.e on Polygon via Polymarket Bridge.`
      )
    );
    text.style.fontSize = "11px";
    banner.appendChild(text);
    form.appendChild(banner);
  }

  // Details card
  const details = el("div", "knoww-tp-deposit-details-card");
  const rows: Array<[string, string]> = [
    ["Source", `🦊 Wallet (${ctx.address ? truncAddr(ctx.address) : ""})`],
    ["Via", "🌉 Polymarket Bridge"],
    ["Destination", "📊 Polymarket Wallet"],
    ["Est. time", estimatedTime],
  ];
  for (const [label, value] of rows) {
    const row = el("div", "knoww-tp-deposit-detail-row");
    row.appendChild(el("span", "knoww-tp-deposit-detail-label", label));
    row.appendChild(el("span", "knoww-tp-deposit-detail-value", value));
    details.appendChild(row);
  }
  form.appendChild(details);

  // Transaction breakdown
  const breakdown = el("div", "knoww-tp-deposit-details-card");
  const sendRow = el("div", "knoww-tp-deposit-detail-row");
  sendRow.appendChild(el("span", "knoww-tp-deposit-detail-label", "You send"));
  sendRow.appendChild(
    el(
      "span",
      "knoww-tp-deposit-detail-value",
      `${depositAmount} ${depositSelected.symbol}`
    )
  );
  breakdown.appendChild(sendRow);

  const recvRow = el("div", "knoww-tp-deposit-detail-row");
  recvRow.appendChild(
    el(
      "span",
      "knoww-tp-deposit-detail-label",
      `You receive ${depositQuote ? "" : "(approx)"}`
    )
  );
  const recvVal = el("span", "knoww-tp-deposit-detail-value");
  if (depositIsLoadingQuote) {
    recvVal.appendChild(el("span", "knoww-tp-deposit-inline-spinner"));
  }
  recvVal.appendChild(
    document.createTextNode(
      `${depositQuote ? "" : "~"}${displayReceiveAmt} USDC.e`
    )
  );
  recvRow.appendChild(recvVal);
  breakdown.appendChild(recvRow);

  // Fee breakdown
  const feeDivider = el("div", "knoww-tp-deposit-fee-divider");
  breakdown.appendChild(feeDivider);

  if (depositQuote?.estFeeBreakdown) {
    const fb = depositQuote.estFeeBreakdown;
    const feeRows: Array<[string, string]> = [
      ["Gas fee", `$${fb.gasUsd.toFixed(4)}`],
    ];
    if (fb.swapImpactUsd > 0) {
      feeRows.push(["Swap impact", `$${fb.swapImpactUsd.toFixed(4)}`]);
    }
    if (fb.appFeeUsd > 0) {
      feeRows.push([
        fb.appFeeLabel || "App fee",
        `$${fb.appFeeUsd.toFixed(4)}`,
      ]);
    }
    if (fb.maxSlippage > 0) {
      feeRows.push(["Max slippage", `${(fb.maxSlippage * 100).toFixed(2)}%`]);
    }
    for (const [lbl, val] of feeRows) {
      const r = el("div", "knoww-tp-deposit-fee-row");
      r.appendChild(el("span", "knoww-tp-deposit-fee-label", lbl));
      r.appendChild(el("span", "knoww-tp-deposit-fee-value", val));
      breakdown.appendChild(r);
    }
    const minRecvRow = el("div", "knoww-tp-deposit-fee-row highlight");
    minRecvRow.appendChild(
      el("span", "knoww-tp-deposit-fee-label", "Min. received")
    );
    minRecvRow.appendChild(
      el(
        "span",
        "knoww-tp-deposit-fee-value",
        `${fb.minReceived.toFixed(2)} USDC.e`
      )
    );
    breakdown.appendChild(minRecvRow);
  } else {
    const defaultFees: Array<[string, string]> = [
      ["Network cost", "~$0.01"],
      ["Bridge fee", "~0.1%"],
    ];
    for (const [lbl, val] of defaultFees) {
      const r = el("div", "knoww-tp-deposit-fee-row");
      r.appendChild(el("span", "knoww-tp-deposit-fee-label", lbl));
      r.appendChild(el("span", "knoww-tp-deposit-fee-value", val));
      breakdown.appendChild(r);
    }
  }
  form.appendChild(breakdown);

  // Error display
  if (depositError) {
    const errRow = el("div", "knoww-tp-deposit-error");
    errRow.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
    const errText =
      depositError.length > 150
        ? `${depositError.slice(0, 150)}...`
        : depositError;
    errRow.appendChild(el("span", "", errText));
    form.appendChild(errRow);
  }

  // No bridge address warning
  if (!depositBridgeAddress && depositState !== "loading-bridge") {
    const warn = el("div", "knoww-tp-deposit-info-banner warn");
    warn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:#f59e0b"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    warn.appendChild(
      el(
        "span",
        "",
        "Failed to get bridge address. Please go back and try again."
      )
    );
    form.appendChild(warn);
  }

  // On-chain confirmed, now waiting for bridge credit
  if (depositIsConfirming && depositTxConfirmed) {
    const infoBanner = el("div", "knoww-tp-deposit-info-banner success");
    infoBanner.innerHTML = I.check;
    const infoText = el("div", "");
    infoText.appendChild(el("div", "", "Transaction confirmed on-chain!"));
    infoText.appendChild(
      el("div", "", "Waiting for bridge to credit USDC.e to your wallet...")
    );
    infoText.style.fontSize = "11px";
    infoBanner.appendChild(infoText);
    form.appendChild(infoBanner);
  }

  // Deposit complete
  if (depositIsConfirmed) {
    const successBanner = el("div", "knoww-tp-deposit-info-banner success");
    successBanner.innerHTML = I.check;
    const successText = el("div", "");
    successText.appendChild(el("div", "", "Deposit complete!"));
    successText.appendChild(
      el("div", "", "USDC.e has been credited to your Polymarket wallet.")
    );
    successText.style.fontSize = "11px";
    successBanner.appendChild(successText);
    form.appendChild(successBanner);
  }

  // Deposit status tracking
  if (
    (depositIsConfirmed || (depositIsConfirming && depositTxConfirmed)) &&
    depositTransactions.length > 0
  ) {
    const statusCard = el("div", "knoww-tp-deposit-details-card");
    statusCard.appendChild(
      el("div", "knoww-tp-deposit-detail-label", "Bridge Status")
    );
    for (const tx of depositTransactions.slice(0, 3)) {
      const display = getDepositStatusDisplay(tx.status);
      const statusRow = el("div", "knoww-tp-deposit-status-row");
      const statusDot = el("span", "knoww-tp-deposit-status-dot");
      statusDot.style.backgroundColor = display.color;
      statusRow.appendChild(statusDot);
      statusRow.appendChild(el("span", "", display.text));
      statusRow.appendChild(
        el(
          "span",
          "knoww-tp-deposit-status-amt",
          `${(Number(tx.fromAmountBaseUnit) / 1e6).toFixed(2)} USDC`
        )
      );
      statusCard.appendChild(statusRow);
    }
    form.appendChild(statusCard);
  }

  // Terms
  form.appendChild(
    el(
      "div",
      "knoww-tp-deposit-terms",
      "By clicking Confirm Order, you agree to our terms."
    )
  );

  // Confirm button
  const btn = el("button", "knoww-tp-submit deposit");
  const isDisabled =
    !depositBridgeAddress ||
    depositIsPending ||
    depositIsConfirming ||
    depositIsConfirmed;

  if (depositIsPending) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Confirm in Wallet...`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (depositIsConfirming && !depositTxConfirmed) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Confirming on-chain...`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (depositIsConfirming && depositTxConfirmed) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Waiting for bridge...`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (depositIsConfirmed) {
    btn.innerHTML = `${I.check} Deposit Complete!`;
    btn.disabled = true;
  } else if (!depositBridgeAddress) {
    btn.textContent = "Loading Bridge...";
    btn.disabled = true;
  } else {
    btn.textContent = "Confirm Order";
  }
  btn.onclick = (e) => {
    e.stopPropagation();
    if (isDisabled) return;
    executeDeposit(ctx);
  };
  form.appendChild(btn);
}

function renderDepositForm(p: HTMLElement, ctx: TradingContext): void {
  const form = el("div", "knoww-tp-form");

  // Header with back button
  const headerRow = el("div", "knoww-tp-deposit-header-row");
  const backBtn = elHtml("button", "knoww-tp-back-btn", I.back);
  if (depositStep === "method") {
    backBtn.onclick = (e) => {
      e.stopPropagation();
      activeView = "order";
      resetDepositState();
      rerender();
    };
  } else {
    backBtn.onclick = (e) => {
      e.stopPropagation();
      depositHandleBack();
    };
  }
  headerRow.appendChild(backBtn);

  const title = el("div", "knoww-tp-deposit-title", "Deposit");
  headerRow.appendChild(title);

  const balance = el(
    "div",
    "knoww-tp-deposit-header-bal",
    `Balance: $${formatTokenAmount(ctx.balance)}`
  );
  headerRow.appendChild(balance);
  form.appendChild(headerRow);

  // Loading state
  if (depositState === "loading-balances" && depositStep === "method") {
    const loader = el("div", "knoww-tp-loading-section");
    loader.appendChild(el("div", "knoww-tp-spinner"));
    loader.appendChild(
      el("div", "knoww-tp-loading-text", "Loading wallet balances...")
    );
    form.appendChild(loader);
    p.appendChild(form);
    return;
  }

  // Enable trading notice (blocks all steps)
  const needsTrading = !ctx.credentials;
  if (needsTrading) {
    const notice = el("div", "knoww-tp-deposit-notice");
    notice.appendChild(
      elHtml("span", "knoww-tp-deposit-notice-icon", I.shield)
    );
    const noticeText = el("div", "knoww-tp-deposit-notice-body");
    noticeText.appendChild(
      el("div", "knoww-tp-deposit-notice-title", "Enable trading first")
    );
    noticeText.appendChild(
      el(
        "div",
        "knoww-tp-deposit-notice-desc",
        "You need to sign a message to enable trading before you can deposit funds."
      )
    );
    notice.appendChild(noticeText);
    form.appendChild(notice);

    const enableBtn = el("button", "knoww-tp-submit deposit");
    enableBtn.textContent = "Enable Trading";
    enableBtn.onclick = (e) => {
      e.stopPropagation();
      setButtonLoading(enableBtn, "Waiting for signature…");
      activeView = "order";
      TradingService.deriveCredentials();
    };
    form.appendChild(enableBtn);
    p.appendChild(form);
    return;
  }

  // Render the current step
  switch (depositStep) {
    case "method":
      renderDepositMethodStep(form, ctx);
      break;
    case "token":
      renderDepositTokenStep(form, ctx);
      break;
    case "bridge-select":
      renderDepositBridgeSelectStep(form, ctx);
      break;
    case "amount":
      renderDepositAmountStep(form);
      break;
    case "confirm":
      renderDepositConfirmStep(form, ctx);
      break;
  }

  p.appendChild(form);
}

// ── Main Render ──

function render(
  panel: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  const { state, address, error } = ctx;
  panel.innerHTML = "";

  addHeader(panel, opts, ctx, address);

  if (state === "disconnected" || !address) {
    addDisconnected(panel);
    return;
  }
  if (state === "connecting") {
    addLoading(panel, "Connecting wallet...");
    return;
  }
  if (state === "switching-chain") {
    addLoading(panel, "Switching to Polygon...");
    return;
  }

  addPortfolioBar(panel, ctx, opts);

  if (activeView === "deposit") {
    renderDepositForm(panel, ctx);
  } else if (state === "connected" && !ctx.credentials) {
    addEnableTrading(panel);
    return;
  } else if (state === "deriving-credentials") {
    addLoading(panel, "Confirm signature in MetaMask...");
    return;
  } else if (
    state === "ready" ||
    state === "placing-order" ||
    state === "approving" ||
    state === "splitting" ||
    state === "merging"
  ) {
    if (activeView === "order") {
      renderOrderForm(panel, opts, ctx);
    } else if (activeView === "split") {
      renderSplitForm(panel, opts, ctx);
    } else if (activeView === "merge") {
      renderMergeForm(panel, opts, ctx);
    }
  }

  if (error) showToast(panel, error, "error");
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

// ── Public API ──

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
    activePanel = panel;
  },

  hide(): void {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    resetDepositState();
    orderSettling = false;
    if (activeUnsubscribe) {
      activeUnsubscribe();
      activeUnsubscribe = null;
    }
    if (activePanel) {
      activePanel.remove();
      activePanel = null;
    }
    panelOpts = null;
  },

  isVisible(): boolean {
    return activePanel !== null;
  },
};
