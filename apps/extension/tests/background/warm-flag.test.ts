import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { TRADING_WARM_ELIGIBLE_STORAGE_KEY } from "../../src/content/trading-warm-flag";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("the warm-eligibility storage key is a shared core-safe constant", () => {
  assert.equal(TRADING_WARM_ELIGIBLE_STORAGE_KEY, "knowwTradingWarmEligible");
  const loader = readSource("src/content/trading-loader.ts");
  const background = readSource("src/background.ts");
  assert.match(loader, /TRADING_WARM_ELIGIBLE_STORAGE_KEY/);
  assert.match(background, /TRADING_WARM_ELIGIBLE_STORAGE_KEY/);
});

test("credential derivation marks warm eligibility only after credentials are stored", () => {
  const source = readSource("src/background.ts");
  const derivation = source.match(
    /if \(\s*msg\.type === "trading:derive-credentials"[\s\S]*?sendResponse\(extracted\.response\);\s*return;/
  )?.[0];
  assert.ok(derivation, "expected credential derivation success block");
  const storeIndex = derivation.indexOf("await storeClobCredentials");
  const warmIndex = derivation.indexOf("TRADING_WARM_ELIGIBLE_STORAGE_KEY");
  const responseIndex = derivation.indexOf("sendResponse(extracted.response)");
  assert.ok(storeIndex >= 0);
  assert.ok(warmIndex > storeIndex);
  assert.ok(responseIndex > warmIndex);
  assert.match(
    derivation,
    /chrome\.storage\.local[\s\S]*?\.set\([\s\S]*?\.catch\(\(\) => \{\}\)/
  );
});

test("logout clears warm eligibility before broadcasting disconnection and swallows flag errors", () => {
  const source = readSource("src/background.ts");
  const logout = source.match(
    /if \(msg\?\.type === "auth:logout"\)[\s\S]*?return true;/
  )?.[0];
  assert.ok(logout, "expected auth:logout handler");
  const clearIndex = logout.indexOf("TRADING_WARM_ELIGIBLE_STORAGE_KEY");
  const broadcastIndex = logout.indexOf("broadcastTradingSessionDisconnected");
  assert.ok(clearIndex >= 0);
  assert.ok(broadcastIndex > clearIndex);
  assert.match(
    logout,
    /chrome\.storage\.local[\s\S]*?\.remove\([\s\S]*?\.catch\(\(\) => \{\}\)/
  );
});
