import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveIdempotencyKey,
  LiveExecutionAdapter,
} from "./live-execution.ts";
import {
  evaluateRisk,
  PaperExecutionAdapter,
  validateLiveOrderPreconditions,
} from "./paper-execution.ts";

const portfolio = {
  bankrollUsd: "1000",
  cashUsd: "1000",
  maxPositionUsd: "100",
  maxTradeUsd: "50",
  maxDrawdownPct: "0.2",
  realizedPnlUsd: "0",
};

test("blocks trades when liquidity is insufficient", () => {
  const risk = evaluateRisk({
    action: "BUY",
    requestedSizeUsd: "50",
    price: "0.42",
    availableLiquidityUsd: "20",
    portfolio,
  });

  assert.equal(risk.approved, false);
  assert.match(risk.reason, /liquidity/i);
});

test("uses Decimal.js-safe accounting for simulated buy fills", async () => {
  const adapter = new PaperExecutionAdapter();

  const result = await adapter.execute({
    runId: "run_1",
    watchlistItemId: "item_1",
    tokenId: "token_1",
    action: "BUY",
    price: "0.333333",
    requestedSizeUsd: "10",
    availableLiquidityUsd: "100",
    portfolio,
  });

  assert.equal(result.status, "FILLED");
  assert.equal(result.side, "BUY");
  assert.equal(result.notionalUsd, "10");
  assert.equal(result.shares, "30.00003");
  assert.equal(result.cashAfterUsd, "990");
});

test("paper adapter never exposes live execution capability", async () => {
  const adapter = new PaperExecutionAdapter();

  assert.equal(adapter.mode, "paper");
  await assert.rejects(
    adapter.submitLiveOrder({
      idempotencyKey: "key",
    }),
    /disabled/i
  );
});

test("validateLiveOrderPreconditions rejects missing kill switch", () => {
  assert.throws(
    () => validateLiveOrderPreconditions({ idempotencyKey: "key" }),
    /kill switch/i
  );
});

test("buildLiveIdempotencyKey is stable per (run, item, side) triple", () => {
  const key = buildLiveIdempotencyKey({
    runId: "run-1",
    watchlistItemId: "item-1",
    action: "BUY",
  });
  assert.equal(key, "run-1:item-1:BUY");

  const sameKey = buildLiveIdempotencyKey({
    runId: "run-1",
    watchlistItemId: "item-1",
    action: "BUY",
  });
  assert.equal(sameKey, key);

  const differentKey = buildLiveIdempotencyKey({
    runId: "run-1",
    watchlistItemId: "item-1",
    action: "SELL",
  });
  assert.notEqual(differentKey, key);
});

test("LiveExecutionAdapter blocks BUY when kill switch is off (default)", async () => {
  const previousEnabled = process.env.AGENT_LIVE_ENABLED;
  delete process.env.AGENT_LIVE_ENABLED;

  try {
    const adapter = new LiveExecutionAdapter({
      upsertLiveOrder: async (record) => ({ ...record, createdAt: "now" }),
      getLiveOrderByIdempotencyKey: async () => null,
    });

    assert.equal(adapter.mode, "live");

    const fill = await adapter.execute({
      runId: "run_1",
      watchlistItemId: "item_1",
      tokenId: "token_1",
      action: "BUY",
      price: "0.42",
      requestedSizeUsd: "10",
      availableLiquidityUsd: "100",
      portfolio,
    });

    assert.equal(fill.status, "BLOCKED");
    assert.match(fill.reason ?? "", /AGENT_LIVE_ENABLED/);
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.AGENT_LIVE_ENABLED;
    } else {
      process.env.AGENT_LIVE_ENABLED = previousEnabled;
    }
  }
});

test("LiveExecutionAdapter blocks real submission without confirmation flag", async () => {
  const previous = {
    enabled: process.env.AGENT_LIVE_ENABLED,
    dryRun: process.env.AGENT_LIVE_DRY_RUN,
    confirmed: process.env.AGENT_LIVE_CONFIRMED,
  };
  process.env.AGENT_LIVE_ENABLED = "true";
  process.env.AGENT_LIVE_DRY_RUN = "false";
  delete process.env.AGENT_LIVE_CONFIRMED;

  try {
    const adapter = new LiveExecutionAdapter({
      upsertLiveOrder: async (record) => ({ ...record, createdAt: "now" }),
      getLiveOrderByIdempotencyKey: async () => null,
    });

    const fill = await adapter.execute({
      runId: "run_2",
      watchlistItemId: "item_2",
      tokenId: "token_2",
      action: "BUY",
      price: "0.42",
      requestedSizeUsd: "10",
      availableLiquidityUsd: "100",
      portfolio,
    });

    assert.equal(fill.status, "BLOCKED");
    assert.match(fill.reason ?? "", /AGENT_LIVE_CONFIRMED/);
  } finally {
    if (previous.enabled === undefined) {
      delete process.env.AGENT_LIVE_ENABLED;
    } else {
      process.env.AGENT_LIVE_ENABLED = previous.enabled;
    }
    if (previous.dryRun === undefined) {
      delete process.env.AGENT_LIVE_DRY_RUN;
    } else {
      process.env.AGENT_LIVE_DRY_RUN = previous.dryRun;
    }
    if (previous.confirmed === undefined) {
      delete process.env.AGENT_LIVE_CONFIRMED;
    } else {
      process.env.AGENT_LIVE_CONFIRMED = previous.confirmed;
    }
  }
});

test("LiveExecutionAdapter blocks when no wallet private key is configured", async () => {
  const previous = {
    enabled: process.env.AGENT_LIVE_ENABLED,
    key: process.env.AGENT_WALLET_PRIVATE_KEY,
  };
  process.env.AGENT_LIVE_ENABLED = "true";
  delete process.env.AGENT_WALLET_PRIVATE_KEY;

  try {
    const adapter = new LiveExecutionAdapter({
      upsertLiveOrder: async (record) => ({ ...record, createdAt: "now" }),
      getLiveOrderByIdempotencyKey: async () => null,
    });

    const fill = await adapter.execute({
      runId: "run_3",
      watchlistItemId: "item_3",
      tokenId: "token_3",
      action: "BUY",
      price: "0.42",
      requestedSizeUsd: "10",
      availableLiquidityUsd: "100",
      portfolio,
    });

    assert.equal(fill.status, "BLOCKED");
    assert.match(fill.reason ?? "", /AGENT_WALLET_PRIVATE_KEY/);
  } finally {
    if (previous.enabled === undefined) {
      delete process.env.AGENT_LIVE_ENABLED;
    } else {
      process.env.AGENT_LIVE_ENABLED = previous.enabled;
    }
    if (previous.key === undefined) {
      delete process.env.AGENT_WALLET_PRIVATE_KEY;
    } else {
      process.env.AGENT_WALLET_PRIVATE_KEY = previous.key;
    }
  }
});

test("LiveExecutionAdapter replays cached order on idempotency hit", async () => {
  const previous = {
    enabled: process.env.AGENT_LIVE_ENABLED,
    key: process.env.AGENT_WALLET_PRIVATE_KEY,
  };
  process.env.AGENT_LIVE_ENABLED = "true";
  // Stub key so we get past the wallet check; we never sign because the
  // idempotency cache short-circuits first.
  process.env.AGENT_WALLET_PRIVATE_KEY =
    "0x0000000000000000000000000000000000000000000000000000000000000001";

  try {
    const adapter = new LiveExecutionAdapter({
      upsertLiveOrder: async () => {
        throw new Error("should not be called on replay");
      },
      getLiveOrderByIdempotencyKey: async () => ({
        idempotencyKey: "run_4:item_4:BUY",
        runId: "run_4",
        watchlistItemId: "item_4",
        tokenId: "token_4",
        side: "BUY",
        requestedSizeUsd: "5",
        price: "0.42",
        signedOrderHash:
          "0000000000000000000000000000000000000000000000000000000000000000",
        orderId: null,
        status: "DRY_RUN",
        submittedAt: null,
        filledAt: null,
        createdAt: "2026-05-12T00:00:00Z",
        dryRun: true,
        error: null,
      }),
    });

    const fill = await adapter.execute({
      runId: "run_4",
      watchlistItemId: "item_4",
      tokenId: "token_4",
      action: "BUY",
      price: "0.42",
      requestedSizeUsd: "10",
      availableLiquidityUsd: "100",
      portfolio,
    });

    assert.equal(fill.status, "BLOCKED");
    assert.match(fill.reason ?? "", /idempotent-replay:DRY_RUN/);
  } finally {
    if (previous.enabled === undefined) {
      delete process.env.AGENT_LIVE_ENABLED;
    } else {
      process.env.AGENT_LIVE_ENABLED = previous.enabled;
    }
    if (previous.key === undefined) {
      delete process.env.AGENT_WALLET_PRIVATE_KEY;
    } else {
      process.env.AGENT_WALLET_PRIVATE_KEY = previous.key;
    }
  }
});
