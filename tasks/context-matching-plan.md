# Context matching implementation plan

## Objective

Complete the remaining work in the context matching report without enabling
ranking behavior that has not passed a representative evaluation. Every
testable code change follows a red, green, and nearby-validation cycle. The
current staged work remains intact and no commits will be created.

The report requires real, consented, anonymized posts and contemporaneous
market snapshots for several rollout decisions. Local code can validate the
dataset, calculate metrics, run model comparisons, and enforce promotion
criteria. It cannot manufacture the evidence. Those decisions remain disabled
until the required dataset and shadow export exist.

## Current baseline

The working tree already contains these completed slices:

- aggregate relevance counters and an export path;
- a search proxy capacity runner;
- separate remote AI controls;
- bounded nested market context;
- Polymarket and combined retrieval limits of 20;
- a true MiniLM shadow path that cannot change displayed cards;
- a bounded MiniLM queue with same-post supersession.

## Dependency order

```text
evaluation contract and metrics
  -> production baseline and shadow export
  -> threshold and model promotion decisions

search transport protection
  -> wider retrieval remains safe under several tabs

versioned model contracts
  -> repeatable model and cache benchmarks

market and post document builders
  -> normalized lexical ranking
  -> reciprocal-rank fusion
  -> two-stage reranking
  -> calibrated gate and proposition checks
  -> browser model comparison
```

## Architecture decisions

- Keep Arctic Embed S as the default embedding model until the held-out test
  set proves that another model improves the full pipeline.
- Keep production MiniLM disabled by default. Shadow scoring may collect
  aggregate measurements, but it must not change card admission or ordering.
- Store model revision, dtype, pooling, and prompt version in one model
  manifest. Use that manifest in runtime loading, metrics, and cache names.
- Build ranking and gate policies as pure functions. Browser wiring stays thin.
- Treat unknown domain as neutral. A known incompatibility may reject a match.
- Keep proposition checks typed and explainable. Entity, date, numeric
  threshold, direction, and outcome conflicts must produce separate reasons.
- Never add raw post text to aggregate telemetry. Evaluation datasets live
  outside the production bundle and require consent and anonymization.

## Task 1. Add the evaluation data contract and metrics

Create a versioned JSON and JSONL contract that accepts both positive and
true no-match cases. Add validation for unique case IDs, label values, candidate
counts, consent metadata, anonymization status, split, and strata. Calculate
retrieval recall, ranking metrics, no-match accuracy, and per-stratum results.

Acceptance criteria:

- A no-match case with every candidate labeled `0` is valid.
- Invalid consent, missing snapshot time, duplicate IDs, and invalid labels fail
  with a precise path.
- Metrics include Recall@20, Recall@50, MRR, nDCG, Precision@1, and no-match
  rejection accuracy without calling it recall.

Verification:

- Run a failing Node test before implementation.
- Run the evaluation tests and a fixture smoke check after implementation.

Dependencies: none.

## Task 2. Add dataset and rollout gates

Add a report command that checks dataset size, no-match share, label coverage,
split integrity, platform strata, and hard-negative coverage. Add an explicit
promotion result for threshold lowering and MiniLM activation. A missing or
undersized dataset must return `insufficient_evidence`.

Acceptance criteria:

- The report rejects the current 20-case saturated fixture as promotion
  evidence.
- Threshold and reranker promotion cannot pass without a held-out split and
  enough true no-match cases.
- The command emits machine-readable JSON for review and CI artifacts.

Verification:

- Run the new failing promotion-gate tests first.
- Run the evaluator and package-level tests afterward.

Dependencies: Task 1.

## Task 3. Protect search traffic and stale fallback data

Add a bounded service-worker scheduler for extension search requests. Enforce a
request deadline, a small retry budget with server-directed or exponential
backoff, and cross-tab concurrency limits. Add a maximum stale-cache age so an
old market snapshot cannot remain eligible forever.

Acceptance criteria:

- Search requests from several tabs share one concurrency and pacing policy.
- Timeouts and retryable failures stop within a fixed attempt and time budget.
- Stale cache entries older than the configured maximum are rejected.

Verification:

- Use deterministic fake-clock tests for scheduling, backoff, and cache age.
- Run background message tests and the proxy capacity runner.

Dependencies: none.

## Task 4. Pin model artifacts and version caches

Create a single model manifest for Arctic Embed S and MiniLM. Pin verified Hugging
Face revisions and record model, tokenizer, configuration, dtype, pooling, query
prefix version, and expected artifact hashes where the browser API permits
verification. Include the manifest version in IndexedDB and in-memory cache
keys.

Acceptance criteria:

- Runtime model loading passes an exact revision.
- Changing revision, dtype, pooling, or prompt version changes the cache
  namespace.
- Metrics report the model revision and manifest version.

Verification:

- Add failing model-manifest and cache-namespace tests first.
- Run embedding warm-up tests and TypeScript checks.

Dependencies: none.

## Task 5. Add rerank expiry and a production flag

Expire queued rerank work that exceeds its queue deadline. Add a separate
production MiniLM setting that defaults to off and cannot be enabled unless the
evaluation report records a passing promotion decision. Keep download size and
local-inference disclosure in the settings UI.

Acceptance criteria:

- Expired queued work never starts ONNX inference.
- Debug shadow mode remains independent of the production flag.
- The production setting remains unavailable when promotion evidence is absent.

Verification:

- Add failing queue-expiry, settings migration, and promotion-lock tests first.
- Run queue, settings, options, and message-contract tests.

Dependencies: Tasks 2 and 4.

## Task 6. Build bounded post and market documents

Create pure builders for the text sent to retrieval and reranking. Include
outcome names, active child questions, dates, resolution text when available,
aliases, tickers, bounded quotes, image alt text, and article lead text. Record
which fields were included without recording their values.

Acceptance criteria:

- Field order is stable and high-value fields survive truncation.
- Child count, per-field length, and total length have hard limits.
- Direct market text and exact symbols remain unchanged in dedicated fields.

Verification:

- Add failing document-builder tests for truncation and field priority first.
- Run market-context and platform extraction tests.

Dependencies: Task 1.

## Task 7. Normalize lexical scoring and preserve exact tokens

Use the same tokenizer for BM25 documents and queries. Preserve dates, currency
amounts, percentages, signed thresholds, handles, and tickers. Remove
per-result-set max normalization from the ranking feature contract.

Acceptance criteria:

- Query and document normalization have one implementation.
- `$TSLA`, `100k`, `5%`, and date tokens remain searchable.
- BM25 output is stable when unrelated high-scoring candidates are added.

Verification:

- Add failing numeric, ticker, normalization-parity, and score-stability tests.
- Run the scoring-core and NLP suites.

Dependencies: Task 6.

## Task 8. Add reciprocal-rank fusion and explicit two-stage reranking

Fuse upstream search rank, dense rank, and lexical rank using reciprocal-rank
fusion. Select the rerank pool only from the fused first-stage order. When the
production flag is enabled, rerank that fixed pool and append untouched
candidates in first-stage order.

Acceptance criteria:

- Fusion uses ranks rather than incomparable raw score scales.
- Reranking cannot admit a candidate that was outside the configured pool.
- Shadow mode and production mode share the same pool but only production mode
  changes its internal order.

Verification:

- Add failing fusion, stable-tie, pool-boundary, and shadow-isolation tests.
- Run the full content scoring suite.

Dependencies: Tasks 5 and 7.

## Task 9. Convert gates into evidence and make unknown domain neutral

Return a gate evidence object instead of treating Wink as the final authority.
Keep lexical overlap, specific entity overlap, domain state, and rerank evidence
separate. Unknown domain on either side is neutral. Only a known incompatible
pair may reject on domain.

Acceptance criteria:

- A missing post domain no longer rejects an otherwise valid match.
- Wink failure does not become an automatic rejection.
- A specific entity plus a calibrated rerank threshold can recover a candidate
  only when promotion evidence supplies that threshold.

Verification:

- Add failing unknown-domain and evidence-recovery tests first.
- Run gate, telemetry, and injection selection tests.

Dependencies: Tasks 2 and 8.

## Task 10. Add typed proposition checks

Parse and compare dates, time windows, numeric thresholds, direction, entities,
and outcomes. The checker should distinguish conflict, compatible, and unknown.
Unknown fields are neutral. Confirmed conflicts block card injection and record
an aggregate reason.

Acceptance criteria:

- Wrong dates, opposite directions, and incompatible thresholds produce typed
  conflicts.
- Missing information stays unknown rather than becoming a rejection.
- Telemetry records only the conflict type and count.

Verification:

- Add table-driven failing tests for each proposition field first.
- Run gate and aggregate telemetry tests.

Dependencies: Task 6.

## Task 11. Add calibrated decision artifacts

Import a versioned calibration artifact produced from the validation split.
Keep the held-out split unavailable to fitting code. Classify candidates as
direct match, adjacent, or no match. Reject artifacts that refer to a different
model manifest or document schema.

Acceptance criteria:

- Runtime uses only a validated artifact with matching version identifiers.
- Missing or mismatched calibration keeps conservative current behavior.
- The held-out evaluator reports full-pipeline Precision@1, no-match accuracy,
  and injection coverage.

Verification:

- Add failing artifact validation and conservative-fallback tests first.
- Run the evaluator and full scoring suite.

Dependencies: Tasks 1, 4, 8, 9, and 10.

## Task 12. Compare browser-downloadable model packs

Extend the benchmark to Arctic Embed M, Jina reranker, and Mixedbread candidates
that pass current Transformers.js compatibility checks. Record cold bytes, cold
start, warm latency, memory, cache behavior, failures, and quality metrics.
Model download remains explicit and optional.

Acceptance criteria:

- Every candidate uses a pinned revision and the same held-out cases.
- The report separates quality, latency, bytes, and failure rate.
- No candidate becomes the default without beating Arctic S plus MiniLM under
  written promotion criteria.

Verification:

- Add failing benchmark-config and compatibility-result tests first.
- Run browser smoke checks and the held-out benchmark after the dataset exists.

Dependencies: Tasks 4 and 11.

## Checkpoints

After Tasks 1 and 2:

- evaluation tests pass;
- the current fixture is correctly marked insufficient;
- external data requirements are explicit.

After Tasks 3 through 5:

- extension tests, TypeScript, and Biome pass;
- search and rerank queues remain bounded;
- production MiniLM stays off without evidence.

After Tasks 6 through 10:

- document, lexical, fusion, gate, and proposition tests pass;
- the full extension suite passes;
- shadow mode still cannot change displayed cards.

After Tasks 11 and 12:

- calibration and model reports use the held-out split;
- browser measurements are recorded;
- the report names the accepted model pack or records that the current pack won.

## Completion blockers outside the repository

- 500 to 1,000 consented and anonymized production post snapshots.
- Contemporaneous 20 to 100 candidate market snapshots for each post.
- Two independent labels and adjudication for disagreements.
- A week of aggregate production and MiniLM shadow telemetry.
- A product decision on acceptable false-positive rate and model download size.

The code can enforce these requirements. It cannot truthfully mark the related
rollout decisions complete until the data exists.
