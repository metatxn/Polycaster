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
