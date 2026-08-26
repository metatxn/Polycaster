# Extension search catalogue

> Status: proposed and deferred
>
> Last reviewed: 2026-08-26
>
> Implementation status: not started
>
> Scope: market discovery for the browser extension, shared catalogue storage,
> live card prices, provider rate limits, rollout, and production checks

This document is the implementation specification for moving extension market
search away from one Polymarket Gamma search per post. It records the decisions
needed to start the work later. It does not authorize a partial production
rollout, and it does not claim that the capacity figures below have been
measured. The load figures are planning models until the benchmark phase
replaces them with results.

The prose uses "catalogue". Code identifiers should use `catalog` to match the
repository's TypeScript naming style.

## Contents

1. [Decision](#decision)
2. [Why this work exists](#why-this-work-exists)
3. [Goals and limits](#goals-and-limits)
4. [Freshness contract](#freshness-contract)
5. [Proposed architecture](#proposed-architecture)
6. [Catalogue data model](#catalogue-data-model)
7. [Catalogue ingestion](#catalogue-ingestion)
8. [Search and ranking](#search-and-ranking)
9. [API contracts](#api-contracts)
10. [Live price service](#live-price-service)
11. [Extension rendering changes](#extension-rendering-changes)
12. [Rate-limit and capacity model](#rate-limit-and-capacity-model)
13. [Caching and storage rules](#caching-and-storage-rules)
14. [Failure behavior](#failure-behavior)
15. [Security and privacy](#security-and-privacy)
16. [Observability](#observability)
17. [Test and benchmark plan](#test-and-benchmark-plan)
18. [Production rollout and rollback](#production-rollout-and-rollback)
19. [Implementation phases](#implementation-phases)
20. [Expected repository changes](#expected-repository-changes)
21. [Cloudflare configuration](#cloudflare-configuration)
22. [Cost controls](#cost-controls)
23. [Open questions](#open-questions)
24. [Definition of done](#definition-of-done)
25. [Sources](#sources)

## Decision

Knoww will own a searchable copy of Polymarket event and market metadata. User
searches will query that catalogue instead of calling Gamma `/public-search`.
Gamma remains the upstream source used by scheduled ingestion and reconciliation.

The first implementation should use:

- A separate Cloudflare D1 database as the canonical catalogue.
- D1 FTS5 as the first lexical search backend.
- A repository interface around search and storage so the serving backend can
  change if the load benchmark rejects D1 FTS5.
- One Durable Object for catalogue sync locking and global Polymarket quota
  coordination. Search requests must not pass through this object.
- The existing `GET /api/search` contract during migration.
- A new batch search contract for the extension after catalogue parity is
  proven.
- A separate CLOB quote service for card prices. Catalogue prices are metadata
  snapshots and must never be labelled live.
- Rolling micro-batches in the extension. The extension should render each
  small completed group instead of waiting for the whole feed batch.

These choices are deliberate:

| Concern | Decision | Reason |
|---|---|---|
| Canonical metadata | Separate D1 database | D1 supports transactions, indexes, FTS5, point-in-time recovery, and read replication. The existing `AGENT_DB` has a different owner and migration history. |
| Search backend | D1 FTS5 first | It gives Knoww lexical retrieval without adding a hosted search vendor. The repository interface keeps this choice reversible. |
| Distributed cache | Optional KV, only after measurement | KV is eventually consistent and charges per key write. It is useful for immutable artefacts and popular reads, not high-cardinality query writes. |
| Global coordination | Durable Object | A named object can serialize sync ownership and maintain provider token buckets. KV cannot provide that consistency. |
| Card probability | CLOB quote cache | The order book is the current price source. Gamma's `outcomePrices` field is a catalogue snapshot. |
| Trade preview | Fresh CLOB order book | A midpoint or top-of-book price does not account for requested size or slippage. |
| Nested markets | Preserve every active nested market | Team names, candidates, thresholds, outcomes, and token IDs are required for matching, display, and trading. |
| Scale | Supported catalogue clients make zero Gamma calls in steady state | Query caching alone cannot handle a large number of distinct post texts. Legacy clients stay on their compatibility path until they are retired or made safe. |

## Why this work exists

### Current request path

The extension currently performs this sequence:

```text
social post
  -> extension keyword and tag extraction
  -> extension per-tab queue, minimum 900 ms between searches
  -> GET knoww.app/api/search
  -> web Worker process-local cache and in-flight map
  -> Gamma /public-search
  -> zero to two Gamma /events/keyset tag fallbacks
  -> extension local embedding, BM25, and context gates
  -> whole-batch allocation
  -> card rendering with Gamma outcomePrices
```

The important code paths are:

- [`apps/web/src/app/api/search/route.ts`](apps/web/src/app/api/search/route.ts)
  has a 30 second process-local cache, a process-local in-flight map, and a
  60 requests per minute client limiter.
- [`packages/knoww-services/src/markets/search.ts`](packages/knoww-services/src/markets/search.ts)
  calls Gamma `/public-search` and can add two `/events/keyset` requests for tag
  fallbacks. Its upstream timeout is 8.5 seconds.
- [`apps/extension/src/content/api.ts`](apps/extension/src/content/api.ts)
  serializes search within one tab at a 900 ms minimum interval. It asks for
  eight events and keeps no cross-user or cross-tab coordination.
- [`apps/extension/src/content/injection.ts`](apps/extension/src/content/injection.ts)
  analyzes with three workers, waits for all workers, ranks the whole set, and
  only then renders the selected cards.
- [`apps/extension/src/content/ui/cards.ts`](apps/extension/src/content/ui/cards.ts)
  displays Gamma `outcomePrices` and can fill missing values with `0.5`.
- [`apps/extension/src/content/api.ts`](apps/extension/src/content/api.ts)
  performs a second event fetch on trade interaction because optimized search
  records omit `clobTokenIds`.
- [`apps/web/src/lib/insider/clob-price-batch-loader.ts`](apps/web/src/lib/insider/clob-price-batch-loader.ts)
  already batches CLOB books in groups of 50, but its cache is process-local and
  only supports the suspicious-trades route.

### Bottlenecks

There are three separate bottlenecks. They need separate fixes.

1. Gamma search capacity is shared by every Knoww user because the requests
   leave from Knoww's Cloudflare deployment. Per-tab delays do not protect the
   shared upstream IP budget.
2. The extension has a rendering barrier. One slow post search can delay all
   cards in the current batch.
3. Card probabilities come from catalogue-style Gamma data, while trading uses
   the CLOB. The card and trading views can therefore disagree even when both
   requests succeed.

Adding a shared query cache would help repeated phrases, but post text has high
cardinality. At 10,000 or 100,000 users, most first-wave queries can still be
unique. The searchable corpus must move to Knoww.

## Goals and limits

### Goals

- Return useful extension search candidates without a user-driven Gamma call.
- Preserve all active nested markets, outcomes, condition IDs, and CLOB token
  IDs.
- Keep catalogue discovery metadata within 30 to 90 seconds of the latest fast
  sync under normal conditions.
- Render the first useful card within two seconds at p95 on a warm extension.
- Remove the whole-feed rendering barrier.
- Display CLOB-derived probability data with a source and timestamp.
- Keep provider traffic below a 20 percent reserve from published limits.
- Serve stale catalogue metadata during a short ingestion outage.
- Keep the existing web search response compatible until the extension has
  moved to the versioned contract.
- Put catalogue logic in shared domain services so web and MCP can reuse it
  later without moving business rules out of the extension twice.

### Non-goals

- The catalogue will not execute trades or sign orders.
- The catalogue will not become the source of truth for live prices.
- Phase one will not add semantic search on the server. The extension already
  has local semantic and lexical ranking.
- The first release will not replace every web market endpoint.
- The first release will not make MCP depend on the catalogue.
- Knoww will not load-test Polymarket with synthetic 10,000 or 100,000 user
  traffic.
- Exact equality with the Polymarket UI at every millisecond is not possible.
  The target is the same CLOB source, a defined price meaning, a timestamp, and
  fresh validation before a trade.

## Freshness contract

Discovery and pricing have different clocks. Do not merge them into one `price`
or one `updatedAt` field.

| Data | Source | Proposed target | Use |
|---|---|---:|---|
| Event and market discovery | Knoww catalogue, populated from Gamma | 30 to 90 seconds for fast updates; hourly full reconciliation | Search and matching |
| Tags and nested outcomes | Knoww catalogue | Same as catalogue | Search, display, and token mapping |
| Card midpoint and top of book | Polymarket CLOB through Knoww quote cache | 0 to 5 seconds | Probability card |
| Stale card quote | Last CLOB quote | More than 5 and at most 30 seconds | May display with a stale state and age |
| Trade preview | Current CLOB order book | Fetch on interaction | Size-aware expected fill and slippage |
| Order submission | Signed order with explicit price and constraints | Revalidate immediately before submission | Execution |

Proposed catalogue states:

| State | Catalogue age | Behavior |
|---|---:|---|
| `FRESH` | Up to 2 minutes | Serve normally. |
| `STALE` | More than 2 and up to 15 minutes | Serve results and expose `catalogStatus: "STALE"`. Alert after 5 minutes. |
| `DEGRADED` | More than 15 minutes or last sync failed repeatedly | Serve the last complete data if it is readable. Use the bounded Gamma fallback only when the fallback circuit allows it. |
| `UNAVAILABLE` | No readable complete catalogue | Return a typed degraded response. Do not unleash uncapped Gamma calls. |

The thresholds are proposed defaults. The implementation must expose them as
validated configuration and confirm them against production metrics.

## Proposed architecture

```text
                         scheduled catalogue path

  Gamma /events/keyset ------------------------------+
           |                                         |
           v                                         |
  catalogue sync runner                              |
           |                                         |
           +--> catalogue coordinator Durable Object|
           |       sync lock + provider quotas       |
           v                                         |
  separate D1 catalogue                              |
  events + nested markets + outcomes + tags + FTS5   |
           |                                         |
           +-----------------------------+-----------+
                                         |
                         user search path |
                                         v
  extension -> Knoww search API -> catalogue repository -> D1 FTS5
       |              |
       |              +-> metadata response, no Gamma request
       |
       +-> render card shell
       |
       +-> quote request -> price-cache Durable Object
                              |                |
                              |                +-> batch CLOB HTTP on miss
                              +-> CLOB Market WebSocket for hot tokens
```

### Catalogue write path

The web Worker's scheduled handler starts catalogue sync. A named coordinator
object grants one lease so overlapping cron runs cannot write concurrently.
The sync runner fetches Gamma pages, validates every payload, normalizes the
records, and writes only changed data to D1.

The existing hourly IndexNow trigger stays intact. Add a separate every-minute
trigger for the fast catalogue pass. The scheduled handler must branch on the
exact cron expression, as the current handler already does for IndexNow and the
agent task.

### Catalogue read path

The search route calls a `CatalogSearchRepository` interface. The first adapter
uses D1 FTS5. A D1 session should run candidate retrieval and event hydration so
both queries read a sequentially consistent database version when read
replication is enabled.

Search results should keep normal HTTP cache headers and a small process-local
L1 cache. Neither cache is required for correctness. The catalogue database is
the fallback when an isolate starts cold.

### Coordination path

The catalogue coordinator should handle only:

- Sync lease acquisition and renewal.
- Gamma endpoint token buckets.
- Fallback admission and circuit-breaker state.
- Sync checkpoint ownership if a run has to continue on the next cron tick.

Do not send ordinary search requests through this object. A single serialized
object in every read path would replace Gamma with a new bottleneck.

### Price path

The later price-cache object owns a disposable in-memory map by CLOB token ID.
It receives public Market Channel updates for hot tokens and batches HTTP
requests for cold misses. The extension reads this service after metadata is
available. Price failure must not delay the metadata card.

## Catalogue data model

Use normalized records. Do not keep Gamma's JSON-encoded `outcomes`,
`outcomePrices`, and `clobTokenIds` as the internal model.

### `catalog_events`

| Field | Type | Rule |
|---|---|---|
| `id` | text primary key | Namespaced stable ID, such as `polymarket:event:<provider-id>`. |
| `provider` | text | `POLYMARKET` in the first release. |
| `provider_event_id` | text unique | Raw stable Gamma event ID. |
| `slug` | text | Indexed. Keep historical slug handling separate if needed. |
| `title` | text | Required and non-empty. |
| `description` | text nullable | Length-capped during normalization. |
| `image_url`, `icon_url` | text nullable | Permit only expected HTTPS URLs. |
| `category`, `subcategory` | text nullable | Discovery metadata. |
| `start_at`, `end_at` | text nullable | Normalized ISO 8601 UTC. |
| `active`, `closed`, `archived`, `restricted` | integer booleans | Search availability filters. |
| `volume_24h` | text nullable | Exact decimal string. |
| `volume_rank_bucket` | integer nullable | Coarse ranking bucket computed with Decimal.js. Never reconstruct money from it. |
| `liquidity` | text nullable | Exact decimal string. |
| `source_updated_at` | text nullable | Provider timestamp. |
| `metadata_fingerprint` | text | Hash of normalized discovery fields. Exclude live quotes. |
| `ingested_at` | text | Knoww observation time. |

### `catalog_markets`

| Field | Type | Rule |
|---|---|---|
| `id` | text primary key | Namespaced stable market ID. |
| `event_id` | text foreign key | Parent event. |
| `provider_market_id` | text unique | Raw Gamma market ID. |
| `condition_id` | text nullable | Required before a market can enter a trading flow. |
| `slug` | text nullable | Indexed lookup field. |
| `question` | text | Included in the search document. |
| `group_item_title` | text nullable | Team, candidate, threshold, or grouped option label. |
| `active`, `closed`, `archived` | integer booleans | Nested availability filters. |
| `accepting_orders`, `enable_order_book` | integer booleans | Trading eligibility metadata. |
| `neg_risk` | integer boolean nullable | Market structure metadata. |
| `tick_size` | text nullable | Exact decimal string. |
| `min_order_size` | text nullable | Exact decimal string. |
| `start_at`, `end_at`, `game_start_at` | text nullable | Normalized UTC timestamps. |
| `sports_market_type` | text nullable | Search and display context. |
| `volume_24h` | text nullable | Exact decimal string. |
| `metadata_fingerprint` | text | Hash of normalized market fields. |
| `ingested_at` | text | Knoww observation time. |

### `catalog_outcomes`

One row represents one outcome and one token mapping.

| Field | Type | Rule |
|---|---|---|
| `market_id` | text foreign key | Parent market. |
| `outcome_index` | integer | Original provider order. |
| `name` | text | Required. |
| `clob_token_id` | text nullable | Must align with the same provider array index. |
| `snapshot_price` | text nullable | Gamma snapshot for compatibility and diagnosis only. Never return this as a live quote. |

The primary key should be `(market_id, outcome_index)`. Add a unique index for
non-null `clob_token_id` if live provider data confirms token IDs are globally
unique.

### Tags

Use `catalog_tags` and `catalog_event_tags`. Store provider ID, slug, and label.
Tag slugs need an index because tag-only searches and extension filters use
them.

### Search document

Maintain one denormalized text document per event. It should contain:

- Event title and subtitle.
- Every active nested market question.
- Every `group_item_title`.
- Every outcome name.
- Tag labels and slugs.
- Category and subcategory.
- A bounded portion of the description.

One event document makes result grouping predictable. The API can then hydrate
all active nested markets for each matched event.

Use a normal `catalog_search_documents` table plus an FTS5 virtual table. Keep
FTS maintenance in explicit repository writes or tested triggers. A hidden
trigger that silently drifts is harder to operate than a slightly more verbose
sync transaction.

### Sync state

`catalog_sync_runs` should record:

- Run ID and mode, either `FAST` or `FULL`.
- Start, heartbeat, and finish timestamps.
- Cursor and high-water mark.
- Page, event, market, and outcome counts.
- Inserted, updated, unchanged, and retired counts.
- Validation failure count.
- Final status and a short failure category.

Do not store stack traces or raw provider payloads in this table.

### Data invariants

- An event can have many nested markets. Never flatten the event to only the
  first market.
- Outcomes and token IDs must have equal lengths when token IDs exist.
- Prices, sizes, volume, and liquidity remain strings or Decimal values in
  application code.
- A closed, archived, or inactive nested market cannot appear as tradable.
- `acceptingOrders` alone does not prove a market is tradable. The market also
  needs a condition ID, token IDs, and an enabled order book.
- Catalogue records never claim a Gamma snapshot is live CLOB data.
- Unknown required identifiers reject the record at ingestion. They must not be
  invented from array position or title.

## Catalogue ingestion

### Source endpoint

Use Gamma's keyset event listing rather than `/public-search` for catalogue
population. The [keyset endpoint](https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination)
supports up to 500 events per page, returns nested markets, and provides
`next_cursor` for the next page.

### Bootstrap

The first bootstrap should:

1. Acquire the catalogue sync lease.
2. Create a `FULL` sync run.
3. Page through `/events/keyset` with a conservative page delay and a 500 item
   maximum.
4. Validate each page with Zod schemas in `@knoww/services`.
5. Normalize events, nested markets, outcomes, token IDs, and tags.
6. Write D1 batches in bounded transactions.
7. Build or refresh the event search document after its children are valid.
8. Compare the final active provider ID set with D1.
9. Retire missing records only after the full sweep succeeds.
10. Mark the sync run complete and publish its version as the current complete
    catalogue.

If the run fails before step 9, keep prior records. A partial new page may be
visible, but a failed sweep must not mark unseen events closed.

### Fast sync every minute

The fast pass should request recently updated events in descending `updatedAt`
order and stop after crossing the last successful high-water mark plus one
overlap page. The overlap handles equal timestamps and records created during a
page transition.

Treat `order=updatedAt` as a provider dependency that needs an integration test.
The keyset documentation permits JSON field names in `order`, but Knoww still
needs a canary because provider behavior can change.

The fast fingerprint should include text, lifecycle state, tags, market IDs,
token IDs, tick size, minimum order size, and trading eligibility. Exclude
rapidly changing quote fields. Update volume ranking on a slower cadence so a
minute sync does not rewrite every active market for a small volume change.

### Full reconciliation every hour

The full pass protects against missed updates and websocket gaps. It should:

- Scan the complete open catalogue.
- Refresh changed metadata.
- Retire missing, closed, archived, or inactive records only after success.
- Repair search documents whose child fingerprint no longer matches.
- Report count deltas against the prior complete run.

Large count drops are suspicious. If active events or markets fall by more than
a configured percentage, fail closed, keep the previous records, and alert.

### Optional lifecycle websocket

Polymarket's public Market Channel can report `new_market` and
`market_resolved` when `custom_feature_enabled` is true. Use these messages as
low-latency hints, not as the only catalogue source. A message should enqueue or
request the affected provider record, and the scheduled full reconciliation
remains authoritative.

### Write minimization

D1 charges and reports rows written. Compare `metadata_fingerprint` before an
update. An unchanged event should cause no child rewrites and no FTS update.

Use two update speeds:

- Fast metadata updates for lifecycle and token mapping.
- Slower discovery-stat updates for volume and liquidity rank buckets.

This avoids converting a mostly static catalogue into a write stream.

### Sync backoff

Use bounded exponential backoff with jitter for 429, 5xx, timeout, and malformed
page failures. Polymarket states that excess requests are delayed or queued,
not always rejected, so a rising upstream duration is also a quota signal.

Stop a run before its lease or Worker duration expires. Save the cursor and
continue on the next scheduled invocation. Do not start a second sweep from the
beginning while a valid checkpoint exists.

## Search and ranking

### Retrieval strategy

The server search exists to produce a high-recall candidate set. The extension
still applies local embeddings, BM25, a context gate, domain compatibility, and
its final injection policy.

The initial D1 query should:

1. Normalize the query with Unicode NFKC, lowercase, whitespace collapse, and a
   bounded length.
2. Escape FTS syntax. Never pass raw user text directly into `MATCH`.
3. Apply validated tag filters.
4. Retrieve up to 50 event documents from FTS5.
5. Filter unavailable events and markets.
6. Apply exact phrase, exact tag, and exact slug boosts.
7. Use volume and end-date buckets only as tie-breakers.
8. Return at most 20 hydrated events with all active nested markets.

Use FTS column weights in this order of importance:

| Field | Relative importance |
|---|---:|
| Event title | Highest |
| Market question | Highest |
| Grouped option title and outcome names | High |
| Tag label and slug | Medium |
| Category | Medium |
| Description | Low |

FTS5's `bm25()` ordering is not a 0 to 1 relevance score. Keep the raw database
rank internal. If the API exposes a score, transform it through a versioned and
tested function. Add `rankingVersion` to debug metadata so a ranking change does
not look like catalogue drift.

### Nested market behavior

Search returns events, but matching must inspect nested text. If a post mentions
"Arsenal", a grouped winner event can match because `group_item_title` and
outcome names are in the event search document.

After an event matches, hydrate all active nested markets, not only the nested
market that contributed the FTS hit. The extension needs the complete active
set to display a multi-option card and map the selected option to the correct
CLOB token.

### Tag-only search

When the query is empty and tags are present, skip FTS. Filter by tag and order
by a precomputed volume rank bucket, availability, and end date. Do not cast
money strings to JavaScript numbers for ranking.

### Empty search

An empty query with no tags should preserve the current empty response. It
should not become a hidden trending endpoint.

### Semantic search

Do not add a server embedding model to the first release. It adds build size,
CPU cost, index maintenance, and another score to calibrate. Measure catalogue
lexical recall against the current Gamma candidate set first.

If lexical recall remains weak after nested outcome indexing and query fixes,
write a separate design for a semantic retrieval layer. Keep the local
extension reranker regardless.

## API contracts

### Compatibility route

Keep this route during migration:

```http
GET /api/search?q=<query>&tag_slugs=<comma-separated>&limit=<1..20>
```

The route should gain an internal provider switch:

```text
off     -> current Gamma implementation
shadow  -> return Gamma, run catalogue search in the background, compare results
primary -> return catalogue, use globally bounded Gamma fallback only when allowed
```

Do not change the legacy JSON shape while the current extension uses it. Add
diagnostic response headers that do not affect clients:

```text
X-Knoww-Search-Source: GAMMA | CATALOG | CATALOG_STALE | GAMMA_FALLBACK
X-Knoww-Catalog-Version: <opaque version>
X-Knoww-Catalog-Age-Ms: <integer>
X-Knoww-Ranking-Version: <integer>
```

There is a compatibility trap here. Old extension versions display
`outcomePrices` and do not call the new quote route. Do not send those clients a
slowly refreshed catalogue snapshot and call it current. Keep supported old
versions on Gamma, or enrich their legacy response from the shared CLOB quote
service with cache headers that match quote freshness. The safer first rollout
is to keep `GET /api/search` on Gamma for old clients and make the versioned
batch route the catalogue-primary path.

### Batch search route

After catalogue parity, add:

```http
POST /api/search/batch
Content-Type: application/json
```

Proposed request:

```json
{
  "queries": [
    {
      "requestId": "post-1",
      "query": "fed rate cut september",
      "tagSlugs": ["fed", "interest-rates"],
      "limit": 20
    }
  ]
}
```

Validation rules:

- One to three query items per request.
- Unique `requestId` values, 1 to 80 safe characters.
- Query length from 0 to 200 characters after normalization.
- At most two tag slugs for compatibility in the first release. Raise this only
  after search and response-size benchmarks.
- Limit from 1 to 20.
- Maximum request body size enforced before JSON parsing where the runtime
  allows it.
- Each subquery consumes client quota. A batch of three does not count as one
  search for abuse control.

Proposed response:

```json
{
  "contractVersion": 2,
  "catalog": {
    "version": "2026-08-26T12:30:00.000Z:1842",
    "asOf": "2026-08-26T12:30:00.000Z",
    "ageMs": 812,
    "status": "FRESH"
  },
  "rankingVersion": 1,
  "results": [
    {
      "requestId": "post-1",
      "source": "CATALOG",
      "events": [
        {
          "id": "polymarket:event:123",
          "providerEventId": "123",
          "slug": "fed-decision-in-september",
          "title": "Fed decision in September?",
          "description": "",
          "imageUrl": "https://example.invalid/event.png",
          "startAt": null,
          "endAt": "2026-09-18T00:00:00.000Z",
          "volume24h": "102340.15",
          "tags": [
            { "slug": "fed", "label": "Fed" }
          ],
          "markets": [
            {
              "id": "polymarket:market:456",
              "providerMarketId": "456",
              "conditionId": "0xabc",
              "slug": "fed-cuts-rates",
              "question": "Will the Fed cut rates?",
              "groupItemTitle": null,
              "acceptingOrders": true,
              "tickSize": "0.01",
              "minOrderSize": "5",
              "outcomes": [
                {
                  "index": 0,
                  "name": "Yes",
                  "tokenId": "123456789",
                  "catalogSnapshotPrice": "0.54"
                },
                {
                  "index": 1,
                  "name": "No",
                  "tokenId": "987654321",
                  "catalogSnapshotPrice": "0.46"
                }
              ]
            }
          ]
        }
      ],
      "degraded": false
    }
  ]
}
```

`catalogSnapshotPrice` is explicitly named. The extension must not use it as a
live card probability after the quote route is enabled.

### Card quote route

Add a separate read contract:

```http
POST /api/markets/quotes
```

Proposed request:

```json
{
  "tokenIds": ["123456789", "987654321"],
  "purpose": "CARD"
}
```

Start with a Knoww batch cap of 50 unique token IDs. Polymarket documents batch
endpoints but does not publish a stable maximum item count. Fifty is an internal
cap that must be canary-tested, not a provider guarantee.

Proposed response:

```json
{
  "quotes": [
    {
      "tokenId": "123456789",
      "midpoint": "0.54",
      "bestBid": "0.53",
      "bestAsk": "0.55",
      "lastTrade": "0.54",
      "source": "CLOB_WS",
      "sourceTimestamp": "2026-08-26T12:30:00.125Z",
      "observedAt": "2026-08-26T12:30:00.151Z",
      "ageMs": 26,
      "status": "FRESH"
    }
  ],
  "missingTokenIds": []
}
```

Allowed quote states are `FRESH`, `STALE`, and `UNAVAILABLE`. Allowed sources
should include `CLOB_WS`, `CLOB_HTTP_MIDPOINT`, `CLOB_HTTP_BOOK`, and
`CLOB_HTTP_LAST_TRADE`.

Do not return a numeric field when its meaning is unknown. `null` plus a status
is better than `0.5`.

### Error shape

New routes should use one error envelope:

```json
{
  "error": {
    "code": "CATALOG_UNAVAILABLE",
    "message": "Market search is temporarily unavailable.",
    "requestId": "req_abc"
  }
}
```

The message is safe for users. Logs may record a structured failure category,
but responses must not include stack traces, SQL, upstream bodies, binding
names, or internal file paths.

Every new route needs OpenAPI annotations, CORS handling for extension origins,
input validation, structured logging, and rate limiting.

## Live price service

### Price definitions

The system must name each price:

- `midpoint` is the average of best bid and best ask when both exist and the
  book is valid.
- `bestBid` is the highest standing bid.
- `bestAsk` is the lowest standing ask.
- `lastTrade` is the last executed price.
- `catalogSnapshotPrice` is Gamma metadata and is not live.

Polymarket's direct `/price` naming is easy to misread. Its documentation states
that `side=BUY` returns the best bid and `side=SELL` returns the best ask. Knoww
should normalize these values to `bestBid` and `bestAsk`. Do not expose a field
called `buyPrice` from that endpoint.

For a user buying, executable liquidity is on the ask side. For a user selling,
executable liquidity is on the bid side.

### Card price

Display midpoint as probability when both sides are available and the spread is
valid. A one-sided or crossed book has no valid midpoint.

Fallback order for a card:

1. Fresh midpoint.
2. Fresh last trade, labelled as last trade.
3. Stale midpoint or last trade within 30 seconds, with a stale state and age.
4. "Updating price" or "Price unavailable".

Never fill an unknown price with `0.5`.

### Trade preview

`/midpoints` and `/prices` are not amount-aware. Before showing an executable
quote, fetch `/books`, walk the correct side with Decimal.js, and return:

- Requested side and size or collateral amount.
- Expected average fill.
- Worst fill price.
- Available size.
- Estimated slippage.
- Tick size and minimum order size.
- Book timestamp and hash.

A preview is still not a guarantee. The order book can move between preview and
submission. The signed order must carry explicit price and order-type
constraints, and the submission path should revalidate its assumptions as late
as the CLOB SDK permits.

### Hot price cache

Proposed in-memory entry:

```text
token ID
  midpoint
  best bid
  best ask
  last trade
  tick size
  minimum order size
  book hash
  provider timestamp
  Knoww observed timestamp
  source
  status
```

The public Polymarket Market Channel supports book snapshots, price changes,
last trades, tick-size changes, dynamic subscribe and unsubscribe, and optional
best-bid/ask and lifecycle events. The client must send `PING` every 10 seconds.
Set `custom_feature_enabled: true` for the optional events.

The provider removed its former 100 token subscription limit in May 2025. Knoww
still needs its own operational cap. Start with one measured hot-token budget,
then shard only when throughput or memory data requires it.

### Cache-miss batching

For cold tokens:

1. Collect misses for a short 25 to 50 ms window.
2. Deduplicate token IDs across waiting requests.
3. Split them into Knoww batches of at most 50.
4. Use `/midpoints` for card probability or `/books` when book metadata is also
   needed.
5. Store results for a few seconds.
6. Resolve all waiters from that result.

The published limit for each of `/midpoints`, `/prices`, and `/books` is 500
requests per 10 seconds. Use a 400 per 10 second internal ceiling for each
endpoint until provider guidance changes.

### Durable Object behavior

An outbound websocket from a Durable Object cannot hibernate. It keeps the
object active and duration-billed while provider traffic continues. Persist
subscription intent and a compact checkpoint, but keep quotes disposable and
in memory. On reconnect:

1. Open the websocket with exponential backoff and jitter.
2. Resubscribe to current hot token IDs.
3. Request an initial dump or fresh HTTP snapshot.
4. Mark pre-disconnect entries stale until a new source timestamp arrives.

One price object should be the starting point. Hash-based shards are a measured
capacity response, not a default. Four continuously active shards cost roughly
four times the duration of one shard.

### Extension and web websocket ownership

The extension should not open one Polymarket websocket per user. Knoww should
operate the shared price connection.

The web app currently has one direct Polymarket Market Channel connection per
browser page or tab through
[`apps/web/src/lib/websocket-manager.ts`](apps/web/src/lib/websocket-manager.ts).
This catalogue project does not have to migrate the web app immediately. Keep
that as a separate follow-up because changing web order-book delivery has a
larger blast radius than fixing extension cards.

## Extension rendering changes

### Remove the whole-batch barrier

The current allocator ranks and deduplicates across the complete analyzed batch.
That gives a global ordering, but it also waits for the slowest search.

Use rolling micro-batches:

1. Select the three nearest visible eligible posts.
2. Submit one batch search request.
3. Run local scoring and gates for those posts.
4. Allocate against already committed market and post constraints.
5. Render that micro-batch immediately.
6. Continue with the next three posts during idle time.

This preserves:

- One card per post.
- Maximum active posts per market.
- Per-batch injection limits.
- Post and market pair deduplication.
- Existing price-cap rules.

It changes one behavior. Viewport priority replaces a mathematically global
ranking across every queued post. Immediate rendering and a perfect global
ordering are incompatible. Viewport priority is the better user experience.

### Separate metadata from price

The extension should render the market title, outcomes, image, and loading price
state as soon as catalogue search and local matching finish. It should then
request quotes for only the token IDs on selected cards.

This order matters. Requesting quotes for every search candidate wastes CLOB
capacity and recreates a rendering barrier.

### Update cards in place

Each card needs a stable render key made from post ID, event ID, market ID, and
outcome token ID. Apply quote responses only if that key is still current. A
late response for a recycled or removed feed node must do nothing.

### Trading interaction

The catalogue response already contains condition IDs and CLOB token IDs. The
extension should stop fetching a full Gamma event just to recover token IDs.

Keep the current order-book fetch on user interaction. The catalogue improves
discovery and token mapping; it does not replace fresh trade data.

### First-use model cost

Catalogue latency is only one part of first-use latency. The extension also
loads local NLP and embedding assets on first use. Benchmark these separately:

- Catalogue network and server latency.
- Extension model download and initialization.
- Local scoring time.
- Time from first eligible post to first card shell.
- Time from card shell to fresh quote.

Do not attribute a slow model initialization to the catalogue, or hide a slow
catalogue behind model timing.

## Rate-limit and capacity model

### Published provider limits

Polymarket documents IP-based sliding-window limits. Excess requests are
throttled or queued instead of always returning an immediate rejection.

| Endpoint | Published limit | Knoww planning ceiling at 80 percent |
|---|---:|---:|
| Gamma `/public-search` | 350 per 10 seconds | 280 per 10 seconds |
| Gamma `/events` | 500 per 10 seconds | 400 per 10 seconds |
| Gamma `/markets` | 300 per 10 seconds | 240 per 10 seconds |
| CLOB `/midpoints` | 500 per 10 seconds | 400 per 10 seconds |
| CLOB `/prices` | 500 per 10 seconds | 400 per 10 seconds |
| CLOB `/books` | 500 per 10 seconds | 400 per 10 seconds |

The current search can use one `/public-search` and two `/events` calls. Under
the 80 percent ceilings, a two-tag search is limited to 200 searches per 10
seconds because two event requests consume the 400 request event budget. That
is 20 searches per second before retries.

### Current design planning model

Assumptions:

- Every user creates four unique searches in the first feed wave.
- Each search can use two tag fallbacks.
- No cache sharing occurs between distinct queries.
- Limits use fixed 10 second planning windows. The provider uses sliding
  windows, so this table is optimistic at boundaries.

"Final-wave delay" means the time before the final admitted group can start. It
does not include network, local model, or rendering time.

| Concurrent users | One search, no tags | One search, two tags | Four searches, two tags | Maximum current upstream calls |
|---:|---:|---:|---:|---:|
| 100 | 0 s | 0 s | 10 s | 1,200 |
| 1,000 | 30 s | 40 s | 3 min 10 s | 12,000 |
| 10,000 | 5 min 50 s | 8 min 10 s | 33 min 10 s | 120,000 |
| 100,000 | 59 min 30 s | 1 h 23 min 10 s | 5 h 33 min 10 s | 1,200,000 |

For the four-search, two-tag workload to finish within five seconds, Knoww must
avoid this share of user-driven Gamma searches:

| Concurrent users | Required upstream offload |
|---:|---:|
| 100 | 75% |
| 1,000 | 97.5% |
| 10,000 | 99.75% |
| 100,000 | 99.975% |

Only a local catalogue gets close to the final two rows. Query caching cannot
promise that offload for unique post text.

### Catalogue design planning model

With four search operations per user and a maximum of three operations per HTTP
batch:

| Concurrent users | Search operations | Batched HTTP requests | HTTP request rate over 5 s | User-driven Gamma calls |
|---:|---:|---:|---:|---:|
| 100 | 400 | 200 | 40 per second | 0 |
| 1,000 | 4,000 | 2,000 | 400 per second | 0 |
| 10,000 | 40,000 | 20,000 | 4,000 per second | 0 |
| 100,000 | 400,000 | 200,000 | 40,000 per second | 0 |

This moves the scale test to Knoww's Worker, D1 query plan, response size, and
extension behavior. It does not make the work free. The benchmark must prove
that D1 FTS5 and its read replicas can sustain the intended burst. If they
cannot, keep D1 canonical and replace only the `CatalogSearchRepository` serving
adapter with an immutable in-memory index artefact or a dedicated search
service.

### Provider traffic after migration

Gamma traffic should depend on catalogue size and change rate, not user count:

```text
Gamma requests per hour
  = fast-sync pages per minute * 60
  + full-reconcile pages per hour
  + globally admitted fallback requests
```

Track this formula in metrics. A rise that follows user traffic means a fallback
or cache bug has reintroduced the original design.

## Caching and storage rules

### D1

D1 is the canonical store. Create a new binding and database. Do not reuse
`AGENT_DB`.

Enable read replication only after the local and production shadow tests pass.
Use D1 Sessions for the FTS query and hydration queries. Record `rows_read`,
`rows_written`, serving region, and primary-versus-replica metadata from query
results.

### Process-local cache

A bounded in-memory L1 cache is useful for repeated queries within one isolate.
It must include these key parts:

```text
normalized query
sorted tag filters
limit
catalogue complete version
ranking version
```

An isolate restart only lowers hit rate. It must not affect correctness.

### HTTP edge cache

Keep metadata search responses cacheable for a short period. Do not place live
quotes in the same cacheable response because their freshness window is much
shorter.

### Workers KV

KV is optional. It may hold:

- Immutable, versioned compact search artefacts.
- A pointer to the latest complete artefact when up to 60 seconds of propagation
  delay is acceptable.
- Carefully selected popular-query results if promotion is based on measured
  reuse.

KV must not hold:

- Live prices.
- Provider token-bucket counters.
- Sync leases.
- Per-user state.
- Every unique post query.

KV is eventually consistent. Changes can take 60 seconds or more to appear in
other locations, and the same key accepts at most one write per second. Its paid
tier also charges more for writes than reads. Immutable versioned keys avoid
overwriting a hot key, but a pointer still has eventual propagation.

### Durable Objects

Use separate classes or namespaces for separate jobs:

- `CATALOG_COORDINATOR` for sync and Gamma quota state.
- `MARKET_PRICE_CACHE` for the later websocket and hot quotes.

Do not mix OAuth state from the MCP Worker, catalogue locks, and live prices in
one object. Their lifecycle and rollback needs differ.

## Failure behavior

| Failure | Required behavior |
|---|---|
| Fast sync fails | Keep the last complete catalogue, mark age, back off, and retry next tick. |
| Full reconciliation fails halfway | Do not retire unseen records. Save a checkpoint or abandon the run without publishing a complete version. |
| D1 FTS query fails | Try a fresh process-local or edge-cached response. If none exists, use the bounded fallback only when admitted. |
| Catalogue is stale but readable | Serve it with `STALE` or `DEGRADED` status. Do not return an empty success. |
| Gamma fallback reaches its budget | Fail with a typed degraded response. Never bypass the coordinator. |
| One upstream page is malformed | Reject the page, keep prior records, increment validation metrics, and alert after the threshold. |
| Quote websocket disconnects | Mark entries stale, reconnect with jitter, resubscribe, and obtain fresh snapshots. |
| CLOB batch HTTP fails | Return stale quotes within the stale window and mark missing tokens unavailable. Search metadata still renders. |
| Midpoint cannot be computed | Return `midpoint: null`. Use labelled last trade if valid, otherwise show updating or unavailable. |
| One batch subquery fails | Return an error for that `requestId`; preserve successful sibling results. |
| Extension context or DOM node disappears | Cancel or ignore pending work using stable request and render keys. |

The fallback policy needs a circuit breaker. Open it after repeated provider
timeouts or malformed responses, probe at a low rate, and close it after a
measured recovery window. Cache fallback failures for a short period so every
request does not become a probe.

## Security and privacy

### API requirements

- Validate query strings, tag slugs, limits, batch counts, request IDs, token
  IDs, and body size.
- Validate every Gamma, CLOB HTTP, and websocket payload at the boundary.
- Use fixed provider base URLs. User input must never choose an upstream host.
- Keep extension CORS allowlisting and preflight behavior.
- Apply per-client limits and count each batch item.
- Use a distributed abuse limit for the production batch route. The current
  process-local limiter is not a global provider guard.
- Add OpenAPI annotations to every new route.
- Return user-safe errors without stack traces or provider bodies.
- Use `@knoww/logger`. Do not add `console.log`.
- Keep all prices and amounts as strings or Decimal.js values.

### Internal endpoints

If implementation adds a manual sync or detailed health endpoint, it must use
strong internal authentication. A public health response may expose only:

- Ready or degraded state.
- Catalogue age bucket.
- Current complete version.
- Last successful sync time.

It must not expose D1 queries, bindings, provider cursors, lease IDs, or raw
failure details.

### Query privacy

Post-derived queries can contain names, handles, or fragments of private page
content. Default logs should record:

- Query length and token count.
- A rotating keyed hash for short-term deduplication.
- Tag count.
- Result count and timing.

Do not log raw queries by default. If a sampled relevance dataset is approved,
define consent, redaction, retention, and access rules before collection.

## Observability

### Catalogue metrics

- `catalog_sync_started_total{mode}`
- `catalog_sync_completed_total{mode}`
- `catalog_sync_failed_total{mode,reason}`
- `catalog_sync_duration_ms{mode}`
- `catalog_age_ms`
- `catalog_events_active`
- `catalog_markets_active`
- `catalog_records_inserted_total`
- `catalog_records_updated_total`
- `catalog_records_unchanged_total`
- `catalog_records_retired_total`
- `catalog_payload_validation_failed_total{entity}`
- `catalog_d1_rows_read_total{operation}`
- `catalog_d1_rows_written_total{operation}`

### Search metrics

- `extension_search_requests_total{source,status}`
- `extension_search_operations_total{source,status}`
- `extension_search_duration_ms{source,cache}`
- `extension_search_result_count{source}`
- `extension_search_l1_hit_total`
- `extension_search_edge_hit_total`
- `extension_search_inflight_coalesced_total`
- `extension_search_gamma_fallback_total{reason}`
- `extension_search_gamma_queue_wait_ms{endpoint}`
- `extension_search_shadow_overlap_at_8`
- `extension_search_shadow_overlap_at_20`
- `extension_search_shadow_top_1_match`

### Price metrics

- `market_quote_requests_total{status}`
- `market_quote_age_ms{source}`
- `market_quote_cache_hit_total{source}`
- `market_quote_batch_size{endpoint}`
- `market_quote_missing_total`
- `market_price_ws_connected`
- `market_price_ws_reconnect_total{reason}`
- `market_price_ws_subscribed_tokens`
- `market_price_http_queue_wait_ms{endpoint}`
- `market_price_provider_requests_total{endpoint,status}`

### Extension timing

- Eligible post to search start.
- Search start to metadata response.
- Metadata response to local scoring finish.
- Scoring finish to first card shell.
- Card shell to fresh quote.
- Whole micro-batch duration.
- Model cold-start and warm-start duration.

### Initial alerts

- No successful fast sync for 5 minutes.
- No successful full reconciliation for 2 hours.
- Active event or market count drops beyond the configured guard.
- More than 1 percent of searches use Gamma fallback for 10 minutes.
- Any Gamma call caused by a catalogue-enabled request while catalogue status
  is `FRESH`.
- p95 first-card latency above 2 seconds for 15 minutes.
- More than 5 percent of visible card quotes are older than 5 seconds.
- Provider queue wait consumes more than half the route timeout.

## Test and benchmark plan

### Unit tests

- Gamma event, market, tag, outcome, token ID, and timestamp validation.
- Nested market filtering without flattening.
- Outcome-to-token alignment.
- Decimal string normalization and rank-bucket calculation.
- Metadata fingerprint stability.
- FTS query escaping and normalization.
- Ranking behavior for event title, market question, grouped title, outcomes,
  tags, dates, and volume tie-breaks.
- Catalogue state and stale-state calculation.
- Quote midpoint rules for empty, one-sided, crossed, and valid books.
- `/price` side normalization to best bid and best ask.
- Batch validation and per-item error isolation.
- Sync lease expiry, renewal, and takeover.
- Token-bucket refill and endpoint isolation.

### Integration tests

Use recorded, redacted fixtures and a fake provider. Include:

- Multiple keyset pages and `next_cursor` handling.
- Equal `updatedAt` timestamps across page boundaries.
- A new event, changed nested market, resolved market, and removed event.
- A failed page during full reconciliation.
- A suspicious mass-drop response.
- Gamma's JSON-string and array variants.
- Missing IDs and mismatched outcomes/token IDs.
- D1 migration, FTS index update, search, and hydration.
- D1 session behavior when candidate and child records change.
- Websocket reconnect, resubscribe, initial dump, and stale transition.
- CLOB batch deduplication and partial missing-token responses.

### Search relevance set

Build a checked-in fixture with at least these classes:

- Binary Yes/No markets.
- Grouped candidate and team winner events.
- Numeric threshold ladders.
- Sports moneylines and props.
- Crypto price and date markets.
- Similar titles with different dates.
- Posts that match an outcome but not the event title.
- Tag-only queries.
- Ambiguous and no-match posts.

For each query, record acceptable event IDs rather than one forced result when
several events are valid. Measure recall at 8 and 20, top-1 accuracy, no-match
precision, and nested-option recall.

### Load harness

Do not send synthetic large-scale traffic to Polymarket. Build fake Gamma and
CLOB adapters with exact sliding-window limiters and controllable latency.

Run these scenarios:

| Scenario | Query distribution | Provider behavior |
|---|---|---|
| Unique cold | Every query differs | Normal latency |
| Identical stampede | Every query is the same | Normal latency |
| Production-shaped | Zipf-like repeated topics plus unique post text | Normal latency |
| Slow Gamma | Mixed queries | Requests are delayed near the safe budget |
| Gamma outage | Mixed queries | 503 and timeout |
| Malformed page | Scheduled sync | HTTP 200 with invalid nested records |
| Cold quotes | Distinct token IDs | Batch CLOB HTTP only |
| Hot quotes | Popular token IDs | Websocket cache hits |
| Websocket reconnect | Popular token IDs | Disconnect during updates |

Test 100, 1,000, 10,000, and 100,000 virtual users. The last two may require a
distributed load generator. Ramp before a burst so the test can separate cold
deployment startup from steady capacity, then run a separate cold-start burst.

### Acceptance gates

- Warm catalogue search p95 at or below 300 ms.
- Cold catalogue search p95 at or below 750 ms.
- First useful card shell p95 at or below 2 seconds on a warm extension.
- No card waits for posts outside its three-post micro-batch.
- Zero Gamma calls from catalogue-enabled search requests while the catalogue
  is fresh.
- Gamma traffic never exceeds 280 `/public-search` or 400 `/events` requests in
  any observed 10 second window.
- Each CLOB batch endpoint stays at or below 400 requests in any 10 second
  window.
- Catalogue recall at 20 is no worse than the current Gamma candidate set on the
  approved fixture and shadow sample.
- Nested outcome recall improves over the current search text.
- No numeric `0.5` fallback appears for an unknown quote.
- Hot quote p95 at or below 300 ms.
- Cold quote p95 at or below 1 second when the provider is healthy.
- Search errors do not leak stack traces or SQL.
- D1 query plans use FTS and indexed hydration. No accidental full catalogue
  scan appears in normal search.
- Rows read, rows written, Worker CPU, response size, and Durable Object duration
  remain within the approved monthly budget model.

### Repository checks

The later implementation should finish with the existing commands:

```bash
pnpm --filter @knoww/web test
pnpm --filter @knoww/web typecheck
pnpm --filter @knoww/web build
pnpm --filter @knoww/extension test
pnpm --filter @knoww/extension typecheck
pnpm --filter @knoww/extension build
```

Add explicit local and remote catalogue migration scripts before creating the
database. Do not rely on engineers remembering raw Wrangler commands.

## Production rollout and rollback

Knoww currently deploys the web Worker directly from the main branch and does
not plan a separate remote staging Worker. Use local tests and production shadow
mode instead of making staging a prerequisite.

### Rollout sequence

1. Deploy the new D1 binding, migrations, coordinator, and sync code with all
   user-facing flags off.
2. Bootstrap the production catalogue through an attended operation.
3. Run fast and full sync for at least 24 hours. Verify counts, age, D1 cost
   metrics, and failure recovery.
4. Enable `shadow` search on the compatibility route. Return Gamma results and
   compare catalogue results in the background without logging raw queries.
5. Fix schema, nested-market, recall, and ranking gaps until the acceptance
   gates pass.
6. Add the quote route and card loading, stale, and unavailable states.
7. Move the new extension to rolling micro-batches and the versioned batch
   contract.
8. Enable catalogue primary on that versioned path for internal users, then 1
   percent, 5 percent, 25 percent, and 100 percent of capable extension traffic.
9. Remove direct extension Gamma discovery and token-ID refresh only after the
   new path has completed a full release cycle.
10. Keep old clients on the compatibility path until the support policy permits
    retirement or the legacy response has safe CLOB price enrichment.
11. Keep bounded fallback until the next release proves the catalogue path can
    recover without it for ordinary outages.

Feature assignment must be stable for a client during a session. A rotating
random decision per request would mix providers within one feed and make metrics
hard to interpret.

### Rollback

Rollback order:

1. Set search mode to `off` so `GET /api/search` returns the current Gamma path.
2. Keep catalogue sync running unless sync itself caused the incident.
3. Disable the batch route in the extension feature flag and return to the
   compatibility route.
4. Keep the last complete D1 catalogue for diagnosis.
5. Roll back code only after traffic is off the failing path.

Do not delete D1 data, Durable Object namespaces, or KV bindings during an
ordinary rollback. Cloudflare code rollback does not roll back those stores.

## Implementation phases

### Phase 0: measurements and final backend gate

- Measure active event, market, outcome, and tag counts.
- Measure normalized row and search-document size.
- Benchmark D1 FTS5 with the planned query and hydration pattern.
- Capture current first-card, search, model cold-start, and whole-batch timing.
- Confirm the provider's `updatedAt` ordering behavior.
- Decide whether D1 FTS5 passes the 10,000 and 100,000 user serving tests.

Exit: D1 stays the first serving backend, or the team records a replacement
adapter while retaining D1 as canonical storage.

### Phase 1: shared catalogue domain model

- Add normalized event, market, outcome, tag, sync, and search types.
- Add strict Gamma schemas and normalization.
- Add fingerprints and Decimal-based rank buckets.
- Define `CatalogRepository`, `CatalogSearchRepository`, and
  `CatalogSource` interfaces.
- Add fixture-driven unit tests.

Exit: provider payloads can be normalized without web, extension, or D1 code.

### Phase 2: D1 storage and sync

- Add the separate D1 binding and migrations.
- Implement the D1 repository and FTS5 index.
- Add the coordinator Durable Object.
- Add bootstrap, fast sync, full reconcile, checkpoints, and count guards.
- Add local cron tests and production health metrics.

Exit: production catalogue sync is healthy for 24 hours with user search off.

### Phase 3: search shadow mode

- Put the current Gamma and new catalogue providers behind one search interface.
- Run catalogue lookup in shadow mode.
- Compare overlap, top result, nested outcomes, latency, and errors.
- Tune FTS fields and tie-breakers from the approved relevance set.

Exit: recall and latency gates pass.

### Phase 4: live card quotes

- Add the quote contract and HTTP batch fallback.
- Remove `0.5` unknown-price fallbacks from extension cards.
- Add loading, stale, unavailable, source, and age state.
- Add the shared websocket cache only after HTTP batching works and is measured.

Exit: selected cards receive a CLOB quote without blocking metadata render.

### Phase 5: extension micro-batches

- Add the batch search client.
- Process three nearest visible posts at a time.
- Allocate and render after each micro-batch.
- Preserve global active-market and post constraints.
- Ignore late work for detached or recycled DOM nodes.

Exit: no whole-feed barrier and first-card p95 meets the gate.

### Phase 6: catalogue primary

- Enable internal traffic, then percentage rollout.
- Keep global Gamma fallback and its circuit breaker.
- Confirm catalogue-capable user traffic no longer controls Gamma request
  volume, and track legacy traffic separately.
- Remove direct token-ID event refresh after supported clients use catalogue
  token mappings.

Exit: 100 percent extension catalogue traffic for one full release cycle.

### Phase 7: cleanup and reuse

- Remove obsolete client queues and compatibility code only after version
  support allows it.
- Decide whether web search and MCP should use the same catalogue repository.
- Reassess the direct web websocket separately.

## Expected repository changes

This is a proposed map. Keep final file names consistent with nearby code.

```text
packages/knoww-services/src/catalog/
  model.ts
  schemas.ts
  normalize.ts
  fingerprints.ts
  repository.ts
  search.ts
  sync.ts

apps/web/migrations/catalog/
  0001_catalog.sql
  0002_catalog_fts.sql

apps/web/src/lib/catalog/
  d1-catalog-repository.ts
  d1-catalog-search-repository.ts
  gamma-catalog-source.ts
  catalog-sync-runner.ts
  catalog-search-provider.ts
  catalog-config.ts
  catalog-metrics.ts

apps/web/src/durable-objects/
  catalog-coordinator.ts
  market-price-cache.ts

apps/web/src/app/api/search/route.ts
apps/web/src/app/api/search/batch/route.ts
apps/web/src/app/api/markets/quotes/route.ts
apps/web/custom-worker.ts
apps/web/wrangler.jsonc

apps/extension/src/content/api.ts
apps/extension/src/content/injection.ts
apps/extension/src/content/ui/cards.ts
apps/extension/src/types/
```

Keep Cloudflare-specific D1 and Durable Object code in `apps/web`. Keep payload
validation, normalized domain types, ranking rules, and provider-independent
sync logic in `@knoww/services` so MCP can reuse them later.

Do not add a new package unless `@knoww/services` creates an actual dependency
cycle. Any new dependency needs an entry in the workspace dependency graph and
a written reason.

## Cloudflare configuration

### Required bindings

Proposed production bindings:

| Binding | Product | Purpose |
|---|---|---|
| `CATALOG_DB` | D1 | Canonical event, market, outcome, tag, search, and sync data. |
| `CATALOG_COORDINATOR` | Durable Object | Sync lease and Gamma quota coordination. |
| `MARKET_PRICE_CACHE` | Durable Object | Later live CLOB websocket and hot quote cache. |
| `CATALOG_CACHE` | KV, optional | Immutable index artefacts or measured popular-query cache. |

Add `CATALOG_DB` as a second D1 entry. Do not change the migration directory of
the existing `AGENT_DB`.

### Cron triggers

Proposed triggers:

```json
{
  "crons": ["* * * * *", "0 * * * *"]
}
```

The every-minute trigger runs fast catalogue sync. The hourly trigger runs full
reconciliation and keeps the existing IndexNow work. The handler must make each
job's enable flag and cron match explicit.

Cloudflare cron changes can take up to 15 minutes to propagate. Test scheduled
handlers locally through Wrangler's scheduled route before deployment.

### Non-secret configuration

Proposed validated variables:

```text
CATALOG_SYNC_ENABLED=false|true
CATALOG_SEARCH_MODE=off|shadow|primary
CATALOG_GAMMA_FALLBACK_ENABLED=false|true
CATALOG_FRESH_MS=<positive integer>
CATALOG_STALE_MAX_MS=<positive integer>
MARKET_PRICE_CACHE_ENABLED=false|true
CARD_QUOTE_FRESH_MS=<positive integer>
CARD_QUOTE_STALE_MAX_MS=<positive integer>
```

Defaults must be safe when a variable is absent. A production deploy with the
new binding but no explicit enable flag should keep user traffic on the current
path.

Gamma catalogue and public CLOB market data need no secret. Keep their base URLs
as fixed code constants. Never expose private CLOB credentials through the
catalogue or quote route.

Regenerate `apps/web/cloudflare-env.d.ts` after changing bindings.

## Cost controls

Cloudflare prices change. Recheck the linked pricing pages before deployment.
As of 2026-08-26:

- Workers Paid has a $5 account minimum, 10 million Worker requests per month,
  then $0.30 per million, plus CPU usage after the included allocation.
- D1 Paid includes 25 billion rows read, 50 million rows written, and 5 GB of
  storage per month. D1 then charges by rows and storage.
- KV Paid includes 10 million reads and 1 million writes per month. Additional
  writes cost far more than additional reads, which is another reason not to
  persist every unique query.
- Durable Objects Paid includes 1 million requests and 400,000 GB-seconds per
  month. Additional duration is charged in rounded units.

One continuously active 128 MB price object consumes about 331,776 GB-seconds
in a 30 day month using Cloudflare's decimal memory calculation. That fits
inside the current 400,000 GB-second inclusion if little other Durable Object
duration uses it. Four continuously active shards use about 1.33 million
GB-seconds before other work. This is why sharding needs a throughput result,
not a guess.

Track these formulas:

```text
Worker request cost
  = search HTTP requests + quote HTTP requests + other dynamic requests

D1 read use
  = FTS rows read + hydration rows read + sync comparison rows read

D1 write use
  = changed catalogue rows + FTS maintenance rows + sync-state rows

Durable Object duration
  = active coordinator duration + active price-cache duration

KV write use
  = immutable artefact keys + promoted popular-query keys
```

Do not publish a dollar forecast until load tests report Worker CPU per request,
D1 row metrics per query, catalogue change rate, hot-token count, and quote hit
rate. The existing web Worker already pays the account minimum, so do not count
a second $5 base unless this design moves into a separate Cloudflare account.

## Open questions

These questions block production enablement, not the first schema work:

1. How many active events, nested markets, outcomes, and token IDs exist at peak?
2. What are the serialized and FTS index sizes of the normalized active corpus?
3. Does D1 FTS5 pass the 10,000 and 100,000 user burst tests with read
   replication, or does search need a different serving adapter?
4. Does Gamma keyset ordering by `updatedAt` remain stable under concurrent
   updates?
5. Is a 2 minute fresh catalogue threshold enough for extension discovery, or
   does product require a stricter 90 second hard state?
6. What percentage of searches need more than two tags or more than 20 events
   for acceptable recall?
7. What hot-token count fits one price-cache object within memory, throughput,
   and cost targets?
8. Should stale card prices remain visible for 30 seconds, or should the UI hide
   them sooner?
9. What is the provider's practical batch item limit for `/midpoints`,
   `/prices`, and `/books`? The public reference does not state one.
10. Should anonymous extension search remain available, or should the batch
    route require an extension session? This needs a product decision that does
    not force wallet login before users see their first card.
11. How long must old extension versions keep the legacy response shape?
12. After extension rollout, should web search and MCP adopt the same catalogue
    immediately or through separate shadow tests?

Record answers in this document or a linked ADR before changing the related
default.

## Definition of done

The catalogue project is complete when all of these statements are true:

- [ ] A separate production D1 catalogue has migrations, a tested
  point-in-time recovery procedure, and an attended bootstrap procedure.
- [ ] Fast sync and hourly reconciliation recover from interruption without
  retiring valid records.
- [ ] Every upstream payload is validated, and nested markets and outcomes stay
  aligned with token IDs.
- [ ] D1 FTS5 or its approved replacement passes relevance and load gates.
- [ ] Steady-state searches from every supported catalogue-capable extension
  make zero Gamma calls. Any remaining legacy Gamma traffic is measured and
  covered by an explicit support deadline.
- [ ] The compatibility route remains safe for supported old clients.
- [ ] The batch route has OpenAPI documentation, validation, CORS, distributed
  rate limiting, structured logs, and per-item quota accounting.
- [ ] Extension cards render by rolling micro-batch and no longer wait for the
  whole pending feed set.
- [ ] Cards never use `0.5` for an unknown price.
- [ ] Card probability comes from a named CLOB source with an age and status.
- [ ] Trade interaction fetches a fresh order book and uses Decimal.js for
  amount-aware calculations.
- [ ] Synthetic scale tests use fake providers and cover 100, 1,000, 10,000,
  and 100,000 users.
- [ ] Production shadow metrics meet the recall, latency, error, quota, and cost
  gates.
- [ ] Production rollout has an `off` switch that does not require code rollback.
- [ ] Runbooks cover stale catalogue, failed sync, D1 errors, quota exhaustion,
  websocket disconnect, and rollback.
- [ ] Documentation and code agree on freshness, price meaning, nested markets,
  and provider limits.

## Sources

Provider and platform facts in this document were checked on 2026-08-26.

### Polymarket

- [API rate limits](https://docs.polymarket.com/api-reference/rate-limits)
- [List events with keyset pagination](https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination)
- [Batch midpoint prices](https://docs.polymarket.com/api-reference/market-data/get-midpoint-prices-request-body)
- [Batch market prices](https://docs.polymarket.com/api-reference/market-data/get-market-prices-request-body)
- [Batch order books](https://docs.polymarket.com/api-reference/market-data/get-order-books-request-body)
- [Single market price and side semantics](https://docs.polymarket.com/api-reference/market-data/get-market-price)
- [Market Channel websocket](https://docs.polymarket.com/api-reference/wss/market)
- [Predictions changelog](https://docs.polymarket.com/changelog/predictions)

### Cloudflare

- [D1 supported SQL and FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [D1 read replication and Sessions](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [How Workers KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [KV write limits](https://developers.cloudflare.com/kv/api/write-key-value-pairs/)
- [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)
- [Durable Object websocket behavior](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
