import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptUnifiedSecureClientForLegacyClob,
  createUnifiedPolymarketCredentialsOnlySigner,
  createUnifiedPolymarketSecureClient,
  createUnifiedPolymarketViemSigner,
  fetchUnifiedClobBuilderFeeRates,
  fetchUnifiedClobMarket,
  fetchUnifiedClobOrderBook,
  fetchUnifiedClobOrderBooks,
  fetchUnifiedClobPrice,
  fetchUnifiedClobPriceHistory,
} from "./polymarket-unified.ts";

test("createUnifiedPolymarketViemSigner adapts wallet client signing methods", async () => {
  const account = "0x0000000000000000000000000000000000000001";
  const calls = [];
  const walletClient = {
    account,
    chain: { id: 137 },
    async getChainId() {
      return 137;
    },
    async signMessage(args) {
      calls.push(["signMessage", args]);
      return "0xmessage";
    },
    async signTypedData(args) {
      calls.push(["signTypedData", args]);
      return "0xtyped";
    },
    async sendTransaction(args) {
      calls.push(["sendTransaction", args]);
      return "0xtransaction";
    },
  };

  const signer = createUnifiedPolymarketViemSigner(walletClient);

  assert.equal(await signer.getAddress(), account);
  assert.equal(await signer.signMessage("0x1234"), "0xmessage");
  assert.equal(
    await signer.signTypedData({
      domain: {},
      message: { value: "1" },
      primaryType: "Order",
      types: { Order: [{ name: "value", type: "string" }] },
    }),
    "0xtyped"
  );

  const transaction = await signer.sendTransaction({
    chainId: 137,
    data: "0x",
    to: account,
    value: 1n,
  });

  assert.equal(transaction.transactionHash, "0xtransaction");
  assert.equal(transaction.transactionId, null);
  assert.deepEqual(calls, [
    ["signMessage", { account, message: { raw: "0x1234" } }],
    [
      "signTypedData",
      {
        account,
        domain: {},
        message: { value: "1" },
        primaryType: "Order",
        types: { Order: [{ name: "value", type: "string" }] },
      },
    ],
    ["sendTransaction", { account, data: "0x", to: account, value: 1n }],
  ]);
});

test("fetchUnifiedClobOrderBook maps SDK orderbook responses to the existing app shape", async () => {
  const calls = [];
  const orderBook = await fetchUnifiedClobOrderBook("123", {
    client: {
      async fetchOrderBook(request) {
        calls.push(request);
        return {
          market: "0xabc",
          asset_id: "123",
          hash: "book-hash",
          timestamp: 1_716_000_000,
          bids: [
            { price: 0.41, size: "5.5" },
            { price: null, size: "ignored" },
          ],
          asks: [{ price: "0.43", size: 7 }],
          min_order_size: 1,
          tick_size: "0.01",
          spread: "0.02",
          midpoint: "0.42",
        };
      },
    },
  });

  assert.deepEqual(calls, [{ tokenId: "123" }]);
  assert.deepEqual(orderBook, {
    market: "0xabc",
    asset_id: "123",
    hash: "book-hash",
    timestamp: "1716000000",
    bids: [{ price: "0.41", size: "5.5" }],
    asks: [{ price: "0.43", size: "7" }],
    min_order_size: "1",
    tick_size: "0.01",
    spread: 0.02,
    midpoint: 0.42,
  });
});

test("fetchUnifiedClobOrderBook maps SDK camelCase orderbook fields to the existing app shape", async () => {
  const orderBook = await fetchUnifiedClobOrderBook("123", {
    client: {
      async fetchOrderBook() {
        return {
          market: "0xabc",
          tokenId: "123",
          hash: "book-hash",
          timestamp: "1716000000",
          bids: [{ price: "0.41", size: "5.5" }],
          asks: [{ price: "0.43", size: "7" }],
          minOrderSize: "1",
          tickSize: "0.01",
          spread: "0.02",
          midpoint: "0.42",
        };
      },
    },
  });

  assert.equal(orderBook.asset_id, "123");
  assert.equal(orderBook.min_order_size, "1");
  assert.equal(orderBook.tick_size, "0.01");
});

test("fetchUnifiedClobOrderBooks maps batch requests through the SDK", async () => {
  const calls = [];
  const books = await fetchUnifiedClobOrderBooks(["yes", "no"], {
    client: {
      async fetchOrderBooks(request) {
        calls.push(request);
        return [
          { tokenId: "yes", bids: [], asks: [] },
          { tokenId: "no", bids: [{ price: "0.2", size: "3" }], asks: [] },
        ];
      },
    },
  });

  assert.deepEqual(calls, [[{ tokenId: "yes" }, { tokenId: "no" }]]);
  assert.deepEqual(
    books.map((book) => book.asset_id),
    ["yes", "no"]
  );
});

test("fetchUnifiedClobMarket calls SDK market-info by condition id", async () => {
  const calls = [];
  const market = await fetchUnifiedClobMarket("0xcondition", {
    client: {
      async fetchMarketInfo(request) {
        calls.push(request);
        return { feeInfo: { rate: 0, exponent: 0 }, tokens: [] };
      },
    },
  });

  assert.deepEqual(calls, [{ conditionId: "0xcondition" }]);
  assert.deepEqual(market, { feeInfo: { rate: 0, exponent: 0 }, tokens: [] });
});

test("fetchUnifiedClobPriceHistory wraps SDK history arrays in the existing response envelope", async () => {
  const calls = [];
  const history = await fetchUnifiedClobPriceHistory(
    "123",
    { startTs: "1716000000", endTs: 1716000600, fidelity: "60" },
    {
      client: {
        async fetchPriceHistory(request) {
          calls.push(request);
          return [{ t: 1716000000, p: 0.42 }];
        },
      },
    }
  );

  assert.deepEqual(calls, [
    {
      tokenId: "123",
      startTs: 1716000000,
      endTs: 1716000600,
      fidelity: 60,
    },
  ]);
  assert.deepEqual(history, { history: [{ t: 1716000000, p: 0.42 }] });
});

test("fetchUnifiedClobBuilderFeeRates returns SDK-normalized maker and taker rates", async () => {
  const calls = [];
  const rates = await fetchUnifiedClobBuilderFeeRates("0xabc", {
    client: {
      async fetchBuilderFeeRates(request) {
        calls.push(request);
        return { maker: 0.001, taker: 0.002 };
      },
    },
  });

  assert.deepEqual(calls, [{ builderCode: "0xabc" }]);
  assert.deepEqual(rates, { maker: 0.001, taker: 0.002 });
});

test("fetchUnifiedClobBuilderFeeRates rejects malformed SDK payloads", async () => {
  // Malformed rates must not normalize to a fee-free quote for a configured
  // builder — fail closed so the caller's estimate falls back to the reserve.
  const payloads = [
    null,
    { maker: 0.001 },
    { maker: 0.001, taker: -0.002 },
    { maker: Number.NaN, taker: 0.002 },
    { maker: "0.001", taker: 0.002 },
  ];

  for (const payload of payloads) {
    await assert.rejects(
      fetchUnifiedClobBuilderFeeRates("0xabc", {
        client: {
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

test("fetchUnifiedClobPrice calls SDK price by token and side", async () => {
  const calls = [];
  const price = await fetchUnifiedClobPrice("123", "BUY", {
    client: {
      async fetchPrice(request) {
        calls.push(request);
        return "0.52";
      },
    },
  });

  assert.deepEqual(calls, [{ tokenId: "123", side: "BUY" }]);
  assert.equal(price, "0.52");
});

test("createUnifiedPolymarketSecureClient maps app credentials to SDK credentials", async () => {
  const calls = [];
  const client = await createUnifiedPolymarketSecureClient({
    signer: { kind: "signer" },
    wallet: "0xwallet",
    credentials: {
      apiKey: "key",
      apiSecret: "secret",
      apiPassphrase: "passphrase",
    },
    createSecureClientImpl: async (options) => {
      calls.push(options);
      return {
        credentials: {
          key: "key",
          secret: "secret",
          passphrase: "passphrase",
        },
      };
    },
  });

  assert.deepEqual(calls, [
    {
      signer: { kind: "signer" },
      wallet: "0xwallet",
      credentials: {
        key: "key",
        secret: "secret",
        passphrase: "passphrase",
      },
    },
  ]);
  assert.deepEqual(client.appCredentials, {
    apiKey: "key",
    apiSecret: "secret",
    apiPassphrase: "passphrase",
  });
});

test("createUnifiedPolymarketSecureClient can block fresh auth when reusing credentials", async () => {
  const calls = [];
  const signer = createUnifiedPolymarketCredentialsOnlySigner("0xwallet");

  await assert.rejects(
    createUnifiedPolymarketSecureClient({
      signer,
      wallet: "0xwallet",
      credentials: {
        apiKey: "key",
        apiSecret: "secret",
        apiPassphrase: "passphrase",
      },
      allowFreshAuthentication: false,
      createSecureClientImpl: async (options) => {
        calls.push(options);
        assert.equal(await options.signer.getAddress(), "0xwallet");
        await options.signer.signTypedData({ primaryType: "ClobAuth" });
      },
    }),
    {
      name: "PolymarketFreshAuthenticationRequiredError",
    }
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].credentials, {
    key: "key",
    secret: "secret",
    passphrase: "passphrase",
  });
});

test("createUnifiedPolymarketSecureClient can authenticate without existing credentials", async () => {
  const calls = [];
  const client = await createUnifiedPolymarketSecureClient({
    signer: { kind: "signer" },
    nonce: 7,
    createSecureClientImpl: async (options) => {
      calls.push(options);
      return {
        credentials: {
          key: "created-key",
          secret: "created-secret",
          passphrase: "created-passphrase",
        },
      };
    },
  });

  assert.deepEqual(calls, [{ signer: { kind: "signer" }, nonce: 7 }]);
  assert.deepEqual(client.appCredentials, {
    apiKey: "created-key",
    apiSecret: "created-secret",
    apiPassphrase: "created-passphrase",
  });
});

test("adaptUnifiedSecureClientForLegacyClob maps legacy market-order requests to unified SDK requests", async () => {
  const calls = [];
  const client = adaptUnifiedSecureClientForLegacyClob({
    async createMarketOrder(request) {
      calls.push(["createMarketOrder", request]);
      return { signed: request };
    },
    async postOrder(order) {
      calls.push(["postOrder", order]);
      return { success: true };
    },
  });

  const signedBuy = await client.createMarketOrder({
    tokenId: "yes-token",
    amount: 12.5,
    side: "BUY",
    price: 0.56,
    maxSpend: 12.5,
    orderType: "FOK",
  });
  const signedSell = await client.createMarketOrder({
    tokenId: "no-token",
    amount: 4,
    side: "SELL",
    price: 0.44,
    orderType: "FAK",
  });
  const posted = await client.postOrder(signedBuy, "FOK");

  assert.deepEqual(calls, [
    [
      "createMarketOrder",
      {
        tokenId: "yes-token",
        amount: 12.5,
        side: "BUY",
        maxSpend: 12.5,
        maxPrice: 0.56,
        orderType: "FOK",
      },
    ],
    [
      "createMarketOrder",
      {
        tokenId: "no-token",
        shares: 4,
        side: "SELL",
        minPrice: 0.44,
        orderType: "FAK",
      },
    ],
    ["postOrder", signedBuy],
  ]);
  assert.deepEqual(signedSell, {
    signed: {
      tokenId: "no-token",
      shares: 4,
      side: "SELL",
      minPrice: 0.44,
      orderType: "FAK",
    },
  });
  assert.deepEqual(posted, { success: true });
});

test("adaptUnifiedSecureClientForLegacyClob drops unusable market-order price bounds", async () => {
  const calls = [];
  const client = adaptUnifiedSecureClientForLegacyClob({
    async createMarketOrder(request) {
      calls.push(request);
      return { signed: request };
    },
    async postOrder() {
      return { success: true };
    },
  });

  // Callers that cannot compute a bound send 0; signing "never fill above
  // zero" would guarantee a no-fill, so the key must be omitted entirely.
  await client.createMarketOrder({
    tokenId: "yes-token",
    amount: 5,
    side: "BUY",
    price: 0,
  });

  assert.deepEqual(calls, [{ tokenId: "yes-token", amount: 5, side: "BUY" }]);
});

test("adaptUnifiedSecureClientForLegacyClob refuses order types that lose fill intent", async () => {
  const client = adaptUnifiedSecureClientForLegacyClob({
    async createMarketOrder(request) {
      return { ...request, orderType: request.orderType ?? "FAK" };
    },
    async createLimitOrder(request) {
      return { ...request, orderType: request.expiration ? "GTD" : "GTC" };
    },
    async postOrder(order) {
      return { success: true, order };
    },
  });

  // A limit order can only rest as GTC/GTD, so a FOK request must fail loudly
  // rather than silently become a resting order.
  await assert.rejects(
    client.createOrder({
      tokenId: "yes-token",
      price: 0.5,
      size: 10,
      side: "BUY",
      orderType: "FOK",
    }),
    /cannot be FOK/
  );

  await assert.rejects(
    client.createMarketOrder({
      tokenId: "yes-token",
      amount: 10,
      side: "BUY",
      orderType: "GTC",
    }),
    /cannot be GTC/
  );

  // postOrder no longer carries the order type, so a caller that passes one
  // must agree with what the order was actually signed as.
  const resting = await client.createOrder({
    tokenId: "yes-token",
    price: 0.5,
    size: 10,
    side: "BUY",
  });
  await assert.rejects(
    client.postOrder(resting, "FOK"),
    /created as GTC but posted as FOK/
  );
  assert.deepEqual(await client.postOrder(resting, "GTC"), {
    success: true,
    order: resting,
  });
});

test("adaptUnifiedSecureClientForLegacyClob maps legacy limit-order and account requests", async () => {
  const calls = [];
  const client = adaptUnifiedSecureClientForLegacyClob({
    async createLimitOrder(request) {
      calls.push(["createLimitOrder", request]);
      return { signed: request };
    },
    listOpenOrders() {
      calls.push(["listOpenOrders"]);
      return {
        async firstPage() {
          return {
            items: [{ id: "order-1" }],
            nextCursor: "next",
          };
        },
        from(cursor) {
          return {
            async *[Symbol.asyncIterator]() {
              calls.push(["listOpenOrders.from", cursor]);
              yield { items: [{ id: "order-2" }] };
            },
          };
        },
      };
    },
    async updateBalanceAllowance(request) {
      calls.push(["updateBalanceAllowance", request]);
      return { balance: "1" };
    },
    async fetchBalanceAllowance(request) {
      calls.push(["fetchBalanceAllowance", request]);
      return { balance: "2" };
    },
    async cancelOrder(request) {
      calls.push(["cancelOrder", request]);
      return { canceled: ["order-1"] };
    },
  });

  const order = await client.createOrder({
    tokenId: "yes-token",
    price: 0.51,
    size: 3,
    side: "BUY",
    expiration: 0,
  });
  const orders = await client.getOpenOrders();
  await client.updateBalanceAllowance({
    assetType: "CONDITIONAL",
    tokenId: "yes-token",
  });
  const allowance = await client.getBalanceAllowance({
    assetType: "COLLATERAL",
  });
  const canceled = await client.cancelOrder({ orderId: "order-1" });

  assert.deepEqual(order, {
    signed: {
      tokenId: "yes-token",
      price: 0.51,
      size: 3,
      side: "BUY",
    },
  });
  assert.deepEqual(orders, [{ id: "order-1" }, { id: "order-2" }]);
  assert.deepEqual(allowance, { balance: "2" });
  assert.deepEqual(canceled, { canceled: ["order-1"] });
  assert.deepEqual(calls, [
    [
      "createLimitOrder",
      {
        tokenId: "yes-token",
        price: 0.51,
        size: 3,
        side: "BUY",
      },
    ],
    ["listOpenOrders"],
    ["listOpenOrders.from", "next"],
    [
      "updateBalanceAllowance",
      {
        assetType: "CONDITIONAL",
        tokenId: "yes-token",
      },
    ],
    [
      "fetchBalanceAllowance",
      {
        assetType: "COLLATERAL",
      },
    ],
    ["cancelOrder", { orderId: "order-1" }],
  ]);
});

// `@polymarket/client@0.2.0` exposes balance/allowance only as
// standalone actions, never as client methods, so a client without the methods
// is the production case — the adapter has to route to the SDK action rather
// than resolve to `undefined`. Reaching the action with a stub client fails on
// the stub's missing internals; what matters is that the sync is attempted at
// all instead of silently doing nothing.
test("adaptUnifiedSecureClientForLegacyClob falls back to the SDK balance allowance actions", async () => {
  const client = adaptUnifiedSecureClientForLegacyClob({
    async createLimitOrder(request) {
      return { signed: request };
    },
  });

  assert.equal(typeof client.getBalanceAllowance, "function");
  await assert.rejects(() =>
    client.updateBalanceAllowance({
      assetType: "CONDITIONAL",
      tokenId: "yes-token",
    })
  );
  await assert.rejects(() =>
    client.getBalanceAllowance({ assetType: "COLLATERAL" })
  );
});

test("adaptUnifiedSecureClientForLegacyClob forwards builder code to signed order requests", async () => {
  const calls = [];
  const client = adaptUnifiedSecureClientForLegacyClob(
    {
      async createMarketOrder(request) {
        calls.push(["createMarketOrder", request]);
        return { signed: request };
      },
      async createLimitOrder(request) {
        calls.push(["createLimitOrder", request]);
        return { signed: request };
      },
      async postOrder() {
        return { success: true };
      },
    },
    { builderCode: "0xbuilder" }
  );

  await client.createMarketOrder({
    tokenId: "yes-token",
    amount: 10,
    side: "BUY",
  });
  await client.createOrder({
    tokenId: "yes-token",
    price: 0.42,
    size: 5,
    side: "BUY",
    expiration: 1_800_000_000,
  });

  assert.deepEqual(calls, [
    [
      "createMarketOrder",
      {
        tokenId: "yes-token",
        amount: 10,
        side: "BUY",
        builderCode: "0xbuilder",
      },
    ],
    [
      "createLimitOrder",
      {
        tokenId: "yes-token",
        price: 0.42,
        size: 5,
        side: "BUY",
        expiration: 1_800_000_000,
        builderCode: "0xbuilder",
      },
    ],
  ]);
});

test("adaptUnifiedSecureClientForLegacyClob exposes market info and scoring helpers", async () => {
  const calls = [];
  const client = adaptUnifiedSecureClientForLegacyClob({
    async createMarketOrder() {
      return {};
    },
    async createLimitOrder() {
      return {};
    },
    async postOrder() {
      return {};
    },
    async fetchMarketInfo(request) {
      calls.push(["fetchMarketInfo", request]);
      return { conditionId: request.conditionId };
    },
    async fetchOrderScoring(request) {
      calls.push(["fetchOrderScoring", request]);
      return true;
    },
    async fetchOrdersScoring(request) {
      calls.push(["fetchOrdersScoring", request]);
      return Object.fromEntries(request.orderIds.map((id) => [id, true]));
    },
  });

  const marketInfo = await client.getClobMarketInfo("0xcondition");
  const singleScoring = await client.isOrderScoring({ orderId: "order-1" });
  const batchScoring = await client.areOrdersScoring({
    orderIds: ["order-1", "order-2"],
  });

  assert.deepEqual(marketInfo, { conditionId: "0xcondition" });
  assert.deepEqual(singleScoring, { scoring: true });
  assert.deepEqual(batchScoring, { "order-1": true, "order-2": true });
  assert.deepEqual(calls, [
    ["fetchMarketInfo", { conditionId: "0xcondition" }],
    ["fetchOrderScoring", { orderId: "order-1" }],
    ["fetchOrdersScoring", { orderIds: ["order-1", "order-2"] }],
  ]);
});

test("adaptUnifiedSecureClientForLegacyClob normalizes unified open orders to the legacy shape", async () => {
  const client = adaptUnifiedSecureClientForLegacyClob({
    async createMarketOrder() {
      return {};
    },
    async createLimitOrder() {
      return {};
    },
    async postOrder() {
      return {};
    },
    listOpenOrders() {
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            items: [
              {
                id: "order-1",
                tokenId: "token-1",
                makerAddress: "0xmaker",
                originalSize: "7",
                sizeMatched: "2",
                createdAt: "2026-05-22T00:00:00.000Z",
                expiresAt: "2026-05-23T00:00:00.000Z",
                price: "0.51",
                side: "BUY",
                status: "LIVE",
              },
            ],
          };
        },
      };
    },
  });

  assert.deepEqual(await client.getOpenOrders(), [
    {
      id: "order-1",
      maker: "0xmaker",
      asset_id: "token-1",
      token_id: "token-1",
      tokenId: "token-1",
      side: "BUY",
      price: "0.51",
      original_size: "7",
      originalSize: "7",
      size_matched: "2",
      sizeMatched: "2",
      status: "LIVE",
      created_at: "2026-05-22T00:00:00.000Z",
      createdAt: "2026-05-22T00:00:00.000Z",
      expiration: "2026-05-23T00:00:00.000Z",
      expiresAt: "2026-05-23T00:00:00.000Z",
    },
  ]);
});

test("adaptUnifiedSecureClientForLegacyClob stops paging open orders once the limit is met", async () => {
  // `limit` is a page budget, not just a slice: callers that only want the first
  // handful of orders must not pay for the rest of a large book.
  let pagesPulled = 0;
  const page = (ids) => {
    pagesPulled += 1;
    return { items: ids.map((id) => ({ id, tokenId: "token-1" })) };
  };

  const client = adaptUnifiedSecureClientForLegacyClob({
    async createMarketOrder() {
      return {};
    },
    async createLimitOrder() {
      return {};
    },
    async postOrder() {
      return {};
    },
    listOpenOrders() {
      return {
        async firstPage() {
          return { ...page(["a", "b", "c"]), nextCursor: "cursor-2" };
        },
        async *from() {
          yield page(["d", "e", "f"]);
        },
      };
    },
  });

  const limited = await client.getOpenOrders({ limit: 2 });
  assert.deepEqual(
    limited.map((order) => order.id),
    ["a", "b"]
  );
  assert.equal(pagesPulled, 1);

  pagesPulled = 0;
  const all = await client.getOpenOrders();
  assert.deepEqual(
    all.map((order) => order.id),
    ["a", "b", "c", "d", "e", "f"]
  );
  assert.equal(pagesPulled, 2);
});
