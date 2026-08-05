import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

function readSidepanelSources(): string {
  return [
    "src/sidepanel.ts",
    "src/sidepanel/setup.ts",
    "src/sidepanel/portfolio.ts",
    "src/sidepanel/funding-ui.ts",
  ]
    .map(readSource)
    .join("\n");
}

function extractFunctionSource(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1);
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === "{") {
      opened = true;
      depth++;
    } else if (char === "}") {
      depth--;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

test("extension declares and builds a Chrome side panel", () => {
  const manifest = JSON.parse(readSource("manifest.json")) as {
    permissions?: string[];
    side_panel?: { default_path?: string };
  };
  const webpack = readSource("webpack.config.cjs");
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

test("AI-assisted matching defaults off and remains user-configurable", () => {
  const settingsSource = readSource("src/types/settings.ts");
  const optionsSource = readSource("src/options.tsx");

  assert.equal(/aiExtractionEnabled:\s*false/.test(settingsSource), true);
  assert.equal(/label="AI-Assisted Matching"/.test(optionsSource), true);
  assert.equal(
    /checked=\{settings\.aiExtractionEnabled\}/.test(optionsSource),
    true
  );
  assert.equal(
    /setSettings\(\(prev\) => \(\{ \.\.\.prev, aiExtractionEnabled: v \}\)\)/.test(
      optionsSource
    ),
    true
  );
});

test("production settings hide the Kalshi source toggle", () => {
  const optionsSource = readSource("src/options.tsx");

  assert.equal(
    /const SHOW_KALSHI_SOURCE_SETTINGS = __DEV_MODE__;/.test(optionsSource),
    true
  );
  assert.equal(
    /\{SHOW_KALSHI_SOURCE_SETTINGS && \(\s*<>\s*<Divider \/>\s*<SettingRow\s+label="Kalshi"/s.test(
      optionsSource
    ),
    true
  );
  assert.equal(/id="source-kalshi"/.test(optionsSource), true);
});

test("notification stack can move itself into the browser side panel", () => {
  const uiSource = readSource("src/content/ui/notifications.ts");
  const backgroundSource = readSource("src/background.ts");
  const sidepanelSource = readSidepanelSources();

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
    /KNOWW_SET_NOTIFICATION_STACK_VISIBILITY/.test(
      readSource("src/sidepanel/markets.ts")
    ),
    true
  );
  assert.equal(
    /KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT/.test(
      readSource("src/sidepanel/markets.ts")
    ),
    true
  );
  assert.equal(
    /KNOWW_FOCUS_NOTIFICATION_MARKET/.test(
      readSource("src/sidepanel/markets.ts")
    ),
    true
  );
  assert.equal(/KNOWW_FOCUS_NOTIFICATION_MARKET/.test(backgroundSource), true);
  assert.equal(
    /KNOWW_SEARCH_NOTIFICATION_MARKETS/.test(
      readSource("src/sidepanel/markets.ts")
    ),
    true
  );
  assert.equal(
    /KNOWW_SEARCH_NOTIFICATION_MARKETS/.test(backgroundSource),
    true
  );
  const marketsSource = readSource("src/sidepanel/markets.ts");
  assert.equal(/renderMarketRows/.test(marketsSource), true);
  assert.equal(/id="knoww-notification-stack"/.test(sidepanelSource), true);
  assert.equal(/knoww-notification-item/.test(marketsSource), true);
  assert.equal(/knoww-stack-section-header/.test(marketsSource), true);
  assert.equal(/Trending now/.test(marketsSource), true);
  assert.equal(/snapshot\.trending/.test(marketsSource), true);
  assert.equal(/trendingLimit:\s*5/.test(marketsSource), true);
  assert.equal(/data-show-page-panel/.test(sidepanelSource), false);
  assert.equal(/knoww-stack-footer-see-all/.test(sidepanelSource), false);
  assert.equal(
    /KNOWW_FOCUS_NOTIFICATION_MARKET[\s\S]*marketId:\s*item\.dataset\.marketId/.test(
      marketsSource
    ),
    true
  );
  assert.equal(
    /classList\.toggle\("knoww-search-open"\)/.test(marketsSource),
    true
  );
  assert.equal(
    /classList\.toggle\("knoww-search-active"\)/.test(marketsSource),
    true
  );
  assert.equal(
    /classList\.remove\("knoww-search-open"\)/.test(marketsSource),
    true
  );
  assert.equal(
    /classList\.remove\("knoww-search-active"\)/.test(marketsSource),
    true
  );
  assert.equal(
    /searchInput\?\.value\.trim\(\) === ""/.test(marketsSource),
    true
  );
  assert.equal(/KNOWW_SEARCH_NOTIFICATION_MARKETS/.test(marketsSource), true);
  assert.equal(
    /SNAPSHOT_REFRESH_INTERVAL_MS\s*=\s*5_000/.test(marketsSource),
    true
  );
  assert.equal(
    /setInterval\([\s\S]{0,80}\(\) => void refresh\(\)/.test(marketsSource),
    true
  );
  assert.equal(/knoww-search-container/.test(marketsSource), true);
  assert.equal(/knoww-stack-minimize/.test(marketsSource), true);
  assert.equal(
    /grid-template-columns:\s*40px minmax\(0,\s*1fr\) 96px/.test(marketsSource),
    true
  );
  assert.equal(/text-align:\s*left !important/.test(marketsSource), true);
  assert.equal(
    /align-items:\s*flex-start !important/.test(marketsSource),
    true
  );
  assert.equal(/Sidebar mode/.test(sidepanelSource), false);
  assert.equal(/Refresh markets/.test(sidepanelSource), false);
  assert.equal(/KNOWW_CLOSE_EXTENSION_SIDEPANEL/.test(marketsSource), true);
});

test("portfolio sidebar can resolve an already-connected content wallet", () => {
  const messagesSource = readSource("src/types/chrome-messages.ts");
  const tradingServiceSource = readSource(
    "src/content/trading/trading-service.ts"
  );
  const uiSource = readSource("src/content/trading/trading-glue.ts");
  const backgroundSource = readSource("src/background.ts");
  const sidepanelSource = readSidepanelSources();

  assert.equal(/TRADING_WALLET_CONNECTED_MESSAGE/.test(messagesSource), true);
  assert.equal(
    /TRADING_WALLET_CONNECTED_MESSAGE[\s\S]*chrome\.runtime\.sendMessage/.test(
      tradingServiceSource
    ),
    true
  );
  assert.equal(/KNOWW_GET_PORTFOLIO_CONNECTED_WALLET/.test(uiSource), true);
  assert.equal(
    /KNOWW_GET_PORTFOLIO_CONNECTED_WALLET[\s\S]*portfolioSigningTabId = tabId/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /function getPortfolioConnectedWalletState/.test(sidepanelSource),
    true
  );
  assert.equal(
    /getPortfolioSessionAddress[\s\S]*getPortfolioConnectedWalletState/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /TRADING_WALLET_CONNECTED_MESSAGE/.test(
      readSource("src/sidepanel/messaging.ts")
    ),
    true
  );
});

test("trading setup opens the side panel portfolio onboarding", () => {
  const uiSource = readSource("src/content/trading/trading-glue.ts");
  const backgroundSource = readSource("src/background.ts");
  const sidepanelSource = readSource("src/sidepanel/messaging.ts");

  assert.equal(/openTradingSetupSidePanel/.test(uiSource), true);
  assert.equal(/view:\s*"portfolio"/.test(uiSource), true);
  assert.equal(/SIDEPANEL_REQUESTED_VIEW_KEY/.test(backgroundSource), true);
  assert.equal(
    /KNOWW_SHOW_EXTENSION_SIDEPANEL_VIEW/.test(sidepanelSource),
    true
  );
});

test("side panel portfolio onboarding deploys the trading wallet before credentials", () => {
  const sidepanelSource = readSidepanelSources();
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const setupViewSource = readSource(
    "src/content/trading/portfolio-setup-view.ts"
  );
  const setupFlowSource = readSource("src/content/trading/setup-flow.ts");

  assert.equal(/hasDeployedTradingWallet/.test(sidepanelSource), true);
  assert.equal(/hasTradingWallet/.test(sidepanelSource), true);
  assert.equal(/deployPortfolioTradingWallet/.test(sidepanelSource), true);
  // The guided setup wizard renders both the deploy and the enable affordances.
  assert.equal(
    /data-deploy-portfolio-trading-wallet/.test(setupViewSource),
    true
  );
  assert.equal(/data-enable-portfolio-trading/.test(setupViewSource), true);
  // The shared step model gates credentials behind vault deployment: the
  // "vault" step is ordered before the "credentials" step.
  assert.equal(
    setupFlowSource.indexOf('id: "vault"') <
      setupFlowSource.indexOf('id: "credentials"'),
    true
  );
  assert.equal(
    /ctx\.state === "ready" && ctx\.hasCredentials\) return true/.test(
      serviceSource
    ),
    false
  );
  assert.equal(/hasDeployedTradingWallet\(ctx\)/.test(serviceSource), true);
});

test("background trading handler uses extension wallet mode gates", () => {
  const handlerSource = readSource("src/background/trading-handler.ts");

  assert.equal(/normalizeExtensionTradingWalletMode/.test(handlerSource), true);
  assert.equal(
    /normalizeTradingWalletMode\(msg\.walletMode\)/.test(handlerSource),
    false
  );
});

test("side panel shows trending markets before seen earlier", () => {
  const sidepanelSource = readSource("src/sidepanel/markets.ts");
  const refreshSource = extractFunctionSource(
    sidepanelSource,
    "renderSnapshotSections"
  );
  const activeIndex = refreshSource.indexOf('"Active now"');
  const trendingIndex = refreshSource.indexOf('"Trending now"');
  const seenIndex = refreshSource.indexOf('"Seen earlier"');

  assert.notEqual(activeIndex, -1);
  assert.notEqual(trendingIndex, -1);
  assert.notEqual(seenIndex, -1);
  assert.equal(activeIndex < trendingIndex, true);
  assert.equal(trendingIndex < seenIndex, true);
});

test("side panel exposes a compact portfolio view without charts", () => {
  const sidepanelSource = readSidepanelSources();
  const backgroundSource = readSource("src/background.ts");
  const uiSource = readSource("src/content/trading/trading-glue.ts");

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
  assert.equal(/renderPortfolioSetupSurface/.test(sidepanelSource), true);
  assert.equal(/resolvePortfolioWallet/.test(sidepanelSource), true);
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
    /KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE[\s\S]*resolvePortfolioSigningTabId/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /portfolioWalletConnectError\s*=\s*response\.error/.test(sidepanelSource),
    true
  );
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

test("portfolio approval forwarding reports async approval failures", () => {
  const uiSource = readSource("src/content/trading/trading-glue.ts");

  assert.equal(
    /KNOWW_APPROVE_PORTFOLIO_TRADING[\s\S]*await TradingService\.approveUsdc[\s\S]*sendResponse\(\{[\s\S]*success: true,[\s\S]*status: "approved"[\s\S]*\}\);[\s\S]*catch\(\(err\)[\s\S]*sendResponse\(\{[\s\S]*success: false/.test(
      uiSource
    ),
    true
  );
});

test("portfolio approval polling uses the shared setup approval check with backoff", () => {
  const sidepanelSource = readSidepanelSources();
  const hasApprovalSource = extractFunctionSource(
    sidepanelSource,
    "hasPortfolioApproval"
  );
  const waitSource = extractFunctionSource(
    sidepanelSource,
    "waitForPortfolioApproval"
  );

  assert.equal(/trading:get-all-allowances/.test(hasApprovalSource), true);
  assert.equal(/fetchTradingSetupApprovalStatus/.test(hasApprovalSource), true);
  assert.equal(/allowanceReadStatus/.test(hasApprovalSource), true);
  assert.equal(/Promise<boolean \| null>/.test(hasApprovalSource), true);
  assert.equal(/return null;/.test(hasApprovalSource), true);
  assert.equal(
    /deriveTradingSetupApprovalStatus/.test(hasApprovalSource),
    false
  );
  assert.equal(/isTradingSetupApprovalComplete/.test(hasApprovalSource), false);
  assert.equal(/getTradingOrderAllowance/.test(hasApprovalSource), false);
  assert.equal(/trading:get-allowance/.test(hasApprovalSource), false);
  assert.equal(/scalarApproval/.test(hasApprovalSource), false);
  // The wait rides the shared pollUntil loop (which defaults to the shared
  // backoff cadence) instead of hand-rolling a deadline/backoff loop.
  assert.equal(/pollUntil\(/.test(waitSource), true);
  assert.equal(/PORTFOLIO_CONNECT_TIMEOUT_MS/.test(waitSource), true);
  assert.equal(/PORTFOLIO_CONNECT_POLL_MS/.test(waitSource), false);
});

test("post-create deployment wait requires on-chain bytecode, not the relayer record", () => {
  const sidepanelSource = readSidepanelSources();
  const deploySource = extractFunctionSource(
    sidepanelSource,
    "deployPortfolioTradingWallet"
  );

  // The relayer's /deployed answer may be record-based and flip true before
  // code exists on-chain; the wizard must not advance to Approve on it. The
  // poll skips the relayer fallback so only a bytecode read resolves the wait.
  assert.equal(
    /waitForPortfolioTradingWalletDeployment/.test(deploySource),
    true
  );
  assert.equal(/skipRelayerDeploymentFallback: true/.test(deploySource), true);
});

test("switch-wallet failure surfaces in the loaded portfolio view", () => {
  const sidepanelSource = readSidepanelSources();
  const switchSource = extractFunctionSource(
    sidepanelSource,
    "switchPortfolioWallet"
  );

  // With a portfolio loaded, the error must render through the portfolio's
  // own error channel (the signed-out channel renders nothing here and the
  // stored message would leak into a later signed-out render).
  assert.equal(
    /portfolioTradingError = message;[\s\S]{0,160}dependencies\.reloadPortfolio\(\)/.test(
      switchSource
    ),
    true
  );
  assert.equal(
    /portfolioConnectError = message;[\s\S]{0,240}renderPortfolioSignedOut\(\)/.test(
      switchSource
    ),
    true
  );
});

test("approval wait maps an unresolvable poll address to unverified, not rejected", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(
    /\? await waitForPortfolioApproval\(proxyAddress\)\s*:\s*"unverified"/.test(
      sidepanelSource
    ),
    true
  );
});

test("connected-wallet lookup prefers the remembered wallet-session tab", () => {
  const backgroundSource = readSource("src/background.ts");

  // The wallet session lives in the tab it was connected on, not whatever tab
  // is active when the side panel asks — same routing rule as the signing
  // forwards. The active-tab fallback stays inside the resolver.
  assert.equal(
    /KNOWW_GET_PORTFOLIO_CONNECTED_WALLET"\) \{[\s\S]{0,400}?void resolvePortfolioSigningTabId\(msg, sender\)/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /KNOWW_GET_PORTFOLIO_CONNECTED_WALLET"\) \{[\s\S]{0,400}?void resolveContentTargetTabId\(/.test(
      backgroundSource
    ),
    false
  );
  // A card-side connect is the only signal telling the SW which tab holds the
  // session when the user never used a side-panel flow — latch the broadcast.
  assert.equal(
    /"trading:wallet-connected"[\s\S]{0,300}portfolioSigningTabId = sender\.tab\.id/.test(
      backgroundSource
    ),
    true
  );
});

test("live view-switch consumes the persisted requested view", () => {
  const sidepanelSource = readSource("src/sidepanel/messaging.ts");

  // The background persists the view for a boot-time consume AND notifies an
  // already-open panel; the live path must also clear the key or the leftover
  // value hijacks the next toolbar open.
  assert.equal(
    /KNOWW_SHOW_EXTENSION_SIDEPANEL_VIEW[\s\S]{0,400}sessionStorage\.remove\(\s*SIDEPANEL_REQUESTED_VIEW_KEY/.test(
      sidepanelSource
    ),
    true
  );
});

test("portfolio setup completion is not cleared when approval status is unknown", () => {
  const sidepanelSource = readSidepanelSources();
  const renderSource = extractFunctionSource(
    sidepanelSource,
    "renderPortfolioSetupSurface"
  );

  assert.equal(
    /function isPortfolioSetupCompletionUnknown/.test(sidepanelSource),
    true
  );
  assert.equal(/hasApproval: true/.test(sidepanelSource), true);
  assert.equal(/approvalReadStatus !== "degraded"/.test(sidepanelSource), true);
  assert.equal(
    /liveCompleteKnown: !isPortfolioSetupCompletionUnknown\(data\)/.test(
      renderSource
    ),
    true
  );
  assert.equal(
    /!isPortfolioSetupCompletionUnknown\(data\)/.test(sidepanelSource),
    true
  );
});

test("get-all-allowances reports degraded partial reads instead of hiding them", () => {
  const backgroundSource = readSource("src/background/trading-handler.ts");
  const getAllAllowancesSource = extractFunctionSource(
    backgroundSource,
    "handleGetAllAllowances"
  );

  assert.equal(/degraded/.test(getAllAllowancesSource), true);
  // Per-read fallbacks are acceptable ONLY because onFallback records each
  // failed key into degradedKeys — a bare fallback with no recording would
  // reintroduce round-4's silently-hidden partial reads (R4-1).
  assert.equal(/fallbackRaw:\s*0n/.test(getAllAllowancesSource), true);
  assert.equal(/fallbackApproved:\s*false/.test(getAllAllowancesSource), true);
  assert.equal(/onFallback/.test(getAllAllowancesSource), true);
  assert.equal(/degradedKeys\.push/.test(getAllAllowancesSource), true);
});

test("side panel removes unused setup rail css", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(/knoww-pf-setup-rail/.test(sidepanelSource), false);
  assert.equal(/knoww-pf-setup-node/.test(sidepanelSource), false);
  assert.equal(/knoww-pf-setup-active/.test(sidepanelSource), false);
});

test("side panel portfolio fetches a full active positions page but displays compact rows", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(
    /const PORTFOLIO_POSITIONS_FETCH_LIMIT = 50;/.test(sidepanelSource),
    true
  );
  assert.equal(
    /const PORTFOLIO_POSITIONS_DISPLAY_LIMIT = 5;/.test(sidepanelSource),
    true
  );
  assert.equal(
    /\/api\/user\/positions\?user=\$\{user\}&limit=\$\{PORTFOLIO_POSITIONS_FETCH_LIMIT\}&offset=0&active=true/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /\.slice\(0, PORTFOLIO_POSITIONS_DISPLAY_LIMIT\)/.test(sidepanelSource),
    true
  );
});

test("side panel portfolio refreshes while visible instead of keeping stale positions", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(
    /const PORTFOLIO_REFRESH_INTERVAL_MS = 30_000;/.test(sidepanelSource),
    true
  );
  assert.equal(/function refreshVisiblePortfolio/.test(sidepanelSource), true);
  assert.equal(
    /applySidepanelView\(root, view, \(\) => void loadPortfolio\(true\)\);/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /setInterval\([\s\S]{0,80}\(\) => refreshVisiblePortfolio\(\),[\s\S]{0,40}PORTFOLIO_REFRESH_INTERVAL_MS/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /const onPortfolioVisibilityChange[\s\S]{0,180}refreshVisiblePortfolio\(\);[\s\S]*document\.addEventListener\("visibilitychange", onPortfolioVisibilityChange\)/.test(
      sidepanelSource
    ),
    true
  );
});

test("side panel portfolio refresh ignores stale in-flight responses", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(/let portfolioLoadGeneration = 0;/.test(sidepanelSource), true);
  assert.equal(
    /const loadGeneration = \+\+portfolioLoadGeneration;/.test(sidepanelSource),
    true
  );
  assert.equal(
    (sidepanelSource.match(/loadGeneration !== portfolioLoadGeneration/g) ?? [])
      .length >= 4,
    true
  );
  assert.equal(
    /portfolioOwnerAddressValue = data\.ownerAddress;/.test(sidepanelSource),
    true
  );
});

test("side panel resolves wallet mode from deployed legacy Safe before portfolio actions", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(
    /resolvePreferredPortfolioWalletMode/.test(sidepanelSource),
    true
  );
  assert.equal(/resolvePreferredTradingWalletMode/.test(sidepanelSource), true);
  assert.equal(
    /trading:derive-proxy-address[\s\S]*walletMode:\s*"safe"/.test(
      sidepanelSource
    ),
    true
  );
});

test("side panel treats a failed legacy-Safe probe as unknown, not missing", () => {
  const sidepanelSource = readSidepanelSources();

  // hasPortfolioLegacySafe must return null (unknown) on probe failure...
  assert.equal(
    /async function hasPortfolioLegacySafe\([\s\S]*?Promise<boolean \| null>/.test(
      sidepanelSource
    ),
    true
  );
  // ...and an unknown probe must honor the stored mode without writing it
  // back, so one transient blip can't run a legacy-Safe user's action against
  // the empty deposit wallet or clobber their stored "safe".
  assert.equal(
    /if \(legacySafeDeployed === null\) \{[\s\S]*?return storedMode;[\s\S]*?\}/.test(
      sidepanelSource
    ),
    true
  );
});

test("side panel never clears persisted setup completion from degraded approval reads", () => {
  const sidepanelSource = readSidepanelSources();
  const clearIndex = sidepanelSource.indexOf(
    "await writeSetupComplete(data.ownerAddress, false);"
  );
  assert.notEqual(clearIndex, -1);
  const clearWindow = sidepanelSource.slice(
    Math.max(0, clearIndex - 700),
    clearIndex + 80
  );

  assert.equal(
    /isSetupCompletionUnknownFromDegradedRead/.test(sidepanelSource),
    true
  );
  // One shared trust-window predicate; the preserve decision passes counter+1
  // (the read being judged counts) so it can't drift from the post-increment
  // completion-unknown check.
  assert.equal(/isWithinDegradedSetupTrustWindow/.test(sidepanelSource), true);
  assert.equal(
    /isSetupCompletionUnknownFromDegradedRead\(\{[\s\S]*consecutiveDegradedReads: portfolioSetupConsecutiveDegradedReads/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /let portfolioSetupConsecutiveDegradedReads = 0;/.test(sidepanelSource),
    true
  );
  assert.equal(
    /function shouldPreserveDegradedApproval\(\)[\s\S]{0,200}isWithinDegradedSetupTrustWindow\([\s\S]{0,100}portfolioSetupConsecutiveDegradedReads \+ 1/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /data\.approvalReadStatus !== "degraded"[\s\S]*writeSetupComplete\(data\.ownerAddress, false\)/.test(
      clearWindow
    ),
    true
  );
});

test("side panel setup renderer returns mode metadata instead of searching html", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(
    /interface PortfolioSetupSurfaceRender \{[\s\S]*html: string;[\s\S]*mode: SetupSurfaceMode;[\s\S]*\}/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /function renderPortfolioSetupSurface\([\s\S]*data: SetupPortfolioData[\s\S]*\): PortfolioSetupSurfaceRender/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /\.includes\("data-portfolio-setup"\)/.test(sidepanelSource),
    false
  );
  assert.equal(
    /const wizardExpanded = setupSurface\.mode === "wizard";/.test(
      sidepanelSource
    ),
    true
  );
});

test("side panel position rows expose exact inline action labels", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(/portfolioExpandedPositionId/.test(sidepanelSource), true);
  assert.equal(/portfolioConfirmingSellPositionId/.test(sidepanelSource), true);
  assert.equal(/data-portfolio-position-toggle/.test(sidepanelSource), true);
  assert.equal(/data-portfolio-position-view/.test(sidepanelSource), true);
  assert.equal(/data-portfolio-position-sell/.test(sidepanelSource), true);
  assert.equal(
    /data-portfolio-position-sell-confirm/.test(sidepanelSource),
    true
  );
  assert.equal(
    /data-portfolio-position-sell-cancel/.test(sidepanelSource),
    true
  );
  assert.equal(/data-portfolio-position-close/.test(sidepanelSource), true);
  assert.equal(/>View</.test(sidepanelSource), true);
  assert.equal(/>Sell Position</.test(sidepanelSource), true);
  assert.equal(/>X</.test(sidepanelSource), true);
  assert.equal(
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1\.45fr\)\s+34px/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(/padding:\s*0 12px 11px;/.test(sidepanelSource), true);
  assert.equal(/padding:\s*0 12px 11px 55px;/.test(sidepanelSource), false);
});

test("side panel confirms and sells the full selected position through a portfolio sell message", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(
    /function requestPortfolioPositionSell/.test(sidepanelSource),
    true
  );
  assert.equal(/function sellPortfolioPosition/.test(sidepanelSource), true);
  assert.equal(/window\.confirm/.test(sidepanelSource), false);
  assert.equal(/KNOWW_SELL_PORTFOLIO_POSITION/.test(sidepanelSource), true);
  assert.equal(/tokenId:\s*position\.asset/.test(sidepanelSource), true);
  assert.equal(
    /conditionId:\s*position\.conditionId/.test(sidepanelSource),
    true
  );
  assert.equal(
    /outcomeIndex:\s*position\.outcomeIndex/.test(sidepanelSource),
    true
  );
  assert.equal(/size:\s*position\.size/.test(sidepanelSource), true);
  assert.equal(
    /requestPortfolioPositionSell\(position\.id\)/.test(sidepanelSource),
    true
  );
  assert.equal(
    /void sellPortfolioPosition\(position\)/.test(sidepanelSource),
    true
  );
});

test("background mediates side panel portfolio sells through the existing order path", () => {
  const backgroundSource = readSource("src/background.ts");

  assert.equal(/KNOWW_SELL_PORTFOLIO_POSITION/.test(backgroundSource), true);
  assert.equal(
    /resolvePortfolioSigningTabId\(msg, sender\)/.test(backgroundSource),
    true
  );
  assert.equal(
    /forwardToOffscreen\(\s*\{[\s\S]*type:\s*"trading:place-order"[\s\S]*side:\s*"SELL"[\s\S]*orderType:\s*"FAK"/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /proxyAddress:\s*msg\.proxyAddress/.test(backgroundSource),
    true
  );
  assert.equal(/price:\s*0/.test(backgroundSource), true);
});

test("extension order posts retry transient CLOB order-manager rejections", () => {
  const handlerSource = readSource("src/background/trading-handler.ts");

  assert.equal(/postClobOrderWithRetry/.test(handlerSource), true);
  assert.equal(/function postExtensionClobOrder/.test(handlerSource), true);
  assert.equal(
    handlerSource.match(
      /await postExtensionClobOrder\(client, order, orderType\)/g
    )?.length,
    2
  );
  assert.equal(/trading\.place-order\.retry/.test(handlerSource), true);
});

test("side panel replaces exhausted order-manager errors with retry guidance", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(/\\bnot ready\\b/i.test(sidepanelSource), true);
  assert.equal(
    sidepanelSource.includes(
      "Polymarket's order engine is busy. Try again in a few seconds."
    ),
    true
  );
});

test("side panel clears portfolio state when trading disconnects", () => {
  const sidepanelSource = readSidepanelSources();
  const messagingSource = readSource("src/sidepanel/messaging.ts");
  const backgroundSource = readSource("src/background.ts");

  assert.equal(
    /TRADING_SESSION_DISCONNECTED_MESSAGE/.test(messagingSource),
    true
  );
  assert.equal(/runtime\.onMessage\.addListener/.test(messagingSource), true);
  assert.equal(/portfolioLoaded\s*=\s*false/.test(sidepanelSource), true);
  assert.equal(/portfolioConnectError\s*=\s*null/.test(sidepanelSource), true);
  assert.equal(/portfolioWallets\s*=\s*null/.test(sidepanelSource), true);
  assert.equal(/prepareSignedOut/.test(sidepanelSource), true);
  assert.equal(
    /portfolioWallets\s*=\s*await getPortfolioWallets\(\)/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /chrome\.runtime\.sendMessage\(\s*\{\s*type:\s*TRADING_SESSION_DISCONNECTED_MESSAGE\s*\}/s.test(
      backgroundSource
    ),
    true
  );
});

test("side panel does not fall back to an auth session after wallet revocation", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(
    /type PortfolioConnectedWalletState/.test(sidepanelSource),
    true
  );
  assert.equal(/status: "disconnected"/.test(sidepanelSource), true);
  assert.equal(
    /async function getPortfolioConnectedWalletState/.test(sidepanelSource),
    true
  );
  assert.equal(
    /const connectedWallet = await getPortfolioConnectedWalletState\(\);[\s\S]*if \(connectedWallet\.status === "connected"\) return connectedWallet\.address;[\s\S]*if \(connectedWallet\.status === "disconnected"\) return null;/.test(
      sidepanelSource
    ),
    true
  );
});

test("portfolio side panel exposes wallet switch and forwards it to content", () => {
  const sidepanelSource = readSidepanelSources();
  const uiSource = readSource("src/content/trading/trading-glue.ts");
  const typesSource = readSource("src/types/chrome-messages.ts");

  assert.equal(/data-portfolio-switch-wallet/.test(sidepanelSource), true);
  assert.equal(/function switchPortfolioWallet\(/.test(sidepanelSource), true);
  assert.equal(/KNOWW_SWITCH_PORTFOLIO_WALLET/.test(sidepanelSource), true);
  assert.equal(/KNOWW_SWITCH_PORTFOLIO_WALLET/.test(uiSource), true);
  assert.equal(/TradingService\.switchWallet\(\)/.test(uiSource), true);
  assert.equal(/KNOWW_SWITCH_PORTFOLIO_WALLET/.test(typesSource), true);
});

test("trading preflight market info reads the fee-bearing /clob-markets endpoint", () => {
  // `/markets/{conditionId}` carries no `fd` protocol-fee block, so pointing the
  // pre-flight at it silently estimated a zero protocol fee. Only
  // `/clob-markets/{conditionId}` — what `fetchClobMarketInfo` reads — has it.
  const source = readSource("src/background/trading-handler.ts");

  assert.equal(
    /getClobMarketInfo\(conditionId: string\) {\s*return fetchClobMarketInfo\(conditionId, { host: CLOB_HOST }\);/s.test(
      source
    ),
    true
  );
  assert.equal(/fetchClobMarket\(/.test(source), false);
  assert.equal(/useUnifiedSdk:\s*false/.test(source), false);
});

test("side panel clamps portfolio fund amount inputs to six decimals", () => {
  const sidepanelSource = readSidepanelSources();

  assert.equal(
    /const PORTFOLIO_AMOUNT_DECIMALS = 6;/.test(sidepanelSource),
    true
  );
  assert.equal(
    /function normalizePortfolioAmountInput/.test(sidepanelSource),
    true
  );
  assert.equal(
    /function formatPortfolioAmountInputValue/.test(sidepanelSource),
    true
  );
  assert.equal(
    /normalizePortfolioAmountInput\(amountInput\.value\)/.test(sidepanelSource),
    true
  );
  assert.equal(
    /amount\.value = formatPortfolioAmountInputValue\(value\);/.test(
      sidepanelSource
    ),
    true
  );
});

test("limit order book loading exits on fetch failure", () => {
  const backgroundSource = readSource("src/background.ts");
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const panelSource = readSource("src/content/trading/panel/order-view.ts");

  assert.equal(/POLYMARKET_API/.test(backgroundSource), true);
  assert.equal(
    /fetchClobOrderBook\(tokenId, {\s*host: POLYMARKET_API\.CLOB\.BASE,\s*}\)/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /fetchClobBuilderFeeRates\(builderCode, {\s*host: CLOB_HOST,\s*}\)/.test(
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
  const sidepanelSource = readSidepanelSources();
  const messagingSource = readSource("src/sidepanel/messaging.ts");

  // The service worker persists derived CLOB credentials and broadcasts a
  // credentials-updated message (the raw creds never leave the worker).
  assert.equal(
    /TRADING_CREDENTIALS_UPDATED_MESSAGE/.test(backgroundSource),
    true
  );
  assert.equal(/storeClobCredentials/.test(backgroundSource), true);
  // The sidepanel listens for that broadcast and refreshes the portfolio gate.
  assert.equal(
    /TRADING_CREDENTIALS_UPDATED_MESSAGE/.test(messagingSource),
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

test("approval wait distinguishes unverified reads from a confirmed non-approval", () => {
  const sidepanelSource = readSidepanelSources();

  // A window of only degraded/null reads must not claim the approval "didn't
  // complete" (it may have landed) — that message prompts a redundant
  // re-approval.
  assert.equal(
    /sawCleanRead \? "not-approved" : "unverified"/.test(sidepanelSource),
    true
  );
  assert.equal(/Couldn't verify the approval yet/.test(sidepanelSource), true);
});
