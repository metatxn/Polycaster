# Knoww Extension — Card Injection & Search Matching Review

> Review of how the extension decides *which market card to inject for which post*, and how to
> improve context matching **without leaning on the AI endpoints**. Analysis only — no code changes.
>
> Reviewed: 2026-07-22. Sources: `apps/extension/src/content/{injection,api,scoring-policy,market-context}.ts`,
> `apps/extension/src/background/{nlp,embeddings,score-markets-core}.ts`, platform adapters,
> `apps/web/src/app/api/{search,ai/*}/route.ts`.

---

## 1. Headline findings

1. **The extension already runs AI-free by default.** `aiExtractionEnabled` defaults to `false`
   (`types/settings.ts:175`), which disables *both* `/api/ai/extract-topics` (gate-recovery retry)
   and `/api/ai/validate-relevance` (final precision filter). In the shipped default config the
   entire relevance decision is: knoww.app search proxy (recall) + local embeddings/BM25/NLP gate
   (precision). `ranking-engine.md` (March 2026) is stale — it claims AI validation defaults on and
   names the old `bge-small` model; the code uses `Snowflake/snowflake-arctic-embed-s` int8
   (`background/embeddings.ts:58-59`).

2. **The biggest shipped-but-unused quality lever is the local cross-encoder reranker.** A
   `Xenova/ms-marco-MiniLM-L-6-v2` cross-encoder is bundled, loaded, and wired through the offscreen
   scorer (`background/embeddings.ts:61`, `score-markets-core.ts:166-179`), but the only call site is
   gated behind `isDebug` (`content/injection.ts:1170` — the XENCODER A/B experiment). Production
   ranking never benefits from it. This is exactly the kind of "better matching without AI endpoints"
   capability the pipeline already owns.

3. **Recall is the weakest stage, and it is a single remote point of failure.** One rules-derived
   query string (top-6 keywords, ≤200 chars) plus ≤2 tag slugs goes to `knoww.app/api/search` with
   `limit=8`. If the best-matching market isn't in those 8 events, no amount of local scoring can
   recover it. The proxy itself delegates text relevance entirely to Gamma `public-search` and, on
   failure, the extension caches degraded/empty results as if they were fresh successes.

4. **Precision-side machinery is strong but blind to three things**: dates (a market resolving next
   week vs. next year scores identically), outcome labels (nested market outcomes like team names are
   excluded from the embedding/BM25 text), and entity variants (lowercase names, @mentions, and
   non-allowlisted acronyms don't count as entities in the gate).

---

## 2. Pipeline as-built (corrected reference)

```
post discovered (MutationObserver 300ms / scroll 1s / periodic 20s)
  → dedupe (identity key, LRUSet 150) + cooldown (4 posts)
  → adapter extractPostText  (+ Polymarket link hints)
  → filters: <20 chars skip, English-only (adapter can bypass)
  → extractSearchKeywords: rules only — top-6 scored keywords + ≤5 matched tags
  → GET knoww.app/api/search  q(≤200 chars) + tag_slugs(≤2) + limit=8   ← RECALL
  → local batch scoring (offscreen doc):
       arctic-embed-s int8 cosine ×0.7  +  BM25(MiniSearch) ×0.3        ← RANKING
       [cross-encoder rerank: DEBUG ONLY — injection.ts:1170]
  → NLP context gate (wink-nlp): ≥2 distinct non-generic noun/entity signals
  → domain-compatibility gate (regex domain inference + compatibility matrix)
  → threshold: 0.5 (hybrid) / 0.3 (lexical, heuristic)
  → [AI retry + AI validation — OFF by default]
  → top ≤2 candidates within 0.08 of best → inject 1 card per post
     (≤5 injections/batch, ≤3 active posts per market)
```

Score modes degrade: `hybrid` (embeddings ok) → `lexical` (BM25 only, ×0.8 + heuristic ×0.2) →
`heuristic` (`calculateRelevanceScore` word-overlap, `api.ts:2149`).

---

## 3. Weaknesses, ranked by impact on matching quality

### Recall stage (candidate set — the ceiling on everything downstream)

| # | Weakness | Where | Effect |
|---|----------|-------|--------|
| R1 | Single query per post; no per-entity fan-out | `api.ts:1054-1076`, `injection.ts:1049` | A tweet mentioning both "Fed rate cut" and "Powell" gets one blended query; the blend can match neither well |
| R2 | Only 2 of 5 matched tags reach the search proxy | `normalizePolymarketTagSlugs` breaks at 2, `api.ts:1152-1154`; server also caps `MAX_TAG_SLUGS=2` | Tags 3–5 influence local gating only, never recall |
| R3 | `limit=8` candidate pool | `api.ts:1229`; server allows up to 20 | Small pool → precision stages have little to choose from; especially harmful once a reranker exists |
| R4 | Degraded proxy responses cached as fresh success (60s TTL) | `fetchKnowwPolymarketSearch` only logs `payload.degraded` (`api.ts:1412-1416`); `searchPolymarketEventsViaKnoww` writes cache without the flag (`api.ts:1438-1439`) | A transient rate-limit blip (known knoww.app/api/search behavior under burst) poisons the cache for a full minute; the degraded-TTL plumbing in `writePolymarketSearchCache` is dead code on this path |
| R5 | Keyword extractor noise | "long noun >4 chars" bucket at weight 3 (`api.ts:843-853`), no near-duplicate suppression among top-6 | Generic nouns dilute `q`, and Gamma's search does the rest of the damage |
| R6 | Query truncation | `q` sliced to 200 chars (`api.ts:1138-1140`) | Rarely harmful for tweets; matters for editorial adapters that extract long body text |

### Ranking stage (ordering the candidates)

| # | Weakness | Where | Effect |
|---|----------|-------|--------|
| K1 | Cross-encoder rerank debug-only | `injection.ts:1170`; final sorts at `injection.ts:1738-1746`, `345-365` | Shipped model contributes nothing; hybrid cosine+BM25 alone decides order |
| K2 | Market text for embedding/BM25 excludes nested outcome labels | `marketTexts[i]` = title + tags + `description.slice(0,120)` (`injection.ts:1085-1101`) | For multi-outcome events ("Premier League Winner"), team/candidate names — often the strongest overlap with the post — are invisible to both scorers. `buildMarketContextText` (`market-context.ts:53`) already assembles them but isn't used here |
| K3 | No date/recency signal | Temporal words are stop words (`scoring-policy.ts:294-317`, `nlp.ts:40-55`); event `endDate` never consulted; only `closed/active` filtered (`api.ts:1347`) | A post about tonight's game can rank a next-season market first; long-dated markets compete equally with imminent ones |
| K4 | Fixed magic weights/floors on quantized scores | 0.7/0.3, 0.8/0.2 (`injection.ts:1120-1151`); floors 0.5/0.5/0.6/0.7 (`scoring-policy.ts:7-11`) | The 0.5 cosine floor is applied to int8-quantized arctic-embed vectors; no calibration data justifies these numbers, and heuristic mode keeps the raw 0.3 threshold (behavior shifts whenever embeddings fail) |
| K5 | BM25 query = first 20 lemmas in document order | `nlp.ts:345` | For editorial pages the tail of the article never reaches BM25; for tweets fine |

### Gate stage (false-positive control — currently also a false-negative source)

| # | Weakness | Where | Effect |
|---|----------|-------|--------|
| G1 | ≥2 distinct signals blocks single-strong-entity posts | `nlp.ts:300`, `scoring-policy.ts:744-745` | "Powell just resigned" shares one entity with "Will Powell be Fed Chair on…" → gate-blocked. The relief valves are: a ~13-token crypto/venue allowlist (`scoring-policy.ts:163-177`) and the AI retry — which is off by default. Valid matches die silently |
| G2 | Shallow entity recognition | `NAIVE_ENTITY_RE /[A-Z][a-zA-Z]{4,}/` + caps allowlist (`scoring-policy.ts:385-386, 628-656`) | lowercase names ("lebron"), @mentions, $TICKERs, and unlisted acronyms aren't entities; nickname/alias variants ("Bibi"/"Netanyahu") never match |
| G3 | Domain gate over-rejects when post domains are empty | `hasCompatibleDomain` returns false if market has domains but post has none (`scoring-policy.ts:591-593`); fixed regex tables (`388-490`) | Novel/ambiguous topics get vetoed at any embedding similarity |
| G4 | No negation/stance awareness | "not" is a stop word (`scoring-policy.ts:221`); bag-of-words gate | Acceptable trade-off for card injection (the market is *about* the topic either way), but worth stating as a known non-goal |

### Context-extraction stage (what the pipeline never sees)

| # | Weakness | Where | Effect |
|---|----------|-------|--------|
| C1 | Social adapters extract a single text field | twitter: `tweetText` only (`platforms/twitter.ts:284-303`); reddit: title+selftext (`platforms/reddit.ts:169-238`) | Quoted tweets, image alt text, author identity, and thread context are discarded — a tweet relevant only via its quote or image cannot match |
| C2 | Editorial adapters stop at headline + meta description | e.g. `platforms/cnn.ts:126-134` | Article body entities (the actual specifics) never inform the query |
| C3 | Fallback post identity = first 160 chars of `textContent` | `injection.ts:639-642` | "Show more" expansion changes the key → re-analysis; similar posts can collide |
| C4 | Hard drops with no fallback | <20 chars (`injection.ts:1020`), non-English (`injection.ts:1025-1032`) | Short quote-tweets and non-English posts about English-market topics produce nothing |

### Direct-link fast path (x.com/@Polymarket and similar)

Posts that directly reference a Polymarket market intentionally **bypass** the whole matching
system: link hints are extracted from the post (`platforms/twitter.ts:250-282`), resolved to the
exact market (`resolvePolymarketMarketsFromHints`, `api.ts:1783-1821`), and injected with the gate
skipped, score forced to ≥0.99, and badge text "Direct Polymarket link"
(`injection.ts:1358-1377, 1486-1488`). This is the right design — when the post *is* the market,
fuzzy matching can only add error.

The reliability concern is that the fast path **fails silently into fuzzy matching**. Observed in
production (July 2026): an @Polymarket tweet with a native polymarket.com link card was injected
with an "82% MATCH · AI" badge — the generic-pipeline badge — meaning direct resolution did not
engage and the correct card appeared only because the fallback happened to agree. The chain has
three silent fall-through stages:

| Stage | Requirement | Failure mode |
|-------|-------------|--------------|
| Hint extraction | An `a[href]` in the tweet DOM with a Polymarket URL or Polymarket text signal (`twitter.ts:250-282`) | X's link-card markup changes frequently; a card rendered as `div[role="link"]` without a real anchor yields zero hints — the path never starts |
| URL resolution | Host must be `polymarket.com` or `t.co`; t.co expansion needs the background `fetch-text` + redirect/HTML to expose the final URL (`api.ts:1682-1721`) | t.co interstitial changes, fetch failures, or redirect-allowlist misses return null |
| Title fallback | Card-preview title fuzzy-matches a search result at ≥0.6 (`api.ts:1647-1680`) | Truncated preview titles ("…") or degraded search results miss the threshold |

Each stage logs locally but nothing distinguishes "fast path succeeded" from "fell back" in
telemetry, so regressions in stage 1 (the most fragile — it tracks X's DOM) are invisible until
someone notices a percentage badge on an official Polymarket post.

**Recommendations (fits Tier 1):**
- Add stage-level telemetry: hint-found / url-resolved / title-fallback-used / fell-through, per
  platform. A dashboard ratio of direct-badge vs. percent-badge injections *on posts with hints*
  is the canary for X DOM drift.
- Harden stage 1 against X card markup: also scan `div[data-testid="card.wrapper"]` (and
  `role="link"` containers) for embedded URLs/text, not just `a[href]`.
- Treat known market-publisher authors (@Polymarket, @Kalshi) as a strong prior: if the author
  matches and stage 1 finds no anchor, still attempt title-resolution from the card text before
  falling back to generic search.
- Loosen the 0.6 title-fallback threshold specifically when the hint came from a Polymarket-signal
  anchor (the source is already near-certain; the threshold only guards against picking the wrong
  market — prefer the top result with a margin check instead).

### Hygiene / consistency

- `validateMarketRelevance` has no client cache (contrast `extract-topics`' 10-min cache) — matters only when AI is enabled (`api.ts:2298-2322`).
- Title dedupe uses char-Levenshtein ≥0.92 on 120-char prefixes, O(n²·L) (`api.ts:1934-1970`) — over-merges shared-prefix series markets, under-merges rewordings.
- Global 900 ms serialized search queue (`api.ts:1317-1337`) has no backoff on degraded responses — combined with R4, bursts both serialize *and* poison the cache. (Known behavior: the proxy degrades to empty under burst; back off rather than retry.)
- `ranking-engine.md` and `docs/scoring-flowchart.md` disagree with the code on: AI defaults, embedding model, gate relief valves. Worth a refresh pass once changes land.

---

## 4. Recommendations (no new AI-endpoint reliance)

Ordered by expected quality-per-effort. Tier 1 items are essentially "turn on / fix what exists".

### Tier 1 — high impact, low effort

**1. Promote the cross-encoder rerank to production.** Remove the `isDebug` gate at
`injection.ts:1170` (keep `scoringMode !== "heuristic"` and the top-K candidate cut). Use
`rerankScore` as the primary sort (already implemented at `injection.ts:1738-1746`) and consider a
rerank-based gate assist: a high cross-encoder score is strong evidence the pair is genuinely
related, i.e. it can substitute for the missing 2nd gate signal in G1. The A/B telemetry
(`XENCODER_AB`) exists precisely to validate this promotion — check its collected stats first.
This is the single cheapest way to buy back the precision the AI validator provided, locally.

**2. Fix degraded-response caching + add backoff.** Thread `payload.degraded` from
`fetchKnowwPolymarketSearch` (`api.ts:1412`) into `writePolymarketSearchCache` (the degraded TTL
path already exists, `api.ts:1190-1194`), and on degraded, bump the queue's spacing temporarily
instead of letting the next 3-post batch burst the proxy again.

**3. Include nested outcome labels in the scoring text (K2).** Swap the ad-hoc
`title + tags + desc.slice(0,120)` assembly (`injection.ts:1085-1101`) for
`buildMarketContextText` (or append `getNestedMarketContextParts` capped to ~10 labels). Team
names, candidate names, and strike levels are the highest-signal tokens a market has. Embedding
cache keys change with the text — expect a one-time cache refill, which the 2-tier cache absorbs.

**4. Widen the candidate pool: `limit=8` → `limit=20`, send all matched tags (up to server cap).**
The server already accepts `limit≤20`; raise `MAX_TAG_SLUGS` server-side from 2 → 5 (one deploy, it
only adds up to three cheap keyset fetches with existing per-tag filtering). A bigger pool is only
safe *because of* recommendation 1 — rerank + gate keep precision. Recall ceiling roughly doubles
for zero architectural change.

### Tier 2 — medium effort, addresses the recall ceiling and gate false-negatives

**5. Multi-query retrieval with rank fusion (R1).** Instead of one blended query, issue up to 2–3
targeted queries per post: (a) the top multi-word entity alone, (b) the current blended top-6
string, (c) optionally the 2nd entity. Merge by event id with reciprocal-rank fusion, then let the
local pipeline rank. Constraints to respect: the 900 ms serialized queue and the proxy's burst
sensitivity — fan-out must reuse the queue (adds ≤1.8 s worst-case latency, acceptable at feed
cooldown cadence) and skip extra queries when the first returns a strong candidate (score ≥0.7
early-exit). Cache keys already isolate per-query so dedupe is free.

**6. Entity gazetteer built from Polymarket's own corpus (G1/G2).** The extension already fetches
all ~500 tags daily (`fetchPolymarketTags`, 24 h cache) and sees every market title it scores. Build
a lightweight alias dictionary: tag labels + slugs + market-title proper nouns + nested outcome
labels, normalized (lowercase, diacritics-stripped — `normalizeMarketContextText` already does
this). Use it to: (a) recognize lowercase/@-mention/alias entity variants in posts, (b) replace the
hardcoded 13-token high-precision allowlist with "any gazetteer entity that maps to a tag of this
market", and (c) auto-relax the ≥2-signal gate to ≥1 when the single shared signal is a gazetteer
entity that is *specific* (appears in few markets — an IDF-style specificity count over the
candidate corpus, computable locally). This directly attacks the largest silent-drop class without
any model or endpoint.

**7. Date/recency feature (K3).** Gamma events carry `endDate`. Add a small multiplicative factor:
markets resolving within ~45 days get a mild boost, markets >1 year out a mild penalty, and (for
sports-like posts with "tonight/today") strongly prefer near-dated markets. The sports source
already proves the pattern with its ±1-day proximity filter (`sports-live-market-source.ts`), it
just never generalized. Keep it a *tiebreaker* (e.g. ±10%), not a gate, to avoid new false
negatives.

**8. Richer per-platform context (C1/C2).** Twitter: include quoted-tweet text and image alt text
(both in DOM) with a lower weight — simplest scheme: append after the primary text so BM25's
first-20-lemma bias (K5) naturally down-weights them. Editorial: extract the first 1–2 body
paragraphs (or `article p:first-of-type`) in addition to headline+meta. Keep the primary/secondary
distinction so quoted content can't *dominate* the query, only supplement it.

### Tier 3 — larger bets, only if Tier 1–2 don't move metrics enough

**9. Local market-embedding index for recall.** Background-sync the top ~2–5k events by volume
(daily keyset pagination), embed titles+outcomes locally (the model is already there), persist in
IndexedDB (the 2k-entry vector store exists; needs a corpus namespace). Then recall becomes
`local ANN top-30 ∪ proxy top-20` — the extension can find markets Gamma's search misses and
survives proxy outages entirely. Cost: ~1–2 MB storage, one background sync, brute-force cosine
over a few thousand vectors is <10 ms. This is the real "stop relying on remote search relevance"
move; everything before it is tuning.

**10. Threshold calibration from telemetry.** `relevance-telemetry` + card ignore/click tracking
(`recordIgnore`, `injection.ts:872-947`) already generate labels. Periodically fit the four floors
and two weight pairs (K4) offline against click-through/ignore rates instead of hand-picking. Also
resolves the heuristic-mode 0.3-vs-0.5 inconsistency with data rather than opinion.

**11. Dedupe by slug/series before Levenshtein.** Cheap correctness cleanup; also fixes the
shared-prefix over-merge on series markets ("…in March?"/"…in April?").

### Explicit non-recommendations

- **Don't add negation/stance handling to the gate** (G4): for card injection, topical match is the
  product goal; stance-aware matching adds complexity for near-zero card-quality gain.
- **Don't re-enable the AI endpoints by default** to fix G1 — recommendation 6 addresses the same
  false-negative class locally, and the fail-open-≥0.5 semantics meant the validator's marginal
  value was mostly at the boundary the reranker (rec 1) now covers.
- **Don't lower `EMBEDDING_FLOOR` in isolation** to fix silent drops — every silent-drop complaint
  traces to the gate or recall, not the 0.5 floor; lowering it without rec 1 trades false negatives
  for the false positives the floor was added to stop.

---

## 5. Suggested sequencing

| Phase | Items | Rationale |
|-------|-------|-----------|
| 1 | Rec 1 (rerank on) + Rec 2 (degraded cache) + direct-link hardening/telemetry (§3) | Pure unlocks; rerank has A/B telemetry to validate immediately; direct-link path is silently regressing on X today |
| 2 | Rec 3 (outcome labels) + Rec 4 (pool size) | Small diffs; both amplified by phase 1's precision backstop |
| 3 | Rec 6 (gazetteer) + Rec 7 (dates) | Attacks the two biggest remaining error classes (silent drops, temporal mismatch) |
| 4 | Rec 5 (multi-query) + Rec 8 (richer context) | Recall breadth, once precision machinery is proven |
| 5 | Rec 9–11 | Strategic; decide after measuring phases 1–4 via telemetry |

A useful acceptance metric already exists in-repo: card ignore-rate (visible ≥5 s, unclicked) vs.
click-rate per scoring mode, from the preference/telemetry system. Track it per phase; phases 1–2
should cut ignores without reducing injection count, phases 3–4 should raise injection count
without raising ignores.
