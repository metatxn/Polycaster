import assert from "node:assert/strict";
import test from "node:test";
import { marketTimingGate } from "./run.ts";

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
