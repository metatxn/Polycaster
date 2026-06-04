import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function readSource(path) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("deposit modal reports pUSD proxy loading separately from unsupported tokens", () => {
  const source = readSource("src/components/deposit-modal.tsx");

  assert.equal(
    /if \(isDirectPusdDeposit && !proxyAddress\) \{[\s\S]*Trading wallet is still loading/.test(
      source
    ),
    true
  );
});

test("deposit confirmation detects pUSD through the shared helper", () => {
  const source = readSource("src/components/deposit/confirmation.tsx");

  assert.equal(
    /isPusdToken\(selectedToken\.symbol, selectedToken\.address\)/.test(source),
    true
  );
  assert.equal(/selectedToken\?\.symbol === "pUSD"/.test(source), false);
});

test("withdrawal UI uses shared Polygon id and live bridge minimums", () => {
  const hookSource = readSource("src/hooks/use-withdraw.ts");
  const modalSource = readSource("src/components/withdraw-modal.tsx");

  assert.equal(/POLYGON_BRIDGE_CHAIN_ID/.test(hookSource), true);
  assert.equal(/getMinWithdrawalForToken/.test(hookSource), true);
  assert.equal(/MIN_BRIDGE_AMOUNT_USD/.test(hookSource), false);
  assert.equal(/amountNum >= 2/.test(modalSource), false);
  assert.equal(/Minimum · \$2/.test(modalSource), false);
  assert.equal(/formatCurrency\(minWithdrawUsd\)/.test(modalSource), true);
  assert.equal(/Minimum · \$\$\{minWithdrawUsd\}/.test(modalSource), false);
  assert.equal(/formatCurrency\(minBridgeAmountUsd\)/.test(hookSource), true);
  assert.equal(/\$\$\{minBridgeAmountUsd\}/.test(hookSource), false);
});
