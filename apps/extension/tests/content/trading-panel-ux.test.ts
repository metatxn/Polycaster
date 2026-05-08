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
