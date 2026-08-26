import { isPriceCentsWithinDisplayCap } from "../content/market-price-filter";
import { type RuntimeResponse, sendRuntimeMessage } from "./messaging";
import { escapeHtml } from "./shared";

export type SnapshotMarket = {
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

export type NotificationSnapshot = {
  active?: SnapshotMarket[];
  seen?: SnapshotMarket[];
  trending?: SnapshotMarket[];
  platform?: string;
};

export const SNAPSHOT_REFRESH_INTERVAL_MS = 5_000;
export const SEARCH_DEBOUNCE_MS = 300;

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

export const MARKETS_STYLES = `
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-stack-content { min-height: 0 !important; }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-item {
    width: 100% !important; grid-template-columns: 40px minmax(0, 1fr) 96px !important;
    justify-items: stretch !important; text-align: left !important; border: 0 !important;
    border-bottom: 1px solid var(--kse-hairline) !important;
  }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-item:last-child,
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-item:has(+ .knoww-stack-section-header) { border-bottom: 0 !important; }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-icon {
    border-radius: 9px !important; border: 1px solid var(--kse-hairline-2) !important;
  }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-icon img { border-radius: 8px !important; }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-content { align-items: flex-start !important; text-align: left !important; }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-title,
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-meta { width: 100% !important; text-align: left !important; }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-prices { width: 96px !important; justify-self: end !important; }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-price-num {
    font-family: "KnowwMono", "SF Mono", "SFMono-Regular", "Consolas", monospace !important;
    font-size: 21px !important; font-weight: 500 !important; letter-spacing: -0.01em !important;
  }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-price-cents {
    font-family: "KnowwMono", "SF Mono", "SFMono-Regular", "Consolas", monospace !important;
    font-size: 11px !important; font-weight: 500 !important;
  }
  #knoww-notification-stack.knoww-sidepanel-stack .knoww-notification-side-label {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important;
    font-size: 10.5px !important; font-weight: 500 !important; letter-spacing: 0 !important;
    text-transform: none !important; max-width: 96px !important; margin-top: 1px !important;
  }
  .knoww-sidepanel-empty { padding: 12px 14px !important; }
  #knoww-notification-stack.knoww-sidepanel-stack.knoww-stack-minimized { height: auto !important; min-height: 0 !important; }
  #knoww-notification-stack.knoww-sidepanel-stack {
    --kse-font-mono: "KnowwMono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --kse-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --kse-font-display: "KnowwEditorial", Georgia, "Times New Roman", serif;
  }
`;

export function getSnapshotPayload(
  response: RuntimeResponse
): NotificationSnapshot {
  const payload = response.data as { data?: NotificationSnapshot } | undefined;
  return payload?.data || {};
}

export function getSearchResultsPayload(
  response: RuntimeResponse
): SnapshotMarket[] {
  const payload = response.data as { data?: SnapshotMarket[] } | undefined;
  return payload?.data || [];
}

export function formatLiveTimeLabel(now = new Date()): string {
  return `Live · ${now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function renderIcon(market: SnapshotMarket): string {
  if (market.imageUrl) {
    return `<div class="knoww-notification-icon"><img src="${escapeHtml(market.imageUrl)}" alt="" /></div>`;
  }
  return `<div class="knoww-notification-icon"><div class="knoww-notification-icon-fallback">${escapeHtml(market.source.slice(0, 1).toUpperCase())}</div></div>`;
}

function renderPrice(market: SnapshotMarket): string {
  if (!market.priceCents)
    return '<div class="knoww-notification-prices"></div>';
  return `<div class="knoww-notification-prices"><span class="knoww-notification-price-num yes">${escapeHtml(market.priceCents)}<span class="knoww-notification-price-cents">¢</span></span><span class="knoww-notification-side-label">${escapeHtml(market.priceSideLabel)}</span></div>`;
}

function renderMeta(market: SnapshotMarket): string {
  const parts = [market.category, market.volume].filter(Boolean);
  if (market.status === "seen") parts.push("Restore");
  if (parts.length === 0) return "";
  return `<div class="knoww-notification-meta">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('<span class="knoww-notification-meta-dot"></span>')}</div>`;
}

function filterDisplayableMarkets(markets: SnapshotMarket[]): SnapshotMarket[] {
  return markets.filter((market) =>
    isPriceCentsWithinDisplayCap(market.priceCents)
  );
}

export function renderMarketRows(
  markets: SnapshotMarket[] = [],
  status: "active" | "seen" | "trending"
): string {
  const displayableMarkets = filterDisplayableMarkets(markets);
  if (displayableMarkets.length === 0) {
    return '<div class="knoww-stack-empty knoww-sidepanel-empty"><span class="knoww-stack-empty-sub">No markets in this section.</span></div>';
  }
  const statusClass =
    status === "seen"
      ? "knoww-notification-unavailable"
      : "knoww-notification-active";
  const statusAttr = status === "seen" ? "scrolled-out" : status;
  return displayableMarkets
    .map(
      (market, index) => `
        <button type="button" class="knoww-notification-item knoww-source-${escapeHtml(market.source)} ${statusClass}"
          data-market-id="${escapeHtml(market.id)}" data-market-source="${escapeHtml(market.source)}"
          data-market-status="${statusAttr}" ${status === "trending" && market.url ? `data-market-url="${escapeHtml(market.url)}"` : ""}
          style="animation-delay: ${index * 50}ms">
          ${renderIcon(market)}<div class="knoww-notification-content"><div class="knoww-notification-title">${escapeHtml(market.title)}</div>${renderMeta(market)}</div>${renderPrice(market)}
        </button>`
    )
    .join("");
}

export function renderSection(
  title: string,
  count: number,
  kind: "active" | "scrolled-out" | "trending",
  rows: string
): string {
  const countLabel = count < 10 ? `0${count}` : String(count);
  return `<div class="knoww-stack-section-header"><span class="knoww-stack-section-title"><span class="knoww-stack-section-dot ${kind}" aria-hidden="true"></span><span>${title}</span></span><span class="knoww-stack-section-count">${countLabel}</span></div>${rows}`;
}

export function renderSnapshotSections(snapshot: NotificationSnapshot): string {
  const active = filterDisplayableMarkets(snapshot.active || []);
  const trending = filterDisplayableMarkets(snapshot.trending || []);
  const seen = filterDisplayableMarkets(snapshot.seen || []);
  return `${renderSection("Active now", active.length, "active", renderMarketRows(active, "active"))}${
    trending.length
      ? renderSection(
          "Trending now",
          trending.length,
          "trending",
          renderMarketRows(trending, "trending")
        )
      : ""
  }${renderSection("Seen earlier", seen.length, "scrolled-out", renderMarketRows(seen, "seen"))}`;
}

export function renderMarketsHeaderControls(): string {
  return `
    <button type="button" class="knoww-stack-popout" title="Move to floating panel" aria-label="Move markets panel to floating panel">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16"></path><path d="m11 9 3 3-3 3"></path></svg>
    </button>
    <button type="button" class="knoww-search-toggle" id="knoww-search-toggle" title="Search markets" aria-label="Search markets">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
    </button>
    <button type="button" class="knoww-stack-minimize" id="knoww-stack-minimize" title="Minimize" aria-label="Minimize" aria-expanded="true">${STACK_MINIMIZE_ICON_HTML}</button>
    <button type="button" class="knoww-stack-close" title="Close sidebar" aria-label="Close markets sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>
    </button>`;
}

export function renderMarketsSurface(): string {
  return `
    <div class="knoww-search-container" id="knoww-search-container"><div class="knoww-search-input-wrapper">
      <input type="text" class="knoww-search-input" id="knoww-search-input" placeholder="Search Polymarket..." autocomplete="off" />
      <button type="button" class="knoww-search-clear" id="knoww-search-clear" aria-label="Clear search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>
    </div><div class="knoww-search-results" id="knoww-search-results"></div></div>
    <div class="knoww-stack-content knoww-sidepanel-panel" data-sidepanel-markets><div class="knoww-stack-items" data-sidepanel-items><div class="knoww-stack-empty"><span class="knoww-stack-empty-title">Loading markets</span></div></div></div>`;
}

export function renderMarketsFooter(): string {
  return `<div class="knoww-stack-footer"><span class="knoww-stack-footer-live" data-sidepanel-live>${formatLiveTimeLabel()}</span></div>`;
}

export interface MarketsPorts {
  send(message: Record<string, unknown>): Promise<RuntimeResponse>;
  closeWindow(): void;
  open(url: string, target: string, features: string): void;
}

export interface MarketsHandle {
  handleClick(event: Event): boolean;
  refresh(): Promise<void>;
  dispose(): void;
}

export function installMarkets(
  root: HTMLElement,
  ports: MarketsPorts = {
    send: sendRuntimeMessage,
    closeWindow: () => window.close(),
    open: (...args) => void window.open(...args),
  }
): MarketsHandle {
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let currentSearchQuery = "";
  let searchGeneration = 0;

  const refresh = async (): Promise<void> => {
    const response = await ports.send({
      type: "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT",
      trendingLimit: 5,
    });
    const items = root.querySelector<HTMLElement>("[data-sidepanel-items]");
    const live = root.querySelector<HTMLElement>("[data-sidepanel-live]");
    if (!items) return;
    if (live) live.textContent = formatLiveTimeLabel();
    if (response.ok === false) {
      items.innerHTML =
        '<div class="knoww-stack-empty"><span class="knoww-stack-empty-title">No supported page connected</span><span class="knoww-stack-empty-sub">Open a page with Knoww markets and refresh this sidebar.</span></div>';
      return;
    }
    items.innerHTML = renderSnapshotSections(getSnapshotPayload(response));
  };

  const searchInput = root.querySelector<HTMLInputElement>(
    "#knoww-search-input"
  );
  const onSearchInput = (): void => {
    const results = root.querySelector<HTMLElement>("#knoww-search-results");
    const query = searchInput?.value.trim() ?? "";
    currentSearchQuery = query;
    const generation = ++searchGeneration;
    if (searchTimer) clearTimeout(searchTimer);
    if (!results) return;
    if (query.length < 2) {
      results.replaceChildren();
      return;
    }
    results.innerHTML = '<div class="knoww-search-loading">Searching...</div>';
    searchTimer = setTimeout(() => {
      void ports
        .send({ type: "KNOWW_SEARCH_NOTIFICATION_MARKETS", query })
        .then((response) => {
          if (generation !== searchGeneration || currentSearchQuery !== query)
            return;
          const found =
            response.ok === false ? [] : getSearchResultsPayload(response);
          results.innerHTML = found.length
            ? renderMarketRows(found, "trending")
            : '<div class="knoww-search-empty">No markets found</div>';
        });
    }, SEARCH_DEBOUNCE_MS);
  };
  searchInput?.addEventListener("input", onSearchInput);

  const handleClick = (event: Event): boolean => {
    const target = event.target as Element | null;
    if (target?.closest("#knoww-search-toggle")) {
      root
        .querySelector("#knoww-search-container")
        ?.classList.toggle("knoww-search-open");
      root
        .querySelector("#knoww-search-toggle")
        ?.classList.toggle("knoww-search-active");
      searchInput?.focus();
      return true;
    }
    if (target?.closest("#knoww-search-clear")) {
      if (searchTimer) clearTimeout(searchTimer);
      currentSearchQuery = "";
      searchGeneration++;
      root.querySelector("#knoww-search-results")?.replaceChildren();
      if (searchInput?.value.trim() === "") {
        root
          .querySelector("#knoww-search-container")
          ?.classList.remove("knoww-search-open");
        root
          .querySelector("#knoww-search-toggle")
          ?.classList.remove("knoww-search-active");
        return true;
      }
      if (searchInput) {
        searchInput.value = "";
        searchInput.focus();
      }
      return true;
    }
    const minimize = target?.closest<HTMLButtonElement>(
      "#knoww-stack-minimize"
    );
    if (minimize) {
      const stack = root.querySelector("#knoww-notification-stack");
      const minimized = !stack?.classList.contains("knoww-stack-minimized");
      stack?.classList.toggle("knoww-stack-minimized", minimized);
      stack?.classList.toggle("knoww-stack-expanded", !minimized);
      minimize.innerHTML = minimized
        ? STACK_EXPAND_ICON_HTML
        : STACK_MINIMIZE_ICON_HTML;
      minimize.title = minimized ? "Expand" : "Minimize";
      minimize.setAttribute("aria-label", minimized ? "Expand" : "Minimize");
      minimize.setAttribute("aria-expanded", String(!minimized));
      return true;
    }
    if (target?.closest(".knoww-stack-popout")) {
      void ports
        .send({
          type: "KNOWW_SET_NOTIFICATION_PANEL_SURFACE",
          surface: "floating",
        })
        .then(() =>
          ports.send({
            type: "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY",
            visible: true,
          })
        )
        .then(() => ports.closeWindow());
      return true;
    }
    if (target?.closest(".knoww-stack-close")) {
      void ports.send({ type: "KNOWW_CLOSE_EXTENSION_SIDEPANEL" });
      return true;
    }
    const item = target?.closest<HTMLElement>(
      ".knoww-notification-item[data-market-id]"
    );
    if (!item) return false;
    if (item.dataset.marketUrl) {
      ports.open(item.dataset.marketUrl, "_blank", "noopener,noreferrer");
    } else if (item.dataset.marketId) {
      void ports.send({
        type: "KNOWW_FOCUS_NOTIFICATION_MARKET",
        marketId: item.dataset.marketId,
      });
    }
    return true;
  };

  void ports.send({
    type: "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY",
    visible: false,
  });
  void refresh();
  refreshTimer = setInterval(
    () => void refresh(),
    SNAPSHOT_REFRESH_INTERVAL_MS
  );
  return {
    handleClick,
    refresh,
    dispose() {
      searchGeneration++;
      if (searchTimer) clearTimeout(searchTimer);
      if (refreshTimer) clearInterval(refreshTimer);
      searchInput?.removeEventListener("input", onSearchInput);
    },
  };
}
