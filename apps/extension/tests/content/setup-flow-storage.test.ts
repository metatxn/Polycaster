import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import {
  markSetupComplete,
  readSetupComplete,
  readSetupDismissed,
  readSetupMilestones,
  writeSetupComplete,
  writeSetupDismissed,
  writeSetupMilestones,
} from "../../src/content/trading/setup-flow-storage";

// Minimal in-memory chrome.storage.local stub.
function installChromeStub(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string, cb: (r: Record<string, unknown>) => void) =>
          cb({ [key]: store[key] }),
        set: (items: Record<string, unknown>, cb: () => void) => {
          Object.assign(store, items);
          cb();
        },
      },
    },
  };
  return store;
}

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

const ADDR = "0xAbC0000000000000000000000000000000000001";

test("complete flag defaults false, persists true, and is case-insensitive", async () => {
  installChromeStub();
  assert.equal(await readSetupComplete(ADDR), false);
  await markSetupComplete(ADDR);
  assert.equal(await readSetupComplete(ADDR.toLowerCase()), true);
});

test("complete flag can be cleared after live setup regression", async () => {
  installChromeStub();
  await writeSetupComplete(ADDR, true);
  assert.equal(await readSetupComplete(ADDR), true);
  await writeSetupComplete(ADDR, false);
  assert.equal(await readSetupComplete(ADDR), false);
});

test("dismissed flag round-trips per address", async () => {
  installChromeStub();
  assert.equal(await readSetupDismissed(ADDR), false);
  await writeSetupDismissed(ADDR, true);
  assert.equal(await readSetupDismissed(ADDR), true);
  await writeSetupDismissed(ADDR, false);
  assert.equal(await readSetupDismissed(ADDR), false);
});

test("setup milestones round-trip per address and default to incomplete", async () => {
  installChromeStub();
  assert.deepEqual(await readSetupMilestones(ADDR), {
    tradingWalletDeployed: false,
    hasCredentials: false,
    hasApproval: false,
  });

  await writeSetupMilestones(ADDR, {
    tradingWalletDeployed: true,
    hasCredentials: false,
    hasApproval: true,
  });

  assert.deepEqual(await readSetupMilestones(ADDR.toLowerCase()), {
    tradingWalletDeployed: true,
    hasCredentials: false,
    hasApproval: true,
  });
});

test("reads default false when chrome is unavailable", async () => {
  // no stub installed
  assert.equal(await readSetupComplete(ADDR), false);
  assert.equal(await readSetupDismissed(ADDR), false);
  assert.deepEqual(await readSetupMilestones(ADDR), {
    tradingWalletDeployed: false,
    hasCredentials: false,
    hasApproval: false,
  });
});
