/**
 * TradingPanel — renders an inline trading UI below the market card,
 * styled to match the knoww.app web trading form.
 *
 * Layout (order view):
 *   Header → Wallet bar → [Market/Limit toggle + "..." menu] →
 *   [Buy/Sell toggle] → Price (limit) / Slippage (market) →
 *   Amount presets → Order summary → Submit
 *
 * Split/Merge accessible via "..." dropdown menu.
 */

import { USDC_E_ADDRESS } from "@knoww/shared-types/contracts";
import { calculateSlippage } from "@knoww/shared-types/slippage";
import type { ClobOrderType } from "../../types/chrome-messages";
import type { Market } from "../../types/market";
import { escapeHtml } from "../utils";
import { WalletBridge } from "./bridge";
import { CredentialManager } from "./credentials";
import { ProxyWallet } from "./proxy-wallet";
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
  address: string;
  decimals: number;
}

type DepositState =
  | "idle"
  | "loading-balances"
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
let selectedAmount = 10;
let limitPrice = 0;
let expirationPreset: ExpirationPreset = "GTC";
let splitMergeAmount = 0;
let outcomeBalances: {
  yesBalance: number;
  noBalance: number;
  minBalance: number;
} | null = null;
let moreMenuOpen = false;

let orderSettling = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

let depositState: DepositState = "idle";
let depositTokens: DepositToken[] = [];
let depositSelected: DepositToken | null = null;
let depositAmount = "";
let depositError: string | null = null;

let selectedOutcome: "yes" | "no" = "yes";
let yesPrice = 0;

const PRESET_AMOUNTS = [1, 5, 10, 25];
const MIN_MARKETABLE_BUY_NOTIONAL_USD = 1;
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

function elHtml<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  html: string
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  n.innerHTML = html;
  return n;
}

function rerender(): void {
  if (activePanel && panelOpts)
    render(activePanel, panelOpts, TradingService.getContext());
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
  selectedAmount = 10;
  limitPrice = opts.price;
  expirationPreset = "GTC";
  splitMergeAmount = 0;
  outcomeBalances = null;
  moreMenuOpen = false;
  depositState = "idle";
  depositTokens = [];
  depositSelected = null;
  depositAmount = "";
  depositError = null;

  selectedOutcome = opts.outcomeIndex === 1 ? "no" : "yes";
  yesPrice = opts.outcomeIndex === 0 ? opts.price : 1 - opts.price;

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

  const unsub = TradingService.onStateChange((ctx) => render(panel, opts, ctx));
  activeUnsubscribe = unsub;

  WalletBridge.init();

  if (!TradingService.getContext().address) {
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
    TradingService.getOutcomeBalances(opts.yesTokenId, opts.noTokenId)
      .then((b) => {
        outcomeBalances = b;
        rerender();
      })
      .catch(() => {});
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

function addHeader(p: HTMLElement, opts: PanelOptions): void {
  const h = el("div", "knoww-tp-header");
  h.appendChild(el("span", "knoww-tp-title", opts.outcomeName));
  const btn = elHtml("button", "knoww-tp-close", I.close);
  btn.onclick = (e) => {
    e.stopPropagation();
    TradingPanel.hide();
  };
  h.appendChild(btn);
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

  limitPrice = panelOpts.price;
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

function addWalletBar(
  p: HTMLElement,
  address: string,
  ctx: TradingContext,
  opts: PanelOptions
): void {
  const bar = el("div", "knoww-tp-wallet-bar");

  const left = el("div", "knoww-tp-wallet-left");
  const addrCol = el("div", "knoww-tp-addr-col");
  const eoaRow = el("div", "knoww-tp-addr-row");
  eoaRow.appendChild(el("span", "knoww-tp-status-dot"));
  eoaRow.appendChild(el("span", "knoww-tp-addr-tag", "EOA"));
  eoaRow.appendChild(el("span", "knoww-tp-address", truncAddr(address)));
  addrCol.appendChild(eoaRow);
  if (ctx.proxyAddress) {
    const proxyRow = el("div", "knoww-tp-addr-row");
    proxyRow.appendChild(el("span", "knoww-tp-status-dot proxy"));
    proxyRow.appendChild(el("span", "knoww-tp-addr-tag proxy", "Safe"));
    proxyRow.appendChild(
      el("span", "knoww-tp-address", truncAddr(ctx.proxyAddress))
    );
    addrCol.appendChild(proxyRow);
  }
  left.appendChild(addrCol);
  const dcBtn = elHtml("button", "knoww-tp-disconnect-btn", I.disconnect);
  dcBtn.title = "Disconnect wallet";
  dcBtn.onclick = (e) => {
    e.stopPropagation();
    TradingService.reset();
    CredentialManager.clear(address).catch(() => {});
  };
  left.appendChild(dcBtn);

  const right = el("div", "knoww-tp-wallet-right");
  const balLabel = el(
    "span",
    `knoww-tp-bal-label${ctx.balance < 1 ? " knoww-tp-low" : ""}`,
    `$${formatTokenAmount(ctx.balance)}`
  );
  right.appendChild(balLabel);

  const depositBtn = el("button", "knoww-tp-deposit-btn", "Deposit");
  depositBtn.onclick = (e) => {
    e.stopPropagation();
    activeView = "deposit";
    startDepositFlow(address);
  };
  right.appendChild(depositBtn);

  bar.appendChild(left);
  bar.appendChild(right);
  p.appendChild(bar);

  // Portfolio summary
  const yesPos = outcomeBalances?.yesBalance ?? 0;
  const noPos = outcomeBalances?.noBalance ?? 0;
  const hasPosition = yesPos > 0 || noPos > 0;
  const yesPrice = opts.outcomeIndex === 0 ? opts.price : 1 - opts.price;
  const noPrice = 1 - yesPrice;
  const yesValue = yesPos * yesPrice;
  const noValue = noPos * noPrice;
  const positionValue = yesValue + noValue;
  const totalValue = ctx.balance + positionValue;

  const yesLabel = opts.outcomeIndex === 0 ? opts.outcomeName : "Yes";
  const noLabel = opts.outcomeIndex === 0 ? "No" : opts.outcomeName;

  const portfolio = el("div", "knoww-tp-portfolio-bar");

  const cashRow = el("div", "knoww-tp-portfolio-row");
  cashRow.appendChild(el("span", "knoww-tp-portfolio-label", "Cash"));
  cashRow.appendChild(
    el("span", "knoww-tp-portfolio-value", `$${formatTokenAmount(ctx.balance)}`)
  );
  portfolio.appendChild(cashRow);

  if (hasPosition) {
    if (yesPos > 0) {
      const yRow = el("div", "knoww-tp-portfolio-row");
      yRow.appendChild(el("span", "knoww-tp-portfolio-label", `${yesLabel}`));
      yRow.appendChild(
        el(
          "span",
          "knoww-tp-portfolio-value positive",
          `${yesPos.toFixed(1)} shares · $${yesValue.toFixed(2)}`
        )
      );
      portfolio.appendChild(yRow);
    }
    if (noPos > 0) {
      const nRow = el("div", "knoww-tp-portfolio-row");
      nRow.appendChild(el("span", "knoww-tp-portfolio-label", `${noLabel}`));
      nRow.appendChild(
        el(
          "span",
          "knoww-tp-portfolio-value positive",
          `${noPos.toFixed(1)} shares · $${noValue.toFixed(2)}`
        )
      );
      portfolio.appendChild(nRow);
    }
  }

  const totalRow = el("div", "knoww-tp-portfolio-row total");
  totalRow.appendChild(el("span", "knoww-tp-portfolio-label", "Total value"));
  totalRow.appendChild(
    el(
      "span",
      "knoww-tp-portfolio-value lg",
      `$${formatTokenAmount(totalValue)}`
    )
  );
  portfolio.appendChild(totalRow);

  p.appendChild(portfolio);
}

function addDisconnected(p: HTMLElement): void {
  const s = el("div", "knoww-tp-connect-section");
  s.appendChild(elHtml("div", "knoww-tp-wallet-icon", I.wallet));
  s.appendChild(
    el("div", "knoww-tp-connect-msg", "Connect your wallet to start trading")
  );
  const btn = elHtml(
    "button",
    "knoww-tp-btn-connect",
    `${I.wallet} Connect Wallet`
  );
  btn.onclick = (e) => {
    e.stopPropagation();
    TradingService.connectWallet();
  };
  s.appendChild(btn);
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
        `${I.split} Split`
      );
      splitBtn.onclick = (e) => {
        e.stopPropagation();
        moreMenuOpen = false;
        activeView = "split";
        splitMergeAmount = 0;
        rerender();
      };
      menu.appendChild(splitBtn);
      menu.appendChild(el("div", "knoww-tp-more-divider"));
      const mergeBtn = elHtml(
        "button",
        "knoww-tp-more-item",
        `${I.merge} Merge`
      );
      mergeBtn.onclick = (e) => {
        e.stopPropagation();
        moreMenuOpen = false;
        activeView = "merge";
        splitMergeAmount = 0;
        if (opts.yesTokenId && opts.noTokenId) {
          TradingService.getOutcomeBalances(opts.yesTokenId, opts.noTokenId)
            .then((b) => {
              outcomeBalances = b;
              rerender();
            })
            .catch(() => {});
        }
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
    rerender();
  };
  toggle.appendChild(buyBtn);
  toggle.appendChild(sellBtn);
  form.appendChild(toggle);
}

// ── Limit Price Input with +/- Steppers ──

function addLimitPrice(form: HTMLElement, opts: PanelOptions): void {
  if (orderMode !== "limit") return;

  const section = el("div", "knoww-tp-price-section");

  const header = el("div", "knoww-tp-section-header");
  header.appendChild(el("span", "knoww-tp-section-label", "Limit Price"));
  section.appendChild(header);

  const controls = el("div", "knoww-tp-price-controls");
  const minus = el("button", "knoww-tp-price-btn", "−");
  minus.onclick = (e) => {
    e.stopPropagation();
    limitPrice = Math.max(0.01, (limitPrice || opts.price) - 0.01);
    rerender();
  };

  const wrap = el("div", "knoww-tp-price-input-wrap");
  const input = document.createElement("input");
  input.className = "knoww-tp-price-field";
  input.type = "number";
  input.min = "1";
  input.max = "99";
  input.step = "1";
  input.value = String(Math.round((limitPrice || opts.price) * 100));
  input.oninput = () => {
    const v = parseFloat(input.value);
    if (v >= 1 && v <= 99) limitPrice = v / 100;
  };
  wrap.appendChild(input);
  wrap.appendChild(el("span", "knoww-tp-price-cent", "¢"));

  const plus = el("button", "knoww-tp-price-btn", "+");
  plus.onclick = (e) => {
    e.stopPropagation();
    limitPrice = Math.min(0.99, (limitPrice || opts.price) + 0.01);
    rerender();
  };

  controls.appendChild(minus);
  controls.appendChild(wrap);
  controls.appendChild(plus);
  section.appendChild(controls);

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
  opts: PanelOptions,
  ctx: TradingContext
): void {
  if (orderMode !== "market" || !ctx.orderBook || selectedAmount <= 0) return;

  const side = activeSide === "sell" ? "SELL" : "BUY";
  const shares = opts.price > 0 ? selectedAmount / opts.price : 0;
  const slip = calculateSlippage(ctx.orderBook, side, shares);
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
  const effectivePrice =
    orderMode === "limit" ? limitPrice || opts.price : opts.price;
  const isSell = activeSide === "sell";
  const positionSize = getPositionSize(opts);

  const header = el("div", "knoww-tp-section-header");
  header.appendChild(el("span", "knoww-tp-section-label", "Amount"));
  header.appendChild(
    el("span", "knoww-tp-amount-display", `$${selectedAmount}`)
  );
  section.appendChild(header);

  const row = el("div", "knoww-tp-presets");
  for (const amt of PRESET_AMOUNTS) {
    const btn = el(
      "button",
      `knoww-tp-preset${amt === selectedAmount ? " active" : ""}`,
      `$${amt}`
    );
    btn.onclick = (e) => {
      e.stopPropagation();
      selectedAmount = amt;
      rerender();
    };
    row.appendChild(btn);
  }

  const cwrap = el(
    "div",
    `knoww-tp-custom-wrap${!PRESET_AMOUNTS.includes(selectedAmount) ? " active" : ""}`
  );
  const ci = document.createElement("input");
  ci.className = "knoww-tp-custom-input";
  ci.type = "number";
  ci.min = "0.1";
  ci.step = "0.1";
  ci.placeholder = "$ Custom";
  if (!PRESET_AMOUNTS.includes(selectedAmount))
    ci.value = String(selectedAmount);
  ci.onfocus = () => {
    cwrap.classList.add("active");
    for (const b of row.querySelectorAll(".knoww-tp-preset")) {
      b.classList.remove("active");
    }
  };
  ci.oninput = () => {
    const v = Number(ci.value);
    if (v > 0) {
      selectedAmount = v;
      const disp = form.querySelector(".knoww-tp-amount-display");
      if (disp) disp.textContent = `$${v}`;
    }
  };
  cwrap.appendChild(ci);
  row.appendChild(cwrap);
  section.appendChild(row);

  // Shares +/- controls
  const shares = effectivePrice > 0 ? selectedAmount / effectivePrice : 0;
  const sharesHeader = el("div", "knoww-tp-section-header");
  sharesHeader.appendChild(el("span", "knoww-tp-section-label", "Shares"));
  const maxBtn = el("button", "knoww-tp-max-btn", "Max");
  maxBtn.onclick = (e) => {
    e.stopPropagation();
    if (isSell && positionSize > 0) {
      selectedAmount = positionSize * effectivePrice;
    } else if (!isSell && ctx.balance > 0) {
      selectedAmount = Math.floor(ctx.balance * 100) / 100;
    }
    rerender();
  };
  if ((isSell && positionSize <= 0) || (!isSell && ctx.balance <= 0)) {
    maxBtn.disabled = true;
  }
  sharesHeader.appendChild(maxBtn);
  section.appendChild(sharesHeader);

  const sharesRow = el("div", "knoww-tp-shares-row");

  const m10 = el("button", "knoww-tp-shares-btn", "-10");
  m10.onclick = (e) => {
    e.stopPropagation();
    adjustShares(-10, effectivePrice);
  };
  if (shares - 10 < 1) m10.disabled = true;
  sharesRow.appendChild(m10);

  const m1 = el("button", "knoww-tp-shares-btn", "-1");
  m1.onclick = (e) => {
    e.stopPropagation();
    adjustShares(-1, effectivePrice);
  };
  if (shares - 1 < 1) m1.disabled = true;
  sharesRow.appendChild(m1);

  const sharesInput = document.createElement("input");
  sharesInput.className = "knoww-tp-shares-input";
  sharesInput.type = "number";
  sharesInput.min = "1";
  sharesInput.step = "1";
  sharesInput.value = Math.round(shares).toString();
  sharesInput.oninput = () => {
    const v = Number(sharesInput.value);
    if (v > 0 && effectivePrice > 0) {
      selectedAmount = Math.round(v * effectivePrice * 100) / 100;
      const disp = form.querySelector(".knoww-tp-amount-display");
      if (disp) disp.textContent = `$${selectedAmount}`;
    }
  };
  sharesRow.appendChild(sharesInput);

  const p1 = el("button", "knoww-tp-shares-btn", "+1");
  p1.onclick = (e) => {
    e.stopPropagation();
    adjustShares(1, effectivePrice);
  };
  sharesRow.appendChild(p1);

  const p10 = el("button", "knoww-tp-shares-btn", "+10");
  p10.onclick = (e) => {
    e.stopPropagation();
    adjustShares(10, effectivePrice);
  };
  sharesRow.appendChild(p10);

  section.appendChild(sharesRow);
  form.appendChild(section);
}

function getPositionSize(opts: PanelOptions): number {
  if (!outcomeBalances) return 0;
  if (opts.outcomeIndex === 0) return outcomeBalances.yesBalance;
  return outcomeBalances.noBalance;
}

function adjustShares(delta: number, price: number): void {
  if (price <= 0) return;
  const currentShares = price > 0 ? selectedAmount / price : 0;
  const newShares = Math.max(1, Math.round(currentShares) + delta);
  selectedAmount = Math.round(newShares * price * 100) / 100;
  rerender();
}

// ── Order Summary ──

function addOrderSummary(
  form: HTMLElement,
  opts: PanelOptions,
  ctx: TradingContext
): void {
  const isBuy = activeSide === "buy";
  const effectivePrice =
    orderMode === "limit" ? limitPrice || opts.price : opts.price;
  const shares = effectivePrice > 0 ? selectedAmount / effectivePrice : 0;
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

  const r1 = el("div", "knoww-tp-summary-row");
  r1.appendChild(
    el("span", "knoww-tp-summary-label", isBuy ? "Total Cost" : "You Receive")
  );
  r1.appendChild(
    el(
      "span",
      `knoww-tp-summary-value lg${!isBuy ? " positive" : ""}`,
      `$${selectedAmount.toFixed(2)}`
    )
  );
  summary.appendChild(r1);

  const r2 = el("div", "knoww-tp-summary-row");
  r2.appendChild(el("span", "knoww-tp-summary-label", "Est. Shares"));
  r2.appendChild(el("span", "knoww-tp-summary-value", shares.toFixed(2)));
  summary.appendChild(r2);

  if (isBuy && shares > 0 && Math.round(shares) < minShares) {
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
    const r3 = el("div", "knoww-tp-summary-row");
    r3.appendChild(el("span", "knoww-tp-summary-label", "Potential Return"));
    r3.appendChild(
      el("span", "knoww-tp-summary-value positive lg", `$${shares.toFixed(2)}`)
    );
    summary.appendChild(r3);

    const profit = shares - selectedAmount;
    const pct = selectedAmount > 0 ? (profit / selectedAmount) * 100 : 0;
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
  if (selectedAmount <= balance || balance < 0) return;

  const w = el("div", "knoww-tp-balance-warn");

  const top = el("div", "knoww-tp-warn-top");
  const left = el("div", "knoww-tp-warn-left");
  left.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
  left.appendChild(
    el(
      "span",
      "knoww-tp-warn-text",
      `Need $${(selectedAmount - balance).toFixed(2)} more`
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

  const progress = Math.min(100, (balance / selectedAmount) * 100);
  const barBg = el("div", "knoww-tp-warn-bar-bg");
  const barFill = el("div", "knoww-tp-warn-bar-fill");
  barFill.style.width = `${progress}%`;
  barBg.appendChild(barFill);
  w.appendChild(barBg);

  w.appendChild(
    el(
      "div",
      "knoww-tp-warn-detail",
      `$${balance.toFixed(2)} / $${selectedAmount.toFixed(2)} USDC.e`
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
  const {
    balance,
    state,
    orderBook,
    minOrderSize,
    usdcAllowance,
    usdcAllowanceNegRisk,
  } = ctx;
  const isSubmitting = state === "placing-order" || state === "approving";
  const noFunds = activeSide === "buy" && selectedAmount > balance;
  const noAmount = selectedAmount <= 0;
  const effectivePrice =
    orderMode === "limit" ? limitPrice || opts.price : opts.price;
  const shares = effectivePrice > 0 ? selectedAmount / effectivePrice : 0;
  const minShares = Math.max(1, Math.ceil(minOrderSize));
  const belowMinShares = activeSide === "buy" && Math.round(shares) < minShares;
  const relevantAllowance = opts.negRisk ? usdcAllowanceNegRisk : usdcAllowance;
  const needsApproval =
    activeSide === "buy" &&
    selectedAmount > 0 &&
    relevantAllowance < selectedAmount;
  const isMarketableBuy =
    activeSide === "buy" &&
    (orderMode === "market" ||
      (orderMode === "limit" &&
        orderBook &&
        limitPrice >= parseFloat(orderBook.asks?.[0]?.price ?? "1")));
  const belowMinNotional =
    isMarketableBuy && selectedAmount < MIN_MARKETABLE_BUY_NOTIONAL_USD;
  const positionSize = getPositionSize(opts);
  const noPosition =
    activeSide === "sell" && outcomeBalances && positionSize <= 0;
  const overPosition =
    activeSide === "sell" &&
    outcomeBalances &&
    positionSize > 0 &&
    shares - positionSize > positionSize * 0.01;

  const btn = el("button", `knoww-tp-submit ${activeSide}`);

  if (orderSettling) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Settling...`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (isSubmitting) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> ${state === "approving" ? "Approving..." : "Placing Order..."}`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (noAmount) {
    btn.textContent = "Enter Amount";
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
    btn.innerHTML = `${icon} ${side} ${shares.toFixed(0)} @ ${modeLabel}`;
  }

  btn.onclick = async (e) => {
    e.stopPropagation();
    if (btn.disabled || !activePanel) return;
    const panel = activePanel;

    if (needsApproval) {
      try {
        await TradingService.approveUsdc();
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
      // Let the ClobClient auto-calculate the optimal market price from live order book
      price = undefined;
    } else {
      price = limitPrice || opts.price;
      if (expirationPreset === "GTC") {
        clobOrderType = "GTC";
      } else {
        clobOrderType = "GTD";
        expiration =
          Math.floor(Date.now() / 1000) + EXPIRATION_MAP[expirationPreset] + 60;
      }
    }

    try {
      let sellShares = shares;
      if (side === "SELL" && positionSize > 0) {
        const diff = Math.abs(shares - positionSize);
        if (diff < positionSize * 0.01 || shares >= positionSize) {
          sellShares = positionSize;
        }
      }
      const effectiveSize = side === "SELL" ? sellShares : shares;
      const marketAmount = side === "BUY" ? selectedAmount : effectiveSize;
      await TradingService.placeOrder({
        tokenId: opts.tokenId,
        outcomeIndex: opts.outcomeIndex,
        side,
        price: price ?? 0,
        size: effectiveSize,
        amount: marketAmount,
        orderType: clobOrderType,
        expiration,
        negRisk: opts.negRisk,
      });

      orderSettling = true;
      rerender();

      const prevBalance = ctx.balance;
      const prevYes = outcomeBalances?.yesBalance ?? 0;
      const prevNo = outcomeBalances?.noBalance ?? 0;
      const POLL_INTERVAL = 3000;
      const TIMEOUT = 30000;
      const startTime = Date.now();

      const poll = async () => {
        if (!orderSettling) return;

        try {
          await TradingService.refreshBalance();
          if (opts.yesTokenId && opts.noTokenId) {
            const newBal = await TradingService.getOutcomeBalances(
              opts.yesTokenId,
              opts.noTokenId
            );
            outcomeBalances = newBal;
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
        const timedOut = Date.now() - startTime >= TIMEOUT;

        if (balanceChanged || positionChanged || timedOut) {
          orderSettling = false;
          if (settleTimer) {
            clearTimeout(settleTimer);
            settleTimer = null;
          }
          showToast(
            panel,
            timedOut && !balanceChanged && !positionChanged
              ? "Order submitted"
              : "Order filled!",
            "success"
          );
          rerender();
          return;
        }

        settleTimer = setTimeout(poll, POLL_INTERVAL);
      };

      settleTimer = setTimeout(poll, POLL_INTERVAL);
    } catch (err) {
      orderSettling = false;
      showToast(
        panel,
        err instanceof Error ? err.message : "Order failed",
        "error"
      );
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
  addLimitPrice(form, opts);
  addSlippageInfo(form, opts, ctx);
  addAmountSection(form, opts, ctx);
  addOrderSummary(form, opts, ctx);
  addBalanceWarning(form, ctx.balance);
  addSubmitButton(form, opts, ctx);
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
  };
  const maxBtn = el("button", "knoww-tp-max-btn", "Max");
  maxBtn.onclick = (e) => {
    e.stopPropagation();
    splitMergeAmount = balance;
    input.value = String(balance);
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
      await TradingService.splitPosition(opts.conditionId, splitMergeAmount);
      showToast(panel, "Split completed!", "success");
      if (opts.yesTokenId && opts.noTokenId) {
        TradingService.getOutcomeBalances(opts.yesTokenId, opts.noTokenId)
          .then((b) => {
            outcomeBalances = b;
            rerender();
          })
          .catch(() => {});
      }
      TradingService.refreshBalance().catch(() => {});
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
    form.appendChild(el("div", "knoww-tp-info-msg", "Loading balances..."));
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
  };
  const maxBtn = el("button", "knoww-tp-max-btn", "Max");
  maxBtn.onclick = (e) => {
    e.stopPropagation();
    splitMergeAmount = maxMerge;
    input.value = String(maxMerge);
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
      await TradingService.mergePositions(opts.conditionId, splitMergeAmount);
      showToast(panel, "Merge completed!", "success");
      if (opts.yesTokenId && opts.noTokenId) {
        TradingService.getOutcomeBalances(opts.yesTokenId, opts.noTokenId)
          .then((b) => {
            outcomeBalances = b;
            rerender();
          })
          .catch(() => {});
      }
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

function startDepositFlow(eoaAddress: string): void {
  depositState = "loading-balances";
  depositTokens = [];
  depositSelected = null;
  depositAmount = "";
  depositError = null;
  rerender();

  ProxyWallet.getBalance(eoaAddress)
    .then((data) => {
      const tokens: DepositToken[] = [];
      if (data.tokenBalances && data.tokenBalances.length > 0) {
        for (const tb of data.tokenBalances) {
          const def = DEPOSIT_TOKENS.find(
            (d) => d.symbol.toLowerCase() === tb.symbol.toLowerCase()
          );
          if (def && tb.amount > 0) {
            tokens.push({
              symbol: tb.symbol,
              amount: tb.amount,
              address: def.address,
              decimals: def.decimals,
            });
          }
        }
      }
      if (data.polBalance && data.polBalance > 0) {
        tokens.push({
          symbol: "POL",
          amount: data.polBalance,
          address: "native",
          decimals: 18,
        });
      }
      depositTokens = tokens;
      depositState = tokens.length > 0 ? "ready" : "ready";
      if (tokens.length === 1) depositSelected = tokens[0];
      rerender();
    })
    .catch((err) => {
      depositState = "error";
      depositError =
        err instanceof Error ? err.message : "Failed to load balances";
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

async function executeDeposit(ctx: TradingContext): Promise<void> {
  if (!depositSelected || !ctx.address || !ctx.proxyAddress) return;
  const numAmount = parseFloat(depositAmount);
  if (!numAmount || numAmount <= 0 || numAmount > depositSelected.amount)
    return;

  depositState = "pending";
  depositError = null;
  rerender();

  try {
    const amountBig = parseTokenAmount(depositAmount, depositSelected.decimals);

    if (depositSelected.address === "native") {
      await WalletBridge.sendTransaction({
        from: ctx.address,
        to: ctx.proxyAddress,
        value: toHex(amountBig),
      });
    } else {
      const data = encodeErc20Transfer(ctx.proxyAddress, toHex(amountBig));
      await WalletBridge.sendTransaction({
        from: ctx.address,
        to: depositSelected.address,
        data,
      });
    }

    depositState = "confirming";
    rerender();

    const prevBalance = ctx.balance;
    const POLL_INTERVAL = 3000;
    const TIMEOUT = 45000;
    const startTime = Date.now();

    const pollBalance = async () => {
      try {
        await TradingService.refreshBalance();
      } catch {
        /* ignore */
      }

      const newCtx = TradingService.getContext();
      const balanceChanged = newCtx.balance > prevBalance + 0.001;
      const timedOut = Date.now() - startTime >= TIMEOUT;

      if (balanceChanged || timedOut) {
        if (depositPollTimer) {
          clearTimeout(depositPollTimer);
          depositPollTimer = null;
        }
        depositState = "success";
        rerender();
        setTimeout(() => {
          activeView = "order";
          depositState = "idle";
          rerender();
        }, 2000);
        return;
      }

      depositPollTimer = setTimeout(pollBalance, POLL_INTERVAL);
    };

    depositPollTimer = setTimeout(pollBalance, POLL_INTERVAL);
  } catch (err) {
    depositState = "error";
    depositError = err instanceof Error ? err.message : "Transaction failed";
    if (
      depositError.includes("User rejected") ||
      depositError.includes("user rejected")
    ) {
      depositError = "Transaction rejected";
    }
    rerender();
  }
}

function renderDepositForm(p: HTMLElement, ctx: TradingContext): void {
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

  const title = el("div", "knoww-tp-deposit-title", "Deposit to Polymarket");
  form.appendChild(title);

  const subtitle = el(
    "div",
    "knoww-tp-deposit-subtitle",
    "Transfer tokens from your wallet to your trading account"
  );
  form.appendChild(subtitle);

  if (depositState === "loading-balances") {
    const loader = el("div", "knoww-tp-loading-section");
    loader.appendChild(el("div", "knoww-tp-spinner"));
    loader.appendChild(
      el("div", "knoww-tp-loading-text", "Loading wallet balances...")
    );
    form.appendChild(loader);
    p.appendChild(form);
    return;
  }

  if (depositState === "confirming") {
    const confirming = el("div", "knoww-tp-deposit-status");
    confirming.appendChild(el("div", "knoww-tp-spinner"));
    confirming.appendChild(
      el("div", "knoww-tp-deposit-status-text", "Confirming deposit...")
    );
    const newCtx = TradingService.getContext();
    confirming.appendChild(
      el(
        "div",
        "knoww-tp-deposit-status-sub",
        `Balance: $${formatTokenAmount(newCtx.balance)}`
      )
    );
    form.appendChild(confirming);
    p.appendChild(form);
    return;
  }

  if (depositState === "success") {
    const newCtx = TradingService.getContext();
    const success = el("div", "knoww-tp-deposit-status");
    success.appendChild(
      elHtml("span", "knoww-tp-deposit-status-icon success", I.check)
    );
    success.appendChild(
      el("div", "knoww-tp-deposit-status-text", "Deposit confirmed!")
    );
    success.appendChild(
      el(
        "div",
        "knoww-tp-deposit-status-sub",
        `New balance: $${formatTokenAmount(newCtx.balance)}`
      )
    );
    form.appendChild(success);
    p.appendChild(form);
    return;
  }

  if (depositTokens.length === 0 && depositState === "ready") {
    const empty = el("div", "knoww-tp-deposit-empty");
    empty.appendChild(elHtml("span", "knoww-tp-deposit-empty-icon", I.wallet));
    empty.appendChild(
      el("div", "knoww-tp-deposit-empty-text", "No tokens found in your wallet")
    );
    empty.appendChild(
      el(
        "div",
        "knoww-tp-deposit-empty-sub",
        "Make sure you have tokens on Polygon network."
      )
    );
    form.appendChild(empty);
    p.appendChild(form);
    return;
  }

  // Token list
  const tokenHeader = el("div", "knoww-tp-section-header");
  tokenHeader.appendChild(el("span", "knoww-tp-section-label", "Select token"));
  form.appendChild(tokenHeader);

  const tokenList = el("div", "knoww-tp-deposit-token-list");
  for (const tok of depositTokens) {
    const isSelected = depositSelected?.symbol === tok.symbol;
    const row = el(
      "button",
      `knoww-tp-deposit-token-row${isSelected ? " selected" : ""}`
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
    row.appendChild(el("span", "knoww-tp-deposit-token-sym", tok.symbol));
    row.appendChild(
      el("span", "knoww-tp-deposit-token-bal", formatTokenAmount(tok.amount))
    );
    row.onclick = (e) => {
      e.stopPropagation();
      depositSelected = tok;
      depositAmount = "";
      depositError = null;
      rerender();
    };
    tokenList.appendChild(row);
  }
  form.appendChild(tokenList);

  if (!depositSelected) {
    p.appendChild(form);
    return;
  }

  // Amount input
  const amtHeader = el("div", "knoww-tp-section-header");
  amtHeader.appendChild(
    el("span", "knoww-tp-section-label", `Amount (${depositSelected.symbol})`)
  );
  form.appendChild(amtHeader);

  const inputRow = el("div", "knoww-tp-input-row");
  const input = document.createElement("input");
  input.className = "knoww-tp-input-field";
  input.type = "number";
  input.placeholder = "0.00";
  input.step = "any";
  input.value = depositAmount;
  input.setAttribute("data-deposit-input", "true");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  input.oninput = (e) => {
    depositAmount = (e.target as HTMLInputElement).value;
    depositError = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      rerender();
      const restored = activePanel?.querySelector<HTMLInputElement>(
        "[data-deposit-input]"
      );
      if (restored) restored.focus();
    }, 300);
  };
  inputRow.appendChild(input);
  form.appendChild(inputRow);

  // Percentage presets
  const presets = el("div", "knoww-tp-presets");
  for (const pct of [25, 50, 75, 100]) {
    const label = pct === 100 ? "Max" : `${pct}%`;
    const btn = el("button", "knoww-tp-preset", label);
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

  // Transfer summary
  const numAmountForSummary = parseFloat(depositAmount) || 0;
  if (numAmountForSummary > 0 && ctx.address && ctx.proxyAddress) {
    const summary = el("div", "knoww-tp-summary");
    const r1 = el("div", "knoww-tp-summary-row");
    r1.appendChild(el("span", "knoww-tp-summary-label", "From"));
    r1.appendChild(
      el("span", "knoww-tp-summary-value", `Wallet (${truncAddr(ctx.address)})`)
    );
    summary.appendChild(r1);
    const r2 = el("div", "knoww-tp-summary-row");
    r2.appendChild(el("span", "knoww-tp-summary-label", "To"));
    r2.appendChild(
      el(
        "span",
        "knoww-tp-summary-value",
        `Polymarket (${truncAddr(ctx.proxyAddress)})`
      )
    );
    summary.appendChild(r2);
    const r3 = el("div", "knoww-tp-summary-row");
    r3.appendChild(el("span", "knoww-tp-summary-label", "Amount"));
    r3.appendChild(
      el(
        "span",
        "knoww-tp-summary-value",
        `${numAmountForSummary.toFixed(depositSelected.decimals > 6 ? 6 : 2)} ${depositSelected.symbol}`
      )
    );
    summary.appendChild(r3);
    form.appendChild(summary);
  }

  // Error display
  if (depositError) {
    const errRow = el("div", "knoww-tp-deposit-error");
    errRow.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
    errRow.appendChild(el("span", "", depositError));
    form.appendChild(errRow);
  }

  // Enable trading notice
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
      activeView = "order";
      TradingService.deriveCredentials();
    };
    form.appendChild(enableBtn);
    p.appendChild(form);
    return;
  }

  // Submit button
  const numAmt = parseFloat(depositAmount) || 0;
  const isSubmitting = depositState === "pending";
  const overBalance = numAmt > depositSelected.amount;
  const noAmount = numAmt <= 0;

  const btn = el("button", "knoww-tp-submit deposit");
  if (isSubmitting) {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Confirm in MetaMask...`;
    btn.disabled = true;
    btn.classList.add("loading");
  } else if (noAmount) {
    btn.textContent = "Enter amount";
    btn.disabled = true;
  } else if (overBalance) {
    btn.textContent = "Insufficient balance";
    btn.disabled = true;
  } else {
    btn.textContent = `Deposit ${parseFloat(depositAmount).toFixed(2)} ${depositSelected.symbol}`;
  }
  btn.onclick = (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    executeDeposit(ctx);
  };
  form.appendChild(btn);

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

  addHeader(panel, opts);

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

  addWalletBar(panel, address, ctx, opts);

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
    if (depositPollTimer) {
      clearTimeout(depositPollTimer);
      depositPollTimer = null;
    }
    orderSettling = false;
    depositState = "idle";
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
