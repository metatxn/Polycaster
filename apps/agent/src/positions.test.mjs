import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRepository } from "./repository.ts";

test("openPosition creates an OPEN row with audit fields", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "watch-1",
    tokenId: "token-1",
    entryPrice: "0.60",
    shares: "10",
    entryNotionalUsd: "6.00",
    openedRunId: "run-1",
  });
  assert.equal(position.status, "OPEN");
  assert.equal(position.side, "BUY");
  assert.equal(position.entryPrice, "0.60");
  assert.equal(position.shares, "10");
  assert.equal(position.openedRunId, "run-1");
  assert.equal(position.realizedPnlUsd, null);
});

test("getOpenPositionByWatchlistItem returns the latest open row", async () => {
  const repo = createAgentRepository();
  const watchlistId = `watch-${crypto.randomUUID()}`;
  const opened = await repo.openPosition({
    watchlistItemId: watchlistId,
    tokenId: "token-2",
    entryPrice: "0.40",
    shares: "5",
    entryNotionalUsd: "2.00",
    openedRunId: null,
  });
  const lookup = await repo.getOpenPositionByWatchlistItem(watchlistId);
  assert.equal(lookup?.id, opened.id);
});

test("closePosition computes realized P&L for a winning long", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "watch-win",
    tokenId: "token-win",
    entryPrice: "0.60",
    shares: "10",
    entryNotionalUsd: "6.00",
    openedRunId: null,
  });
  const closed = await repo.closePosition(position.id, {
    exitPrice: "1",
    closeReason: "resolution",
    closedRunId: null,
  });
  // 10 shares bought at 0.60, settled at 1.00 → P&L = 10 * (1 - 0.6) = 4.00
  assert.equal(closed?.status, "CLOSED");
  assert.equal(closed?.exitPrice, "1");
  assert.equal(closed?.realizedPnlUsd, "4");
  assert.equal(closed?.closeReason, "resolution");
});

test("closePosition computes realized P&L for a losing long", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "watch-loss",
    tokenId: "token-loss",
    entryPrice: "0.60",
    shares: "10",
    entryNotionalUsd: "6.00",
    openedRunId: null,
  });
  const closed = await repo.closePosition(position.id, {
    exitPrice: "0",
    closeReason: "resolution",
    closedRunId: null,
  });
  // 10 shares bought at 0.60, settled at 0 → P&L = 10 * (0 - 0.6) = -6.00
  assert.equal(closed?.realizedPnlUsd, "-6");
});

test("closePosition on a contradicting vote uses mid-price", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "watch-flip",
    tokenId: "token-flip",
    entryPrice: "0.60",
    shares: "10",
    entryNotionalUsd: "6.00",
    openedRunId: null,
  });
  const closed = await repo.closePosition(position.id, {
    exitPrice: "0.55",
    closeReason: "contradict-vote",
    closedRunId: "run-X",
  });
  // 10 * (0.55 - 0.60) = -0.5
  assert.equal(closed?.realizedPnlUsd, "-0.5");
  assert.equal(closed?.closeReason, "contradict-vote");
  assert.equal(closed?.closedRunId, "run-X");
});

test("closePosition is idempotent on an already-closed row", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "watch-idem",
    tokenId: "token-idem",
    entryPrice: "0.50",
    shares: "4",
    entryNotionalUsd: "2.00",
    openedRunId: null,
  });
  await repo.closePosition(position.id, {
    exitPrice: "1",
    closeReason: "resolution",
    closedRunId: null,
  });
  const second = await repo.closePosition(position.id, {
    exitPrice: "0",
    closeReason: "manual",
    closedRunId: null,
  });
  assert.equal(second?.exitPrice, "1");
  assert.equal(second?.closeReason, "resolution");
});

test("listOpenPositionsByToken excludes closed positions", async () => {
  const repo = createAgentRepository();
  const a = await repo.openPosition({
    watchlistItemId: "watch-a",
    tokenId: "token-shared",
    entryPrice: "0.30",
    shares: "1",
    entryNotionalUsd: "0.30",
    openedRunId: null,
  });
  await repo.openPosition({
    watchlistItemId: "watch-b",
    tokenId: "token-shared",
    entryPrice: "0.40",
    shares: "2",
    entryNotionalUsd: "0.80",
    openedRunId: null,
  });
  await repo.closePosition(a.id, {
    exitPrice: "0.5",
    closeReason: "manual",
    closedRunId: null,
  });
  const open = await repo.listOpenPositionsByToken("token-shared");
  assert.equal(open.length, 1);
  assert.equal(open[0].watchlistItemId, "watch-b");
});

test("getPortfolioPnl aggregates realized + open notional", async () => {
  // Measure deltas so we don't depend on absolute totals from prior tests
  // sharing the module-level memory repo.
  const repo = createAgentRepository();
  const before = await repo.getPortfolioPnl();
  const winner = await repo.openPosition({
    watchlistItemId: "watch-pnl-1",
    tokenId: "token-pnl-1",
    entryPrice: "0.50",
    shares: "10",
    entryNotionalUsd: "5.00",
    openedRunId: null,
  });
  await repo.closePosition(winner.id, {
    exitPrice: "1",
    closeReason: "resolution",
    closedRunId: null,
  });
  await repo.openPosition({
    watchlistItemId: "watch-pnl-2",
    tokenId: "token-pnl-2",
    entryPrice: "0.30",
    shares: "5",
    entryNotionalUsd: "1.50",
    openedRunId: null,
  });
  const after = await repo.getPortfolioPnl();
  assert.equal(after.openPositionCount, before.openPositionCount + 1);
  assert.equal(after.closedPositionCount, before.closedPositionCount + 1);
  // Realized delta from winner = 10 * (1 - 0.5) = 5
  const realizedDelta =
    Number.parseFloat(after.realizedPnlUsd) -
    Number.parseFloat(before.realizedPnlUsd);
  assert.equal(realizedDelta.toFixed(2), "5.00");
  // Open entry notional delta = +1.50
  const openDelta =
    Number.parseFloat(after.openEntryNotionalUsd) -
    Number.parseFloat(before.openEntryNotionalUsd);
  assert.equal(openDelta.toFixed(2), "1.50");
});

test("reducePosition books realized P&L on the sold shares and keeps the remainder open", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "watch-reduce-open",
    tokenId: "token-reduce-open",
    entryPrice: "0.40",
    shares: "10",
    entryNotionalUsd: "4.00",
    openedRunId: "run-open",
  });
  const reduced = await repo.reducePosition(position.id, {
    soldShares: "4",
    exitPrice: "0.50",
    closeReason: "contradict-vote",
    closedRunId: "run-reduce",
  });
  // Sold 4 of 10 shares at 0.50, cost basis 0.40 → realized = 4 * 0.10 = 0.4
  assert.equal(reduced?.status, "OPEN");
  assert.equal(reduced?.shares, "6");
  assert.equal(reduced?.entryNotionalUsd, "2.4");
  assert.equal(reduced?.realizedPnlUsd, "0.4");
  // The residual is still discoverable as an open position.
  const lookup = await repo.getOpenPositionByWatchlistItem("watch-reduce-open");
  assert.equal(lookup?.id, position.id);
  assert.equal(lookup?.shares, "6");
});

test("reducePosition that sells the whole remainder closes the position", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "watch-reduce-full",
    tokenId: "token-reduce-full",
    entryPrice: "0.40",
    shares: "10",
    entryNotionalUsd: "4.00",
    openedRunId: "run-open",
  });
  const closed = await repo.reducePosition(position.id, {
    soldShares: "10",
    exitPrice: "0.50",
    closeReason: "time-exit",
    closedRunId: "run-reduce",
  });
  assert.equal(closed?.status, "CLOSED");
  // 10 * (0.50 - 0.40) = 1.0
  assert.equal(closed?.realizedPnlUsd, "1");
  assert.equal(closed?.closeReason, "time-exit");
});

test("closePosition accumulates realized P&L from a prior partial reduction", async () => {
  const repo = createAgentRepository();
  const position = await repo.openPosition({
    watchlistItemId: "watch-reduce-then-close",
    tokenId: "token-reduce-then-close",
    entryPrice: "0.40",
    shares: "10",
    entryNotionalUsd: "4.00",
    openedRunId: "run-open",
  });
  await repo.reducePosition(position.id, {
    soldShares: "4",
    exitPrice: "0.50",
    closeReason: "contradict-vote",
    closedRunId: "run-reduce",
  });
  const closed = await repo.closePosition(position.id, {
    exitPrice: "0.60",
    closeReason: "contradict-vote",
    closedRunId: "run-close",
  });
  // Partial tranche: 4 * (0.50 - 0.40) = 0.4
  // Final tranche: 6 * (0.60 - 0.40) = 1.2
  // Accumulated realized = 1.6
  assert.equal(closed?.status, "CLOSED");
  assert.equal(closed?.realizedPnlUsd, "1.6");
});

test("getPortfolioPnl counts realized P&L from partial reductions on still-open positions", async () => {
  const repo = createAgentRepository();
  const before = await repo.getPortfolioPnl();
  const position = await repo.openPosition({
    watchlistItemId: "watch-reduce-pnl",
    tokenId: "token-reduce-pnl",
    entryPrice: "0.40",
    shares: "10",
    entryNotionalUsd: "4.00",
    openedRunId: null,
  });
  await repo.reducePosition(position.id, {
    soldShares: "4",
    exitPrice: "0.50",
    closeReason: "contradict-vote",
    closedRunId: null,
  });
  const after = await repo.getPortfolioPnl();
  // The position is still open, but its 0.4 realized tranche must be counted.
  const realizedDelta =
    Number.parseFloat(after.realizedPnlUsd) -
    Number.parseFloat(before.realizedPnlUsd);
  assert.equal(realizedDelta.toFixed(2), "0.40");
  assert.equal(after.openPositionCount, before.openPositionCount + 1);
});
