import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchClobBuilderFeeRates,
  fetchClobMarket,
  fetchClobMarketInfo,
  fetchClobOrderBook,
  fetchClobOrderBooks,
  fetchClobPrice,
  fetchClobPriceHistory,
} from "./clob.ts";

test("fetchClobOrderBook uses the unified SDK client for default-host order books", async () => {
  const calls = [];
  const orderBook = await fetchClobOrderBook("abc", {
    unifiedClient: {
      async fetchOrderBook(request) {
        calls.push(request);
        return {
          asset_id: "abc",
          bids: [{ price: 0.2, size: 3 }],
          asks: [{ price: "0.4", size: "5" }],
        };
      },
    },
  });

  assert.deepEqual(calls, [{ tokenId: "abc" }]);
  assert.deepEqual(orderBook.bids, [{ price: "0.2", size: "3" }]);
  assert.deepEqual(orderBook.asks, [{ price: "0.4", size: "5" }]);
});

test("fetchClobOrderBook preserves direct REST behavior for custom fetch implementations", async () => {
  const requested = [];
  const orderBook = await fetchClobOrderBook("abc", {
    host: "https://custom-clob.example",
    fetchImpl: async (url, init) => {
      requested.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            asset_id: "abc",
            bids: [{ price: "0.1", size: "2" }],
            asks: [],
          };
        },
      };
    },
  });

  assert.equal(
    requested[0]?.url,
    "https://custom-clob.example/book?token_id=abc"
  );
  assert.deepEqual(orderBook.bids, [{ price: "0.1", size: "2" }]);
});

test("fetchClobOrderBooks uses the unified SDK client for default-host batch order books", async () => {
  const calls = [];
  const orderBooks = await fetchClobOrderBooks(["yes", "no"], {
    unifiedClient: {
      async fetchOrderBooks(request) {
        calls.push(request);
        return [
          { tokenId: "yes", bids: [], asks: [] },
          { tokenId: "no", bids: [], asks: [{ price: "0.8", size: "4" }] },
        ];
      },
    },
  });

  assert.deepEqual(calls, [[{ tokenId: "yes" }, { tokenId: "no" }]]);
  assert.deepEqual(
    orderBooks.map((book) => book.asset_id),
    ["yes", "no"]
  );
});

test("fetchClobMarket preserves legacy direct REST behavior by default", async () => {
  const requested = [];
  const market = await fetchClobMarket("0xcondition", {
    fetchImpl: async (url) => {
      requested.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return { end_date_iso: "2026-01-01T00:00:00Z" };
        },
      };
    },
  });

  assert.deepEqual(requested, [
    "https://clob.polymarket.com/markets/0xcondition",
  ]);
  assert.deepEqual(market, { end_date_iso: "2026-01-01T00:00:00Z" });
});

test("fetchClobMarket does not use an injected unified client unless explicitly enabled", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    return {
      ok: true,
      status: 200,
      async json() {
        return { end_date_iso: "2026-01-01T00:00:00Z" };
      },
    };
  };

  try {
    const market = await fetchClobMarket("0xcondition", {
      unifiedClient: {
        async fetchOrderBook() {
          throw new Error("not used");
        },
        async fetchMarketInfo() {
          throw new Error("unified market info should be opt-in");
        },
      },
    });

    assert.deepEqual(requested, [
      "https://clob.polymarket.com/markets/0xcondition",
    ]);
    assert.deepEqual(market, { end_date_iso: "2026-01-01T00:00:00Z" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchClobMarket stays on /markets even when the unified SDK is enabled", async () => {
  // `fetchMarketInfo` reads `/clob-markets/{id}`, a different and much smaller
  // payload than `/markets/{id}`. Routing this call through the SDK would strip
  // every human-facing field (question, slug, images, tags, end date), so
  // `fetchClobMarket` has no unified branch by design.
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    return {
      ok: true,
      status: 200,
      async json() {
        return { end_date_iso: "2026-01-01T00:00:00Z" };
      },
    };
  };

  try {
    const market = await fetchClobMarket("0xcondition", {
      useUnifiedSdk: true,
      unifiedClient: {
        async fetchMarketInfo() {
          throw new Error("market records must not come from the SDK");
        },
      },
    });

    assert.deepEqual(requested, [
      "https://clob.polymarket.com/markets/0xcondition",
    ]);
    assert.deepEqual(market, { end_date_iso: "2026-01-01T00:00:00Z" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchClobMarketInfo uses the unified SDK market-info client when explicitly enabled", async () => {
  const calls = [];
  const info = await fetchClobMarketInfo("0xcondition", {
    useUnifiedSdk: true,
    unifiedClient: {
      async fetchMarketInfo(request) {
        calls.push(request);
        return { feeInfo: { rate: 1, exponent: 4 }, tokens: [] };
      },
    },
  });

  assert.deepEqual(calls, [{ conditionId: "0xcondition" }]);
  assert.deepEqual(info, { feeInfo: { rate: 1, exponent: 4 }, tokens: [] });
});

test("fetchClobMarketInfo reads /clob-markets on the raw REST path", async () => {
  // The `fd` protocol-fee curve only exists on this endpoint, which is why fee
  // estimation must not be pointed at `/markets/{id}`.
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    return {
      ok: true,
      status: 200,
      async json() {
        return { fd: { r: 0.04, e: 1 }, tbf: 1000 };
      },
    };
  };

  try {
    const info = await fetchClobMarketInfo("0xcondition", {
      useUnifiedSdk: false,
    });

    assert.deepEqual(requested, [
      "https://clob.polymarket.com/clob-markets/0xcondition",
    ]);
    assert.deepEqual(info, { fd: { r: 0.04, e: 1 }, tbf: 1000 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchClobPriceHistory uses the unified SDK client and keeps the existing history envelope", async () => {
  const calls = [];
  const history = await fetchClobPriceHistory(
    "123",
    { startTs: "1716000000", fidelity: "60" },
    {
      unifiedClient: {
        async fetchPriceHistory(request) {
          calls.push(request);
          return [{ t: 1716000000, p: 0.42 }];
        },
      },
    }
  );

  assert.deepEqual(calls, [
    { tokenId: "123", startTs: 1716000000, fidelity: 60 },
  ]);
  assert.deepEqual(history, { history: [{ t: 1716000000, p: 0.42 }] });
});

test("fetchClobBuilderFeeRates uses the unified SDK client for default-host reads", async () => {
  const calls = [];
  const rates = await fetchClobBuilderFeeRates("0xabc", {
    unifiedClient: {
      async fetchBuilderFeeRates(request) {
        calls.push(request);
        return { maker: 0.001, taker: 0.002 };
      },
    },
  });

  assert.deepEqual(calls, [{ builderCode: "0xabc" }]);
  assert.deepEqual(rates, { maker: 0.001, taker: 0.002 });
});

test("fetchClobBuilderFeeRates rejects malformed unified-client payloads", async () => {
  // A configured builder whose rates are unreadable must not normalize to a
  // fee-free { maker: 0, taker: 0 } — the throw lets the caller's fee
  // estimate fall back to the conservative reserve instead.
  const payloads = [
    null,
    "not-a-record",
    { maker: 0.001 },
    { maker: 0.001, taker: -0.002 },
    { maker: Number.NaN, taker: 0.002 },
    { maker: 0.001, taker: "0.002" },
  ];

  for (const payload of payloads) {
    await assert.rejects(
      fetchClobBuilderFeeRates("0xabc", {
        unifiedClient: {
          async fetchBuilderFeeRates() {
            return payload;
          },
        },
      }),
      /[Mm]alformed builder fee rate/,
      JSON.stringify(payload)
    );
  }
});

test("fetchClobBuilderFeeRates rejects malformed direct-endpoint bps", async () => {
  const responses = [
    { builder_maker_fee_rate_bps: 10, builder_taker_fee_rate_bps: -20 },
    { builder_taker_fee_rate_bps: Number.NaN },
  ];

  for (const body of responses) {
    await assert.rejects(
      fetchClobBuilderFeeRates("0xabc", {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => body,
        }),
      }),
      /Malformed builder fee rate/,
      JSON.stringify(body)
    );
  }
});

test("fetchClobBuilderFeeRates treats absent direct-endpoint bps as zero", async () => {
  // The REST endpoint omits zero-fee fields; absent is its spelling of zero,
  // unlike a present-but-invalid value.
  const rates = await fetchClobBuilderFeeRates("0xabc", {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ builder_taker_fee_rate_bps: 20 }),
    }),
  });

  assert.deepEqual(rates, { maker: 0, taker: 0.002 });
});

test("fetchClobPrice uses the unified SDK client only when a price side is supplied", async () => {
  const calls = [];
  const price = await fetchClobPrice("123", {
    priceSide: "SELL",
    unifiedClient: {
      async fetchPrice(request) {
        calls.push(request);
        return "0.48";
      },
    },
  });

  assert.deepEqual(calls, [{ tokenId: "123", side: "SELL" }]);
  assert.equal(price, "0.48");
});

test("fetchClobPrice preserves direct REST behavior when no price side is supplied", async () => {
  const requested = [];
  const price = await fetchClobPrice("123", {
    fetchImpl: async (url) => {
      requested.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return { price: "0.5" };
        },
      };
    },
  });

  assert.deepEqual(requested, [
    "https://clob.polymarket.com/price?token_id=123",
  ]);
  assert.deepEqual(price, { price: "0.5" });
});
