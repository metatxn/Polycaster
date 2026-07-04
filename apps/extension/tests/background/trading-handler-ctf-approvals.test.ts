import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

function extractFunctionSource(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1);
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === "{") {
      opened = true;
      depth++;
    } else if (char === "}") {
      depth--;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const handlerSource = readSource("src/background/trading-handler.ts");
const mergeSource = extractFunctionSource(
  handlerSource,
  "handleMergePositions"
);

test("merge plans through the approval-aware CTF planner like split", () => {
  // The merge target is the CTF collateral adapter, which pulls the user's
  // YES/NO ERC-1155 tokens — a wallet missing that operator approval reverts
  // on-chain unless the planner preflights it, exactly as split already does.
  assert.equal(
    /const plan = await planCtfOperationTransactions\(\{\s*operation: "mergePositions",/.test(
      mergeSource
    ),
    true
  );
  assert.equal(/client: publicClient,/.test(mergeSource), true);
  assert.equal(
    /collateralOwner: getAddress\(proxyAddress\) as Address,/.test(mergeSource),
    true
  );
  assert.equal(/fallbackToApproval: true,/.test(mergeSource), true);
});

test("merge executes a missing operator approval before the merge transaction", () => {
  assert.equal(/if \(plan\.approvalTransaction\) \{/.test(mergeSource), true);

  const approvalExecution = mergeSource.indexOf("[plan.approvalTransaction]");
  const mergeExecution = mergeSource.indexOf("[plan.transaction]");
  assert.notEqual(approvalExecution, -1);
  assert.notEqual(mergeExecution, -1);
  assert.equal(approvalExecution < mergeExecution, true);
});

test("the sync single-transaction CTF planner is no longer used by the handler", () => {
  // planCtfOperationTransaction (singular) does no approval planning; every
  // CTF operation in the handler must go through the plural planner. The
  // regex requires "(" immediately after the name so the plural call —
  // "planCtfOperationTransactions(" — does not match.
  assert.equal(/planCtfOperationTransaction\(/.test(handlerSource), false);
  assert.equal(/\bplanCtfOperationTransaction,/.test(handlerSource), false);
});
