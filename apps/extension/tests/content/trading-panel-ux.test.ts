import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

function readInlineCss(): string {
  return readSource("src/content/knoww-inline.css");
}

test("insufficient balance primary action opens deposit flow", () => {
  const source = readSource("src/content/trading/trading-panel.ts");

  assert.equal(
    /const missingFunds = new Decimal\(cost\)\.sub\(availableCollateral\);/.test(
      source
    ),
    true
  );
  assert.equal(
    /btn\.textContent = `Deposit \$\$\{missingFunds\.toFixed\(2\)\} more`;/.test(
      source
    ),
    true
  );
  assert.equal(/btn\.classList\.add\("deposit"\);/.test(source), true);
  assert.equal(/startDepositFlow\(address\);/.test(source), true);
  assert.equal(
    /const depBtn = el\("button", "knoww-tp-warn-deposit-btn", "Deposit"\);/.test(
      source
    ),
    false
  );
});

test("deposit CTA replaces redundant insufficient-balance warning", () => {
  const source = readSource("src/content/trading/trading-panel.ts");
  const css = readInlineCss();

  assert.equal(
    /if \(address && costDecimal\.gt\(balanceDecimal\)\) return;/.test(source),
    true
  );
  assert.equal(/btn\.classList\.add\("deposit-needed"\);/.test(source), true);
  assert.equal(
    /\.knoww-tp-submit\.deposit-needed\s*\{[^}]*rgb\(245,\s*158,\s*11\)/.test(
      css
    ),
    true
  );
});

test("trading panel keeps the deployment-check spinner even after credentials exist", () => {
  const source = readSource("src/content/trading/trading-panel.ts");

  assert.equal(
    /ctx\.isDeployed === null &&\s*ctx\.proxyAddress\s*\)/.test(source),
    true
  );
  assert.equal(
    /ctx\.isDeployed === null &&[\s\S]{0,120}!ctx\.hasCredentials/.test(source),
    false
  );
});

test("trading panel keeps spacing around dynamic summary and CTA", () => {
  const css = readInlineCss();

  assert.equal(
    /\.knoww-tp-dynamic\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*12px/s.test(
      css
    ),
    true
  );
  assert.equal(/\.knoww-tp-submit\s*\{[^}]*margin-top:\s*2px/s.test(css), true);
  assert.equal(/\.knoww-tp-terms\s*\{[^}]*margin-top:\s*2px/s.test(css), true);
});

test("order summary uses clearer decision labels", () => {
  const source = readSource("src/content/trading/trading-panel.ts");

  assert.equal(/"You pay"/.test(source), true);
  assert.equal(/"You receive"/.test(source), true);
  assert.equal(/`Payout if \$\{opts\.outcomeName\}`/.test(source), true);
  assert.equal(/"Estimated Profit"/.test(source), true);
  assert.equal(/"Total Cost"/.test(source), false);
  assert.equal(/"Potential Return"/.test(source), false);
  assert.equal(/`Profit if \$\{opts\.outcomeName\}`/.test(source), false);
});

test("market buy uses amount input and derived filled shares", () => {
  const source = readSource("src/content/trading/trading-panel.ts");

  assert.equal(/calculateBuySlippageForAmount/.test(source), true);
  assert.equal(
    /function isMarketBuyAmountOrder\(\): boolean \{[\s\S]*orderMode === "market" && activeSide === "buy"/.test(
      source
    ),
    true
  );
  assert.equal(/let marketBuyAmount = 0;/.test(source), true);
  assert.equal(/function addMarketBuyAmountSection/.test(source), true);
  assert.equal(/"knoww-tp-amount-input"/.test(source), true);
  assert.equal(/"Order amount in dollars"/.test(source), true);
  assert.equal(
    /const shares = getOrderShareSize\(opts, ctx\);/.test(source),
    true
  );
  assert.equal(/size: effectiveSize,[\s\S]*amount: cost/.test(source), true);
});

test("market buy amount controls are styled in the extension panel", () => {
  const css = readInlineCss();

  assert.equal(/\.knoww-tp-amount-input-wrap\s*\{/.test(css), true);
  assert.equal(/\.knoww-tp-amount-input\s*\{/.test(css), true);
  assert.equal(/\.knoww-tp-amount-presets\s*\{/.test(css), true);
  assert.equal(/\.knoww-tp-amount-chip\s*\{/.test(css), true);
  assert.equal(/\.knoww-tp-amount-sub\s*\{/.test(css), true);
});

test("deposit token list whitelists direct pUSD deposits", () => {
  const source = readSource("src/content/trading/trading-panel.ts");

  assert.equal(
    /token\.depositSupported === false &&\s*!isPusdToken\(token\.symbol, token\.address\)/.test(
      source
    ),
    true
  );
  assert.equal(
    /const isUnsupported =\s*tok\.depositSupported === false && !isDirectPusdDeposit;/.test(
      source
    ),
    true
  );
});

test("portfolio wallet token metadata preserves bridge support and blocks unknown-price minimum checks", () => {
  const fundsSource = readSource("src/background/portfolio-funds.ts");
  const sidepanelSource = readSource("src/sidepanel.ts");

  assert.equal(
    /depositSupported:\s*isPusd \|\| Boolean\(supported\)/.test(fundsSource),
    true
  );
  assert.equal(
    /getMinDepositForToken\(assets, symbol\) \|\| 2/.test(fundsSource),
    false
  );
  assert.equal(
    /const priceUnavailable = t\.minUsd > 0 && t\.usdValue <= 0;/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /const disabled = unsupported \|\| priceUnavailable \|\| belowMin;/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /if \(token\.minUsd > 0 && token\.usdValue <= 0\)/.test(sidepanelSource),
    true
  );
  assert.equal(
    /Token price is unavailable\. Refresh and try again\./.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(
    /token\.usdValue > 0 && amountUsd\.lt\(token\.minUsd\)/.test(
      sidepanelSource
    ),
    false
  );
});

test("portfolio withdrawal checks for a missing EVM bridge address before checksumming", () => {
  const source = readSource("src/background/portfolio-funds.ts");

  assert.equal(
    /const evmBridgeAddress = response\.address\.evm;[\s\S]*if \(!evmBridgeAddress\) \{[\s\S]*Bridge did not return an EVM deposit address/.test(
      source
    ),
    true
  );
  assert.equal(/getAddress\(response\.address\.evm\)/.test(source), false);
});

test("portfolio withdrawal execution reuses the side panel quote", () => {
  const sidepanelSource = readSource("src/sidepanel.ts");
  const backgroundSource = readSource("src/background.ts");
  const fundsSource = readSource("src/background/portfolio-funds.ts");

  assert.equal(
    /quote:\s*withdrawQuotePayload\.quote/.test(sidepanelSource),
    true
  );
  assert.equal(
    /function isPortfolioWithdrawQuoteResponse/.test(backgroundSource),
    true
  );
  assert.equal(
    /isPortfolioWithdrawQuoteResponse\(msg\.quote\)/.test(backgroundSource),
    true
  );
  assert.equal(
    /\? \(msg\.quote as QuoteResponse\)/.test(backgroundSource),
    false
  );
  assert.equal(/quote:\s*withdrawQuote/.test(backgroundSource), true);
  assert.equal(
    /const quote =\s*input\.quote \?\?[\s\S]*destination\.routeKind === "direct"[\s\S]*buildPortfolioDirectWithdrawQuote[\s\S]*await fetchQuote\(draft\.request, bridgeOptions\(\)\)/.test(
      fundsSource
    ),
    true
  );
});

test("portfolio wallet connect reports rejected wallet prompts", () => {
  const uiSource = readSource("src/content/ui.ts");
  const sidepanelSource = readSource("src/sidepanel.ts");
  const bridgeSource = readSource("src/content/trading/bridge.ts");

  assert.equal(/function formatWalletPromptError/.test(uiSource), true);
  assert.equal(
    /if \(message\?\.type === "KNOWW_CONNECT_PORTFOLIO_WALLET"\) \{[\s\S]*catch \(err\) \{[\s\S]*sendResponse\(\{\s*success: false/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /if \(message\?\.type === "KNOWW_CONNECT_PORTFOLIO_WALLET"\) \{[\s\S]*return true;[\s\S]*if \(message\?\.type === "KNOWW_PORTFOLIO_REAUTH"\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /void TradingService\.connectWallet\(message\.walletUuid\)[\s\S]{0,500}\.catch\(\(\) => \{\}\)/.test(
      uiSource
    ),
    false
  );
  assert.equal(
    /function formatPortfolioTransactionError/.test(sidepanelSource),
    true
  );
  assert.equal(
    /setPortfolioFundStatus\(\s*"error",\s*formatPortfolioTransactionError\(response\.error\)\s*\)/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(/function formatWalletSigningError/.test(bridgeSource), true);
  assert.equal(
    /error: formatWalletSigningError\(err\)/.test(bridgeSource),
    true
  );
});

test("portfolio WalletConnect QR connect returns immediately so state polling can render the QR", () => {
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(/WALLETCONNECT_WALLET_UUID/.test(uiSource), true);
  assert.equal(
    /if \(message\.walletUuid === WALLETCONNECT_WALLET_UUID\) \{[\s\S]*sendResponse\(\{\s*success: true,\s*data: \{ status: "started" \}[\s\S]*void \(async \(\) => \{[\s\S]*connectAndAuthorizePortfolioWallet\(message\.walletUuid\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /if \(message\.walletUuid === WALLETCONNECT_WALLET_UUID\) \{[\s\S]*return false;[\s\S]*\}[\s\S]*void \(async \(\) =>/.test(
      uiSource
    ),
    true
  );
});

test("portfolio disconnect clears the busy button state when logout send fails", () => {
  const source = readSource("src/sidepanel.ts");

  assert.equal(
    /finally \{[\s\S]*portfolioDisconnecting = false;[\s\S]*button\.classList\.remove\("is-busy"\);[\s\S]*button\.title = "Disconnect wallet";/.test(
      source
    ),
    true
  );
});

test("deposit ERC20 transfers use viem encoding helpers", () => {
  const source = readSource("src/content/trading/trading-panel.ts");

  assert.equal(/parseUnits/.test(source), true);
  assert.equal(/encodeFunctionData/.test(source), true);
  assert.equal(/erc20Abi/.test(source), true);
  assert.equal(/BigInt\(10 \*\* decimals\)/.test(source), false);
  assert.equal(/ERC20_TRANSFER_SELECTOR/.test(source), false);
});

test("deposit opener leaves loading state without waiting for bridge assets", () => {
  const source = readSource("src/content/trading/trading-panel.ts");

  assert.equal(
    /const DEPOSIT_BALANCE_LOAD_TIMEOUT_MS = 8000;/.test(source),
    true
  );
  assert.equal(
    /withDepositLoadTimeout\(\s*fetchEoaBalancesViaWallet\(eoaAddress\),\s*DEPOSIT_BALANCE_LOAD_TIMEOUT_MS/.test(
      source
    ),
    true
  );
  assert.equal(
    /Promise\.all\(\[loadBalances, loadAssets\]\)/.test(source),
    false
  );
  assert.equal(
    /void loadBalances\.finally\(\(\) => \{[\s\S]*depositState = "ready";[\s\S]*rerender\(\);[\s\S]*\}\);/.test(
      source
    ),
    true
  );
  assert.equal(
    /void fetchSupportedAssets\(\)[\s\S]*depositBridgeAssets = assets;[\s\S]*if \(depositState === "ready"\) rerender\(\);/.test(
      source
    ),
    true
  );
});

test("trading balance refresh checks setup approval with one allowance request", () => {
  const source = readSource("src/content/trading/trading-service.ts");
  const refreshStart = source.indexOf("async refreshBalance");
  assert.notEqual(refreshStart, -1);
  const refreshEnd = source.indexOf("// ── Order Book", refreshStart);
  assert.notEqual(refreshEnd, -1);
  const refreshSource = source.slice(refreshStart, refreshEnd);

  assert.equal(/trading:get-all-allowances/.test(refreshSource), true);
  assert.equal(/fetchTradingSetupApprovalStatus/.test(refreshSource), true);
  assert.equal(/deriveTradingSetupApprovalStatus/.test(refreshSource), false);
  assert.equal(/allowanceReadStatus/.test(refreshSource), true);
  assert.equal(/hasTradingApproval:\s*false/.test(refreshSource), false);
  assert.equal(/isTradingSetupApprovalComplete/.test(refreshSource), false);
  assert.equal(/getTradingOrderAllowance/.test(refreshSource), false);
  assert.equal(/trading:get-allowance/.test(refreshSource), false);
  assert.equal(/scalarApproval/.test(refreshSource), false);
});

test("trading card keeps first degraded approval read in a checking state", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const panelSource = readSource("src/content/trading/trading-panel.ts");

  assert.equal(/approvalReadStatus:\s*"unknown"/.test(serviceSource), true);
  assert.equal(/approvalReadStatus:\s*"degraded"/.test(serviceSource), true);
  assert.equal(
    /approvalStatus\.allowanceReadStatus === "degraded"[\s\S]*approvalReadStatus:\s*"degraded"/.test(
      serviceSource
    ),
    true
  );
  assert.equal(
    /ctx\.approvalReadStatus !== "complete"[\s\S]*Checking approvals/.test(
      panelSource
    ),
    true
  );
});

test("trading card does not let approval spinner override persisted setup completion", () => {
  const panelSource = readSource("src/content/trading/trading-panel.ts");
  const renderStart = panelSource.indexOf("function render(");
  assert.notEqual(renderStart, -1);
  const renderSource = panelSource.slice(renderStart);
  const spinnerIndex = renderSource.indexOf(
    'addLoading(panel, "Checking approvals...'
  );
  const setupGateIndex = renderSource.indexOf('setupSurfaceMode === "wizard"');

  assert.notEqual(spinnerIndex, -1);
  assert.notEqual(setupGateIndex, -1);
  assert.equal(spinnerIndex < setupGateIndex, true);
  assert.equal(
    /setupSurfaceMode !== "complete"[\s\S]*Checking approvals/.test(
      renderSource
    ),
    true
  );
});

test("trading panel computes card setup flow once and passes it into the setup view", () => {
  const source = readSource("src/content/trading/trading-panel.ts");
  const addSetupStart = source.indexOf("function addSetupFlow");
  assert.notEqual(addSetupStart, -1);
  const addSetupEnd = source.indexOf("function renderOrderForm", addSetupStart);
  assert.notEqual(addSetupEnd, -1);
  const addSetupSource = source.slice(addSetupStart, addSetupEnd);
  const renderStart = source.indexOf("function render(");
  assert.notEqual(renderStart, -1);
  const renderEnd = source.length;
  const renderSource = source.slice(renderStart, renderEnd);

  assert.equal(/cardSetupFlow\(ctx\)/.test(addSetupSource), false);
  assert.equal(
    /const setupFlow = cardSetupFlow\(ctx\);/.test(renderSource),
    true
  );
  assert.equal(/flow: setupFlow/.test(renderSource), true);
});

test("portfolio setup view imports the shared html escaper", () => {
  const source = readSource("src/content/trading/portfolio-setup-view.ts");

  assert.equal(
    /import \{ escapeHtml \} from "\.\.\/utils";/.test(source),
    true
  );
  assert.equal(/function escapeHtml/.test(source), false);
});

test("Reddit deposit panel allows vertical overflow for deposit options", () => {
  const css = readInlineCss();

  assert.equal(
    /\.knoww-platform-reddit \.knoww-trading-panel\s*\{[^}]*overflow:\s*visible\s*!important;/s.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-platform-reddit \.knoww-tp-form\s*\{[^}]*overflow:\s*visible\s*!important;/s.test(
      css
    ),
    true
  );
});

test("deposit method rows reset host page button and text metrics", () => {
  const css = readInlineCss();

  assert.equal(
    /\.knoww-tp-deposit-method-btn\s*\{[^}]*height:\s*auto\s*!important;[^}]*min-height:\s*60px\s*!important;[^}]*overflow:\s*visible\s*!important;[^}]*line-height:\s*1\.2\s*!important;/s.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-tp-deposit-method-info\s*\{[^}]*justify-content:\s*center\s*!important;[^}]*line-height:\s*1\.2\s*!important;/s.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-tp-deposit-method-name\s*\{[^}]*line-height:\s*1\.2\s*!important;/s.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-tp-deposit-method-sub\s*\{[^}]*line-height:\s*1\.25\s*!important;/s.test(
      css
    ),
    true
  );
});

test("deposit token rows reset host page button and text metrics", () => {
  const css = readInlineCss();

  assert.equal(
    /\.knoww-tp-deposit-token-row\s*\{[^}]*height:\s*auto\s*!important;[^}]*min-height:\s*50px\s*!important;[^}]*overflow:\s*visible\s*!important;[^}]*line-height:\s*1\.2\s*!important;/s.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-tp-deposit-token-info\s*\{[^}]*justify-content:\s*center\s*!important;[^}]*line-height:\s*1\.2\s*!important;/s.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-tp-deposit-token-sym\s*\{[^}]*line-height:\s*1\.2\s*!important;/s.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-tp-deposit-token-amt\s*\{[^}]*line-height:\s*1\.25\s*!important;/s.test(
      css
    ),
    true
  );
});

test("deposit amount validation and max use exact raw token balances", () => {
  const source = readSource("src/content/trading/trading-panel.ts");

  assert.equal(/amountRaw\?: string;/.test(source), true);
  assert.equal(/function balanceHexToBigInt/.test(source), true);
  assert.equal(/amountRaw: amountRaw\.toString\(\)/.test(source), true);
  assert.equal(/amountRaw: polRaw\.toString\(\)/.test(source), true);
  assert.equal(/function parseDepositAmountRaw/.test(source), true);
  assert.equal(/function isDepositAmountOverBalance/.test(source), true);
  assert.equal(
    /BigInt\(depositSelected\.amountRaw\) \* BigInt\(pct\)\) \/ 100n/.test(
      source
    ),
    true
  );
  assert.equal(/sendViemDeposit/.test(source), false);
});

test("WalletConnect metadata uses the current page origin in content scripts", () => {
  const source = readSource("src/content/trading/walletconnect-bridge.ts");

  assert.equal(/function getWalletConnectMetadataUrl/.test(source), true);
  assert.equal(/url:\s*getWalletConnectMetadataUrl\(\)/.test(source), true);
  assert.equal(/window\.location\.origin/.test(source), true);
  assert.equal(/url:\s*"https:\/\/knoww\.app"/.test(source), false);
});

test("WalletConnect QR path forces a fresh pairing session", () => {
  const bridgeSource = readSource("src/content/trading/bridge.ts");
  const walletConnectSource = readSource(
    "src/content/trading/walletconnect-bridge.ts"
  );

  assert.equal(
    /WalletConnectBridge\.connect\(\{ forceNew: true \}\)/.test(bridgeSource),
    true
  );
  assert.equal(/forceNew\?: boolean/.test(walletConnectSource), true);
  assert.equal(/disconnectExistingSession/.test(walletConnectSource), true);
  assert.equal(/if \(forceNew\)/.test(walletConnectSource), true);
});

test("WalletConnect uses direct Polygon RPC for read-only balance calls", () => {
  const source = readSource("src/content/trading/walletconnect-bridge.ts");

  assert.equal(/async function polygonRpcRequest/.test(source), true);
  assert.equal(/READ_ONLY_RPC_TIMEOUT_MS/.test(source), true);
  assert.equal(
    /async ethCall\(to: string, data: string\): Promise<string> \{[\s\S]*return polygonRpcRequest<string>\("eth_call", \[\{ to, data \}, "latest"\]\);[\s\S]*\}/.test(
      source
    ),
    true
  );
  assert.equal(
    /async getBalance\(address: string\): Promise<string> \{[\s\S]*return polygonRpcRequest<string>\("eth_getBalance", \[address, "latest"\]\);[\s\S]*\}/.test(
      source
    ),
    true
  );
  assert.equal(
    /return polygonRpcRequest<\{ status: string; blockNumber: string \} \| null>\(\s*"eth_getTransactionReceipt"/.test(
      source
    ),
    true
  );
});

test("WalletConnect re-entrant connect aborts the stale pairing instead of reusing it", () => {
  const walletConnectSource = readSource(
    "src/content/trading/walletconnect-bridge.ts"
  );

  // A non-forced caller still joins the in-flight attempt…
  assert.equal(
    /if \(!forceNew\) return shared\.connectPromise;/.test(walletConnectSource),
    true
  );
  // …but a forced re-entry tears the pending attempt down first.
  assert.equal(/await abortPendingConnect\(\)/.test(walletConnectSource), true);
  assert.equal(/abortPairingAttempt\(\)/.test(walletConnectSource), true);
  assert.equal(/cleanupPendingPairings\(\)/.test(walletConnectSource), true);
  // Generation guard so a superseded attempt can't clobber the newer one.
  assert.equal(
    /shared\.connectGeneration === generation/.test(walletConnectSource),
    true
  );
});

test("dismissing the WalletConnect QR cancels the in-flight pairing end to end", () => {
  const walletConnectSource = readSource(
    "src/content/trading/walletconnect-bridge.ts"
  );
  const bridgeSource = readSource("src/content/trading/bridge.ts");
  const uiSource = readSource("src/content/ui.ts");
  const backgroundSource = readSource("src/background.ts");
  const sidepanelSource = readSource("src/sidepanel.ts");

  assert.equal(
    /async cancel\(\): Promise<void>/.test(walletConnectSource),
    true
  );
  assert.equal(
    /async cancelMobileConnect\(\): Promise<void>/.test(bridgeSource),
    true
  );
  assert.equal(/KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT/.test(uiSource), true);
  assert.equal(
    /KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT/.test(backgroundSource),
    true
  );
  assert.equal(
    /KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT/.test(sidepanelSource),
    true
  );
});

test("session disconnect resets the wallet bridge before rendering choices", () => {
  const bridgeSource = readSource("src/content/trading/bridge.ts");
  const serviceSource = readSource("src/content/trading/trading-service.ts");

  assert.equal(/resetAfterDisconnect/.test(bridgeSource), true);
  assert.equal(/selectedWalletUuid\s*=\s*undefined/.test(bridgeSource), true);
  assert.equal(/WalletConnectBridge\.disconnect\(\)/.test(bridgeSource), true);
  assert.equal(/KNOWW_LIST_WALLETS/.test(bridgeSource), true);
  assert.equal(
    /TRADING_SESSION_DISCONNECTED_MESSAGE[\s\S]*WalletBridge\.resetAfterDisconnect\(\)/.test(
      serviceSource
    ),
    true
  );
});

test("external wallet account revocation clears the cached trading session", () => {
  const pageBridgeSource = readSource("src/page-bridge.ts");
  const bridgeSource = readSource("src/content/trading/bridge.ts");
  const serviceSource = readSource("src/content/trading/trading-service.ts");

  assert.equal(/KNOWW_WALLET_ACCOUNTS_CHANGED/.test(pageBridgeSource), true);
  assert.equal(/accountsChanged/.test(pageBridgeSource), true);
  assert.equal(/subscribeToProviderEvents/.test(pageBridgeSource), true);
  assert.equal(/onAccountsChanged/.test(bridgeSource), true);
  assert.equal(
    /message\?\.type === "KNOWW_GET_PORTFOLIO_CONNECTED_WALLET"[\s\S]*await TradingService\.getConnectedWalletAddress\(\)/.test(
      readSource("src/content/ui.ts")
    ),
    true
  );
  assert.equal(/handleExternalWalletAccountsChanged/.test(serviceSource), true);
  assert.equal(
    /WalletBridge\.onAccountsChanged\(\(accounts\) => \{[\s\S]*TradingService\.handleExternalWalletAccountsChanged\(accounts\)/.test(
      serviceSource
    ),
    true
  );
  assert.equal(
    /sendMsg<null>\(\{ type: "auth:logout" \}/.test(serviceSource),
    true
  );
});

test("setup approval failures surface as an error state", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");

  assert.equal(
    /async approveUsdc[\s\S]*catch \(err\) \{[\s\S]*update\(\{[\s\S]*state: "error"[\s\S]*error: err instanceof Error \? err\.message : String\(err\),[\s\S]*\}\);/.test(
      serviceSource
    ),
    true
  );
});

test("installed wallet buttons reset Reddit host button and image styles", () => {
  const css = readInlineCss();

  assert.equal(
    /\.knoww-tp-wallet-item\s*\{[^}]*height:\s*auto\s*!important;[^}]*min-height:\s*46px\s*!important;[^}]*box-sizing:\s*border-box\s*!important;/s.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-tp-wallet-item-icon\s*\{[^}]*display:\s*block\s*!important;[^}]*margin:\s*0\s*!important;/s.test(
      css
    ),
    true
  );
});

test("extension wallet switch requests account permissions and reuses connection state", () => {
  const pageBridgeSource = readSource("src/page-bridge.ts");
  const bridgeSource = readSource("src/content/trading/bridge.ts");
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const panelSource = readSource("src/content/trading/trading-panel.ts");

  assert.equal(/"wallet_requestPermissions"/.test(pageBridgeSource), true);
  assert.equal(
    /USER_MEDIATED_WALLET_METHODS[\s\S]*"wallet_requestPermissions"/.test(
      bridgeSource
    ),
    true
  );
  assert.equal(/async switchWallet\(/.test(bridgeSource), true);
  assert.equal(
    /request\(\s*"wallet_requestPermissions",\s*\[\{ eth_accounts: \{\} \}\]/.test(
      bridgeSource
    ),
    true
  );
  assert.equal(/async switchWallet\(/.test(serviceSource), true);
  assert.equal(/WalletBridge\.switchWallet/.test(serviceSource), true);
  assert.equal(/type: "auth:logout"/.test(serviceSource), true);
  assert.equal(/title = "Switch wallet"/.test(panelSource), true);
  assert.equal(/TradingService\.switchWallet\(\)/.test(panelSource), true);
});

test("extension wallet switch uses shared EIP-1193 unsupported-method classifier", () => {
  const bridgeSource = readSource("src/content/trading/bridge.ts");

  assert.match(bridgeSource, /@knoww\/shared-types\/trading-errors/);
  assert.match(bridgeSource, /isEip1193UnsupportedMethodError/);
  assert.doesNotMatch(
    bridgeSource,
    /function isUnsupportedWalletPermissionError/
  );
});

test("intentional wallet switch ignores intermediate accountsChanged events", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");

  assert.equal(/let walletSwitchInProgress = false;/.test(serviceSource), true);
  // Mid-switch events are buffered (not dropped) so a failed switch can't
  // strand ctx on an account the provider has already moved past.
  assert.equal(
    /async handleExternalWalletAccountsChanged\(accounts: string\[\]\): Promise<void> \{\s*if \(walletSwitchInProgress\) \{\s*pendingAccountsChangedDuringSwitch = accounts;\s*return;/.test(
      serviceSource
    ),
    true
  );
  assert.equal(
    /async switchWallet\(walletUuid\?: string\): Promise<void> \{[\s\S]*walletSwitchInProgress = true;[\s\S]*finally \{[\s\S]*walletSwitchInProgress = false;/.test(
      serviceSource
    ),
    true
  );
  assert.equal(
    /message\?\.type !== TRADING_SESSION_DISCONNECTED_MESSAGE[\s\S]*if \(walletSwitchInProgress\) \{[\s\S]*return false;[\s\S]*WalletBridge\.resetAfterDisconnect/.test(
      serviceSource
    ),
    true
  );
});

test("accountsChanged buffered during a wallet switch is replayed after it settles", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");

  assert.equal(
    /let pendingAccountsChangedDuringSwitch: string\[\] \| null = null;/.test(
      serviceSource
    ),
    true
  );
  // switchWallet's finally clears the flag, then replays the buffered event
  // so the failure path reconciles ctx with the provider's actual account.
  assert.equal(
    /walletSwitchInProgress = false;\s*const buffered = pendingAccountsChangedDuringSwitch;\s*pendingAccountsChangedDuringSwitch = null;\s*if \(buffered\) \{\s*void this\.handleExternalWalletAccountsChanged\(buffered\);/.test(
      serviceSource
    ),
    true
  );
});

test("wallet deployment state never hard-defaults to false from a bytecode-only read", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const proxySource = readSource("src/content/trading/proxy-wallet.ts");

  // The derive handler owns deployment truth (bytecode + relayer /deployed
  // fallback); resolve paths must consult it instead of defaulting a missing
  // balance-read answer to `false` — that sent already-deployed users back to
  // "Create trading vault" after a wallet switch.
  assert.equal(/async resolveDeployment\(/.test(proxySource), true);
  assert.equal(/balData\.isDeployed \?\? false/.test(serviceSource), false);
  assert.equal(
    /derived\.isDeployed \?\? balData\.isDeployed \?\? null/.test(
      serviceSource
    ),
    true
  );
  // Legacy-safe detection decides via the relayer-backed derive answer too —
  // a transient bytecode failure must not read as "no legacy safe".
  assert.equal(
    /resolveExistingSafeWallet[\s\S]{0,500}resolveDeployment\(address, "safe"\)/.test(
      serviceSource
    ),
    true
  );
  // refreshBalance: deployment is monotonic on-chain and ctx resets on
  // account switch — a known-deployed wallet never downgrades on a refresh.
  assert.equal(
    /ctx\.isDeployed === true\s*\?\s*true\s*:\s*\(balData\.isDeployed \?\? ctx\.isDeployed\)/.test(
      serviceSource
    ),
    true
  );
});

test("stalled wallet resolution times out to a retryable error, not an endless spinner", () => {
  const panelSource = readSource("src/content/trading/trading-panel.ts");

  assert.equal(
    /const WALLET_RESOLVE_SPINNER_TIMEOUT_MS = 15_000;/.test(panelSource),
    true
  );
  // The isDeployed===null spinner branch tracks how long it has been shown
  // and flips to an inline error with a Retry action past the deadline.
  assert.equal(/walletResolveLoadingSince/.test(panelSource), true);
  assert.equal(
    /addWalletResolveTimeoutError\(panel\);/.test(panelSource),
    true
  );
  assert.equal(/resetWalletResolveSpinnerTimeout\(\);/.test(panelSource), true);
  // The branch schedules its own deadline re-render — recovery must not
  // depend on an unrelated ctx update arriving.
  assert.equal(
    /walletResolveTimeoutTimer = setTimeout\(/.test(panelSource),
    true
  );
});

test("connected wallet mode starts from shared resolver before Safe probe", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");

  assert.equal(
    /const initialWalletMode = resolvePreferredTradingWalletMode\(\{[\s\S]*storedMode: storedWalletMode,[\s\S]*legacySafeDeployed: false,[\s\S]*\}\);/.test(
      serviceSource
    ),
    true
  );
  assert.equal(
    /legacySafeAvailable: false,[\s\S]*walletMode: initialWalletMode,/.test(
      serviceSource
    ),
    true
  );
});

test("wallet lock or provider disconnect keeps the trading session", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");

  // An empty eth_accounts list (locked wallet / EIP-1193 disconnect) must not
  // tear down the session — only a non-empty list excluding ctx.address may.
  assert.equal(
    /async handleExternalWalletAccountsChanged\(accounts: string\[\]\): Promise<void> \{[\s\S]*?if \(accounts\.length === 0\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?accountListIncludesAddress/.test(
      serviceSource
    ),
    true
  );
});

test("error state keeps the order form for fully-onboarded users", () => {
  const panelSource = readSource("src/content/trading/trading-panel.ts");

  // A rejected order-time approval sets state "error"; with setup complete the
  // render dispatch must still reach the form branch instead of blanking.
  assert.equal(
    /state === "error" && setupSurfaceMode === "complete"/.test(panelSource),
    true
  );
});

test("failed vault deploy surfaces an error instead of silently resetting", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const start = serviceSource.indexOf("async deployWallet()");
  const end = serviceSource.indexOf("async approveUsdc(");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const deployWalletSource = serviceSource.slice(start, end);

  // The catch must set state "error" (the wizard's inline error and the error
  // toast only render for that state) — "ready" would claim a deployed vault
  // and re-render the pristine wizard with zero feedback.
  assert.equal(
    /catch \(err\) \{[\s\S]*?state: "error"/.test(deployWalletSource),
    true
  );
  assert.equal(
    /catch \(err\) \{[\s\S]*?state: "ready"/.test(deployWalletSource),
    false
  );
});

test("wizard approval in flight renders a loading state, not a clickable Approve", () => {
  const panelSource = readSource("src/content/trading/trading-panel.ts");

  assert.equal(
    /state === "approving" && setupSurfaceMode !== "complete"/.test(
      panelSource
    ),
    true
  );
});

test("approveUsdc guards re-entry and refreshes the allowance before flipping to ready", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const start = serviceSource.indexOf("async approveUsdc(");
  const end = serviceSource.indexOf("async splitPosition(");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const approveUsdcSource = serviceSource.slice(start, end);

  // In-flight guard: a second click mid-signature must not start a second
  // relayer approve flow.
  assert.equal(
    /if \(ctx\.state === "approving"\)/.test(approveUsdcSource),
    true
  );
  // The stale pre-approval allowance re-renders a clickable Approve if state
  // flips to "ready" before the refreshed allowance lands.
  const refreshIdx = approveUsdcSource.indexOf("await this.refreshBalance()");
  const readyIdx = approveUsdcSource.indexOf('update({ state: "ready" })');
  assert.notEqual(refreshIdx, -1);
  assert.notEqual(readyIdx, -1);
  assert.equal(refreshIdx < readyIdx, true);
});

test("dismissed-but-incomplete setup renders a resume banner instead of an empty card", () => {
  const panelSource = readSource("src/content/trading/trading-panel.ts");

  assert.equal(
    /setupSurfaceMode === "banner"[\s\S]{0,400}addSetupBanner\(panel, ctx\)/.test(
      panelSource
    ),
    true
  );
  // The banner's CTA clears the shared dismissal so the wizard can resume.
  assert.equal(
    /function addSetupBanner\([\s\S]*?writeSetupDismissed\(ctx\.address, false\)/.test(
      panelSource
    ),
    true
  );
});

test("sidepanel approve/enable signing messages route to the wallet-session tab", () => {
  const bgSource = readSource("src/background.ts");

  // Wallet-signing messages must reach the tab holding the wallet session
  // (portfolioSigningTabId), not whatever tab happens to be active.
  assert.equal(
    /KNOWW_ENABLE_PORTFOLIO_TRADING"[\s\S]{0,200}forwardToPortfolioSigningTab\(/.test(
      bgSource
    ),
    true
  );
  assert.equal(
    /KNOWW_APPROVE_PORTFOLIO_TRADING"[\s\S]{0,400}forwardToPortfolioSigningTab\(/.test(
      bgSource
    ),
    true
  );
});

test("credential/order gates re-read a stale isDeployed=false before bouncing to setup", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");

  // Deployment completed in the side panel is never broadcast to content
  // tabs, so a cached `false` must be re-read (not just `null`) before the
  // deployment-required gate fires.
  const gates = serviceSource.match(
    /if \(!ctx\.proxyAddress \|\| ctx\.isDeployed !== true\)/g
  );
  assert.equal((gates || []).length >= 2, true);
});
