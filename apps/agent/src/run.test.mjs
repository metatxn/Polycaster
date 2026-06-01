import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRepository } from "./repository.ts";
import { isExecutedFill, marketTimingGate, settleSellFill } from "./run.ts";

const baseItem = {
  id: "item_1",
  question: "Will the test market resolve Yes?",
  tokenId: "token_1",
  side: "YES",
  newsUrls: [],
  socialNotes: [],
  active: true,
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

const nowMs = Date.parse("2026-05-10T12:00:00.000Z");

test("allows markets outside the close buffer", () => {
  const decision = marketTimingGate(
    {
      ...baseItem,
      eventEndTime: "2026-05-10T12:05:00.000Z",
    },
    nowMs,
    30_000
  );

  assert.equal(decision, null);
});

test("forces HOLD when the market has already closed", () => {
  const decision = marketTimingGate(
    {
      ...baseItem,
      eventEndTime: "2026-05-10T11:59:59.000Z",
    },
    nowMs,
    30_000
  );

  assert.equal(decision?.action, "HOLD");
  assert.equal(decision?.approved, false);
  assert.deepEqual(decision?.riskFlags, ["market-expired"]);
});

test("forces HOLD when the market is inside the close buffer", () => {
  const decision = marketTimingGate(
    {
      ...baseItem,
      eventEndTime: "2026-05-10T12:00:10.000Z",
    },
    nowMs,
    30_000
  );

  assert.equal(decision?.action, "HOLD");
  assert.equal(decision?.approved, false);
  assert.deepEqual(decision?.riskFlags, ["market-close-buffer"]);
});

test("forces HOLD when the market end time is invalid", () => {
  const decision = marketTimingGate(
    {
      ...baseItem,
      eventEndTime: "not-a-date",
    },
    nowMs,
    30_000
  );

  assert.equal(decision?.action, "HOLD");
  assert.equal(decision?.approved, false);
  assert.deepEqual(decision?.riskFlags, ["invalid-market-end-time"]);
});

test("isExecutedFill treats FILLED and PARTIALLY_FILLED as executed", () => {
  assert.equal(isExecutedFill({ status: "FILLED" }), true);
  assert.equal(isExecutedFill({ status: "PARTIALLY_FILLED" }), true);
  assert.equal(isExecutedFill({ status: "BLOCKED" }), false);
});

test("settleSellFill closes the position on a full SELL fill", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "settle-full",
    tokenId: "token-settle-full",
    entryPrice: "0.40",
    shares: "10",
    entryNotionalUsd: "4.00",
    openedRunId: "run-open",
  });
  const result = await settleSellFill({
    repository: repo,
    position,
    fill: { status: "FILLED", shares: "10", side: "SELL" },
    exitPrice: "0.50",
    closeReason: "contradict-vote",
    runId: "run-close",
  });
  assert.equal(result?.status, "CLOSED");
  const lookup = await repo.getOpenPositionByWatchlistItem("settle-full");
  assert.equal(lookup, null);
});

test("settleSellFill reduces the position on a partial SELL fill and keeps it open", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "settle-partial",
    tokenId: "token-settle-partial",
    entryPrice: "0.40",
    shares: "10",
    entryNotionalUsd: "4.00",
    openedRunId: "run-open",
  });
  const result = await settleSellFill({
    repository: repo,
    position,
    fill: { status: "PARTIALLY_FILLED", shares: "4", side: "SELL" },
    exitPrice: "0.50",
    closeReason: "contradict-vote",
    runId: "run-reduce",
  });
  assert.equal(result?.status, "OPEN");
  assert.equal(result?.shares, "6");
  assert.equal(result?.realizedPnlUsd, "0.4");
  const lookup = await repo.getOpenPositionByWatchlistItem("settle-partial");
  assert.equal(lookup?.shares, "6");
});

test("settleSellFill leaves the position untouched on a blocked SELL fill", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "settle-blocked",
    tokenId: "token-settle-blocked",
    entryPrice: "0.40",
    shares: "10",
    entryNotionalUsd: "4.00",
    openedRunId: "run-open",
  });
  const result = await settleSellFill({
    repository: repo,
    position,
    fill: { status: "BLOCKED", shares: "0", side: "SELL" },
    exitPrice: "0.50",
    closeReason: "contradict-vote",
    runId: "run-noop",
  });
  assert.equal(result?.status, "OPEN");
  assert.equal(result?.shares, "10");
});
