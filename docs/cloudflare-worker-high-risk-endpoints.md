# Cloudflare Worker high-risk endpoint backlog

**Status:** Open

**Created:** 2026-07-30

**Scope:** Worker-wide risks discovered while investigating
`GET /api/events/league-counts`. The league-count incident has its own
[issue](./cloudflare-worker-league-counts-issue.md) and
[remediation plan](./cloudflare-worker-league-counts-remediation.md); it is not
tracked again here.

## Purpose

Several public routes still perform catalog scans, historical reconstruction,
or caller-controlled fanout synchronously inside a Cloudflare Worker request.
They are not known to have caused the league-count incident, but they can
independently exceed CPU, memory, connection, or wall-time budgets.

This document is the implementation backlog for those routes. Measurements are
diagnostic samples from 2026-07-29, not production percentiles. Reprofile every
route after remediation. Some routes already have useful safeguards; those are
called out explicitly as controls to retain rather than presented as unfinished
work.

## Priority definitions

- **P0:** A public request can start an effectively unbounded or very large
  data pipeline. Remove or contain it before treating the Worker as
  resource-safe.
- **P1:** A normal or caller-selectable request can create multi-megabyte
  buffering, high fanout, or long synchronous aggregation.
- **P2:** Expensive cold-path work is bounded today but should be materialized
  or cached before traffic growth makes it an incident.

## Infrastructure prerequisites

The recommended target architecture is not provisioned yet:

- `apps/web/wrangler.jsonc` has no Workflow or Queue bindings and
  `triggers.crons` is empty.
- The existing `scheduled` handler always enters the agent tick. Adding a cron
  for snapshots or materialization would also call that path unless
  `custom-worker.ts` explicitly dispatches by `controller.cron`.
- The configured D1 binding is `AGENT_DB` and is owned by the agent subsystem.
- The configured R2 binding, `NEXT_INC_CACHE_R2_BUCKET`, is owned by the
  OpenNext incremental-rendering cache. It must not silently become general
  application storage without an explicit ownership and retention decision.

Before implementing Workflow-, Queue-, or cron-based remediations:

1. Choose and provision the required Workflow, Queue, schedule, and persisted
   snapshot/result bindings.
2. Define ownership, retention, versioning, and rollback behavior for each
   stored artifact.
3. Dispatch scheduled events by cron expression or another explicit operation
   identifier so unrelated jobs cannot trigger the agent tick.
4. Add deployment configuration, migrations, access policies, and operational
   alerts before moving request-path work onto the new infrastructure.

## Client and API compatibility constraints

The resource remediations below are not all server-only changes. The following
contracts were verified against the current web and extension callers and must
be updated in lockstep:

- **Event feeds:** there are five `usePaginatedEvents` callers and all request
  `markets=full`. The two sports-live queries and `SportsbookView` request 50
  events; the home and tag feeds request 20. The sports callers do not currently
  fetch a next page, so silently clamping them to 20–25 would remove part of the
  visible slate. Keep 50 temporarily with a smaller sports-specific projection,
  or add explicit/aggressive sports pagination before lowering the cap. The
  initial SSR page also calls `toSlimGammaEvent(event, true)`, so projection
  changes must update SSR types and hydration behavior together.
- **Batch price history:** the multi-outcome event-detail chart requests the
  YES and NO tokens for its top five markets — ten tokens in one batch. The
  chart deliberately fetches the NO series even while the "Both" toggle is off
  so that toggling is instant, so the ten-token request is the normal case,
  not an edge case. The interactive cap must therefore be at least ten;
  twelve is the recommended value. `MarketsView` can request as many as 40
  leader tokens and must chunk, defer, or lazily fetch before the server cap
  is lowered. Every returned token entry must retain `history: []`; a
  per-token status is additive, while omitting `history` breaks the current
  hook.
- **Whale activity:** the browser currently derives headline totals, buy/sell
  ratio, unique traders, unique markets, whale rows, hot markets, and pressure
  series from the complete `activities` array. Paginating that array without
  server-provided aggregates or client page accumulation would silently make
  every number page-local. Snapshot metadata should distinguish snapshot age
  from live-delta freshness instead of overloading one `lastUpdated` timestamp.
- **Search:** the web UI needs event-card fields, tags, and
  `pagination.totalResults`; profiles are not consumed. The extension also uses
  event descriptions and slim nested markets for relevance scoring and cards.
  Its nested projection must retain `question`, `groupItemTitle`, `outcomes`,
  `outcomePrices`, `volume`, `conditionId`, and active/closed/archived/order
  status. `clobTokenIds` can be omitted because the extension refreshes token
  identity before opening a trade.
- **Backtest:** `BacktestClient` treats any successful HTTP response as a final
  `BacktestResult`. Returning a `202` job envelope without updating the client
  would pass incomplete data to the results renderer. Add job-started,
  polling/progress, failure, and final-result states with the asynchronous API.
- **Polygon RPC:** an allowlist must preserve the methods used by viem/wagmi
  public-client paths, including receipt replacement detection. The initial
  allowlist is documented in the RPC section below. The repository has no
  application call to `eth_getLogs`, but runtime telemetry and wallet-flow
  integration tests remain the authority before removing or adding methods.
- **Trader X-profile:** the only consumer is the extension's X.com badge
  injector. Its validator requires `handle`, `proxyWallet`, `pnl`, `vol`, and
  `rank`; dropping any field silently disables every badge. It also accepts
  only HTTP `200` — any other status, including `202` or `204` from a new
  snapshot-serving path, is negative-cached per handle for ten minutes. The
  owner has approved caching this route's data for 30 minutes, since the
  underlying leaderboard mapping changes infrequently.
- **Suspicious whales:** the UI's most aggressive preset sends
  `minUsdValue=100`, so any enforced server-side minimum must be at most 100.
  The drilldown reads `analysis.archetypes`, `analysis.owner`, and
  `analysis.funding`, which bounded scoring must keep populated.
- **Closed-time lookup:** the portfolio sends every unique lost-position
  condition ID in one request, while the route currently slices to 50. The new
  direct index should accept a declared bounded list or the client must chunk
  without losing ID-to-slug alignment.
- **Shared response envelopes:** the shared client `fetchJson` throws on
  non-2xx responses and on `{ success: false }`, and it has no built-in timeout.
  A response containing useful stale or partial data must remain `200` with
  `success: true` and explicit `partial`, `degraded`, coverage, and timestamp
  metadata. Genuine failures should remain errors. Add cancellation/deadline
  behavior at the request or wrapper level rather than silently converting
  failures into empty successful data.

One reported UI bug was rejected during verification: `/whales` already has
explicit zero-result states in the whale, insider, activity, hot-market, and
pressure-chart components. The parent loading messages are gated on
`isLoading`, but a legitimate empty result does not render a wholly blank
panel. Do not create a separate empty-state work item unless runtime testing
finds a different uncovered state.

## Summary

| Priority | Endpoint | Primary risk | Recommended direction | Status |
| --- | --- | --- | --- | --- |
| P0 | `GET /api/whales/backtest` | Public synchronous data pipeline | Authorized asynchronous Workflow with persisted results | Open |
| P1 | `GET /sitemap.xml` | Cold catalog regeneration and multi-MB parsing | Pre-generated versioned sitemap artifacts | Open |
| P1 | `POST /api/markets/price-history/batch` | Forty-way fanout without complete deadline semantics | Smaller bounded batches with concurrency, timeouts, and per-item status | Interim mitigations implemented — lower token cap and delta caching open |
| P1 | `GET /api/events/list` | Full nested Gamma objects and unbounded query controls | Remove if unused; otherwise validate, cap, and return a slim projection | Open |
| P1 | Event feed routes | Large upstream bodies, inconsistent validation, and an uncapped breaking feed | One strict query policy and tighter use of the existing slim projection | Open |
| P1 | `GET /api/search` | Full nested tag-event objects retained | Dedicated search-card projection and bounded merging | Open |
| P1 | `GET /api/whales/activity` | N+1 wallet fanout and large response | Shared materialized snapshot plus paginated live overlay | Open |
| P1 | `GET /api/user/pnl` | Long, incomplete historical reconstruction | Materialized wallet PnL or asynchronous history job | Open |
| P1 | `GET /api/markets/closed-time` | Global scan for a keyed lookup | Persisted condition-ID index with direct-lookup fallback | Interim mitigations implemented — persisted index still open |
| P1 | `POST /api/rpc/polygon` | Caller-controlled batch and response size | Method allowlist, batch/range caps, and byte-limited responses | Largely implemented — durable rate limiting and production integration tests open |
| P1/P2 | `GET /api/whales/suspicious` | Caller-controlled wallet-history crawl | Scheduled feature materialization and bounded scoring | Open |
| P2 | `GET /api/trader/x-profile` | Forty-two-way concurrent cold-index burst | Persisted address-to-handle index | Open |

## P0: Whales backtest

**Route:** `apps/web/src/app/api/whales/backtest/route.ts`

### Evidence

- Can inspect up to 40 pages of 500 resolved-market discovery rows.
- Can make up to 200 market-trade requests.
- Each of as many as 40 selected markets can contribute up to 300 sampled
  trades. The resulting unique-wallet set has no independent cap and feeds two
  per-wallet history pipelines, each of which can walk up to five pages.
- Continues into resolution discovery and price histories.
- The complete pipeline currently runs synchronously behind a public `GET`.
- The route has an application-level limit of two requests per five minutes per
  IP and declares `maxDuration = 180`. Neither control bounds the work inside
  one invocation, and the rate limiter is isolate-local.

### Risk

One allowed request can occupy a Worker for a long period and generate a
data-dependent number of third-party calls. The theoretical wallet candidate
set can reach 12,000 before caches or duplicate addresses reduce it. Per-IP rate
limiting and a platform duration declaration do not make one invocation safe
against CPU, memory, or subrequest exhaustion.

### Recommended remediation

1. Replace the synchronous `GET` with an authenticated job-creation mutation.
2. Require administrator authorization and an idempotency key.
3. Start a Cloudflare Workflow and return `202` with a job identifier.
4. Update `BacktestClient` to represent job-started, progress/polling, failed,
   cancelled, and completed states instead of treating every 2xx response as a
   final `BacktestResult`.
5. Split discovery, trade loading, wallet analysis, and price history into
   retryable Workflow steps.
6. Persist progress and final artifacts in D1 or R2.
7. Add lightweight status and result-download endpoints.
8. Apply explicit market, wallet, page, subrequest, and total-runtime budgets
   to every job.

### Interim controls

- Disable the public route or restrict it to administrators.
- Reject parameters above a conservative fixed workload.
- Retain the current per-IP limiter as isolate protection, but do not treat it
  as durable/global abuse prevention.
- Do not rely on a higher Worker CPU limit as the remediation.

### Done when

- The initial HTTP request performs no catalog or wallet-history scan.
- The request returns `202` within a small fixed CPU and subrequest budget.
- The web client never renders a `202` job envelope as a completed result.
- Jobs are idempotent, retryable, cancellable, and expose bounded progress.
- Jobs enforce independent market, wallet, subrequest, byte, and runtime
  budgets.
- Partial or failed jobs cannot be mistaken for complete backtest results.

## P1: Sitemap generation

**Route:** `apps/web/src/app/sitemap.ts`

### Evidence

- Observed cold generation: 10.79 seconds; warm response: 32 milliseconds.
- Response was approximately 151 KB.
- Regeneration can walk up to 13 pages.
- Sampled first active and resolved pages were approximately 9.3 MB and
  8.1 MB.

### Risk

A crawler request can trigger concurrent parsing of several multi-megabyte
Gamma responses. Cache expiry, deployment, or regional cold starts can
reintroduce the full cost.

### Recommended remediation

1. Generate versioned sitemap segments outside crawler requests.
2. Store generated XML in R2 or deploy it as static assets.
3. Serve a small sitemap index pointing to bounded segment files.
4. Publish a new version only after every segment succeeds.
5. Keep serving the previous version when generation fails.
6. Refresh on a scheduled Workflow or ingestion event, not through a crawler
   request.

### Interim controls

- Increase the existing regeneration interval.
- Ensure only one regeneration runs at a time.
- Bound the number of catalog pages and preserve the last successful sitemap.

### Done when

- `GET /sitemap.xml` performs no Gamma request.
- Cold and warm requests have equivalent bounded behavior.
- A failed refresh leaves the previous complete sitemap available.

## P1: Batch price history

**Route:** `apps/web/src/app/api/markets/price-history/batch/route.ts`

### Baseline findings (original audit)

- Accepted as many as 40 tokens through one unrestricted `Promise.all`.
- A 40-token probe exceeded 90 seconds.
- A later five-token probe exceeded 45 seconds.
- One token took 10.4 seconds.
- There was no per-fetch timeout or overall request deadline.
- A token failure was converted into an empty history, after which the route
  returned `success: true`.
- The successful response carried a five-minute price-history cache profile,
  and the React Query consumer treated the empty result as successful data
  for five minutes. Edge caching of this `POST` response is not assumed.
- The multi-outcome event-detail chart requests five YES plus five NO
  histories (ten tokens) in one batch. The NO tokens are fetched even while
  the "Both" toggle is off so that toggling on requires no new round trip.
- `MarketsView` currently collects as many as 40 leader-token histories in one
  call.

### Interim mitigations implemented

Implemented in `route.ts` (covered by `route.test.ts`) and in the
`use-price-history-batch` hook:

- Upstream fetches run through a four-way concurrency pool instead of an
  unrestricted `Promise.all`.
- Each token fetch has an 8-second timeout and the whole request a 25-second
  deadline, both enforced with `AbortController`; a client disconnect aborts
  all pending upstream work through the same controller.
- Every token returns a per-token `status` (`ok`, `not_found`, `timeout`,
  `upstream_error`) while always retaining a `history` array, so existing
  consumers keep working unchanged.
- `partial: true` is set only for transient statuses (`timeout`,
  `upstream_error`); `not_found` is a stable, complete answer. Partial
  responses are sent with `Cache-Control: no-store` so an incomplete batch
  is never pinned in any cache, while complete responses keep the
  price-history cache profile.
- The `use-price-history-batch` hook skips caching transient-failure entries,
  shortens `staleTime` for partial data, and actively re-polls
  (`refetchInterval`) until a complete response lands — a cached failure can
  no longer masquerade as five minutes of "no data". The event-detail
  outcome-table query (`use-chart-range-history`) applies the same
  partial-aware refetch policy.

### Remaining remediation (open)

1. Set the initial interactive server limit to twelve tokens, which covers
   the ten-token event-detail chart. Raise it further only if maximum-input
   profiling proves a higher cap safe.
2. Update `MarketsView` to chunk, defer, or lazily request its possible
   40-token workload before enforcing the lower server limit. Event detail
   needs no batching change at a twelve-token limit; if the cap must go
   below ten, the detail chart must first defer its NO-token fetch until the
   "Both" toggle is enabled, giving up the current instant-toggle behavior.
3. Cache immutable historical intervals and request only the recent delta.
4. Use an asynchronous export job when callers need more than the interactive
   limit.

### Done when

- The maximum interactive batch completes inside the declared deadline.
- No failure is returned as a successful empty history. (Implemented.)
- Existing callers always receive `history: []` for a token with no points;
  per-token status is additive. (Implemented.)
- Concurrency, timeout, cancellation, and partial-result behavior have tests.
  (Timeout and partial-result behavior are tested; dedicated concurrency and
  client-abort tests are still open.)

## P1: Full event-list proxy

**Route:** `apps/web/src/app/api/events/list/route.ts`

### Evidence

- Default response observed at approximately 2.36 MB.
- Soccer with `limit=100` produced approximately 6.17 MB.
- The route exposes full nested Gamma event and market objects.
- `tag`, `limit`, `closed`, and `after_cursor` are unbounded strings and are
  forwarded to Gamma verbatim (`tag` becomes `tag_slug`); for example,
  `limit=100000` is accepted by the route.
- No in-repository consumer was identified during the audit.

### Risk

The Worker buffers, parses, transforms, and serializes much more data than an
event list needs. Unbounded caller-controlled parameters allow callers to
amplify the cost.

### Recommended remediation

1. Confirm whether an external consumer depends on the route.
2. If unused, deprecate and remove it.
3. If retained, introduce one strict query schema and reject unknown values.
4. Cap the public page size at 20–25.
5. Return the canonical slim event/card projection, never raw Gamma objects.
6. Require a keyed event-detail request for full market data.
7. Cache stable metadata independently from live price and game-state overlays.

### Done when

- A public list response stays below the Worker-wide response budget.
- Unsupported parameters fail validation instead of passing upstream.
- Nested full-market data is unavailable from the list contract.

## P1: Trending, new, breaking, and paginated event feeds

**Routes:**

- `apps/web/src/app/api/events/trending/route.ts`
- `apps/web/src/app/api/events/new/route.ts`
- `apps/web/src/app/api/events/breaking/route.ts`
- `apps/web/src/app/api/events/paginated/route.ts`

### Evidence

- UI-default responses were approximately 28–46 KB.
- Matching upstream bodies were approximately 0.68–2.77 MB.
- Accepted `limit=100` queries produced upstream bodies as large as 9.46 MB.
- Trending and new share a Zod schema with `limit <= 100` and a 512-character
  cursor and reject over-limit input.
- Paginated uses separate hand-written validation, clamps `limit` to 100, and
  permits a 2,048-character cursor.
- Breaking has no equivalent validation or limit cap; it forwards raw query
  strings for limits, filters, and cursors.
- All four routes already use `toSlimGammaEvent`. Its default market projection
  contains only the market ID; `markets=full` expands that to a fixed 15-field
  market projection rather than returning raw Gamma objects.
- `markets=full` is applied after the Gamma response is parsed and is not
  forwarded upstream. It can still produce an approximately 1.49 MB projected
  response while the Worker separately pays the cost of buffering the full
  upstream body.
- All five current `usePaginatedEvents` callers request `markets=full`.
  Home and tag pages request 20 events and implement pagination. Two
  sports-live queries and `SportsbookView` request 50; the sports callers do
  not currently request a next page.
- The initial SSR event page also uses `toSlimGammaEvent(event, true)`.

### Risk

The small default client response hides substantial Worker parsing and
allocation. The richer projection can also create a large downstream response.
The routes have drifted across a shared Zod schema, no validation, and a
hand-written schema with different cursor and over-limit behavior.

### Recommended remediation

1. Share one strict feed-query schema across all feed routes.
2. Cap general feeds at 20–25. Do not silently apply that cap to the current
   50-item sports callers until they paginate; alternatively retain 50 for a
   bounded sports-specific projection.
3. Reject `markets=full` for list requests above a very small item count.
4. Retain `toSlimGammaEvent` as the canonical projection and reduce or split
   its rich-market branch into the fields each card/sports view actually
   consumes.
5. Cache normalized stable metadata and apply live price/game overlays
   separately.
6. Bring the breaking-events route under the same validation and budgets.
7. Update SSR initial-data types and client hydration tests whenever the
   projection changes.

### Done when

- Every feed enforces the same page-size and market-detail policies.
- Upstream and downstream byte counts are emitted as structured telemetry.
- Maximum-input tests prove the route stays inside memory and CPU budgets.

## P1: Search

**Route:** `apps/web/src/app/api/search/route.ts`

### Evidence

- Two tag filters with five events each returned approximately 1.08 MB.
- Tag-derived events retain full nested objects while only card fields are
  required by the web search UI.
- The web search surfaces events, tags, and total-result metadata; no web
  consumer of returned profiles was found.
- The extension calls the same route and uses event descriptions plus nested
  market labels, status, outcomes, prices, volume, and condition identity for
  relevance and cards. It refreshes `clobTokenIds` before trading.

### Risk

Search result breadth multiplies nested payload cost, and merging large objects
increases allocation, sorting, and serialization work.

### Recommended remediation

1. Define explicit web and extension search result contracts. The extension
   contract is an event card plus slim nested markets, not a card-only event.
2. Project Gamma events immediately after each upstream response.
3. Deduplicate and rank slim records rather than full events.
4. Cap tag filters, per-source results, and total merged results.
5. Cache stable query results briefly while keeping live price data separate.
6. Drop profiles from the public response unless a supported consumer is
   introduced; retain tags and `pagination.totalResults` for the web UI.

### Done when

- Search never returns raw nested Gamma event or market objects.
- A maximum valid query remains below the public JSON response budget.
- Web and extension contract tests cover required nested fields, deduplication,
  source limits, and malformed upstream objects.

## P1: Whales activity

**Route:** `apps/web/src/app/api/whales/activity/route.ts`

### Evidence

- Maximum accepted query returned approximately 1.71 MB.
- One request can make up to 102 upstream requests.
- Results then undergo monetary transforms, sorting, and serialization.
- Monetary multiplication and comparisons already use Decimal.js.

### Risk

The route combines N+1 network fanout with CPU-heavy post-processing. Traffic
multiplies the same public aggregation work across isolates.

### Recommended remediation

1. Materialize a shared public whale-activity snapshot.
2. Refresh it outside individual viewer requests.
3. Serve a paginated snapshot plus a small, bounded live delta and
   server-provided global aggregates for all headline and chart statistics.
4. Batch upstream lookups where an API exists; otherwise use bounded
   concurrency and shared per-wallet caches.
5. Limit whale count, activity rows, and total response bytes independently.
6. Continue using Decimal.js for monetary calculations.
7. Expose snapshot and live-delta timestamps separately so the UI can show
   freshness without confusing snapshot age with overlay age.

### Done when

- A viewer request performs only snapshot reads and a small bounded overlay.
- Pagination has a stable cursor and declared completeness semantics.
- Headline totals and chart aggregates remain invariant while activity pages
  are loaded.
- Maximum fanout and response size are covered by tests and telemetry.

## P1: User PnL

**Route:** `apps/web/src/app/api/user/pnl/route.ts`

### Evidence

- A high-activity wallet took 13.19 seconds.
- The request read 18 pages and approximately 1.57 MB.
- The result still reported activity truncation.
- The current implementation already calls the dedicated upstream PnL API,
  uses Decimal.js for monetary aggregation, caps activity and position walks at
  10 pages each, and returns explicit completeness/page/truncation fields.
- Position and activity pages are still fetched serially and unconditionally,
  including when the dedicated PnL response succeeds.

### Risk

Users can wait a long time for a computation that remains incomplete. Repeated
requests reconstruct the same history and can contend for Worker resources.

### Recommended remediation

1. Continue using the dedicated upstream PnL API for headline PnL. Avoid
   unconditional position/activity reconstruction for response shapes that do
   not require it.
2. Maintain a materialized per-wallet PnL snapshot and update it incrementally.
3. Retain the existing page caps and completeness fields; add a strict
   wall-time deadline for any synchronous recent-period reconstruction.
4. Start an asynchronous history job for longer periods or cache misses.
5. Retain explicit completeness and truncation semantics and add coverage
   timestamps.
6. Retain Decimal.js for all monetary aggregation.

### Done when

- The interactive path retains its fixed page budget and has an enforced
  wall-time deadline.
- Complete and incomplete results cannot share the same response semantics.
- Repeated requests for the same wallet reuse materialized work.

## P1: Market closed-time lookup

**Route:** `apps/web/src/app/api/markets/closed-time/route.ts`

### Baseline findings (original audit)

- Every origin-handler invocation starts by scanning as many as five pages of
  500 markets, approximately 3.2 MB. Both Gamma request paths use
  `cache: "no-store"`; there is no server-side condition-ID cache or index.
- It may then make 50 event lookups and 50 CLOB lookups.
- The caller is asking for a keyed value, but the route performs a global
  catalog scan.
- The portfolio caller sent all unique lost-position condition IDs in one
  request, while the route silently truncated the parsed list to 50.
- Gamma, event, and CLOB failures were swallowed without structured logging,
  and the route could return `success: true` with an incomplete `closedTimes`
  map indistinguishable from genuinely missing data.
- The final response receives edge/browser cache headers, which may prevent
  some origin invocations but do not change the behavior of an invocation that
  reaches the handler.

### Interim mitigations implemented

Implemented in `route.ts` (covered by `route.test.ts`) and in the portfolio
client (`src/lib/closed-time-resolver.ts`, covered by
`closed-time-resolver.test.ts`):

- The 50-id cap is explicit: requests above it are processed for the first 50
  ids and flagged with `truncated: true` plus a `resolve.truncated` warning
  log — never a silent slice.
- Upstream failures set `partial: true` on the body, so clients can
  distinguish "upstream failed, retry" from "market genuinely has no
  closedTime". Complete empty answers carry neither flag and stay cacheable.
- Degraded responses (`partial` or `truncated`) are sent with
  `Cache-Control: no-store` so an incomplete map is never pinned in a shared
  cache.
- Per-source failures are logged through the structured logger instead of
  being swallowed.
- The portfolio caller chunks its condition-id list at 50 with the
  condition-ID-to-slug pairing preserved per chunk, merges results across
  chunks, retries failed chunks (and only the unresolved ids of partial
  chunks) with linear backoff, caps retries at three attempts, and cancels
  timers on unmount.

### Remaining remediation (open)

1. Maintain a condition-ID-to-closed-time index in D1, KV, or R2.
2. Populate it during normal market ingestion/resolution processing.
3. Query a supplied event slug or known market identifier directly on a miss.
4. Deduplicate concurrent misses for the same identifier.
5. Never run a global closed-market scan in the HTTP request.
6. Emit lookup counts, latency, and fallback reasons alongside the existing
   per-source failure logs.

### Done when

- A keyed hit uses one storage read.
- A keyed miss uses a small fixed number of direct upstream lookups.
- No request walks the global market catalog.
- Upstream failure cannot be returned as indistinguishable successful missing
  data, and every fallback is observable. (Implemented — `partial` /
  `truncated` flags plus structured logging.)

## P1: Polygon RPC proxy

**Route:** `apps/web/src/app/api/rpc/polygon/route.ts`

### Evidence (updated after remediation)

Implemented in `route.ts` and covered by `route.test.ts`:

- Request bodies up to 100 KB are accepted (unchanged, intentional).
- JSON-RPC batches are capped at 10 items; empty batches are rejected; every
  batch element is validated independently.
- The method denylist has been replaced with a read-method allowlist
  (`ALLOWED_RPC_METHODS`); unknown methods return 403 before any upstream
  request and are logged via `method.rejected`.
- The allowlist is trimmed to the 13 methods a repository grep shows the
  app's clients issuing (`eth_chainId`, `eth_blockNumber`,
  `eth_getBlockByNumber`, `eth_call`, `eth_getBalance`, `eth_getCode`,
  `eth_getTransactionCount`, `eth_getTransactionByHash`,
  `eth_getTransactionReceipt`, `eth_estimateGas`, `eth_gasPrice`,
  `eth_feeHistory`, `eth_maxPriorityFeePerGas`). Speculative additions such
  as `eth_getProof`, `eth_getBlockReceipts`, `eth_syncing`, and
  `web3_clientVersion` were removed — a method is added only when an actual
  application flow needs it.
- `eth_getLogs` is excluded from the allowlist — static inspection found no
  application caller, and an unbounded range can force multi-megabyte
  responses.
- Upstream responses are read through a 5 MB byte-limited stream before
  parsing; a `content-length` above the cap short-circuits, and an oversized
  response is terminal (never retried against fallback providers).

### Remaining risk

- Rate limiting is per-isolate request-count only — not durable across
  Workers isolates and not weighted by method cost.
- The allowlist has not yet been validated against production wallet flows
  (runtime method telemetry may reveal an additional required read method).

### Remaining remediation

1. Rate-limit by caller and method cost with durable state, not only
   per-isolate request count.
2. Re-add `eth_getLogs` only if a supported browser flow appears, and then
   only behind a bounded range/address/topic/result policy.
3. Before relying on the allowlist in production, run wallet connection,
   native/ERC-20 balance, contract read, deposit, withdrawal, gas
   estimation, normal receipt, and replacement receipt integration tests.
   Treat runtime method telemetry as authoritative if it reveals an
   additional required read method.

### Done when

- Disallowed methods and oversized batches/ranges fail before an upstream
  request. (Implemented.)
- Response-size enforcement occurs before full buffering. (Implemented.)
- Validation, fallback, timeout, and rate-limit tests cover abusive inputs.
  (Validation/fallback/oversize covered in `route.test.ts`; durable
  rate-limit coverage open.)

## P1/P2: Suspicious-whale analysis

**Route:** `apps/web/src/app/api/whales/suspicious/route.ts`

### Evidence

- In one 500-trade sample, `minUsdValue=0` selected 305 unique wallets.
- Each wallet history can walk five pages.
- A cold resolution-knowledge refresh walks 10 pages of 500 markets.
- A source-code comment estimates that the background knowledge-base build
  takes 30–60 seconds. This is not a measured or enforced bound.
- The knowledge-base pages are fetched serially without a per-page timeout,
  overall deadline, or cancellation signal.

### Risk

A caller-controlled threshold expands the wallet set, while cold knowledge-base
work and per-wallet history fanout multiply the total. HTTP `waitUntil()` is
not a durable execution system for work that may exceed its lifetime.

### Recommended remediation

1. Build and persist the resolution knowledge base on a schedule or ingestion
   event.
2. Materialize bounded wallet features independently of viewer requests.
3. Score only a fixed candidate set in the interactive route.
4. Enforce a non-zero minimum USD threshold and a maximum wallet count.
5. Move broad or historical analysis to a Workflow.
6. Give every build a hard total deadline, per-page timeout, and explicit
   partial/failure outcome.
7. Return the snapshot timestamp, coverage, and scoring version.

### Done when

- The request path never crawls the resolution catalog or arbitrary wallet
  histories.
- Caller parameters cannot increase fanout beyond declared limits.
- Background work uses a durable queue/workflow rather than HTTP
  `waitUntil()`.
- Every build has an enforced deadline and a failed or partial build cannot
  replace the last valid snapshot.

## P2: Trader X-profile index

**Route:** `apps/web/src/app/api/trader/x-profile/route.ts`

### Evidence

- A cold lookup launches 42 leaderboard requests concurrently through one
  `Promise.all`.
- The observed cold path took approximately three seconds.
- Aggregate transfer is currently below one megabyte, making this lower
  priority than the routes above.

### Risk

Every cold isolate can rebuild the same fixed index. The 42-way burst exceeds
the normal outgoing-connection concurrency available to the Worker, and future
leaderboard growth increases the fanout.

### Recommended remediation

1. Persist the address-to-X-handle index in KV, D1, or R2.
2. Refresh it outside individual lookups.
3. Fetch in bounded stages so pagination can stop when an upstream page is
   empty instead of pre-launching every offset.
4. Use bounded concurrency and retain the last valid index on failure.
5. Make a user lookup one indexed read.
6. Cache for 30 minutes (owner-approved): raise the in-memory index TTL and
   the edge `s-maxage` from their current five minutes to 30, and refresh the
   persisted index on the same cadence. The extension keeps its own
   five-minute positive and ten-minute negative badge caches, so the only
   visible effect is badge PnL numbers being up to ~30 minutes stale.
7. Preserve the exact response contract: `handle`, `proxyWallet`, `pnl`,
   `vol`, `rank`, and HTTP `200` for hits.

### Done when

- A cold user lookup does not crawl leaderboard pages.
- Refresh failure keeps the previous index available and observable as stale.

## Worker-wide guardrails

Apply these budgets to every remediation unless a route has a reviewed,
documented exception:

- Non-streaming public JSON responses stay below 512 KiB.
- A normal request buffers no single upstream body above 4 MiB; event-card
  feeds target 2 MiB or less.
- Normal user-facing routes make at most six upstream subrequests and wait on
  no more than four concurrently.
- A public handler does not synchronously walk more than five upstream pages.
- Work intended to outlive the response runs in a Queue or Workflow, not HTTP
  `waitUntil()`.
- Worker CPU p99 retains at least 50% headroom under the configured limit.
- Repeatable peak isolate memory remains below 96 MB.
- External responses are schema-validated and failures are never converted
  into successful empty data.
- Rate limits protecting expensive or privileged operations are durable across
  isolates. The current in-memory `Map` remains only a low-cost, per-isolate
  first line of defense.
- New or changed public API routes retain input validation, rate limiting,
  OpenAPI annotations, and non-leaking error responses.
- Monetary calculations use Decimal.js.

## Required observability

Expensive routes must emit structured telemetry for:

- normalized endpoint and operation;
- total wall time;
- upstream subrequest count;
- upstream and downstream bytes;
- timeout and cancellation count;
- cache/snapshot source and age;
- pagination depth or job step;
- partial/fallback reason; and
- Cloudflare invocation outcome, CPU time, and memory percentiles from
  platform telemetry.

Do not add `console.log`. Import `createLogger` directly from `@knoww/logger`
and give each route a stable namespace such as
`createLogger("api.<route>")`. The `@/lib/logger` module is a compatibility
re-export for existing callers, not the preferred import for new or changed
routes.

## Delivery order

1. Apply server-only validation, bounded concurrency, deadlines, cancellation,
   structured logging, and response-byte guardrails that preserve existing
   client contracts.
2. Provision the Workflow, Queue, schedule, and persisted-storage prerequisites,
   including explicit cron dispatch in `custom-worker.ts`.
3. Remove synchronous backtest and sitemap generation from HTTP requests,
   including the backtest client's asynchronous job states.
4. Bound batch price-history concurrency, deadlines, and partial-result
   semantics; lower the cap to twelve after updating the 40-token markets
   view.
5. Constrain the Polygon RPC proxy and verify every wallet flow against the
   allowlist.
6. Remove or slim `/api/events/list`; unify feed limits while updating sports
   pagination/projections and SSR in lockstep.
7. Slim search into explicit web and extension projections.
8. Replace closed-time and resolution scans with persisted keyed indexes.
9. Materialize whale activity, suspicious-wallet features, and wallet PnL,
   preserving global aggregates and completeness metadata.
10. Persist the X-profile index.
11. Reprofile every maximum valid request and record before/after evidence.

## References

- [Original measurements and broader audit](./cloudflare-worker-league-counts-remediation.md#broader-cloudflare-worker-endpoint-audit)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Cloudflare Worker Cache API locality](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)
- [Cloudflare `waitUntil()` lifetime](https://developers.cloudflare.com/workers/runtime-apis/context/)
