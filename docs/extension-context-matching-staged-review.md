# Review of the staged context matching changes

Date: 2026-08-29
Scope: the staged changeset on branch `mcp` at HEAD `531a406` (66 files, +7347/-418), reviewed against `docs/extension-context-matching-model-report.md`. Read-only review; no code was edited and nothing was committed.

## Verdict

The staged work matches the report, and the report's honesty holds up under file-by-file inspection. Every substantive staged file was read or diffed, and the validation record was reproduced independently:

- Vitest: 108 files, 770 tests, all passing (2.50s)
- `tsc --noEmit`: clean
- Evaluation node tests: 11/11
- Search proxy capacity library tests: 6/6

No case was found where the code does something the report hides, or where the report claims something the code does not do. The changeset is safe to keep staged as-is. The one real pushback is on framing, not substance: the report undersells what goes live immediately.

## Live behavior changes the report should name more plainly

The report's summary line, that evidence-dependent rollout changes remain disabled, is true. But five behavior changes take effect the moment the extension loads.

1. **The BM25 rewrite is the headline live risk.** `apps/extension/src/background/nlp.ts` drops MiniSearch entirely. The old scorer max-normalized within each candidate pool and matched on wink lemmas with prefix and fuzzy matching. The new one computes a pool-independent absolute score with no IDF, no lemmatization, and no fuzzy matching, over the first 40 raw tokens (k1=1.2, b=0.75, fixed reference document length 40, bounded below 1). The design is better: scores are comparable across pools, exact tickers survive, and results are deterministic. But absolute scores sit lower than pool-normalized ones, and neither the blend weights (0.3 lexical in hybrid, 0.2 in fallback) nor the 0.5 threshold moved. Some posts that used to cross the line will not. Nobody can size this yet because the evaluation dataset does not exist, and the instrument that will measure it, the aggregate telemetry, ships in the same change. The fix and its measuring stick arrive together. That is a defensible trade, but the owner should accept it knowingly rather than discover it in week-one telemetry.

2. **Unknown post domain is now neutral** instead of an implicit mismatch. A principled loosening.

3. **A passing fallback score can now override a wink-gate failure**, but only with at least one shared specific entity and both domains known and compatible. Looser outcome, tighter evidence than the old path.

4. **Both single-signal rescue paths are dead until reranker promotion, and this lands on two named surfaces the report never names.** `apps/extension/src/content/platforms/kalshi-website.ts:333` and `apps/extension/src/content/platforms/manifold-markets.ts:129` set `relaxContextGate`, and the relaxed path now also requires `specificEntityCount > 0` plus a passing rerank, which cannot pass today (`rerankEvidence` has no live caller). Kalshi's website and Manifold will show fewer cards. The report's task 9 row says "rerank recovery remains unavailable", which is accurate but anonymous.

5. **Bounded context documents change the live text fed to embeddings and the gate.** `context-documents.ts` enforces a 1600-character total budget, 20 nested children, and word-boundary truncation. Mostly a safety win; very long markets now embed a prefix of themselves.

Net effect: expect live match volume to move, probably downward, from items 1 and 4, partly offset by 2 and 3. The `shown` versus `threshold_rejected` counters in the first telemetry week are where the BM25 change will show its hand.

## The disabled machinery is genuinely locked

Each lock was verified in code, not just its existence.

- Production rerank fails closed three independent ways. The settings merge clamps `productionRerankerEnabled` to false unless the compile-time promotion record passed (`mergeStoredUserSettings` requires `productionRerankerPromoted === true && stored === true`), `isProductionRerankerEnabled()` requires promotion and the user setting, and the options toggle renders with `disabled={!canUseProductionReranker()}`. The bundled promotion record has status `insufficient_evidence`.
- Promotion requires schema version 1, status `passed`, and matching manifest version and reranker revision. Calibration additionally pins the document schema version and rejects any artifact fitted on the held-out split. The bundled calibration artifact is null.
- Proposition checks run in shadow. `shouldBlockCandidateForProposition` returns `calibrationActive && !compatible`, and `hasActiveContextCalibration()` is false today.
- Rerank cannot affect display order even in debug mode. Injection sorts by base score only (`selectTopBaseCandidates` / `rankCandidatesByBaseScore`) and logs `shadow-display-order`.
- The RRF two-stage pipeline (`ranking-pipeline.ts`) has zero importers outside its own file and tests.
- Retrieval limits stay 8/10 in `retrieval-limits.ts`, with a comment tying any increase to the capacity check.

Two more claims survived end-to-end inspection. The counts-only telemetry claim is real: enum-validated samples, caps of 1000 per counter and 120s on latency, a `sender.id === runtime.id` check on record, export, and clear, serialized store writes to prevent read-modify-write races, 14-day retention, and no free-text field anywhere in the schema. And the model pinning is wired into actual loading rather than being decorative: revisions flow into `from_pretrained`, pooling and the query prefix come from the manifest, and the IndexedDB cache namespace is built from manifest fields, so a model change gets a fresh cache instead of poisoned vectors.

## Smaller findings

- The calibration fitter in `apps/extension/scripts/lib/context-calibration.mjs` demands perfectly separable score distributions and throws "scores are not separable; use a calibrated optimizer" otherwise. Real overlapping distributions will trip that every time, so the fitter is a placeholder that needs replacing before calibration can ever activate. The code is honest about this; the report's "calibration artifact fitter" sounds more finished than it is.
- `apps/extension/package.json` line 33 still declares `minisearch` 7.2.0 with no remaining imports. Drop it.
- Degraded memory-cache hits synthesize status 502 into the telemetry sample. Outcome classification stays correct because `degraded` is checked before `failed`, but the fabricated status will mislead anyone who later reads statuses directly.
- A degraded or failed search still writes a 30-second empty entry into the failure cache. This is a pre-existing self-poisoning risk under proxy flapping, now at least measurable via the `stale_cache` source counter.
- Direct-link event fetches bypass the new scheduler; only `/api/search` goes through it. Defensible since direct links follow user action, but "search traffic is protected" carries that caveat.
- The manifest's sha256 digests are checked only by the offline comparison harness and tests, never at runtime. Acceptable because Hugging Face revisions are immutable git commits, but "pinned and verified" should not be read as runtime verification.
- Queue details are sensible. Overflow drops the oldest pending rerank so the newest post wins while scrolling, supersede cannot abort ONNX inference already in flight (the code acknowledges this), skip reasons (capacity, deadline, superseded) are logged distinctly from failures, and the request key is capped at 256 characters.
- A quiet but necessary fix: `benchmark-embeddings.mjs` dropped its "every case needs a relevant market" assertion, without which the required 30 to 40 percent no-match cases could never load.

## The open gates are real and honestly tracked

`tasks/context-matching-todo.md` matches the report, and every unchecked gate fails closed in code rather than in prose. `assessEvaluationReadiness` enforces the 500 to 1000 case range, the 30 to 40 percent no-match share, 20 to 100 candidates per case, train/validation/test splits with at least 10 percent held out, adjudication on label disagreements, split-leakage detection on normalized post text, and all four hard-negative classes. The capacity probe is localhost-gated behind an `--allow-remote` flag with a 500-request total cap and a 15-minute runtime cap.

Remaining before any rollout lever moves:

- Collect the consented, anonymized evaluation dataset.
- Run one week of aggregate and MiniLM shadow telemetry.
- Pass the multi-tab capacity check before raising retrieval limits.
- Run real-browser WebGPU and WASM model-pack comparisons on the held-out split.
- Get product sign-off on the false-positive and download-size promotion criteria.

## Recommendations

1. Keep the changeset staged as-is; nothing needs to be pulled out.
2. Two report edits before committing: name Kalshi's website and Manifold in the task 9 disclosure, and add a line that the BM25 rewrite's live match-volume effect is unmeasured until telemetry runs.
3. One code cleanup: remove the orphaned `minisearch` dependency.
4. In the first telemetry week, watch the `shown` to `threshold_rejected` ratio for the BM25 effect, and the `stale_cache` counter for failure-cache poisoning.
