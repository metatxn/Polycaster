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
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  const prefix = safeValue > 0 ? "+" : "";
  return `${prefix}${formatMoney(safeValue)}`;
}

function formatPercent(value: number | undefined): string {
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  const prefix = safeValue > 0 ? "+" : "";
  return `${prefix}${safeValue.toFixed(1)}%`;
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
              ...(market.icon ? { icon: market.icon } : {}),
            },
          }
        : order;
    }),
  };
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
  const pnlClass = (totalPnl || 0) >= 0 ? "positive" : "negative";

  return `
    <div class="knoww-portfolio-account">
      <div>
        <div class="knoww-portfolio-kicker">Portfolio</div>
        <div class="knoww-portfolio-address">${escapeHtml(
          details?.userName || formatAddress(data.address)
        )}</div>
      </div>
      <button type="button" class="knoww-portfolio-open" data-open-portfolio>
        Open
      </button>
    </div>
    <div class="knoww-portfolio-summary">
      <div class="knoww-portfolio-stat wide">
        <span class="knoww-portfolio-stat-label">Position value</span>
        <strong>${escapeHtml(formatMoney(summary.totalValue))}</strong>
      </div>
      <div class="knoww-portfolio-stat">
        <span class="knoww-portfolio-stat-label">P/L</span>
        <strong class="${pnlClass}">${escapeHtml(
          formatSignedMoney(totalPnl)
        )}</strong>
      </div>
      <div class="knoww-portfolio-stat">
        <span class="knoww-portfolio-stat-label">Positions</span>
        <strong>${escapeHtml(
          formatCompactNumber(summary.positionCount)
        )}</strong>
      </div>
      <div class="knoww-portfolio-stat">
        <span class="knoww-portfolio-stat-label">Volume</span>
        <strong>${escapeHtml(formatMoney(details?.volume))}</strong>
      </div>
      <div class="knoww-portfolio-stat">
        <span class="knoww-portfolio-stat-label">Cash</span>
        <strong>${escapeHtml(formatMoney(data.cashBalance))}</strong>
      </div>
    </div>
  `;
}

function renderCompactPositions(positions: PortfolioPosition[] = []): string {
  if (positions.length === 0) {
    return `
      <div class="knoww-portfolio-empty">
        <span>No active positions.</span>
      </div>
    `;
  }

  return positions
    .slice(0, 5)
    .map((position) => {
      const pnlClass = position.unrealizedPnl >= 0 ? "positive" : "negative";
      return `
        <div class="knoww-portfolio-row">
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
    return `
      <div class="knoww-portfolio-empty">
        <span>No recent activity.</span>
      </div>
    `;
  }

  const start = page * PORTFOLIO_HISTORY_PAGE_SIZE;
  return trades
    .slice(start, start + PORTFOLIO_HISTORY_PAGE_SIZE)
    .map((trade) => {
      const side = trade.side || trade.type;
      const sideClass = side === "BUY" ? "positive" : "negative";
      const priceCents = new Decimal(trade.price).mul(100).toDecimalPlaces(0);
      return `
        <div class="knoww-portfolio-row compact">
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
        </div>
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

function renderCompactOpenOrders(orders: PortfolioOpenOrder[] = []): string {
  if (orders.length === 0) {
    return `
      <div class="knoww-portfolio-empty">
        <span>No open orders.</span>
      </div>
    `;
  }

  return orders
    .slice(0, 5)
    .map((order) => {
      const sideClass = order.side === "BUY" ? "positive" : "negative";
      const title = order.market?.title || formatAddress(order.tokenId);
      const outcome = order.market?.outcome || "Outcome";
      const total = new Decimal(order.remainingSize).mul(order.price);
      const priceCents = new Decimal(order.price).mul(100).toDecimalPlaces(0);
      return `
        <div class="knoww-portfolio-row compact">
          <div class="knoww-portfolio-row-main">
            <div class="knoww-portfolio-row-title">${escapeHtml(title)}</div>
            <div class="knoww-portfolio-row-meta">${escapeHtml(
              order.side
            )} ${escapeHtml(outcome)} · ${escapeHtml(
              formatCompactNumber(order.remainingSize)
            )} open · ${escapeHtml(formatOrderExpiration(order.expiration))}</div>
          </div>
          <div class="knoww-portfolio-row-value">
            <strong>${escapeHtml(formatDecimalMoney(total))}</strong>
            <span class="${sideClass}">${escapeHtml(
              `${priceCents.toString()}¢`
            )}</span>
          </div>
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
            ? renderCompactOpenOrders(data.openOrders.orders || [])
            : `
              <div class="knoww-portfolio-empty">
                <span>Enable trading to view open orders.</span>
              </div>
            `
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
  return `
    <div class="knoww-portfolio-signed-out">
      <span class="knoww-stack-empty-title">Connect wallet</span>
      <span class="knoww-stack-empty-sub">${
        portfolioConnectError
          ? escapeHtml(portfolioConnectError)
          : "Choose a wallet installed in the active supported browser page."
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

      #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-item {
        width: 100% !important;
        grid-template-columns: 40px minmax(0, 1fr) 64px !important;
        justify-items: stretch !important;
        text-align: left !important;
        border: 0 !important;
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
        width: 64px !important;
        justify-self: end !important;
      }

      .knoww-sidepanel-empty {
        padding: 12px 14px !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack.knoww-stack-minimized {
        height: auto !important;
        min-height: 0 !important;
      }

      .knoww-sidepanel-tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        padding: 8px 10px 4px;
      }

      .knoww-sidepanel-tab {
        height: 30px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.58);
        cursor: pointer;
        font: 600 10px/1 var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .knoww-sidepanel-tab.is-active {
        border-color: rgba(255, 255, 255, 0.24);
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.92);
      }

      .knoww-sidepanel-panel[hidden],
      .knoww-sidepanel-portfolio-active .knoww-search-container {
        display: none !important;
      }

      .knoww-sidepanel-portfolio {
        height: calc(100vh - 96px);
        overflow: auto;
        padding: 10px;
      }

      .knoww-portfolio-account,
      .knoww-portfolio-summary,
      .knoww-portfolio-table,
      .knoww-portfolio-row {
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.045);
      }

      .knoww-portfolio-account {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        border-radius: 8px;
        padding: 12px;
      }

      .knoww-portfolio-kicker,
      .knoww-portfolio-stat-label,
      .knoww-portfolio-row-meta {
        color: rgba(255, 255, 255, 0.52);
        font: 600 10px/1.4 var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        text-transform: uppercase;
      }

      .knoww-portfolio-address {
        margin-top: 4px;
        color: rgba(255, 255, 255, 0.92);
        font: 600 15px/1.2 var(--kse-font-sans, system-ui, sans-serif);
      }

      .knoww-portfolio-open {
        height: 30px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.88);
        cursor: pointer;
        padding: 0 10px;
        font: 600 10px/1 var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        text-transform: uppercase;
      }

      .knoww-portfolio-open.primary {
        border-color: rgba(54, 211, 153, 0.45);
        background: rgba(54, 211, 153, 0.16);
        color: rgba(236, 253, 245, 0.96);
      }

      .knoww-portfolio-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }

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
        min-height: 42px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        padding: 7px 10px;
        text-align: left;
      }

      .knoww-portfolio-wallet:hover {
        border-color: rgba(54, 211, 153, 0.45);
        background: rgba(54, 211, 153, 0.12);
      }

      .knoww-portfolio-wallet img,
      .knoww-portfolio-wallet span {
        width: 28px;
        height: 28px;
        border-radius: 6px;
      }

      .knoww-portfolio-wallet img {
        object-fit: cover;
      }

      .knoww-portfolio-wallet span {
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.8);
        font-weight: 700;
      }

      .knoww-portfolio-wallet strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 700 12px/1.2 var(--kse-font-sans, system-ui, sans-serif);
      }

      .knoww-portfolio-trading-gate {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
        border: 1px solid rgba(54, 211, 153, 0.22);
        border-radius: 8px;
        background: rgba(54, 211, 153, 0.08);
        padding: 10px 12px;
      }

      .knoww-portfolio-trading-gate strong {
        display: block;
        color: rgba(255, 255, 255, 0.94);
        font: 700 12px/1.2 var(--kse-font-sans, system-ui, sans-serif);
      }

      .knoww-portfolio-trading-gate span {
        display: block;
        margin-top: 3px;
        color: rgba(255, 255, 255, 0.62);
        font: 500 11px/1.35 var(--kse-font-sans, system-ui, sans-serif);
      }

      .knoww-portfolio-summary {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        overflow: hidden;
        border-radius: 8px;
        margin-top: 8px;
      }

      .knoww-portfolio-stat {
        min-width: 0;
        padding: 10px;
        background: rgba(0, 0, 0, 0.16);
      }

      .knoww-portfolio-stat.wide {
        grid-column: span 2;
      }

      .knoww-portfolio-stat strong {
        display: block;
        margin-top: 4px;
        color: rgba(255, 255, 255, 0.94);
        font: 700 18px/1.15 var(--kse-font-sans, system-ui, sans-serif);
      }

      .knoww-portfolio-section {
        margin-top: 12px;
      }

      .knoww-portfolio-table {
        overflow: hidden;
        margin-top: 12px;
        border-radius: 8px;
      }

      .knoww-portfolio-table-tabs {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.12);
      }

      .knoww-portfolio-table-tab {
        display: grid;
        min-width: 0;
        gap: 4px;
        border: 0;
        border-right: 1px solid rgba(255, 255, 255, 0.08);
        background: transparent;
        color: rgba(255, 255, 255, 0.52);
        cursor: pointer;
        padding: 8px 6px;
        text-align: left;
      }

      .knoww-portfolio-table-tab:last-child {
        border-right: 0;
      }

      .knoww-portfolio-table-tab span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 700 10px/1 var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        text-transform: uppercase;
      }

      .knoww-portfolio-table-tab strong {
        color: rgba(255, 255, 255, 0.72);
        font: 700 11px/1 var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      }

      .knoww-portfolio-table-tab.is-active {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.94);
      }

      .knoww-portfolio-table-tab.is-active strong {
        color: #36d399;
      }

      .knoww-portfolio-table-panel[hidden] {
        display: none;
      }

      .knoww-portfolio-history-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 36px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        padding: 6px 8px;
      }

      .knoww-portfolio-history-controls span {
        color: rgba(255, 255, 255, 0.52);
        font: 700 10px/1 var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        text-transform: uppercase;
      }

      .knoww-portfolio-history-controls div {
        display: flex;
        gap: 6px;
      }

      .knoww-portfolio-history-button {
        display: grid;
        place-items: center;
        width: 26px;
        height: 24px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.82);
        cursor: pointer;
      }

      .knoww-portfolio-history-button:disabled {
        cursor: default;
        opacity: 0.38;
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

      .knoww-portfolio-row {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        border-radius: 8px;
        margin-top: 6px;
        padding: 9px;
      }

      .knoww-portfolio-table-panel .knoww-portfolio-row {
        border-width: 0 0 1px;
        border-radius: 0;
        margin-top: 0;
        background: transparent;
      }

      .knoww-portfolio-table-panel .knoww-portfolio-row:last-child {
        border-bottom: 0;
      }

      .knoww-portfolio-row.compact {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .knoww-portfolio-row-icon {
        width: 34px;
        height: 34px;
        overflow: hidden;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.08);
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
        color: rgba(255, 255, 255, 0.8);
        font-weight: 700;
      }

      .knoww-portfolio-row-main {
        min-width: 0;
      }

      .knoww-portfolio-row-title {
        overflow: hidden;
        color: rgba(255, 255, 255, 0.9);
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        font: 600 12px/1.25 var(--kse-font-sans, system-ui, sans-serif);
      }

      .knoww-portfolio-row-value {
        display: grid;
        gap: 3px;
        justify-items: end;
        min-width: 76px;
        text-align: right;
      }

      .knoww-portfolio-row-value strong {
        color: rgba(255, 255, 255, 0.94);
        font: 700 12px/1.2 var(--kse-font-sans, system-ui, sans-serif);
      }

      .knoww-portfolio-row-value span {
        font: 600 10px/1.2 var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      }

      .knoww-portfolio-empty,
      .knoww-portfolio-loading,
      .knoww-portfolio-signed-out {
        display: grid;
        gap: 8px;
        place-items: center;
        min-height: 150px;
        padding: 18px;
        text-align: center;
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
