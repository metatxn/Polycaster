import assert from "node:assert/strict";
import test from "node:test";
import {
  isSettlementPendingLiveOrder,
  isUnresolvedLiveOrder,
} from "./live-accounting.ts";
import {
  createUnifiedLiveClobClient,
  deriveUnifiedLiveApiCreds,
  getLiveExecutionConfig,
  LiveExecutionAdapter,
} from "./live-execution.ts";

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
    createMarketOrder: 0,
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
    createMarketOrder: async (order) => {
      calls.createMarketOrder += 1;
      return { kind: "signed-order", order };
    },
    postOrder: async () => {
      calls.postOrder += 1;
      if (options.postOrderError) throw options.postOrderError;
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
          pusdCtfCollateralAdapter: true,
          pusdNegRiskCtfCollateralAdapter: true,
          usdcOnramp: true,
          ctfExchangeApproval: true,
          ctfNegRiskExchangeApproval: true,
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
          await syncClient.updateBalanceAllowance({ assetType: "COLLATERAL" });
        },
        // Instant sleep so the settlement poll doesn't run in real time.
        sleep: async () => {},
        ...runtimeOverrides,
      },
    },
  };
}

function walletBalance(pusdBalanceRaw) {
  return {
    balance: 100,
    balanceRaw: "100000000",
    pusdBalance: Number(pusdBalanceRaw) / 1e6,
    pusdBalanceRaw,
    usdcEBalance: 0,
    usdcEBalanceRaw: "0",
    polBalance: 1,
    polBalanceRaw: "1000000000000000000",
    tokenBalances: [],
  };
}

// A filled real BUY from an earlier run whose settlement debit was never
// observed inline — the shape the safety gate's reconcilePendingSettlement
// pass scans for. `preSubmission` overrides merge into the anchor.
function pendingSettlementOrder(preSubmission = {}) {
  const createdAt = "2026-05-14T00:00:00.000Z";
  return {
    idempotencyKey: "run-0:watch-0:BUY",
    runId: "run-0",
    watchlistItemId: "watch-0",
    tokenId: "token-1",
    side: "BUY",
    requestedSizeUsd: "5",
    price: "0.5",
    signedOrderHash: "c".repeat(64),
    orderId: "order-pending",
    status: "FILLED",
    submittedAt: createdAt,
    filledAt: createdAt,
    createdAt,
    filledNotionalUsd: "5",
    filledShares: "10",
    averageFillPrice: "0.5",
    feeEstimateUsd: "0.15",
    settledFeeUsd: null,
    lastSyncedAt: createdAt,
    balanceSnapshotJson: JSON.stringify({
      preSubmission: {
        capturedAt: createdAt,
        funderAddress: "0x0000000000000000000000000000000000000001",
        wallet: {
          pusdBalanceRaw: "100000000",
          usdcEBalanceRaw: "0",
          polBalanceRaw: "1000000000000000000",
        },
        conditionalBalanceRaw: "0",
        ...preSubmission,
      },
      postSubmission: null,
    }),
    dryRun: false,
    error: null,
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

test("adds SELL proceeds when replaying an idempotent filled order", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const createdAt = "2026-05-14T00:00:00.000Z";
  const { deps, calls } = createDeps(
    {},
    {
      liveOrders: [
        {
          idempotencyKey: "run-1:watch-1:SELL",
          runId: "run-1",
          watchlistItemId: "watch-1",
          tokenId: "token-1",
          side: "SELL",
          requestedSizeUsd: "5",
          price: "0.5",
          signedOrderHash: "a".repeat(64),
          orderId: "order-sell",
          status: "FILLED",
          submittedAt: createdAt,
          filledAt: createdAt,
          createdAt,
          filledNotionalUsd: "5",
          filledShares: "10",
          averageFillPrice: "0.5",
          lastSyncedAt: createdAt,
          balanceSnapshotJson: null,
          dryRun: false,
          error: null,
        },
      ],
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(
    baseRequest({ action: "SELL", portfolio: { ...baseRequest().portfolio } })
  );

  assert.equal(fill.status, "FILLED");
  assert.equal(fill.cashAfterUsd, "1005");
  assert.equal(calls.createMarketOrder, 0);
  assert.equal(calls.postOrder, 0);
});

test("continues subtracting BUY cost when replaying an idempotent filled order", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const createdAt = "2026-05-14T00:00:00.000Z";
  const { deps, calls } = createDeps(
    {},
    {
      liveOrders: [
        {
          idempotencyKey: "run-1:watch-1:BUY",
          runId: "run-1",
          watchlistItemId: "watch-1",
          tokenId: "token-1",
          side: "BUY",
          requestedSizeUsd: "5",
          price: "0.5",
          signedOrderHash: "b".repeat(64),
          orderId: "order-buy",
          status: "FILLED",
          submittedAt: createdAt,
          filledAt: createdAt,
          createdAt,
          filledNotionalUsd: "5",
          filledShares: "10",
          averageFillPrice: "0.5",
          lastSyncedAt: createdAt,
          balanceSnapshotJson: null,
          dryRun: false,
          error: null,
        },
      ],
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());

  assert.equal(fill.status, "FILLED");
  // Legacy rows predate `feeEstimateUsd`; the replay treats the absent field as $0.
  assert.equal(fill.cashAfterUsd, "995");
  assert.equal(calls.createMarketOrder, 0);
  assert.equal(calls.postOrder, 0);
});

test("replays the recorded BUY fee when the filled order carried one", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const createdAt = "2026-05-14T00:00:00.000Z";
  const { deps, calls } = createDeps(
    {},
    {
      liveOrders: [
        {
          idempotencyKey: "run-1:watch-1:BUY",
          runId: "run-1",
          watchlistItemId: "watch-1",
          tokenId: "token-1",
          side: "BUY",
          requestedSizeUsd: "5",
          price: "0.5",
          signedOrderHash: "b".repeat(64),
          orderId: "order-buy",
          status: "FILLED",
          submittedAt: createdAt,
          filledAt: createdAt,
          createdAt,
          filledNotionalUsd: "5",
          filledShares: "10",
          averageFillPrice: "0.5",
          feeEstimateUsd: "0.15",
          lastSyncedAt: createdAt,
          balanceSnapshotJson: null,
          dryRun: false,
          error: null,
        },
      ],
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());

  assert.equal(fill.status, "FILLED");
  // Replay must debit the same fee the original fill did, or the second run
  // reports more cash than the first for the identical order.
  assert.equal(fill.cashAfterUsd, "994.85");
  assert.equal(calls.postOrder, 0);
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

  // The settlement debit lands after the first poll sleep so the first order
  // reconciles inline; an unreconciled fill would block the second submission
  // at the safety gate. Both legs flip together: the pUSD debit and the
  // conditional-token credit for the 10 filled shares.
  const state = { settled: false };
  const { deps, calls } = createDeps({
    sleep: async () => {
      state.settled = true;
    },
    readTradingWalletBalance: async () =>
      walletBalance(state.settled ? "94850000" : "100000000"),
    readConditionalBalanceRaw: async () =>
      BigInt(state.settled ? "110000000" : "100000000"),
  });
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
  // The fallback fee reserve (300 bps of the $5 request = $0.15) scales by
  // the fill ratio: half filled → $0.075 debited on top of the notional.
  assert.equal(fill.cashAfterUsd, "997.425");
  assert.equal(record.status, "FILLED");
  assert.equal(record.filledNotionalUsd, "2.5");
  assert.equal(record.filledShares, "5");
  assert.equal(record.averageFillPrice, "0.5");
  assert.equal(record.feeEstimateUsd, "0.075");
});

test("subtracts the BUY fee reserve from cash on top of the filled notional", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps } = createDeps();
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const record = await deps.getLiveOrderByIdempotencyKey("run-1:watch-1:BUY");

  assert.equal(fill.status, "FILLED");
  assert.equal(fill.notionalUsd, "5");
  // The market info carries no fee metadata, so the preflight reserves the
  // conservative 300 bps fallback: $5 notional + $0.15 fee leaves $994.85,
  // not the $995 an fee-free debit would.
  assert.equal(fill.cashAfterUsd, "994.85");
  assert.equal(record.feeEstimateUsd, "0.15");
});

test("surfaces partial CLOB fills as PARTIALLY_FILLED instead of FILLED", async () => {
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
        orderID: "order-partial",
        // Not "matched"/"filled"/"canceled", but with shares filled → the
        // CLOB only partially filled this FAK order.
        status: "live",
        takingAmount: "2.5",
        makingAmount: "5",
      },
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest({ requestedSizeUsd: "5" }));
  const record = await deps.getLiveOrderByIdempotencyKey("run-1:watch-1:BUY");

  assert.equal(fill.status, "PARTIALLY_FILLED");
  assert.equal(fill.notionalUsd, "2.5");
  assert.equal(fill.shares, "5");
  assert.equal(record.status, "PARTIALLY_FILLED");
  assert.equal(record.filledNotionalUsd, "2.5");
  assert.equal(record.filledShares, "5");
  assert.equal(calls.postOrder, 1);
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

test("preserves the signed audit identity for reconciliation when CLOB submission is ambiguous", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps, calls } = createDeps(
    {},
    {
      // A timeout does not prove that the exchange rejected the order: the
      // request may have crossed the network boundary before the response was
      // lost. The persisted audit row must therefore remain reconcilable.
      postOrderError: new Error("CLOB response timed out after submission"),
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const record = await deps.getLiveOrderByIdempotencyKey("run-1:watch-1:BUY");

  assert.equal(fill.status, "BLOCKED");
  assert.equal(calls.postOrder, 1);
  assert.notEqual(record, null);
  assert.match(record.signedOrderHash, /^[a-f0-9]{64}$/);
  assert.notEqual(record.submittedAt, null);
  assert.match(record.status, /^(UNKNOWN|PENDING_RECONCILIATION)$/);
  assert.notEqual(record.status, "FAILED");
  assert.match(record.error ?? "", /timed out/i);
});

test("treats a malformed CLOB success response as an unknown outcome", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps, calls } = createDeps({}, { postOrderResponse: {} });
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const record = await deps.getLiveOrderByIdempotencyKey("run-1:watch-1:BUY");

  assert.equal(fill.status, "BLOCKED");
  assert.equal(calls.postOrder, 1);
  assert.equal(record.status, "UNKNOWN");
  assert.match(record.error ?? "", /missing order id/i);
});

test("blocks new live submissions while an earlier order outcome is unknown", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const submittedAt = new Date().toISOString();
  const { deps, calls } = createDeps(
    {},
    {
      liveOrders: [
        {
          idempotencyKey: "previous:watch-1:BUY",
          runId: "previous",
          watchlistItemId: "watch-1",
          tokenId: "token-1",
          side: "BUY",
          requestedSizeUsd: "5",
          price: "0.50",
          signedOrderHash: "a".repeat(64),
          orderId: null,
          status: "UNKNOWN",
          submittedAt,
          filledAt: null,
          createdAt: submittedAt,
          filledNotionalUsd: "0",
          filledShares: "0",
          averageFillPrice: null,
          lastSyncedAt: null,
          balanceSnapshotJson: null,
          dryRun: false,
          error: "response timed out",
        },
      ],
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest({ runId: "run-2" }));

  assert.equal(fill.status, "BLOCKED");
  assert.match(fill.reason ?? "", /unknown.*reconcil/i);
  assert.equal(calls.postOrder, 0);
});

test("blocks new live submissions when a post-boundary audit row remains posted", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const submittedAt = new Date().toISOString();
  const { deps, calls } = createDeps(
    {},
    {
      liveOrders: [
        {
          idempotencyKey: "previous:watch-1:BUY",
          runId: "previous",
          watchlistItemId: "watch-1",
          tokenId: "token-1",
          side: "BUY",
          requestedSizeUsd: "5",
          price: "0.50",
          signedOrderHash: "a".repeat(64),
          orderId: null,
          status: "POSTED",
          submittedAt,
          filledAt: null,
          createdAt: submittedAt,
          filledNotionalUsd: "0",
          filledShares: "0",
          averageFillPrice: null,
          lastSyncedAt: null,
          balanceSnapshotJson: null,
          dryRun: false,
          error: null,
        },
      ],
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest({ runId: "run-2" }));

  assert.equal(fill.status, "BLOCKED");
  assert.match(fill.reason ?? "", /pending.*reconcil/i);
  assert.equal(calls.postOrder, 0);
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

  // Settle the first order inline (debit appears after the first poll sleep)
  // so its pending-reconciliation block doesn't stop the second submission
  // before the rotated credentials are exercised.
  const state = { settled: false };
  const { deps, calls } = createDeps({
    sleep: async () => {
      state.settled = true;
    },
    readTradingWalletBalance: async () =>
      walletBalance(state.settled ? "94850000" : "100000000"),
    readConditionalBalanceRaw: async () =>
      BigInt(state.settled ? "110000000" : "100000000"),
  });
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

test("derives the settled BUY fee from the observed balance debit", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  // The settlement debit ($5 notional + $0.25 fee) and the matching
  // 10-share conditional-token credit land only after the poll's first
  // sleep, so every pre-submission read still sees the pre-debit balances.
  const state = { settled: false };
  const { deps } = createDeps({
    sleep: async () => {
      state.settled = true;
    },
    readTradingWalletBalance: async () =>
      walletBalance(state.settled ? "94750000" : "100000000"),
    readConditionalBalanceRaw: async () =>
      BigInt(state.settled ? "110000000" : "100000000"),
  });
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const record = await deps.getLiveOrderByIdempotencyKey("run-1:watch-1:BUY");

  assert.equal(fill.status, "FILLED");
  // Cash reflects the ACTUAL $0.25 fee, not the $0.15 preflight estimate.
  assert.equal(fill.cashAfterUsd, "994.75");
  assert.equal(record.settledFeeUsd, "0.25");
  assert.equal(record.feeEstimateUsd, "0.15");
  const snapshot = JSON.parse(record.balanceSnapshotJson);
  assert.equal(snapshot.preSubmission.wallet.pusdBalanceRaw, "100000000");
  assert.equal(snapshot.postSubmission.wallet.pusdBalanceRaw, "100000000");
  assert.equal(snapshot.settlement.wallet.pusdBalanceRaw, "94750000");
});

test("does not derive an inline fee from a pUSD drop without the conditional-token credit", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  // The wallet loses $5.25 during the poll window but never gains the 10
  // filled shares (the default conditional read is static): an unrelated
  // spend, not this order settling. The fee must stay unresolved instead of
  // being derived from the unrelated debit.
  const state = { settled: false };
  const { deps } = createDeps({
    sleep: async () => {
      state.settled = true;
    },
    readTradingWalletBalance: async () =>
      walletBalance(state.settled ? "94750000" : "100000000"),
  });
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const record = await deps.getLiveOrderByIdempotencyKey("run-1:watch-1:BUY");

  assert.equal(fill.status, "FILLED");
  // Cash falls back to the preflight estimate; the row stays pending so the
  // safety gate keeps blocking until the fee is actually attributable.
  assert.equal(fill.cashAfterUsd, "994.85");
  assert.equal(record.settledFeeUsd, null);
});

test("blocks the next live order while a filled BUY settlement is unreconciled", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  // Static balance: the settlement debit never becomes observable.
  const { deps, calls } = createDeps();
  const adapter = new LiveExecutionAdapter(deps);

  const first = await adapter.execute(baseRequest());
  const record = await deps.getLiveOrderByIdempotencyKey("run-1:watch-1:BUY");
  const second = await adapter.execute(
    baseRequest({ runId: "run-2", watchlistItemId: "watch-2" })
  );

  assert.equal(first.status, "FILLED");
  assert.equal(first.cashAfterUsd, "994.85");
  // The record stays pending (null settled fee) rather than pretending the
  // estimate was the actual debit, and blocks the next submission.
  assert.equal(record.settledFeeUsd, null);
  assert.equal(second.status, "BLOCKED");
  assert.match(second.reason ?? "", /pending reconciliation/i);
  assert.equal(calls.postOrder, 1);
});

test("reconciles a pending settlement from an earlier run before trading again", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps, calls } = createDeps(
    {
      // The wallet now shows the settled debit from the pending order:
      // $5 notional + $0.25 fee below its pre-submission anchor. The default
      // conditional balance (100000000) against the anchor's "0" supplies
      // the 10-share fill evidence.
      readTradingWalletBalance: async () => walletBalance("94750000"),
    },
    { liveOrders: [pendingSettlementOrder()] }
  );
  const healCalls = [];
  deps.applySettledFeeToRunFill = async (input) => {
    healCalls.push(input);
  };
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const healed = await deps.getLiveOrderByIdempotencyKey("run-0:watch-0:BUY");

  // The safety gate's reconciliation pass derived the fee, unblocking the
  // new submission in the same run.
  assert.equal(fill.status, "FILLED");
  assert.equal(calls.postOrder, 1);
  assert.equal(healed.settledFeeUsd, "0.25");
  const snapshot = JSON.parse(healed.balanceSnapshotJson);
  assert.equal(snapshot.preSubmission.wallet.pusdBalanceRaw, "100000000");
  assert.equal(snapshot.settlement.wallet.pusdBalanceRaw, "94750000");
  // The persisted run-item fill was corrected alongside the order row.
  assert.deepEqual(healCalls, [
    {
      runId: "run-0",
      watchlistItemId: "watch-0",
      side: "BUY",
      feeEstimateUsd: "0.15",
      settledFeeUsd: "0.25",
    },
  ]);
});

test("late reconciliation refuses when the configured wallet no longer matches the anchor", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps, calls } = createDeps(
    {
      // A plausible $5.25 debit is visible — but the anchor was captured
      // from a different wallet, so the delta is meaningless here.
      readTradingWalletBalance: async () => walletBalance("94750000"),
    },
    {
      liveOrders: [
        pendingSettlementOrder({
          funderAddress: "0x0000000000000000000000000000000000000002",
        }),
      ],
    }
  );
  const healCalls = [];
  deps.applySettledFeeToRunFill = async (input) => {
    healCalls.push(input);
  };
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const order = await deps.getLiveOrderByIdempotencyKey("run-0:watch-0:BUY");

  assert.equal(fill.status, "BLOCKED");
  assert.match(fill.reason ?? "", /pending reconciliation/i);
  assert.equal(calls.postOrder, 0);
  assert.equal(order.settledFeeUsd, null);
  assert.deepEqual(healCalls, []);
});

test("late reconciliation refuses a legacy anchor that never captured a wallet address", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps, calls } = createDeps(
    {
      readTradingWalletBalance: async () => walletBalance("94750000"),
    },
    {
      liveOrders: [
        // JSON.stringify drops the undefined, producing the pre-address
        // anchor shape older rows carry. Without a recorded wallet there is
        // no way to prove the delta comes from the same account.
        pendingSettlementOrder({ funderAddress: undefined }),
      ],
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const order = await deps.getLiveOrderByIdempotencyKey("run-0:watch-0:BUY");

  assert.equal(fill.status, "BLOCKED");
  assert.match(fill.reason ?? "", /pending reconciliation/i);
  assert.equal(calls.postOrder, 0);
  assert.equal(order.settledFeeUsd, null);
});

test("late reconciliation refuses a pUSD drop without the conditional-token credit", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { deps, calls } = createDeps(
    {
      // The wallet lost exactly $5.25 — an unrelated spend that LOOKS like
      // notional + fee. The conditional balance never moved (anchor and
      // current read are both 100000000), so no shares were credited and
      // the drop must not be recorded as this order's fee.
      readTradingWalletBalance: async () => walletBalance("94750000"),
    },
    {
      liveOrders: [
        pendingSettlementOrder({ conditionalBalanceRaw: "100000000" }),
      ],
    }
  );
  const healCalls = [];
  deps.applySettledFeeToRunFill = async (input) => {
    healCalls.push(input);
  };
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());
  const order = await deps.getLiveOrderByIdempotencyKey("run-0:watch-0:BUY");

  assert.equal(fill.status, "BLOCKED");
  assert.match(fill.reason ?? "", /pending reconciliation/i);
  assert.equal(calls.postOrder, 0);
  assert.equal(order.settledFeeUsd, null);
  assert.deepEqual(healCalls, []);
});

test("replays the settled BUY fee in preference to the preflight estimate", async () => {
  restoreEnv();
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  process.env.AGENT_LIVE_CONFIRMED = "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const createdAt = "2026-05-14T00:00:00.000Z";
  const { deps, calls } = createDeps(
    {},
    {
      liveOrders: [
        {
          idempotencyKey: "run-1:watch-1:BUY",
          runId: "run-1",
          watchlistItemId: "watch-1",
          tokenId: "token-1",
          side: "BUY",
          requestedSizeUsd: "5",
          price: "0.5",
          signedOrderHash: "b".repeat(64),
          orderId: "order-buy",
          status: "FILLED",
          submittedAt: createdAt,
          filledAt: createdAt,
          createdAt,
          filledNotionalUsd: "5",
          filledShares: "10",
          averageFillPrice: "0.5",
          feeEstimateUsd: "0.15",
          settledFeeUsd: "0.30",
          lastSyncedAt: createdAt,
          balanceSnapshotJson: null,
          dryRun: false,
          error: null,
        },
      ],
    }
  );
  const adapter = new LiveExecutionAdapter(deps);

  const fill = await adapter.execute(baseRequest());

  assert.equal(fill.status, "FILLED");
  // $1000 − $5 notional − $0.30 settled fee, not the $0.15 estimate.
  assert.equal(fill.cashAfterUsd, "994.7");
  assert.equal(calls.postOrder, 0);
});

test("settlement-pending and unresolved predicates gate on the pre-submission anchor", () => {
  const base = {
    idempotencyKey: "run-0:watch-0:BUY",
    runId: "run-0",
    watchlistItemId: "watch-0",
    tokenId: "token-1",
    side: "BUY",
    requestedSizeUsd: "5",
    price: "0.5",
    signedOrderHash: null,
    orderId: null,
    status: "FILLED",
    submittedAt: null,
    filledAt: null,
    createdAt: "2026-05-14T00:00:00.000Z",
    filledNotionalUsd: "5",
    filledShares: "10",
    averageFillPrice: null,
    feeEstimateUsd: "0.15",
    settledFeeUsd: null,
    lastSyncedAt: null,
    balanceSnapshotJson: null,
    dryRun: false,
    error: null,
  };
  const anchored = {
    ...base,
    balanceSnapshotJson: JSON.stringify({
      preSubmission: {
        capturedAt: "2026-05-14T00:00:00.000Z",
        wallet: { pusdBalanceRaw: "100000000" },
      },
      postSubmission: null,
    }),
  };

  // Legacy rows without an anchor can never be reconciled, so they must not
  // block live trading forever.
  assert.equal(isSettlementPendingLiveOrder(base), false);
  assert.equal(isUnresolvedLiveOrder(base), false);
  assert.equal(isSettlementPendingLiveOrder(anchored), true);
  assert.equal(isUnresolvedLiveOrder(anchored), true);
  assert.equal(
    isSettlementPendingLiveOrder({ ...anchored, settledFeeUsd: "0.25" }),
    false
  );
  assert.equal(
    isUnresolvedLiveOrder({ ...anchored, settledFeeUsd: "0.25" }),
    false
  );
  assert.equal(
    isSettlementPendingLiveOrder({ ...anchored, dryRun: true }),
    false
  );
  assert.equal(
    isSettlementPendingLiveOrder({ ...anchored, side: "SELL" }),
    false
  );
  assert.equal(isUnresolvedLiveOrder({ ...base, status: "POSTED" }), true);
  assert.equal(isUnresolvedLiveOrder({ ...base, status: "UNKNOWN" }), true);
  assert.equal(
    isUnresolvedLiveOrder({ ...base, status: "POSTED", dryRun: true }),
    false
  );
});

test("deriveUnifiedLiveApiCreds derives credentials through the unified SDK signer", async () => {
  const walletClient = { account: "wallet-client" };
  const signer = { signer: "viem-signer" };
  const calls = [];

  const creds = await deriveUnifiedLiveApiCreds(walletClient, {
    createViemSigner: (input) => {
      calls.push(["createViemSigner", input]);
      return signer;
    },
    createSecureClient: async (input) => {
      calls.push(["createSecureClient", input]);
      return {
        appCredentials: {
          apiKey: "api-key",
          apiSecret: "api-secret",
          apiPassphrase: "api-passphrase",
        },
      };
    },
  });

  assert.deepEqual(creds, {
    apiKey: "api-key",
    apiSecret: "api-secret",
    apiPassphrase: "api-passphrase",
  });
  assert.deepEqual(calls, [
    ["createViemSigner", walletClient],
    ["createSecureClient", { signer }],
  ]);
});

test("createUnifiedLiveClobClient adapts the unified SDK client for live CLOB execution", async () => {
  const walletClient = { account: "wallet-client" };
  const signer = { signer: "viem-signer" };
  const unifiedClient = { client: "unified-sdk-client" };
  const legacyClient = { client: "legacy-adapter-client" };
  const calls = [];

  const client = await createUnifiedLiveClobClient(
    {
      config: {
        ...getLiveExecutionConfigForTest(),
        clobHost: "https://clob.polymarket.com",
        builderCode: "builder-code",
      },
      walletClient,
      funderAddress: "0x0000000000000000000000000000000000000002",
      creds: {
        apiKey: "api-key",
        apiSecret: "api-secret",
        apiPassphrase: "api-passphrase",
      },
    },
    {
      createViemSigner: (input) => {
        calls.push(["createViemSigner", input]);
        return signer;
      },
      createSecureClient: async (input) => {
        calls.push(["createSecureClient", input]);
        return { client: unifiedClient };
      },
      adaptClient: (...args) => {
        calls.push(["adaptClient", ...args]);
        return legacyClient;
      },
    }
  );

  assert.equal(client, legacyClient);
  assert.deepEqual(calls, [
    ["createViemSigner", walletClient],
    [
      "createSecureClient",
      {
        signer,
        wallet: "0x0000000000000000000000000000000000000002",
        credentials: {
          apiKey: "api-key",
          apiSecret: "api-secret",
          apiPassphrase: "api-passphrase",
        },
      },
    ],
    ["adaptClient", unifiedClient, { builderCode: "builder-code" }],
  ]);
});

test("createUnifiedLiveClobClient adapts without attribution when no builder code is configured", async () => {
  const adaptArgs = [];

  await createUnifiedLiveClobClient(
    {
      config: {
        ...getLiveExecutionConfigForTest(),
        clobHost: "https://clob.polymarket.com",
        builderCode: null,
      },
      walletClient: {},
      funderAddress: "0x0000000000000000000000000000000000000002",
      creds: {
        apiKey: "api-key",
        apiSecret: "api-secret",
        apiPassphrase: "api-passphrase",
      },
    },
    {
      createViemSigner: () => ({}),
      createSecureClient: async () => ({ client: {} }),
      adaptClient: (...args) => {
        adaptArgs.push(args);
        return {};
      },
    }
  );

  assert.deepEqual(adaptArgs, [[{}, { builderCode: undefined }]]);
});

test("getLiveExecutionConfig reads the builder attribution code from POLY_BUILDER_CODE", () => {
  restoreEnv();
  delete process.env.POLY_BUILDER_CODE;
  assert.equal(getLiveExecutionConfig().builderCode, null);

  process.env.POLY_BUILDER_CODE = "  builder-code  ";
  assert.equal(getLiveExecutionConfig().builderCode, "builder-code");

  // Whitespace-only is "not configured", not an empty attribution code.
  process.env.POLY_BUILDER_CODE = "   ";
  assert.equal(getLiveExecutionConfig().builderCode, null);
  restoreEnv();
});

test("createUnifiedLiveClobClient rejects non-production CLOB hosts", async () => {
  await assert.rejects(
    () =>
      createUnifiedLiveClobClient(
        {
          config: {
            ...getLiveExecutionConfigForTest(),
            clobHost: "https://example.test",
          },
          walletClient: {},
          funderAddress: "0x0000000000000000000000000000000000000002",
          creds: {
            apiKey: "api-key",
            apiSecret: "api-secret",
            apiPassphrase: "api-passphrase",
          },
        },
        {
          createViemSigner: () => ({}),
          createSecureClient: async () => ({ client: {} }),
          adaptClient: () => ({}),
        }
      ),
    /production CLOB host/
  );
});

function getLiveExecutionConfigForTest() {
  return {
    enabled: true,
    dryRun: false,
    confirmedReal: true,
    privateKey:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    funderAddress: null,
    maxLiveNotionalUsd: "5",
    clobHost: "https://clob.polymarket.com",
    chainId: 137,
    rpcUrl: "https://polygon-rpc.com",
    orderType: "FOK",
    builderCode: null,
  };
}
