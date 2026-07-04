import assert from "node:assert/strict";
import { test } from "vitest";

import {
  hasDeployedTradingWallet,
  isTradingSetupComplete,
  isTradingWalletDeploymentRequired,
  normalizeExtensionTradingWalletMode,
} from "../../src/content/trading/setup-gates";

test("extension ignores hidden EOA wallet mode when the EOA option is disabled", () => {
  assert.equal(normalizeExtensionTradingWalletMode("eoa"), "deposit");
});

test("undeployed deposit wallet must complete setup before trading credentials", () => {
  assert.equal(
    isTradingWalletDeploymentRequired({
      address: "0x0000000000000000000000000000000000000001",
      proxyAddress: "0x0000000000000000000000000000000000000002",
      walletMode: "deposit",
      isDeployed: false,
    }),
    true
  );
});

test("deployed deposit wallet can continue to credential setup", () => {
  assert.equal(
    isTradingWalletDeploymentRequired({
      address: "0x0000000000000000000000000000000000000001",
      proxyAddress: "0x0000000000000000000000000000000000000002",
      walletMode: "deposit",
      isDeployed: true,
    }),
    false
  );
});

test("hidden EOA credentials do not count as a deployed trading wallet", () => {
  assert.equal(
    hasDeployedTradingWallet({
      address: "0x0000000000000000000000000000000000000001",
      proxyAddress: "0x0000000000000000000000000000000000000001",
      walletMode: "eoa",
      isDeployed: true,
    }),
    false
  );
});

test("hidden EOA mode requires deployment while the EOA option is disabled", () => {
  assert.equal(
    isTradingWalletDeploymentRequired({
      address: "0x0000000000000000000000000000000000000001",
      proxyAddress: "0x0000000000000000000000000000000000000001",
      walletMode: "eoa",
      isDeployed: true,
    }),
    true
  );
});

test("credentials alone do not complete trading setup without deployment", () => {
  assert.equal(
    isTradingSetupComplete({
      address: "0x0000000000000000000000000000000000000001",
      proxyAddress: "0x0000000000000000000000000000000000000002",
      walletMode: "deposit",
      isDeployed: false,
      hasCredentials: true,
    }),
    false
  );
});
