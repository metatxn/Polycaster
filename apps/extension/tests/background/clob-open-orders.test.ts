import assert from "node:assert/strict";
import { isPolymarketFreshAuthenticationRequiredError } from "@knoww/shared-types/polymarket-unified";
import { test } from "vitest";
import {
  cancelClobOrder,
  createL2ClobClient,
  fetchClobOpenOrders,
} from "../../src/background/clob-open-orders";

const CREDENTIALS = {
  apiKey: "api-key",
  apiSecret: "api-secret",
  apiPassphrase: "api-passphrase",
};

const ADDRESS = "0x0000000000000000000000000000000000000001";
const FUNDER = "0x0000000000000000000000000000000000000002";

function recordingDeps(client: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const signer = { signer: "credentials-only" };
  const unifiedClient = { client: "unified-sdk-client" };
  const legacyClient = { getOpenOrders() {}, cancelOrder() {}, ...client };
  return {
    calls,
    signer,
    unifiedClient,
    legacyClient,
    deps: {
      createCredentialsOnlySigner: (address: string) => {
        calls.push({ name: "createCredentialsOnlySigner", args: [address] });
        return signer as never;
      },
      createSecureClient: async (input: unknown) => {
        calls.push({ name: "createSecureClient", args: [input] });
        return { client: unifiedClient } as never;
      },
      adaptClient: (input: unknown) => {
        calls.push({ name: "adaptClient", args: [input] });
        return legacyClient as never;
      },
    },
  };
}

test("createL2ClobClient wires L2 credentials and refuses fresh authentication", async () => {
  const { calls, signer, unifiedClient, legacyClient, deps } = recordingDeps();

  const client = await createL2ClobClient(
    { address: ADDRESS, credentials: CREDENTIALS },
    deps
  );

  assert.equal(client, legacyClient);
  assert.deepEqual(calls, [
    { name: "createCredentialsOnlySigner", args: [ADDRESS] },
    {
      name: "createSecureClient",
      args: [
        {
          signer,
          // Wallet defaults to the signer address so the SDK treats the
          // account as an EOA and skips deposit-wallet derivation.
          wallet: ADDRESS,
          credentials: CREDENTIALS,
          allowFreshAuthentication: false,
        },
      ],
    },
    { name: "adaptClient", args: [unifiedClient] },
  ]);
});

test("createL2ClobClient forwards an explicit funder wallet", async () => {
  const { calls, deps } = recordingDeps();

  await createL2ClobClient(
    { address: ADDRESS, credentials: CREDENTIALS, wallet: FUNDER },
    deps
  );

  const secureCall = calls.find((c) => c.name === "createSecureClient");
  assert.ok(secureCall, "createSecureClient was not called");
  assert.equal((secureCall.args[0] as { wallet: string }).wallet, FUNDER);
});

test("fetchClobOpenOrders forwards the page limit to the shim", async () => {
  const seen: unknown[] = [];
  const orders = [{ id: "order-1" }];
  const { deps } = recordingDeps({
    getOpenOrders(params: unknown) {
      seen.push(params);
      return Promise.resolve(orders);
    },
  });

  const result = await fetchClobOpenOrders(
    { address: ADDRESS, credentials: CREDENTIALS, limit: 5 },
    deps
  );

  assert.equal(result, orders);
  assert.deepEqual(seen, [{ limit: 5 }]);
});

test("fetchClobOpenOrders omits the limit option when none is given", async () => {
  const seen: unknown[] = [];
  const { deps } = recordingDeps({
    getOpenOrders(params: unknown) {
      seen.push(params);
      return Promise.resolve([]);
    },
  });

  await fetchClobOpenOrders(
    { address: ADDRESS, credentials: CREDENTIALS },
    deps
  );

  assert.deepEqual(seen, [undefined]);
});

test("cancelClobOrder throws the CLOB's rejection reason (SDK spelling)", async () => {
  const { deps } = recordingDeps({
    cancelOrder: () =>
      Promise.resolve({ notCanceled: { "order-1": "order already filled" } }),
  });

  await assert.rejects(
    cancelClobOrder(
      { address: ADDRESS, credentials: CREDENTIALS, orderId: "order-1" },
      deps
    ),
    /order already filled/
  );
});

test("cancelClobOrder throws the CLOB's rejection reason (wire spelling)", async () => {
  const { deps } = recordingDeps({
    cancelOrder: () =>
      Promise.resolve({ not_canceled: { "order-1": "market closed" } }),
  });

  await assert.rejects(
    cancelClobOrder(
      { address: ADDRESS, credentials: CREDENTIALS, orderId: "order-1" },
      deps
    ),
    /market closed/
  );
});

test("cancelClobOrder resolves when the order is not in the rejection map", async () => {
  const seen: unknown[] = [];
  const { deps } = recordingDeps({
    cancelOrder(params: unknown) {
      seen.push(params);
      return Promise.resolve({ canceled: ["order-1"], notCanceled: {} });
    },
  });

  await cancelClobOrder(
    { address: ADDRESS, credentials: CREDENTIALS, orderId: "order-1" },
    deps
  );

  assert.deepEqual(seen, [{ orderId: "order-1" }]);
});

test("the credentials-only signer answers getAddress but refuses every signature", async () => {
  const { createUnifiedPolymarketCredentialsOnlySigner } = await import(
    "@knoww/shared-types/polymarket-unified"
  );
  const signer = createUnifiedPolymarketCredentialsOnlySigner(ADDRESS);

  assert.equal(await signer.getAddress(), ADDRESS);

  for (const attempt of [
    () => signer.signTypedData({} as never),
    () => signer.signMessage("message" as never),
    () => signer.sendTransaction({} as never),
  ]) {
    await assert.rejects(attempt, (error: unknown) => {
      assert.ok(isPolymarketFreshAuthenticationRequiredError(error));
      return true;
    });
  }
});
