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
