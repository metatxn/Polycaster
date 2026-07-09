import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrderBookStore } from "./use-orderbook-store";

function bookEvent(assetId: string, bid: string, ask: string) {
  return {
    event_type: "book" as const,
    asset_id: assetId,
    market: "market-1",
    bids: [{ price: bid, size: "10" }],
    asks: [{ price: ask, size: "10" }],
    timestamp: String(Date.now()),
    hash: `${assetId}-${bid}-${ask}`,
  };
}

describe("useOrderBookStore price history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useOrderBookStore.getState().clearAllOrderBooks();
  });

  afterEach(() => {
    useOrderBookStore.getState().clearAllOrderBooks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reads interpolated prices without sorting history on every lookup", () => {
    const assetId = "token-1";

    vi.setSystemTime(1000);
    useOrderBookStore
      .getState()
      .handleBookEvent(bookEvent(assetId, "0.40", "0.60"));

    vi.setSystemTime(2000);
    useOrderBookStore
      .getState()
      .handleBookEvent(bookEvent(assetId, "0.60", "0.80"));

    const sortSpy = vi.spyOn(Array.prototype, "sort");

    expect(useOrderBookStore.getState().getPriceAt(assetId, 1500)).toBe(0.6);
    expect(sortSpy).not.toHaveBeenCalled();

    sortSpy.mockRestore();
  });
});

describe("useOrderBookStore market metadata", () => {
  beforeEach(() => {
    useOrderBookStore.getState().clearAllOrderBooks();
  });

  afterEach(() => {
    useOrderBookStore.getState().clearAllOrderBooks();
  });

  it("preserves REST tick metadata for 0.25 cent World Cup markets", () => {
    useOrderBookStore
      .getState()
      .setOrderBookFromRest(
        "world-cup-token",
        [{ price: "0.4350", size: "20" }],
        [{ price: "0.4375", size: "20" }],
        {
          tickSize: "0.0025",
          minOrderSize: "5",
        }
      );

    const orderBook = useOrderBookStore
      .getState()
      .getOrderBook("world-cup-token");

    expect(orderBook?.tickSize).toBe(0.0025);
    expect(orderBook?.minOrderSize).toBe(5);
  });

  it("updates tick metadata from websocket tick size changes", () => {
    useOrderBookStore
      .getState()
      .setOrderBookFromRest(
        "token-with-tick-change",
        [{ price: "0.04", size: "20" }],
        [{ price: "0.05", size: "20" }],
        {
          tickSize: "0.01",
        }
      );

    useOrderBookStore.getState().handleTickSizeChangeEvent({
      event_type: "tick_size_change",
      asset_id: "token-with-tick-change",
      market: "market-1",
      old_tick_size: "0.01",
      new_tick_size: "0.0025",
      side: "SELL",
      timestamp: String(Date.now()),
    });

    expect(
      useOrderBookStore.getState().getOrderBook("token-with-tick-change")
        ?.tickSize
    ).toBe(0.0025);
  });
});
