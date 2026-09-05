import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => vi.fn());
const optedOut = vi.hoisted(() => vi.fn(() => false));
const journey = vi.hoisted(() =>
  vi.fn<() => Record<string, string>>(() => ({}))
);
vi.mock("./journey-attribution", () => ({ currentJourneyProperties: journey }));
vi.mock("posthog-js", () => ({
  default: { capture, has_opted_out_capturing: optedOut },
}));

import { pollConfirmedOrders, rememberAcceptedOrder } from "./order-analytics";

const wallet = "0x0000000000000000000000000000000000000001";
const reader = {
  fetchOrder: async () => ({
    id: "order-1",
    originalSize: "2",
    associateTrades: ["trade-1"],
  }),
  fetchTrade: async () => ({
    id: "trade-1",
    takerOrderId: "order-1",
    size: "2",
    price: "0.3",
    status: "CONFIRMED",
    transactionHash: "0xtransaction",
  }),
};
describe("web order telemetry", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    capture.mockClear();
    optedOut.mockReturnValue(false);
    journey.mockReturnValue({});
  });
  it("keeps the acceptance handoff when a delayed fill follows a different handoff", async () => {
    journey.mockReturnValue({
      handoff_id: "first-handoff",
      entry_source: "knoww_extension",
    });
    await rememberAcceptedOrder({ orderId: "order-1" }, wallet, {
      side: "BUY",
    });
    journey.mockReturnValue({
      handoff_id: "second-handoff",
      entry_source: "knoww_extension",
    });
    await pollConfirmedOrders(wallet, reader);
    expect(capture).toHaveBeenCalledWith(
      "order_succeeded",
      expect.objectContaining({
        handoff_id: "first-handoff",
        order_id: "order-1",
      }),
      expect.anything()
    );
  });
  it("separates acceptance from a confirmed sell and preserves the submitting wallet", async () => {
    await rememberAcceptedOrder({ orderId: "order-1" }, wallet, {
      side: "SELL",
      order_type: "LIMIT",
    });
    expect(capture.mock.calls.map((call) => call[0])).toEqual([
      "order_accepted",
    ]);
    await pollConfirmedOrders(wallet, reader);
    expect(capture).toHaveBeenCalledWith(
      "sell_succeeded",
      expect.objectContaining({
        distinct_id: wallet,
        wallet_address: wallet,
        filled_value: 0.6,
        order_id: "order-1",
        analytics_version: 2,
      }),
      {
        uuid: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        ),
      }
    );
    await pollConfirmedOrders(wallet, reader);
    expect(
      capture.mock.calls.filter((call) => call[0] === "sell_succeeded")
    ).toHaveLength(1);
  });
  it("does not collect pending orders after analytics opt-out", async () => {
    optedOut.mockReturnValue(true);
    await rememberAcceptedOrder({ orderId: "order-1" }, wallet, {
      side: "BUY",
    });
    await pollConfirmedOrders(wallet, reader);
    expect(capture).not.toHaveBeenCalled();
    expect(localStorage.getItem("knoww_order_analytics_v2")).toBeNull();
  });
  it("never turns a storage failure into a failed trade", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage unavailable");
      },
    });
    await expect(
      rememberAcceptedOrder({ orderId: "order-1" }, wallet, { side: "BUY" })
    ).resolves.toBeUndefined();
    await expect(pollConfirmedOrders(wallet, reader)).resolves.toBeUndefined();
  });
});
