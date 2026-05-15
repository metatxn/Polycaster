import assert from "node:assert/strict";
import test from "node:test";
import { LiveExecutionAdapter } from "./live-execution.ts";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function baseRequest(overrides = {}) {
  return {
    runId: "run-1",
    watchlistItemId: "watch-1",
    tokenId: "token-1",
    conditionId: "condition-1",
    action: "BUY",
    price: "0.50",
    requestedSizeUsd: "5",
    availableLiquidityUsd: "100",
    portfolio: {
      bankrollUsd: "1000",
      cashUsd: "1000",
      maxPositionUsd: "100",
      maxTradeUsd: "25",
      maxDrawdownPct: "0.2",
      realizedPnlUsd: "0",
    },
    ...overrides,
  };
}

function createDeps(runtimeOverrides = {}, options = {}) {
  const records = new Map();
  for (const record of options.liveOrders ?? []) {
    records.set(record.idempotencyKey, record);
  }
  const credentialRecords = new Map();
  const calls = {
    deriveApiCreds: 0,
    postOrder: 0,
    syncBalanceAllowance: 0,
    sendTransactions: 0,
  };
  const client = {
    getOpenOrders: async () => [],
    getClobMarketInfo: async () => ({}),
    updateBalanceAllowance: async () => {
      calls.syncBalanceAllowance += 1;
    },
    createOrder: async (order) => ({ kind: "signed-order", order }),
    postOrder: async () => {
      calls.postOrder += 1;
      return (
        options.postOrderResponse ?? {
          success: true,
          orderID: "order-1",
          status: "matched",
          takingAmount: "5",
          makingAmount: "10",
        }
      );
    },
  };
  return {
    calls,
    deps: {
      upsertLiveOrder: async (record) => {
        const next = {
          ...record,
          createdAt: record.createdAt ?? "2026-05-14T00:00:00.000Z",
        };
        records.set(record.idempotencyKey, next);
        return next;
      },
      getLiveOrderByIdempotencyKey: async (key) => records.get(key) ?? null,
      listLiveOrders: async () => [...records.values()],
      getClobCredential: async (key) => credentialRecords.get(key) ?? null,
      upsertClobCredential: async (record) => {
        credentialRecords.set(record.credentialKey, record);
        return record;
      },
      runtime: {
        setupWallet: async () => ({
          signerAddress: "0x0000000000000000000000000000000000000001",
          walletClient: {},
          publicClient: {},
        }),
        deriveApiCreds: async () => {
          calls.deriveApiCreds += 1;
          return {
            apiKey: "key",
            apiSecret: "secret",
            apiPassphrase: "passphrase",
          };
        },
        createClobClient: async () => client,
        readTradingWalletBalance: async () => ({
          balance: 100,
          balanceRaw: "100000000",
          pusdBalance: 100,
          pusdBalanceRaw: "100000000",
          usdcEBalance: 0,
          usdcEBalanceRaw: "0",
          polBalance: 1,
          polBalanceRaw: "1000000000000000000",
          tokenBalances: [],
        }),
        readTradingApprovalStatus: async () => ({
          pusdCtf: true,
          pusdCtfExchange: true,
          pusdNegRiskExchange: true,
          pusdNegRiskAdapter: true,
          pusdCtfCollateralAdapter: true,
          pusdNegRiskCtfCollateralAdapter: true,
          usdcOnramp: true,
          ctfExchangeApproval: true,
          ctfNegRiskExchangeApproval: true,
          ctfNegRiskAdapterApproval: true,
          ctfCollateralAdapterApproval: true,
          ctfNegRiskCollateralAdapterApproval: true,
          allApproved: true,
          clobTradingApproved: true,
          autoWrapApproved: true,
          ctfOperationsApproved: true,
          negRiskConversionApproved: true,
        }),
        readPusdExchangeAllowance: async () => BigInt("100000000"),
        readErc1155Approval: async () => true,
        readConditionalBalanceRaw: async () => BigInt("100000000"),
        sendTransactions: async () => {
          calls.sendTransactions += 1;
        },
        syncBalanceAllowance: async (syncClient) => {
          await syncClient.updateBalanceAllowance({ asset_type: "COLLATERAL" });
        },
        ...runtimeOverrides,
      },
    },
  };
}

test("posts a live order when real mode is explicitly enabled", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps, calls } = createDeps();
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());

  assert.equal(fill.status, "FILLED");
  assert.equal(fill.notionalUsd, "5");
  assert.equal(fill.shares, "10");
  assert.equal(calls.postOrder, 1);
  assert.equal(calls.deriveApiCreds, 1);
  assert.equal(calls.syncBalanceAllowance > 0, true);
  assert.equal(calls.sendTransactions, 0);
});

test("blocks real live execution for unsupported external funders", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.AGENT_FUNDER_ADDRESS =
    "0x0000000000000000000000000000000000000002";

  const { deps, calls } = createDeps();
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());

  assert.equal(fill.status, "BLOCKED");
  assert.match(fill.reason ?? "", /external funder/i);
  assert.equal(calls.postOrder, 0);
});

test("reuses encrypted cached CLOB credentials instead of deriving again", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY =
    "test-encryption-key-with-enough-entropy";

  const { deps, calls } = createDeps();
  const adapter = new LiveExecutionAdapter(deps);

  const first = await adapter.execute(baseRequest({ runId: "run-cache-1" }));
  const second = await adapter.execute(baseRequest({ runId: "run-cache-2" }));

  assert.equal(first.status, "FILLED");
  assert.equal(second.status, "FILLED");
  assert.equal(calls.postOrder, 2);
  assert.equal(calls.deriveApiCreds, 1);
});

test("uses actual CLOB fill amounts instead of optimistic requested size", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps } = createDeps(
    {},
    {
      postOrderResponse: {
        success: true,
        orderID: "order-partial-fill",
        status: "matched",
        takingAmount: "2.5",
        makingAmount: "5",
      },
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest({ requestedSizeUsd: "5" }));
  const record = await deps.getLiveOrderByIdempotencyKey("run-1:watch-1:BUY");

  assert.equal(fill.status, "FILLED");
  assert.equal(fill.notionalUsd, "2.5");
  assert.equal(fill.shares, "5");
  assert.equal(record.status, "FILLED");
  assert.equal(record.filledNotionalUsd, "2.5");
  assert.equal(record.filledShares, "5");
  assert.equal(record.averageFillPrice, "0.5");
});

test("keeps unfilled CLOB orders open instead of treating post success as filled", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps, calls } = createDeps(
    {},
    {
      postOrderResponse: {
        success: true,
        orderID: "order-open",
        status: "open",
        takingAmount: "0",
        makingAmount: "0",
      },
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const record = await deps.getLiveOrderByIdempotencyKey("run-1:watch-1:BUY");

  assert.equal(fill.status, "BLOCKED");
  assert.match(fill.reason ?? "", /open/i);
  assert.equal(record.status, "OPEN");
  assert.equal(record.orderId, "order-open");
  assert.equal(record.filledNotionalUsd, "0");
  assert.equal(record.filledShares, "0");
  assert.equal(calls.postOrder, 1);
});

test("decrypts cached CLOB credentials with a previous key and re-encrypts with the active version", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = "old-key";
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY_VERSION = "v1";

  const { deps, calls } = createDeps();
  const adapter = new LiveExecutionAdapter(deps);
  await adapter.execute(baseRequest({ runId: "rotation-old" }));

  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = "new-key";
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY_VERSION = "v2";
  process.env.AGENT_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS = "v1:old-key";
  await adapter.execute(baseRequest({ runId: "rotation-new" }));

  const credentialKey =
    "https://clob.polymarket.com:0x0000000000000000000000000000000000000001:0x0000000000000000000000000000000000000001";
  const credential = await deps.getClobCredential(credentialKey);

  assert.equal(calls.deriveApiCreds, 1);
  assert.equal(credential.encryptionKeyVersion, "v2");
});

test("blocks real live execution when daily order cap is reached", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.AGENT_LIVE_DAILY_MAX_ORDER_COUNT = "1";

  const today = new Date().toISOString();
  const { deps, calls } = createDeps(
    {},
    {
      liveOrders: [
        {
          idempotencyKey: "previous:order:BUY",
          runId: "previous",
          watchlistItemId: "order",
          tokenId: "token-previous",
          side: "BUY",
          requestedSizeUsd: "1",
          price: "0.5",
          signedOrderHash: "hash",
          orderId: "order-previous",
          status: "FILLED",
          submittedAt: today,
          filledAt: today,
          createdAt: today,
          dryRun: false,
          error: null,
        },
      ],
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());

  assert.equal(fill.status, "BLOCKED");
  assert.match(fill.reason ?? "", /daily order cap/i);
  assert.equal(calls.postOrder, 0);
});
