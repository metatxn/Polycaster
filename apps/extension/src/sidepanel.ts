import { logInfo, logWarn } from "@knoww/logger";
import {
  buildBridgeTokenIndex,
  CHAIN_METADATA,
  formatCheckoutTime,
  getAvailableTokensForChain,
  isPusdToken,
  type QuoteResponse,
  SOLANA_CHAIN_ID,
  type SupportedAsset,
  WITHDRAW_CHAIN_IDS,
  WITHDRAW_TOKEN_CONFIGS,
} from "@knoww/shared-types/bridge";
import { Decimal } from "decimal.js";
import {
  formatPortfolioTokenBaseUnitAmount,
  type PortfolioBridgeStatusSummary,
  type PortfolioWithdrawDestination,
} from "./background/portfolio-withdraw-flow";
import {
  EXTENSION_AUTH_REQUIRED_ERROR,
  TRADING_CREDENTIALS_UPDATED_MESSAGE,
  TRADING_SESSION_DISCONNECTED_MESSAGE,
} from "./types/chrome-messages";

type RuntimeResponse = {
  ok?: boolean;
  error?: string;
  data?: unknown;
};

type SnapshotMarket = {
  id: string;
  title: string;
  source: string;
  imageUrl: string;
  category: string;
  volume: string;
  priceCents: string;
  priceSideLabel: string;
  status: "active" | "seen" | "trending";
  url?: string;
};

type NotificationSnapshot = {
  active?: SnapshotMarket[];
  seen?: SnapshotMarket[];
  trending?: SnapshotMarket[];
  platform?: string;
};

type PortfolioPosition = {
  id: string;
  asset?: string;
  conditionId?: string;
  outcomeIndex?: number;
  outcome: string;
  size: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  negRisk?: boolean;
  market: {
    title: string;
    eventSlug?: string;
    slug?: string;
    icon?: string;
  };
};

type PortfolioTrade = {
  id: string;
  timestamp: string;
  type: "TRADE" | "REDEEM" | "MERGE" | "SPLIT";
  side: "BUY" | "SELL" | null;
  size: number;
  price: number;
  usdcAmount: number;
  outcome: string;
  market: {
    title: string;
    eventSlug?: string;
    slug?: string;
    icon?: string;
  };
};

type PortfolioOpenOrder = {
  id: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  filledSize: number;
  remainingSize: number;
  status: string;
  expiration: string;
  market?: {
    title: string;
    outcome: string;
    eventSlug?: string;
    slug?: string;
    icon?: string;
  };
};

type PortfolioPositionsResponse = {
  positions?: PortfolioPosition[];
  summary?: {
    totalValue?: number;
    totalPnl?: number;
    totalUnrealizedPnl?: number;
    positionCount?: number;
  };
};

type PortfolioTradesResponse = {
  trades?: PortfolioTrade[];
  summary?: {
    totalVolume?: number;
    tradeCount?: number;
  };
};

type PortfolioDetailsResponse = {
  details?: {
    pnl?: number;
    volume?: number;
    rank?: number;
    userName?: string;
  } | null;
};

type PortfolioBalanceResponse = {
  balance?: number;
};

type PortfolioOpenOrdersResponse = {
  orders?: PortfolioOpenOrder[];
  count?: number;
};

type PortfolioData = {
  address: string;
  ownerAddress: string;
  hasTradingCredentials: boolean;
  cashBalance: number;
  openOrders: PortfolioOpenOrdersResponse;
  positions: PortfolioPositionsResponse;
  trades: PortfolioTradesResponse;
  details: PortfolioDetailsResponse;
};

type PortfolioWallet = {
  uuid: string;
  name: string;
  icon?: string;
  rdns?: string;
};

type TradingWalletMode = "deposit" | "safe" | "eoa";
type PortfolioTableView = "positions" | "orders" | "history";

const STACK_MINIMIZE_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m18 15-6-6-6 6"></path>
  </svg>
`;

const STACK_EXPAND_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6"></path>
  </svg>
`;

const SNAPSHOT_REFRESH_INTERVAL_MS = 5_000;
const SEARCH_DEBOUNCE_MS = 300;
const PORTFOLIO_CONNECT_TIMEOUT_MS = 90_000;
const PORTFOLIO_CONNECT_POLL_MS = 1_000;
const PORTFOLIO_REFRESH_INTERVAL_MS = 30_000;
const PORTFOLIO_POSITIONS_FETCH_LIMIT = 50;
const PORTFOLIO_POSITIONS_DISPLAY_LIMIT = 5;
const PORTFOLIO_HISTORY_PAGE_SIZE = 5;
const PORTFOLIO_HISTORY_FETCH_LIMIT = 25;
const PORTFOLIO_AMOUNT_DECIMALS = 6;
const KNOWW_APP_URL = __DEV_MODE__
  ? "http://localhost:8000"
  : "https://knoww.app";
const WALLET_MODE_STORAGE_KEY = "knoww_trading_wallet_mode";

const root = document.getElementById("root");
let portfolioLoaded = false;
let portfolioConnectError: string | null = null;
let portfolioTradingError: string | null = null;
let portfolioTableView: PortfolioTableView = "positions";
let portfolioHistoryPage = 0;
let latestPortfolioData: PortfolioData | null = null;
let portfolioWallets: PortfolioWallet[] | null = null;
let portfolioExpandedPositionId: string | null = null;
let portfolioConfirmingSellPositionId: string | null = null;
let portfolioSellingPositionId: string | null = null;
let portfolioSellErrorPositionId: string | null = null;
let portfolioSellError: string | null = null;
// Mobile-wallet (WalletConnect) pairing. The WalletConnect provider itself runs
// in the content script (where the trading panel uses it); the side panel kicks
// it off and polls for the pairing URI / status to render the QR here.
// Keep in sync with WALLETCONNECT_WALLET_UUID in content/trading/bridge.ts.
const WALLETCONNECT_WALLET_UUID = "__knoww_walletconnect_mobile__";
let portfolioWalletConnectActive = false;
let portfolioWalletConnectToken = 0;
let portfolioWalletConnectQr: string | null = null;
let portfolioWalletConnectError: string | null = null;
let portfolioFundRefreshRun = 0;
const portfolioFundRefreshTimers: ReturnType<typeof setTimeout>[] = [];
const WITHDRAW_QUOTE_DEBOUNCE_MS = 350;
const WITHDRAW_STATUS_POLL_MS = 4500;
const WITHDRAW_STATUS_MAX_POLLS = 40;
let portfolioWithdrawQuoteTimer: ReturnType<typeof setTimeout> | null = null;
let portfolioWithdrawQuoteRun = 0;
let portfolioWithdrawStatusTimer: ReturnType<typeof setTimeout> | null = null;
let portfolioWithdrawStatusRun = 0;
// Inline two-step confirm for cancelling an open order: the first tap "arms"
// the button (turns it into a red Confirm), a second tap commits, and a timer
// auto-reverts it so a stray tap never reaches the live order book.
let armedCancelButton: HTMLButtonElement | null = null;
let cancelConfirmTimer: ReturnType<typeof setTimeout> | null = null;

function sendRuntimeMessage(
  message: Record<string, unknown>
): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] || char
  );
}

function getSnapshotPayload(response: RuntimeResponse): NotificationSnapshot {
  const payload = response.data as { data?: NotificationSnapshot } | undefined;
  return payload?.data || {};
}

function getSearchResultsPayload(response: RuntimeResponse): SnapshotMarket[] {
  const payload = response.data as { data?: SnapshotMarket[] } | undefined;
  return payload?.data || [];
}

function getFetchJsonPayload<T>(response: RuntimeResponse): T | null {
  if (response.ok === false) return null;
  const payload = response as RuntimeResponse & {
    status?: number;
    data?: T;
  };
  if (
    typeof payload.status === "number" &&
    (payload.status < 200 || payload.status >= 300)
  ) {
    return null;
  }
  return payload.data ?? null;
}

function formatMoney(value: number | undefined): string {
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: safeValue >= 1000 ? 0 : 2,
    minimumFractionDigits: safeValue >= 1000 ? 0 : 2,
    style: "currency",
  }).format(safeValue);
}

function formatDecimalMoney(value: Decimal.Value): string {
  const decimal = new Decimal(value);
  const safeValue = decimal.isFinite() ? decimal.toNumber() : 0;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: decimal.greaterThanOrEqualTo(1000) ? 0 : 2,
    minimumFractionDigits: decimal.greaterThanOrEqualTo(1000) ? 0 : 2,
    style: "currency",
  }).format(safeValue);
}

function formatSignedMoney(value: number | undefined): string {
  // Positive P&L is signalled by colour, not a `+` prefix; losses keep the
  // minus sign that Intl currency formatting already supplies.
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  return formatMoney(safeValue);
}

function formatPercent(value: number | undefined): string {
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  return `${safeValue.toFixed(1)}%`;
}

function formatCompactNumber(value: number | undefined): string {
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: safeValue >= 1000 ? 1 : 0,
    notation: safeValue >= 10_000 ? "compact" : "standard",
  }).format(safeValue);
}

function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatTradeTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatOrderExpiration(expiration: string): string {
  if (!expiration || expiration === "0") return "GTC";
  const numeric = Number(expiration);
  const date = Number.isFinite(numeric)
    ? new Date(numeric * 1000)
    : new Date(expiration);
  if (Number.isNaN(date.getTime())) return "GTC";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function normalizePortfolioWalletMode(value: unknown): TradingWalletMode {
  return value === "safe" || value === "eoa" || value === "deposit"
    ? value
    : "deposit";
}

function getWalletModeStorageKey(address: string): string {
  return `${WALLET_MODE_STORAGE_KEY}_${address.toLowerCase()}`;
}

function readStoredWalletMode(address: string): Promise<TradingWalletMode> {
  return new Promise((resolve) => {
    chrome.storage.local.get(getWalletModeStorageKey(address), (result) => {
      if (chrome.runtime.lastError) {
        resolve("deposit");
        return;
      }
      resolve(
        normalizePortfolioWalletMode(result[getWalletModeStorageKey(address)])
      );
    });
  });
}

function formatLiveTimeLabel(): string {
  const now = new Date();
  return `Live · ${now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function renderIcon(market: SnapshotMarket): string {
  if (market.imageUrl) {
    return `
      <div class="knoww-notification-icon">
        <img src="${escapeHtml(market.imageUrl)}" alt="" />
      </div>
    `;
  }

  return `
    <div class="knoww-notification-icon">
      <div class="knoww-notification-icon-fallback">${escapeHtml(
        market.source.slice(0, 1).toUpperCase()
      )}</div>
    </div>
  `;
}

function renderPrice(market: SnapshotMarket): string {
  if (!market.priceCents)
    return `<div class="knoww-notification-prices"></div>`;

  return `
    <div class="knoww-notification-prices">
      <span class="knoww-notification-price-num yes">
        ${escapeHtml(market.priceCents)}
        <span class="knoww-notification-price-cents">¢</span>
      </span>
      <span class="knoww-notification-side-label">${escapeHtml(
        market.priceSideLabel
      )}</span>
    </div>
  `;
}

function renderMeta(market: SnapshotMarket): string {
  const parts = [market.category, market.volume].filter(Boolean);
  if (market.status === "seen") parts.push("Restore");
  if (parts.length === 0) return "";

  return `
    <div class="knoww-notification-meta">
      ${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('<span class="knoww-notification-meta-dot"></span>')}
    </div>
  `;
}

function renderMarketRows(
  markets: SnapshotMarket[] = [],
  status: "active" | "seen" | "trending"
): string {
  if (markets.length === 0) {
    return `
      <div class="knoww-stack-empty knoww-sidepanel-empty">
        <span class="knoww-stack-empty-sub">No markets in this section.</span>
      </div>
    `;
  }

  const statusClass =
    status === "active" || status === "trending"
      ? "knoww-notification-active"
      : "knoww-notification-unavailable";
  const statusAttr = status === "seen" ? "scrolled-out" : status;

  return markets
    .map(
      (market, index) => `
        <button
          type="button"
          class="knoww-notification-item knoww-source-${escapeHtml(
            market.source
          )} ${statusClass}"
          data-market-id="${escapeHtml(market.id)}"
          data-market-source="${escapeHtml(market.source)}"
          data-market-status="${statusAttr}"
          ${
            status === "trending" && market.url
              ? `data-market-url="${escapeHtml(market.url)}"`
              : ""
          }
          style="animation-delay: ${index * 50}ms"
        >
          ${renderIcon(market)}
          <div class="knoww-notification-content">
            <div class="knoww-notification-title">${escapeHtml(
              market.title
            )}</div>
            ${renderMeta(market)}
          </div>
          ${renderPrice(market)}
        </button>
      `
    )
    .join("");
}

function renderSection(
  title: string,
  count: number,
  kind: "active" | "scrolled-out" | "trending",
  rows: string
): string {
  const countLabel = count < 10 ? `0${count}` : String(count);
  return `
    <div class="knoww-stack-section-header">
      <span class="knoww-stack-section-title">
        <span class="knoww-stack-section-dot ${kind}" aria-hidden="true"></span>
        <span>${title}</span>
      </span>
      <span class="knoww-stack-section-count">${countLabel}</span>
    </div>
    ${rows}
  `;
}

async function setPagePanelVisibility(visible: boolean): Promise<void> {
  await sendRuntimeMessage({
    type: "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY",
    visible,
  });
}

async function closeSidePanel(): Promise<void> {
  await sendRuntimeMessage({
    type: "KNOWW_CLOSE_EXTENSION_SIDEPANEL",
  });
}

async function switchToFloatingPanel(): Promise<void> {
  // 1. Persist floating as the home surface (flips openPanelOnActionClick back).
  await sendRuntimeMessage({
    type: "KNOWW_SET_NOTIFICATION_PANEL_SURFACE",
    surface: "floating",
  });
  // 2. Show the notification panel on the current page right away.
  await setPagePanelVisibility(true);
  // 3. Close this side panel last. A side panel reliably closes itself with
  //    window.close() from its own page — unlike chrome.sidePanel.close, which
  //    needs Chrome 141+ and the right tab/window context.
  window.close();
}

function openPortfolioPage(): void {
  window.open(`${KNOWW_APP_URL}/portfolio`, "_blank", "noopener,noreferrer");
}

// Disconnect the connected wallet from the portfolio view — mirrors the
// trading-panel header action. The worker's `auth:logout` clears the knoww.app
// session + cached trading credentials and broadcasts
// TRADING_SESSION_DISCONNECTED_MESSAGE, which the listener below turns into a
// reset to the signed-out screen via clearPortfolioSessionState(). We never
// throw here: the worker clears local state in its own `finally`, so even a
// failed network logout still tears the session down.
let portfolioDisconnecting = false;
async function disconnectPortfolioWallet(
  button: HTMLButtonElement
): Promise<void> {
  if (portfolioDisconnecting) return;
  portfolioDisconnecting = true;
  button.classList.add("is-busy");
  button.title = "Disconnecting…";
  void sendRuntimeMessage({
    type: "analytics:track",
    event: "wallet_disconnected",
  });
  try {
    await sendRuntimeMessage({ type: "auth:logout" });
  } finally {
    portfolioDisconnecting = false;
    button.classList.remove("is-busy");
    button.title = "Disconnect wallet";
  }
}

// Deposit/withdraw move real funds, which can't be signed from the side panel
// (it has no wallet context) and must not be hand-rolled against the funding
// contracts. We deep-link into knoww.app's tested Deposit/Withdraw modals,
// which auto-open via the `?fund=` param.
type PortfolioFundAction = "deposit" | "withdraw";
type DepositStep = "method" | "wallet-token" | "amount" | "bridge";

interface PortfolioWalletToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  amount: number;
  usdValue: number;
  minUsd: number;
  depositSupported?: boolean;
  depositDisabledReason?: string;
}

interface PortfolioWithdrawFormParams {
  amount: string;
  amountDecimal: Decimal;
  chainKey: string;
  tokenId: string;
  destination: string;
}

interface PortfolioWithdrawQuotePayload {
  quote?: QuoteResponse;
  destination?: PortfolioWithdrawDestination;
}

interface PortfolioWithdrawStatusPayload {
  summary?: PortfolioBridgeStatusSummary;
}

let portfolioFundView: PortfolioFundAction | null = null;
let portfolioFundBusy = false;
let portfolioBridgeAssets: SupportedAsset[] | null = null;
let portfolioDepositStep: DepositStep | null = null;
let portfolioWalletTokens: PortfolioWalletToken[] | null = null;
let portfolioDepositToken: PortfolioWalletToken | null = null;

function getPortfolioContainer(): HTMLElement | null {
  return root?.querySelector<HTMLElement>("[data-sidepanel-portfolio]") ?? null;
}

function formatTokenAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  if (amount === 0) return "0";
  if (amount >= 1000) return amount.toLocaleString("en-US");
  return amount
    .toLocaleString("en-US", { maximumFractionDigits: 5 })
    .replace(/\.?0+$/, "");
}

// knoww.app is only the fallback when there's no content tab to sign through.
function openPortfolioFundsFallback(action: PortfolioFundAction): void {
  window.open(
    `${KNOWW_APP_URL}/portfolio?fund=${action}`,
    "_blank",
    "noopener,noreferrer"
  );
}

// Submit button carries an inline spinner + a swappable label. `data-idle-label`
// lets the busy-state toggle restore the original text without re-rendering.
function renderFundSubmitButton(label: string, primary: boolean): string {
  return `
    <button type="button" class="knoww-pf-fund-submit${
      primary ? " primary" : ""
    }" data-fund-submit data-idle-label="${escapeHtml(label)}">
      <span class="knoww-pf-submit-spinner" aria-hidden="true"></span>
      <span class="knoww-pf-submit-label">${escapeHtml(label)}</span>
    </button>`;
}

function setFundSubmitLoading(loading: boolean, loadingLabel?: string): void {
  const container = getPortfolioContainer();
  const btn = container?.querySelector<HTMLButtonElement>("[data-fund-submit]");
  if (!btn) return;
  const labelEl = btn.querySelector<HTMLElement>(".knoww-pf-submit-label");
  btn.classList.toggle("is-loading", loading);
  btn.disabled = loading;
  if (labelEl) {
    labelEl.textContent = loading
      ? (loadingLabel ?? "Working…")
      : btn.dataset.idleLabel || labelEl.textContent || "";
  }
}

function renderPortfolioFundForm(
  action: PortfolioFundAction,
  data: PortfolioData
): string {
  const isDeposit = action === "deposit";
  const title = isDeposit ? "Deposit" : "Withdraw";
  const sub = isDeposit
    ? "Deposit from any supported chain into your trading balance."
    : "Withdraw to any supported chain and token.";
  const chainLabel = isDeposit ? "From chain" : "To chain";
  const eoa = data.ownerAddress;
  return `
    <div class="knoww-pf-fund ${isDeposit ? "is-deposit" : "is-withdraw"}">
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-fund-back aria-label="Back to portfolio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">${escapeHtml(title)}</span>
          <p class="knoww-pf-fund-sub">${escapeHtml(sub)}</p>
        </div>
      </div>
      <div class="knoww-pf-fund-row">
        ${renderFundSelectField(chainLabel, "data-fund-chain")}
        ${renderFundSelectField("Token", "data-fund-token")}
      </div>
      <div class="knoww-pf-fund-field">
        <div class="knoww-pf-fund-field-top">
          <span>Amount</span>
          ${
            isDeposit
              ? ""
              : `<span class="knoww-pf-fund-avail">Available <strong data-fund-avail data-value="${escapeHtml(
                  String(data.cashBalance ?? 0)
                )}">${escapeHtml(formatMoney(data.cashBalance))}</strong></span>`
          }
        </div>
        <div class="knoww-pf-fund-amount">
          <span class="knoww-pf-fund-cur">$</span>
          <input type="text" inputmode="decimal" placeholder="0.00" data-fund-amount autocomplete="off" />
          ${
            isDeposit
              ? ""
              : `<button type="button" class="knoww-pf-amount-max" data-fund-max>Max</button>`
          }
        </div>
      </div>
      ${
        isDeposit
          ? ""
          : `
      <div class="knoww-pf-fund-field">
        <div class="knoww-pf-fund-field-top">
          <span>Recipient address</span>
          <button type="button" class="knoww-pf-fund-max" data-fund-use-eoa data-eoa="${escapeHtml(eoa)}" data-fund-dest-chip>Use my wallet</button>
        </div>
        <input type="text" class="knoww-pf-fund-dest" value="${escapeHtml(eoa)}" placeholder="Recipient wallet on the chosen chain" data-fund-dest data-eoa="${escapeHtml(eoa)}" autocomplete="off" spellcheck="false" />
        <span class="knoww-pf-fund-hint" data-fund-dest-hint>Sends to your connected wallet by default — edit to withdraw elsewhere.</span>
      </div>`
      }
      ${
        isDeposit
          ? ""
          : `<div class="knoww-pf-withdraw-quote" data-withdraw-quote hidden></div>`
      }
      <div class="knoww-pf-fund-status" data-fund-status hidden></div>
      ${renderFundSubmitButton(title, isDeposit)}
    </div>
  `;
}

function renderFundSelectField(label: string, dataAttr: string): string {
  return `
    <div class="knoww-pf-fund-field">
      <div class="knoww-pf-fund-field-top"><span>${escapeHtml(label)}</span></div>
      <div class="knoww-pf-fund-select">
        <select ${dataAttr} aria-label="${escapeHtml(label)}">
          <option value="">Loading…</option>
        </select>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
      </div>
    </div>`;
}

function optionHtml(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${
    selected ? " selected" : ""
  }>${escapeHtml(label)}</option>`;
}

// Chain dropdown options. Deposit values are chainIds (EVM only, since the EVM
// wallet signs the source transfer); withdraw values are chain keys.
function fundChainOptions(
  action: PortfolioFundAction,
  assets: SupportedAsset[]
): string {
  if (action === "deposit") {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const asset of assets) {
      if (asset.chainId === SOLANA_CHAIN_ID || seen.has(asset.chainId))
        continue;
      seen.add(asset.chainId);
      const name = CHAIN_METADATA[asset.chainId]?.name ?? asset.chainName;
      out.push(optionHtml(asset.chainId, name, asset.chainId === "137"));
    }
    return out.join("") || optionHtml("137", "Polygon", true);
  }
  // Withdraw destination chains mirror the web's static set; per-chain tokens
  // are still resolved from the live /supported-assets API (see fundTokenOptions).
  const out: string[] = [];
  for (const chainKey of Object.keys(WITHDRAW_CHAIN_IDS)) {
    const chainId = WITHDRAW_CHAIN_IDS[chainKey];
    const name = CHAIN_METADATA[chainId]?.name ?? chainKey;
    out.push(optionHtml(chainKey, name, chainKey === "polygon"));
  }
  return out.join("") || optionHtml("polygon", "Polygon", true);
}

// Token dropdown options for the currently-selected chain.
function fundTokenOptions(
  action: PortfolioFundAction,
  assets: SupportedAsset[],
  chainValue: string
): string {
  if (action === "deposit") {
    const out: string[] = [];
    for (const asset of assets) {
      if (asset.chainId !== chainValue) continue;
      if (isPusdToken(asset.token.symbol, asset.token.address)) continue;
      const value = [
        asset.chainId,
        asset.token.symbol,
        asset.token.address,
        asset.token.decimals,
      ].join("|");
      const isDefault = asset.token.symbol === "USDC.e";
      out.push(optionHtml(value, asset.token.symbol, isDefault));
    }
    return out.join("") || optionHtml("", "No tokens", false);
  }
  const index = buildBridgeTokenIndex(assets);
  const out: string[] = [];
  for (const tokenId of getAvailableTokensForChain(index, chainValue)) {
    const cfg = WITHDRAW_TOKEN_CONFIGS[tokenId];
    if (!cfg) continue;
    out.push(optionHtml(tokenId, cfg.symbol, tokenId === "usdc-e"));
  }
  return out.join("") || optionHtml("usdc", "USDC", true);
}

function fillFundTokenSelect(
  container: HTMLElement,
  action: PortfolioFundAction,
  assets: SupportedAsset[]
): void {
  const chain =
    container.querySelector<HTMLSelectElement>("[data-fund-chain]")?.value ||
    "";
  const tokenSelect =
    container.querySelector<HTMLSelectElement>("[data-fund-token]");
  if (tokenSelect) {
    tokenSelect.innerHTML = fundTokenOptions(action, assets, chain);
  }
}

// The recipient defaults to the connected EVM wallet, but a Solana destination
// can't receive a 0x address. When the chain flips to/from Solana, swap the
// auto-filled EOA for an empty Solana field (and back) and hide the "Use my
// wallet" shortcut — but never clobber an address the user typed themselves.
function syncFundRecipientForChain(container: HTMLElement): void {
  const dest = container.querySelector<HTMLInputElement>("[data-fund-dest]");
  if (!dest) return;
  const chainValue =
    container.querySelector<HTMLSelectElement>("[data-fund-chain]")?.value ||
    "";
  const isSolana = chainValue === "solana";
  const eoa = dest.dataset.eoa || "";
  const chip = container.querySelector<HTMLElement>("[data-fund-dest-chip]");
  const hint = container.querySelector<HTMLElement>("[data-fund-dest-hint]");

  if (isSolana) {
    if (dest.value === eoa) dest.value = "";
    dest.placeholder = "Solana recipient address";
    if (chip) chip.hidden = true;
    if (hint) hint.textContent = "Paste the Solana wallet to receive funds.";
  } else {
    if (dest.value === "") dest.value = eoa;
    dest.placeholder = "Recipient wallet on the chosen chain";
    if (chip) chip.hidden = false;
    if (hint) {
      hint.textContent =
        "Sends to your connected wallet by default — edit to withdraw elsewhere.";
    }
  }
}

async function loadPortfolioBridgeAssets(
  action: PortfolioFundAction
): Promise<void> {
  const container = getPortfolioContainer();
  const chainSelect =
    container?.querySelector<HTMLSelectElement>("[data-fund-chain]");
  if (!container || !chainSelect) return;
  let assets = portfolioBridgeAssets;
  if (!assets) {
    const response = await sendRuntimeMessage({
      type: "KNOWW_PORTFOLIO_BRIDGE_ASSETS",
    });
    assets =
      (response.data as { assets?: SupportedAsset[] } | undefined)?.assets ??
      [];
    if (assets.length) portfolioBridgeAssets = assets;
  }
  if (portfolioFundView !== action) return;
  chainSelect.innerHTML = fundChainOptions(action, assets);
  fillFundTokenSelect(container, action, assets);
  if (action === "withdraw") schedulePortfolioWithdrawQuote(0);
}

// ── Deposit method screen (Wallet / Transfer Crypto / coming soon) ──
function renderDepositMethodRow(
  n: string,
  id: string,
  name: string,
  meta: string,
  soon: boolean
): string {
  return `
    <button type="button" class="knoww-pf-method${soon ? " is-soon" : ""}"${
      soon ? " disabled" : ` data-deposit-method="${id}"`
    }>
      <span class="knoww-pf-method-n">${escapeHtml(n)}</span>
      <span class="knoww-pf-method-main">
        <span class="knoww-pf-method-name">${escapeHtml(name)}</span>
        <span class="knoww-pf-method-meta">${escapeHtml(meta)}</span>
      </span>
      ${
        soon
          ? `<span class="knoww-pf-method-soon">Soon</span>`
          : `<svg class="knoww-pf-method-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>`
      }
    </button>`;
}

function renderDepositMethod(data: PortfolioData): string {
  const addr = formatAddress(data.ownerAddress);
  return `
    <div class="knoww-pf-fund is-deposit">
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-fund-back aria-label="Back to portfolio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">Deposit · Method</span>
          <p class="knoww-pf-fund-sub">${escapeHtml(formatMoney(data.cashBalance))} balance</p>
        </div>
      </div>
      <div class="knoww-pf-method-list">
        ${renderDepositMethodRow("01", "wallet", `Wallet · ${addr}`, "Polygon · Instant", false)}
        ${renderDepositMethodRow("02", "bridge", "Transfer Crypto", "All chains · Instant", false)}
        ${renderDepositMethodRow("03", "", "Deposit with Card", "Up to $50,000 · ~5 min", true)}
        ${renderDepositMethodRow("04", "", "Connect Exchange", "No limit · ~2 min", true)}
        ${renderDepositMethodRow("05", "", "Deposit with PayPal", "Up to $10,000 · ~5 min", true)}
      </div>
    </div>`;
}

function renderDepositTokenList(): string {
  const tokens = portfolioWalletTokens;
  let body: string;
  if (tokens === null) {
    body = `<div class="knoww-pf-fund-status is-info">Loading your wallet…</div>`;
  } else if (tokens.length === 0) {
    body = `<div class="knoww-pf-fund-status is-info">No deposit tokens found in your wallet on Polygon.</div>`;
  } else {
    body = tokens
      .map((t, i) => {
        // Below the bridge minimum → can't be deposited, so it isn't selectable.
        const priceUnavailable = t.minUsd > 0 && t.usdValue <= 0;
        const belowMin = !priceUnavailable && t.usdValue < t.minUsd;
        const unsupported = t.depositSupported === false;
        const disabled = unsupported || priceUnavailable || belowMin;
        return `
        <button type="button" class="knoww-pf-token${
          disabled ? " is-disabled" : ""
        }"${disabled ? " disabled" : ` data-deposit-token="${i}"`}>
          <span class="knoww-pf-token-id">
            <span class="knoww-pf-token-sym">${escapeHtml(t.symbol)}</span>
            <span class="knoww-pf-token-bal">${escapeHtml(formatTokenAmount(t.amount))}</span>
          </span>
          <span class="knoww-pf-token-meta">
            <span class="knoww-pf-token-min">${
              unsupported
                ? escapeHtml(t.depositDisabledReason || "Unsupported")
                : priceUnavailable
                  ? "Price unavailable"
                  : `${belowMin ? "Below min" : "Min"} · ${escapeHtml(formatMoney(t.minUsd))}`
            }</span>
            <strong>${escapeHtml(formatMoney(t.usdValue))}</strong>
          </span>
        </button>`;
      })
      .join("");
  }
  return `
    <div class="knoww-pf-fund is-deposit">
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-deposit-back="method" aria-label="Back to methods">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">Deposit · Token</span>
          <p class="knoww-pf-fund-sub">Minimum varies by token · typically $2+</p>
        </div>
      </div>
      <div class="knoww-pf-token-list">${body}</div>
    </div>`;
}

function renderDepositAmountStep(token: PortfolioWalletToken): string {
  const sub = isPusdToken(token.symbol, token.address)
    ? "On Polygon · direct transfer"
    : `On Polygon · minimum ${formatMoney(token.minUsd)}`;
  return `
    <div class="knoww-pf-fund is-deposit">
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-deposit-back="wallet-token" aria-label="Back to tokens">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">Deposit · ${escapeHtml(token.symbol)}</span>
          <p class="knoww-pf-fund-sub">${escapeHtml(sub)}</p>
        </div>
      </div>
      <div class="knoww-pf-fund-field">
        <div class="knoww-pf-fund-field-top">
          <span>Amount · ${escapeHtml(token.symbol)}</span>
          <span class="knoww-pf-fund-avail">Balance <strong data-fund-avail data-value="${escapeHtml(String(token.amount))}">${escapeHtml(formatTokenAmount(token.amount))}</strong></span>
        </div>
        <div class="knoww-pf-fund-amount">
          <span class="knoww-pf-fund-cur">${escapeHtml(token.symbol.slice(0, 4))}</span>
          <input type="text" inputmode="decimal" placeholder="0.00" data-fund-amount autocomplete="off" />
          <button type="button" class="knoww-pf-amount-max" data-fund-max>Max</button>
        </div>
      </div>
      <div class="knoww-pf-fund-status" data-fund-status hidden></div>
      ${renderFundSubmitButton(`Deposit ${token.symbol}`, true)}
    </div>`;
}

function setDepositStep(step: DepositStep): void {
  const container = getPortfolioContainer();
  const data = latestPortfolioData;
  if (!container || !data) return;
  portfolioDepositStep = step;
  portfolioFundBusy = false;
  if (step === "method") {
    container.innerHTML = renderDepositMethod(data);
    return;
  }
  if (step === "wallet-token") {
    container.innerHTML = renderDepositTokenList();
    void loadPortfolioWalletTokens();
    return;
  }
  if (step === "amount" && portfolioDepositToken) {
    container.innerHTML = renderDepositAmountStep(portfolioDepositToken);
    container.querySelector<HTMLInputElement>("[data-fund-amount]")?.focus();
    return;
  }
  if (step === "bridge") {
    container.innerHTML = renderPortfolioFundForm("deposit", data);
    container.querySelector<HTMLInputElement>("[data-fund-amount]")?.focus();
    void loadPortfolioBridgeAssets("deposit");
  }
}

async function loadPortfolioWalletTokens(): Promise<void> {
  const data = latestPortfolioData;
  if (!data) return;
  const response = await sendRuntimeMessage({
    type: "KNOWW_PORTFOLIO_WALLET_TOKENS",
    address: data.ownerAddress,
  });
  if (
    portfolioFundView !== "deposit" ||
    portfolioDepositStep !== "wallet-token"
  )
    return;
  portfolioWalletTokens =
    (response.data as { tokens?: PortfolioWalletToken[] } | undefined)
      ?.tokens ?? [];
  const container = getPortfolioContainer();
  if (container) container.innerHTML = renderDepositTokenList();
}

function openPortfolioFunds(action: PortfolioFundAction): void {
  const container = getPortfolioContainer();
  const data = latestPortfolioData;
  // Without loaded portfolio data we can't derive the wallet — hand off to web.
  if (!container || !data) {
    openPortfolioFundsFallback(action);
    return;
  }
  portfolioFundView = action;
  portfolioFundBusy = false;
  clearPortfolioWithdrawFlowTimers();
  portfolioDepositToken = null;
  if (action === "deposit") {
    setDepositStep("method");
    return;
  }
  portfolioDepositStep = null;
  container.innerHTML = renderPortfolioFundForm(action, data);
  container.querySelector<HTMLInputElement>("[data-fund-amount]")?.focus();
  void loadPortfolioBridgeAssets(action);
}

function closePortfolioFunds(): void {
  portfolioFundView = null;
  portfolioFundBusy = false;
  clearPortfolioWithdrawFlowTimers();
  portfolioDepositStep = null;
  portfolioDepositToken = null;
  if (latestPortfolioData) renderPortfolioContent_inPlace();
  else void loadPortfolio(true);
}

function renderPortfolioContent_inPlace(): void {
  const container = getPortfolioContainer();
  if (container && latestPortfolioData) {
    container.innerHTML = renderPortfolioContent(latestPortfolioData);
  }
}

function findPortfolioPosition(positionId: string): PortfolioPosition | null {
  return (
    latestPortfolioData?.positions.positions?.find(
      (position) => position.id === positionId
    ) ?? null
  );
}

function togglePortfolioPositionActions(positionId: string): void {
  portfolioExpandedPositionId =
    portfolioExpandedPositionId === positionId ? null : positionId;
  portfolioConfirmingSellPositionId = null;
  portfolioSellErrorPositionId = null;
  portfolioSellError = null;
  renderPortfolioContent_inPlace();
}

function closePortfolioPositionActions(): void {
  portfolioExpandedPositionId = null;
  portfolioConfirmingSellPositionId = null;
  portfolioSellErrorPositionId = null;
  portfolioSellError = null;
  renderPortfolioContent_inPlace();
}

function requestPortfolioPositionSell(positionId: string): void {
  portfolioExpandedPositionId = positionId;
  portfolioConfirmingSellPositionId = positionId;
  portfolioSellErrorPositionId = null;
  portfolioSellError = null;
  renderPortfolioContent_inPlace();
}

function cancelPortfolioPositionSell(): void {
  portfolioConfirmingSellPositionId = null;
  portfolioSellErrorPositionId = null;
  portfolioSellError = null;
  renderPortfolioContent_inPlace();
}

function viewPortfolioPosition(position: PortfolioPosition): void {
  const url = portfolioMarketUrl(position.market);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

function getPortfolioSellErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message === "NO_CONTENT_TAB") {
    return "Open knoww.app in a tab to sign this sale.";
  }
  if (message && !/\n\s*at\s/.test(message)) return message;
  return "Could not sell this position.";
}

function setPortfolioSellError(positionId: string, error: unknown): void {
  portfolioSellingPositionId = null;
  portfolioSellErrorPositionId = positionId;
  portfolioSellError = getPortfolioSellErrorMessage(error);
  renderPortfolioContent_inPlace();
}

async function sellPortfolioPosition(
  position: PortfolioPosition
): Promise<void> {
  const data = latestPortfolioData;
  if (!data) return;

  if (
    !position.asset ||
    !position.conditionId ||
    typeof position.outcomeIndex !== "number" ||
    !Number.isFinite(position.size) ||
    position.size <= 0
  ) {
    setPortfolioSellError(
      position.id,
      "This position cannot be sold from the side panel."
    );
    return;
  }

  portfolioExpandedPositionId = position.id;
  portfolioConfirmingSellPositionId = position.id;
  portfolioSellingPositionId = position.id;
  portfolioSellErrorPositionId = null;
  portfolioSellError = null;
  renderPortfolioContent_inPlace();

  try {
    const walletMode = await readStoredWalletMode(data.ownerAddress);
    const response = await sendRuntimeMessage({
      type: "KNOWW_SELL_PORTFOLIO_POSITION",
      address: data.ownerAddress,
      proxyAddress: data.address,
      walletMode,
      tokenId: position.asset,
      conditionId: position.conditionId,
      outcomeIndex: position.outcomeIndex,
      size: position.size,
      negRisk: position.negRisk === true,
    });

    if (response.ok === false) {
      throw new Error(response.error || "Could not sell this position.");
    }

    portfolioExpandedPositionId = null;
    portfolioConfirmingSellPositionId = null;
    portfolioSellingPositionId = null;
    portfolioSellErrorPositionId = null;
    portfolioSellError = null;
    await loadPortfolio(true);
  } catch (error) {
    setPortfolioSellError(position.id, error);
  }
}

function clearPortfolioFundRefreshTimers(): void {
  for (const timer of portfolioFundRefreshTimers) clearTimeout(timer);
  portfolioFundRefreshTimers.length = 0;
}

function schedulePortfolioFundRefreshes(action: PortfolioFundAction): void {
  clearPortfolioFundRefreshTimers();
  const run = ++portfolioFundRefreshRun;
  const delays = [2600, 4000, 6500, 10000, 15000, 20000, 30000];

  for (const delay of delays) {
    portfolioFundRefreshTimers.push(
      setTimeout(() => {
        if (run !== portfolioFundRefreshRun) return;
        if (portfolioFundView === action) {
          portfolioFundView = null;
        } else if (portfolioFundView !== null) {
          return;
        }
        void loadPortfolio(true);
      }, delay)
    );
  }
}

function setPortfolioFundStatus(
  kind: "info" | "error" | "success",
  message: string
): void {
  const status =
    getPortfolioContainer()?.querySelector<HTMLElement>("[data-fund-status]");
  if (!status) return;
  status.hidden = false;
  status.className = `knoww-pf-fund-status is-${kind}`;
  status.textContent = message;
}

function parsePortfolioAmount(value: string): Decimal | null {
  try {
    const amount = new Decimal(value);
    return amount.isFinite() ? amount : null;
  } catch {
    return null;
  }
}

function normalizePortfolioAmountInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return "";

  const dotIndex = cleaned.indexOf(".");
  if (dotIndex === -1) {
    return cleaned.replace(/^0+(?=\d)/, "");
  }

  const wholeRaw = cleaned.slice(0, dotIndex).replace(/\./g, "");
  const fractionalRaw = cleaned
    .slice(dotIndex + 1)
    .replace(/\./g, "")
    .slice(0, PORTFOLIO_AMOUNT_DECIMALS);
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  return `${whole}.${fractionalRaw}`;
}

function formatPortfolioAmountInputValue(value: string): string {
  const amount = parsePortfolioAmount(value);
  if (!amount || amount.lt(0)) return "0";
  return amount
    .toDecimalPlaces(PORTFOLIO_AMOUNT_DECIMALS, Decimal.ROUND_DOWN)
    .toFixed();
}

function readPortfolioWithdrawParams(
  reportErrors: boolean
): PortfolioWithdrawFormParams | null {
  const container = getPortfolioContainer();
  const data = latestPortfolioData;
  if (!container || !data) return null;

  const amount = (
    container.querySelector<HTMLInputElement>("[data-fund-amount]")?.value || ""
  ).trim();
  const amountDecimal = parsePortfolioAmount(amount);
  if (!amount || !amountDecimal || amountDecimal.lte(0)) {
    if (reportErrors) {
      setPortfolioFundStatus("error", "Enter an amount greater than zero.");
    }
    return null;
  }

  const chainKey =
    container.querySelector<HTMLSelectElement>("[data-fund-chain]")?.value ||
    "";
  const tokenId =
    container.querySelector<HTMLSelectElement>("[data-fund-token]")?.value ||
    "";
  const destination = (
    container.querySelector<HTMLInputElement>("[data-fund-dest]")?.value || ""
  ).trim();
  if (!chainKey || !tokenId) {
    if (reportErrors)
      setPortfolioFundStatus("error", "Select a chain and token.");
    return null;
  }

  const isSolana = chainKey === "solana";
  const validEvm = /^0x[0-9a-fA-F]{40}$/.test(destination);
  const validSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destination);
  if (!destination || (isSolana ? !validSol : !validEvm)) {
    if (reportErrors) {
      setPortfolioFundStatus(
        "error",
        isSolana
          ? "Enter a valid Solana recipient address."
          : "Enter a valid 0x recipient address."
      );
    }
    return null;
  }

  const available = new Decimal(data.cashBalance || 0);
  if (amountDecimal.gt(available.plus("0.000000001"))) {
    if (reportErrors) {
      setPortfolioFundStatus("error", "Amount exceeds your available balance.");
    }
    return null;
  }

  return { amount, amountDecimal, chainKey, tokenId, destination };
}

function clearPortfolioWithdrawQuoteTimer(): void {
  if (portfolioWithdrawQuoteTimer) clearTimeout(portfolioWithdrawQuoteTimer);
  portfolioWithdrawQuoteTimer = null;
  portfolioWithdrawQuoteRun++;
}

function clearPortfolioWithdrawStatusTimer(): void {
  if (portfolioWithdrawStatusTimer) clearTimeout(portfolioWithdrawStatusTimer);
  portfolioWithdrawStatusTimer = null;
  portfolioWithdrawStatusRun++;
}

function clearPortfolioWithdrawFlowTimers(): void {
  clearPortfolioWithdrawQuoteTimer();
  clearPortfolioWithdrawStatusTimer();
}

function hidePortfolioWithdrawQuote(): void {
  const quote = getPortfolioContainer()?.querySelector<HTMLElement>(
    "[data-withdraw-quote]"
  );
  if (!quote) return;
  quote.hidden = true;
  quote.innerHTML = "";
}

function setPortfolioWithdrawQuote(kind: "info" | "error", html: string): void {
  const quote = getPortfolioContainer()?.querySelector<HTMLElement>(
    "[data-withdraw-quote]"
  );
  if (!quote) return;
  quote.hidden = false;
  quote.className = `knoww-pf-withdraw-quote is-${kind}`;
  quote.innerHTML = html;
}

function renderPortfolioWithdrawQuote(
  payload: PortfolioWithdrawQuotePayload
): void {
  const quote = payload.quote;
  const destination = payload.destination;
  if (!quote || !destination) {
    hidePortfolioWithdrawQuote();
    return;
  }

  const outputAmount = formatPortfolioTokenBaseUnitAmount(
    quote.estToTokenBaseUnit,
    destination.tokenDecimals
  );
  const feeUsd = new Decimal(quote.estFeeBreakdown?.totalImpactUsd ?? 0);
  const feeLabel = feeUsd.lte(0) ? "Free" : formatDecimalMoney(feeUsd);
  const timeLabel = formatCheckoutTime(quote.estCheckoutTimeMs);
  setPortfolioWithdrawQuote(
    "info",
    `
      <div class="knoww-pf-withdraw-quote-row">
        <span>You receive</span>
        <strong>${escapeHtml(outputAmount)} ${escapeHtml(destination.tokenSymbol)}</strong>
      </div>
      <div class="knoww-pf-withdraw-quote-row">
        <span>Fee</span>
        <strong>${escapeHtml(feeLabel)}</strong>
      </div>
      <div class="knoww-pf-withdraw-quote-row">
        <span>Est. time</span>
        <strong>${escapeHtml(timeLabel)}</strong>
      </div>
    `
  );
}

async function requestPortfolioWithdrawQuote(
  params: PortfolioWithdrawFormParams
): Promise<RuntimeResponse> {
  logInfo("portfolio.withdraw.ui.quote.request", {
    amount: params.amount,
    chainKey: params.chainKey,
    tokenId: params.tokenId,
    recipientAddress: params.destination,
  });
  const response = await sendRuntimeMessage({
    type: "KNOWW_PORTFOLIO_WITHDRAW_QUOTE",
    amount: params.amount,
    destination: params.destination,
    chainKey: params.chainKey,
    tokenId: params.tokenId,
  });
  if (!response.ok) {
    logWarn("portfolio.withdraw.ui.quote.failed", {
      error: response.error,
      amount: params.amount,
      chainKey: params.chainKey,
      tokenId: params.tokenId,
      recipientAddress: params.destination,
    });
  }
  return response;
}

function schedulePortfolioWithdrawQuote(
  delay = WITHDRAW_QUOTE_DEBOUNCE_MS
): void {
  if (portfolioFundView !== "withdraw") return;
  clearPortfolioWithdrawQuoteTimer();
  const params = readPortfolioWithdrawParams(false);
  if (!params) {
    hidePortfolioWithdrawQuote();
    return;
  }

  const run = ++portfolioWithdrawQuoteRun;
  portfolioWithdrawQuoteTimer = setTimeout(() => {
    void (async () => {
      setPortfolioWithdrawQuote(
        "info",
        `<div class="knoww-pf-withdraw-quote-row"><span>Route</span><strong>Checking quote...</strong></div>`
      );
      const response = await requestPortfolioWithdrawQuote(params);
      if (run !== portfolioWithdrawQuoteRun || portfolioFundView !== "withdraw")
        return;
      if (!response.ok) {
        setPortfolioWithdrawQuote(
          "error",
          `<div class="knoww-pf-withdraw-quote-row"><span>Quote</span><strong>${escapeHtml(
            response.error || "Quote unavailable"
          )}</strong></div>`
        );
        return;
      }
      renderPortfolioWithdrawQuote(
        (response.data as PortfolioWithdrawQuotePayload | undefined) ?? {}
      );
    })();
  }, delay);
}

function startPortfolioWithdrawStatusPolling(bridgeAddress: string): void {
  clearPortfolioWithdrawStatusTimer();
  const run = ++portfolioWithdrawStatusRun;
  let polls = 0;

  const poll = async (): Promise<void> => {
    if (run !== portfolioWithdrawStatusRun || portfolioFundView !== "withdraw")
      return;
    polls += 1;
    const response = await sendRuntimeMessage({
      type: "KNOWW_PORTFOLIO_WITHDRAW_STATUS",
      bridgeAddress,
    });
    if (run !== portfolioWithdrawStatusRun || portfolioFundView !== "withdraw")
      return;

    if (response.ok) {
      const summary = (
        response.data as PortfolioWithdrawStatusPayload | undefined
      )?.summary;
      if (summary) {
        if (summary.completed) {
          portfolioFundBusy = false;
          setPortfolioFundStatus("success", "Withdrawal completed.");
          schedulePortfolioFundRefreshes("withdraw");
          return;
        }
        if (summary.failed) {
          portfolioFundBusy = false;
          setPortfolioFundStatus(
            "error",
            "Bridge failed. Try a smaller amount or retry later."
          );
          return;
        }
        setPortfolioFundStatus("info", `Bridge status: ${summary.text}.`);
      }
    }

    if (polls >= WITHDRAW_STATUS_MAX_POLLS) {
      portfolioFundBusy = false;
      setPortfolioFundStatus(
        "info",
        "Bridge is still processing. Refresh portfolio shortly."
      );
      schedulePortfolioFundRefreshes("withdraw");
      return;
    }

    portfolioWithdrawStatusTimer = setTimeout(
      () => void poll(),
      WITHDRAW_STATUS_POLL_MS
    );
  };

  portfolioWithdrawStatusTimer = setTimeout(() => void poll(), 1500);
}

function isAuthRequiredError(error?: string): boolean {
  if (!error) return false;
  return (
    error === EXTENSION_AUTH_REQUIRED_ERROR ||
    error.toLowerCase().includes("auth required")
  );
}

/**
 * Re-run the knoww.app sign-in challenge in the content tab (clear any stale
 * token, then prompt the wallet to sign a fresh challenge) so the worker can
 * mint a new session token. Returns ok=false with a reason if it can't.
 */
async function reauthPortfolioSession(
  address: string
): Promise<{ ok: boolean; error?: string }> {
  const response = await sendRuntimeMessage({
    type: "KNOWW_PORTFOLIO_REAUTH",
    address,
  });
  if (response.ok === false) {
    return {
      ok: false,
      error:
        response.error === "NO_CONTENT_TAB"
          ? "Open a supported page (e.g. Polymarket) with your wallet, then retry."
          : response.error,
    };
  }
  const payload = response.data as
    | { success?: boolean; data?: { error?: string } }
    | undefined;
  if (payload?.success === false) {
    return { ok: false, error: payload.data?.error };
  }
  return { ok: true };
}

async function submitPortfolioFund(action: PortfolioFundAction): Promise<void> {
  const container = getPortfolioContainer();
  const data = latestPortfolioData;
  if (!container || !data || portfolioFundBusy) return;

  const amount = (
    container.querySelector<HTMLInputElement>("[data-fund-amount]")?.value || ""
  ).trim();
  const amountDecimal = parsePortfolioAmount(amount);
  if (!amount || !amountDecimal || amountDecimal.lte(0)) {
    setPortfolioFundStatus("error", "Enter an amount greater than zero.");
    return;
  }

  let fundParams: Record<string, unknown>;
  let withdrawParams: PortfolioWithdrawFormParams | null = null;
  let withdrawQuotePayload: PortfolioWithdrawQuotePayload | undefined;

  // Deposit · Wallet path — token chosen from the wallet balance list.
  if (action === "deposit" && portfolioDepositStep === "amount") {
    const token = portfolioDepositToken;
    if (!token) {
      setPortfolioFundStatus("error", "Select a token to deposit.");
      return;
    }
    if (token.depositSupported === false) {
      setPortfolioFundStatus(
        "error",
        `${token.symbol} is not supported for Polygon deposits.`
      );
      return;
    }
    if (amountDecimal.gt(new Decimal(token.amount).plus("0.000000001"))) {
      setPortfolioFundStatus("error", "Amount exceeds your wallet balance.");
      return;
    }
    if (token.minUsd > 0 && token.usdValue <= 0) {
      setPortfolioFundStatus(
        "error",
        "Token price is unavailable. Refresh and try again."
      );
      return;
    }
    const amountUsd = amountDecimal.mul(
      new Decimal(token.usdValue).div(token.amount || 1)
    );
    if (amountUsd.lt(token.minUsd)) {
      setPortfolioFundStatus(
        "error",
        `Minimum deposit is ${formatMoney(token.minUsd)}.`
      );
      return;
    }
    fundParams = {
      chainId: "137",
      tokenSymbol: token.symbol,
      tokenAddress: token.address,
      tokenDecimals: token.decimals,
    };
  } else {
    // Deposit · Transfer Crypto (chain/token dropdowns) or any withdraw.
    const chainValue =
      container.querySelector<HTMLSelectElement>("[data-fund-chain]")?.value ||
      "";
    const tokenValue =
      container.querySelector<HTMLSelectElement>("[data-fund-token]")?.value ||
      "";
    if (!chainValue || !tokenValue) {
      setPortfolioFundStatus("error", "Select a chain and token.");
      return;
    }
    if (action === "deposit") {
      const [chainId, tokenSymbol, tokenAddress, tokenDecimals] =
        tokenValue.split("|");
      fundParams = {
        chainId,
        tokenSymbol,
        tokenAddress,
        tokenDecimals: Number(tokenDecimals),
      };
    } else {
      withdrawParams = readPortfolioWithdrawParams(true);
      if (!withdrawParams) return;
      logInfo("portfolio.withdraw.ui.form.selected", {
        amount: withdrawParams.amount,
        chainKey: withdrawParams.chainKey,
        tokenId: withdrawParams.tokenId,
        recipientAddress: withdrawParams.destination,
      });
      fundParams = {
        destination: withdrawParams.destination,
        chainKey: withdrawParams.chainKey,
        tokenId: withdrawParams.tokenId,
      };
    }
  }

  portfolioFundBusy = true;
  const loadingLabel = action === "deposit" ? "Depositing…" : "Withdrawing…";
  setFundSubmitLoading(
    true,
    action === "withdraw" ? "Getting quote…" : loadingLabel
  );

  if (action === "withdraw" && withdrawParams) {
    setPortfolioFundStatus("info", "Checking withdrawal route…");
    const quoteResponse = await requestPortfolioWithdrawQuote(withdrawParams);
    if (portfolioFundView !== action) return;
    if (!quoteResponse.ok) {
      portfolioFundBusy = false;
      setFundSubmitLoading(false);
      setPortfolioFundStatus(
        "error",
        quoteResponse.error || "Could not prepare the withdrawal."
      );
      return;
    }
    withdrawQuotePayload =
      (quoteResponse.data as PortfolioWithdrawQuotePayload | undefined) ??
      undefined;
    renderPortfolioWithdrawQuote(withdrawQuotePayload ?? {});
    setFundSubmitLoading(true, loadingLabel);
  }

  setPortfolioFundStatus("info", "Confirm the transaction in your wallet…");

  const walletMode = await readStoredWalletMode(data.ownerAddress);
  const sendFundRequest = (): Promise<RuntimeResponse> =>
    sendRuntimeMessage({
      type:
        action === "deposit"
          ? "KNOWW_PORTFOLIO_DEPOSIT"
          : "KNOWW_PORTFOLIO_WITHDRAW",
      address: data.ownerAddress,
      walletMode,
      amount,
      ...fundParams,
      ...(action === "withdraw" && withdrawQuotePayload?.quote
        ? { quote: withdrawQuotePayload.quote }
        : {}),
    });

  if (action === "withdraw" && withdrawParams) {
    logInfo("portfolio.withdraw.ui.submit.request", {
      ownerAddress: data.ownerAddress,
      walletMode,
      amount,
      chainKey: withdrawParams.chainKey,
      tokenId: withdrawParams.tokenId,
      recipientAddress: withdrawParams.destination,
    });
  }
  let response = await sendFundRequest();
  if (portfolioFundView !== action) return;

  // The knoww.app session token lives in the worker's session storage and is
  // dropped on browser restart / expiry. When the relayer pre-flight reports it
  // missing, walk the user back through the sign-in challenge and retry once.
  if (!response.ok && isAuthRequiredError(response.error)) {
    setFundSubmitLoading(true, "Re-authorizing…");
    setPortfolioFundStatus(
      "info",
      "Session expired — approve the sign-in request in your wallet to continue…"
    );
    const reauth = await reauthPortfolioSession(data.ownerAddress);
    if (portfolioFundView !== action) return;
    if (!reauth.ok) {
      portfolioFundBusy = false;
      setFundSubmitLoading(false);
      setPortfolioFundStatus(
        "error",
        reauth.error
          ? formatPortfolioTransactionError(reauth.error)
          : "Could not re-authorize. Try again."
      );
      return;
    }
    setFundSubmitLoading(true, loadingLabel);
    setPortfolioFundStatus("info", "Confirm the transaction in your wallet…");
    if (action === "withdraw" && withdrawParams) {
      logInfo("portfolio.withdraw.ui.submit.retry", {
        ownerAddress: data.ownerAddress,
        walletMode,
        amount,
        chainKey: withdrawParams.chainKey,
        tokenId: withdrawParams.tokenId,
        recipientAddress: withdrawParams.destination,
      });
    }
    response = await sendFundRequest();
    if (portfolioFundView !== action) return;
  }

  if (response.ok) {
    portfolioFundBusy = false;
    setFundSubmitLoading(false);
    if (action === "withdraw") {
      const payload = response.data as
        | {
            bridgeAddress?: string;
            route?: "bridge" | "direct";
            destination?: PortfolioWithdrawDestination;
          }
        | undefined;
      logInfo("portfolio.withdraw.ui.submit.response", {
        bridgeAddress: payload?.bridgeAddress,
        chainKey: payload?.destination?.chainKey,
        route: payload?.route,
        routeKind: payload?.destination?.routeKind,
        tokenId: payload?.destination?.tokenId,
        tokenSymbol: payload?.destination?.tokenSymbol,
        toChainId: payload?.destination?.toChainId,
        toTokenAddress: payload?.destination?.toTokenAddress,
        recipientAddress: withdrawParams?.destination,
      });
      const tokenSymbol =
        payload?.destination?.tokenSymbol || "the selected token";
      setPortfolioFundStatus(
        payload?.route === "direct" ? "success" : "info",
        payload?.route === "direct"
          ? `Withdrawal submitted for ${tokenSymbol}.`
          : `Withdrawal sent to bridge for ${tokenSymbol}. Waiting for completion...`
      );
      if (payload?.bridgeAddress) {
        startPortfolioWithdrawStatusPolling(payload.bridgeAddress);
      } else {
        schedulePortfolioFundRefreshes(action);
      }
      return;
    }
    setPortfolioFundStatus(
      "success",
      "Deposit submitted. Funds appear once processing completes."
    );
    schedulePortfolioFundRefreshes(action);
    return;
  }

  portfolioFundBusy = false;
  setFundSubmitLoading(false);
  if (action === "withdraw" && withdrawParams) {
    logWarn("portfolio.withdraw.ui.submit.failed", {
      error: response.error,
      ownerAddress: data.ownerAddress,
      walletMode,
      amount,
      chainKey: withdrawParams.chainKey,
      tokenId: withdrawParams.tokenId,
      recipientAddress: withdrawParams.destination,
    });
  }
  if (response.error === "NO_CONTENT_TAB") {
    setPortfolioFundStatus(
      "error",
      "Open a supported page (e.g. Polymarket) with your wallet, then retry — or finish on knoww.app."
    );
    openPortfolioFundsFallback(action);
    return;
  }
  // The signing relay couldn't reach the wallet's content tab (closed, navigated
  // away, or never connected there). Point the user back to the connected page.
  if (isSigningBridgeUnreachable(response.error)) {
    setPortfolioFundStatus(
      "error",
      "Couldn't reach your wallet. Open the page where you connected it (e.g. Polymarket), keep it active, then retry."
    );
    return;
  }
  setPortfolioFundStatus(
    "error",
    formatPortfolioTransactionError(response.error)
  );
}

function isSigningBridgeUnreachable(error?: string): boolean {
  if (!error) return false;
  return (
    error.includes("Receiving end does not exist") ||
    error.includes("Could not establish connection") ||
    error.includes("Extension context invalidated")
  );
}

function formatPortfolioTransactionError(error?: string): string {
  if (!error) return "Could not complete the transaction.";
  if (
    /user rejected|request rejected|rejected the request|denied|4001/i.test(
      error
    )
  ) {
    return "Transaction rejected.";
  }
  return error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortfolioSessionAddress(): Promise<string | null> {
  const deadline = Date.now() + PORTFOLIO_CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const address = await getPortfolioSessionAddress();
    if (address) return address;
    await sleep(PORTFOLIO_CONNECT_POLL_MS);
  }
  return null;
}

async function waitForPortfolioTradingEnabled(
  address: string
): Promise<boolean> {
  const deadline = Date.now() + PORTFOLIO_CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await getPortfolioTradingStatus(address);
    if (status.hasCredentials) return true;
    await sleep(PORTFOLIO_CONNECT_POLL_MS);
  }
  return false;
}

async function connectPortfolioWallet(walletUuid: string): Promise<void> {
  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (container) {
    container.innerHTML = `
      <div class="knoww-portfolio-loading">Connecting wallet...</div>
    `;
  }

  const response = await sendRuntimeMessage({
    type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
    walletUuid,
  });
  const payload = response.data as
    | { success?: boolean; data?: { error?: string } }
    | undefined;

  if (response.ok === false || payload?.success === false) {
    portfolioLoaded = false;
    portfolioConnectError =
      payload?.data?.error || response.error || "Failed to connect wallet.";
    if (container) container.innerHTML = renderPortfolioSignedOut();
    return;
  }

  if (container) {
    container.innerHTML = `
      <div class="knoww-portfolio-loading">Approve the wallet prompts...</div>
    `;
  }

  const sessionAddress = await waitForPortfolioSessionAddress();
  if (!sessionAddress) {
    portfolioLoaded = false;
    portfolioConnectError =
      "Wallet connection did not finish. Approve the wallet prompts and try again.";
    if (container) container.innerHTML = renderPortfolioSignedOut();
    return;
  }

  portfolioConnectError = null;
  portfolioTradingError = null;
  portfolioLoaded = false;
  await loadPortfolio(true);
}

function renderPortfolioWalletConnect(): string {
  const error = portfolioWalletConnectError;
  const qr = portfolioWalletConnectQr;
  return `
    <div class="knoww-portfolio-signed-out knoww-pf-wc">
      <p class="knoww-pf-empty-title">Scan to connect</p>
      <span class="knoww-pf-empty-sub">
        Open your wallet app, scan this code, then approve the connection.
      </span>
      <div class="knoww-pf-wc-frame">
        ${
          qr
            ? `<div class="knoww-pf-wc-qr">${qr}</div>`
            : error
              ? `<div class="knoww-pf-wc-status is-error">${escapeHtml(error)}</div>`
              : `<div class="knoww-pf-wc-status"><span class="knoww-pf-wc-spinner" aria-hidden="true"></span>Preparing secure link…</div>`
        }
      </div>
      <span class="knoww-pf-wc-hint">Works with MetaMask, Rainbow, Trust &amp; any WalletConnect wallet.</span>
      <div class="knoww-portfolio-actions">
        <button type="button" class="knoww-portfolio-open" data-walletconnect-cancel>
          Back to wallets
        </button>
      </div>
    </div>
  `;
}

async function connectPortfolioWalletConnect(): Promise<void> {
  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  const token = ++portfolioWalletConnectToken;
  portfolioWalletConnectActive = true;
  portfolioWalletConnectQr = null;
  portfolioWalletConnectError = null;
  portfolioConnectError = null;
  if (container) container.innerHTML = renderPortfolioWalletConnect();

  // Kick off the WalletConnect session in the content script (same rail the
  // trading panel uses). The pairing URI is generated there and polled below.
  await sendRuntimeMessage({
    type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
    walletUuid: WALLETCONNECT_WALLET_UUID,
  });

  const deadline = Date.now() + 180_000; // WalletConnect pairing TTL ~3 min.
  while (
    portfolioWalletConnectActive &&
    portfolioWalletConnectToken === token
  ) {
    // A finished connection resolves the Knoww session — load and exit.
    const sessionAddress = await getPortfolioSessionAddress();
    if (sessionAddress) {
      portfolioWalletConnectActive = false;
      portfolioConnectError = null;
      portfolioTradingError = null;
      portfolioLoaded = false;
      await loadPortfolio(true);
      return;
    }

    const response = await sendRuntimeMessage({
      type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE",
    });
    if (portfolioWalletConnectToken !== token) return;

    if (response.ok === false) {
      portfolioWalletConnectError =
        response.error || "Could not prepare the WalletConnect QR code.";
      portfolioWalletConnectQr = null;
      if (container) container.innerHTML = renderPortfolioWalletConnect();
      portfolioWalletConnectActive = false;
      return;
    }

    const payload = response.data as
      | {
          data?: { status?: string; error?: string; qrSvg?: string | null };
        }
      | undefined;
    const wc = payload?.data;

    if (wc?.error) {
      portfolioWalletConnectError = wc.error;
      portfolioWalletConnectQr = null;
    } else if (
      typeof wc?.qrSvg === "string" &&
      wc.qrSvg !== portfolioWalletConnectQr
    ) {
      portfolioWalletConnectQr = wc.qrSvg;
      portfolioWalletConnectError = null;
    }

    if (
      container &&
      container === root?.querySelector("[data-sidepanel-portfolio]")
    ) {
      container.innerHTML = renderPortfolioWalletConnect();
    }

    if (Date.now() > deadline) {
      portfolioWalletConnectError =
        "The connection request timed out. Go back and try again.";
      if (container) container.innerHTML = renderPortfolioWalletConnect();
      portfolioWalletConnectActive = false;
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

function cancelPortfolioWalletConnect(): void {
  portfolioWalletConnectActive = false;
  portfolioWalletConnectToken++;
  portfolioWalletConnectQr = null;
  portfolioWalletConnectError = null;
  // Tear down the in-flight pairing in the content script so the relay
  // subscription is released and a later reconnect starts a fresh QR.
  void sendRuntimeMessage({ type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" });
  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (container) container.innerHTML = renderPortfolioSignedOut();
}

async function enablePortfolioTrading(ownerAddress: string): Promise<void> {
  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (container) {
    container.innerHTML = `
      <div class="knoww-portfolio-loading">Approve the trading signature...</div>
    `;
  }

  const response = await sendRuntimeMessage({
    type: "KNOWW_ENABLE_PORTFOLIO_TRADING",
    address: ownerAddress,
  });
  const payload = response.data as
    | { success?: boolean; data?: { error?: string } }
    | undefined;

  if (response.ok === false || payload?.success === false) {
    portfolioLoaded = false;
    portfolioTradingError =
      payload?.data?.error || response.error || "Failed to enable trading.";
    if (container) await loadPortfolio(true);
    return;
  }

  const enabled = await waitForPortfolioTradingEnabled(ownerAddress);
  if (!enabled) {
    portfolioLoaded = false;
    portfolioTradingError =
      "Trading was not enabled. Approve the wallet signature and try again.";
    if (container) await loadPortfolio(true);
    return;
  }

  portfolioTradingError = null;
  portfolioLoaded = false;
  await loadPortfolio(true);
}

async function focusMarket(marketId: string): Promise<void> {
  await sendRuntimeMessage({
    type: "KNOWW_FOCUS_NOTIFICATION_MARKET",
    marketId,
  });
}

async function searchMarkets(query: string): Promise<SnapshotMarket[]> {
  const response = await sendRuntimeMessage({
    type: "KNOWW_SEARCH_NOTIFICATION_MARKETS",
    query,
  });
  if (response.ok === false) return [];
  return getSearchResultsPayload(response);
}

async function getPortfolioSessionAddress(): Promise<string | null> {
  const response = await sendRuntimeMessage({
    type: "auth:get-session-info",
  });
  const payload = response.data as
    | { loggedIn?: unknown; address?: unknown }
    | undefined;
  return payload?.loggedIn === true && typeof payload.address === "string"
    ? payload.address
    : null;
}

async function getPortfolioWallets(): Promise<PortfolioWallet[]> {
  const response = await sendRuntimeMessage({
    type: "KNOWW_GET_PORTFOLIO_WALLETS",
  });
  const payload = response.data as
    | { success?: boolean; data?: { wallets?: unknown } }
    | undefined;
  const wallets = payload?.data?.wallets;
  if (!Array.isArray(wallets)) return [];

  return wallets
    .map((wallet) => wallet as Partial<PortfolioWallet>)
    .filter(
      (wallet): wallet is PortfolioWallet =>
        typeof wallet.uuid === "string" && typeof wallet.name === "string"
    );
}

async function getPortfolioTradingStatus(
  address: string
): Promise<{ hasCredentials: boolean }> {
  const response = await sendRuntimeMessage({
    type: "KNOWW_GET_PORTFOLIO_TRADING_STATUS",
    address,
  });
  const payload = response.data as { hasCredentials?: unknown } | undefined;
  return { hasCredentials: payload?.hasCredentials === true };
}

async function getPortfolioCashBalance(
  portfolioAddress: string
): Promise<number> {
  const response = await sendRuntimeMessage({
    type: "trading:get-balance",
    proxyAddress: portfolioAddress,
  });
  if (response.ok === false) return 0;

  const payload = response.data as PortfolioBalanceResponse | undefined;
  return typeof payload?.balance === "number" ? payload.balance : 0;
}

type RawPortfolioOpenOrder = {
  id?: string;
  order_id?: string;
  maker?: string;
  asset_id?: string;
  token_id?: string;
  side?: string;
  price?: string | number;
  original_size?: string | number;
  size_matched?: string | number;
  status?: string;
  created_at?: string | number;
  expiration?: string | number;
};

type MarketByTokenResponse = {
  success?: boolean;
  market?: {
    question?: string;
    outcome?: string;
    eventSlug?: string;
    slug?: string;
    icon?: string;
  };
};

function normalizePortfolioOpenOrder(
  order: RawPortfolioOpenOrder
): PortfolioOpenOrder {
  const size = Number(order.original_size || 0);
  const filledSize = Number(order.size_matched || 0);
  const side = String(order.side || "BUY").toUpperCase();
  return {
    id: order.id || order.order_id || "",
    tokenId: order.asset_id || order.token_id || "",
    side: side === "SELL" ? "SELL" : "BUY",
    price: Number(order.price || 0),
    size,
    filledSize,
    remainingSize: Math.max(0, size - filledSize),
    status: String(order.status || "LIVE").toUpperCase(),
    expiration: String(order.expiration || "0"),
  };
}

async function getPortfolioOpenOrders(
  ownerAddress: string
): Promise<PortfolioOpenOrdersResponse> {
  const response = await sendRuntimeMessage({
    type: "KNOWW_GET_PORTFOLIO_OPEN_ORDERS",
    address: ownerAddress,
  });
  if (response.ok === false) return { orders: [], count: 0 };

  const payload = response.data as { orders?: unknown; count?: unknown };
  const rawOrders = Array.isArray(payload?.orders)
    ? (payload.orders as RawPortfolioOpenOrder[])
    : [];
  const orders = rawOrders.map(normalizePortfolioOpenOrder);
  const tokenIds = Array.from(
    new Set(orders.map((order) => order.tokenId).filter(Boolean))
  );
  const marketEntries = await Promise.all(
    tokenIds.map(async (tokenId) => {
      const market = await fetchKnowwJson<MarketByTokenResponse>(
        `/api/markets/by-token/${encodeURIComponent(tokenId)}`
      );
      return [tokenId, market?.market] as const;
    })
  );
  const marketsByToken = new Map(marketEntries.filter((entry) => entry[1]));

  return {
    count: typeof payload?.count === "number" ? payload.count : orders.length,
    orders: orders.map((order) => {
      const market = marketsByToken.get(order.tokenId);
      return market
        ? {
            ...order,
            market: {
              title: market.question || formatAddress(order.tokenId),
              outcome: market.outcome || "",
              ...(market.eventSlug ? { eventSlug: market.eventSlug } : {}),
              ...(market.slug ? { slug: market.slug } : {}),
              ...(market.icon ? { icon: market.icon } : {}),
            },
          }
        : order;
    }),
  };
}

async function cancelPortfolioOpenOrder(
  ownerAddress: string,
  orderId: string
): Promise<{ ok: boolean; error?: string }> {
  const response = await sendRuntimeMessage({
    type: "KNOWW_CANCEL_PORTFOLIO_OPEN_ORDER",
    address: ownerAddress,
    orderId,
  });
  if (response.ok === false) {
    return { ok: false, error: response.error };
  }
  return { ok: true };
}

function disarmCancelOrder(): void {
  if (cancelConfirmTimer !== null) {
    clearTimeout(cancelConfirmTimer);
    cancelConfirmTimer = null;
  }
  const button = armedCancelButton;
  armedCancelButton = null;
  if (button) {
    button.classList.remove("is-armed");
    const label = button.querySelector("[data-cancel-label]");
    if (label) label.textContent = "Cancel";
    button.setAttribute("aria-label", "Cancel order");
  }
}

function armCancelOrder(button: HTMLButtonElement): void {
  disarmCancelOrder();
  armedCancelButton = button;
  button.classList.add("is-armed");
  const label = button.querySelector("[data-cancel-label]");
  if (label) label.textContent = "Confirm";
  button.setAttribute("aria-label", "Confirm cancel order");
  cancelConfirmTimer = setTimeout(disarmCancelOrder, 3000);
}

function handleCancelOrderClick(button: HTMLButtonElement): void {
  if (button.disabled) return;
  if (button === armedCancelButton) {
    void performOrderCancel(button);
    return;
  }
  armCancelOrder(button);
}

async function performOrderCancel(button: HTMLButtonElement): Promise<void> {
  const orderId = button.dataset.orderId;
  const ownerAddress = button.dataset.ownerAddress;
  if (!orderId || !ownerAddress) return;

  if (cancelConfirmTimer !== null) {
    clearTimeout(cancelConfirmTimer);
    cancelConfirmTimer = null;
  }
  armedCancelButton = null;
  button.disabled = true;
  button.classList.remove("is-armed", "is-error");
  button.classList.add("is-busy");
  const label = button.querySelector("[data-cancel-label]");
  // Keep the label short so it fits the fixed button width without overflow.
  if (label) label.textContent = "…";

  const result = await cancelPortfolioOpenOrder(ownerAddress, orderId);
  if (result.ok) {
    // Reload so the cancelled order disappears and any BUY collateral it was
    // reserving is reflected back in the cash/positions figures.
    await loadPortfolio(true);
    return;
  }

  // Surface the failure on the button and keep the row so the user can retry.
  button.classList.remove("is-busy");
  button.classList.add("is-error");
  button.disabled = false;
  if (label) label.textContent = "Failed";
  button.title = result.error || "Could not cancel order.";
  cancelConfirmTimer = setTimeout(() => {
    button.classList.remove("is-error");
    if (label) label.textContent = "Cancel";
    button.removeAttribute("title");
  }, 4000);
}

async function resolvePortfolioAddress(ownerAddress: string): Promise<string> {
  const walletMode = await readStoredWalletMode(ownerAddress);
  if (walletMode === "eoa") return ownerAddress;

  const response = await sendRuntimeMessage({
    type: "trading:derive-proxy-address",
    eoaAddress: ownerAddress,
    walletMode,
  });
  const payload = response.data as { proxyAddress?: unknown } | undefined;
  return typeof payload?.proxyAddress === "string"
    ? payload.proxyAddress
    : ownerAddress;
}

async function fetchKnowwJson<T>(path: string): Promise<T | null> {
  const response = await sendRuntimeMessage({
    type: "fetch-json",
    url: `${KNOWW_APP_URL}${path}`,
    method: "GET",
  });
  return getFetchJsonPayload<T>(response);
}

async function fetchPortfolioData(
  ownerAddress: string,
  address: string,
  previous: PortfolioData | null
): Promise<PortfolioData> {
  const user = encodeURIComponent(address);
  const [positions, trades, details, tradingStatus, cashBalance] =
    await Promise.all([
      fetchKnowwJson<PortfolioPositionsResponse>(
        `/api/user/positions?user=${user}&limit=${PORTFOLIO_POSITIONS_FETCH_LIMIT}&offset=0&active=true`
      ),
      fetchKnowwJson<PortfolioTradesResponse>(
        `/api/user/trades?user=${user}&limit=${PORTFOLIO_HISTORY_FETCH_LIMIT}&offset=0`
      ),
      fetchKnowwJson<PortfolioDetailsResponse>(
        `/api/user/details?user=${user}&timePeriod=all`
      ),
      getPortfolioTradingStatus(ownerAddress),
      getPortfolioCashBalance(address),
    ]);

  // A `null` here means the upstream call returned a non-2xx (timeout, 5xx,
  // rate-limit) — a *transient failure*, NOT an empty account. An account with
  // no activity still returns 200 (positions/trades as empty arrays, details as
  // `{ details: null }`). If a hero-critical call failed, throw so loadPortfolio
  // keeps the last good snapshot instead of rendering a misleading $0 portfolio.
  if (positions === null || details === null) {
    throw new Error("portfolio-refresh-failed");
  }

  const openOrders = tradingStatus.hasCredentials
    ? await getPortfolioOpenOrders(ownerAddress)
    : { orders: [], count: 0 };

  // History is non-critical: if only the trades call blipped, reuse the last
  // good history (for the same address) rather than emptying the list.
  const fallbackTrades =
    previous && previous.address === address ? previous.trades : undefined;

  return {
    address,
    ownerAddress,
    hasTradingCredentials: tradingStatus.hasCredentials,
    cashBalance,
    openOrders,
    details,
    positions,
    trades: trades ?? fallbackTrades ?? {},
  };
}

function renderPortfolioSummary(data: PortfolioData): string {
  const summary = data.positions.summary || {};
  const details = data.details.details;
  const totalPnl =
    details?.pnl ?? summary.totalPnl ?? summary.totalUnrealizedPnl;
  const pnl = Number.isFinite(totalPnl) ? Number(totalPnl) : 0;
  const direction = pnl > 0 ? "is-up" : pnl < 0 ? "is-down" : "is-flat";
  const deltaClass = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "flat";
  const arrow =
    pnl === 0
      ? `<svg class="knoww-pf-delta-arrow" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.1" width="8" height="1.8" rx="0.9"></rect></svg>`
      : `<svg class="knoww-pf-delta-arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 10.5H1z"></path></svg>`;

  return `
    <div class="knoww-pf-hero ${direction}">
      <div class="knoww-pf-hero-top">
        <div class="knoww-pf-id">
          <span class="knoww-pf-kicker">Portfolio</span>
          <span class="knoww-pf-name">${escapeHtml(
            details?.userName || formatAddress(data.address)
          )}</span>
        </div>
        <div class="knoww-pf-hero-actions">
          <button type="button" class="knoww-portfolio-open" data-open-portfolio>
            <span>Open</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"></path></svg>
          </button>
          <button type="button" class="knoww-pf-hero-disconnect" data-portfolio-disconnect title="Disconnect wallet" aria-label="Disconnect wallet">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          </button>
        </div>
      </div>
      <div class="knoww-pf-hero-value">
        <span class="knoww-pf-hero-label">Position value</span>
        <strong class="knoww-pf-hero-num">${escapeHtml(
          formatMoney(summary.totalValue)
        )}</strong>
        <div class="knoww-pf-delta ${deltaClass}">
          ${arrow}
          <span class="knoww-pf-delta-num">${escapeHtml(
            formatSignedMoney(pnl)
          )}</span>
          <span class="knoww-pf-delta-label">All-time P/L</span>
        </div>
      </div>
      <div class="knoww-pf-strip">
        <div class="knoww-pf-strip-cell">
          <span class="knoww-pf-strip-label">Positions</span>
          <strong>${escapeHtml(
            formatCompactNumber(summary.positionCount)
          )}</strong>
        </div>
        <div class="knoww-pf-strip-cell">
          <span class="knoww-pf-strip-label">Volume</span>
          <strong>${escapeHtml(formatMoney(details?.volume))}</strong>
        </div>
        <div class="knoww-pf-strip-cell">
          <span class="knoww-pf-strip-label">Cash</span>
          <strong>${escapeHtml(formatMoney(data.cashBalance))}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderPortfolioEmpty(
  title: string,
  sub: string,
  iconPath: string
): string {
  return `
    <div class="knoww-portfolio-empty">
      <div class="knoww-pf-empty-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">${iconPath}</svg>
      </div>
      <p class="knoww-pf-empty-title">${escapeHtml(title)}</p>
      <span class="knoww-pf-empty-sub">${escapeHtml(sub)}</span>
    </div>
  `;
}

// Build the knoww.app event-detail URL for a market row. Mirrors the web app,
// which links positions/trades to `/events/detail/{eventSlug || slug}` (the
// market slug 308-redirects to the same page). Returns null when neither slug
// is present, in which case the row renders as a non-interactive element.
function portfolioMarketUrl(market: {
  eventSlug?: string;
  slug?: string;
}): string | null {
  const slug = market.eventSlug || market.slug;
  return slug
    ? `${KNOWW_APP_URL}/events/detail/${encodeURIComponent(slug)}`
    : null;
}

// A market row is an anchor when it links somewhere (native new-tab open,
// keyboard- and middle-click-friendly) and a plain div otherwise.
function portfolioRowOpenTag(url: string | null, modifier = ""): string {
  const className = `knoww-portfolio-row${modifier}`;
  return url
    ? `<a class="${className} is-link" href="${escapeHtml(
        url
      )}" target="_blank" rel="noopener noreferrer">`
    : `<div class="${className}">`;
}

function portfolioRowCloseTag(url: string | null): string {
  return url ? "</a>" : "</div>";
}

function renderCompactPositions(positions: PortfolioPosition[] = []): string {
  if (positions.length === 0) {
    return renderPortfolioEmpty(
      "No active positions",
      "Open trades will surface here as you take them.",
      `<path d="M4 19V5M4 19h16M8 16v-5M13 16V8M18 16v-3"></path>`
    );
  }

  return positions
    .slice(0, PORTFOLIO_POSITIONS_DISPLAY_LIMIT)
    .map((position) => {
      const pnlClass = position.unrealizedPnl >= 0 ? "positive" : "negative";
      const url = portfolioMarketUrl(position.market);
      const expanded = portfolioExpandedPositionId === position.id;
      const confirming = portfolioConfirmingSellPositionId === position.id;
      const selling = portfolioSellingPositionId === position.id;
      const sellError =
        portfolioSellErrorPositionId === position.id
          ? portfolioSellError
          : null;
      return `
        <div class="knoww-portfolio-position-item ${expanded ? "is-expanded" : ""}">
          <button
            type="button"
            class="knoww-portfolio-row knoww-portfolio-position-trigger"
            data-portfolio-position-toggle
            data-position-id="${escapeHtml(position.id)}"
            aria-expanded="${String(expanded)}"
          >
            <div class="knoww-portfolio-row-icon">
              ${
                position.market.icon
                  ? `<img src="${escapeHtml(position.market.icon)}" alt="" />`
                  : `<span>${escapeHtml(position.outcome.slice(0, 1))}</span>`
              }
            </div>
            <div class="knoww-portfolio-row-main">
              <div class="knoww-portfolio-row-title">${escapeHtml(
                position.market.title
              )}</div>
              <div class="knoww-portfolio-row-meta">${escapeHtml(
                position.outcome
              )} · ${escapeHtml(formatCompactNumber(position.size))} shares</div>
            </div>
            <div class="knoww-portfolio-row-value">
              <strong>${escapeHtml(formatMoney(position.currentValue))}</strong>
              <span class="${pnlClass}">${escapeHtml(
                `${formatSignedMoney(position.unrealizedPnl)} (${formatPercent(
                  position.unrealizedPnlPercent
                )})`
              )}</span>
            </div>
          </button>
          ${
            confirming
              ? `<div class="knoww-portfolio-position-confirm">${escapeHtml(
                  `Sell ${formatCompactNumber(position.size)} ${position.outcome} shares?`
                )}</div>`
              : ""
          }
          <div class="knoww-portfolio-position-actions" ${expanded ? "" : "hidden"}>
            ${
              confirming
                ? `<button type="button" class="knoww-portfolio-position-action" data-portfolio-position-sell-cancel data-position-id="${escapeHtml(position.id)}">Cancel</button>`
                : `<button type="button" class="knoww-portfolio-position-action" data-portfolio-position-view data-position-id="${escapeHtml(position.id)}" ${url ? "" : "disabled"}>View</button>`
            }
            <button type="button" class="knoww-portfolio-position-action danger ${confirming ? "is-confirming" : ""}" ${confirming ? "data-portfolio-position-sell-confirm" : "data-portfolio-position-sell"} data-position-id="${escapeHtml(position.id)}" ${selling ? "disabled" : ""}>Sell Position</button>
            <button type="button" class="knoww-portfolio-position-action icon" data-portfolio-position-close data-position-id="${escapeHtml(position.id)}">X</button>
          </div>
          ${
            sellError
              ? `<div class="knoww-portfolio-position-error">${escapeHtml(
                  sellError
                )}</div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function getPortfolioHistoryMaxPage(tradeCount: number): number {
  return Math.max(0, Math.ceil(tradeCount / PORTFOLIO_HISTORY_PAGE_SIZE) - 1);
}

function getClampedPortfolioHistoryPage(tradeCount: number): number {
  return Math.min(
    Math.max(0, portfolioHistoryPage),
    getPortfolioHistoryMaxPage(tradeCount)
  );
}

function renderCompactActivity(
  trades: PortfolioTrade[] = [],
  page = portfolioHistoryPage
): string {
  if (trades.length === 0) {
    return renderPortfolioEmpty(
      "No recent activity",
      "Your fills, redeems and merges will appear here.",
      `<circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path>`
    );
  }

  const start = page * PORTFOLIO_HISTORY_PAGE_SIZE;
  return trades
    .slice(start, start + PORTFOLIO_HISTORY_PAGE_SIZE)
    .map((trade) => {
      const side = trade.side || trade.type;
      const sideClass = side === "BUY" ? "positive" : "negative";
      const priceCents = new Decimal(trade.price).mul(100).toDecimalPlaces(0);
      const url = portfolioMarketUrl(trade.market);
      return `
        ${portfolioRowOpenTag(url, " compact")}
          <div class="knoww-portfolio-row-main">
            <div class="knoww-portfolio-row-title">${escapeHtml(
              trade.market.title
            )}</div>
            <div class="knoww-portfolio-row-meta">${escapeHtml(
              side
            )} ${escapeHtml(trade.outcome)} · ${escapeHtml(
              formatTradeTime(trade.timestamp)
            )}</div>
          </div>
          <div class="knoww-portfolio-row-value">
            <strong>${escapeHtml(formatMoney(trade.usdcAmount))}</strong>
            <span class="${sideClass}">${escapeHtml(
              `${formatCompactNumber(trade.size)} @ ${priceCents.toString()}¢`
            )}</span>
          </div>
        ${portfolioRowCloseTag(url)}
      `;
    })
    .join("");
}

function renderPortfolioHistoryControls(trades: PortfolioTrade[] = []): string {
  if (trades.length <= PORTFOLIO_HISTORY_PAGE_SIZE) return "";

  const page = getClampedPortfolioHistoryPage(trades.length);
  const maxPage = getPortfolioHistoryMaxPage(trades.length);
  const start = page * PORTFOLIO_HISTORY_PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PORTFOLIO_HISTORY_PAGE_SIZE, trades.length);

  return `
    <div class="knoww-portfolio-history-controls">
      <span>${escapeHtml(`${start}-${end} of ${trades.length}`)}</span>
      <div>
        <button
          type="button"
          class="knoww-portfolio-history-button"
          data-portfolio-history-prev
          aria-label="Previous history page"
          ${page === 0 ? "disabled" : ""}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6"></path>
          </svg>
        </button>
        <button
          type="button"
          class="knoww-portfolio-history-button"
          data-portfolio-history-next
          aria-label="Next history page"
          ${page >= maxPage ? "disabled" : ""}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function renderCompactOpenOrders(
  orders: PortfolioOpenOrder[] = [],
  ownerAddress = ""
): string {
  if (orders.length === 0) {
    return renderPortfolioEmpty(
      "No open orders",
      "Resting limit orders you place will live here.",
      `<path d="M4 7h16M4 12h10M4 17h7"></path>`
    );
  }

  return orders
    .slice(0, 5)
    .map((order) => {
      const sideClass = order.side === "BUY" ? "positive" : "negative";
      const title = order.market?.title || formatAddress(order.tokenId);
      const outcome = order.market?.outcome || "Outcome";
      const total = new Decimal(order.remainingSize).mul(order.price);
      const priceCents = new Decimal(order.price).mul(100).toDecimalPlaces(0);
      const url = order.market ? portfolioMarketUrl(order.market) : null;
      // The market-open link wraps only the row content so the Cancel button
      // can sit beside it without nesting a button inside an anchor.
      const linkOpen = url
        ? `<a class="knoww-portfolio-order-link is-link" href="${escapeHtml(
            url
          )}" target="_blank" rel="noopener noreferrer">`
        : `<div class="knoww-portfolio-order-link">`;
      const linkClose = url ? "</a>" : "</div>";
      return `
        <div class="knoww-portfolio-row compact knoww-portfolio-order">
          ${linkOpen}
            <div class="knoww-portfolio-row-main">
              <div class="knoww-portfolio-row-title">${escapeHtml(title)}</div>
              <div class="knoww-portfolio-row-meta">${escapeHtml(
                order.side
              )} ${escapeHtml(outcome)} · ${escapeHtml(
                formatCompactNumber(order.remainingSize)
              )} open · ${escapeHtml(
                formatOrderExpiration(order.expiration)
              )}</div>
            </div>
            <div class="knoww-portfolio-row-value">
              <strong>${escapeHtml(formatDecimalMoney(total))}</strong>
              <span class="${sideClass}">${escapeHtml(
                `${priceCents.toString()}¢`
              )}</span>
            </div>
          ${linkClose}
          <button
            type="button"
            class="knoww-portfolio-cancel"
            data-cancel-order
            data-order-id="${escapeHtml(order.id)}"
            data-owner-address="${escapeHtml(ownerAddress)}"
            aria-label="Cancel order"
          >
            <span data-cancel-label>Cancel</span>
          </button>
        </div>
      `;
    })
    .join("");
}

function renderPortfolioTable(data: PortfolioData): string {
  const positionsCount = data.positions.positions?.length || 0;
  const ordersCount =
    data.openOrders.count || data.openOrders.orders?.length || 0;
  const historyTrades = data.trades.trades || [];
  const historyCount = historyTrades.length;
  const historyPage = getClampedPortfolioHistoryPage(historyCount);
  portfolioHistoryPage = historyPage;
  const tabs: Array<{
    view: PortfolioTableView;
    label: string;
    count: number;
  }> = [
    { view: "positions", label: "Positions", count: positionsCount },
    { view: "orders", label: "Open orders", count: ordersCount },
    { view: "history", label: "History", count: historyCount },
  ];

  return `
    <div class="knoww-portfolio-table">
      <div class="knoww-portfolio-table-tabs" role="tablist" aria-label="Portfolio table">
        ${tabs
          .map((tab) => {
            const selected = portfolioTableView === tab.view;
            return `
              <button
                type="button"
                class="knoww-portfolio-table-tab ${selected ? "is-active" : ""}"
                data-portfolio-table-tab="${tab.view}"
                role="tab"
                aria-selected="${String(selected)}"
              >
                <span>${escapeHtml(tab.label)}</span>
                <strong>${String(tab.count).padStart(2, "0")}</strong>
              </button>
            `;
          })
          .join("")}
      </div>
      <div
        class="knoww-portfolio-table-panel"
        data-portfolio-table-panel="positions"
        role="tabpanel"
        ${portfolioTableView === "positions" ? "" : "hidden"}
      >
        ${renderCompactPositions(data.positions.positions || [])}
      </div>
      <div
        class="knoww-portfolio-table-panel"
        data-portfolio-table-panel="orders"
        role="tabpanel"
        ${portfolioTableView === "orders" ? "" : "hidden"}
      >
        ${
          data.hasTradingCredentials
            ? renderCompactOpenOrders(
                data.openOrders.orders || [],
                data.ownerAddress
              )
            : renderPortfolioEmpty(
                "Trading not enabled",
                "Enable trading above to place and track open orders.",
                `<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>`
              )
        }
      </div>
      <div
        class="knoww-portfolio-table-panel"
        data-portfolio-table-panel="history"
        role="tabpanel"
        ${portfolioTableView === "history" ? "" : "hidden"}
      >
        ${renderCompactActivity(historyTrades, historyPage)}
        ${renderPortfolioHistoryControls(historyTrades)}
      </div>
    </div>
  `;
}

function renderPortfolioFundActions(): string {
  return `
    <div class="knoww-pf-fund-actions">
      <button type="button" class="knoww-pf-fund-btn primary" data-portfolio-fund="deposit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"></path></svg>
        <span>Deposit</span>
      </button>
      <button type="button" class="knoww-pf-fund-btn" data-portfolio-fund="withdraw">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V9m0 0 4 4m-4-4-4 4M4 3h16"></path></svg>
        <span>Withdraw</span>
      </button>
    </div>
  `;
}

function renderPortfolioContent(
  data: PortfolioData,
  options: { stale?: boolean } = {}
): string {
  return `
    ${options.stale ? renderPortfolioStaleNotice() : ""}
    ${renderPortfolioSummary(data)}
    ${renderPortfolioFundActions()}
    ${renderPortfolioTradingGate(data)}
    ${renderPortfolioTable(data)}
  `;
}

function renderPortfolioStaleNotice(): string {
  return `
    <div class="knoww-pf-stale" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>
      <span class="knoww-pf-stale-text">Couldn't refresh — showing last update</span>
      <button type="button" class="knoww-pf-stale-retry" data-refresh-portfolio>
        Retry
      </button>
    </div>
  `;
}

function renderPortfolioTradingGate(data: PortfolioData): string {
  if (data.hasTradingCredentials) return "";

  return `
    <div class="knoww-portfolio-trading-gate">
      <div>
        <strong>Enable trading</strong>
        <span>${
          portfolioTradingError
            ? escapeHtml(portfolioTradingError)
            : "Sign once to unlock market orders and open orders."
        }</span>
      </div>
      <button
        type="button"
        class="knoww-portfolio-open primary"
        data-enable-portfolio-trading
        data-owner-address="${escapeHtml(data.ownerAddress)}"
      >
        Enable
      </button>
    </div>
  `;
}

function renderPortfolioMobileWalletOption(): string {
  return `
    <button type="button" class="knoww-portfolio-wallet knoww-pf-wallet-mobile" data-connect-portfolio-walletconnect>
      <span class="knoww-pf-wallet-qr" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 3h3m3 0v3m-6 0h3m3-6v3M14 14h3"></path></svg>
      </span>
      <span class="knoww-pf-wallet-id">
        <strong>Mobile wallet</strong>
        <small>Scan a QR with your phone</small>
      </span>
      <svg class="knoww-pf-wallet-go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg>
    </button>
  `;
}

function renderPortfolioWalletChoices(wallets: PortfolioWallet[] = []): string {
  if (wallets.length === 0) {
    return `
      <div class="knoww-portfolio-wallets">
        ${renderPortfolioMobileWalletOption()}
      </div>
      <div class="knoww-portfolio-actions">
        <button type="button" class="knoww-portfolio-open primary" data-refresh-portfolio-wallets>
          Find wallets
        </button>
        <button type="button" class="knoww-portfolio-open" data-open-portfolio>
          Open portfolio
        </button>
      </div>
    `;
  }

  return `
    <div class="knoww-portfolio-wallets">
      ${wallets
        .map(
          (wallet) => `
            <button
              type="button"
              class="knoww-portfolio-wallet"
              data-connect-portfolio-wallet
              data-wallet-uuid="${escapeHtml(wallet.uuid)}"
            >
              ${
                wallet.icon
                  ? `<img src="${escapeHtml(wallet.icon)}" alt="" />`
                  : `<span>${escapeHtml(wallet.name.slice(0, 1))}</span>`
              }
              <strong>${escapeHtml(wallet.name)}</strong>
            </button>
          `
        )
        .join("")}
      ${renderPortfolioMobileWalletOption()}
    </div>
    <div class="knoww-portfolio-actions">
      <button type="button" class="knoww-portfolio-open" data-refresh-portfolio-wallets>
        Refresh wallets
      </button>
      <button type="button" class="knoww-portfolio-open" data-open-portfolio>
        Open portfolio
      </button>
    </div>
  `;
}

function renderPortfolioSignedOut(): string {
  const wallets = portfolioWallets || [];
  const hasError = Boolean(portfolioConnectError);
  return `
    <div class="knoww-portfolio-signed-out">
      <div class="knoww-pf-empty-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M19 7V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1"></path><path d="M21 11h-5a2 2 0 0 0 0 4h5v-4Z"></path></svg>
      </div>
      <p class="knoww-pf-empty-title">Connect a wallet</p>
      <span class="knoww-pf-empty-sub ${hasError ? "is-error" : ""}">${
        hasError
          ? escapeHtml(portfolioConnectError as string)
          : "Choose a wallet on the active page to load your positions."
      }</span>
      ${renderPortfolioWalletChoices(wallets)}
    </div>
  `;
}

async function refreshPortfolioWalletChoicesAfterDisconnect(): Promise<void> {
  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (!container || container.hidden) return;

  portfolioWallets = await getPortfolioWallets();
  const sessionAddress = await getPortfolioSessionAddress();
  if (sessionAddress) return;

  container.innerHTML = renderPortfolioSignedOut();
}

function clearPortfolioSessionState(): void {
  portfolioLoaded = false;
  portfolioConnectError = null;
  portfolioTradingError = null;
  portfolioHistoryPage = 0;
  latestPortfolioData = null;
  portfolioWallets = null;
  // Halt any in-flight WalletConnect poll loop.
  portfolioWalletConnectActive = false;
  portfolioWalletConnectToken++;
  portfolioWalletConnectQr = null;
  portfolioWalletConnectError = null;

  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (container && !container.hidden) {
    container.innerHTML = renderPortfolioSignedOut();
    void refreshPortfolioWalletChoicesAfterDisconnect();
  }
}

async function loadPortfolio(force = false): Promise<void> {
  if (portfolioLoaded && !force) return;
  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (!container) return;

  // Only show the loading wipe on the very first load. On a refresh we keep the
  // current render in place so a transient failure never flashes an empty hero.
  const previous = portfolioLoaded ? latestPortfolioData : null;
  if (!previous) {
    container.innerHTML = `
      <div class="knoww-portfolio-loading">Loading portfolio...</div>
    `;
  }

  const address = await getPortfolioSessionAddress();
  if (!address) {
    portfolioLoaded = false;
    latestPortfolioData = null;
    if (!portfolioWallets) {
      portfolioWallets = await getPortfolioWallets();
    }
    container.innerHTML = renderPortfolioSignedOut();
    return;
  }

  try {
    const portfolioAddress = await resolvePortfolioAddress(address);
    const data = await fetchPortfolioData(address, portfolioAddress, previous);
    portfolioLoaded = true;
    latestPortfolioData = data;
    container.innerHTML = renderPortfolioContent(data);
  } catch {
    // Transient refresh failure (upstream timeout / 5xx / rate-limit). Keep the
    // last good snapshot visible with a subtle "couldn't refresh" notice rather
    // than wiping the hero to $0 — an empty render is indistinguishable from an
    // empty account and is the source of the "data randomly disappears" bug.
    if (previous) {
      portfolioLoaded = true;
      latestPortfolioData = previous;
      container.innerHTML = renderPortfolioContent(previous, { stale: true });
      return;
    }
    portfolioLoaded = false;
    latestPortfolioData = null;
    container.innerHTML = `
      <div class="knoww-portfolio-signed-out">
        <span class="knoww-stack-empty-title">Portfolio unavailable</span>
        <span class="knoww-stack-empty-sub">Couldn't reach the markets data feed. Retry in a moment.</span>
        <button type="button" class="knoww-portfolio-open" data-refresh-portfolio>
          Retry
        </button>
      </div>
    `;
  }
}

function setSidepanelView(view: "markets" | "portfolio"): void {
  const stack = root?.querySelector("#knoww-notification-stack");
  const markets = root?.querySelector<HTMLElement>("[data-sidepanel-markets]");
  const portfolio = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  const searchToggle = root?.querySelector<HTMLButtonElement>(
    "#knoww-search-toggle"
  );
  const tabs = root?.querySelectorAll<HTMLButtonElement>(
    "[data-sidepanel-view]"
  );

  markets?.toggleAttribute("hidden", view !== "markets");
  portfolio?.toggleAttribute("hidden", view !== "portfolio");
  stack?.classList.toggle(
    "knoww-sidepanel-portfolio-active",
    view === "portfolio"
  );
  if (searchToggle) searchToggle.hidden = view === "portfolio";

  tabs?.forEach((tab) => {
    const selected = tab.dataset.sidepanelView === view;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });

  if (view === "portfolio") void loadPortfolio(true);
}

function refreshVisiblePortfolio(): void {
  const portfolio = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (!portfolio || portfolio.hidden || !latestPortfolioData) return;
  if (portfolioFundView !== null) return;
  void loadPortfolio(true);
}

function setPortfolioTableView(view: PortfolioTableView): void {
  portfolioTableView = view;
  const tabs = root?.querySelectorAll<HTMLButtonElement>(
    "[data-portfolio-table-tab]"
  );
  const panels = root?.querySelectorAll<HTMLElement>(
    "[data-portfolio-table-panel]"
  );

  tabs?.forEach((tab) => {
    const selected = tab.dataset.portfolioTableTab === view;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });

  panels?.forEach((panel) => {
    panel.toggleAttribute("hidden", panel.dataset.portfolioTablePanel !== view);
  });
}

function setPortfolioHistoryPage(page: number): void {
  if (!latestPortfolioData) return;

  const trades = latestPortfolioData.trades.trades || [];
  portfolioHistoryPage = Math.min(
    Math.max(0, page),
    getPortfolioHistoryMaxPage(trades.length)
  );

  const panel = root?.querySelector<HTMLElement>(
    '[data-portfolio-table-panel="history"]'
  );
  if (!panel) return;

  panel.innerHTML = `
    ${renderCompactActivity(trades, portfolioHistoryPage)}
    ${renderPortfolioHistoryControls(trades)}
  `;
}

async function refreshSnapshot(): Promise<void> {
  const response = await sendRuntimeMessage({
    type: "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT",
    trendingLimit: 5,
  });
  const items = document.querySelector<HTMLElement>("[data-sidepanel-items]");
  const live = document.querySelector<HTMLElement>("[data-sidepanel-live]");
  if (!items) return;

  if (live) live.textContent = formatLiveTimeLabel();

  if (response.ok === false) {
    items.innerHTML = `
      <div class="knoww-stack-empty">
        <span class="knoww-stack-empty-title">No supported page connected</span>
        <span class="knoww-stack-empty-sub">Open a page with Knoww markets and refresh this sidebar.</span>
      </div>
    `;
    return;
  }

  const snapshot = getSnapshotPayload(response);
  const active = snapshot.active || [];
  const seen = snapshot.seen || [];
  const trending = snapshot.trending || [];
  items.innerHTML = `
    ${renderSection(
      "Active now",
      active.length,
      "active",
      renderMarketRows(active, "active")
    )}
    ${
      trending.length > 0
        ? renderSection(
            "Trending now",
            trending.length,
            "trending",
            renderMarketRows(trending, "trending")
          )
        : ""
    }
    ${renderSection(
      "Seen earlier",
      seen.length,
      "scrolled-out",
      renderMarketRows(seen, "seen")
    )}
  `;
}

function render(): void {
  if (!root) return;

  root.innerHTML = `
    <style>
      * {
        box-sizing: border-box;
      }

      html,
      body,
      #root {
        width: 100%;
        min-width: 0;
        min-height: 100vh;
        margin: 0;
        background: var(--kse-panel, #18181b);
        overflow: hidden;
      }

      #knoww-notification-stack.knoww-sidepanel-stack {
        /* Side-panel-only neutral near-black palette (anchored on #18181b).
           Overrides the shared warm dark tokens for this surface only. */
        --kse-bg: #121214;
        --kse-panel: #18181b;
        --kse-panel-2: #1f1f23;
        --kse-bg-3: #1d1d21;
        position: static !important;
        top: auto !important;
        right: auto !important;
        bottom: auto !important;
        left: auto !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        height: 100vh !important;
        max-height: none !important;
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        transform: none !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack .knoww-stack-items {
        max-height: calc(100vh - 116px) !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack .knoww-stack-content {
        min-height: 0 !important;
      }

      /* Markets rows harmonized with the Portfolio surface: hairline row
         dividers + hover (hover lives in knoww-inline.css), bordered rounded
         thumbnails, and one dominant KnowwMono tabular number with a legible
         outcome name beneath. These rules are injected after knoww-inline.css
         so they win on the shared .knoww-notification-* selectors. */
      #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-item {
        width: 100% !important;
        grid-template-columns: 40px minmax(0, 1fr) 96px !important;
        justify-items: stretch !important;
        text-align: left !important;
        border: 0 !important;
        border-bottom: 1px solid var(--kse-hairline) !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack
        .knoww-notification-item:last-child,
      #knoww-notification-stack.knoww-sidepanel-stack
        .knoww-notification-item:has(+ .knoww-stack-section-header) {
        border-bottom: 0 !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-icon {
        border-radius: 9px !important;
        border: 1px solid var(--kse-hairline-2) !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack
        .knoww-notification-icon img {
        border-radius: 8px !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-content {
        align-items: flex-start !important;
        text-align: left !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-title,
      #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-meta {
        width: 100% !important;
        text-align: left !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-prices {
        width: 96px !important;
        justify-self: end !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack
        .knoww-notification-price-num {
        font-family: "KnowwMono", "SF Mono", "SFMono-Regular", "Consolas",
          monospace !important;
        font-size: 21px !important;
        font-weight: 500 !important;
        letter-spacing: -0.01em !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack
        .knoww-notification-price-cents {
        font-family: "KnowwMono", "SF Mono", "SFMono-Regular", "Consolas",
          monospace !important;
        font-size: 11px !important;
        font-weight: 500 !important;
      }

      /* Outcome name: legible sentence-case sans, not the 8px uppercase label */
      #knoww-notification-stack.knoww-sidepanel-stack
        .knoww-notification-side-label {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
          sans-serif !important;
        font-size: 10.5px !important;
        font-weight: 500 !important;
        letter-spacing: 0 !important;
        text-transform: none !important;
        max-width: 96px !important;
        margin-top: 1px !important;
      }

      .knoww-sidepanel-empty {
        padding: 12px 14px !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack.knoww-stack-minimized {
        height: auto !important;
        min-height: 0 !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack {
        /* Wire the bundled @fontsource faces (declared in knoww-inline.css)
           into the token names the panel references, so numbers render in
           JetBrains Mono and editorial accents in Fraunces italic instead of
           silently falling back to system fonts. */
        --kse-font-mono: "KnowwMono", ui-monospace, SFMono-Regular, Menlo, monospace;
        --kse-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        --kse-font-display: "KnowwEditorial", Georgia, "Times New Roman", serif;
      }

      .knoww-sidepanel-tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        padding: 10px 10px 6px;
      }

      .knoww-sidepanel-tab {
        height: 32px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        font: 600 10px/1 var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        transition: color 0.16s ease, background 0.16s ease, border-color 0.16s ease;
      }

      .knoww-sidepanel-tab:hover {
        color: rgba(255, 255, 255, 0.8);
        background: rgba(255, 255, 255, 0.04);
      }

      .knoww-sidepanel-tab.is-active {
        border-color: rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.09);
        color: rgba(255, 255, 255, 0.95);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }

      .knoww-sidepanel-panel[hidden],
      .knoww-sidepanel-portfolio-active .knoww-search-container {
        display: none !important;
      }

      .knoww-sidepanel-portfolio {
        --pf-mono: var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        --pf-sans: var(--kse-font-sans, system-ui, sans-serif);
        --pf-display: var(--kse-font-display, Georgia, "Times New Roman", serif);
        --pf-pos: #34d399;
        --pf-neg: #fb7185;
        --pf-hi: rgba(255, 255, 255, 0.96);
        /* Tiers tuned for legibility: at 9-12px on these dark surfaces the old
           0.58/0.40 muted tokens fell below ~3:1. Lifted to keep the same
           hierarchy (hi > mid > dim) while clearing AA for small UI text. */
        --pf-mid: rgba(255, 255, 255, 0.74);
        --pf-dim: rgba(255, 255, 255, 0.62);
        --pf-line: rgba(255, 255, 255, 0.07);
        --pf-line-2: rgba(255, 255, 255, 0.13);
        --pf-surface: rgba(255, 255, 255, 0.022);
        --pf-surface-2: rgba(255, 255, 255, 0.05);
        display: flex;
        flex-direction: column;
        gap: 12px;
        height: calc(100vh - 96px);
        overflow: auto;
        padding: 12px 12px 24px;
      }

      /* ---- Hero ---- */
      .knoww-pf-hero {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--pf-line-2);
        border-radius: 16px;
        padding: 15px 16px 0;
        background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.045),
          rgba(255, 255, 255, 0.012)
        );
      }

      .knoww-pf-hero::before {
        content: "";
        position: absolute;
        inset: -50% -10% auto -12%;
        height: 240px;
        background: radial-gradient(
          56% 100% at 26% 0%,
          var(--pf-glow, transparent),
          transparent 70%
        );
        pointer-events: none;
      }

      .knoww-pf-hero.is-up {
        --pf-glow: rgba(52, 211, 153, 0.26);
      }

      .knoww-pf-hero.is-down {
        --pf-glow: rgba(251, 113, 133, 0.24);
      }

      .knoww-pf-hero.is-flat {
        --pf-glow: rgba(255, 255, 255, 0.06);
      }

      .knoww-pf-hero-top {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .knoww-pf-id {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .knoww-pf-kicker {
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--pf-dim);
      }

      .knoww-pf-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 16px/1.15 var(--pf-sans);
        letter-spacing: -0.01em;
        color: var(--pf-hi);
      }

      .knoww-pf-hero-value {
        position: relative;
        margin-top: 20px;
      }

      .knoww-pf-hero-label {
        display: block;
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--pf-dim);
      }

      .knoww-pf-hero-num {
        display: block;
        margin-top: 8px;
        font: 500 34px/1 var(--pf-mono);
        letter-spacing: -0.022em;
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-delta {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        margin-top: 11px;
        font: 500 12px/1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-delta.positive {
        color: var(--pf-pos);
      }

      .knoww-pf-delta.negative {
        color: var(--pf-neg);
      }

      .knoww-pf-delta.flat {
        color: var(--pf-mid);
      }

      .knoww-pf-delta-arrow {
        width: 9px;
        height: 9px;
        fill: currentColor;
      }

      .knoww-pf-hero.is-down .knoww-pf-delta-arrow {
        transform: rotate(180deg);
      }

      .knoww-pf-delta-num {
        color: inherit;
      }

      .knoww-pf-delta-label {
        color: var(--pf-dim);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .knoww-pf-strip {
        position: relative;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin: 18px -16px 0;
        border-top: 1px solid var(--pf-line);
      }

      .knoww-pf-strip-cell {
        display: grid;
        gap: 6px;
        min-width: 0;
        padding: 13px 14px;
        border-right: 1px solid var(--pf-line);
      }

      .knoww-pf-strip-cell:first-child {
        padding-left: 16px;
      }

      .knoww-pf-strip-cell:last-child {
        padding-right: 16px;
        border-right: 0;
      }

      .knoww-pf-strip-label {
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--pf-dim);
      }

      .knoww-pf-strip-cell strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 500 14px/1 var(--pf-mono);
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-hero-actions {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex: none;
      }

      /* Icon-only disconnect — mirrors the trading-panel header action. Sits
         beside Open; tints red on hover to signal it's a destructive action. */
      .knoww-pf-hero-disconnect {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid var(--pf-line-2);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.72);
        cursor: pointer;
        transition: color 0.15s ease, background 0.15s ease,
          border-color 0.15s ease, opacity 0.15s ease;
      }

      .knoww-pf-hero-disconnect:hover {
        border-color: rgba(251, 113, 133, 0.5);
        background: rgba(251, 113, 133, 0.14);
        color: var(--pf-neg);
      }

      .knoww-pf-hero-disconnect svg {
        width: 13px;
        height: 13px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-hero-disconnect.is-busy {
        opacity: 0.55;
        pointer-events: none;
      }

      /* ---- Open button (also used in wallet/sign-in actions) ---- */
      .knoww-portfolio-open {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        border: 1px solid var(--pf-line-2);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.82);
        cursor: pointer;
        padding: 0 12px;
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        white-space: nowrap;
        transition: color 0.15s ease, background 0.15s ease,
          border-color 0.15s ease;
      }

      .knoww-portfolio-open:hover {
        border-color: rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.09);
        color: #fff;
      }

      .knoww-portfolio-open svg {
        width: 11px;
        height: 11px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-portfolio-open.primary {
        border-color: rgba(52, 211, 153, 0.5);
        background: rgba(52, 211, 153, 0.16);
        color: #eafff5;
      }

      .knoww-portfolio-open.primary:hover {
        border-color: rgba(52, 211, 153, 0.72);
        background: rgba(52, 211, 153, 0.24);
        color: #fff;
      }

      .knoww-portfolio-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }

      /* ---- Wallets / sign-in ---- */
      .knoww-portfolio-wallets {
        display: grid;
        width: min(280px, 100%);
        gap: 8px;
      }

      .knoww-portfolio-wallet {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        min-height: 44px;
        border: 1px solid var(--pf-line-2);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        padding: 7px 12px;
        text-align: left;
        transition: border-color 0.15s ease, background 0.15s ease;
      }

      .knoww-portfolio-wallet:hover {
        border-color: rgba(52, 211, 153, 0.45);
        background: rgba(52, 211, 153, 0.1);
      }

      .knoww-portfolio-wallet img,
      .knoww-portfolio-wallet span {
        width: 28px;
        height: 28px;
        border-radius: 8px;
      }

      .knoww-portfolio-wallet img {
        object-fit: cover;
      }

      .knoww-portfolio-wallet span {
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.8);
        font: 600 12px/1 var(--pf-mono);
      }

      .knoww-portfolio-wallet strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 12px/1.2 var(--pf-sans);
      }

      /* ---- Trading gate ---- */
      .knoww-portfolio-trading-gate {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        border: 1px solid rgba(52, 211, 153, 0.24);
        border-radius: 14px;
        background: linear-gradient(
          180deg,
          rgba(52, 211, 153, 0.11),
          rgba(52, 211, 153, 0.03)
        );
        padding: 13px 14px;
      }

      .knoww-portfolio-trading-gate strong {
        display: block;
        color: rgba(255, 255, 255, 0.95);
        font: 600 12px/1.2 var(--pf-sans);
      }

      .knoww-portfolio-trading-gate span {
        display: block;
        margin-top: 4px;
        color: var(--pf-mid);
        font: 500 11px/1.4 var(--pf-sans);
      }

      /* ---- Deposit / Withdraw ---- */
      .knoww-pf-fund-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .knoww-pf-fund-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 40px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--pf-hi);
        cursor: pointer;
        font: 600 11px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        transition: color 0.15s ease, background 0.15s ease,
          border-color 0.15s ease;
      }

      .knoww-pf-fund-btn svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-fund-btn:hover {
        border-color: rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.08);
      }

      .knoww-pf-fund-btn.primary {
        border-color: rgba(52, 211, 153, 0.5);
        background: rgba(52, 211, 153, 0.16);
        color: #eafff5;
      }

      .knoww-pf-fund-btn.primary:hover {
        border-color: rgba(52, 211, 153, 0.72);
        background: rgba(52, 211, 153, 0.24);
        color: #fff;
      }

      /* ---- Deposit / Withdraw form ---- */
      .knoww-pf-fund {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      /* Per-action accent. Deposit = emerald (incoming), withdraw = gold
         (outgoing). Drives the kicker, focus rings, prefix, chips and submit so
         each modal has its own colour identity. */
      .knoww-pf-fund.is-deposit {
        --pf-accent: #34d399;
        --pf-accent-strong: #5ff0bb;
        --pf-accent-border: rgba(52, 211, 153, 0.5);
        --pf-accent-bg: rgba(52, 211, 153, 0.16);
        --pf-accent-bg-hover: rgba(52, 211, 153, 0.24);
        --pf-accent-tint: rgba(52, 211, 153, 0.1);
        --pf-accent-text: #eafff5;
      }

      .knoww-pf-fund.is-withdraw {
        --pf-accent: #f7c948;
        --pf-accent-strong: #ffd968;
        --pf-accent-border: rgba(247, 201, 72, 0.52);
        --pf-accent-bg: rgba(247, 201, 72, 0.16);
        --pf-accent-bg-hover: rgba(247, 201, 72, 0.24);
        --pf-accent-tint: rgba(247, 201, 72, 0.1);
        --pf-accent-text: #fff6df;
      }

      .knoww-pf-fund-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .knoww-pf-fund-back {
        flex: none;
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 1px solid var(--pf-line-2);
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--pf-mid);
        cursor: pointer;
        transition: color 0.14s ease, background 0.14s ease;
      }

      .knoww-pf-fund-back:hover {
        color: var(--pf-accent, var(--pf-hi));
        border-color: var(--pf-accent-border, var(--pf-line-2));
        background: var(--pf-accent-tint, rgba(255, 255, 255, 0.08));
      }

      .knoww-pf-fund-back svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-fund-kicker {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--pf-accent, var(--pf-dim));
      }

      .knoww-pf-fund-kicker::before {
        content: "";
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--pf-accent, var(--pf-dim));
        box-shadow: 0 0 0 3px var(--pf-accent-tint, transparent);
      }

      .knoww-pf-fund-sub {
        margin: 4px 0 0;
        font: 500 12px/1.4 var(--pf-sans);
        color: var(--pf-mid);
      }

      .knoww-pf-fund-field {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }

      .knoww-pf-fund-field-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font: 600 10.5px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--pf-mid);
      }

      .knoww-pf-fund-max {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: 0;
        background: transparent;
        color: var(--pf-mid);
        cursor: pointer;
        font: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
      }

      .knoww-pf-fund-max strong {
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-fund-max:hover {
        color: var(--pf-hi);
      }

      /* The "Use my wallet" shortcut reads as an action, so it carries the
         modal's accent rather than the muted tone of the read-only Max chip. */
      .knoww-pf-fund-max[data-fund-use-eoa] {
        color: var(--pf-accent, var(--pf-mid));
      }

      .knoww-pf-fund-max[data-fund-use-eoa]:hover {
        color: var(--pf-accent-strong, var(--pf-hi));
      }

      /* Read-only "Available / Balance" figure — the actionable Max now lives
         inside the amount box. */
      .knoww-pf-fund-avail {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--pf-mid);
      }

      .knoww-pf-fund-avail strong {
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-fund-amount {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.2);
        padding: 0 14px;
        transition: border-color 0.14s ease, box-shadow 0.14s ease;
      }

      .knoww-pf-fund-amount:focus-within {
        border-color: var(--pf-accent-border, rgba(255, 255, 255, 0.32));
        box-shadow: 0 0 0 3px var(--pf-accent-tint, transparent);
      }

      .knoww-pf-fund-amount span {
        color: var(--pf-accent, var(--pf-mid));
        font: 600 20px/1 var(--pf-mono);
      }

      .knoww-pf-fund-amount input {
        flex: 1;
        min-width: 0;
        height: 50px;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--pf-hi);
        font: 500 22px/1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-fund-amount input::placeholder,
      .knoww-pf-fund-dest::placeholder {
        color: rgba(255, 255, 255, 0.32);
      }

      /* In-box Max: carries the modal accent and snaps the amount to the full
         available balance. */
      .knoww-pf-amount-max {
        flex: 0 0 auto;
        align-self: center;
        padding: 6px 11px;
        border: 1px solid var(--pf-accent-border, var(--pf-line-2));
        border-radius: 9px;
        background: var(--pf-accent-tint, rgba(255, 255, 255, 0.06));
        color: var(--pf-accent, var(--pf-hi));
        cursor: pointer;
        font: 700 10px/1 var(--pf-mono);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        transition: background 0.14s ease, border-color 0.14s ease;
      }

      .knoww-pf-amount-max:hover {
        background: var(--pf-accent-bg, rgba(255, 255, 255, 0.12));
        border-color: var(--pf-accent, var(--pf-line-2));
      }

      .knoww-pf-amount-max:active {
        transform: translateY(0.5px);
      }

      .knoww-pf-fund-dest {
        height: 42px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.2);
        outline: none;
        padding: 0 14px;
        color: var(--pf-hi);
        font: 500 12px/1 var(--pf-mono);
      }

      .knoww-pf-fund-dest:focus {
        border-color: var(--pf-accent-border, rgba(255, 255, 255, 0.32));
        box-shadow: 0 0 0 3px var(--pf-accent-tint, transparent);
      }

      .knoww-pf-fund-hint {
        margin-top: 2px;
        color: var(--pf-dim);
        font: 500 10.5px/1.4 var(--pf-sans);
        letter-spacing: 0.01em;
      }

      .knoww-pf-fund-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .knoww-pf-fund-row .knoww-pf-fund-field {
        min-width: 0;
      }

      .knoww-pf-fund-select {
        position: relative;
        display: flex;
        align-items: center;
      }

      .knoww-pf-fund-select select {
        appearance: none;
        width: 100%;
        height: 44px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.2);
        outline: none;
        padding: 0 36px 0 14px;
        color: var(--pf-hi);
        font: 600 12px/1 var(--pf-sans);
        cursor: pointer;
      }

      .knoww-pf-fund-select select:focus {
        border-color: var(--pf-accent-border, rgba(255, 255, 255, 0.32));
        box-shadow: 0 0 0 3px var(--pf-accent-tint, transparent);
      }

      .knoww-pf-fund-select svg {
        position: absolute;
        right: 13px;
        width: 16px;
        height: 16px;
        fill: none;
        stroke: var(--pf-mid);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }

      .knoww-pf-fund-status {
        border-radius: 10px;
        padding: 10px 12px;
        font: 500 11px/1.4 var(--pf-sans);
      }

      .knoww-pf-fund-status.is-info {
        background: rgba(255, 255, 255, 0.05);
        color: var(--pf-mid);
      }

      .knoww-pf-fund-status.is-error {
        background: rgba(251, 113, 133, 0.12);
        color: var(--pf-neg);
      }

      .knoww-pf-fund-status.is-success {
        background: rgba(52, 211, 153, 0.12);
        color: var(--pf-pos);
      }

      .knoww-pf-withdraw-quote {
        display: grid;
        gap: 8px;
        border: 1px solid rgba(59, 130, 246, 0.38);
        border-radius: 10px;
        background: rgba(37, 99, 235, 0.12);
        padding: 10px 12px;
      }

      .knoww-pf-withdraw-quote[hidden] {
        display: none;
      }

      .knoww-pf-withdraw-quote.is-error {
        border-color: rgba(251, 113, 133, 0.36);
        background: rgba(251, 113, 133, 0.12);
      }

      .knoww-pf-withdraw-quote-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        font: 500 11px/1.3 var(--pf-sans);
        color: var(--pf-mid);
      }

      .knoww-pf-withdraw-quote-row span:first-child {
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--pf-dim);
      }

      .knoww-pf-withdraw-quote-row strong {
        min-width: 0;
        text-align: right;
        color: var(--pf-hi);
        overflow-wrap: anywhere;
      }

      .knoww-pf-fund-submit {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        height: 44px;
        border: 1px solid var(--pf-accent-border, var(--pf-line-2));
        border-radius: 12px;
        background: var(--pf-accent-bg, rgba(255, 255, 255, 0.06));
        color: var(--pf-accent-text, var(--pf-hi));
        cursor: pointer;
        font: 600 11px/1 var(--pf-mono);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        transition: background 0.15s ease, border-color 0.15s ease,
          opacity 0.15s ease;
      }

      .knoww-pf-fund-submit.primary {
        border-color: rgba(52, 211, 153, 0.5);
        background: rgba(52, 211, 153, 0.18);
        color: #eafff5;
      }

      .knoww-pf-fund-submit:hover:not(:disabled) {
        background: var(--pf-accent-bg-hover, rgba(255, 255, 255, 0.1));
      }

      .knoww-pf-fund-submit.primary:hover:not(:disabled) {
        background: rgba(52, 211, 153, 0.26);
      }

      .knoww-pf-fund-submit:disabled {
        cursor: default;
        opacity: 0.55;
      }

      /* Loading: stay bright (it's working, not unavailable) and run a thin
         rotating ring in the modal's accent colour next to a live label. */
      .knoww-pf-fund-submit.is-loading {
        cursor: progress;
        opacity: 1;
      }

      .knoww-pf-fund-submit.is-loading.primary {
        background: rgba(52, 211, 153, 0.22);
      }

      .knoww-pf-submit-spinner {
        display: none;
        width: 14px;
        height: 14px;
        flex: 0 0 auto;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.22);
        border-top-color: currentColor;
        animation: knoww-pf-spin 0.7s linear infinite;
      }

      .knoww-pf-fund-submit.is-loading .knoww-pf-submit-spinner {
        display: inline-block;
      }

      .knoww-pf-submit-label {
        display: inline-block;
      }

      @media (prefers-reduced-motion: reduce) {
        .knoww-pf-submit-spinner {
          animation-duration: 1.6s;
        }
      }

      /* ---- Deposit method + token lists ---- */
      .knoww-pf-method-list,
      .knoww-pf-token-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .knoww-pf-method {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
        padding: 12px 14px;
        text-align: left;
        transition: border-color 0.14s ease, background 0.14s ease;
      }

      .knoww-pf-method:hover:not(:disabled) {
        border-color: rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.06);
      }

      .knoww-pf-method.is-soon {
        cursor: default;
        opacity: 0.5;
      }

      .knoww-pf-method-n {
        font: 600 11px/1 var(--pf-mono);
        color: var(--pf-accent, var(--pf-dim));
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-method:hover:not(:disabled) .knoww-pf-method-arrow {
        stroke: var(--pf-accent, var(--pf-dim));
      }

      .knoww-pf-method.is-soon .knoww-pf-method-n {
        color: var(--pf-dim);
      }

      .knoww-pf-method-main {
        min-width: 0;
        display: grid;
        gap: 3px;
      }

      .knoww-pf-method-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 14px/1.1 var(--pf-sans);
        color: var(--pf-hi);
      }

      .knoww-pf-method-meta {
        font: 500 10px/1 var(--pf-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pf-mid);
      }

      .knoww-pf-method-arrow {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: var(--pf-dim);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-method-soon {
        border: 1px solid rgba(245, 191, 36, 0.4);
        border-radius: 999px;
        padding: 3px 7px;
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(245, 191, 36, 0.85);
      }

      .knoww-pf-token {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        border: 1px solid var(--pf-line);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
        padding: 12px 14px;
        text-align: left;
        transition: border-color 0.14s ease, background 0.14s ease;
      }

      .knoww-pf-token:hover:not(.is-disabled) {
        border-color: rgba(255, 255, 255, 0.26);
        background: rgba(255, 255, 255, 0.06);
      }

      .knoww-pf-token.is-disabled {
        cursor: default;
        opacity: 0.42;
      }

      .knoww-pf-token.is-disabled .knoww-pf-token-min {
        color: var(--pf-neg);
      }

      .knoww-pf-token-id {
        min-width: 0;
        display: grid;
        gap: 3px;
      }

      .knoww-pf-token-sym {
        font: 600 14px/1 var(--pf-sans);
        color: var(--pf-hi);
      }

      .knoww-pf-token-bal {
        font: 500 12px/1 var(--pf-mono);
        color: rgba(255, 255, 255, 0.8);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-token-meta {
        display: grid;
        gap: 3px;
        justify-items: end;
      }

      .knoww-pf-token-meta strong {
        font: 600 14px/1 var(--pf-mono);
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-token-min {
        font: 600 10.5px/1 var(--pf-mono);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(245, 191, 36, 0.92);
      }

      /* ---- Table (tabs + panels) ---- */
      .knoww-portfolio-table {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .knoww-portfolio-table-tabs {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 2px;
        padding: 3px;
        border: 1px solid var(--pf-line);
        border-radius: 11px;
        background: rgba(0, 0, 0, 0.22);
      }

      .knoww-portfolio-table-tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 0;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--pf-mid);
        cursor: pointer;
        padding: 8px 6px;
        transition: color 0.15s ease, background 0.15s ease;
      }

      .knoww-portfolio-table-tab span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }

      .knoww-portfolio-table-tab strong {
        flex: none;
        min-width: 18px;
        padding: 2px 5px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.07);
        color: var(--pf-mid);
        font: 500 10px/1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
        text-align: center;
      }

      .knoww-portfolio-table-tab:hover {
        color: var(--pf-hi);
      }

      .knoww-portfolio-table-tab.is-active {
        background: rgba(255, 255, 255, 0.08);
        color: var(--pf-hi);
      }

      .knoww-portfolio-table-tab.is-active strong {
        background: rgba(52, 211, 153, 0.16);
        color: var(--pf-pos);
      }

      .knoww-portfolio-table-panel {
        overflow: hidden;
        border: 1px solid var(--pf-line);
        border-radius: 14px;
        background: var(--pf-surface);
      }

      .knoww-portfolio-table-panel[hidden] {
        display: none;
      }

      /* ---- History pager ---- */
      .knoww-portfolio-history-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 40px;
        border-top: 1px solid var(--pf-line);
        padding: 8px 12px;
      }

      .knoww-portfolio-history-controls span {
        color: var(--pf-dim);
        font: 500 10px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .knoww-portfolio-history-controls div {
        display: flex;
        gap: 6px;
      }

      .knoww-portfolio-history-button {
        display: grid;
        place-items: center;
        width: 28px;
        height: 26px;
        border: 1px solid var(--pf-line-2);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.82);
        cursor: pointer;
        transition: background 0.13s ease, border-color 0.13s ease;
      }

      .knoww-portfolio-history-button:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.28);
      }

      .knoww-portfolio-history-button:disabled {
        cursor: default;
        opacity: 0.34;
      }

      .knoww-portfolio-history-button svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2;
      }

      /* ---- Rows ---- */
      .knoww-portfolio-row {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr) auto;
        gap: 11px;
        align-items: center;
        border-bottom: 1px solid var(--pf-line);
        padding: 11px 12px;
        color: inherit;
        text-decoration: none;
        transition: background 0.12s ease;
      }

      .knoww-portfolio-row:last-child {
        border-bottom: 0;
      }

      /* Rows that open the market on knoww.app are anchors — only these get the
         pointer + hover affordance so non-linked rows don't look clickable.
         Open-order rows wrap their content in an inner .order-link instead so
         the Cancel button can sit outside the anchor; :has lets the whole row
         still highlight when that inner link is hovered/focused. */
      .knoww-portfolio-row.is-link,
      .knoww-portfolio-order-link.is-link {
        cursor: pointer;
      }

      .knoww-portfolio-row.is-link:hover,
      .knoww-portfolio-row:has(.knoww-portfolio-order-link.is-link:hover) {
        background: rgba(255, 255, 255, 0.03);
      }

      .knoww-portfolio-row.is-link:focus-visible,
      .knoww-portfolio-order-link.is-link:focus-visible {
        outline: none;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px var(--pf-line-2);
      }

      .knoww-portfolio-row.compact {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .knoww-portfolio-position-item {
        border-bottom: 1px solid var(--pf-line);
      }

      .knoww-portfolio-position-item:last-child {
        border-bottom: 0;
      }

      .knoww-portfolio-position-trigger {
        appearance: none;
        width: 100%;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        margin: 0;
        text-align: left;
        cursor: pointer;
      }

      .knoww-portfolio-position-trigger:hover,
      .knoww-portfolio-position-item.is-expanded
        .knoww-portfolio-position-trigger {
        background: rgba(255, 255, 255, 0.03);
      }

      .knoww-portfolio-position-trigger:focus-visible {
        outline: none;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px var(--pf-line-2);
      }

      .knoww-portfolio-position-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr) 34px;
        gap: 8px;
        padding: 0 12px 11px;
      }

      .knoww-portfolio-position-actions[hidden] {
        display: none;
      }

      .knoww-portfolio-position-action {
        appearance: none;
        min-width: 0;
        height: 28px;
        border: 1px solid var(--pf-line-2);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--pf-hi);
        cursor: pointer;
        font: 700 9px/1 var(--pf-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
        transition: background 0.14s ease, border-color 0.14s ease,
          color 0.14s ease, opacity 0.14s ease;
      }

      .knoww-portfolio-position-action:hover:not(:disabled) {
        border-color: rgba(255, 255, 255, 0.32);
        background: rgba(255, 255, 255, 0.08);
      }

      .knoww-portfolio-position-action.danger {
        border-color: rgba(251, 113, 133, 0.45);
        background: rgba(251, 113, 133, 0.12);
        color: #ffd7df;
      }

      .knoww-portfolio-position-action.danger.is-confirming {
        border-color: rgba(251, 113, 133, 0.68);
        background: rgba(251, 113, 133, 0.24);
        color: #fff5f7;
      }

      .knoww-portfolio-position-action.icon {
        padding: 0;
      }

      .knoww-portfolio-position-action:disabled {
        cursor: default;
        opacity: 0.48;
      }

      .knoww-portfolio-position-error {
        padding: 0 12px 11px;
        color: var(--pf-neg);
        font: 600 10px/1.35 var(--pf-sans);
      }

      .knoww-portfolio-position-confirm {
        padding: 0 12px 8px;
        color: rgba(255, 255, 255, 0.82);
        font: 600 11px/1.3 var(--pf-sans);
      }

      /* Open-order row: [market link][cancel]. The link reuses the compact
         two-column layout internally. */
      .knoww-portfolio-order {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .knoww-portfolio-order-link {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 11px;
        align-items: center;
        min-width: 0;
        color: inherit;
        text-decoration: none;
      }

      .knoww-portfolio-cancel {
        flex: none;
        align-self: center;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* Fixed width so swapping the label (Cancel → Confirm → … → Failed)
           never changes the button size or shifts the row. */
        min-width: 70px;
        height: 24px;
        padding: 0 10px;
        border: 1px solid var(--pf-line-2);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--pf-mid);
        cursor: pointer;
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        white-space: nowrap;
        transition: color 0.14s ease, background 0.14s ease,
          border-color 0.14s ease;
      }

      .knoww-portfolio-cancel:hover {
        color: var(--pf-hi);
        border-color: rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.08);
      }

      .knoww-portfolio-cancel.is-armed {
        color: #fff;
        border-color: rgba(251, 113, 133, 0.62);
        background: rgba(251, 113, 133, 0.22);
      }

      .knoww-portfolio-cancel.is-busy {
        opacity: 0.6;
        cursor: default;
      }

      .knoww-portfolio-cancel.is-error {
        color: var(--pf-neg);
        border-color: rgba(251, 113, 133, 0.5);
        background: rgba(251, 113, 133, 0.12);
      }

      .knoww-portfolio-row-icon {
        width: 32px;
        height: 32px;
        overflow: hidden;
        border-radius: 9px;
        border: 1px solid var(--pf-line);
        background: rgba(255, 255, 255, 0.06);
      }

      .knoww-portfolio-row-icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .knoww-portfolio-row-icon span {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        color: var(--pf-mid);
        font: 600 12px/1 var(--pf-mono);
        text-transform: uppercase;
      }

      .knoww-portfolio-row-main {
        min-width: 0;
      }

      .knoww-portfolio-row-title {
        overflow: hidden;
        color: rgba(255, 255, 255, 0.92);
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        font: 600 13px/1.3 var(--pf-sans);
      }

      .knoww-portfolio-row-meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 4px;
        color: var(--pf-dim);
        font: 500 10.5px/1.2 var(--pf-mono);
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .knoww-portfolio-row-value {
        display: grid;
        gap: 3px;
        justify-items: end;
        min-width: 72px;
        text-align: right;
      }

      .knoww-portfolio-row-value strong {
        color: var(--pf-hi);
        font: 500 13px/1.1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      .knoww-portfolio-row-value span {
        color: var(--pf-mid);
        font: 500 10.5px/1.1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      /* ---- Empty / loading ---- */
      .knoww-portfolio-empty,
      .knoww-portfolio-loading,
      .knoww-portfolio-signed-out {
        display: grid;
        gap: 7px;
        place-items: center;
        min-height: 168px;
        padding: 30px 20px;
        text-align: center;
      }

      .knoww-portfolio-loading {
        color: var(--pf-mid);
        font: 500 11px/1.4 var(--pf-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .knoww-portfolio-loading::before {
        content: "";
        width: 22px;
        height: 22px;
        margin-bottom: 4px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.12);
        border-top-color: var(--pf-pos);
        animation: knoww-pf-spin 0.8s linear infinite;
      }

      @keyframes knoww-pf-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .knoww-portfolio-loading::before {
          animation: none;
        }
      }

      .knoww-pf-empty-mark {
        display: grid;
        place-items: center;
        width: 42px;
        height: 42px;
        margin-bottom: 4px;
        border: 1px solid var(--pf-line-2);
        border-radius: 13px;
        background: var(--pf-surface-2);
        color: var(--pf-dim);
      }

      .knoww-pf-empty-mark svg {
        width: 19px;
        height: 19px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.6;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-empty-title {
        margin: 0;
        font: 500 17px/1.2 var(--pf-display);
        font-style: italic;
        letter-spacing: 0.01em;
        color: rgba(255, 255, 255, 0.84);
      }

      .knoww-pf-empty-sub {
        max-width: 230px;
        color: var(--pf-dim);
        font: 500 11px/1.5 var(--pf-mono);
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .knoww-pf-empty-sub.is-error {
        color: var(--pf-neg);
        letter-spacing: 0.01em;
        text-transform: none;
      }

      .knoww-portfolio-signed-out .knoww-portfolio-wallets,
      .knoww-portfolio-signed-out .knoww-portfolio-actions {
        margin-top: 8px;
      }

      /* Three-column variant of the wallet button: [icon][label][chevron].
         Scoped, higher-specificity overrides — the base .knoww-portfolio-wallet
         rules force a 2-column grid and size every descendant span to 28x28,
         which otherwise squeezes the label span to 28px and drops the chevron. */
      .knoww-portfolio-wallet.knoww-pf-wallet-mobile {
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 11px;
        text-align: left;
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-qr {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        background: var(--pf-surface-2);
        border: 1px solid var(--pf-line-2);
        color: var(--pf-pos);
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-qr svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-id {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        width: auto;
        height: auto;
        min-width: 0;
        border-radius: 0;
        background: transparent;
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-id strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 12.5px/1.2 var(--pf-sans);
        color: rgba(255, 255, 255, 0.92);
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-id small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 500 10px/1.3 var(--pf-mono);
        letter-spacing: 0.02em;
        color: var(--pf-dim);
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-go {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: var(--pf-mid);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-wc-frame {
        display: grid;
        place-items: center;
        width: 224px;
        max-width: 100%;
        min-height: 224px;
        margin: 12px auto 4px;
        padding: 12px;
        border-radius: 18px;
        background: #ffffff;
        box-shadow:
          0 18px 40px -22px rgba(0, 0, 0, 0.8),
          inset 0 0 0 1px rgba(0, 0, 0, 0.06);
      }

      .knoww-pf-wc-qr {
        display: block;
        width: 100%;
      }

      .knoww-pf-wc-qr svg {
        display: block;
        width: 100%;
        height: auto;
      }

      .knoww-pf-wc-status {
        display: grid;
        gap: 10px;
        place-items: center;
        padding: 24px;
        color: #5b5b5b;
        font: 500 11px/1.4 var(--pf-mono);
        letter-spacing: 0.04em;
        text-align: center;
      }

      .knoww-pf-wc-status.is-error {
        color: #b4232a;
      }

      .knoww-pf-wc-spinner {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid rgba(0, 0, 0, 0.12);
        border-top-color: #0a0a0a;
        animation: knoww-pf-spin 0.8s linear infinite;
      }

      .knoww-pf-wc-hint {
        max-width: 240px;
        margin: 2px auto 0;
        color: var(--pf-dim);
        font: 500 10px/1.5 var(--pf-mono);
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }

      @media (prefers-reduced-motion: reduce) {
        .knoww-pf-wc-spinner {
          animation: none;
        }
      }

      .knoww-pf-stale {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        padding: 8px 10px;
        border: 1px solid var(--pf-line-2);
        border-radius: 11px;
        background: var(--pf-surface-2);
        color: var(--pf-mid);
      }

      .knoww-pf-stale svg {
        flex: 0 0 auto;
        width: 14px;
        height: 14px;
        fill: none;
        stroke: var(--pf-neg);
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-stale-text {
        flex: 1 1 auto;
        font: 500 10px/1.4 var(--pf-mono);
        letter-spacing: 0.02em;
      }

      .knoww-pf-stale-retry {
        flex: 0 0 auto;
        padding: 4px 9px;
        border: 1px solid var(--pf-line-2);
        border-radius: 8px;
        background: transparent;
        color: rgba(255, 255, 255, 0.82);
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .knoww-pf-stale-retry:hover {
        background: rgba(255, 255, 255, 0.06);
      }

      .positive {
        color: #36d399 !important;
      }

      .negative {
        color: #fb7185 !important;
      }
    </style>
    <div
      id="knoww-notification-stack"
      class="knoww-notification-stack knoww-notification-stack-twitter knoww-theme-dark knoww-stack-expanded knoww-sidepanel-stack"
    >
      <div class="knoww-stack-header">
        <div class="knoww-stack-title">
          <span class="knoww-stack-icon" aria-hidden="true">
            <img src="icons/icon-128.png" alt="Knoww" width="20" height="20" />
          </span>
          <span>Markets</span>
        </div>
        <div class="knoww-stack-header-right">
          <button type="button" class="knoww-stack-settings" title="Settings" aria-label="Open extension settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.08a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 5a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"></path>
            </svg>
          </button>
          <button type="button" class="knoww-stack-popout" title="Move to floating panel" aria-label="Move markets panel to floating panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2"></rect>
              <path d="M9 4v16"></path>
              <path d="m11 9 3 3-3 3"></path>
            </svg>
          </button>
          <button type="button" class="knoww-search-toggle" id="knoww-search-toggle" title="Search markets" aria-label="Search markets">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="M21 21l-4.35-4.35"></path>
            </svg>
          </button>
          <button type="button" class="knoww-stack-minimize" id="knoww-stack-minimize" title="Minimize" aria-label="Minimize" aria-expanded="true">
            ${STACK_MINIMIZE_ICON_HTML}
          </button>
          <button type="button" class="knoww-stack-close" title="Close sidebar" aria-label="Close markets sidebar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="knoww-sidepanel-tabs" role="tablist" aria-label="Side panel sections">
        <button type="button" class="knoww-sidepanel-tab is-active" data-sidepanel-view="markets" role="tab" aria-selected="true">
          Markets
        </button>
        <button type="button" class="knoww-sidepanel-tab" data-sidepanel-view="portfolio" role="tab" aria-selected="false">
          Portfolio
        </button>
      </div>
      <div class="knoww-search-container" id="knoww-search-container">
        <div class="knoww-search-input-wrapper">
          <input
            type="text"
            class="knoww-search-input"
            id="knoww-search-input"
            placeholder="Search Polymarket..."
            autocomplete="off"
          />
          <button type="button" class="knoww-search-clear" id="knoww-search-clear" aria-label="Clear search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="knoww-search-results" id="knoww-search-results"></div>
      </div>
      <div class="knoww-stack-content knoww-sidepanel-panel" data-sidepanel-markets>
        <div class="knoww-stack-items" data-sidepanel-items>
          <div class="knoww-stack-empty">
            <span class="knoww-stack-empty-title">Loading markets</span>
          </div>
        </div>
      </div>
      <div class="knoww-sidepanel-panel knoww-sidepanel-portfolio" data-sidepanel-portfolio hidden>
        <div class="knoww-portfolio-loading">Loading portfolio...</div>
      </div>
      <div class="knoww-stack-footer">
        <span class="knoww-stack-footer-live" data-sidepanel-live>${formatLiveTimeLabel()}</span>
      </div>
    </div>
  `;

  root
    .querySelector<HTMLButtonElement>(".knoww-stack-settings")
    ?.addEventListener(
      "click",
      () => void sendRuntimeMessage({ type: "KNOWW_OPEN_EXTENSION_SETTINGS" })
    );
  root
    .querySelectorAll<HTMLButtonElement>("[data-sidepanel-view]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.sidepanelView;
        if (view === "markets" || view === "portfolio") {
          setSidepanelView(view);
        }
      });
    });
  root
    .querySelector<HTMLButtonElement>("#knoww-search-toggle")
    ?.addEventListener("click", () => {
      const container = root.querySelector("#knoww-search-container");
      const toggle = root.querySelector("#knoww-search-toggle");
      container?.classList.toggle("knoww-search-open");
      toggle?.classList.toggle("knoww-search-active");
      root.querySelector<HTMLInputElement>("#knoww-search-input")?.focus();
    });
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let currentSearchQuery = "";
  root
    .querySelector<HTMLButtonElement>("#knoww-search-clear")
    ?.addEventListener("click", () => {
      const input = root.querySelector<HTMLInputElement>("#knoww-search-input");
      const container = root.querySelector("#knoww-search-container");
      const toggle = root.querySelector("#knoww-search-toggle");
      const results = root.querySelector("#knoww-search-results");
      if (!input) return;

      if (searchTimer) clearTimeout(searchTimer);
      currentSearchQuery = "";
      results?.replaceChildren();

      if (input.value.trim() === "") {
        container?.classList.remove("knoww-search-open");
        toggle?.classList.remove("knoww-search-active");
        return;
      }

      input.value = "";
      input?.focus();
    });
  root
    .querySelector<HTMLInputElement>("#knoww-search-input")
    ?.addEventListener("input", (event) => {
      const input = event.currentTarget;
      if (!(input instanceof HTMLInputElement)) return;
      const results = root.querySelector<HTMLElement>("#knoww-search-results");
      const query = input.value.trim();
      currentSearchQuery = query;
      if (searchTimer) clearTimeout(searchTimer);
      if (!results) return;

      if (query.length < 2) {
        results.replaceChildren();
        return;
      }

      results.innerHTML =
        '<div class="knoww-search-loading">Searching...</div>';
      searchTimer = setTimeout(() => {
        void searchMarkets(query).then((markets) => {
          if (currentSearchQuery !== query) return;
          if (markets.length === 0) {
            results.innerHTML =
              '<div class="knoww-search-empty">No markets found</div>';
            return;
          }
          results.innerHTML = renderMarketRows(markets, "trending");
        });
      }, SEARCH_DEBOUNCE_MS);
    });
  root
    .querySelector<HTMLButtonElement>("#knoww-stack-minimize")
    ?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      const stack = root.querySelector("#knoww-notification-stack");
      if (!(button instanceof HTMLButtonElement) || !stack) return;
      const minimized = !stack.classList.contains("knoww-stack-minimized");
      stack.classList.toggle("knoww-stack-minimized", minimized);
      stack.classList.toggle("knoww-stack-expanded", !minimized);
      button.innerHTML = minimized
        ? STACK_EXPAND_ICON_HTML
        : STACK_MINIMIZE_ICON_HTML;
      button.title = minimized ? "Expand" : "Minimize";
      button.setAttribute("aria-label", minimized ? "Expand" : "Minimize");
      button.setAttribute("aria-expanded", String(!minimized));
    });
  root
    .querySelector<HTMLButtonElement>(".knoww-stack-popout")
    ?.addEventListener("click", () => void switchToFloatingPanel());
  root
    .querySelector<HTMLButtonElement>(".knoww-stack-close")
    ?.addEventListener("click", () => void closeSidePanel());
  root.addEventListener("change", (event) => {
    const chainSelect = (event.target as Element | null)?.closest(
      "[data-fund-chain]"
    );
    if (chainSelect && portfolioFundView && portfolioBridgeAssets) {
      const container = getPortfolioContainer();
      if (container) {
        fillFundTokenSelect(
          container,
          portfolioFundView,
          portfolioBridgeAssets
        );
        if (portfolioFundView === "withdraw") {
          syncFundRecipientForChain(container);
          schedulePortfolioWithdrawQuote();
        }
      }
    }
    const tokenSelect = (event.target as Element | null)?.closest(
      "[data-fund-token]"
    );
    if (tokenSelect && portfolioFundView === "withdraw") {
      schedulePortfolioWithdrawQuote();
    }
  });
  root.addEventListener("input", (event) => {
    const target = event.target as Element | null;
    const amountInput = target?.closest<HTMLInputElement>("[data-fund-amount]");
    if (amountInput) {
      const normalized = normalizePortfolioAmountInput(amountInput.value);
      if (normalized !== amountInput.value) {
        amountInput.value = normalized;
      }
    }
    if (
      portfolioFundView === "withdraw" &&
      (amountInput || target?.closest("[data-fund-dest]"))
    ) {
      schedulePortfolioWithdrawQuote();
    }
  });
  root.addEventListener("click", (event) => {
    const cancelButton = (
      event.target as Element | null
    )?.closest<HTMLButtonElement>("[data-cancel-order]");
    if (cancelButton) {
      handleCancelOrderClick(cancelButton);
      return;
    }
    // Any other click in the panel dismisses a pending cancel confirmation.
    disarmCancelOrder();

    const portfolioPositionClose = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-close]");
    if (portfolioPositionClose) {
      closePortfolioPositionActions();
      return;
    }

    const portfolioPositionView = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-view]");
    if (portfolioPositionView) {
      const positionId = portfolioPositionView.dataset.positionId;
      const position = positionId ? findPortfolioPosition(positionId) : null;
      if (position) viewPortfolioPosition(position);
      return;
    }

    const portfolioPositionSellCancel = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-sell-cancel]");
    if (portfolioPositionSellCancel) {
      cancelPortfolioPositionSell();
      return;
    }

    const portfolioPositionSellConfirm = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-sell-confirm]");
    if (portfolioPositionSellConfirm) {
      const positionId = portfolioPositionSellConfirm.dataset.positionId;
      const position = positionId ? findPortfolioPosition(positionId) : null;
      if (position) void sellPortfolioPosition(position);
      return;
    }

    const portfolioPositionSell = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-sell]");
    if (portfolioPositionSell) {
      const positionId = portfolioPositionSell.dataset.positionId;
      const position = positionId ? findPortfolioPosition(positionId) : null;
      if (position) requestPortfolioPositionSell(position.id);
      return;
    }

    const portfolioPositionToggle = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-toggle]");
    if (portfolioPositionToggle) {
      const positionId = portfolioPositionToggle.dataset.positionId;
      if (positionId) togglePortfolioPositionActions(positionId);
      return;
    }

    const historyPrev = (event.target as Element | null)?.closest(
      "[data-portfolio-history-prev]"
    );
    if (historyPrev) {
      setPortfolioHistoryPage(portfolioHistoryPage - 1);
      return;
    }

    const historyNext = (event.target as Element | null)?.closest(
      "[data-portfolio-history-next]"
    );
    if (historyNext) {
      setPortfolioHistoryPage(portfolioHistoryPage + 1);
      return;
    }

    const portfolioTableTab = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-table-tab]");
    if (portfolioTableTab) {
      const view = portfolioTableTab.dataset.portfolioTableTab;
      if (view === "positions" || view === "orders" || view === "history") {
        setPortfolioTableView(view);
      }
      return;
    }

    const portfolioConnect = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-connect-portfolio-wallet]");
    if (portfolioConnect) {
      const walletUuid = portfolioConnect.dataset.walletUuid;
      if (walletUuid) void connectPortfolioWallet(walletUuid);
      return;
    }

    const portfolioWalletConnect = (event.target as Element | null)?.closest(
      "[data-connect-portfolio-walletconnect]"
    );
    if (portfolioWalletConnect) {
      void connectPortfolioWalletConnect();
      return;
    }

    const portfolioWalletConnectCancel = (
      event.target as Element | null
    )?.closest("[data-walletconnect-cancel]");
    if (portfolioWalletConnectCancel) {
      cancelPortfolioWalletConnect();
      return;
    }

    const portfolioWalletRefresh = (event.target as Element | null)?.closest(
      "[data-refresh-portfolio-wallets]"
    );
    if (portfolioWalletRefresh) {
      portfolioWallets = null;
      void loadPortfolio(true);
      return;
    }

    const portfolioTradingEnable = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-enable-portfolio-trading]");
    if (portfolioTradingEnable) {
      const ownerAddress = portfolioTradingEnable.dataset.ownerAddress;
      if (ownerAddress) void enablePortfolioTrading(ownerAddress);
      return;
    }

    const portfolioOpen = (event.target as Element | null)?.closest(
      "[data-open-portfolio]"
    );
    if (portfolioOpen) {
      openPortfolioPage();
      return;
    }

    const portfolioDisconnect = (
      event.target as Element | null
    )?.closest<HTMLButtonElement>("[data-portfolio-disconnect]");
    if (portfolioDisconnect) {
      void disconnectPortfolioWallet(portfolioDisconnect);
      return;
    }

    const portfolioFund = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-fund]");
    if (portfolioFund) {
      const action = portfolioFund.dataset.portfolioFund;
      if (action === "deposit" || action === "withdraw") {
        openPortfolioFunds(action);
      }
      return;
    }

    if ((event.target as Element | null)?.closest("[data-fund-back]")) {
      closePortfolioFunds();
      return;
    }

    const depositMethod = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-deposit-method]");
    if (depositMethod) {
      const method = depositMethod.dataset.depositMethod;
      if (method === "wallet") setDepositStep("wallet-token");
      else if (method === "bridge") setDepositStep("bridge");
      return;
    }

    const depositBack = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-deposit-back]"
    );
    if (depositBack) {
      setDepositStep(depositBack.dataset.depositBack as DepositStep);
      return;
    }

    const depositToken = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-deposit-token]"
    );
    if (depositToken) {
      const idx = Number(depositToken.dataset.depositToken);
      const token = portfolioWalletTokens?.[idx];
      if (token) {
        portfolioDepositToken = token;
        setDepositStep("amount");
      }
      return;
    }

    const useEoaChip = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-fund-use-eoa]"
    );
    if (useEoaChip) {
      const container = getPortfolioContainer();
      const destInput =
        container?.querySelector<HTMLInputElement>("[data-fund-dest]");
      if (destInput) {
        destInput.value = useEoaChip.dataset.eoa || "";
        destInput.focus();
        schedulePortfolioWithdrawQuote();
      }
      return;
    }

    if ((event.target as Element | null)?.closest("[data-fund-max]")) {
      const container = getPortfolioContainer();
      const amountInput =
        container?.querySelector<HTMLInputElement>("[data-fund-amount]");
      if (amountInput && portfolioFundView) {
        const value =
          portfolioFundView === "withdraw"
            ? String(latestPortfolioData?.cashBalance ?? 0)
            : container?.querySelector<HTMLElement>("[data-fund-avail]")
                ?.dataset.value || "0";
        amountInput.value = formatPortfolioAmountInputValue(value);
        amountInput.focus();
        if (portfolioFundView === "withdraw") {
          schedulePortfolioWithdrawQuote(0);
        }
      }
      return;
    }

    if ((event.target as Element | null)?.closest("[data-fund-submit]")) {
      if (portfolioFundView) void submitPortfolioFund(portfolioFundView);
      return;
    }

    const portfolioRefresh = (event.target as Element | null)?.closest(
      "[data-refresh-portfolio]"
    );
    if (portfolioRefresh) {
      void loadPortfolio(true);
      return;
    }

    const item = (event.target as Element | null)?.closest<HTMLElement>(
      ".knoww-notification-item[data-market-id]"
    );
    if (!item) return;
    const url = item.dataset.marketUrl;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const marketId = item.dataset.marketId;
    if (!marketId) return;
    void focusMarket(marketId);
  });

  void setPagePanelVisibility(false);
  void refreshSnapshot();
  setInterval(() => void refreshSnapshot(), SNAPSHOT_REFRESH_INTERVAL_MS);
  setInterval(() => refreshVisiblePortfolio(), PORTFOLIO_REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshVisiblePortfolio();
  });
}

chrome.runtime.onMessage.addListener((message: { type?: unknown }) => {
  if (message?.type === TRADING_SESSION_DISCONNECTED_MESSAGE) {
    clearPortfolioSessionState();
    return false;
  }

  if (message?.type === TRADING_CREDENTIALS_UPDATED_MESSAGE) {
    portfolioLoaded = false;
    portfolioTradingError = null;
    const container = root?.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    if (container && !container.hidden) {
      void loadPortfolio(true);
    }
    return false;
  }

  return false;
});

render();
