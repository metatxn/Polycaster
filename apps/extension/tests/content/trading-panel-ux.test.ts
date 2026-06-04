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

test("deposit ERC20 transfers use viem encoding helpers", () => {
  const source = readSource("src/content/trading/trading-panel.ts");

  assert.equal(/parseUnits/.test(source), true);
  assert.equal(/encodeFunctionData/.test(source), true);
  assert.equal(/erc20Abi/.test(source), true);
  assert.equal(/BigInt\(10 \*\* decimals\)/.test(source), false);
  assert.equal(/ERC20_TRANSFER_SELECTOR/.test(source), false);
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
