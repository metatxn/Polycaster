import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptedOrderId,
  analyticsEventUuid,
  assertOrderCancelled,
  createOrderAnalyticsTracker,
  reconcileOrderFills,
} from "./product-analytics.ts";

const initial = () => ({
  orderId: "o1",
  walletAddress: "wallet1",
  createdAt: Date.now(),
  properties: { side: "SELL" },
  fills: {},
  failedTrades: [],
});
const order = { id: "o1", originalSize: "3", associateTrades: ["t1"] };
const trade = {
  id: "t1",
  takerOrderId: "o1",
  size: "3",
  price: "0.1",
  status: "CONFIRMED",
  transactionHash: "0xtransaction",
};

test("retry identifiers produce a stable event UUID without colliding across wallets or events", () => {
  const first = analyticsEventUuid("order_succeeded", "wallet1", "order-1");
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.equal(
    first,
    analyticsEventUuid("order_succeeded", "wallet1", "order-1")
  );
  assert.notEqual(
    first,
    analyticsEventUuid("sell_succeeded", "wallet1", "order-1")
  );
  assert.notEqual(
    first,
    analyticsEventUuid("order_succeeded", "wallet2", "order-1")
  );
});

test("acceptance and cancellation require an exchange acknowledgement", () => {
  assert.equal(acceptedOrderId({ ok: true, orderId: "o1" }), "o1");
  assert.equal(acceptedOrderId({ status: "matched" }), null);
  assert.equal(acceptedOrderId({ success: false, orderId: "o1" }), null);
  assert.throws(() =>
    assertOrderCancelled({ notCanceled: { o1: "refused" } }, "o1")
  );
  assert.throws(() => assertOrderCancelled({ canceled: ["other"] }, "o1"));
  assert.doesNotThrow(() => assertOrderCancelled({ canceled: ["o1"] }, "o1"));
});

test("acceptance, matched trades, and unrelated trades are not confirmed fills", () => {
  for (const candidate of [
    { ...trade, status: "MATCHED" },
    { ...trade, transactionHash: "" },
    { ...trade, takerOrderId: "other" },
  ]) {
    assert.deepEqual(
      reconcileOrderFills(initial(), order, [candidate]).events,
      []
    );
  }
});

test("a full confirmed sell emits one success and exact decimal value", () => {
  const result = reconcileOrderFills(initial(), order, [trade]);
  assert.equal(result.state.fills.t1.value, "0.3");
  assert.deepEqual(
    result.events.map((e) => e.event),
    [
      "trade_fill_confirmed",
      "order_filled",
      "order_succeeded",
      "sell_succeeded",
    ]
  );
  assert.deepEqual(
    reconcileOrderFills(result.state, order, [trade]).events,
    []
  );
});

test("maker partial fills count only this order's shares, then complete once", () => {
  const partial = {
    ...trade,
    takerOrderId: "other",
    size: "100",
    makerOrders: [{ orderId: "o1", matchedAmount: "1", price: "0.2" }],
  };
  const first = reconcileOrderFills(initial(), order, [partial]);
  assert.equal(first.state.fills.t1.value, "0.2");
  assert.equal(first.events.at(-1).event, "order_partially_filled");
  const second = reconcileOrderFills(first.state, order, [
    { ...trade, id: "t2", size: "2" },
  ]);
  assert.equal(
    second.events.find((e) => e.event === "order_succeeded").properties
      .filled_value,
    0.4
  );
});

test("failed trades emit failure once without contributing volume", () => {
  const failed = { ...trade, status: "FAILED" };
  const result = reconcileOrderFills(initial(), order, [failed]);
  assert.deepEqual(
    result.events.map((e) => e.event),
    ["trade_fill_failed"]
  );
  assert.deepEqual(
    reconcileOrderFills(result.state, order, [failed]).events,
    []
  );
});

test("timeouts stay pending and a later poll resumes without resubmitting", async () => {
  let saved = [];
  const events = [];
  const tracker = createOrderAnalyticsTracker({
    load: async () => structuredClone(saved),
    save: async (orders) => {
      saved = structuredClone(orders);
    },
    capture: async (event) => {
      events.push(event.event);
    },
  });
  await tracker.remember({ orderId: "o1" }, "wallet1", { side: "SELL" });
  await tracker.poll("wallet1", {
    fetchOrder: async () => {
      throw Error("timeout");
    },
    fetchTrade: async () => trade,
  });
  assert.deepEqual(events, ["order_accepted"]);
  assert.equal(saved[0].complete, undefined);
  await tracker.poll("wallet1", {
    fetchOrder: async () => order,
    fetchTrade: async () => trade,
  });
  await tracker.poll("wallet1", {
    fetchOrder: async () => order,
    fetchTrade: async () => trade,
  });
  assert.equal(events.filter((e) => e === "sell_succeeded").length, 1);
});
