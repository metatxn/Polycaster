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

const root = document.getElementById("root");

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
      <div class="knoww-stack-content">
        <div class="knoww-stack-items" data-sidepanel-items>
          <div class="knoww-stack-empty">
            <span class="knoww-stack-empty-title">Loading markets</span>
          </div>
        </div>
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
    .querySelector<HTMLButtonElement>(".knoww-stack-close")
    ?.addEventListener("click", () => void closeSidePanel());
  root.addEventListener("click", (event) => {
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

render();
