# Cloudflare Worker league-counts remediation

**Status:** Proposed

**Date:** 2026-07-29

**Last updated:** 2026-07-30

**Affected route:** `GET /api/events/league-counts`

## Executive summary

`/api/events/league-counts` exceeds the Cloudflare Worker CPU limit because one
browser request expands into many full Gamma event scans. Each scan downloads
and walks multi-megabyte keyset pages, and the custom streaming counter examines
the response character by character. Opening Soccer currently requests 55
slugs, while the route starts a separate Live scan, producing 56 logical scans.

The fix is to remove full event scans from the request path:

1. Use Gamma's pagination `totalResults` with `limit=1` for bounded baseline
   counts.
2. Use `start_time_min = now - 8 hours` for league schedule baselines.
3. Keep Live data real-time through the existing Polymarket Sports WebSocket;
   do not make a 2–5 minute snapshot the source of truth for live markets.
4. Reconcile visible/relevant Gamma totals every 15–30 seconds, refresh the
   remaining taxonomy within a slower explicit budget, and keep the last valid
   snapshot only as bootstrap/reconnect/failure data.
5. Request child leagues only for the currently open group, remove them when
   the group closes, and do not request a broad group count when the UI derives
   that group total from its children.
6. Delete the keyset character scanner after the replacement has been
   validated and reprofiled.

This is a root-cause fix. Temporarily disabling count badges or increasing
`limits.cpu_ms` is explicitly not part of the current plan.

## Incident

Cloudflare reported:

```text
Worker exceeded CPU time limit.
```

The failing invocation was a request to `/api/events/league-counts` containing
the expanded Soccer slug list. Cloudflare Workers have a 128 MB memory limit per
isolate. CPU limits depend on plan and configuration; the Paid default is 30
seconds and can be configured higher, but increasing it would not address the
memory risk or the unbounded work.

Relevant implementation:

- [`league-rail.tsx`](../apps/web/src/components/league-rail.tsx)
- [`route.ts`](../apps/web/src/app/api/events/league-counts/route.ts)
- [`gamma-keyset-count.ts`](../apps/web/src/lib/gamma-keyset-count.ts)
- [`sports-event-activity.ts`](../apps/web/src/lib/sports-event-activity.ts)
- [`sports-websocket-manager.ts`](../apps/web/src/lib/sports-websocket-manager.ts)

## Root cause

### Client request amplification

The league rail always requests all 18 top-level sport tags. Opening Soccer adds
37 child leagues, resulting in 55 requested slugs. The API independently counts
Live, so that user action creates 56 logical count scans.

The open-group state currently only adds entries:

```ts
if (!isOpen) return;
```

Closing a group therefore leaves its child slugs in later requests. If every
group is opened during a session, the client can accumulate 89 tag slugs before
the separate Live scan.

When child counts exist, the UI displays the sum of those children as the group
count. The broad group tag is still requested even though its result is then
discarded.

### Server work amplification

The route runs three slug scans concurrently and runs the separate Live scan in
parallel, so as many as four large scans are active at once. Each scan:

- walks keyset pages until no cursor remains;
- uses `COUNT_PAGE_LIMIT = 500`, although observed Gamma responses contained at
  most 100 events per page during profiling;
- allows up to 100 pages;
- downloads heavy nested event and market data;
- either parses complete event objects for `isCurrentSportsEvent`, or loops
  over every decoded character in `countGammaKeysetItems`;
- silently returns a partial count if the 100-page ceiling is reached; and
- returns `0` for an upstream failure, which is indistinguishable from a real
  zero in the response.

`fetchGammaKeysetCountPage` also hardcodes `cache: "no-store"` and does not use
its `revalidate` argument.

## Profiling evidence

The existing OpenNext Cloudflare Worker was run locally under Wrangler's V8
inspector. No application code was changed for this profiling.

### Expanded Soccer request

- Query: 55 client slugs plus the route's separate Live count
- Status: `200`
- Response: 964 bytes
- Wall time: 103.6 seconds
- Hottest function: `countGammaKeysetItems`, approximately 38% of sampled CPU
- Per-character callback: approximately 31% of sampled CPU
- Combined scanner cost: approximately 69% of sampled CPU

### Isolated Soccer request

- Query: `slug=soccer`
- Wall time: 37.8 seconds
- Non-idle weighted profile: approximately 37.0 seconds
- Initial used heap: 82.84 MB
- Peak used heap: 119.17 MB
- Final used heap: 90.51 MB
- Peak backing store: 1.67 MB

A single Soccer count already crosses the default 30-second CPU budget and
comes within roughly 9 MB of the 128 MB isolate memory ceiling.

### Representative Gamma keyset payloads

| Filter | First-page transfer | Events | More pages |
| --- | ---: | ---: | --- |
| Soccer | 6.18 MB | 100 | Yes |
| Tennis | 5.94 MB | 100 | Yes |
| Baseball | 8.69 MB | 100 | Yes |
| Basketball | 3.66 MB | 35 | No |
| Live sports | 2.46 MB | 40 | No |

These five first pages alone transfer approximately 27 MB. By comparison,
`/events/pagination?limit=1` returned a response on the order of a few hundred
kilobytes and exposed `pagination.totalResults`.

The Soccer count observed through the current scan was 7,255. A pagination
total observed shortly afterward was 7,237; this difference is consistent with
live upstream churn and the time taken by the full scan, so equality must be
tested against a fixed or tightly bounded sample rather than separate
long-running requests.

## Schedule-filter verification

The current predicate checks, in order:

1. `event.startTime`;
2. the earliest `markets[].gameStartTime`;
3. `event.startDate`; and
4. `event.endDate` when no start time is available.

It also excludes `closed`, inactive, and `ended` events, while retaining Live
events and events that started within the last eight hours.

The proposed server filter was verified against live Gamma data across all 72
configured league filters at `2026-07-29T16:47:00Z`.

| Measurement | Result |
| --- | ---: |
| Successful league filters | 72 / 72 |
| Keyset pages scanned for verification | 84 |
| Active/open events examined | 2,737 |
| Verification payload | 136.58 MB |
| Exact `isCurrentSportsEvent` count | 2,391 |
| Local `event.startTime >= now - 8h` count | 2,397 |
| Upstream `start_time_min` total | 2,397 |
| False negatives | 0 |
| False positives | 6 |

All 2,391 exact-current events used `event.startTime`. None required the market
`gameStartTime` or `event.startDate` fallback in this dataset.

The six false positives were all already marked `ended: true`:

- UCL: +1
- ATP: +3
- WTA: +2

Gamma did not honor an `ended=false` filter in the pagination endpoint during
verification. `start_date_min` also did not preserve the current predicate and
must not be used.

Decision:

- `start_time_min = now - 8 hours` is an acceptable schedule-time baseline:
  it produced no false negatives and a 0.25% overcount in this sample.
- Pure `totalResults` cannot exactly reproduce the local `ended` predicate.
- Ended transitions must be applied from the real-time sports feed, or exact
  parity must be relaxed. The existing Sports WebSocket already exposes
  `gameId`, `leagueAbbreviation`, `slug`, `live`, and `ended`.

## Proposed architecture

### Freshness tiers

| Data | Source of truth | Freshness target | Fallback |
| --- | --- | ---: | --- |
| Prices and order book | Existing CLOB WebSocket | Per message | Existing REST bootstrap |
| Live game state | Existing Sports WebSocket | Per message | Last valid live baseline |
| Live count | Deduplicated Sports WebSocket games where `live && !ended` | Per message | Gamma `live=true` total |
| Visible/open-group scheduled counts | Gamma pagination `totalResults` | 30-second serve-stale refresh threshold (request-triggered; see acceptance criteria for the served/displayed envelope) | Last valid snapshot |
| Remaining scheduled taxonomy | Gamma pagination `totalResults` | 60 seconds or slower, within an explicit byte/subrequest budget | Last valid snapshot |

The snapshot is not the source of truth for Live. A user with a healthy
WebSocket connection sees transitions as the feed emits them; the snapshot is
used only before the WebSocket is ready, during reconnects, or after feed
failure.

### Bounded Gamma baseline

For every requested count:

```text
GET /events/pagination
  ?limit=1
  &active=true
  &closed=false
  &[tag_slug=<tag> | series_id=<id>]
```

League schedule baselines add:

```text
start_time_min=<now minus 8 hours>
```

Do not use `live=false`. Direct checks on both 2026-07-29 and 2026-07-30 showed
that it is not the complement of `live=true`. Scheduled baselines must omit the
`live` parameter, while `live=true` is reserved for the Live-badge bootstrap
total. Because scheduled baselines already include live events inside the
schedule window, the WebSocket overlay must not add those events to league
counts a second time.

The helper must:

- validate the response schema before reading `pagination.totalResults`;
- use a strict upstream timeout;
- reject malformed, negative, or non-integer totals;
- distinguish upstream failure from a legitimate zero;
- emit structured metrics; and
- fall back to the last valid snapshot rather than initiating a keyset scan in
  the user request.

### Reconciliation and storage

Maintain one canonical count snapshot:

```json
{
  "generatedAt": "2026-07-29T16:47:00.000Z",
  "liveBaseline": 12,
  "byTagSlug": {
    "soccer": 29,
    "baseball": 4
  }
}
```

Required behavior:

- refresh relevant totals off the request path once the served snapshot
  exceeds a 30-second threshold (request-triggered via `waitUntil`, so the
  effective cadence is traffic-dependent rather than a fixed 15–30-second
  schedule);
- bound each refresh pass with a hard deadline; filters that miss it carry
  forward as stale and are retried first on the next pass, so repeated
  deadline pressure rotates through the taxonomy instead of starving the
  same tail filters (implemented as a stale-first stable sort; visible-first
  prioritization was considered and declined because it would starve
  never-visible keys and fragment the canonical snapshot);
- cap concurrency and the number of upstream subrequests per refresh;
- write a complete snapshot atomically;
- retain the last successful snapshot when a refresh fails;
- expose snapshot age and fallback reason in structured telemetry; and
- never make a warm-path user request wait for a refresh; only the first
  request on a cold POP with no edge-cached snapshot blocks, bounded by the
  refresh deadline.

A single Durable Object with a recurring alarm is the strongest consistency
option if a globally coordinated 15–30 second refresh is required. Durable
Object alarms can run at sub-minute intervals, whereas Cron Triggers have
minute-level scheduling. The Durable Object should not maintain an outbound
WebSocket merely for this feature: outbound WebSockets prevent hibernation and
would add continuous duration cost. The browser already has a shared Sports
WebSocket manager for real-time state.

Decision (2026-07-30, implemented): the Durable Object is not adopted for
this phase. The snapshot lives in per-isolate memory plus the
data-center-local Cache API under one fixed internal key, with per-isolate
single-flight refresh, serving the last valid snapshot while refreshing.
Each POP therefore converges independently within one refresh cadence;
briefly divergent counts between POPs are accepted for badge data. Because
refreshes are triggered from request handling via `waitUntil`, only POPs
actively receiving traffic refresh — upstream cost multiplies per active
POP, not per global POP count. Arbitrary combinations of query-string slugs
are still never cached. Escalate to a single named Durable Object only if
globally coordinated counts become a real requirement.

### Client behavior

The rail should:

- request all top-level counts only when those counts are required;
- request children only for the currently open group;
- remove a group's child slugs when it closes;
- avoid requesting a broad group tag when its displayed value is derived from
  children;
- use the existing shared Sports WebSocket connection for Live transitions;
- deduplicate live games by `gameId`; and
- show the baseline value until the initial WebSocket snapshot is ready.

League-abbreviation and slug-to-tag mappings used for WebSocket overlays must be
explicit and covered by tests. An unknown league must be logged and left for
the next reconciliation instead of being assigned to the wrong badge.

## Implementation sequence

1. Add a runtime-validated `limit=1` pagination-count helper with timeout,
   structured errors, and contract tests.
2. Add `start_time_min = now - 8 hours` to league schedule baselines.
3. Contract-test the confirmed Live-filter behavior: scheduled baselines omit
   `live`, `live=true` is bootstrap-only, and `live=false` is rejected by the
   count helper.
4. Update the Live badge from the existing shared Sports WebSocket and use the
   Gamma Live total only during bootstrap/reconnect/failure.
5. Apply `ended` transitions from the sports feed and verify the six known
   mismatch classes are corrected.
6. Store counts under one canonical snapshot key with atomic replacement and a
   last-valid fallback.
7. Reconcile relevant Gamma totals every 15–30 seconds with strict concurrency
   and subrequest budgets.
8. Change the rail to keep child slugs only for the currently open group and
   remove them on close.
9. Stop requesting broad group counts when child counts determine the displayed
   group value.
10. Remove `countGammaKeysetItems` and the full keyset count path.
11. Re-run the same isolated Soccer and expanded Soccer CPU/heap profiles.
12. Deploy behind metrics, verify production percentiles, then remove any
    temporary compatibility fallback.

## Guardrails and tests

### Tests

- Pagination schema accepts a valid `totalResults` response.
- Missing, negative, fractional, or wrong-type totals fail closed.
- Timeout and upstream 4xx/5xx use the last valid snapshot.
- A legitimate zero remains distinguishable from an upstream error.
- `start_time_min` matches the current predicate on a fixed fixture corpus.
- Ended events are removed by a WebSocket transition.
- Duplicate WebSocket messages do not change a count twice.
- Unknown leagues do not corrupt another league's count.
- WebSocket reconnect starts from the latest baseline without double-counting.
- Closing a group removes its child slugs from the next request.
- Displaying child totals does not also fetch the unused broad group count.
- Refresh budgets prevent unbounded slug, page, or subrequest fan-out.

### Observability

Emit structured events containing:

- endpoint and normalized filter identifier;
- snapshot age and generated timestamp;
- source: `websocket`, `gamma_total`, or `last_valid_snapshot`;
- refresh duration, upstream bytes, and response status;
- cache/snapshot hit or miss;
- number of requested filters and upstream subrequests;
- count returned;
- timeout, schema-validation, or fallback reason; and
- CPU and memory percentiles from Cloudflare telemetry.

No `console.log` statements should be introduced; use the repository's
structured logger.

### Resource acceptance criteria

- The expanded Soccer request completes below the configured CPU budget with at
  least 50% headroom at p99.
- Peak Worker memory remains below 96 MB in the repeatable local profile.
- The request path downloads no full Gamma keyset pages.
- The request path performs no character-by-character JSON scan.
- No response returns a silent partial count.
- Live badge transitions appear within one Sports WebSocket message under a
  healthy connection.
- Thirty seconds is the serve-stale refresh threshold for visible/open-group
  scheduled counts, not a bound on served age: a request past that age is
  served the last valid snapshot while one off-path refresh runs, so served
  age is bounded by the threshold plus a traffic-dependent trigger lag
  (refreshes are request-triggered; a lone client polling through the
  15-second edge cache typically starts one ~45 seconds after the
  snapshot's generation) plus the 20-second refresh deadline. The remainder
  of the taxonomy stays within its separately configured refresh budget.
  End-to-end displayed staleness additionally includes the 15-second edge
  cache and the client's 15-second poll (typically 30–45 seconds, bounded
  by roughly 75 seconds when a refresh pass runs to its 20-second
  deadline); a strict sub-30-second served or displayed bound was declined
  rather than block user requests on a refresh or raise the upstream
  reconciliation cadence.
- A Gamma outage serves an explicitly observable last-valid snapshot and does
  not trigger a full-scan fallback.

## Rejected alternatives

### Increase the Worker CPU limit

Rejected for the initial fix. It provides temporary breathing room but leaves
the single-Soccer memory peak near the 128 MB limit and preserves work that
grows with event volume and opened groups.

### Disable league-count badges

Rejected for the initial fix because the feature can be retained with a bounded
counting design.

### Cache arbitrary slug combinations

Rejected because different open-group URLs fragment the cache and repeat the
same underlying counts.

### Use a 2–5 minute snapshot for Live

Rejected. Live-market users require per-message freshness. Snapshots are only
bootstrap, reconciliation, and failure data for Live.

### Use `start_date_min`

Rejected because verification showed that it does not preserve the current
schedule predicate.

### Keep the keyset scanner as the normal fallback

Rejected because the fallback itself can exceed the Worker CPU and memory
budgets. Contract failure must use the last valid snapshot and alerting.

## Review addendum: recommended adjustments (2026-07-29)

An independent review verified this plan's core incident claims against live
Gamma and the client code; the evidence is recorded under "Review findings" in
`docs/cloudflare-worker-league-counts-issue.md`. The direction is sound after
the corrections below. In particular, the review's `live=false` finding is
accepted, while its WebSocket-correction and cache-coordination wording needed
to be narrowed.

### Resolve the live-filter split: do not use `live=false`

The "Bounded Gamma baseline" section left the `live=true` / `live=false` split
pending a contract test. That test has effectively been run: Soccer returned
7,282 with no `live` parameter, 12 with `live=true`, and 29 with `live=false`.
`live=false` is not the complement of `live=true`, so baseline separation
through `live=false` is not available. Adjust the design to:

- scheduled/group baselines: tag or series filters plus `start_time_min` for
  leagues, with no `live` parameter; and
- `live=true` totals only for the Live-badge bootstrap value.

The result was rechecked on 2026-07-30: no Live parameter returned 7,254,
`live=true` returned 0, and `live=false` returned 53. The conclusion therefore
does not depend on the original point-in-time values.

Scheduled baselines include live events inside the schedule window, which
matches the current predicate. The WebSocket overlay must not *add* those live
events into per-league counts a second time. It may still apply separately
tracked, idempotent corrections that the Gamma total cannot express:

- subtract an event after an `ended` transition; and
- optionally bridge a verified multi-day-live false negative.

Those correction sets must be keyed by stable game/event identity, reset or
rebased on every Gamma reconciliation, and tested independently from the Live
badge. This resolves the otherwise contradictory statements that the overlay
"adjust only the Live badge" while also correcting ended league events.

### Phase the delivery

Phase 1 fixes the CPU/memory incident and is independently shippable. It maps
to implementation-sequence steps 1–3, 6, and 8–11:

1. `limit=1` pagination-count helper (validation, timeout, zero-vs-failure).
2. `start_time_min = now - 8 hours` league baselines.
3. Canonical snapshot with a stable cache key, single-flight refresh, and
   last-valid fallback.
4. Client slug hygiene: children only while a group is open, removal on close,
   no broad group tag when the displayed value is derived from children.
5. Remove `countGammaKeysetItems` and the keyset count path, then re-profile.

Phase 2 is the real-time freshness improvement and carries its own unproven
risk surface: Sports WebSocket games and Gamma events are different universes
(mapping coverage, one-game-to-many-events cases, live markets that are not
games). It maps to steps 4–5 and 7:

1. WebSocket-driven Live badge with `gameId` dedup and bootstrap fallback.
2. `ended` transitions correcting the known `totalResults` overcount.
3. 15–30 second reconciliation, adopting the Durable Object only if the
   globally coordinated sub-minute target survives Phase 2 scoping.

The original uncertainty behind step 3 is resolved by the `live=false` finding;
step 3 is now a contract-test guard rather than a baseline-splitting
implementation. Acceptance criteria split accordingly: the CPU, memory,
no-keyset-download, no-character-scan, and no-silent-partial criteria gate
Phase 1; the one-WebSocket-message and 30-second snapshot-age criteria gate
Phase 2.

### Phase 1 storage: stable cache key first, Durable Object later

The pre-incident status quo already tolerated roughly 60-second freshness
(React Query `staleTime: 60_000` plus `s-maxage=60`). A fixed-key persisted
snapshot with per-isolate single-flight refresh meets that with far less
machinery than a Durable Object, provided the persistence layer is explicitly
shared:

- use the existing R2 incremental-cache binding, D1, or another shared store as
  the authoritative snapshot;
- use the Cache API only as a data-center-local read-through cache; and
- treat a module-level promise as coalescing within one isolate, not global
  coordination.

A stable Cache API key by itself is not canonical across Cloudflare data
centers. The implemented Phase 1 accepts exactly that trade-off: per-POP
convergence within one refresh cadence, no shared R2/D1 store, and the
Durable Object reserved for a confirmed globally coordinated requirement.
Cold-start exposure is bounded — a POP's first request blocks on one refresh
pass capped by the 20-second deadline, and subsequent requests adopt the
edge-cached snapshot instead of refreshing again.

If a route-triggered refresh uses `ctx.waitUntil()`, its entire refresh must
finish inside Cloudflare's 30-second post-response window. A refresh that can
outlive that budget belongs in a Durable Object alarm, Queue, or Workflow
instead of a detached request promise.

### Add reconciliation budget math

The full taxonomy is roughly 90 filters (up to 89 accumulated slugs plus the
Live baseline). At a 15–30 second cadence that is up to ~360 sustained Gamma
calls per minute, independent of user traffic, and each `limit=1` response
embeds one full event (~286 KB observed for Soccer; `limit=0` falls back to a
default page and returned 2.2 MB). A full-taxonomy cycle can therefore fetch
and parse tens of megabytes. Implemented budgets: concurrency 6 (the Workers
simultaneous-connection limit), one `limit=1` subrequest per filter (~92 per
pass), a 20-second hard deadline per pass with per-call timeouts clamped to
the remaining budget, and stale-first retry ordering so deadline cuts rotate
through the taxonomy. Because refreshes are request-triggered via
`waitUntil`, this cost accrues only on POPs actively serving traffic, not as
an always-on global scheduler. A tiered visible-first cadence was declined
(it starves never-visible keys and fragments the canonical snapshot), and a
separate per-cycle byte budget was declined as redundant — the deadline and
concurrency cap already bound a pass, and each body is parsed per call, not
accumulated. Discovery of a field-trimming parameter for the `limit=1` body
remains open; no current solution or acceptance criterion depends on it.

### Additional contract tests

- Gamma's treatment of events with no `startTime` under `start_time_min`
  (kept vs dropped) via a live probe — local fixtures cannot prove upstream
  behavior, and the verification sample contained no such event. If Gamma
  drops them, affected leagues undercount silently.
- Multi-day live events (started more than eight hours ago, still live) are
  excluded by `start_time_min` but kept by the current predicate. Either
  accept and monitor the undercount, widen the time window within the resource
  budget, or maintain an identity-keyed multi-day-live correction set. Do not
  union the global `live=true` total into every league baseline.

### Wording fixes

- Scope "reconciled scheduled counts are no more than 30 seconds old" to
  visible/open groups; the reconciliation section already permits a less
  aggressive full-taxonomy refresh, and the two statements conflict.
- Label the profiling figures as local `wrangler dev` magnitudes captured
  under the V8 inspector. They are directionally correct, but the production
  error log is the authoritative evidence of budget exhaustion.

## Broader Cloudflare Worker endpoint audit

The league-count incident exposed a repository-wide pattern: some routes return
large bodies directly, while others produce small responses only after
buffering multi-megabyte JSON or making many upstream calls. Cloudflare
compression does not remove the Worker-side JSON parse, object-allocation, and
serialization cost.

### Runtime constraints used for this review

- 128 MB memory per isolate, shared by concurrent requests;
- six simultaneous outgoing connections waiting for response headers;
- 30-second default CPU budget on Workers Paid unless configured otherwise;
- 50 external subrequests per invocation on Free and 10,000 on Paid; and
- a 30-second post-response lifetime for HTTP `waitUntil()` work.

The repository does not currently set `limits.cpu_ms` in `wrangler.jsonc`, so
the plan default applies. Raising it is not the primary remediation because it
does not change the 128 MB memory ceiling or eliminate unbounded work.

### Measurement method and interpretation

Measurements were taken on 2026-07-29 against the local OpenNext Worker at
`127.0.0.1:8000` with `Host: knoww.app`, plus direct public upstream requests.
Sizes are uncompressed bytes. Latency samples are diagnostic, not p95
benchmarks. Deliberately dangerous public-route maxima were assessed statically
where executing them would have generated hundreds or thousands of third-party
requests.

### Findings

| Priority | Endpoint | Measured or bounded evidence | Failure mode |
| --- | --- | --- | --- |
| P0 | `GET /api/whales/backtest` | Up to 40 × 500 resolved-market discovery rows, up to 200 market-trade requests, then per-wallet histories, a 10 × 500 resolution build, and price histories | Long-running data pipeline is executed synchronously by a public GET |
| P1 | `GET /sitemap.xml` | Cold 10.79 s versus warm 32 ms; 151,480-byte response built from up to 13 pages; first active/resolved pages were 9,297,799 and 8,140,208 bytes | Concurrent multi-megabyte JSON parsing during cache regeneration |
| P1 | `POST /api/markets/price-history/batch` | Accepts 40 tokens through one `Promise.all`; 40-token probe exceeded 90 s, a later five-token probe exceeded 45 s, and one token took 10.4 s | Six-connection queueing, missing per-fetch timeout, silent empty histories |
| P1 | `GET /api/events/list` | Default response 2,359,715 bytes; Soccer `limit=100` response 6,168,779 bytes | Direct proxy of full nested Gamma events plus weak parameter validation |
| P1 | `/api/events/{trending,new,breaking,paginated}` | UI-default responses 28–46 KB, but matching upstream bodies were 0.68–2.77 MB; accepted `limit=100` produced upstream bodies as large as 9.46 MB | Hidden buffering/parsing cost; `markets=full` can also return 1.49 MB |
| P1 | `GET /api/search` | Two tag filters with five events each returned 1,083,892 bytes | Search cards retain full nested tag-event objects |
| P1 | `GET /api/whales/activity` | Maximum accepted query returned 1,712,435 bytes and can make 102 upstream requests | N+1 activity fanout followed by Decimal transforms, sorting, and serialization |
| P1 | `GET /api/user/pnl` | High-activity wallet took 13.19 s, read 18 pages and approximately 1.57 MB, then reported activity truncation | Synchronous historical aggregation is slow and can still be incomplete |
| P1 | `GET /api/markets/closed-time` | A miss scans five 500-market pages (~3.2 MB), then may make 50 event and 50 CLOB lookups | Global catalog scan is used to answer a keyed lookup |
| P1 | `POST /api/rpc/polygon` | 100 KB request-body allowance, no JSON-RPC batch-count cap, denylist permits large read methods, and upstream JSON is fully parsed | Caller can induce a very large RPC response or repeated fallback parsing |
| P1/P2 | `GET /api/whales/suspicious` | In one current 500-trade sample, `minUsdValue=0` selected 305 unique wallets; each history can walk five pages; cold KB refresh walks 10 × 500 markets | Caller-controlled fanout plus a 30–60 second background crawl |
| P2 | `GET /api/trader/x-profile` | Cold lookup builds an index with 42 leaderboard requests and took ~3 s | High fixed fanout, though current aggregate transfer is below 1 MB |

### Per-endpoint solution

#### Move data pipelines out of user requests

- `/api/whales/backtest`: start a Cloudflare Workflow, return `202` plus a job
  ID, persist progress/results in D1 or R2, and expose a lightweight status
  endpoint. Require admin authorization; the current per-IP rate limit does not
  make one invocation safe.
- `/sitemap.xml`: generate versioned sitemap segments on a scheduled Workflow
  or Queue consumer, write them to R2/static assets, and serve a small sitemap
  index plus the last successful version. A crawler request must never rebuild
  the event catalog.
- `/api/whales/suspicious`: precompute the resolution knowledge base and
  bounded wallet features on a schedule. The request path should score a
  bounded candidate set from persisted data, not crawl wallet histories.
- `/api/user/pnl`: make the dedicated PnL API or a materialized per-wallet
  snapshot primary. Historical reconstruction should be an asynchronous job
  when the requested period exceeds a small bounded page budget.

Cloudflare Workflows are preferred for multi-step jobs with dependent retries;
Queues are appropriate for buffering, batching, and simple background
materialization.

#### Bound fanout and deadlines

- `/api/markets/price-history/batch`: reduce the client/server batch to visible
  series (target maximum 8–12), run at concurrency four, apply a strict
  per-token timeout and an overall deadline, cancel on client abort, and return
  a per-token status instead of silently converting failures to empty history.
- `/api/whales/activity`: paginate the returned activity, reduce the maximum
  whale fanout, and refresh a shared public snapshot outside each viewer's
  request. Keep any truly live delta as a small overlay.
- `/api/trader/x-profile`: stop once a leaderboard page is empty, use bounded
  concurrency, and persist the address-to-handle index rather than rebuilding
  all 42 pages in a cold isolate.

#### Stop proxying full catalog objects

- `/api/events/list`: no in-repository consumer was found. Remove/deprecate it
  if it has no external contract; otherwise apply strict validation, cap pages
  at 20–25, and return `toSlimGammaEvent` output.
- Event feed routes: cap the public page size at 20–25, matching the actual UI
  defaults; do not allow `markets=full` on large list requests; fetch rich
  market details only after selection. Bring `/events/breaking` onto the shared
  strict query schema.
- `/api/search`: map tag-derived events to a dedicated search-card projection
  before merging and returning them.

These changes do not make live prices or live status stale. Cache/slim stable
metadata, while live price, order-book, and game-state changes continue through
small REST/WebSocket overlays.

#### Replace scans with keyed indexes

- `/api/markets/closed-time`: maintain a condition-ID-to-closed-time index in
  D1/KV/R2 during scheduled ingestion. Query supplied event slugs directly on a
  miss; never scan 2,500 closed markets inside the user request.
- Resolution knowledge base: build once on a schedule and persist it. Do not
  rely on a 30–60 second `waitUntil()` crawl because HTTP-triggered
  `waitUntil()` work is canceled after 30 seconds.

#### Constrain the RPC proxy

- Replace the read-method denylist with an allowlist of methods used by the web
  app and extension.
- Limit JSON-RPC batches to at most 10 calls.
- Reject or narrowly bound `eth_getLogs` block ranges and result volume.
- Read the upstream body through a byte-limited stream before parsing.
- Do not retry an oversized response against every fallback provider.

### Endpoints not currently driving the incident

- `/api/tags`: approximately 8.9 KB.
- `/api/sports/list?limit=10000`: approximately 103 KB.
- `/api/sports/teams?limit=10000`: approximately 29 KB.
- `/api/sports/markets` and `/api/markets/by-tag`: approximately 0.56–0.66 MB.
- Largest event detail observed: approximately 0.54 MB.
- `/api/image`: streams the optimizer response instead of buffering it.
- A single price-history response was approximately 86 KB, although its
  9.25-second upstream latency reinforces the need for timeouts.

### Recommended delivery order

1. Remove synchronous backtest and sitemap generation from HTTP requests.
2. Add price-history concurrency, timeout, cancellation, and partial-status
   handling.
3. Remove or slim `/api/events/list`; cap and validate every event feed.
4. Slim tag-search results.
5. Replace closed-time and resolution scans with persisted keyed indexes.
6. Bound whale/PnL fanout and move historical aggregation to background jobs.
7. Constrain the Polygon RPC proxy.
8. Reprofile, deploy behind telemetry, and enforce the budgets below.

### Worker-wide acceptance budgets

- Non-streaming public JSON responses stay below 512 KiB unless an endpoint has
  an explicit reviewed exception and pagination contract.
- A normal user request buffers no single upstream body above 4 MiB; event-card
  feeds target 2 MiB or less.
- Normal user-facing routes make at most six upstream subrequests and wait on
  no more than four concurrently. Approved aggregator exceptions must declare
  their own subrequest, byte, and wall-time budget.
- Public HTTP handlers do not synchronously walk more than five upstream pages
  or start work intended to outlive the response.
- Worker CPU p99 retains at least 50% headroom under the configured limit.
- Repeatable peak isolate memory remains below 96 MB.
- Every expensive route emits structured wall time, CPU time where available,
  upstream bytes, response bytes, subrequest count, timeout/cancellation count,
  cache/snapshot age, and fallback reason.

## References

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers Cache API locality](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)
- [Cloudflare Workers `waitUntil()` lifetime](https://developers.cloudflare.com/workers/runtime-apis/context/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Durable Objects and WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- [Polymarket keyset event pagination](https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination)
- [Gamma pagination response schema](https://gamma-api.polymarket.com/schemas/EventsPagination.json)
