import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deployDepositWalletRelayerWallet,
  deploySafeRelayerWallet,
  derivePolymarketDepositWallet,
} from "./relayer.ts";

const ownerAddress = "0x78f394b8c27f7ce8090149e8ffd1b428bc7e95b8";
const deployedDepositWalletAddress =
  "0x82c1b603ab90dc966e4c24fd9d35565e5fd1ae13";

test("derives the relayer-created Polymarket deposit wallet address", () => {
  assert.equal(
    derivePolymarketDepositWallet(ownerAddress).toLowerCase(),
    deployedDepositWalletAddress
  );
});

test("safe wallet deploy uses the shared deployed-wallet preflight helper", () => {
  const source = readFileSync(new URL("./relayer.ts", import.meta.url), {
    encoding: "utf8",
  });
  const deploySafeFunction =
    source.match(
      /export async function deploySafeRelayerWallet[\s\S]*?\n}\n/
    )?.[0] ?? "";

  assert.match(deploySafeFunction, /getDeployedRelayerWallet/);
  assert.doesNotMatch(deploySafeFunction, /transport\.getDeployed\(/);
});

test("deposit wallet deploy returns alreadyDeployed when preflight finds the wallet", async () => {
  let getDeployedCalls = 0;
  let submitCalls = 0;

  const result = await deployDepositWalletRelayerWallet({
    ownerAddress,
    transport: {
      async getDeployed(address, type) {
        getDeployedCalls += 1;
        assert.equal(address, derivePolymarketDepositWallet(ownerAddress));
        assert.equal(type, "WALLET");
        return true;
      },
      async submit() {
        submitCalls += 1;
        throw new Error("submit should not run for a deployed wallet");
      },
      async getTransaction() {
        throw new Error("transaction polling should not run");
      },
    },
    options: { checkDeployed: true },
  });

  assert.equal(result.alreadyDeployed, true);
  assert.equal(result.transactionID, "");
  assert.equal(result.transactionHash, "");
  assert.equal(
    result.walletAddress,
    derivePolymarketDepositWallet(ownerAddress)
  );
  assert.equal(getDeployedCalls, 1);
  assert.equal(submitCalls, 0);
});

test("deposit wallet deploy reconciles a rejected create when the wallet is now deployed", async () => {
  let getDeployedCalls = 0;
  let submitCalls = 0;

  const result = await deployDepositWalletRelayerWallet({
    ownerAddress,
    transport: {
      async getDeployed(address, type) {
        getDeployedCalls += 1;
        assert.equal(address, derivePolymarketDepositWallet(ownerAddress));
        assert.equal(type, "WALLET");
        return getDeployedCalls > 1;
      },
      async submit() {
        submitCalls += 1;
        throw new Error("Relayer 400: Relayer create request rejected");
      },
      async getTransaction() {
        throw new Error("transaction polling should not run after rejection");
      },
    },
    options: { checkDeployed: true },
  });

  assert.equal(result.alreadyDeployed, true);
  assert.equal(result.transactionID, "");
  assert.equal(result.transactionHash, "");
  assert.equal(
    result.walletAddress,
    derivePolymarketDepositWallet(ownerAddress)
  );
  assert.equal(getDeployedCalls, 2);
  assert.equal(submitCalls, 1);
});

test("safe deploy reconciles a rejected create when the safe is now deployed", async () => {
  let getDeployedCalls = 0;
  let submitCalls = 0;

  const result = await deploySafeRelayerWallet({
    eoaAddress: ownerAddress,
    signer: {
      async signTypedData() {
        return `0x${"ab".repeat(65)}`;
      },
    },
    transport: {
      async getDeployed(_address, type) {
        getDeployedCalls += 1;
        assert.equal(type, "SAFE");
        // Preflight misses; the post-rejection reconcile finds the wallet —
        // the same already-deployed policy the deposit path has, now shared.
        return getDeployedCalls > 1;
      },
      async submit() {
        submitCalls += 1;
        throw new Error("Relayer 400: Relayer create request rejected");
      },
      async getTransaction() {
        throw new Error("transaction polling should not run after rejection");
      },
    },
    options: { checkDeployed: true },
  });

  assert.equal(result.alreadyDeployed, true);
  assert.equal(result.transactionID, "");
  assert.equal(result.transactionHash, "");
  assert.equal(getDeployedCalls, 2);
  assert.equal(submitCalls, 1);
});
