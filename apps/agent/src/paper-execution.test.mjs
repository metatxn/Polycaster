import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRisk,
  LiveExecutionAdapter,
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

test("live adapter validates required live-trading safeguards before refusing", async () => {
  const adapter = new LiveExecutionAdapter();

  assert.equal(adapter.mode, "live");
  assert.throws(
    () => validateLiveOrderPreconditions({ idempotencyKey: "key" }),
    /kill switch/i
  );
  await assert.rejects(
    adapter.submitLiveOrder({
      runId: "run_1",
      watchlistItemId: "item_1",
      tokenId: "token_1",
      action: "BUY",
      price: "0.42",
      requestedSizeUsd: "10",
      availableLiquidityUsd: "100",
      portfolio,
      idempotencyKey: "key",
      killSwitchEnabled: true,
      maxPositionUsd: "100",
      maxOrderUsd: "25",
      orderIndicator: "automatic",
      walletSigningIsolation: "server-isolated",
    }),
    /disabled/i
  );
});
