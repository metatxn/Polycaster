# Browser extension context-matching model review

**Status:** Findings, recommendations, and implementation tracking. The first behavior-preserving threshold disclosure was implemented on the review branch on 2026-08-29.

**Reviewed:** 2026-08-29

**Scope:** Browser-extension market retrieval, local ranking, context gating, reranking, and final card selection.

## Executive summary

The extension has the right broad pieces, but they are connected in a way that leaves accuracy on the table.

- `Snowflake/snowflake-arctic-embed-s` is invoked correctly and is a sensible fast retriever.
- `Xenova/ms-marco-MiniLM-L-6-v2` is invoked correctly as a cross-encoder, but normal users do not benefit because the only call site is behind debug mode.
- `wink-eng-lite-web-model` is used correctly for tokenization, part-of-speech tagging, and lemmatization. The hard gate built around it expects more entity understanding than this model provides.
- Candidate recall is the first ceiling for posts without a direct market URL. Polymarket search requests only eight events, and the combined search-derived path allows at most ten markets to reach local scoring. Direct-link markets are resolved separately. A better local model cannot recover a search candidate that was never returned.
- The market representation often omits child outcomes, dates, and resolution details. Those fields frequently distinguish the correct prediction market from a topically similar one.
- BM25, dense similarity, and hand-written gates use incompatible score scales and fixed thresholds. The current combined score is not a probability, even though the UI displays it as a match percentage.
- The configured default threshold is `0.3`, but the effective default floor is `0.5` in every scoring mode because the disabled AI validator returns no result and triggers a separate fail-open rule. The first remediation now discloses this split in settings; matching behavior is unchanged.
- The checked-in benchmark is too small and too easy to select a replacement model. All tested configurations already achieve a 100 percent Hit@1 rate on 20 hand-written cases.

My recommendation is to keep Arctic Embed S as the default first-stage model, promote MiniLM to a production top-K reranker, and turn Wink from a hard decision-maker into one set of features among several. Fix retrieval breadth, candidate text, lexical normalization, and threshold calibration before changing the default embedding model.

## Scope and method

This review traced the default extension path from post extraction through card injection. It covered:

- rules-based search query generation;
- Polymarket and Kalshi candidate retrieval;
- market text construction;
- Arctic embedding inference and caching;
- MiniSearch BM25 scoring;
- Wink tokenization and context gating;
- MiniLM cross-encoder reranking;
- domain and threshold gates;
- optional AI retry and validation;
- relevance telemetry;
- the checked-in embedding benchmark and fixtures;
- browser model size, loading, and device fallback.

The findings distinguish three kinds of evidence:

1. **Verified code behavior.** Directly observed in the current repository.
2. **Measured repository evidence.** Produced by the checked-in benchmark and tests.
3. **External model evidence.** Reported by model authors on generic retrieval datasets. These results do not prove performance on social-post to prediction-market matching.

## Current model inventory

| Component | Delivery | Current role | Approximate weight size | Default-user behavior |
|---|---|---|---:|---|
| `Snowflake/snowflake-arctic-embed-s` | Downloaded from Hugging Face and stored in browser cache | Dense first-stage similarity | 34 MB int8 | Loaded during scoring warm-up |
| `wink-eng-lite-web-model` 1.8.1 | Bundled dependency | Tokenization, POS tags, lemmas, structured entity extraction, context gate input | 3.8 MB unpacked npm package | Always available with the extension bundle |
| `Xenova/ms-marco-MiniLM-L-6-v2` | Downloaded from Hugging Face and stored in browser cache | Pairwise cross-encoder reranking | 23.1 MB q8 | Loaded only when debug reranking runs |

The Hugging Face models run locally after download. Post and market text do not go to Hugging Face for inference. The remote search request still sends a bounded keyword query and up to two tag slugs to `knoww.app`. Optional AI extraction and validation can send text to configured AI endpoints, but those features are off by default.

Two additional models appear in optional server-side flows. They are remote services, not extension downloads:

| Model | Remote role | Default behavior |
|---|---|---|
| `openai/gpt-5.4-nano` through OpenRouter | Post-retrieval enrichment used to retry the context gate | Off by default; the server model can be overridden by configuration |
| `google/gemini-3-flash-preview` through OpenRouter | Relevance validation | Off by default; hard-coded in the current validation route |

Both extension calls are controlled by the single `aiExtractionEnabled` setting. Their prompts and input text leave the browser when enabled. The extraction model runs only after retrieval when no candidate passed and an eligible high-scoring hybrid candidate failed the context gate. It cannot retrieve an omitted market or change the Arctic and BM25 scores.

**Evidence:** `apps/web/src/app/api/ai/extract-topics/model-config.ts:1-6`, `apps/web/src/app/api/ai/extract-topics/route.ts:388-403`, `apps/web/src/app/api/ai/validate-relevance/route.ts:198-218`, and `apps/extension/src/types/settings.ts:175`.

No other learned model is invoked by the production matching path. `wink-nlp` 2.4.0 is the bundled NLP engine that runs the Wink web model. MiniSearch 7.2 is a lexical search library, not a learned model. `onnx-community/bge-small-en-v1.5-ONNX` appears only in the offline Node benchmark and is not downloaded by the browser extension.

### Model lineage and why Arctic does not replace MiniLM

The similar names hide three different models:

- Snowflake Arctic Embed **XS** is based on `all-MiniLM-L6-v2`.
- The extension uses Snowflake Arctic Embed **S**, which is based on `intfloat/e5-small-unsupervised`.
- The extension's MiniLM is `ms-marco-MiniLM-L-6-v2`, a cross-encoder trained to score a query and passage together. It is not the `all-MiniLM-L6-v2` sentence-embedding model used as the Arctic XS starting point.

| Property | Arctic Embed S | MS MARCO MiniLM L6 |
|---|---|---|
| Architecture in this pipeline | Bi-encoder | Cross-encoder |
| Inputs | Post and market encoded separately | Post and market encoded together |
| Market work reusable across posts | Yes | No |
| Efficient candidate count | Tens to thousands | A small shortlist |
| Best use | Retrieval and first-stage ranking | Final pairwise reranking |
| Score interpretation | Cosine similarity, not a probability | Raw relevance logit, not a probability |

These models are complementary. Arctic should cheaply narrow a broad candidate pool. MiniLM should spend more compute on the strongest candidates and resolve pairwise ambiguity.

## Pipeline as currently built

The default user settings have Polymarket enabled, Kalshi disabled, AI extraction disabled, and debug mode disabled. The normal path is therefore:

```text
post DOM
  -> platform adapter extracts post text
  -> direct market URLs are resolved separately
  -> rules choose six search terms and matched tags
  -> knoww.app search receives one query, at most two tags, limit=8
  -> extension maps active events, sorts by volume, keeps eight
  -> search-source results are merged, deduplicated, sorted by volume, and capped at ten
  -> direct Polymarket-link markets are prepended and can raise the scoring pool above ten
  -> market text is assembled
  -> Arctic cosine and nonzero BM25 evidence are combined 70/30; without BM25, use Arctic alone
  -> ordinary candidates pass Wink overlap and domain compatibility gates
  -> direct Polymarket-link markets bypass those gates and receive a score floor of 0.99
  -> fixed score threshold runs
  -> remote AI calls are skipped by default, but the unavailable-validator 0.5 floor still runs
  -> surviving markets are selected and cards are injected
```

MiniLM sits outside that normal path:

```text
debug mode only
  -> take the top five non-heuristic candidates from hybrid or lexical scoring
  -> score post-market pairs with MiniLM
  -> attach rerank logits
  -> continue through gates that still use the base first-stage score
  -> use MiniLM in candidate selection and final ordering
  -> affect the cards shown to the user
```

## What the implementation gets right

### Arctic Embed S

The implementation follows Snowflake's documented retrieval recipe:

- it adds `Represent this sentence for searching relevant passages: ` only to the post query;
- it leaves market documents unprefixed;
- it uses CLS pooling;
- it normalizes the vectors;
- it ranks with cosine similarity;
- it batches inference;
- it caches stable market embeddings in memory and IndexedDB;
- it prefers WebGPU and falls back to WASM.

Changing the trained query prefix is not recommended. The repository benchmark's custom prediction-market prefix performed worse than Snowflake's documented prefix.

### MiniLM cross-encoder

The reranker input and ordering logic are mechanically correct:

- the post is the first sequence;
- the market text is passed as `text_pair`;
- padding and truncation are enabled;
- the raw single logit is sorted in descending order;
- a sigmoid is not needed when the score is used only for ordering.

### Wink NLP

The code correctly initializes Wink and reads token values, POS tags, lemmas, and supported entities. It caches tokenization results and avoids repeated parsing for identical text.

The limitation belongs to the decision policy built around those outputs. The bundled English web model recognizes structured entities such as dates, money, percentages, mentions, URLs, and cardinal values. It does not provide person, organization, and geopolitical entity linking. The extension compensates by treating `PROPN` tokens as entities, which is exact-token matching rather than entity resolution.

### Failure handling

The scorer has useful degradation paths:

- WebGPU model-loading failures fall back to WASM;
- embedding failure can fall back to lexical scoring;
- lexical failure can fall back to a local heuristic;
- stale search cache can be used after an upstream request failure.

Those paths keep the extension functional, although their score semantics differ enough that they need separate calibration.

## Complete issue register

Priority meanings used below:

- **P0:** Blocks material relevance gains or invalidates model-selection conclusions.
- **P1:** Likely to cause a meaningful accuracy, reliability, or product-behavior problem.
- **P2:** Secondary quality, measurement, or operational weakness.

### Retrieval and candidate recall

#### R1. The search-derived candidate pool is too small

**Priority:** P0

**Evidence:** `apps/extension/src/content/api.ts:1217-1234`, `:1343-1370`, and `:1915-1939`, plus `apps/extension/src/content/injection.ts:1068-1080` and `:1360-1385`.

Polymarket search requests eight results. Mapping sorts by 24-hour volume and caps at eight. Combined search-source results are sorted by volume again and capped at ten before local relevance scoring. Direct Polymarket-link markets are prepended after this cap, so a post containing a market URL can produce a larger scoring pool.

**Effect:** For a post without a direct market URL, the proxy can return no more than eight Polymarket candidates, so an omitted market is unrecoverable. In the default Polymarket-only path, sorting those same eight by volume does not remove one. Volume can remove a relevant candidate when Kalshi contributes enough additional results, or when retrieval is widened without raising the downstream caps.

**Recommendation:** Request at least 20 candidates and raise every downstream cap in the same change. Preserve upstream relevance order as a feature, merge sources with reciprocal-rank fusion, and let local ranking narrow the pool. If product latency permits, score 30 to 50 candidates before reranking the top 10.

#### R2. One blended query must represent the whole post

**Priority:** P1

**Evidence:** `apps/extension/src/content/api.ts:780-864` and `:1052-1079`.

The rule extractor sorts keyword candidates, keeps six, and sends one combined query. It does not fan out by entity or event phrase.

**Effect:** A post containing several people, teams, or events can create a diluted query that retrieves none of them well.

**Recommendation:** Issue up to three bounded queries when needed: the strongest multi-word entity, the current blended query, and a second high-specificity entity. Merge results by ID with reciprocal-rank fusion. Skip fan-out when the first query already returns a high-confidence match.

#### R3. Only two tags reach the search service

**Priority:** P1

**Evidence:** `apps/extension/src/content/api.ts:1146-1161` and `apps/web/src/app/api/search/route.ts:25-53`.

Both the extension and server cap tag slugs at two.

**Effect:** Tags ranked third or later cannot improve recall even though the extractor may have found them.

**Recommendation:** Raise the cap only after measuring request cost and duplicate volume. Five tags is a reasonable experiment because the extension already handles that many in local market text.

#### R4. Recall depends on one remote relevance service

**Priority:** P1

**Evidence:** `apps/extension/src/content/api.ts:1217-1452`.

The default path relies on `knoww.app/api/search`, which in turn depends on upstream market search. Local models rank only returned candidates.

**Effect:** An upstream relevance miss is final. An outage forces stale, empty, or degraded behavior.

**Recommendation:** First widen and fan out proxy retrieval. If recall remains weak, maintain a small local index of active market embeddings and union its top results with proxy results.

#### R5. Stale search fallback has no maximum age

**Priority:** P1

**Evidence:** `apps/extension/src/content/api.ts:1174-1185` and `:1440-1452`.

After an upstream failure, the fallback cache read ignores `expiresAt`. The entry can be returned indefinitely until in-memory eviction or extension lifecycle cleanup removes it.

**Effect:** Users can see markets that have closed, changed, or become irrelevant long after the normal cache TTL.

**Recommendation:** Add a maximum stale age, record the age in diagnostics, and return no candidates once the stale limit is exceeded.

#### R6. Volume-first deduplication can hide distinct series markets

**Priority:** P2

**Evidence:** `apps/extension/src/content/api.ts:1915-1965`.

The extension deduplicates titles with a similarity threshold and keeps the higher-volume result.

**Effect:** Highly similar monthly, dated, or threshold variants may be merged even when their propositions differ.

**Recommendation:** Prefer stable event IDs, slugs, series IDs, and resolution dates before fuzzy title matching. Include date and threshold tokens in the duplicate key.

#### R7. The degraded flag is not preserved across a successful response contract

**Priority:** P2

**Evidence:** `apps/extension/src/content/api.ts:1188-1209` and `:1394-1452`, plus `apps/web/src/app/api/search/route.ts:126-127` and `:226-241`.

The extension reads and logs `payload.degraded`, but its fetch helper returns only the market array. The paired web route currently sends every degraded payload with HTTP 502, so the extension throws and takes its failure-cache path before this loss matters.

**Effect:** There is no active TTL bug with the current server. A deployment-skewed or future server that returns `200` with `degraded=true` would lose the flag and could receive a normal success TTL.

**Recommendation:** Preserve `{ markets, degraded }` across the helper boundary as a defensive contract, but do not treat this as a current production blocker.

### Post and market representation

#### C1. Social post extraction omits useful secondary context

**Priority:** P1

**Evidence:** `apps/extension/src/content/platforms/twitter.ts:284-299`.

The Twitter adapter uses the main tweet text plus direct market-link hints. It does not add quoted-tweet text, image alt text, author identity, or nearby thread context.

**Effect:** A short post whose meaning lives in a quote or image cannot match well.

**Recommendation:** Build structured post context with a primary field and bounded secondary fields. Keep the author's main text first, then append quote text and image alt text with lower influence.

#### C2. Editorial adapters may stop at headline and summary

**Priority:** P2

**Evidence:** `apps/extension/src/content/platforms/cnn.ts:103-147`.

CNN article extraction uses title plus document description. Feed cards use title plus available card text.

**Effect:** The specific person, date, or threshold in the article body may never reach retrieval or ranking.

**Recommendation:** Add the first one or two content paragraphs where reliable selectors exist. Cap secondary context and retain the headline first.

#### C3. Default market text omits child outcomes

**Priority:** P0

**Evidence:** `apps/extension/src/content/injection.ts:972-973` and `:1097-1119`.

Most platforms use event title, up to five tags, and only the first 120 description characters. Nested market labels and questions are included only when a platform enables `enableNestedMarketContext`. The current explicit enablement is limited to Fox Sports.

**Effect:** Team names, candidate names, strike values, and child questions are invisible on most feeds even though they may contain the best match.

**Recommendation:** Score each active child market as its own document. Include parent title, child question, outcome label, and a short resolution summary, then aggregate the best child score to the parent card.

#### C4. The nested-context fallback can exceed model limits

**Priority:** P1

**Evidence:** `apps/extension/src/content/market-context.ts:5-64`.

When nested context is enabled, the builder can append up to 160 labels and questions. Arctic and MiniLM truncate long inputs.

**Effect:** Early children dominate and later children disappear. The result depends on source ordering rather than relevance.

**Recommendation:** Do not concatenate an entire multi-outcome event. Use child-level documents or select child questions by lexical/entity overlap before model inference.

#### C5. Dates, thresholds, direction, and resolution criteria are not first-class fields

**Priority:** P0

**Evidence:** `apps/extension/src/content/injection.ts:1097-1119` and `apps/extension/src/background/nlp.ts:206-246`.

The ranking text is mostly prose. The decision pipeline has no explicit comparison for event date, year, money, percent, price threshold, team side, or outcome direction.

**Effect:** Markets about the same entity but different dates or thresholds can both look relevant. The system can select the right topic and the wrong proposition.

**Recommendation:** Extract typed constraints from both post and market. Compare compatible dates, amounts, percentages, named outcomes, and direction after semantic reranking. Use these checks as a penalty or veto only when both sides provide confident values.

#### C6. Long posts are truncated without selecting the most useful span

**Priority:** P2

**Evidence:** `apps/extension/src/background/embeddings.ts:453-456` and `:582-591`.

The embedding and cross-encoder tokenizers truncate. Editorial and community posts can exceed the model window.

**Effect:** Important details near the end disappear, and the result depends on source layout.

**Recommendation:** Preserve the headline or lead sentence, then select entity-rich sentences within a fixed token budget. Log truncation rates in the evaluation harness.

#### C7. Length and language prefilters can create zero recall

**Priority:** P1

**Evidence:** `apps/extension/src/content/injection.ts:1031-1043` and `apps/extension/src/content/utils.ts:255-399`.

Non-direct posts shorter than 20 characters are discarded. The English detector also requires at least 15 percent of tokens to belong to a small common-word set and at least 50 percent Latin characters.

**Effect:** Short but valid posts and noun-heavy headlines such as `Powell resigns Friday` can be rejected before retrieval. Ticker-heavy, named-entity-heavy, code-switched, and non-English posts are especially vulnerable.

**Recommendation:** Treat supported languages as an explicit product constraint. Benchmark this prefilter on real posts, exempt high-specificity entities and direct market language from the short-text rule, and use a tested language detector if English-only behavior remains required.

#### C8. The optional remote validator cannot see the full proposition

**Priority:** P1

**Evidence:** `apps/extension/src/content/api.ts:2320-2334`.

The relevance request sends at most the first 400 characters of the post, the candidate's top-level `market.title`, and tags. Search results commonly use a parent event title, while a directly resolved market can carry a child question. The request omits the remaining child questions and outcomes, description, end date, and resolution rules.

**Effect:** Even when enabled, the validator cannot reliably distinguish multi-outcome events or propositions that differ by date, threshold, or resolution criteria.

**Recommendation:** Validate the same child-level proposition document used by the reranker. Apply a strict text budget, but include the decisive structured fields before optional prose.

### Dense and lexical ranking

#### K1. MiniLM is debug-only

**Priority:** P0

**Evidence:** `apps/extension/src/content/injection.ts:1182-1251`.

The cross-encoder is loaded and called only when `isDebug` is true. The debug path reranks hybrid and lexical candidates, while heuristic candidates do not enter it.

**Effect:** Standard users download and use Arctic but receive no pairwise reranking. The best measured local quality improvement is absent from production.

**Recommendation:** Add a production feature flag, lazy-download MiniLM, and rerank a configurable top-K. Start with K=10 after widening retrieval.

#### K2. MiniLM cannot rescue an ordinary candidate rejected by the base pipeline

**Priority:** P0

**Evidence:** `apps/extension/src/content/injection.ts:1375-1458` and `:1748-1758`.

For non-direct candidates, Wink, domain, and threshold decisions use the base first-stage score from hybrid or lexical scoring. The rerank score affects candidate selection and ordering, but it cannot rescue an earlier gate or threshold rejection. Direct-link candidates take a separate bypass path.

**Effect:** A candidate that MiniLM considers strongest can still be rejected because it has one exact noun or a lower mixed score.

**Recommendation:** Treat the rerank score as an input to the decision stage. Calibrate a reranker rescue rule on labeled data rather than comparing raw logits to a hand-picked threshold.

#### K3. Mixed rerank and base-score ordering is not a total ordering

**Priority:** P1

**Evidence:** `apps/extension/src/content/injection.ts:351-370` and `:1748-1758`.

The comparator uses rerank scores only when both candidates have them. Otherwise it falls back to the base score. Candidate-window filtering then uses the base score of the rerank winner.

**Effect:** Ordering can be inconsistent when only part of the list was reranked. A rerank winner with a lower base score can also change the base-score cutoff in an unintended way.

**Recommendation:** Make the stages explicit. Place the reranked top-K in rerank order, append the untouched tail in base order, and apply a documented base-score safety floor separately.

#### K4. BM25 query and documents use different normalization

**Priority:** P1

**Evidence:** `apps/extension/src/background/nlp.ts:166-175` and `:343-345`.

Market documents are indexed as raw text. The post query uses up to 20 unique Wink lemmas.

**Effect:** Inflection and tokenization differences reduce exact lexical matches. Prefix and fuzzy matching hide some failures but make them harder to reason about.

**Recommendation:** Index and query the same normalized token representation. Preserve an additional exact field for tickers, years, amounts, hashtags, and multi-word entities.

#### K5. Per-pool BM25 normalization overstates weak evidence

**Priority:** P0

**Evidence:** `apps/extension/src/background/nlp.ts:348-361` and `apps/extension/src/content/injection.ts:1124-1137`.

Every BM25 score is divided by the maximum score in the current pool. Any nonzero lexical result activates a 30 percent BM25 weight.

**Effect:** The strongest lexical candidate receives `1.0` even when the absolute overlap is weak. Scores change when unrelated candidates enter or leave the pool. The fixed `0.5` downstream threshold is therefore unstable.

**Recommendation:** Use reciprocal-rank fusion for the first safe experiment. A later calibrated model can combine raw dense score, BM25 features, entity specificity, date compatibility, and rerank score.

#### K6. Fixed score weights have no domain calibration

**Priority:** P1

**Evidence:** `apps/extension/src/content/injection.ts:1131-1164` and `:1487-1495`.

When any BM25 score is nonzero, hybrid mode uses 70 percent embedding and 30 percent normalized BM25. When all BM25 scores are zero, it uses Arctic similarity alone. Lexical fallback uses 80 percent BM25 and 20 percent heuristic score.

**Effect:** The same score means different things in hybrid, lexical, and heuristic modes. Quantization or candidate-pool changes can shift behavior without changing the threshold. The UI converts this uncalibrated value to `N% match`, which gives it the appearance of a probability.

**Recommendation:** Measure and calibrate each mode separately. Replace the displayed percentage with a calibrated probability or a non-numeric relevance label.

#### K7. The default path raises the configured threshold to 0.5 in every mode

**Priority:** P0

**Evidence:** `apps/extension/src/types/settings.ts:164-179`, `apps/extension/src/relevance-threshold-policy.ts:1-30`, `apps/extension/src/content/scoring-policy.ts:775-788`, `apps/extension/src/content/api.ts:2311-2319`, `apps/extension/src/content/injection.ts:1693-1734`, and `apps/extension/src/options.tsx:881-906`.

The default user threshold is `0.3`. Hybrid mode directly applies `max(0.5, configuredThreshold)`. Lexical and heuristic candidates still enter the validation loop; with AI disabled, the validator returns no result and the unavailable-validator rule rejects scores below `0.5`.

**Effect:** The effective default minimum is `0.5` in every scoring mode. The user setting does not fully control the matching behavior, and valid candidates between `0.3` and `0.5` are removed. The settings page now explains the effective floor, so this is no longer hidden from the user.

**Recommendation:** Split the fix. First, disclose the configured and effective thresholds without changing matching behavior. That change is implemented in commit `5a47be9`. Do not lower the unavailable-validator floor until the evaluation set includes real no-match cases and measures false positives by scoring mode. A later change can remove or recalibrate the floor using those results. The final UI should replace the raw score with a product-level sensitivity control or explicit per-mode thresholds.

#### K8. Model revisions are not pinned

**Priority:** P2

**Evidence:** `apps/extension/src/background/embeddings.ts:128-153` and `:182-229`.

Model IDs and dtypes are fixed, but no Hugging Face revision is passed. The embedding cache namespace includes model ID and dtype, not revision.

**Effect:** An upstream repository change can alter weights or tokenizer files while existing vectors remain cached under the same namespace.

**Recommendation:** Pin a verified commit revision. Include the revision, pooling strategy, prefix version, and dtype in the embedding-cache namespace.

#### K9. Debug reranking changes user-visible selection and is not a shadow test

**Priority:** P1

**Evidence:** `apps/extension/src/content/injection.ts:351-370`, `:1182-1251`, and `:1748-1772`.

Enabling debug mode invokes MiniLM, and the rerank result participates in candidate selection and final sorting.

**Effect:** Debug and normal sessions can show different cards. Telemetry from debug mode therefore describes a different decision pipeline, not a controlled shadow comparison of identical output.

**Recommendation:** Separate diagnostics from feature behavior. Compute and log experimental scores in a true shadow path that cannot change selection, then use a distinct feature flag for user-visible reranking.

#### K10. BM25 ignores post lemmas after the first 20 unique terms

**Priority:** P1

**Evidence:** `apps/extension/src/background/nlp.ts:229-233` and `:343-345`.

The lexical query takes only the first 20 unique lemmas produced from the post context.

**Effect:** Later article, quote, or editorial context never participates in BM25 even though the dense tokenizer has a larger window. The result depends on field order rather than term specificity.

**Recommendation:** Select lexical terms by specificity and field priority within a documented budget. Keep the headline or primary post first, but reserve space for rare entities, dates, amounts, and tickers from secondary context.

#### K11. Optional AI validation sees at most two candidates with no fallback

**Priority:** P2

**Evidence:** `apps/extension/src/content/injection.ts:351-370`, `:1524-1526`, and `:1677-1745`.

Candidate selection keeps at most two markets before optional AI validation. If validation rejects both, the next eligible survivor is not considered.

**Effect:** A valid third-ranked candidate can be lost. This has low default impact because remote AI validation is disabled, but it affects validation experiments and any future default-on configuration.

**Recommendation:** Validate a ranked queue until enough cards pass or the latency budget is exhausted. Keep the maximum explicit and include rejection reasons in evaluation data.

#### K12. The reranker queue has no deadline, cancellation, or backlog limit

**Priority:** P2

**Evidence:** `apps/extension/src/background/embeddings.ts:631-648`.

Rerank requests share one serialized global promise queue. Every request waits for earlier work, and queued work cannot be cancelled when a post leaves the viewport or a tab becomes irrelevant.

**Effect:** The impact is limited while reranking remains debug-only. A production rollout across tabs could accumulate stale work, increase tail latency, and delay the newest visible match.

**Recommendation:** Add a bounded queue, per-request deadlines, latest-only cancellation for superseded posts, and queue-wait telemetry before enabling reranking broadly.

### Wink and decision gates

#### G1. The default two-signal gate causes false negatives

**Priority:** P0

**Evidence:** `apps/extension/src/background/nlp.ts:243-302`.

The base gate requires two distinct non-generic noun or entity signals. Direct links bypass it, selected platforms can use a relaxed single-signal path, and a narrow high-precision recovery rule creates another exception.

**Effect:** An ordinary non-direct candidate without a recovery exception can fail on a valid single-entity post. A semantic paraphrase with no exact noun overlap also fails this path even when Arctic or MiniLM scores it highly.

**Recommendation:** Replace the count with a specificity-weighted score. One rare entity with a strong rerank score should be enough. Two generic nouns should not be enough.

#### G2. The entity model is not an entity linker

**Priority:** P1

**Evidence:** `apps/extension/src/background/nlp.ts:189-235` and the bundled Wink model README.

The extension promotes proper nouns to entities because the web model does not link people, organizations, or places.

**Effect:** `Bibi` and `Netanyahu`, `BTC` and `Bitcoin`, or a handle and display name do not match unless hand-written rules happen to cover them. Common capitalized words can look like entities.

**Recommendation:** Build a small local alias dictionary from market titles, tags, outcomes, tickers, and known handles. Weight aliases by corpus rarity.

#### G3. Predicate evidence is discarded and numeric handling is inconsistent

**Priority:** P0

**Evidence:** `apps/extension/src/background/nlp.ts:206-220` and `:243-246`.

The token path removes bare numeric POS values and pure numeric entities, while Wink's structured-entity path can preserve some formatted money and compound date expressions. The overlap gate uses nouns and proper nouns, excluding verbs and adjectives.

**Effect:** Predicates such as `above`, `below`, `win`, `lose`, `resign`, and `approve` cannot distinguish related markets. Bare years and thresholds can disappear, and preserved date or money strings still lack typed comparison semantics.

**Recommendation:** Keep Wink for tokenization, but add typed constraint extraction and predicate features. Do not force proposition matching through noun counts.

#### G4. Unknown post domain is treated as incompatible

**Priority:** P1

**Evidence:** `apps/extension/src/content/scoring-policy.ts:587-600` and `:861-870`.

If a market has a known domain and the post has none, domain compatibility returns false.

**Effect:** A novel name or topic absent from the regex taxonomy can pass lexical overlap and still be rejected.

**Recommendation:** Treat unknown as neutral. Reject only when both sides have confident and incompatible domains.

#### G5. Single-signal recovery is narrow and domain-skewed

**Priority:** P1

**Evidence:** `apps/extension/src/content/scoring-policy.ts:163-177` and `:841-859`.

The high-precision single-signal list is mostly crypto protocols and prediction-market venues.

**Effect:** Crypto posts receive a recovery path that people, sports, politics, and entertainment entities usually do not.

**Recommendation:** Replace the hand-written list with corpus-derived entity specificity and aliases.

#### G6. AI retry cannot recover zero-overlap semantic matches

**Priority:** P1

**Evidence:** `apps/extension/src/content/scoring-policy.ts:873-882` and default settings at `apps/extension/src/types/settings.ts:175`.

AI extraction is off by default. Even when enabled, retry eligibility requires at least one meaningful noun or entity signal.

**Effect:** A high-scoring paraphrase with zero literal overlap is never retried. The extraction call runs after retrieval and only reruns the context gate with enriched terms; it cannot recover an omitted candidate or change Arctic and BM25 scores.

**Recommendation:** Let a calibrated MiniLM score trigger local recovery. Keep remote AI retry optional rather than using it to compensate for a brittle local gate.

#### G7. Negation and stance need an explicit product decision

**Priority:** P2

A post opposing a proposition is still topically relevant to the market card, so negation should not automatically reject it. Direction and stated outcome do matter when choosing among child outcomes or near-duplicate propositions.

**Recommendation:** Keep stance out of the topical gate. Use direction and negation as ranking features when they distinguish two candidate propositions.

#### G8. Ranking and gate text use different market fields

**Priority:** P1

**Evidence:** `apps/extension/src/content/injection.ts:1097-1119` and `apps/extension/src/content/scoring-policy.ts:695-707` and `:823-828`.

The ranking text includes up to five tags, but the noun and entity gate does not. A matching tag can pass directly in heuristic mode, while hybrid mode still depends on the gate text that omitted it.

**Effect:** A tag can strengthen the hybrid score but remain unavailable to the rule that decides whether the candidate is contextually valid. This creates mode-specific false negatives and makes feature attribution misleading.

**Recommendation:** Define one structured candidate representation and declare which fields each stage receives. If tags are trusted evidence, expose them to the same calibrated feature layer in every scoring mode.

### Browser delivery, reliability, and observability

#### O1. The main model warm-up starts immediately without user-facing scheduling

**Priority:** P1

**Evidence:** `apps/extension/src/content/main.ts:173-180`, `apps/extension/src/content/discovery-warmup.ts:20-31`, and `apps/extension/src/background/embeddings.ts:16-18` and `:655-671`.

On each visible supported non-stream tab, the content path starts scoring warm-up immediately rather than waiting for idle or the first candidate. Transformers.js uses browser cache, and progress is sent to structured logs. There is no standard user-facing download prompt, size choice, cancellation control, or progress display in the matching flow.

**Effect:** A user can incur a roughly 34 MB model download as soon as a supported page initializes, without seeing the size or choosing a quality tier. The first run can also compete with page startup work.

**Recommendation:** Add an explicit model-pack consent and scheduling flow. Explain that matching runs locally, show model weight size and progress, schedule accepted downloads during browser idle time, provide retry and cancellation, and allow users to clear downloaded models.

#### O2. MiniLM pays a cold-load penalty on first rerank

**Priority:** P2

**Evidence:** `apps/extension/src/background/embeddings.ts:232-254` and `:655-671`.

The warm-up path loads Arctic only. MiniLM is lazy, which avoids an unnecessary download today but creates a cold first rerank once promoted.

**Recommendation:** Keep it lazy. After the user accepts the standard model pack, download and warm MiniLM during idle time rather than on the first visible match.

#### O3. Browser performance is not measured by the benchmark

**Priority:** P1

**Evidence:** `apps/extension/scripts/benchmark-embeddings.mjs:293-324`.

The checked-in harness runs under Node against locally cached model files. It does not measure cold download, WebGPU, WASM, peak memory, browser storage, device failures, or feed responsiveness.

**Recommendation:** Add browser runs on one low-end and one typical reference device. Record cold and warm p50 and p95 latency, memory, download bytes, cache size, and fallback rate.

#### O4. Normal telemetry cannot currently calibrate relevance

**Priority:** P1

**Evidence:** `apps/extension/src/content/relevance-telemetry.ts:51-65` and `:146-180`.

Detailed relevance telemetry is enabled only in debug mode, held in memory, capped at 500 events, and available through manual export. Existing per-post counters are also debug-only. They cannot support a week-long production baseline in their current form.

**Effect:** The team lacks a representative labeled stream for threshold and gate calibration.

**Recommendation:** Add an opt-in, privacy-reviewed feedback path. Store compact features and explicit good or bad feedback rather than raw post text whenever possible.

#### O5. Gate diagnostics count signals differently from the gate

**Priority:** P2

**Evidence:** `apps/extension/src/content/injection.ts:1400-1407` and `apps/extension/src/background/nlp.ts:295-300`.

Diagnostic counts add matching nouns and matching entities, so a proper noun present in both sets can be counted twice. The actual gate deduplicates the union before evaluating it.

**Effect:** Zero-signal and single-signal telemetry does not describe the rule that users actually encounter. Threshold calibration based on those counters can be biased.

**Recommendation:** Emit the gate's deduplicated signal IDs and final count directly from the gate result. Add a test that compares decision diagnostics with the decision itself.

#### O6. One setting enables two distinct remote AI data flows

**Priority:** P1

**Evidence:** `apps/extension/src/types/settings.ts:175`, `apps/extension/src/options.tsx:971-983`, `apps/extension/src/content/injection.ts:1531-1628` and `:1677-1739`, and `apps/extension/src/content/api.ts:943-1000` and `:2311-2334`.

The `aiExtractionEnabled` toggle enables both post-retrieval gate-retry enrichment and per-candidate remote relevance validation. The settings copy describes one general verification behavior and does not distinguish the endpoints, triggers, or text each receives.

**Effect:** A user cannot enable one remote step without enabling the other or make an informed choice about the two data flows. It also makes experiments hard to attribute because one switch changes two stages.

**Recommendation:** Use separate controls and feature flags for gate-retry enrichment and candidate validation. Explain when each call occurs, which post and market fields leave the browser, the provider path, and the fallback behavior.

### Benchmark and test evidence

#### B1. The benchmark is saturated

A fresh run of the checked-in benchmark produced:

| Configuration | nDCG@3 | MRR | Hit@1 | Hit@3 |
|---|---:|---:|---:|---:|
| BGE mean q4 plus MiniLM rerank | 0.915 | 1.000 | 1.000 | 1.000 |
| Arctic q8 plus MiniLM rerank | 0.915 | 1.000 | 1.000 | 1.000 |
| BGE mean q4 | 0.905 | 1.000 | 1.000 | 1.000 |
| BGE CLS q4 | 0.898 | 1.000 | 1.000 | 1.000 |
| BGE CLS q8 | 0.898 | 1.000 | 1.000 | 1.000 |
| Arctic CLS q8 | 0.898 | 1.000 | 1.000 | 1.000 |
| Arctic CLS q4 | 0.892 | 1.000 | 1.000 | 1.000 |
| Arctic custom prediction-market prefix q4 | 0.880 | 1.000 | 1.000 | 1.000 |

The script names its last two fields `recallAt1` and `recallAtK`, but the implementation records a binary hit when any relevant candidate appears within K. They are Hit@1 and Hit@3, not standard recall over all relevant candidates. The fixture contains 58 positive labels across 100 candidate pairs, so this distinction matters.

The result supports two narrow conclusions:

1. The documented Arctic prefix should remain unchanged.
2. MiniLM improves secondary ordering on this fixture.

It does not establish the best production model.

All BGE rows also use the benchmark's custom prediction-market query prefix rather than a documented BGE retrieval instruction. Their values are descriptive results for this harness, not a controlled Arctic-versus-BGE comparison.

Run record for the table:

- **Command:** `pnpm --filter @knoww/extension benchmark:embeddings`
- **Repository:** HEAD `b0f055022db8`; the benchmark script and fixtures had no working-tree edits
- **Runtime:** Node.js 26.7.0 and `@huggingface/transformers` 4.2.0
- **Arguments:** default fixtures, all configurations, batch size 8, and K=3
- **Machine:** arm64 MacBook Pro, Apple M5 Pro with 15 cores and 24 GB memory, macOS 26.5.2
- **Cache:** default filesystem model cache at `apps/extension/.embedding-benchmark-cache`; caching was enabled and the cache was populated

The table reports ranking metrics rather than runtime. Repeat it with a cleared cache only when measuring cold download or load behavior.

#### B2. The fixture cannot measure realistic recall or no-match precision

**Evidence:** `apps/extension/scripts/benchmark-embeddings.mjs:224-251`, `:357-375`, and `:435-477`.

- It contains 20 hand-written cases.
- Each case has exactly five candidate markets.
- Every case must contain a positive market.
- The reranker is configured for top five, so it reranks the entire list.
- There are no true no-match posts.
- The wording closely mirrors the expected markets.

**Effect:** Hit@1 is already perfect for every tested configuration. The benchmark mainly measures ordering among easy candidates. With no true no-match posts, it cannot measure false injections or no-match precision.

#### B3. The benchmark omits most of production

It does not run:

- live search retrieval;
- the eight and ten candidate caps;
- direct-market resolution, its gate bypass, and its `0.99` score floor;
- volume sorting;
- production market text construction;
- BM25 and its normalization;
- Wink and domain gates;
- fixed thresholds;
- nested outcomes;
- dates and typed constraints;
- no-match rejection;
- browser device and cold-load behavior.

#### B4. Model-specific test coverage is thin

**Evidence:** `apps/extension/tests/background/embeddings-warmup.test.ts` and `apps/extension/tests/background/nlp.test.ts`.

The embedding tests focus on warm-up and device fallback with mocked outputs. There are no dedicated reranker tests for pair order, batching, logits, queue behavior, or partial failures. There are also no dedicated BM25 tests for normalization parity, the 20-term cap, max-score normalization, cache keys, or numeric and ticker preservation. NLP tests cover selected gate examples but do not measure gate precision and recall across a labeled set.

## Recommended target pipeline

```text
1. Extract structured post context
   primary text, quote/body/alt secondary text, entities, dates, amounts

2. Retrieve broadly
   direct link resolution
   plus 1 to 3 proxy queries
   plus optional local embedding index
   merge with reciprocal-rank fusion

3. Build child-level candidate documents
   parent event title
   child question and outcome
   resolution summary
   end date
   tags, aliases, tickers, teams, people

4. Rank all candidates cheaply
   Arctic Embed S cosine
   plus normalized lexical rank
   keep top 10 to 20

5. Rerank pairs
   MiniLM reads post and candidate together

6. Check proposition constraints
   entity aliases
   date and time window
   amount or percentage
   threshold and direction
   domain only when both sides are confident

7. Make a calibrated decision
   direct match
   adjacent but not direct
   no match

8. Select and measure
   inject top one or two
   record opt-in good or bad feedback and latency
```

## Phased implementation plan

### Phase 0. Build evidence and check capacity before widening retrieval

Add privacy-reviewed aggregate counters before changing ranking behavior. Record per-post retrieval count, search-proxy failure class, degraded-to-empty responses, gate rejection reason, validator state, scoring mode, and the final selection result. Do not persist raw post text by default. The current debug-only in-memory telemetry is useful for local diagnosis, but it is not a representative production baseline.

Load-test the `knoww.app` search proxy at the proposed query count and candidate limit before widening retrieval. Test one active tab and several concurrent tabs. Measure rate-limit responses, latency, empty degraded responses, and recovery time. Add request deadlines, bounded retries with backoff, and a client-side capacity guard before increasing steady-state request volume. The current fixed 900 ms content queue is per tab and does not provide cross-tab backoff.

Create a versioned evaluation set with 500 to 1,000 real, consented, and anonymized post snapshots plus contemporaneous market snapshots.

Dataset requirements:

- 30 to 40 percent true no-match cases;
- 20 to 100 production-retrieved candidates per post;
- two independent labels using `0 = unrelated`, `1 = topically adjacent`, and `2 = direct card match`;
- adjudication for disagreements;
- a held-out test split;
- strata for platform, domain, post length, and device class;
- hard negatives involving the same person, team, country, or asset but the wrong date, outcome, threshold, or event;
- single-entity posts, lowercase names, handles, tickers, quotes, image context, and multi-outcome events.

Measure each stage separately:

| Stage | Metrics |
|---|---|
| Retrieval | Recall@20, Recall@50, candidate count, upstream failure rate |
| First-stage ranking | Recall@5, Recall@10, MRR, nDCG@10 |
| Reranking | Precision@1, nDCG@3, regressions by hard-negative class |
| Wink and domain gate | Precision, recall, F1, rejection reasons |
| Full pipeline | Precision@1, no-match rejection accuracy, injection coverage |
| Browser runtime | Cold bytes, cold start, warm p50 and p95, memory, cache, failure rate |

### Phase 1. Unlock existing quality and recall

1. Disclose the configured threshold and its effective floors without changing matching behavior. Completed in commit `5a47be9`.
2. Split and disclose the two optional remote AI controls.
3. Run a bounded child-context pilot on the existing Fox Sports feature-flag path. Cap child count and text length before comparing it with the current title-only path.
4. Lower or remove the unavailable-validator `0.5` floor only if the evaluation set shows an acceptable false-positive rate for lexical and heuristic matches between `0.3` and `0.5`.
5. Raise Polymarket retrieval from 8 to 20 and raise downstream caps only after the proxy capacity test passes.
6. Add a true MiniLM shadow path that records scores without changing card output.
7. After shadow evaluation, put production MiniLM reranking behind a distinct feature flag.
8. Use an explicit two-stage rerank ordering rather than the mixed comparator.
9. Bound the reranker queue and cancel superseded work.
10. Add a maximum stale-cache age.
11. Pin model revisions and version embedding caches.
12. Benchmark the length and language prefilters before they can end retrieval.

### Phase 2. Fix the text that models receive

1. Expand the bounded child-context pilot only after measuring candidate quality, document length, scoring latency, and memory. Keep a hard child-count and text-length cap.
2. Include outcome names, dates, resolution criteria, aliases, and tickers.
3. Add bounded quote, image-alt, and article-lead context where available.
4. Normalize BM25 documents and queries identically.
5. Preserve exact fields for numeric and symbolic tokens.
6. Replace max-normalized BM25 blending with reciprocal-rank fusion as the first safe change.

### Phase 3. Replace brittle gates with calibrated evidence

1. Treat Wink outputs as features rather than a hard authority.
2. Allow a specific entity plus strong MiniLM evidence to pass.
3. Treat unknown domain as neutral.
4. Add typed proposition checks.
5. Fit thresholds and fusion weights on validation data only.
6. Keep a held-out test split for the final decision.

### Phase 4. Test model upgrades

Only compare larger or different models after Phases 0 to 3. A model swap before fixing recall and representation will hide pipeline errors rather than solve them.

## Browser-downloadable model options

| Candidate | Role | Approximate browser weight | Published license or terms | Evidence and recommendation |
|---|---|---:|---|---|
| Arctic Embed S int8 | Embedding | 34 MB | Apache-2.0 | Keep as the standard default until a full-pipeline benchmark proves otherwise |
| Arctic Embed M int8 | Embedding | 110 MB | Apache-2.0 | Lowest-integration-risk larger embedding candidate; Snowflake reports generic MTEB retrieval 54.90 versus 51.98 for S, but the repository has not tested it |
| `mxbai-embed-xsmall-v1` int8 | Embedding | 24.4 MB | Apache-2.0 | Good size experiment, but no verified in-domain advantage over Arctic S |
| MiniLM L6 q8 | Reranker | 23.1 MB | Apache-2.0 | Keep and promote to production after a true shadow test and explicit download handling |
| MiniLM L12 q8 | Reranker | About 34 MB | Apache-2.0 | Do not prioritize; the model author reports almost identical generic quality and about half the throughput of L6 on a V100 GPU, not in a browser |
| `jinaai/jina-reranker-v1-turbo-en` int8 | Reranker | About 38.3 MB | Apache-2.0 | Official ONNX and Transformers.js artifacts exist, but this repository has not verified runtime compatibility, output semantics, in-domain quality, or browser latency |
| `mxbai-rerank-xsmall-v1` quantized | Reranker | 87.2 MB | Apache-2.0 | Plausible A/B candidate with documented Transformers.js support, not a proven default replacement |
| Arctic Embed M v2 int8 | Embedding | 311 MB | Apache-2.0 | Browser-capable but too large for the default extension experience |
| EmbeddingGemma 300M q4 | Embedding | About 197 MB | Gemma terms and prohibited-use policy | Browser-capable and multilingual, but too large for the default and requires a separate terms review |

These are evaluation candidates, not safe model-ID substitutions. The current embedding wrapper hardcodes Arctic's query prefix and CLS pooling in `apps/extension/src/background/embeddings.ts:447-477`. Mixedbread xsmall documents average or mean pooling. EmbeddingGemma exposes its own sentence-embedding output and requires distinct retrieval-query and document prompts. Every embedding candidate needs a model-specific preprocessing, pooling, output, normalization, cache-version, and score-calibration adapter. Every reranker needs an output-shape and logit-semantics check. Test the adapter against the model author's reference output before measuring relevance.

Suggested user-facing packs:

| Mode | Models | Approximate model weights |
|---|---|---:|
| Standard | Arctic Embed S int8 plus MiniLM L6 q8 | 57 MB |
| Experimental high accuracy | Arctic Embed M int8 plus MiniLM L6 q8 | 133 MB |

These totals exclude small tokenizer and configuration files. A model-selection UI should state the download size and that inference runs locally. Before shipping any pack, review the exact model and converted-artifact terms, pin the repository revision, and record hashes for every downloaded file.

Treat the Jina reranker as experimental even though official browser artifacts exist. Compatibility with this extension's Transformers.js 4.2 runtime, the expected logits, and production browser constraints still needs a local proof.

### MiniLM-only experiment

If the product intentionally keeps a fixed pool of eight or fewer candidates, benchmark a MiniLM-only path. It may simplify scoring and reduce the combined download. Do not choose it without browser measurements because every candidate requires fresh pairwise inference, and it does not support a future local market-embedding index. The current offscreen runtime also calls Arctic warm-up before it inspects scoring feature flags, so a true MiniLM-only mode requires an orchestration change or it will still download and load Arctic. This behavior is in `apps/extension/src/offscreen/scoring-runtime.ts:36-40` and `apps/extension/src/background/embeddings.ts:655-664`.

## Recommended decision

Adopt the following direction unless the new evaluation set disproves it:

1. Fix the hidden `0.5` threshold and other pre-model recall losses before comparing models.
2. Keep Arctic Embed S as the standard first-stage model.
3. Promote MiniLM L6 to a production top-K reranker after a true shadow test and explicit model download handling.
4. Keep Wink for tokenization and feature extraction, but stop using its two-signal count as the default veto.
5. Widen retrieval before spending more browser memory on a larger model.
6. Score child propositions as first-class documents alongside parent event summaries.
7. Add typed date, amount, threshold, and direction checks.
8. Calibrate the full pipeline on real no-match and hard-negative cases.
9. Offer Arctic Embed M only as an experimental opt-in pack after an in-domain browser A/B test.

This sequence addresses the largest errors in their actual order. Recall determines whether the correct market is available. Representation determines whether the models can see the distinguishing facts. Reranking determines pairwise order. Calibration and proposition checks decide whether a card should appear at all.

## Suggested release gates

A replacement pipeline or model should ship only when it meets all of these conditions on a held-out set:

- a material full-pipeline gain, such as at least three percentage points in Precision@1 or gate F1;
- no reduction in retrieval recall;
- no increase in the false-positive rate for true no-match posts;
- measured WebGPU and WASM latency inside a product-approved budget;
- a documented download, memory, and browser-storage budget;
- legal review of the exact model and converted-artifact terms;
- pinned revisions and recorded hashes for all model, tokenizer, and configuration files;
- reference-output tests for each model's preprocessing, pooling, and output adapter;
- no regression in direct-link resolution;
- stable results after clearing and rebuilding versioned caches;
- an opt-in live experiment confirms the offline result.

The exact latency and false-positive targets should be set from the current production baseline rather than invented in advance.

## Source references

### Repository

- `apps/extension/src/background/embeddings.ts`
- `apps/extension/src/background/nlp.ts`
- `apps/extension/src/background/score-markets-core.ts`
- `apps/extension/package.json`
- `apps/extension/src/content/api.ts`
- `apps/extension/src/content/config.ts`
- `apps/extension/src/content/discovery-warmup.ts`
- `apps/extension/src/content/injection.ts`
- `apps/extension/src/content/main.ts`
- `apps/extension/src/content/market-context.ts`
- `apps/extension/src/content/relevance-telemetry.ts`
- `apps/extension/src/content/scoring-policy.ts`
- `apps/extension/src/content/utils.ts`
- `apps/extension/src/offscreen/scoring-runtime.ts`
- `apps/extension/src/options.tsx`
- `apps/extension/src/types/settings.ts`
- `apps/extension/scripts/benchmark-embeddings.mjs`
- `apps/extension/perf-fixtures/embedding-ab.json`
- `apps/extension/perf-fixtures/embedding-ab-extra.jsonl`
- `apps/web/src/app/api/search/route.ts`
- `apps/web/src/app/api/ai/extract-topics/model-config.ts`
- `apps/web/src/app/api/ai/extract-topics/route.ts`
- `apps/web/src/app/api/ai/validate-relevance/route.ts`
- `docs/card-matching-review.md`

### External primary sources

- Snowflake Arctic Embed S model card: <https://huggingface.co/Snowflake/snowflake-arctic-embed-s>
- Snowflake Arctic Embed XS model card: <https://huggingface.co/Snowflake/snowflake-arctic-embed-xs>
- Snowflake Arctic Embed M model card: <https://huggingface.co/Snowflake/snowflake-arctic-embed-m>
- Snowflake Arctic Embed M ONNX files: <https://huggingface.co/Snowflake/snowflake-arctic-embed-m/tree/main/onnx>
- Snowflake Arctic Embed M v2 ONNX files: <https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0/tree/main/onnx>
- MS MARCO MiniLM L6 cross-encoder model card: <https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2>
- MiniLM L6 browser ONNX files: <https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/tree/main/onnx>
- Wink English web model: <https://github.com/winkjs/wink-eng-lite-web-model>
- Mixedbread xsmall embedding model: <https://huggingface.co/mixedbread-ai/mxbai-embed-xsmall-v1>
- Mixedbread xsmall reranker model: <https://huggingface.co/mixedbread-ai/mxbai-rerank-xsmall-v1>
- EmbeddingGemma browser ONNX files: <https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/tree/main/onnx>
- Gemma terms: <https://ai.google.dev/gemma/terms>
- Jina reranker browser ONNX files: <https://huggingface.co/jinaai/jina-reranker-v1-turbo-en/tree/main/onnx>
- Transformers.js WebGPU guide: <https://huggingface.co/docs/transformers.js/guides/webgpu>
