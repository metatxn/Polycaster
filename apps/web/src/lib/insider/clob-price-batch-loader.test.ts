import type { ClobOrderBook } from "@knoww/shared-types/clob";
import { describe, expect, it, vi } from "vitest";
import {
  createClobPriceBatchLoader,
  midpointFromOrderBook,
  resolveReferencePrice,
} from "./clob-price-batch-loader";

function book(
  assetId: string,
  bids: Array<{ price: string; size: string }>,
  asks: Array<{ price: string; size: string }>
): ClobOrderBook {
  return { asset_id: assetId, bids, asks };
}

describe("midpointFromOrderBook", () => {
  it("uses the best bid and ask", () => {
    expect(
      midpointFromOrderBook(
        book(
          "token-a",
          [
            { price: "0.2", size: "1" },
            { price: "0.4", size: "1" },
          ],
          [
            { price: "0.8", size: "1" },
            { price: "0.6", size: "1" },
          ]
        )
      )
    ).toBe(0.5);
  });

  it("falls back for malformed or one-sided books", () => {
    const prices = new Map<string, number | null>([
      ["missing", null],
      ["malformed", midpointFromOrderBook(book("malformed", [], []))],
      [
        "one-sided",
        midpointFromOrderBook(
          book("one-sided", [{ price: "0.4", size: "1" }], [])
        ),
      ],
    ]);

    expect(resolveReferencePrice(prices, "missing", 0.31)).toBe(0.31);
    expect(resolveReferencePrice(prices, "malformed", 0.42)).toBe(0.42);
    expect(resolveReferencePrice(prices, "one-sided", 0.53)).toBe(0.53);
  });
});

describe("createClobPriceBatchLoader", () => {
  it("propagates an aggregate abort instead of caching fallback prices", async () => {
    const controller = new AbortController();
    const fetchOrderBooks = vi.fn(
      async (_ids: readonly string[], signal?: AbortSignal) => {
        expect(signal).toBe(controller.signal);
        throw new DOMException("Request timed out", "TimeoutError");
      }
    );
    const load = createClobPriceBatchLoader({ fetchOrderBooks });

    await expect(load(["token-a"], controller.signal)).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("deduplicates token ids and maps responses by asset_id", async () => {
    const fetchOrderBooks = vi.fn(async () => [
      book(
        "token-b",
        [{ price: "0.7", size: "1" }],
        [{ price: "0.9", size: "1" }]
      ),
      book(
        "token-a",
        [{ price: "0.1", size: "1" }],
        [{ price: "0.3", size: "1" }]
      ),
    ]);
    const load = createClobPriceBatchLoader({ fetchOrderBooks });

    const prices = await load(["token-a", "token-a", "token-b"]);

    expect(fetchOrderBooks).toHaveBeenCalledOnce();
    expect(fetchOrderBooks).toHaveBeenCalledWith(["token-a", "token-b"]);
    expect(prices).toEqual(
      new Map([
        ["token-a", 0.2],
        ["token-b", 0.8],
      ])
    );
  });

  it("serves cache hits until the ttl expires", async () => {
    let now = 1_000;
    const fetchOrderBooks = vi.fn(async () => [
      book(
        "token-a",
        [{ price: "0.2", size: "1" }],
        [{ price: "0.4", size: "1" }]
      ),
    ]);
    const load = createClobPriceBatchLoader({
      fetchOrderBooks,
      now: () => now,
      ttlMs: 30_000,
    });

    await load(["token-a"]);
    now = 30_999;
    await load(["token-a"]);
    expect(fetchOrderBooks).toHaveBeenCalledOnce();

    now = 31_000;
    await load(["token-a"]);
    expect(fetchOrderBooks).toHaveBeenCalledTimes(2);
  });

  it("bounds cache entries with least-recently-used eviction", async () => {
    const fetchOrderBooks = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) =>
        book(id, [{ price: "0.2", size: "1" }], [{ price: "0.4", size: "1" }])
      )
    );
    const load = createClobPriceBatchLoader({
      fetchOrderBooks,
      maxEntries: 2,
    });

    await load(["token-a", "token-b", "token-c"]);
    await load(["token-a"]);

    expect(fetchOrderBooks).toHaveBeenCalledTimes(2);
    expect(fetchOrderBooks).toHaveBeenLastCalledWith(["token-a"]);
  });

  it("uses conservative chunks for multiple batch requests", async () => {
    const fetchOrderBooks = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) =>
        book(id, [{ price: "0.2", size: "1" }], [{ price: "0.4", size: "1" }])
      )
    );
    const load = createClobPriceBatchLoader({
      fetchOrderBooks,
      batchSize: 2,
    });

    await load(["a", "b", "c", "d", "e"]);

    expect(fetchOrderBooks.mock.calls.map(([ids]) => ids)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });

  it("records missing and malformed responses as fallback values", async () => {
    const fetchOrderBooks = vi.fn(async () => [
      book(
        "malformed",
        [{ price: "not-a-price", size: "1" }],
        [{ price: "0.4", size: "1" }]
      ),
      book("one-sided", [{ price: "0.3", size: "1" }], []),
    ]);
    const load = createClobPriceBatchLoader({ fetchOrderBooks });

    const prices = await load(["missing", "malformed", "one-sided"]);

    expect(prices).toEqual(
      new Map([
        ["missing", null],
        ["malformed", null],
        ["one-sided", null],
      ])
    );
  });
});
