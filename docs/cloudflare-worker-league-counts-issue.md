# [Performance] Replace league-count full scans with real-time reconciled counts

## Problem

`GET /api/events/league-counts` can exceed Cloudflare Workers' CPU limit and
approach the 128 MB isolate memory limit because one UI request fans out into
many full Gamma keyset scans.

Opening Soccer currently sends 55 slugs; the route separately computes Live,
producing 56 logical scans. Closing groups does not remove child slugs, and
broad group counts are still requested when the UI ultimately displays the sum
of child counts.

## Profiling evidence

- Expanded Soccer request: **103.6 s wall time**, status 200, 964-byte response.
- `countGammaKeysetItems` plus its per-character callback accounted for
  approximately **69% of sampled CPU**.
- Isolated `slug=soccer`: **37.8 s wall time**, approximately **37.0 s non-idle
  weighted profile**.
- Isolated Soccer heap: **82.84 MB initial**, **119.17 MB peak**, **90.51 MB
  final**.
- A single Soccer request already crosses the default 30-second CPU budget and
  comes within roughly 9 MB of the Worker memory ceiling.
- Representative first keyset pages: Soccer 6.18 MB, Tennis 5.94 MB, Baseball
  8.69 MB, Basketball 3.66 MB, Live sports 2.46 MB.

Detailed design and full evidence:
`docs/cloudflare-worker-league-counts-remediation.md`

## Verified schedule semantics

`start_time_min = now - 8 hours` was compared with `isCurrentSportsEvent`
across all 72 configured league filters:

- 72/72 filters succeeded.
- 2,737 active/open events were examined across 84 pages / 136.58 MB.
- Exact predicate: 2,391 events.
- `start_time_min` total: 2,397 events.
- False negatives: 0.
- False positives: 6 (all `ended: true`: UCL +1, ATP +3, WTA +2).
- No current event needed the `markets[].gameStartTime` or `event.startDate`
  fallback in this sample.

Gamma did not honor `ended=false`, and `start_date_min` does not preserve current
behavior. Therefore, use `start_time_min` for the baseline and correct ended
transitions from the Sports WebSocket.

## Solution

Keep Live real-time; do not replace it with a 2–5 minute cache.

- [x] Add a runtime-validated Gamma `/events/pagination?limit=1` count helper
  that reads `pagination.totalResults`. (`src/lib/gamma-pagination-count.ts`)
- [x] Add an upstream timeout and distinguish a valid zero from
  timeout/schema/upstream failures. (10 s `AbortSignal.timeout`, typed
  `PaginationCountResult`)
- [x] Use `start_time_min = now - 8 hours` for league schedule baselines.
- [x] Contract-test that scheduled baselines omit the `live` parameter and
  that `live=true` is used only for the Live-badge bootstrap. Do not use
  `live=false`; it is not the complement of `live=true`.
  (`gamma-pagination-count.test.ts`, `league-count-snapshot.test.ts`; the
  query type makes `live: false` unrepresentable)
- [x] Drive the Live badge from the existing shared Sports WebSocket
  (`live && !ended`, deduplicated by `gameId`).
- [x] Use Gamma Live totals only during WebSocket bootstrap, reconnect, or
  failure. (badge falls back to the snapshot `live` value until the
  connection epoch's stream has settled: the epoch must have produced at
  least one message and gone `WS_SETTLE_MS` quiet, or stayed silent to the
  `WS_SETTLE_MAX_MS` ceiling — which sits past the manager's 10 s ping
  watchdog, so a silently dead socket is torn down before its empty map
  could become authoritative. Applied on first connect and again on every
  reconnect, with games hydrated by replacement from the manager snapshot
  preserving original receive timestamps so eviction TTLs are not renewed.
  Because the server re-streams every active game per connection epoch,
  non-ended games whose latest update predates the epoch are dropped once
  it settles — by the manager's `WS_SETTLE_MAX_MS` post-open reconcile and
  by the hook's settle-time prune — so a game that ended while the socket
  was down cannot re-enter the Live count for up to the 2 h stale TTL;
  ended games are exempt because they are never re-streamed and back the
  ended-game corrections)
- [x] Apply WebSocket `ended` transitions so the known `totalResults` overcount
  is corrected promptly. (`src/lib/league-rail-counts.ts` ended corrections,
  clamped at zero; the corrected badge is an accepted ±1-per-ended-game
  approximation between game end and the market closing upstream — see the
  `buildEndedCorrections` doc comment for both windows and the declined
  per-game lookup alternative)
- [x] Maintain one canonical, atomically replaced count snapshot instead of
  caching arbitrary slug combinations. (`src/lib/league-count-snapshot.ts`:
  per-isolate memory + fixed-key edge cache + single-flight refresh)
- [x] Refresh Gamma totals off the request path behind a 30 s serve-stale
  threshold, with capped concurrency and subrequest budgets. (a request
  finding the snapshot older than 30 s is served it anyway and triggers one
  refresh via `ctx.waitUntil`; refreshes are request-triggered, so the
  effective cadence is traffic-dependent rather than a fixed 15–30 s
  schedule — a lone client polling through the 15 s edge cache typically
  starts a refresh ~45 s after the previous snapshot's generation.
  Concurrency 6 to match the Workers simultaneous-connection limit, 20 s
  total refresh deadline with expired filters carried forward in
  `staleKeys` and retried first on the next pass so deadline cuts rotate
  through the taxonomy instead of starving the tail, ~92 `limit=1`
  subrequests per refresh)
- [x] Serve the last valid snapshot on refresh failure; never fall back to a
  full keyset scan in the user request. (per-key carry-forward flagged in
  `meta.staleKeys`; 503 only on cold start with Gamma unreachable)
- [x] Request children only for the currently open group and remove them when
  it closes. (`getCountTagSlugs` in `src/lib/league-rail-counts.ts`)
- [x] Do not request a broad group count when the displayed group value is
  derived from children.
- [x] Remove `countGammaKeysetItems` and the full keyset count path after
  validation. (`gamma-keyset-count.ts` and its test deleted; `gamma-keyset.ts`
  remains for list consumers)
- [ ] Re-run the isolated and expanded Soccer CPU/heap profiles before
  deployment. (owner pre-deploy step)

If globally coordinated 15–30 second reconciliation is required, use one
Durable Object with a recurring alarm and persisted snapshot. Do not add an
outbound WebSocket to that Durable Object for this feature; the browser already
has a shared Sports WebSocket, and an outbound WebSocket would prevent Durable
Object hibernation.

## Guardrails

- Validate the undocumented pagination response schema at runtime.
- Add contract/integration tests for totals, Live filtering, timeouts, malformed
  responses, and fallback behavior.
- Do not silently return partial counts when a page/subrequest budget is
  reached.
- Log structured metrics: normalized filter, source, bytes, duration, snapshot
  age, cache hit/miss, count, and fallback reason.
- Use the structured logger; do not add `console.log`.

## Acceptance criteria

- [ ] Expanded Soccer completes below the configured CPU budget with at least
  50% p99 headroom.
- [ ] Peak memory remains below 96 MB in the repeatable local profile.
- [x] The request path downloads no full Gamma keyset pages and performs no
  per-character JSON scan. (route serves from the snapshot; scanner deleted)
- [ ] Live count transitions appear within one Sports WebSocket message under a
  healthy connection.
- [ ] Thirty seconds is the serve-stale refresh threshold for
  visible/open-group scheduled counts, not a bound on the served snapshot's
  age: a request past that age is served the last valid snapshot while one
  off-path refresh runs. Served age is therefore bounded by the threshold
  plus a traffic-dependent trigger lag (refreshes are request-triggered; a
  lone client polling through the 15 s edge cache typically starts one
  ~45 s after the snapshot's generation) plus the 20 s refresh deadline.
  Under sustained deadline pressure the stale-first retry ordering still
  refreshes every filter within a bounded number of passes. End-to-end
  displayed staleness additionally includes the 15 s edge cache and the
  client's 15 s poll: typically 30–45 s, bounded by roughly 75 s when a
  refresh pass runs to its 20 s deadline. A strict ≤30 s served or
  displayed bound was declined — it would require blocking user requests on
  refresh or a 2–3× upstream cadence increase; the pre-incident
  implementation tolerated a comparable envelope (`staleTime: 60_000` plus
  `s-maxage=60`).
- [x] Gamma failure serves an observable last-valid snapshot and never
  initiates a full-scan fallback. (unit-tested; `meta.staleKeys` + structured
  logs make it observable)
- [x] No response silently returns a partial or failure-as-zero count.
  (never-fetched keys are omitted, not zeroed; `sports`/`live` are nullable)

Remaining unchecked acceptance criteria (CPU/memory headroom, live-transition
latency, staleness under load) are runtime measurements for the owner's
pre-deploy wrangler profiling pass.

## Out of scope for this fix

- Temporarily disabling the badges.
- Raising `limits.cpu_ms` as the primary solution.
- Using `start_date_min`.
- Making a 2–5 minute snapshot the source of truth for Live.

## Review findings (independent verification, 2026-07-29)

An independent review re-tested this issue's load-bearing claims against live
Gamma and the current client code. The core incident evidence was reproduced.
One upstream finding changes a checklist item, and two architectural statements
required correction before this document could be used as the implementation
authority.

### Confirmed

- Closing a group never removes child slugs: `league-rail.tsx` line 322 is
  literally `if (!isOpen) return;`, and the open-group displayed value is
  summed from children (`group.leagues.reduce(...)`, line 135). Both client
  claims hold.
- `start_time_min` is honored by `/events/pagination` directly, not only in
  keyset verification: Soccer dropped 7,282 → 6,795 with
  `start_time_min = now - 8h`, and `series_id=10359` plus `start_time_min`
  returned 102. The proposed baseline query shape works on the cheap endpoint.
- `ended=false` is ignored by `/events/pagination`: Soccer returned 7,282 with
  and without it.
- The keyset 100-events-per-page cap, 5–7 MB page sizes, `cache: "no-store"`,
  failure-as-zero, and per-combination cache fragmentation were all reproduced
  independently before this review.

### New upstream finding: `live=false` is not a complement

Measured 2026-07-29 for `tag_slug=soccer` on `/events/pagination`:

| Query | `totalResults` |
| --- | ---: |
| no `live` parameter | 7,282 |
| `live=true` | 12 |
| `live=false` | 29 |

`live=false` selects some other predicate entirely (7,282 − 12 ≠ 29), so it
must not be used to build scheduled baselines. This resolves the "prove and
contract-test `live=true` / `live=false` baseline separation" checklist item:
separation via `live=false` is not available. Scheduled baselines should use
`start_time_min` with no `live` parameter; `live=true` should be used only for
the Live-badge bootstrap total.

The conclusion was rechecked on 2026-07-30. The values had changed with live
upstream state, but the contract failure remained:

| Query | `totalResults` |
| --- | ---: |
| no `live` parameter | 7,254 |
| `live=true` | 0 |
| `live=false` | 53 |

This confirms that the behavior is semantic rather than a one-time count
anomaly.

### Response-size floor for count calls

`limit=1` is the minimum useful request. The body is still large because one
full event is embedded (~286 KB observed for Soccer). `limit=0` is worse:
Gamma falls back to a default page size and returned 2.2 MB.

### Residual risks to carry into implementation

- Multi-day live events: the current predicate keeps live events regardless of
  start time, but `start_time_min = now - 8h` excludes a live event that
  started more than eight hours ago (multi-day formats such as cricket test
  matches). The sample's zero false negatives does not cover that case.
- Null `startTime`: no sampled event needed the `gameStartTime` or `startDate`
  fallback, so Gamma's treatment of events without `startTime` under a
  `start_time_min` filter is unverified. If Gamma drops them, affected leagues
  undercount silently. Add a live upstream probe; local fixtures cannot prove
  upstream behavior.
- The profiling figures above are local `wrangler dev` magnitudes under the V8
  inspector; production workerd differs. The production error log remains the
  authoritative evidence that the budget is exceeded.
- The acceptance criterion has been scoped to visible/open groups; the
  remainder of the taxonomy follows a slower explicit refresh budget.

### Scope recommendation

Split delivery into two phases so the incident fix does not wait on the
real-time Live work. The phase mapping and remaining adjustments are in the
review addendum of `docs/cloudflare-worker-league-counts-remediation.md`.

## Related Worker-wide performance findings

The same audit identified additional request paths that either return
multi-megabyte responses, parse multi-megabyte upstream bodies to produce small
responses, or perform high-fanout work synchronously:

| Priority | Route | Verified risk |
| --- | --- | --- |
| P0 | `GET /api/whales/backtest` | Public synchronous catalog scan with per-market and per-wallet fanout |
| P1 | `GET /sitemap.xml` | 10.79-second cold generation from up to 13 Gamma pages; sampled first pages were 8–9 MB |
| P1 | `POST /api/markets/price-history/batch` | 40-way fanout; a 40-token probe did not finish within 90 seconds |
| P1 | `GET /api/events/list` | 2.36 MB default response; 6.17 MB for Soccer at `limit=100` |
| P1 | Event feed routes | Small client responses built by parsing as much as 9.46 MB upstream |
| P1 | `GET /api/search` | 1.08 MB for two tag filters with five events each |
| P1 | `GET /api/whales/activity` | 1.71 MB maximum observed response and up to 102 subrequests |
| P1 | `GET /api/user/pnl` | 13.19 seconds and 18 upstream pages for a high-activity wallet |
| P1 | `GET /api/markets/closed-time` | Approximately 3.2 MB global scan on a keyed miss, followed by lookup fanout |
| P1 | `POST /api/rpc/polygon` | Unbounded JSON-RPC batch count and caller-controlled large read responses |
| P1/P2 | `GET /api/whales/suspicious` | Caller-controlled threshold can expand into hundreds of wallet histories |

The measured evidence, per-endpoint solution, delivery order, and resource
acceptance budgets are recorded in the "Broader Cloudflare Worker endpoint
audit" section of
`docs/cloudflare-worker-league-counts-remediation.md`.
