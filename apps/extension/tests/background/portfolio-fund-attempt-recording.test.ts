import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

// The background handler that services KNOWW_PORTFOLIO_FUND_EXECUTE isn't a
// standalone function (it's inline in the giant chrome.runtime.onMessage
// listener), so there's no clean seam to import and unit-test in isolation.
// This structural/source assertion is the most honest test available: it
// pins the withdraw-vs-deposit branch that decides what handle gets
// persisted for RETRY-resume, so a future edit can't silently regress it
// back to always recording the on-chain hash.
test("portfolio fund attempt recording persists the withdraw status-polling handle, not the on-chain hash", () => {
  const source = readSource("src/background.ts");

  const recordExecutionCallIndex = source.indexOf(
    "await portfolioFundAttempts.recordExecution("
  );
  assert.notEqual(recordExecutionCallIndex, -1);

  // Look at the surrounding block that computes what gets recorded.
  const windowStart = Math.max(0, recordExecutionCallIndex - 900);
  const surrounding = source.slice(windowStart, recordExecutionCallIndex + 60);

  // Deposits keep the real on-chain hash (waitForTxReceipt needs it).
  // Withdraws must record the same handle the sidepanel gateway's
  // `executeWithdraw` returns in-session — the bridge address, or its
  // "direct" sentinel fallback when there is none — or a resumed attempt
  // polls KNOWW_PORTFOLIO_WITHDRAW_STATUS with the wrong address and spins
  // forever.
  assert.equal(/isWithdraw\s*\?/.test(surrounding), true);
  assert.equal(/\.bridgeAddress\s*\?\?\s*"direct"/.test(surrounding), true);
  assert.equal(/:\s*data\.txHash/.test(surrounding), true);
});
