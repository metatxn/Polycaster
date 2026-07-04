import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { backoffDelayMs } from "../../src/content/trading/backoff";
import {
  nextPortfolioApprovalPollDelayMs,
  resolvePortfolioApprovalPollAddress,
  waitForPortfolioTradingWalletDeployment,
} from "../../src/content/trading/portfolio-approval";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

test("approval polling re-resolves the proxy address when the portfolio snapshot is stale", async () => {
  let calls = 0;
  const address = await resolvePortfolioApprovalPollAddress({
    ownerAddress: "0xowner",
    currentProxyAddress: null,
    resolvePortfolioWallet: async (ownerAddress) => {
      calls += 1;
      assert.equal(ownerAddress, "0xowner");
      return { address: "0xproxy" };
    },
  });

  assert.equal(address, "0xproxy");
  assert.equal(calls, 1);
});

test("approval polling uses the current proxy address without re-resolving", async () => {
  let calls = 0;
  const address = await resolvePortfolioApprovalPollAddress({
    ownerAddress: "0xowner",
    currentProxyAddress: "0xcached",
    resolvePortfolioWallet: async () => {
      calls += 1;
      return { address: "0xproxy" };
    },
  });

  assert.equal(address, "0xcached");
  assert.equal(calls, 0);
});

test("approval polling falls back to the owner address only in EOA mode", async () => {
  let calls = 0;
  const address = await resolvePortfolioApprovalPollAddress({
    ownerAddress: "0xowner",
    currentProxyAddress: null,
    resolvePortfolioWallet: async (ownerAddress) => {
      calls += 1;
      assert.equal(ownerAddress, "0xowner");
      return { address: null, walletMode: "eoa" };
    },
  });

  assert.equal(address, "0xowner");
  assert.equal(calls, 1);
});

test("approval polling reports unresolvable when a non-EOA derive fails", async () => {
  // Falling back to the owner EOA in safe/deposit mode polls the wrong
  // account and reports a completed approval as "not approved". The caller
  // maps null to the softer "couldn't verify" outcome instead.
  assert.equal(
    await resolvePortfolioApprovalPollAddress({
      ownerAddress: "0xowner",
      currentProxyAddress: null,
      resolvePortfolioWallet: async () => ({
        address: null,
        walletMode: "deposit",
      }),
    }),
    null
  );

  // An owner-equal address in non-EOA mode is the resolver's own EOA
  // fallback leaking through — a CREATE2-derived wallet never equals the
  // owner.
  assert.equal(
    await resolvePortfolioApprovalPollAddress({
      ownerAddress: "0xOwner",
      currentProxyAddress: null,
      resolvePortfolioWallet: async () => ({
        address: "0xowner",
        walletMode: "safe",
      }),
    }),
    null
  );

  assert.equal(
    await resolvePortfolioApprovalPollAddress({
      ownerAddress: "0xowner",
      currentProxyAddress: null,
      resolvePortfolioWallet: async () => {
        throw new Error("offline");
      },
    }),
    null
  );
});

test("approval polling backs off between allowance checks", () => {
  assert.equal(nextPortfolioApprovalPollDelayMs(0), 1000);
  assert.equal(nextPortfolioApprovalPollDelayMs(1), 2000);
  assert.equal(nextPortfolioApprovalPollDelayMs(2), 4000);
  assert.equal(nextPortfolioApprovalPollDelayMs(3), 8000);
  assert.equal(nextPortfolioApprovalPollDelayMs(10), 8000);
  assert.equal(
    backoffDelayMs(3, { baseMs: 1000, factor: 2, capMs: 8000 }),
    8000
  );
});

test("portfolio approval poll delay reuses the shared backoff helper", () => {
  const source = readSource("src/content/trading/portfolio-approval.ts");

  assert.equal(/backoffDelayMs/.test(source), true);
  assert.equal(/1000 \* 2 \*\*/.test(source), false);
});

test("wallet deployment polling waits until the expected proxy is deployed", async () => {
  let calls = 0;
  const delays: number[] = [];

  const deployed = await waitForPortfolioTradingWalletDeployment({
    ownerAddress: "0xowner",
    expectedProxyAddress: "0xproxy",
    resolvePortfolioWallet: async (ownerAddress) => {
      calls += 1;
      assert.equal(ownerAddress, "0xowner");
      return {
        address: "0xproxy",
        isDeployed: calls > 1,
      };
    },
    nextDelayMs: (attempt) => attempt + 1,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  assert.equal(deployed, true);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1]);
});

test("wallet deployment polling returns immediately when already deployed", async () => {
  let calls = 0;
  const delays: number[] = [];

  const deployed = await waitForPortfolioTradingWalletDeployment({
    ownerAddress: "0xowner",
    expectedProxyAddress: "0xproxy",
    resolvePortfolioWallet: async () => {
      calls += 1;
      return { address: "0xproxy", isDeployed: true };
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  assert.equal(deployed, true);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("wallet deployment polling matches expected proxy addresses case-insensitively", async () => {
  const deployed = await waitForPortfolioTradingWalletDeployment({
    ownerAddress: "0xowner",
    expectedProxyAddress: "0xABCDEF",
    resolvePortfolioWallet: async () => ({
      address: "0xabcdef",
      isDeployed: true,
    }),
  });

  assert.equal(deployed, true);
});

test("wallet deployment polling accepts any deployed wallet when no expected proxy is provided", async () => {
  const deployed = await waitForPortfolioTradingWalletDeployment({
    ownerAddress: "0xowner",
    expectedProxyAddress: null,
    resolvePortfolioWallet: async () => ({
      address: "0xderived",
      isDeployed: true,
    }),
  });

  assert.equal(deployed, true);
});

test("wallet deployment polling ignores a deployed wallet at the wrong proxy address", async () => {
  let calls = 0;
  const delays: number[] = [];

  const deployed = await waitForPortfolioTradingWalletDeployment({
    ownerAddress: "0xowner",
    expectedProxyAddress: "0xexpected",
    resolvePortfolioWallet: async () => {
      calls += 1;
      return calls === 1
        ? { address: "0xwrong", isDeployed: true }
        : { address: "0xexpected", isDeployed: true };
    },
    nextDelayMs: () => 5,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  assert.equal(deployed, true);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [5]);
});

test("wallet deployment polling retries transient wallet resolution failures", async () => {
  let calls = 0;
  const delays: number[] = [];

  const deployed = await waitForPortfolioTradingWalletDeployment({
    ownerAddress: "0xowner",
    expectedProxyAddress: "0xproxy",
    resolvePortfolioWallet: async () => {
      calls += 1;
      if (calls === 1) throw new Error("rpc unavailable");
      return { address: "0xproxy", isDeployed: true };
    },
    nextDelayMs: () => 7,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  assert.equal(deployed, true);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [7]);
});

test("wallet deployment polling returns false after the timeout", async () => {
  let now = 0;
  let calls = 0;
  const delays: number[] = [];

  const deployed = await waitForPortfolioTradingWalletDeployment({
    ownerAddress: "0xowner",
    expectedProxyAddress: "0xproxy",
    timeoutMs: 3,
    now: () => now,
    resolvePortfolioWallet: async () => {
      calls += 1;
      return { address: "0xproxy", isDeployed: false };
    },
    nextDelayMs: () => 2,
    sleep: async (ms) => {
      delays.push(ms);
      now += ms;
    },
  });

  assert.equal(deployed, false);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2, 2]);
});

test("wallet deployment polling stops when scheduled delays exceed timeout even if the clock is frozen", async () => {
  let calls = 0;
  const delays: number[] = [];

  const deployed = await waitForPortfolioTradingWalletDeployment({
    ownerAddress: "0xowner",
    expectedProxyAddress: "0xproxy",
    timeoutMs: 3,
    now: () => 0,
    resolvePortfolioWallet: async () => {
      calls += 1;
      return { address: "0xproxy", isDeployed: calls > 2 };
    },
    nextDelayMs: () => 2,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  assert.equal(deployed, false);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2, 2]);
});

test("wallet deployment polling is bounded when custom delays do not advance time", async () => {
  let calls = 0;

  const deployed = await waitForPortfolioTradingWalletDeployment({
    ownerAddress: "0xowner",
    expectedProxyAddress: "0xproxy",
    timeoutMs: 3,
    now: () => 0,
    resolvePortfolioWallet: async () => {
      calls += 1;
      return { address: "0xproxy", isDeployed: calls > 3 };
    },
    nextDelayMs: () => 0,
    sleep: async () => {},
  });

  assert.equal(deployed, false);
  assert.equal(calls, 3);
});
