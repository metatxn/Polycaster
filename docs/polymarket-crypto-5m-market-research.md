# Polymarket Crypto 5-Minute Up/Down Markets

Research date: 2026-05-10

Primary URL inspected in Chrome:

- `https://polymarket.com/event/btc-updown-5m-1778413800`

Related URLs/API responses inspected:

- `https://gamma-api.polymarket.com/events/slug/btc-updown-5m-1778413800`
- `https://gamma-api.polymarket.com/events/slug/eth-updown-5m-1778413800`
- `https://gamma-api.polymarket.com/events/slug/sol-updown-5m-1778413800`
- `https://polymarket.com/event/btc-updown-5m-1778414100`

## Executive Summary

Polymarket models each 5-minute crypto Up/Down market as a normal binary CLOB market inside a recurring series. The unique event URL contains the asset prefix and the Unix timestamp for the 5-minute window start:

```text
/event/{asset}-updown-5m-{window_start_unix_seconds}
```

For the inspected BTC market:

- Slug: `btc-updown-5m-1778413800`
- Window start: `1778413800` = `2026-05-10T11:50:00Z`
- Window end: `2026-05-10T11:55:00Z`
- Displayed ET window: `May 10, 7:50-7:55AM ET`
- Price to beat: `$80,806.52`
- Observed close price in page data: `$80,810.93`
- Observed result by rule: `Up`, because close price was greater than start price

The reusable pattern works across assets. For the same timestamp, BTC, ETH, and SOL each had separate event slugs and separate CLOB token IDs, but the same 5-minute timestamp structure and settlement rule.

## URL And Slug Shape

The event slug has three important parts:

```text
btc-updown-5m-1778413800
|   |         |  |
|   |         |  Unix seconds for the 5-minute window start
|   |         5-minute recurring interval
|   Up/Down binary market family
Asset prefix
```

The suffix is not an arbitrary Polymarket ID. It is the UTC Unix timestamp for the market's price-reference start time.

For `1778413800`:

- UTC start: `2026-05-10T11:50:00Z`
- UTC end: `2026-05-10T11:55:00Z`
- ET display: `May 10, 7:50-7:55AM ET`

The next 5-minute BTC market slug is computed by adding 300 seconds:

```text
btc-updown-5m-1778414100
```

Polymarket uses the same suffix across assets for the same time window:

```text
btc-updown-5m-1778413800
eth-updown-5m-1778413800
sol-updown-5m-1778413800
```

## Series, Event, And Market

Polymarket has three layers here.

### Series

The series is the recurring product.

BTC inspected values:

- Series id: `10684`
- Series slug/ticker: `btc-up-or-down-5m`
- Title: `BTC Up or Down 5m`
- Recurrence: `5m`
- Series type: `single`
- Restricted: `true`
- Active: `true`

ETH inspected values:

- Series id: `10683`
- Series slug/ticker: `eth-up-or-down-5m`
- Title: `ETH Up or Down 5m`
- Recurrence: `5m`

SOL inspected values:

- Series id: `10686`
- Series slug/ticker: `sol-up-or-down-5m`
- Title: `SOL Up or Down 5m`
- Recurrence: `5m`

### Event

The event is one concrete 5-minute window in the recurring series.

BTC event values for `btc-updown-5m-1778413800`:

- Event id: `466493`
- Slug/ticker: `btc-updown-5m-1778413800`
- Title: `Bitcoin Up or Down - May 10, 7:50AM-7:55AM ET`
- Series slug: `btc-up-or-down-5m`
- Start time: `2026-05-10T11:50:00Z`
- End date: `2026-05-10T11:55:00Z`
- Automatically active: `true`
- Enable order book: `true`
- Negative risk: `false`

Important timestamp distinction:

- `startTime` is the actual 5-minute prediction window start.
- `endDate` is the prediction window end and settlement reference time.
- `startDate`, `creationDate`, and `createdAt` are listing/creation timestamps. They are not the price-reference start of the 5-minute window.

### Market

The nested market is the actual binary CLOB condition users trade.

BTC market values for the inspected event:

- Market id: `2210215`
- Question: `Bitcoin Up or Down - May 10, 7:50AM-7:55AM ET`
- Condition id: `0xdfa4e44572f3dd505f221684114ffac01e5a6b10bcf86c9b4b783ca9e02aa224`
- Question id: `0x3d7bb12cf31690c8be630d159718e763e4c0805d2eda747f1b20b7ce1b566322`
- Outcomes: `["Up", "Down"]`
- CLOB token ids:
  - Up: `76105527235512694262504522489705963053435016640039254628580977235447734175326`
  - Down: `6563164266764568610006144161093290239769824477089144603029588881720897397992`
- Outcome prices at fetch time: `["0.495", "0.505"]`
- Order price min tick size: `0.01`
- Order min size: `5`
- Accepting orders: `true`
- Last trade price: `0.5`
- Best bid: `0.49`
- Best ask: `0.5`
- Spread: `0.01`
- Fees enabled: `true`
- Fee type: `crypto_fees_v2`
- Fee schedule: `{ "exponent": 1, "rate": 0.07, "takerOnly": true, "rebateRate": 0.2 }`
- Maker base fee: `1000`
- Taker base fee: `1000`

## Page Data Polymarket Uses

The rendered Polymarket page included dehydrated query data in `__NEXT_DATA__`.

Relevant query keys observed:

```text
["/api/event/slug","btc-updown-5m-1778413800"]
["/api/series","btc-up-or-down-5m"]
["/api/series/events","10684","btc-up-or-down-5m",false,100,"endDate",true,true,false,null]
["/api/series/events","10684","btc-up-or-down-5m",true,50,"endDate",false,true,false,null]
["past-results","BTC","fiveminute","2026-05-10T11:50:00Z"]
["crypto-prices","price","BTC","2026-05-10T11:50:00Z","fiveminute","2026-05-10T11:55:00Z"]
```

The page also included:

```text
serverDate: 2026-05-10T11:56:43.697Z
page: /event/[...slug]
buildId: build-TfctsWXpff2fKS
```

The `crypto-prices` query result is what tied the displayed market to the observed start and close prices:

```json
{
  "openPrice": 80806.52352477751,
  "closePrice": 80810.93246865076
}
```

## Price To Beat

The UI's "Price To Beat" value is the window start price.

For the inspected BTC market:

- Raw open price: `80806.52352477751`
- Displayed price to beat: `$80,806.52`

The close/final price observed in page data was:

- Raw close price: `80810.93246865076`
- Rounded display equivalent: `$80,810.93`

## Settlement Rule

Polymarket's market description says the market resolves to `Up` if the Bitcoin price at the end of the timeframe is greater than or equal to the price at the beginning. Otherwise, it resolves to `Down`.

For BTC:

- Resolution source: `https://data.chain.link/streams/btc-usd`
- Rule: `closePrice >= openPrice` resolves `Up`
- Rule: `closePrice < openPrice` resolves `Down`
- The description explicitly excludes spot market prices and other sources from the resolution basis.

For the inspected window:

```text
openPrice  = 80806.52352477751
closePrice = 80810.93246865076
```

Because `80810.93246865076 >= 80806.52352477751`, the result is `Up`.

ETH and SOL use the same rule with their own Chainlink streams:

- ETH source: `https://data.chain.link/streams/eth-usd`
- SOL source: `https://data.chain.link/streams/sol-usd`

## Live Market Behavior Observed In Chrome

When opening `https://polymarket.com/event/btc-updown-5m-1778413800`, the page displayed:

- `BTC Up or Down 5m`
- `May 10, 7:50-7:55AM ET`
- `Price To Beat $80,806.52`
- `(market closed)`
- A `Go to live market` control

Chrome inspection found that the `Go to live market` link existed, but its `href` pointed back to `/event/btc-updown-5m-1778413800` at the time of inspection. Clicking it did not navigate to a newer market.

Based on the page's `serverDate` of `2026-05-10T11:56:43.697Z`, the expected current 5-minute window start was `2026-05-10T11:55:00Z`, with slug suffix `1778414100`. Opening `https://polymarket.com/event/btc-updown-5m-1778414100` showed the next BTC window:

- `May 10, 7:55-8AM ET`
- `Price To Beat $80,810.93`

By the time it was inspected, that page had also moved to a closed state.

Implementation implication: do not rely only on Polymarket's rendered `Go to live market` link. For a robust app flow, compute the current 5-minute suffix from a trusted server time, construct the expected slug, then verify the event exists through Gamma before routing the user there.

## Reusable Asset Configuration

Minimum reusable asset model:

```ts
type Crypto5mAsset = {
  symbol: "BTC" | "ETH" | "SOL";
  eventPrefix: string;
  seriesSlug: string;
  seriesId: string;
  chainlinkStreamSlug: string;
};
```

Observed values:

| Symbol | Event prefix | Series slug | Series id | Chainlink stream |
| --- | --- | --- | --- | --- |
| BTC | `btc` | `btc-up-or-down-5m` | `10684` | `btc-usd` |
| ETH | `eth` | `eth-up-or-down-5m` | `10683` | `eth-usd` |
| SOL | `sol` | `sol-up-or-down-5m` | `10686` | `sol-usd` |

Slug construction:

```ts
function crypto5mSlug(assetPrefix: string, windowStartUnixSeconds: number) {
  return `${assetPrefix}-updown-5m-${windowStartUnixSeconds}`;
}
```

Current-window calculation:

```ts
function current5mWindowStartUnixSeconds(nowMs: number) {
  return Math.floor(Math.floor(nowMs / 1000) / 300) * 300;
}
```

Use server time for this calculation where possible. Client-only time can drift and send users to the wrong just-opened or just-closed market.

## What It Takes To Add This To Our App

Our existing event detail and trading stack already understands Polymarket events, CLOB token IDs, order books, and order placement. Adding reusable 5-minute crypto markets should mostly be product routing, data normalization, and settlement display work rather than a separate trading engine.

Core pieces needed:

1. Add a reusable crypto 5-minute market configuration for supported assets.
2. Add a resolver that maps `{ asset, interval, time }` to a Polymarket event slug.
3. Fetch and validate the Gamma event by slug.
4. Preserve outcome labels as `Up` and `Down`; avoid forcing `Yes` and `No` labels in charts, trading forms, or order book UI.
5. Display the prediction window using `event.startTime` or `market.eventStartTime`, not `startDate`.
6. Display "Price To Beat" from a trusted price source or page/API-derived equivalent.
7. Route closed markets to the computed current market slug after verifying it exists.
8. Reuse the existing CLOB order book and trading form with the market's `clobTokenIds`.
9. Show final settlement by comparing close price to open price, using Decimal.js for monetary/price math.

If we add new backend endpoints for this, they need to follow the repo standards:

- Validate all inputs, including asset, interval, and timestamp.
- Add rate limiting middleware.
- Add OpenAPI annotations.
- Use the structured logger instead of `console.log`.
- Do not leak stack traces or internal error details in API responses.
- Use Decimal.js for monetary and price calculations.

## Suggested App Architecture

Recommended route shape:

```text
/markets/crypto-5m/:asset
/markets/crypto-5m/:asset/:windowStart
```

Recommended backend/API shape if a server resolver is needed:

```text
GET /api/crypto-markets/5m/:asset/current
GET /api/crypto-markets/5m/:asset/:windowStart
```

The current resolver should:

1. Get trusted server time.
2. Floor it to the current 5-minute boundary.
3. Construct the candidate slug.
4. Fetch Gamma event by slug.
5. If not found or not accepting orders, optionally try the previous or next 5-minute boundary to handle boundary races.
6. Return normalized event, market, outcomes, token IDs, window timestamps, and source metadata.

Normalized response shape:

```ts
type Crypto5mMarket = {
  asset: string;
  slug: string;
  seriesSlug: string;
  eventId: string;
  marketId: string;
  conditionId: string;
  questionId: string;
  windowStart: string;
  windowEnd: string;
  outcomes: Array<{
    name: "Up" | "Down";
    tokenId: string;
    price: string;
  }>;
  order: {
    minSize: string;
    minTick: string;
    bestBid?: string;
    bestAsk?: string;
    spread?: string;
  };
  prices?: {
    open?: string;
    close?: string;
    source: string;
  };
};
```

## Open Questions

Several details need another pass before implementation:

- Whether Polymarket's `crypto-prices` and `past-results` queries are backed by a stable public endpoint or are only usable through rendered page data.
- Whether we should use Chainlink Data Streams directly for open/close prices, and whether that requires authenticated access for our runtime.
- Which additional assets beyond BTC, ETH, and SOL we want to support first.
- Whether the product should show current live-only markets, historical markets, or both.
- Whether trading should be enabled immediately or gated behind a separate confirmation flow for these fast-expiring markets.
