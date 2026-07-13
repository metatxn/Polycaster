import {
  createFundingUi,
  FUNDING_UI_STYLES,
  type FundingUiHandle,
} from "./sidepanel/funding-ui";
import {
  installMarkets,
  MARKETS_STYLES,
  renderMarketsFooter,
  renderMarketsHeaderControls,
  renderMarketsSurface,
} from "./sidepanel/markets";
import {
  installSidepanelMessageListener,
  sendRuntimeMessage,
} from "./sidepanel/messaging";
import {
  createPortfolioSidepanel,
  PORTFOLIO_STYLES,
  type PortfolioSidepanelHandle,
} from "./sidepanel/portfolio";
import { createPortfolioSetup, SETUP_STYLES } from "./sidepanel/setup";

interface SidepanelEventHandle {
  handleClick?(event: Event): boolean;
  handleChange?(event: Event): boolean;
  handleInput?(event: Event): boolean;
}

interface SidepanelRootDispatcherHandlers {
  markets: SidepanelEventHandle;
  funding: SidepanelEventHandle;
  setup: SidepanelEventHandle;
  portfolio: SidepanelEventHandle;
  onSettings(): void;
  onView(view: SidePanelView): void;
}

export function installSidepanelRootDispatchers(
  root: HTMLElement,
  handlers: SidepanelRootDispatcherHandlers
): () => void {
  const stagedHandlers = [
    handlers.markets,
    handlers.funding,
    handlers.setup,
    handlers.portfolio,
  ];
  const clickHandlers = [handlers.setup, handlers.funding];

  const onRootClick = (event: Event): void => {
    if (handlers.markets.handleClick?.(event)) return;
    if (handlers.portfolio.handleClick?.(event)) return;
    const target = event.target as Element | null;
    if (target?.closest(".knoww-stack-settings")) {
      handlers.onSettings();
      return;
    }
    const viewButton = target?.closest<HTMLElement>("[data-sidepanel-view]");
    const view = viewButton?.dataset.sidepanelView;
    if (view === "markets" || view === "portfolio") {
      handlers.onView(view);
      return;
    }
    for (const handler of clickHandlers) {
      if (handler.handleClick?.(event)) return;
    }
  };
  const onRootChange = (event: Event): void => {
    for (const handler of stagedHandlers) {
      if (handler.handleChange?.(event)) return;
    }
  };
  const onRootInput = (event: Event): void => {
    for (const handler of stagedHandlers) {
      if (handler.handleInput?.(event)) return;
    }
  };

  root.addEventListener("click", onRootClick);
  root.addEventListener("change", onRootChange);
  root.addEventListener("input", onRootInput);
  return () => {
    root.removeEventListener("click", onRootClick);
    root.removeEventListener("change", onRootChange);
    root.removeEventListener("input", onRootInput);
  };
}

import type { SidePanelView } from "./sidepanel/shared";

function renderSidepanelShell(root: HTMLElement): void {
  root.innerHTML = `
    <style>
      ${MARKETS_STYLES}
      ${PORTFOLIO_STYLES}
      ${FUNDING_UI_STYLES}
      ${SETUP_STYLES}
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
          ${renderMarketsHeaderControls()}
        </div>
      </div>
      <div class="knoww-sidepanel-tabs" role="tablist" aria-label="Side panel sections">
        <button type="button" class="knoww-sidepanel-tab is-active" data-sidepanel-view="markets" role="tab" aria-selected="true">Markets</button>
        <button type="button" class="knoww-sidepanel-tab" data-sidepanel-view="portfolio" role="tab" aria-selected="false">Portfolio</button>
      </div>
      ${renderMarketsSurface()}
      <div class="knoww-sidepanel-panel knoww-sidepanel-portfolio" data-sidepanel-portfolio hidden>
        <div class="knoww-portfolio-loading">Loading portfolio...</div>
      </div>
      ${renderMarketsFooter()}
    </div>
  `;
}

const root = document.getElementById("root");
if (root) {
  renderSidepanelShell(root);

  let portfolio!: PortfolioSidepanelHandle;
  let funding!: FundingUiHandle;
  const setup = createPortfolioSetup({
    root,
    getPortfolioData: () => portfolio.getData(),
    reloadPortfolio: () => portfolio.load(true),
    renderPortfolio: () => portfolio.renderPortfolio(),
    invalidatePortfolio: () => portfolio.invalidate(),
    resetFunding: () => funding.resetAccount(),
    openFunding: (action) => funding.open(action),
  });
  funding = createFundingUi({
    root,
    getPortfolioData: () => portfolio.getData(),
    reloadPortfolio: () => portfolio.load(true),
    renderPortfolio: () => portfolio.renderPortfolio(),
    resolvePreferredWalletMode: setup.resolvePreferredWalletMode,
    reauthSession: setup.reauthSession,
  });
  portfolio = createPortfolioSidepanel(root, { funding, setup });

  const markets = installMarkets(root);
  const disposeRootDispatchers = installSidepanelRootDispatchers(root, {
    markets,
    funding,
    setup,
    portfolio,
    onSettings() {
      void sendRuntimeMessage({ type: "KNOWW_OPEN_EXTENSION_SETTINGS" });
    },
    onView(view) {
      portfolio.showView(view);
    },
  });

  const uninstallSidepanelMessageListener = installSidepanelMessageListener({
    onSessionDisconnected: portfolio.clearSession,
    onWalletConnected: portfolio.onWalletConnected,
    onShowView: portfolio.showView,
    onCredentialsUpdated: portfolio.onCredentialsUpdated,
  });
  window.addEventListener(
    "pagehide",
    () => {
      uninstallSidepanelMessageListener();
      disposeRootDispatchers();
      markets.dispose();
      funding.dispose();
      portfolio.dispose();
    },
    { once: true }
  );
  portfolio.start();
}
