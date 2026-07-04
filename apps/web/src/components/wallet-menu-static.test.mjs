import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function readSource(path) {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

test("connected wallet menu exposes switch wallet action", () => {
  const source = readSource("src/components/wallet-menu.tsx");

  assert.equal(/useWalletClient/.test(source), true);
  assert.equal(/requestEoaWalletSwitch/.test(source), true);
  assert.equal(/openWalletAccountModal/.test(source), false);
  assert.equal(/const handleSwitchWallet = async \(\)/.test(source), true);
  assert.equal(/label="Switch wallet"/.test(source), true);
  assert.equal(/onClick=\{handleSwitchWallet\}/.test(source), true);
});
