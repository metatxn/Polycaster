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
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (character === "{") {
      opened = true;
      depth++;
    } else if (character === "}") {
      depth--;
      if (opened && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

function readInlineCss(): string {
  return readSource("src/content/knoww-inline.css");
}

test("insufficient balance primary action opens deposit flow", () => {
  const source = readSource("src/content/trading/panel/order-view.ts");

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
  const source = readSource("src/content/trading/panel/order-view.ts");
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

test("returning wallet restoration renders a loading state instead of a blank panel", () => {
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const panelSource = readSource("src/content/trading/trading-panel.ts");

  assert.equal(/\| "restoring-session"/.test(serviceSource), true);
  assert.equal(
    /update\(\{ state: "restoring-session" \}\);/.test(serviceSource),
    true
  );
  assert.equal(
    /state === "restoring-session"[\s\S]{0,160}addLoading\(panel, "Restoring trading session…"\);/.test(
      panelSource
    ),
    true
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
  const source = readSource("src/content/trading/panel/order-view.ts");

  assert.equal(/"You pay"/.test(source), true);
  assert.equal(/"You receive"/.test(source), true);
  assert.equal(/`Payout if \$\{opts\.outcomeName\}`/.test(source), true);
  assert.equal(/"Estimated Profit"/.test(source), true);
  assert.equal(/"Total Cost"/.test(source), false);
  assert.equal(/"Potential Return"/.test(source), false);
  assert.equal(/`Profit if \$\{opts\.outcomeName\}`/.test(source), false);
});

test("market buy uses amount input and derived filled shares", () => {
  const source = readSource("src/content/trading/panel/order-view.ts");

  assert.equal(/calculateBuySlippageForAmount/.test(source), true);
  assert.equal(
    /function isMarketBuyAmountOrder\(\): boolean \{[\s\S]*panelState\.orderMode === "market" && panelState\.activeSide === "buy"/.test(
      source
    ),
    true
  );
  const stateSource = readSource("src/content/trading/panel/panel-state.ts");
  assert.equal(/marketBuyAmount: 0,/.test(stateSource), true);
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
  const source = readSource("src/content/trading/panel/deposit-view.ts");

  // The funding machine (src/funding) now owns the deposit flow; the token
  // step renderer is the sole guard that keeps unsupported non-pUSD tokens
  // non-selectable while exempting direct pUSD deposits. Re-pointed from the
  // deleted `depositSelectToken` guard to the renderer's per-token check —
  // an equivalent guarantee (the direct-pUSD exemption is still computed and
  // gates selectability).
  assert.equal(
    /const isDirectPusdDeposit = isPusdToken\(tok\.symbol, tok\.address\);/.test(
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
  // The disabled tokens carry no click handler → dispatch SELECT_TOKEN only
  // for selectable (supported) tokens.
  assert.equal(
    /if \(isDisabled\) \{\s*row\.disabled = true;\s*\} else \{[\s\S]*controller\.dispatch\(\{ type: "SELECT_TOKEN", token: tok \}\)/.test(
      source
    ),
    true
  );
});

test("portfolio wallet token metadata preserves bridge support and blocks unknown-price minimum checks", () => {
  const fundsSource = readSource("src/background/portfolio-funds.ts");
  const sidepanelSource = readSidepanelSources();

  assert.equal(
    /depositSupported:\s*isPusd \|\| Boolean\(supported\)/.test(fundsSource),
    true
  );
  assert.equal(
    /getMinDepositForToken\(assets, symbol\) \|\| 2/.test(fundsSource),
    false
  );
  // The funding machine (src/funding) now owns the deposit flow. The side
  // panel renders the token list from FundingToken decimal strings (parsed for
  // the display comparisons); unknown-price tokens are made non-selectable.
  assert.equal(
    /const priceUnavailable = minUsd > 0 && usdValue <= 0;/.test(
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
  // The machine enforces the floor in TOKEN units (minAmount, derived from
  // the USD floor via the price ratio at the gateway boundary); the error
  // copy still leads with the USD figure.
  const machineSource = readSource("src/funding/machine.ts");
  assert.equal(
    /minAmountDec\.gt\(0\) && amountDec\.lt\(minAmountDec\)/.test(
      machineSource
    ),
    true
  );
  assert.equal(
    /Minimum deposit is \$\$\{token\.minUsd\}/.test(machineSource),
    true
  );
  // The USD→token-unit conversion lives in the gateways' shared protocol
  // module (both surfaces derive minAmount through it).
  const sharedGatewaySource = readSource("src/funding/gateways/shared.ts");
  assert.equal(
    /export function deriveDepositMinAmount/.test(sharedGatewaySource),
    true
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
  const gatewaySource = readSource("src/funding/gateways/sidepanel-gateway.ts");
  const backgroundSource = readSource("src/background.ts");
  const fundsSource = readSource("src/background/portfolio-funds.ts");

  // The sidepanel gateway re-quotes immediately before executing a withdraw and
  // forwards that fresh quote to the background handler.
  assert.equal(
    /type: "KNOWW_PORTFOLIO_WITHDRAW_QUOTE"[\s\S]*type: "KNOWW_PORTFOLIO_WITHDRAW"[\s\S]*\.\.\.\(quote \? \{ quote \} : \{\}\)/.test(
      gatewaySource
    ),
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
  const uiSource = readSource("src/content/trading/trading-glue.ts");
  const sidepanelSource = readSidepanelSources();
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
  // Funding errors surface through fundErrorCopy, whose default branch formats
  // the raw error via formatPortfolioTransactionError.
  assert.equal(
    /return formatPortfolioTransactionError\(error\.message\)/.test(
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
  const uiSource = readSource("src/content/trading/trading-glue.ts");

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
  const source = readSidepanelSources();

  assert.equal(
    /finally \{[\s\S]*portfolioDisconnecting = false;[\s\S]*button\.classList\.remove\("is-busy"\);[\s\S]*button\.title = "Disconnect wallet";/.test(
      source
    ),
    true
  );
});

test("deposit money path runs through the background, not the content panel", () => {
  const source = readSource("src/content/trading/trading-panel.ts");
  const gatewaySource = readSource(
    "src/funding/gateways/trading-panel-gateway.ts"
  );

  // Task 5 deletes the extension's last content-side money movement for
  // funding: the panel no longer signs or sends deposit transactions. This is
  // STRONGER than the old "uses viem encoding helpers" check — the encoding +
  // signing moved entirely to the background viem path.
  assert.equal(/WalletBridge\.sendTransaction/.test(source), false);
  assert.equal(/encodeFunctionData/.test(source), false);
  assert.equal(/erc20Abi/.test(source), false);
  assert.equal(/ERC20_TRANSFER_SELECTOR/.test(source), false);
  assert.equal(/sendViemDeposit/.test(source), false);
  // The deposit executes via the shared funding gateway's background message.
  assert.equal(/type: "KNOWW_PORTFOLIO_DEPOSIT"/.test(gatewaySource), true);
});

test("deposit opener bounds the wallet-balance load and starts the funding flow", () => {
  const source = readSource("src/content/trading/panel/deposit-view.ts");

  // The funding machine loads the wallet token list on demand
  // (SELECT_METHOD → select-token). The load is still bounded by the same
  // timeout so a hung wallet surfaces as a LOAD_FAILED (equivalent guarantee
  // to the old "leaves loading state without waiting for bridge assets": the
  // opener never blocks on a stalled balance/asset fetch).
  assert.equal(
    /const DEPOSIT_BALANCE_LOAD_TIMEOUT_MS = 8000;/.test(source),
    true
  );
  assert.equal(
    /withDepositLoadTimeout\(\s*fetchEoaBalancesViaWallet\(address\),\s*DEPOSIT_BALANCE_LOAD_TIMEOUT_MS/.test(
      source
    ),
    true
  );
  // Opening the flow dispatches START into the shared controller instead of
  // eagerly fetching balances + assets inline.
  assert.equal(
    /controller\.dispatch\(\{\s*type: "START",\s*flow: "deposit",/.test(source),
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
  const setupSource = readSource("src/content/trading/panel/setup-view.ts");
  const renderStart = source.indexOf("function render(");
  assert.notEqual(renderStart, -1);
  const renderEnd = source.length;
  const renderSource = source.slice(renderStart, renderEnd);

  assert.equal(/cardSetupFlow\(ctx\)/.test(setupSource), false);
  assert.equal(
    /const setupFlow = cardSetupFlow\(ctx\);/.test(renderSource),
    true
  );
  assert.equal(/flow: setupFlow/.test(renderSource), true);
});

test("portfolio setup view imports the shared html escaper", () => {
  const source = readSource("src/content/trading/portfolio-setup-view.ts");

  assert.equal(
    /import \{ escapeHtml \} from "\.\.\/html-escape";/.test(source),
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
  const source = readSource("src/content/trading/panel/deposit-view.ts");

  assert.equal(/amountRaw\?: string;/.test(source), true);
  assert.equal(/function balanceHexToBigInt/.test(source), true);
  assert.equal(/amountRaw: amountRaw\.toString\(\)/.test(source), true);
  assert.equal(/amountRaw: polRaw\.toString\(\)/.test(source), true);
  assert.equal(/function parseDepositAmountRaw/.test(source), true);
  // The over-balance check now takes a FundingToken (machine boundary) and
  // reads its exact raw balance; the max preset derives from the same raw
  // FundingToken.balanceRaw — an equivalent guarantee to the old
  // depositSelected.amountRaw path.
  assert.equal(/function isFundingAmountOverBalance/.test(source), true);
  assert.equal(
    /BigInt\(token\.balanceRaw\) \* BigInt\(pct\)\) \/ 100n/.test(source),
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
  const uiSource = readSource("src/content/trading/trading-glue.ts");
  const backgroundSource = readSource("src/background.ts");
  const sidepanelSource = readSidepanelSources();

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
      readSource("src/content/trading/trading-glue.ts")
    ),
    true
  );
  assert.equal(/handleExternalWalletAccountsChanged/.test(serviceSource), true);
  assert.equal(
    /const handleWalletAccountsChanged = \(accounts: string\[\]\): void => \{[\s\S]*TradingService\.handleExternalWalletAccountsChanged\(accounts\)[\s\S]*WalletBridge\.onAccountsChanged\([\s\S]*handleWalletAccountsChanged/.test(
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
    /runtimeMessage\?\.type !== TRADING_SESSION_DISCONNECTED_MESSAGE[\s\S]*if \(walletSwitchInProgress\) \{[\s\S]*return false;[\s\S]*WalletBridge\.resetAfterDisconnect/.test(
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

test("split and merge keep exact decimal strings through panel, service, and message contracts", () => {
  const positionsSource = readSource(
    "src/content/trading/panel/positions-view.ts"
  );
  const splitFormSource = extractFunctionSource(
    positionsSource,
    "renderSplitForm"
  );
  const mergeFormSource = extractFunctionSource(
    positionsSource,
    "renderMergeForm"
  );
  const serviceSource = readSource("src/content/trading/trading-service.ts");
  const messageSource = readSource("src/types/chrome-messages.ts");

  const stateSource = readSource("src/content/trading/panel/panel-state.ts");
  assert.equal(/splitMergeAmount: "",/.test(stateSource), true);
  for (const formSource of [splitFormSource, mergeFormSource]) {
    assert.equal(
      /Number\(input\.value\)|parseFloat\(input\.value\)/.test(formSource),
      false
    );
    assert.equal(
      /panelState\.splitMergeAmount = input\.value;/.test(formSource),
      true
    );
    assert.equal(
      /formatSplitMergeAmount\(canonicalAmount\)/.test(formSource),
      true
    );
  }
  assert.equal(
    /isCtfPusdAmountOverBalance\(canonicalAmount, pusdBalance\)/.test(
      splitFormSource
    ),
    true
  );
  assert.equal(
    /isCtfPusdAmountOverBalance\(canonicalAmount, maxMerge\)/.test(
      mergeFormSource
    ),
    true
  );
  assert.equal(
    /async splitPosition\([\s\S]*?amount: string,[\s\S]*?type: "trading:split-position"[\s\S]*?amount,/.test(
      serviceSource
    ),
    true
  );
  assert.equal(
    /async mergePositions\([\s\S]*?amount: string,[\s\S]*?type: "trading:merge-positions"[\s\S]*?amount,/.test(
      serviceSource
    ),
    true
  );
  assert.equal(
    /interface TradingSplitPositionMessage[\s\S]*?amount: string;/.test(
      messageSource
    ),
    true
  );
  assert.equal(
    /interface TradingMergePositionsMessage[\s\S]*?amount: string;/.test(
      messageSource
    ),
    true
  );
});

test("dismissed-but-incomplete setup renders a resume banner instead of an empty card", () => {
  const panelSource = readSource("src/content/trading/trading-panel.ts");
  const setupSource = readSource("src/content/trading/panel/setup-view.ts");

  assert.equal(
    /setupSurfaceMode === "banner"[\s\S]{0,400}addSetupBanner\(panel, ctx, setupViewUi\)/.test(
      panelSource
    ),
    true
  );
  // The banner's CTA clears the shared dismissal so the wizard can resume.
  assert.equal(
    /function addSetupBanner\([\s\S]*?writeSetupDismissed\(ctx\.address, false\)/.test(
      setupSource
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

test("deposit error copy maps raw execution codes and bridge failures to friendly copy", () => {
  const source = readSource("src/content/trading/panel/format.ts");
  const panelSource = readSource("src/content/trading/panel/deposit-view.ts");
  const copyFn = extractFunctionSource(source, "depositErrorCopy");

  // The gateway passes non-retryable execution codes through as the raw
  // message ("PENDING_RECONCILIATION" etc.) — the renderer must map them.
  assert.equal(/case "PENDING_RECONCILIATION":/.test(copyFn), true);
  assert.equal(
    copyFn.includes("This transaction may already be submitted."),
    true
  );
  assert.equal(/case "IDEMPOTENCY_FINGERPRINT_MISMATCH":/.test(copyFn), true);
  assert.equal(/case "NO_CONTENT_TAB":/.test(copyFn), true);

  // Raw chrome.runtime bridge failures (SW restart / closed tab) must map
  // to the sidepanel's "Couldn't reach your wallet" copy, not render raw.
  assert.equal(
    /isSigningBridgeUnreachable\(error\.message\)/.test(copyFn),
    true
  );
  assert.equal(copyFn.includes("Couldn't reach your wallet."), true);
  const unreachableFn = extractFunctionSource(
    source,
    "isSigningBridgeUnreachable"
  );
  for (const pattern of [
    "Receiving end does not exist",
    "Could not establish connection",
    "Extension context invalidated",
  ]) {
    assert.equal(unreachableFn.includes(pattern), true);
  }

  // Every deposit error-render site routes through the copy mapper — no
  // raw `state.error.message` display remains in the panel.
  assert.equal(
    (panelSource.match(/depositErrorCopy\(state\.error\)/g) || []).length >= 4,
    true
  );
  assert.equal(
    /el\("span", "", state\.error\.message\)/.test(panelSource),
    false
  );
});

test("account changes under an open funding flow reset the machine (never a stale command/address)", () => {
  const source = readSource("src/content/trading/panel/deposit-view.ts");
  const shellSource = readSource("src/content/trading/trading-panel.ts");

  // The sync helper compares the machine's captured flow address against the
  // live TradingService context and dispatches ACCOUNT_CHANGED on mismatch.
  const syncFn = extractFunctionSource(source, "syncDepositControllerAccount");
  assert.equal(/state\.corr\.address/.test(syncFn), true);
  assert.equal(/dispatch\(\{ type: "ACCOUNT_CHANGED" \}\)/.test(syncFn), true);
  // An open deposit view restarts for the new account (idle dead-ends: the
  // method screen's SELECT_METHOD is a no-op until START seeds the address).
  assert.equal(/type: "START",\s*flow: "deposit"/.test(syncFn), true);

  // Both TradingService state listeners run the sync: the panel shell owns
  // its listener and the inline deposit view owns its host-scoped listener.
  assert.equal(
    (source.match(/syncDepositControllerAccount\(ctx\);/g) || []).length >= 1,
    true
  );
  assert.equal(
    (shellSource.match(/syncDepositControllerAccount\(ctx\);/g) || []).length >=
      1,
    true
  );
});
