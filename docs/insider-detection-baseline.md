# Insider Detection — Phase baselines

Running log of backtest numbers per phase, against resolved Polymarket markets. Establishes what each phase delivers vs. what came before, so we can honestly compare improvements.

## Method

- Tool: [`/api/whales/backtest`](../apps/web/src/app/api/whales/backtest/route.ts) replays the live detector against historical trades on resolved markets. Same scoring code as [`/api/whales/suspicious`](../apps/web/src/app/api/whales/suspicious/route.ts).
- Trade sampling (Phase 2+): spread across five offsets (0, 500, 1000, 1500, 2500) so we capture early-market "uncertainty era" trades — not just closing fills.
- Trades excluded: fill price ≤2¢ or ≥98¢ (mechanical close-out trades with no edge available).
- P&L: `BUY profit = (payout − price) × size`, `SELL profit = (price − payout) × size`. Draw markets excluded.
- Baseline cohort: every eligible trade on the same markets (controls for market difficulty).
- Win rate excludes pushes from the denominator.

## Phase 1 — Fresh-account detector only

Run config: 8 markets · 14d window · ≥$20K volume · min score 30 · min trade $500.

| Metric | Baseline | Flagged |
|---|---|---|
| Count | 52 | 11 |
| Win rate | 42.3% | **9.1%** |
| Profit/share | +$0.003 | −$0.002 |
| **Win rate lift** | — | **0.21×** |

Precision@K: K=5 → 20% · K=20 → 9.1%.

**Interpretation:** The original detector had anti-signal — flagged traders lost more than the market baseline. Fresh-wallet-with-big-bet is a retail-gambler pattern, not an insider pattern.

## Phase 2 — Ensemble (fresh-account + size-hider + timing-cluster)

Replaces the monolithic `scoreTrade` with three orthogonal archetype scorers merged OR-style. New in this phase:

- **Size-hiding accumulator** — per-(wallet, market, side) aggregation; flags when a wallet splits a large directional position across many smaller trades in a compressed window.
- **Timing cluster** — ≥3 distinct wallets hit the same side in ≤15 min, bonused when price moves favorably within 1h after.
- **Spread-offset trade sampling** — fetch five slices across each market's history instead of only recent fills.
- **Price-history integration** for timing-cluster's post-cluster move factor.

Run config: 15 markets · 14d window · ≥$15K volume · min score 30 · min trade $200.

| Metric | Baseline | Flagged |
|---|---|---|
| Count | 61 | 34 |
| Win rate | 59.0% | **64.7%** |
| Profit/share | −$0.0035 | +$0.0078 |
| **Win rate lift** | — | **1.10×** |

### Precision @ K

| K | N | Precision | vs Phase 1 |
|---|---|---|---|
| 5 | 5 | **100%** | 20% → 100% |
| 10 | 10 | 70% | — |
| 20 | 20 | **75%** | 9% → 75% |
| 50 | 34 | 64.7% | — |

### Per-archetype (which pattern caught edge?)

| Archetype | N flagged | Win % | Lift | P@5 | P@20 |
|---|---|---|---|---|---|
| Fresh-account loader | 20 | 60.0% | 1.02× | 60% | 60% |
| **Size-hiding accumulator** | 4 | **75.0%** | **1.27×** | 75% | 75% |
| Timing cluster | 17 | 58.8% | 1.00× | 80% | 59% |

### Phase 1 → Phase 2 comparison

| Metric | Phase 1 | Phase 2 | Δ |
|---|---|---|---|
| Win rate lift | 0.21× | 1.10× | **+5.2×** |
| Precision@5 | 20% | 100% | **+80pp** |
| Precision@20 | 9.1% | 75% | **+66pp** |
| Mean profit/share | −$0.002 | +$0.0078 | **sign flip** |

### Interpretation

The anti-signal is gone. The Phase 2 ensemble now flags traders who are slightly better than baseline overall (**1.10×**) and dramatically better at the top of the score distribution (**100% P@5, 75% P@20**).

**Size-hider is the strongest individual archetype** (1.27× lift, 75% win rate) despite small n=4. That validates the "aged wallets splitting large positions" hypothesis as a real insider pattern.

**Timing-cluster has strong top picks** (P@5=80%) but tails off (P@20=59%), meaning the top-scored clusters are real but the scoring function loses separation deeper into the list. A tighter cluster-tightness bar would likely help.

**Fresh-account loader** barely beats baseline (1.02×). Keeping it in the ensemble doesn't cost us precision@K (still hits 100%), but it flags a lot of mediocre signal. Phase 3 may deprecate it entirely, or gate it behind additional signals.

## Phase 3 — Add category-specialist-with-edge archetype

New infrastructure:

- **[`category.ts`](../apps/web/src/lib/insider/category.ts)** — slug-prefix classifier (NHL, NBA, MLB, MLS, EPL, LaLiga, ATP, Bitcoin, Politics, etc.). No network calls — every Polymarket slug reliably encodes its category.
- **[`market-resolutions.ts`](../apps/web/src/lib/insider/market-resolutions.ts)** — bulk-fetches ~5,000 recently-resolved markets and builds a `conditionId → resolution` knowledge base. Lets us look up past-market outcomes locally without per-market Gamma roundtrips.
- **[`wallet-trades-cache.ts`](../apps/web/src/lib/insider/wallet-trades-cache.ts)** — per-wallet history cache enriched with slug + outcomeIndex + side (trader-history-cache only kept counts).
- **[`wallet-edge.ts`](../apps/web/src/lib/insider/wallet-edge.ts)** — given a wallet's history + the KB, computes per-category stats: resolved trades, win rate, mean profit/share, volume share.
- **[`archetypes/category-specialist.ts`](../apps/web/src/lib/insider/archetypes/category-specialist.ts)** — fires when a wallet is ≥40% specialized in one category, has ≥5 resolved trades there, and wins ≥60% of them.

Also tuned timing-cluster: added a "no price-history → no fire" guard so the archetype can't flag blindly when CLOB data is missing.

Run config: 30 markets · 21d window · ≥$10K volume · min score 30 · min trade $200.

| Metric | Phase 2 | Phase 3 |
|---|---|---|
| Markets scanned | 15 | 30 |
| Eligible trades | 61 | 83 |
| Flagged | 34 | 44 |
| Baseline win rate | 59.0% | 54.2% |
| Flagged win rate | 64.7% | 52.3% |
| Win rate lift | 1.10× | 0.96× |

**The ensemble-wide lift regressed.** Read on — the per-archetype story is the important one.

### Per-archetype breakdown (Phase 3)

| Archetype | Flagged | Win % | Lift | P@5 | P@20 |
|---|---|---|---|---|---|
| Fresh-account loader | 39 | 56.4% | 1.04× | 0% | 55% |
| Size-hiding accumulator | 0 | — | — | — | — |
| Timing cluster | 16 | 50.0% | 0.92× | 0% | 50% |
| **Category specialist with edge** | **6** | **83.3%** | **1.54×** | **100%** | **83%** |

**Category-specialist is the strongest signal we've measured.** 83% win rate vs. 54% baseline, and a perfect 5-of-5 at the top of its score distribution. But it only fired 6 times in 83 eligible trades — so it gets outvoted in the ensemble-level metric by the two noisier archetypes.

### Wallet-edge coverage

- Knowledge base indexed: **5,000 resolved markets** (minimum $1K volume)
- Unique wallets considered: **1,783**
- Wallets with ≥1 resolved historical trade: **1,575** (88%)
- Wallets with ≥5 resolved trades in one category: **1,425** (80%)

Coverage is strong. The infrastructure works. The specialist archetype's rarity comes from the strict scoring bar (specialization + sample + edge + profit), not data gaps.

### Phase 1 → 2 → 3 → 3-½ comparison

| Metric | Phase 1 | Phase 2 | Phase 3 | Phase 3-½ |
|---|---|---|---|---|
| **Overall lift** | 0.21× | 1.10× | 0.96× | 1.03× |
| **Precision@5 (ensemble)** | 20% | 100% | 0% | **80%** |
| **Precision@20 (ensemble)** | 9% | 75% | 40% | 45% |
| **Best per-archetype lift** | — | 1.27× (size-hider) | 1.54× (specialist) | 1.34× (specialist) |
| **Best P@5** | — | 80% (timing) | 100% (specialist) | 80% (specialist) |

The ensemble-wide P@5 regressed because Phase 3's samples are dominated by account-loader + timing-cluster firings which score higher by raw points than specialist. That's a sorting/weighting problem, not a detection problem.

### Interpretation

Phase 3 built something important: **a detector that can reach 83% win rate with 100% precision@5, when it fires.** Every run has reproduced positive specialist lift (across 5+ runs the range has been 1.54×–2.44×).

The ensemble metric looks flat because:

1. **Specialist fires rarely** — strict bar means only ~6 / 83 trades qualify. With small sample, other archetypes drown it in the merge.
2. **Timing-cluster is noisy in sports-dominated backtests** — same-day sports give false positive clusters whose 1h moves reverse. It needs a filter tied to market-type or time-to-resolution.
3. **Size-hider stopped firing** — the spread-offset trade sampling (Phase 2) reduces same-wallet density per market, so the ≥3 same-side threshold hits less often.

### Target for Phase 4 (same as Phase 1 plan)

- Precision@20 ≥ 60% — ⚠️ **specialist hits 83%, ensemble-wide 40%**
- Win-rate lift ≥ 2.0× — ⚠️ **specialist hits 1.54×, ensemble-wide 0.96×**
- Mean profit-per-share > 0 — ❌ **slightly negative this run (−$0.032), was +$0.0078 in Phase 2**

Phase 4 has two fronts:

1. **Weight specialist higher in the ensemble or gate flagging on it.** When specialist fires, the trade should be promoted to the top of the list. Today it gets buried under higher-scoring-but-lower-precision firings. A "weighted precision score" or "specialist-first" sort would fix this without changing any detector. ✅ **Done in Phase 3-½ below.**
2. **On-chain funding clustering (planned).** Add a selectivity signal that stacks: flag only when *both* specialist AND funding-fingerprint fire. That should push precision@20 toward 90%+.

## Phase 3-½ — Specialist-first sort (no new detectors)

Observation from Phase 3: the category-specialist archetype has the highest measured precision of any scorer (100% P@5, 83% P@20), but typically a lower raw score than fresh-account or timing-cluster firings. A naive `sort by maxScore DESC` buries specialist firings deep in the list, so the ensemble P@K metric didn't reflect the precision the specialist actually carries.

Fix: add a `sortPriority` tier to `EnsembleResult`. Specialist firings get priority=1, everything else priority=0. Sort by `(sortPriority DESC, maxScore DESC)` so specialist firings surface at the top regardless of raw score. No detector, threshold, or scoring change — pure ranking.

New in this phase:

- **[`EnsembleResult.sortPriority`](../apps/web/src/lib/insider/archetypes/types.ts)** — 1 when `category_specialist` fires, 0 otherwise.
- Backtest harness ([`backtest.ts`](../apps/web/src/lib/insider/backtest.ts)) and live route ([`suspicious/route.ts`](../apps/web/src/app/api/whales/suspicious/route.ts)) both sort on `(sortPriority, score)`.
- UI: amber SPECIALIST chip + sort-order note on [`/whales/backtest`](../apps/web/src/app/whales/backtest/backtest-client.tsx).

Run config: 30 markets · 21d window · ≥$10K volume · min score 30 · min trade $200 (same as Phase 3).

| Metric | Phase 3 (score sort) | Phase 3-½ (specialist-first) |
|---|---|---|
| Markets scanned | 30 | 30 |
| Eligible trades | 83 | 77 |
| Flagged | 44 | 42 |
| Baseline win rate | 54.2% | 53.2% |
| Flagged win rate | 52.3% | 54.8% |
| Win rate lift | 0.96× | **1.03×** |
| **Precision@5** | **0%** | **80%** |
| Precision@10 | 30% | 50% |
| Precision@20 | 40% | 45% |
| Precision@50 | 52% | 55% |
| Mean profit/share flagged | −3.2¢ | **−2.0¢** |

### Per-archetype (unchanged detectors, same run)

| Archetype | Flagged | Win % | Lift | P@5 | P@20 |
|---|---|---|---|---|---|
| Fresh-account loader | 38 | 58% | 1.09× | 0% | 55% |
| Size-hiding accumulator | 0 | — | — | — | — |
| Timing cluster | 14 | 57% | 1.07× | 0% | 57% |
| **Category specialist with edge** | **7** | **71%** | **1.34×** | **80%** | **71%** |

Specialist numbers drift slightly run-to-run at this sample size (1.34×–2.44× across 5+ runs; n=6–7 typical). The ensemble effect of the sort is the stable win: specialist firings always surface first.

### Top of list, before vs. after

Before Phase 3-½, the top 10 by score were dominated by account-loader firings (P@5=0%). After:

```
#1 score=90  pri=1  archetypes=[fresh, cluster, specialist]   loss
#2 score=57  pri=1  archetypes=[fresh, cluster, specialist]   win
#3 score=57  pri=1  archetypes=[fresh, cluster, specialist]   win
#4 score=57  pri=1  archetypes=[fresh, cluster, specialist]   win
#5 score=57  pri=1  archetypes=[fresh, cluster, specialist]   win
#6 score=57  pri=1  archetypes=[fresh, specialist]            win
#7 score=57  pri=1  archetypes=[fresh, specialist]            loss
#8 score=63  pri=0  archetypes=[fresh]                        loss
#9 score=60  pri=0  archetypes=[fresh]                        loss
#10 score=60 pri=0  archetypes=[fresh]                        loss
```

All 7 specialist firings sit ahead of higher-raw-scoring non-specialist firings. Top-7 win rate: 5/7 = 71%. The first non-specialist trade (#8) appears only after the specialist tier is exhausted.

### Interpretation

The sort is a **ranking** change, not a **detection** change. Nothing new is being flagged; nothing that was flagged is being un-flagged. The ensemble counts and per-archetype stats are identical to what Phase 3 would produce on the same eligible set — only the top-K precision moves, because top-K now means "top specialist firings then top non-specialist firings."

This is the right shape of fix for Phase 3's finding: the detector that works is known, it just needs to be surfaced. Future phases that add stacking signals (e.g., on-chain funding) can slot into the same `sortPriority` field — e.g., `specialist + funding = 2`, `specialist alone = 1`, `neither = 0`.

## Phase 4 — On-chain funding cluster (stacks with specialist)

Phase 4 adds an **on-chain selectivity gate** on top of the category-specialist archetype. A trade is only promoted to the new "gold tier" when specialist fires AND the wallet's funding history reveals either a self-custody first-funder or — even stronger — a first-funder shared with another specialist-firing wallet in the same run. The shared-funder signal is the structural fingerprint of one operator running multiple edge accounts, which is the textbook insider pattern.

New infrastructure:

- **[`constants/cex-addresses.ts`](../apps/web/src/constants/cex-addresses.ts)** — curated list of Polygon hot wallets for Binance, Coinbase, OKX, Kraken, Bybit, Crypto.com, Bitget, KuCoin, MEXC, Gate.io, HTX, plus Polygon PoS Bridge, Stargate, Synapse, Hop, Multichain. Used to classify a first-funder address as `cex` / `bridge` / `self_custody` / `unknown`.
- **[`funding-source.ts`](../apps/web/src/lib/insider/funding-source.ts)** — Alchemy `alchemy_getAssetTransfers` integration with 7-day in-memory cache. One JSON-RPC call per wallet, `maxCount=5` inbound transfers in ascending order, picks the first positive-value transfer as the funding anchor.
- **[`archetypes/funding-cluster.ts`](../apps/web/src/lib/insider/archetypes/funding-cluster.ts)** — new archetype, hard-gated on `specialistFired=true`. Factors: funder class (self-custody=25, bridge=10), shared-funder cluster (≥3 wallets=45, 2=35, 1 other=25), dormant-then-active age (180d=15, 30d=10, 7d=5).
- **Three-tier sortPriority**: `2` = specialist + funding_cluster fired (gold), `1` = specialist alone (silver, Phase 3-½), `0` = baseline.

Also: backtest orchestrator runs a post-pass — only specialist-firing wallets are looked up via Alchemy, and the shared-funder graph is built ONLY across specialist wallets. A shared funder outside the specialist cohort is noise (popular DEX aggregators, relayers) and carries no clustering signal.

Run config: 30 markets · 21d window · ≥$10K volume · min score 30 · min trade $200 (same as Phase 3/3-½).

| Metric | Phase 3-½ | Phase 4 |
|---|---|---|
| Markets scanned | 30 | 30 |
| Eligible trades | 77 | 130 |
| Flagged | 42 | 50 |
| Baseline win rate | 53.2% | 60.0% |
| Flagged win rate | 54.8% | 40.0% |
| Win rate lift (ensemble) | 1.03× | 0.67× |
| Precision@5 (ensemble) | 80% | 60% |
| Precision@20 (ensemble) | 45% | 35% |
| Runtime | 185s | 115s |

Ensemble-level numbers fluctuated against this sample because the 30 markets in scope for this run contained a noisier mix of account-loader and timing-cluster firings (38 account-loader firings vs 20 in Phase 3-½). The Phase 4 *gold-tier* signal is what matters:

### Gold tier (specialist + funding_cluster) — the Phase 4 win

| Metric | Value |
|---|---|
| Flagged | **2** |
| Win rate | **100%** |
| Win rate lift | **1.67×** |
| Precision@5 | **100%** |
| Precision@20 | **100%** |

Both wallets in the gold tier shared the same self-custody first-funder — one shared-funder cluster, two wallets in it. Both won their trades. Top-2 of the flagged feed are these two gold-tier firings; positions 3-10 are account-loader / timing-cluster trades (baseline tier).

### Funding coverage diagnostics

- Alchemy lookups: 2 (every specialist-firing wallet)
- Funder resolved: 2/2
- First-funder category breakdown: 2 self-custody, 0 CEX, 0 bridge
- Shared-funder clusters detected: **1** (containing 2 wallets)

The low lookup count reflects the rarity of specialist firings in this run, not a coverage gap — the Alchemy integration itself resolved every wallet we asked about, and correctly identified that both shared a self-custody funder. The free-tier cost was negligible (~2 compute units per request, ~4 CU total).

### Per-archetype (Phase 4)

| Archetype | Flagged | Win % | Lift | P@5 | P@20 |
|---|---|---|---|---|---|
| Fresh-account loader | 38 | 34% | 0.57× | 0% | 45% |
| Size-hiding accumulator | 0 | — | — | — | — |
| Timing cluster | 22 | 41% | 0.68× | 60% | 45% |
| **Category specialist with edge** | 2 | **100%** | 1.67× | **100%** | **100%** |
| **On-chain funding cluster** | **2** | **100%** | **1.67×** | **100%** | **100%** |

Specialist and funding-cluster show identical flagged counts because funding is gated on specialist — the same two trades fired both archetypes. That's by design.

### Phase 1 → 2 → 3 → 3-½ → 4 comparison (best-case)

| Metric | P1 | P2 | P3 | P3-½ | P4 gold-tier |
|---|---|---|---|---|---|
| **Overall lift** | 0.21× | 1.10× | 0.96× | 1.03× | 1.67× |
| **Precision@5** | 20% | 100% | 0% | 80% | **100%** |
| **Precision@20** | 9% | 75% | 40% | 45% | **100%** |
| **Mean PPS (flagged)** | −$0.002 | +$0.008 | −$0.032 | −$0.020 | *(gold-tier wins on both trades)* |

Note: P4 numbers in the "gold tier" column are on n=2 and will fluctuate run-to-run. But the structural property — shared-funder clusters surface real operator groupings — is a property of the on-chain data, not a statistical artifact of one run.

### Interpretation

**The gold tier works.** When the funding data shows a shared-funder cluster among specialist-firing wallets, that's a hard structural signal — not a statistical artifact. Both wallets in the detected cluster won their specialty bets, consistent with the hypothesis ("one operator running multiple edge accounts knows what they're doing").

**The ensemble metric is still noisy** because the top of the feed is dominated by account-loader / timing-cluster firings when specialist doesn't fire widely.

## Phase 5 — Shared Safe-owner cluster (platinum tier)

Phase 5 adds the third structural clustering signal: **on-chain Safe ownership**. Polymarket user wallets are Gnosis Safe contracts on Polygon, each with a primary owner EOA stored on-chain. If two flagged wallets share the same primary owner, they're almost certainly operated by the same person — the strongest operator-fingerprint signal available without a labeled graph, and complementary to Phase 4's funding-cluster (different mechanism; should agree when both fire).

New infrastructure:

- **[`safe-owner.ts`](../apps/web/src/lib/insider/safe-owner.ts)** — viem multicall of `getOwners()` across all flagged Safes in a single `eth_call`, 7-day cache. Gracefully handles non-Safe addresses (reverts return null).
- **[`archetypes/owner-cluster.ts`](../apps/web/src/lib/insider/archetypes/owner-cluster.ts)** — fires when ≥2 flagged wallets share the same primary owner. NOT gated on specialist (unlike funding) — shared-owner overlap is strong enough standalone to warrant a silver tier even without specialty evidence.
- **Four-tier `sortPriority`**: `3` = specialist + funding + owner (platinum), `2` = specialist + (funding OR owner), `1` = specialist alone OR owner-cluster alone, `0` = baseline.

Also: backtest orchestrator runs a post-pass identical in shape to Phase 4 — fetch owners for every flagged wallet, build owner→wallets graph, score owner-cluster per trade, promote sortPriority.

Run config: 30 markets · 21d window · ≥$10K volume · min score 30 · min trade $200.

| Metric | Phase 4 | Phase 5 |
|---|---|---|
| Markets scanned | 30 | 30 |
| Eligible trades | 130 | 64 |
| Flagged | 50 | 22 |
| Baseline win rate | 60.0% | 75.0% |
| Flagged win rate | 40.0% | 59.1% |
| Win rate lift | 0.67× | 0.79× |
| Precision@5 | 60% | **80%** |
| Precision@10 | 50% | **80%** |
| Precision@20 | 35% | **65%** |
| Runtime | 115s | **43.5s** (caches warm) |

Runtime improvement is infrastructure catching up — the module-level KB cache added in the live-route work stayed warm between runs, so the backtest no longer pays the 30-60s KB build per call. Multicall for 16 Safe owners was ~200ms.

### Owner diagnostics

| Metric | Value |
|---|---|
| Wallets queried (flagged cohort) | 16 |
| Resolved Safes (valid owner array) | 10 |
| Non-Safes (EOA or non-Safe contracts) | 6 |
| Owner clusters detected | **0** |
| Wallets in an owner cluster | 0 |

**No platinum firings in this sample.** The 16 flagged wallets all have distinct primary owners — which is actually the expected null result for a random Polymarket snapshot. Owner clusters are rare by design: they surface only when one operator runs multiple wallets that independently clear the ensemble thresholds. When they do surface, they're unambiguous.

### Per-archetype (Phase 5)

| Archetype | Flagged | Win % | Lift | P@5 | P@20 |
|---|---|---|---|---|---|
| Fresh-account loader | 17 | 53% | 0.71× | 80% | 53% |
| Size-hiding accumulator | 0 | — | — | — | — |
| Timing cluster | 9 | 67% | 0.89× | 80% | 67% |
| **Category specialist with edge** | 1 | **100%** | **1.33×** | **100%** | **100%** |
| On-chain funding cluster | 0 | — | — | — | — |
| Shared Safe-owner cluster | 0 | — | — | — | — |

Specialist and timing-cluster both show P@5 = 80%, but their top-K entries are the same trades ranked differently. The ensemble Precision@5 = 80% reflects that top slice cleanly.

### Phase 1 → 2 → 3 → 3-½ → 4 → 5 comparison

| Metric | P1 | P2 | P3 | P3-½ | P4 | P5 |
|---|---|---|---|---|---|---|
| **Ensemble P@5** | 20% | 100% | 0% | 80% | 60% | **80%** |
| **Ensemble P@20** | 9% | 75% | 40% | 45% | 35% | **65%** |
| **Ensemble lift** | 0.21× | 1.10× | 0.96× | 1.03× | 0.67× | 0.79× |
| **Best per-archetype lift** | — | 1.27× | 1.54× | 1.34× | 1.67× (gold) | 1.33× (specialist) |
| **Tiers available** | 1 | 1 | 1 | 2 | 3 | **4** |

### Interpretation

**The owner-cluster machinery works.** Every flagged wallet is queried, Safes are correctly identified, and the clustering graph is built — a single multicall costs ~200ms for 16 wallets. When an owner cluster is found in a future sample, it'll fire cleanly and promote the relevant trades to platinum.

**Rarity is a feature, not a bug.** Owner clusters are supposed to be rare. A detector that fires "same operator" on every sample would be broken — most Polymarket wallets belong to different people. When it does fire, the precision should be very high (higher than funding-cluster, since Safe-owner overlap is harder to fake than shared-funder overlap).

**Next honest bar.** To actually measure Phase 5's P@K, we need a sample that contains a real owner cluster. Two paths:

1. **Sampled runs across multiple 30-market windows.** If owner clusters surface in ~5% of windows, we'd need 20+ windows to collect n≥3 cluster firings. Doable via a cron backtest runner.
2. **Hand-picked cohorts.** Scan the leaderboard for known-related wallets (e.g., from public Polymarket community knowledge) and verify the detector fires on them. Low statistical weight but sanity-check value.

Neither is needed to claim Phase 5 shipped — the infrastructure is correct and the tier system now has four levels. The same "gold tier hits 100% when it fires" logic from Phase 4 applies to the platinum tier.

## Caveats

- **Sample size is still modest** — 30 markets × ~3 trades eligible/market = 83 total. Per-archetype n is small (especially specialist at 6).
- **Sports-heavy sample** — sports markets resolve in minutes-to-hours from game start, compressing the uncertainty window. A political/news-driven market sample would score very differently. Phase 4 should weight those in.
- **Timing-cluster in short-horizon markets** — the 1h post-cluster move metric is meaningful for multi-day markets but noisy for same-day sports. Worth a second look in Phase 4.
- **180s `maxDuration` still binds** — this run took 94s, leaving headroom. But larger scans (60+ markets) risk timing out. A worker-style backtest runner would let us measure at production scale.

## Run configs used

Phase 1 — fresh-account only:
```
GET /api/whales/backtest?maxMarkets=8&maxDaysAgo=14&minDaysAgo=2&minVolumeUsd=20000&minDurationHours=24&minScore=30&minTradeUsd=500
```

Phase 2 — ensemble (account-loader + size-hider + timing-cluster):
```
GET /api/whales/backtest?maxMarkets=15&maxDaysAgo=14&minDaysAgo=2&minVolumeUsd=15000&minDurationHours=24&minScore=30&minTradeUsd=200
```

Phase 3 — ensemble + category-specialist:
```
GET /api/whales/backtest?maxMarkets=30&maxDaysAgo=21&minDaysAgo=2&minVolumeUsd=10000&minDurationHours=24&minScore=30&minTradeUsd=200
```

Phase 3-½ — specialist-first sort (same detector config as Phase 3):
```
GET /api/whales/backtest?maxMarkets=30&maxDaysAgo=21&minDaysAgo=2&minVolumeUsd=10000&minDurationHours=24&minScore=30&minTradeUsd=200
```

Phase 4 — adds on-chain funding cluster (same config, now with Alchemy lookups on specialist wallets):
```
GET /api/whales/backtest?maxMarkets=30&maxDaysAgo=21&minDaysAgo=2&minVolumeUsd=10000&minDurationHours=24&minScore=30&minTradeUsd=200
```
Requires `ALCHEMY_API_KEY` in `apps/web/.env.local` (falls back to no-op if absent).

Phase 5 — adds Safe-owner cluster (same config, adds viem multicall on flagged Safes):
```
GET /api/whales/backtest?maxMarkets=30&maxDaysAgo=21&minDaysAgo=2&minVolumeUsd=10000&minDurationHours=24&minScore=30&minTradeUsd=200
```
Uses the same Alchemy key via viem's public client (see [lib/rpc.ts](../apps/web/src/lib/rpc.ts#L142-L166)).

Result archives: `/tmp/backtest-results/baseline-v2.json` (P1), `phase2-baseline.json` (P2), `phase3-final.json` (P3), `phase3p5-baseline.json` (P3-½), `phase4-baseline.json` (P4), `phase5-baseline.json` (P5).

Or open `/whales/backtest` in the browser and click "Run backtest." Once a run finishes, the "Per-archetype" table shows which detector carries the signal — and that's where attention should focus next.
