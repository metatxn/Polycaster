import assert from "node:assert/strict";
import test from "node:test";

declare const process: { cwd(): string };
declare function require(moduleName: string): unknown;

const { readFileSync } = require("node:fs") as {
  readFileSync(path: string, options: { encoding: "utf8" }): string;
};
const { join } = require("node:path") as {
  join(...parts: string[]): string;
};

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

test("extension declares and builds a Chrome side panel", () => {
  const manifest = JSON.parse(readSource("manifest.json")) as {
    permissions?: string[];
    side_panel?: { default_path?: string };
  };
  const webpack = readSource("webpack.config.js");
  const sidepanelHtml = readSource("sidepanel.html");

  assert.equal(manifest.permissions?.includes("sidePanel"), true);
  assert.equal(manifest.side_panel?.default_path, "sidepanel.html");
  assert.equal(/sidepanel:\s*"\.\/src\/sidepanel\.ts"/.test(webpack), true);
  assert.equal(
    /from:\s*"sidepanel\.html",\s*to:\s*"sidepanel\.html"/.test(webpack),
    true
  );
  assert.equal(/href="knoww-inline\.css"/.test(sidepanelHtml), true);
});

test("settings default to floating and expose a user-facing placement control", () => {
  const settingsSource = readSource("src/types/settings.ts");
  const optionsSource = readSource("src/options.tsx");

  assert.equal(
    /notificationPanelSurface:\s*"sidebar"\s*\|\s*"floating";/.test(
      settingsSource
    ),
    true
  );
  assert.equal(
    /notificationPanelSurface:\s*"floating"/.test(settingsSource),
    true
  );
  assert.equal(/id="notification-panel-surface"/.test(optionsSource), true);
  assert.equal(
    /value=\{settings\.notificationPanelSurface\}/.test(optionsSource),
    true
  );
});

test("notification stack can move itself into the browser side panel", () => {
  const uiSource = readSource("src/content/ui.ts");
  const backgroundSource = readSource("src/background.ts");
  const sidepanelSource = readSource("src/sidepanel.ts");

  assert.equal(
    /sidebarBtn\.className = "knoww-stack-sidebar";/.test(uiSource),
    true
  );
  assert.equal(/KNOWW_OPEN_EXTENSION_SIDEPANEL/.test(uiSource), true);
  assert.equal(/openSidePanelFromNotificationStack/.test(uiSource), true);
  assert.equal(/ensureNotificationStackLifecyclePort/.test(uiSource), true);
  assert.equal(
    /NOTIFICATION_STACK_PORT_NAME = "knoww-notification-stack"/.test(uiSource),
    true
  );
  assert.equal(
    /chrome\.runtime\.connect\(\{ name: NOTIFICATION_STACK_PORT_NAME \}\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /postMessage\(\{ type: "KNOWW_NOTIFICATION_STACK_ALIVE" \}\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /chrome\.runtime\.onConnect\.addListener/.test(backgroundSource),
    true
  );
  assert.equal(
    /port\.name !== "knoww-notification-stack"/.test(backgroundSource),
    true
  );
  assert.equal(/response\?\.ok !== true/.test(uiSource), true);
  assert.equal(/safeSendMessage/.test(uiSource), true);
  assert.equal(
    /Extension updated\. Refresh this page to reconnect Knoww\./.test(uiSource),
    true
  );
  assert.equal(/showScrollToast\(/.test(uiSource), true);
  assert.equal(/KNOWW_SET_NOTIFICATION_STACK_VISIBILITY/.test(uiSource), true);
  assert.equal(/KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT/.test(uiSource), true);
  assert.equal(
    /msg\?\.type === "KNOWW_OPEN_EXTENSION_SIDEPANEL"/.test(backgroundSource),
    true
  );
  assert.equal(
    /msg\?\.type === "KNOWW_CLOSE_EXTENSION_SIDEPANEL"/.test(backgroundSource),
    true
  );
  assert.equal(/sidePanel\.open/.test(backgroundSource), true);
  assert.equal(/sidePanel\.close/.test(backgroundSource), true);
  assert.equal(/function queryActiveTabId/.test(backgroundSource), true);
  assert.equal(
    /function resolveContentTargetTabId/.test(backgroundSource),
    true
  );
  assert.equal(
    /function forwardToResolvedContentTab/.test(backgroundSource),
    true
  );
  assert.equal(/function reinjectContentScript/.test(backgroundSource), true);
  assert.equal(/chrome\.scripting\.executeScript/.test(backgroundSource), true);
  assert.equal(/files:\s*\["content\.js"\]/.test(backgroundSource), true);
  assert.equal(/isRecoverableContentScriptError/.test(backgroundSource), true);
  assert.equal(/sendMessageToContentTab/.test(backgroundSource), true);
  assert.equal(/chrome\.tabs\.query/.test(backgroundSource), true);
  assert.equal(/chrome\.windows\.getLastFocused/.test(backgroundSource), true);
  assert.equal(/activeTabIdsByWindowId/.test(backgroundSource), true);
  assert.equal(
    /chrome\.tabs\.onActivated\.addListener/.test(backgroundSource),
    true
  );
  assert.equal(
    /chrome\.windows\.onFocusChanged\.addListener/.test(backgroundSource),
    true
  );
  assert.equal(
    /lastSidePanelWindowId = context\.windowId/.test(backgroundSource),
    true
  );
  assert.equal(/cachedNotificationPanelSurface/.test(backgroundSource), true);
  assert.equal(/setPanelBehavior/.test(backgroundSource), true);
  assert.equal(/openPanelOnActionClick/.test(backgroundSource), true);
  assert.equal(
    /chrome\.storage\.onChanged\.addListener/.test(backgroundSource),
    true
  );
  assert.equal(
    /msg\?\.type === "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT"[\s\S]*forwardToResolvedContentTab/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /msg\?\.type === "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT"[\s\S]*trendingLimit:\s*msg\.trendingLimit/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /Chrome side panel API is unavailable/.test(backgroundSource),
    true
  );
  assert.equal(
    /(notificationPanelSurface|surface|cachedNotificationPanelSurface) === "sidebar"/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /KNOWW_SET_NOTIFICATION_STACK_VISIBILITY/.test(sidepanelSource),
    true
  );
  assert.equal(
    /KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT/.test(sidepanelSource),
    true
  );
  assert.equal(/KNOWW_FOCUS_NOTIFICATION_MARKET/.test(sidepanelSource), true);
  assert.equal(/KNOWW_FOCUS_NOTIFICATION_MARKET/.test(backgroundSource), true);
  assert.equal(/KNOWW_SEARCH_NOTIFICATION_MARKETS/.test(sidepanelSource), true);
  assert.equal(
    /KNOWW_SEARCH_NOTIFICATION_MARKETS/.test(backgroundSource),
    true
  );
  assert.equal(/renderMarketRows/.test(sidepanelSource), true);
  assert.equal(/id="knoww-notification-stack"/.test(sidepanelSource), true);
  assert.equal(/knoww-notification-item/.test(sidepanelSource), true);
  assert.equal(/knoww-stack-section-header/.test(sidepanelSource), true);
  assert.equal(/Trending now/.test(sidepanelSource), true);
  assert.equal(/snapshot\.trending/.test(sidepanelSource), true);
  assert.equal(/trendingLimit:\s*5/.test(sidepanelSource), true);
  assert.equal(/data-show-page-panel/.test(sidepanelSource), false);
  assert.equal(/knoww-stack-footer-see-all/.test(sidepanelSource), false);
  assert.equal(/focusMarket\(marketId\)/.test(sidepanelSource), true);
  assert.equal(
    /classList\.toggle\("knoww-search-open"\)/.test(sidepanelSource),
    true
  );
  assert.equal(
    /classList\.toggle\("knoww-search-active"\)/.test(sidepanelSource),
    true
  );
  assert.equal(
    /classList\.remove\("knoww-search-open"\)/.test(sidepanelSource),
    true
  );
  assert.equal(
    /classList\.remove\("knoww-search-active"\)/.test(sidepanelSource),
    true
  );
  assert.equal(/input\.value\.trim\(\) === ""/.test(sidepanelSource), true);
  assert.equal(/searchMarkets\(query\)/.test(sidepanelSource), true);
  assert.equal(
    /SNAPSHOT_REFRESH_INTERVAL_MS\s*=\s*5_000/.test(sidepanelSource),
    true
  );
  assert.equal(
    /setInterval\(\(\) => void refreshSnapshot\(\)/.test(sidepanelSource),
    true
  );
  assert.equal(/knoww-search-container/.test(sidepanelSource), true);
  assert.equal(/knoww-stack-minimize/.test(sidepanelSource), true);
  assert.equal(
    /grid-template-columns:\s*40px minmax\(0,\s*1fr\) 96px/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(/text-align:\s*left !important/.test(sidepanelSource), true);
  assert.equal(
    /align-items:\s*flex-start !important/.test(sidepanelSource),
    true
  );
  assert.equal(/Sidebar mode/.test(sidepanelSource), false);
  assert.equal(/Refresh markets/.test(sidepanelSource), false);
  assert.equal(/KNOWW_CLOSE_EXTENSION_SIDEPANEL/.test(sidepanelSource), true);
});

test("side panel exposes a compact portfolio view without charts", () => {
  const sidepanelSource = readSource("src/sidepanel.ts");
  const backgroundSource = readSource("src/background.ts");
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(/data-sidepanel-view="portfolio"/.test(sidepanelSource), true);
  // Session info is fetched as derived facts ({ loggedIn, address }); the raw
  // bearer token never reaches the sidepanel (it stays in the worker).
  assert.equal(/auth:get-session-info/.test(sidepanelSource), true);
  assert.equal(/getPortfolioSessionAddress/.test(sidepanelSource), true);
  assert.equal(/waitForPortfolioSessionAddress/.test(sidepanelSource), true);
  // The sidepanel no longer decodes the session token itself.
  assert.equal(/decodeExtensionSessionAddress/.test(sidepanelSource), false);
  assert.equal(/KNOWW_GET_PORTFOLIO_WALLETS/.test(sidepanelSource), true);
  assert.equal(/KNOWW_CONNECT_PORTFOLIO_WALLET/.test(sidepanelSource), true);
  assert.equal(
    /KNOWW_GET_PORTFOLIO_TRADING_STATUS/.test(sidepanelSource),
    true
  );
  assert.equal(/KNOWW_ENABLE_PORTFOLIO_TRADING/.test(sidepanelSource), true);
  assert.equal(/data-connect-portfolio-wallet/.test(sidepanelSource), true);
  assert.equal(/data-enable-portfolio-trading/.test(sidepanelSource), true);
  assert.equal(/renderPortfolioWalletChoices/.test(sidepanelSource), true);
  assert.equal(/renderPortfolioTradingGate/.test(sidepanelSource), true);
  assert.equal(/resolvePortfolioAddress/.test(sidepanelSource), true);
  assert.equal(/trading:derive-proxy-address/.test(sidepanelSource), true);
  assert.equal(/\/api\/user\/positions/.test(sidepanelSource), true);
  assert.equal(/\/api\/user\/trades/.test(sidepanelSource), true);
  assert.equal(/\/api\/user\/details/.test(sidepanelSource), true);
  assert.equal(/trading:get-balance/.test(sidepanelSource), true);
  assert.equal(/cashBalance/.test(sidepanelSource), true);
  assert.equal(/Cash/.test(sidepanelSource), true);
  assert.equal(/KNOWW_GET_PORTFOLIO_OPEN_ORDERS/.test(sidepanelSource), true);
  assert.equal(/\/api\/markets\/by-token/.test(sidepanelSource), true);
  assert.equal(/renderPortfolioSummary/.test(sidepanelSource), true);
  assert.equal(/renderCompactPositions/.test(sidepanelSource), true);
  assert.equal(/renderCompactOpenOrders/.test(sidepanelSource), true);
  assert.equal(/renderCompactActivity/.test(sidepanelSource), true);
  assert.equal(/renderPortfolioTable/.test(sidepanelSource), true);
  assert.equal(/data-portfolio-table-tab/.test(sidepanelSource), true);
  assert.equal(/data-portfolio-table-panel/.test(sidepanelSource), true);
  assert.equal(/PORTFOLIO_HISTORY_FETCH_LIMIT/.test(sidepanelSource), true);
  assert.equal(/renderPortfolioHistoryControls/.test(sidepanelSource), true);
  assert.equal(/data-portfolio-history-prev/.test(sidepanelSource), true);
  assert.equal(/data-portfolio-history-next/.test(sidepanelSource), true);
  assert.equal(/chart|Chart|canvas/.test(sidepanelSource), false);
  assert.equal(/KNOWW_GET_PORTFOLIO_WALLETS/.test(backgroundSource), true);
  assert.equal(/KNOWW_CONNECT_PORTFOLIO_WALLET/.test(backgroundSource), true);
  assert.equal(
    /KNOWW_GET_PORTFOLIO_TRADING_STATUS/.test(backgroundSource),
    true
  );
  assert.equal(/KNOWW_ENABLE_PORTFOLIO_TRADING/.test(backgroundSource), true);
  assert.equal(/KNOWW_GET_PORTFOLIO_OPEN_ORDERS/.test(backgroundSource), true);
  assert.equal(/fetchPortfolioOpenOrders/.test(backgroundSource), true);
  assert.equal(
    /type:\s*"KNOWW_CONNECT_PORTFOLIO_WALLET"/.test(backgroundSource),
    true
  );
  assert.equal(/hasCredentials/.test(backgroundSource), true);
  assert.equal(/WalletBridge\.getDiscoveredWallets/.test(uiSource), true);
  assert.equal(/TradingService\.connectWallet/.test(uiSource), true);
  assert.equal(/walletUuid/.test(uiSource), true);
  assert.equal(/ExtensionSession\.ensureAuthorized/.test(uiSource), true);
  assert.equal(/TradingService\.deriveCredentials/.test(uiSource), true);
  assert.equal(/status:\s*"started"/.test(uiSource), true);
});

test("side panel clears portfolio state when trading disconnects", () => {
  const sidepanelSource = readSource("src/sidepanel.ts");
  const backgroundSource = readSource("src/background.ts");

  assert.equal(
    /TRADING_SESSION_DISCONNECTED_MESSAGE/.test(sidepanelSource),
    true
  );
  assert.equal(
    /chrome\.runtime\.onMessage\.addListener/.test(sidepanelSource),
    true
  );
  assert.equal(/portfolioLoaded\s*=\s*false/.test(sidepanelSource), true);
  assert.equal(/portfolioConnectError\s*=\s*null/.test(sidepanelSource), true);
  assert.equal(/portfolioWallets\s*=\s*null/.test(sidepanelSource), true);
  assert.equal(
    /chrome\.runtime\.sendMessage\(\s*\{\s*type:\s*TRADING_SESSION_DISCONNECTED_MESSAGE\s*\}/s.test(
      backgroundSource
    ),
    true
  );
});

test("trading preflight market info uses direct CLOB fetch fallback", () => {
  const source = readSource("src/background/trading-handler.ts");

  assert.equal(/fetchClobMarket/.test(source), true);
  assert.equal(
    /getClobMarketInfo\(conditionId: string\) {\s*return fetchClobMarket\(\s*conditionId,[\s\S]*useUnifiedSdk:\s*false/s.test(
      source
    ),
    true
  );
  assert.equal(/fetchUnifiedClobMarket/.test(source), false);
});

test("limit order book loading exits on fetch failure", () => {
  const backgroundSource = readSource("src/background.ts");
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const panelSource = readSource("src/content/trading/trading-panel.ts");

  assert.equal(/POLYMARKET_API/.test(backgroundSource), true);
  assert.equal(
    /fetchClobOrderBook\(tokenId,[\s\S]*host:\s*POLYMARKET_API\.CLOB\.BASE,[\s\S]*useUnifiedSdk:\s*false/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /fetchClobBuilderFeeRates\(builderCode,[\s\S]*useUnifiedSdk:\s*false/.test(
      readSource("src/background/trading-handler.ts")
    ),
    true
  );
  assert.equal(
    /orderBookError:\s*string\s*\|\s*null/.test(serviceSource),
    true
  );
  assert.equal(/orderBookError:\s*null/.test(serviceSource), true);
  assert.equal(
    /update\(\{\s*orderBook:\s*data,[^}]*orderBookError:\s*null/s.test(
      serviceSource
    ),
    true
  );
  assert.equal(
    /update\(\{\s*orderBook:\s*\{\s*bids:\s*\[\],\s*asks:\s*\[\]\s*\},\s*orderBookError/s.test(
      serviceSource
    ),
    true
  );
  assert.equal(/Order book unavailable/.test(panelSource), true);
});

test("side panel refreshes portfolio trading gate when credentials update", () => {
  const backgroundSource = readSource("src/background.ts");
  const sidepanelSource = readSource("src/sidepanel.ts");

  // The service worker persists derived CLOB credentials and broadcasts a
  // credentials-updated message (the raw creds never leave the worker).
  assert.equal(
    /TRADING_CREDENTIALS_UPDATED_MESSAGE/.test(backgroundSource),
    true
  );
  assert.equal(/storeClobCredentials/.test(backgroundSource), true);
  // The sidepanel listens for that broadcast and refreshes the portfolio gate.
  assert.equal(
    /TRADING_CREDENTIALS_UPDATED_MESSAGE/.test(sidepanelSource),
    true
  );
  assert.equal(/loadPortfolio\(true\)/.test(sidepanelSource), true);
  // Credential reads stay namespaced to the trading-creds prefix.
  assert.equal(
    /key\.startsWith\(TRADING_CREDS_STORAGE_PREFIX\)/.test(backgroundSource),
    true
  );
});

test("offscreen trading handler never accesses session storage directly", () => {
  // The trading handler runs in the offscreen document, which cannot reach the
  // TRUSTED_CONTEXTS-only session store the service worker reads. Credentials
  // must be mediated by the SW (inject on the way in, persist on derive) — if
  // the offscreen handler touches session storage directly, the derive flow
  // silently fails to persist and the portfolio "enable trading" gate hangs.
  const handlerSource = readSource("src/background/trading-handler.ts");
  assert.equal(/chrome\.storage\.session/.test(handlerSource), false);
  assert.equal(/clob-credentials-store/.test(handlerSource), false);
});
