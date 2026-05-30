import Decimal from "decimal.js";

import {
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
  outcome: string;
  size: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
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
const PORTFOLIO_HISTORY_PAGE_SIZE = 5;
const PORTFOLIO_HISTORY_FETCH_LIMIT = 25;
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

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  return atob(padded);
}

function getExtensionSessionPayloadSegment(token: string): string | null {
  const parts = token.split(".");
  if (parts.length === 2) return parts[0];
  if (parts.length >= 3) return parts[1];
  return null;
}

function decodeExtensionSessionAddress(token: string | null): string | null {
  if (!token) return null;
  const payload = getExtensionSessionPayloadSegment(token);
  if (!payload) return null;

  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as { sub?: unknown };
    return typeof claims.sub === "string" &&
      claims.sub.toLowerCase().startsWith("0x")
      ? claims.sub
      : null;
  } catch {
    return null;
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortfolioSessionToken(): Promise<string | null> {
  const deadline = Date.now() + PORTFOLIO_CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const token = await getPortfolioSessionToken();
    if (decodeExtensionSessionAddress(token)) return token;
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

  const token = await waitForPortfolioSessionToken();
  if (!token) {
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

async function getPortfolioSessionToken(): Promise<string | null> {
  const response = await sendRuntimeMessage({
    type: "KNOWW_GET_PORTFOLIO_SESSION",
  });
  const payload = response.data as { token?: unknown } | undefined;
  return typeof payload?.token === "string" ? payload.token : null;
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
  address: string
): Promise<PortfolioData> {
  const user = encodeURIComponent(address);
  const [positions, trades, details, tradingStatus, cashBalance] =
    await Promise.all([
      fetchKnowwJson<PortfolioPositionsResponse>(
        `/api/user/positions?user=${user}&limit=5&offset=0`
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
  const openOrders = tradingStatus.hasCredentials
    ? await getPortfolioOpenOrders(ownerAddress)
    : { orders: [], count: 0 };

  return {
    address,
    ownerAddress,
    hasTradingCredentials: tradingStatus.hasCredentials,
    cashBalance,
    openOrders,
    details: details || {},
    positions: positions || {},
    trades: trades || {},
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
        <button type="button" class="knoww-portfolio-open" data-open-portfolio>
          <span>Open</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"></path></svg>
        </button>
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
    .slice(0, 5)
    .map((position) => {
      const pnlClass = position.unrealizedPnl >= 0 ? "positive" : "negative";
      const url = portfolioMarketUrl(position.market);
      return `
        ${portfolioRowOpenTag(url)}
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
        ${portfolioRowCloseTag(url)}
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

function renderPortfolioContent(data: PortfolioData): string {
  return `
    ${renderPortfolioSummary(data)}
    ${renderPortfolioTradingGate(data)}
    ${renderPortfolioTable(data)}
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

function renderPortfolioWalletChoices(wallets: PortfolioWallet[] = []): string {
  if (wallets.length === 0) {
    return `
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

function clearPortfolioSessionState(): void {
  portfolioLoaded = false;
  portfolioConnectError = null;
  portfolioTradingError = null;
  portfolioHistoryPage = 0;
  latestPortfolioData = null;
  portfolioWallets = null;

  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (container && !container.hidden) {
    container.innerHTML = renderPortfolioSignedOut();
  }
}

async function loadPortfolio(force = false): Promise<void> {
  if (portfolioLoaded && !force) return;
  const container = root?.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  if (!container) return;

  container.innerHTML = `
    <div class="knoww-portfolio-loading">Loading portfolio...</div>
  `;

  const token = await getPortfolioSessionToken();
  const address = decodeExtensionSessionAddress(token);
  if (!address) {
    portfolioLoaded = false;
    if (!portfolioWallets) {
      portfolioWallets = await getPortfolioWallets();
    }
    container.innerHTML = renderPortfolioSignedOut();
    return;
  }

  try {
    const portfolioAddress = await resolvePortfolioAddress(address);
    const data = await fetchPortfolioData(address, portfolioAddress);
    portfolioLoaded = true;
    latestPortfolioData = data;
    container.innerHTML = renderPortfolioContent(data);
  } catch {
    portfolioLoaded = false;
    latestPortfolioData = null;
    container.innerHTML = `
      <div class="knoww-portfolio-signed-out">
        <span class="knoww-stack-empty-title">Portfolio unavailable</span>
        <span class="knoww-stack-empty-sub">Refresh or open Knoww to try again.</span>
        <button type="button" class="knoww-portfolio-open" data-refresh-portfolio>
          Refresh
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

  if (view === "portfolio") void loadPortfolio();
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
    ${renderSection(
      "Seen earlier",
      seen.length,
      "scrolled-out",
      renderMarketRows(seen, "seen")
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
        background: var(--kse-panel, #121212);
        overflow: hidden;
      }

      #knoww-notification-stack.knoww-sidepanel-stack {
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
        --pf-mid: rgba(255, 255, 255, 0.58);
        --pf-dim: rgba(255, 255, 255, 0.4);
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
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.2em;
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
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.18em;
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
        font-size: 9px;
        letter-spacing: 0.14em;
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
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.14em;
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
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.08em;
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
        font: 500 9px/1 var(--pf-mono);
        letter-spacing: 0.12em;
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
        font: 600 12.5px/1.3 var(--pf-sans);
      }

      .knoww-portfolio-row-meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 4px;
        color: var(--pf-dim);
        font: 500 9.5px/1.2 var(--pf-mono);
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
        font: 500 12.5px/1.1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      .knoww-portfolio-row-value span {
        color: var(--pf-mid);
        font: 500 10px/1.1 var(--pf-mono);
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
        font: 500 10px/1.5 var(--pf-mono);
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
