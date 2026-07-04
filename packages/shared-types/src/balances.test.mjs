import assert from "node:assert/strict";
import test from "node:test";
import { readTradingWalletBalance } from "./balances.ts";

const owner = "0x0000000000000000000000000000000000000001";

function clientWithBytecode(getBytecode) {
  return {
    async multicall({ contracts }) {
      return contracts.map(() => ({ status: "success", result: 0n }));
    },
    async getBalance() {
      return 0n;
    },
    getBytecode,
  };
}

test("deployment flag distinguishes a failed bytecode read from an empty one", async () => {
  // viem's getBytecode resolves `undefined` for a successful no-code read, so
  // a caught RPC error must not collapse into the same value — every consumer
  // would see a deployed wallet flip to "not deployed" during an outage.
  const failed = await readTradingWalletBalance(
    clientWithBytecode(async () => {
      throw new Error("rpc unavailable");
    }),
    owner,
    { includeDeployment: true }
  );
  assert.equal("isDeployed" in failed, false);

  const empty = await readTradingWalletBalance(
    clientWithBytecode(async () => undefined),
    owner,
    { includeDeployment: true }
  );
  assert.equal(empty.isDeployed, false);

  const deployed = await readTradingWalletBalance(
    clientWithBytecode(async () => "0x6080"),
    owner,
    { includeDeployment: true }
  );
  assert.equal(deployed.isDeployed, true);
});

test("deployment flag stays absent when not requested", async () => {
  const result = await readTradingWalletBalance(
    clientWithBytecode(async () => "0x6080"),
    owner
  );
  assert.equal("isDeployed" in result, false);
});
