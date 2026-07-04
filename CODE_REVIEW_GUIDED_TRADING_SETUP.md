# Code Review — Guided Trading Setup

**Branch:** `codex/polymarket-unified-sdk`
**Scope:** working-tree diff (`git diff HEAD`) — 65 files / ~6.3k insertions.
**Method:** extra-high-effort recall review — 9 finder angles → 1-vote verification → gap sweep.
**Status:** review only, no files edited.

Severity legend: **HIGH** (breaks a real trading action) · **MED** · **LOW** · cleanup/altitude.

---

## Correctness bugs (verified)

### 1. `needsWrap` change silently skips the insufficient-collateral guard — HIGH
- **File:** `packages/shared-types/src/trading.ts:364`
- **What:** `planPusdAutoWrap` now sets `needsWrap: wrapAmountRaw > 0` instead of `shortfallRaw > 0`. Since `wrapAmountRaw = min(usdcEBalanceRaw, shortfallRaw)`, when a BUY needs more pUSD than is available **and** the user holds **0 USDC.e**, `wrapAmountRaw = 0` → `needsWrap = false`.
- **Failure:** Both callers — `apps/web/src/hooks/use-clob-client.ts:347` and `apps/extension/src/background/trading-handler.ts:1004` — run `if (!wrapPlan.needsWrap) return;` *before* `if (!hasEnoughBaseCollateral) throw`, so the clean "Insufficient collateral" error is bypassed; the order posts and fails server-side with a misleading 400. The new test only covers the fee-only `baseShortfallRaw = 0` case.
- **Fix:** Check `hasEnoughBaseCollateral` before the `needsWrap` early return (or OR `!hasEnoughBaseCollateral` into the throw condition).

### 2. Lost-position redeem drops the `negRisk` flag → misrouted to wrong contract — HIGH
- **File:** `apps/web/src/app/portfolio/page.tsx:203`
- **What:** `handleCloseLostPosition` calls `redeemPositions(conditionId, tradingAddress)` with no third arg, so `negRisk` defaults to `false`. Sibling `handleRedeemPosition` (`page.tsx:224`) correctly passes `position.negRisk ?? false`. `negRisk` selects the redeem target contract (`NEG_RISK_CTF_COLLATERAL_ADAPTER` vs plain adapter, `packages/shared-types/src/ctf.ts:223`).
- **Failure:** A lost position in a neg-risk (multi-outcome) market redeems against the wrong contract and reverts — the "Close" button fails. The flag exists at the source (`PolymarketPosition.negativeRisk`) but is omitted from `transformedLostPositions` (`apps/web/src/app/api/user/positions/route.ts:396`), the `LostPosition` type, and the `onCloseLostPosition` signature.
- **Fix:** Plumb `negativeRisk` through the lost-position type, the history-table boundary, and the `onCloseLostPosition` handler signature.

### 3. Card setup gate blocks the order/SELL form at $0 cash for fully-onboarded users — HIGH
- **File:** `apps/extension/src/content/trading/trading-panel.ts:5285`
- **What:** The render gate `else if (!cardSetupFlow(ctx).isComplete …)` calls `addSetupFlow` and `return`s. `cardSetupFlow.isComplete` requires the `funds` step, whose `done` is `cashBalance > 0` (`apps/extension/src/content/trading/setup-flow.ts:115`).
- **Failure:** A user who is connected, deployed, approved, and credentialed but has spent down to $0 cash flips `isComplete` to false, so `renderOrderForm` is never reached — they can't even open the **SELL** form to liquidate existing outcome tokens (which needs no cash).
- **Fix:** Gate the order form on the first four steps; surface "add funds" contextually only when a BUY lacks collateral.

### 4. `markSetupComplete` is an irreversible latch → "dead portfolio" on regression — MED-HIGH
- **File:** `apps/extension/src/content/trading/setup-flow-storage.ts:30`
- **What:** `markSetupComplete` only ever writes `true`; there is no clear/reset (unlike `writeSetupDismissed`, which is bidirectional). `resolveSetupSurfaceMode` short-circuits on `persistedComplete || flow.isComplete` (`setup-flow.ts:164`), and `apps/extension/src/sidepanel.ts:3332` skips re-deriving once latched.
- **Failure:** The live flow is rebuilt each load from on-chain credentials/approval. If credentials are cleared, approval is revoked, or wallet state changes after completion, `flow.isComplete` goes false but the panel still returns `"complete"` forever — the setup surface is hidden with no in-app recovery (only manual `chrome.storage.local` deletion). The latch also fires on any `cashBalance > 0` (no minimum), so a dust/in-transit balance can permanently latch it.
- **Fix:** Re-validate the persisted flag against the live flow (or add a reset path on disconnect/credential-clear).

### 5. Sports live-game matched in isolation → wrong game can overwrite — MED
- **File:** `apps/web/src/hooks/use-sports-websocket.ts:288`
- **What:** `useMatchedSportsLiveGame` scores each update against a single-entry `new Map([[gameId, nextGame]])`, defeating `matchSportsEventToGame`'s best-of-many scoring (`apps/web/src/lib/sports-event-match.ts:142`). The only guard is `alreadyMatched` (same gameId).
- **Failure:** A different gameId that passes its own gates overwrites `matchedGameIdRef` and swaps the displayed game. If two live games both clear the gates for one event, the detail page can flip to the wrong game's score.
- **Fix:** Score incoming updates against the full candidate set, or keep the existing best match unless a higher-scoring game arrives.

### 6. Sports hook has no initial replay → blank live panel until next tick — MED
- **File:** `apps/web/src/hooks/use-sports-websocket.ts:275`
- **What:** The new hook only registers `manager.addEventListener(...)`, which fires on future messages only (`apps/web/src/lib/sports-websocket-manager.ts:95` — no snapshot replay, no stored games map). The old code matched immediately against the accumulated `games` map via `useMemo`.
- **Failure:** A page that mounts mid-game (between ticks) shows no live game until the next tick arrives.
- **Fix:** Seed from the manager's accumulated games on mount (or have the manager replay current state to a new listener).

### 7. Positions API can return more than `limit` items; `hasMore` ignores them — LOW (latent)
- **File:** `apps/web/src/app/api/user/positions/route.ts:341`
- **What:** Winning-redeemable positions are merged on top of `openPositions.slice(0, limit)`, so `positions.length` can exceed `limit`, while `hasMore` is computed only from `openPositions.length > limit`.
- **Failure:** Harmless today (no consumer paginates — every caller uses `offset=0` and ignores `pagination.hasMore`), but the contract is self-inconsistent and breaks the moment any client paginates.
- **Fix:** Count the merged redeemables toward the page, or document that redeemables are additive and exempt from `limit`.

### 8. Approval reported as failed when the proxy address isn't resolved yet — LOW-MED (plausible)
- **File:** `apps/extension/src/sidepanel.ts:2206`
- **What:** `approvePortfolioTrading` derives its poll target from `latestPortfolioData?.address`; if that's null when the approval lands, `approved` is set `false` without polling.
- **Failure:** The user sees "Approval didn't complete. Approve the wallet signature and try again." even on success. Reachable if `latestPortfolioData` is stale/unset at the approve step.
- **Fix:** Re-resolve the proxy address before polling, or surface a distinct "still confirming" state instead of a hard failure.

### 9. Returning user briefly sees "Create trading vault" during the deploy check — LOW (cosmetic, plausible)
- **File:** `apps/extension/src/content/trading/trading-panel.ts:5271`
- **What:** The loading-spinner guard requires `!ctx.hasCredentials`, so a returning user with credentials but `isDeployed === null` (first balance fetch in flight) falls through and momentarily renders the vault step as "now" before the check resolves.
- **Fix:** Drop the `!ctx.hasCredentials` condition from the in-flight loading guard.

---

## Cleanup / altitude

### 10. "Is approved" gate duplicated across panel and card → will drift — altitude
- **File:** `apps/extension/src/sidepanel.ts:280`
- `hasPortfolioApproval` hand-reimplements the same 3-message orchestration + scalar-OR composite that `apps/extension/src/content/trading/trading-service.ts:703` (`refreshBalance`) already computes. Any change to what "approved" means must be edited in both or the card and side panel disagree about whether the approve step is done.
- **Fix:** Lift it into a shared `setup-flow.ts` helper both call.

### 11. `cardSetupFlow` re-ORs the already-composite `hasTradingApproval` — reuse/altitude
- **File:** `apps/extension/src/content/trading/setup-flow.ts:180`
- Computes `hasApproval: ctx.hasTradingApproval || isApprovalSufficientForSetup(usdcAllowance) || isApprovalSufficientForSetup(usdcAllowanceNegRisk)`, but `ctx.hasTradingApproval` already folds those two operands in. The panel's `portfolioSetupState` trusts `data.hasApproval` directly, so this gives the card a *second* definition of "approved" that can diverge from the panel.
- **Fix:** Collapse to `hasApproval: ctx.hasTradingApproval`.

### 12. `refreshBalance` fires 3 sequential allowance round-trips on a hot path — efficiency
- **File:** `apps/extension/src/content/trading/trading-service.ts:723`
- Awaits two scalar `trading:get-allowance` calls **and** a `trading:get-all-allowances` (a superset already containing the exchange/adapter spender allowances), sequentially. `refreshBalance` is called from ~15 sites.
- **Fix:** Drop the scalar pair and derive from the all-allowances result, or at least `Promise.all` them.

### 13. `waitForPortfolioApproval` flat-polls the heavy approval check ~90× with no backoff — efficiency
- **File:** `apps/extension/src/sidepanel.ts:133`
- Polls `hasPortfolioApproval` every 1s for up to 90s, and each call is the 3-message check from #10/#12 — up to ~270 RPC-backed reads for one approval.
- **Fix:** Add backoff and use a single-message check.

### 14. ~70 lines of dead CSS for an abandoned step rail — simplification
- **File:** `apps/extension/src/sidepanel.ts:5421`
- Ships `.knoww-pf-setup-rail` / `-node` / `-rail-line` / `-active*` styles that no rendered template produces (the view comment even notes "No separate numeric rail — that duplicated the list"). Grep confirms zero class references.
- **Fix:** Delete the unused blocks.

### 15. Duplicated helpers — reuse
- `escapeHtml` is copied a third time in `apps/extension/src/content/trading/portfolio-setup-view.ts:6` although the sibling `trading-panel.ts` already imports it from `../utils`.
- The per-row render body (compute + Redeem-vs-Sell action block) is copy-pasted between the desktop and mobile maps in `apps/web/src/components/portfolio/positions-table.tsx:226`.
- **Fix:** Import the shared `escapeHtml`; extract a shared per-row helper/component so the two layouts can't drift.

---

## Refuted (checked, not bugs)

- **BUY approval-gate narrowing** in `use-clob-client.ts` — the dropped keys are SELL/redeem-only approvals; the change is actually a *tightening* (it verifies the order-sized pUSD allowance).
- **`normalizeExtensionTradingWalletMode` safe-default flip** — no undefined/unknown mode reaches the handler for legacy safe users (content path always sends the detected mode; sidepanel already defaulted to deposit pre-diff); `eoa`→`deposit` is the intended cutover.
- **ERC1155 approval before redeem** (`ctf.ts`) — redeem targets a pUSD collateral adapter that genuinely needs `setApprovalForAll`; the approval is necessary and gated behind a live `isApprovedForAll` read.
- **`approveUsdc` setting `state:"ready"` early** — every reader gates on credentials/flow completeness, not `state` alone; the unguarded state is inert.
- **`"0"`/non-numeric approval input** — neutralized at the content relay and floored to the default in `handleRelayerApprove`.
- **`getPriceAtTimestamp` dropping its sort** — history stores monotonic `Date.now()` (not the WS event timestamp) and is only mutated via the order-preserving insert, so the ascending invariant holds.
- **`viem` `requestAddresses` behind `if (!account)`** — `account` is always the wagmi-authorized account; viem doesn't need `requestAddresses` to sign with an explicit account; the deposit path has an explicit mismatch guard; test-covered.

---

## Recommended blockers

The top three break real trading actions and should be fixed before merge:
1. **#1** `needsWrap` insufficient-collateral guard bypass.
2. **#2** Lost-position `negRisk` misrouting.
3. **#3** Card locks out the order/SELL form at $0 cash.

---
---

# Round 2 — Re-review of the fixes (2026-06-28)

All 15 round-1 findings above were verified **fixed** (correctness 9/9 incl. all three blockers; cleanup 6/6, with #12 reduced to a single round-trip). This round reviews the **fix batch itself** at the same extra-high-effort recall level (6 finder angles → verifiers → gap sweep) and surfaces issues that are **newly introduced by the fixes** or newly surfaced. Round-1 items are not repeated.

Severity legend unchanged.

## Correctness — regressions the fixes introduced

### R1. Transient allowance read bounces an onboarded user back to "Approve" — content card — HIGH
- **File:** `apps/extension/src/content/trading/trading-service.ts:701`
- **What:** `refreshBalance`'s allowance catch was changed from a no-op to `update({ hasTradingApproval: false })`. A single transient `trading:get-all-allowances` failure now flips `hasTradingApproval` false → `cardSetupFlow().isComplete` false → the trade form is replaced by the "Approve permissions" setup step for an already-approved user.
- **Worse than it looks:** each of the 8 on-chain reads falls back to `0/false` silently (no provider `fallback()`), so a *partial* map returns successfully and still fails the all-keys-required `isTradingSetupApprovalComplete` — the regression fires on the **success path**, not just the catch.
- **Fix:** revert to a no-op, or only downgrade `hasTradingApproval` on a confirmed non-degraded read.

### R2. Same transient read re-shows setup over a working portfolio and persists the wrong flag — side panel — HIGH
- **Files:** `apps/extension/src/sidepanel.ts:3321`, `apps/extension/src/content/trading/setup-flow.ts:182-188`
- **What:** `sidepanel.ts:3321` writes `writeSetupComplete(addr, false)` whenever `deriveSetupFlow().isComplete` is false, and `data.hasApproval` comes from `hasPortfolioApproval()` which returns false on the same degraded read. `resolveSetupSurfaceMode` **declares `persistedComplete` but never reads it**, so the completion latch gives zero protection.
- **Failure:** one degraded read re-renders the wizard/approve surface over a working portfolio *and* overwrites the durable `knoww:setup-complete` flag to false, persisting the wrong state across reloads until a clean read re-latches.
- **Fix:** honor `persistedComplete` in `resolveSetupSurfaceMode`; don't clear the latch on a transient incomplete read.

## Correctness — gap in the neg-risk fix (round-1 #2)

### R3. Neg-risk lost-position redeem still misrouted via the trades/activity feed — HIGH
- **Files:** `apps/web/src/app/api/user/trades/route.ts:233`, `apps/web/src/components/portfolio/history-table.tsx:295`, `apps/web/src/app/portfolio/page.tsx:421-433`
- **What:** The round-1 fix plumbed `negRisk` through the **positions** route, but the trades/activity route builds `market` without it. `history-table` calls `onCloseLostPosition(conditionId, trade.market.negRisk ?? false)` → always `false` for trades-feed rows, and the `mergedHistory` dedup keeps the real (negRisk-blind) trades row over the correct synthetic one.
- **Failure:** a neg-risk lost position redeems against the standard CTF exchange instead of the neg-risk adapter → reverts/wrong settlement (the exact bug round-1 #2 was meant to close, via a different path).
- **Fix:** surface `negativeRisk` in the trades route's `market`, or make the dedup prefer the synthetic (negRisk-correct) row.

### R4. Winning redemption mislabeled "Lost" → spurious "Close lost position" button — MED
- **File:** `apps/web/src/components/portfolio/history-table.tsx:27`
- **What:** `getActivity` labels any `REDEEM` row with `usdcSize === 0` as "Lost". Polymarket emits a per-outcome REDEEM row, so the losing *side* of a **winning** redemption (usdcSize 0) gets a phantom "Lost" entry plus a Close button. Compounds R3 — the trades-feed "lost" detection is over-broad.
- **Fix:** tie "Lost" to actual position outcome, not a zero-amount activity row.

## Correctness — lower severity

### R5. One in-flight redeem disables every row's Redeem button — MED-LOW
- **Files:** `apps/web/src/app/portfolio/page.tsx:577`, `apps/web/src/components/portfolio/positions-table.tsx:421-424`
- `redeemActionsDisabled={isRedeemingCtf}` (a single shared `isLoading`) disables *all* rows during any single redeem, and `if (isRedeemingCtf) return` blocks a concurrent redeem — even though per-row `redeemingPositionId` exists (used only for the spinner). Defensible (redeems serialize through one hook), but per-row state implies per-row was intended.

### R6. `loadPortfolio` has no in-flight guard → stale response clobbers fresh — LOW-MED
- **File:** `apps/extension/src/sidepanel.ts:3276`
- The refresh timer and message handlers can both call `loadPortfolio(true)` concurrently; both await `fetchPortfolioData` with last-writer-wins on `latestPortfolioData`/`innerHTML`, so a slower stale fetch can overwrite newer data. Fix: a generation token or in-flight guard.

### R7. A resolving market can be counted as both open and lost — LOW
- **File:** `apps/web/src/app/api/user/positions/route.ts:345`
- The winning-redeemable merge checks `displayedPositionsByKey.has()` but never `lostPositionsByKey`. If the open fetch sees a position at curPrice>0 and the concurrent redeemable fetch sees it at curPrice 0 (market resolves between them), it's emitted as both open and lost. Narrow window, unguarded.

### R8. Approval poll reports failure when the proxy can't be resolved — LOW (edge)
- **File:** `apps/extension/src/content/trading/portfolio-approval.ts:11`
- `resolvePortfolioApprovalPollAddress` returns null when both the cached address and resolved wallet are empty; the caller then reports "Approval didn't complete" without polling, even if the approval is landing. Residual of the round-1 #8 fix.

### R9. Mobile current-value weight regressed — LOW (cosmetic)
- The extracted `PositionValuePnl` uses `font-medium`; the mobile inline version it replaced used `font-semibold`. Mobile rows render one weight lighter.

## Cleanup / efficiency

### R10. Sports hook clones the full games map per websocket message — efficiency
- **File:** `apps/web/src/hooks/use-sports-websocket.ts:304`
- Every tick calls `getGamesSnapshot()` (`new Map(this.games)`) and rebuilds a second `LiveGameState` map via `snapshotToLiveGames`, even when `alreadyMatched` is true. O(N games) allocation per message for a hook that wants one game. Short-circuit on `alreadyMatched` before snapshotting.

### R11. `positionMetrics` recomputed per row in two maps; `toWin` duplicated in totals — efficiency
- **File:** `apps/web/src/components/portfolio/positions-table.tsx:71`
- Runs once per row in both the desktop and mobile `.map`, and `toWin = size*(1-avgPrice)` is re-derived inline in the totals reduce — a definition change desyncs row vs total. Memoize one shared `rows` array.

### R12. Redundant third positions Map in the route — cleanup
- **File:** `apps/web/src/app/api/user/positions/route.ts:354`
- Builds `openPositions` → `displayedPositionsByKey` → `mergedPositions` (3 maps, 2 sorts) where seeding `displayedPositionsByKey` from `openPositionsByKey` and sorting once suffices.

### R13. `hasPortfolioApproval` still re-implements the fetch+derive orchestration — altitude
- **File:** `apps/extension/src/sidepanel.ts:2534`
- The composite gate is now shared (`deriveTradingSetupApprovalStatus` — the round-1 #10 fix), but `sidepanel.ts` and `refreshBalance` still each hand-roll the `get-all-allowances` send + derive with different error fallbacks (the divergence behind R1/R2). A shared `fetchTradingApprovalStatus(owner)` would unify them.

### R14. `cardSetupFlow(ctx)` derived twice per render — cleanup
- **File:** `apps/extension/src/content/trading/trading-panel.ts:5270`
- Called in the render-switch guard and again inside `addSetupFlow`. Compute once, pass it in.

### R15. Bespoke backoff helper — minor reuse
- **File:** `apps/extension/src/content/trading/portfolio-approval.ts:14`
- `nextPortfolioApprovalPollDelayMs` adds a 4th place backoff is defined (alongside stream-markets and the relayer retry). A shared `backoffDelayMs(attempt, {base, cap})` would consolidate.

## Refuted this round (checked, not bugs)

- **`needsWrap` reorder** — the fix correctly throws insufficient-collateral before the `needsWrap` early return.
- **EOA deploy-gate branch** (`setup-gates.ts`) — `walletMode === "eoa"` is normalized to `"deposit"` before every production caller (`SHOW_EOA_OPTION` is false); the branch is dead, reached only by unit tests.
- **Sports stale-event match race** — `eventRef.current` is updated synchronously in the same effect that resets the match, before any listener callback can fire.
- **Sports connection-listener liveness** — `addConsumer()` is present in the data-listener effect by design; the connection listener is status-only.
- Plus the round-1 refuted set (ERC1155 redeem approval, wallet-mode default flip, viem `requestAddresses`, orderbook sort).

## Round-2 blockers

The fix batch is mostly solid, but four items should be addressed before merge:
1. **R1** — transient read flips the content card to "Approve" for an approved user.
2. **R2** — transient read re-shows setup and persists a wrong "incomplete" flag (side panel).
3. **R3** — neg-risk lost-position redeem still misrouted via the trades feed (gap in round-1 #2).
4. **R4** — winning redemption mislabeled "Lost" with a spurious Close button.

R1–R2 share a root cause: a degraded/partial allowance read is collapsed to `hasTradingApproval: false` instead of being treated as "unknown." Distinguishing read-failure from genuinely-not-approved fixes both.

---

## Round-2 resolution status (verified 2026-06-28)

All 15 round-2 items are now **fixed and verified** against the working tree (re-reviewed file-by-file; `apps/extension` setup-flow tests pass 17/17).

> Note: an initial fix attempt for R1–R5 added the tests but not the implementation, leaving the new tests **red**. A second pass landed the real source changes and the tests are now green. The table below reflects the final state.

| # | Finding | Status | Resolution |
|---|---------|--------|------------|
| R1 | Transient read flips card to "Approve" | ✅ Fixed | Background `handleGetAllAllowances` returns a `degraded` flag on any read failure; `deriveTradingSetupApprovalStatus` carries `allowanceReadStatus`; `refreshBalance` returns early (leaves `hasTradingApproval` untouched) on degraded, catch only logs. |
| R2(a) | `resolveSetupSurfaceMode` ignored latch | ✅ Fixed | Now honors `persistedComplete` + `liveCompleteKnown`; returns `"complete"` when latched and live flow is unknown (`setup-flow.ts:186-197`). |
| R2(b) | Latch cleared on transient incomplete | ✅ Fixed | `hasPortfolioApproval` returns `null` on degraded/thrown; `fetchPortfolioData` reuses prior `hasApproval` + flags degraded; latch reset guarded by `!isPortfolioSetupCompletionUnknown(data)` (`sidepanel.ts:3342`). |
| R3 | Neg-risk lost redeem misrouted (trades feed) | ✅ Fixed | trades route emits `negRisk`; merge extracted to `merge-history.ts`, drops the zero-value trades row in favor of the negRisk-correct synthetic row; Close button only renders on `isLostPosition` rows. |
| R4 | Winning redemption mislabeled "Lost" | ✅ Fixed | `getActivity` requires explicit `isLostPosition`; zero-value REDEEM without it → "Redeemed"/neutral, no Close button (`history-table.tsx:21-37`). |
| R5 | One redeem disables all rows | ✅ Fixed | In-flight tracking moved to a `ReadonlySet<string>` of position ids; per-row disable + handler guard scoped to `redeemingPositionIds.has(position.id)`; `redeemActionsDisabled`/`isRedeemingCtf` removed; concurrent redeems allowed. |
| R6 | `loadPortfolio` race clobbers fresh data | ✅ Fixed | Generation token `portfolioLoadGeneration` bumped at entry and re-checked after every await before the `latestPortfolioData`/`innerHTML` writes (`sidepanel.ts:3306`). |
| R7 | Position counted as both open and lost | ✅ Fixed | `lostPositionsByKey` built first; open and winning-redeemable inserts gate on `!lostPositionsByKey.has(key)` (`route.ts:333,348`) — outputs mutually exclusive by key. |
| R8 | Approval poll false "didn't complete" | ✅ Fixed | `resolvePortfolioApprovalPollAddress` falls back to `ownerAddress`, never returns `null` for a real owner, so it always polls (`portfolio-approval.ts:9`). |
| R9 | Mobile current-value weight regressed | ✅ Fixed | `PositionValuePnl` renders `compact ? "font-semibold text-sm" : "font-medium"`; mobile passes `compact` → `font-semibold` restored (`positions-table.tsx:169`). |
| R10 | Sports hook clones games map per message | ✅ Fixed | Listener short-circuits on `alreadyMatched` before `getGamesSnapshot()`/`snapshotToLiveGames` (`use-sports-websocket.ts:304-308`). |
| R11 | `positionMetrics` recomputed per row twice; `toWin` duplicated | ✅ Fixed | One memoized `positionRows` array shared by both breakpoints; totals reduce over `row.metrics.toWin` (`positions-table.tsx:323,379`). |
| R12 | Redundant third positions Map in the route | ✅ Fixed | Down to two Maps + one sort; no `displayedPositionsByKey`/`mergedPositions` (`route.ts:317-348`). |
| R13 | `hasPortfolioApproval` re-implements fetch+derive | ✅ Fixed | Shared `fetchTradingSetupApprovalStatus(owner, fetchAllAllowances)`; both surfaces supply only their transport closure (`setup-flow.ts:120-130`). |
| R14 | `cardSetupFlow(ctx)` derived twice per render | ✅ Fixed | Computed once (`const setupFlow = cardSetupFlow(ctx)`) and passed into `addSetupFlow` via `{ flow }` (`trading-panel.ts:5260`). |
| R15 | Bespoke backoff helper | ✅ Fixed | `nextPortfolioApprovalPollDelayMs` delegates to a shared `backoffDelayMs` util (`backoff.ts`). (Broader consolidation of stream-markets/relayer backoff intentionally left as-is — structurally different.) |

**Net:** round-1 (15) and round-2 (15) findings are all resolved. No open blockers.

---
---

# Round 3 — Full working-tree re-review (2026-06-29)

Unlike round 2 (which re-reviewed only the fix batch), this is a **fresh full-tree review** of the current `git diff HEAD` working set — 44 source files / ~6.3k source-diff lines — at the same extra-high-effort recall level (9 finder angles → per-candidate verification → gap sweep). Round-1/round-2 items already resolved are not repeated, except where a previously-"fixed" item left a **residual edge** that this pass surfaces from a new angle.

Severity legend unchanged.

## Correctness — new this round

### 3.1. Open positions silently vanish when the user holds winning redeemables — HIGH
- **File:** `apps/web/src/app/api/user/positions/route.ts:338-347`
- **What:** Winning-redeemable positions are fetched out-of-band **only at `offset === 0`** (`route.ts:291-302`), merged into `openPositionsByKey`, sorted by `currentValue`, and `slice(0, limit)`'d. They occupy page-1 display slots, but page 2 (`offset = limit`) fetches the **open-only** upstream stream and skips redeemables entirely.
- **Failure:** 60 open positions + 12 winning redeemables, `limit=50` — the 12 redeemables rank into the top 50 and push 12 genuine open positions to display ranks 51-62. Page 2 fetches the open stream at upstream offset 50 (returning open positions 51-100 of the *open-only* sequence), so the 12 displaced positions — which live at a lower upstream offset — are never returned. They disappear from the portfolio. Bites any trader with >`limit` positions plus winning redeemables.
- **Fix:** Page the merged set, or fetch redeemables on every page and reconcile offsets against the merged ordering rather than the open-only stream.

### 3.2. Phantom `hasMore` → empty "load more" page — MED
- **File:** `apps/web/src/app/api/user/positions/route.ts:349-350`
- **What:** `hasMore = openPositionsByKey.size > limit || !openResult.result.exhausted`. `size` includes the out-of-band winning redeemables (added only at offset 0), and `!exhausted` is true whenever a full upstream page was all lost-redeemable (the open fetch's `stopWhen` counts only non-lost rows, so `exhausted` never trips on an all-lost page).
- **Failure:** 40 open positions (upstream exhausted) + 15 winning redeemables → `size = 55 > 50` → `hasMore = true`; "load more" fetches offset 50 (empty) and skips redeemables → blank page. (Distinct mechanism from round-1 #7, which was about `length > limit`; this survives via the redeemable count and the all-lost-page `exhausted` gap.)
- **Fix:** Compute `hasMore` from the count of genuine *open* rows actually withheld, not the merged map size or `!exhausted`.

### 3.3. Transient `resolveTradingWallet` error forces a deployed user back through setup — MED
- **File:** `apps/extension/src/content/trading/trading-service.ts:468-491`
- **What:** In `applyConnectedWalletAccounts`, the only code that sets `proxyAddress`/`isDeployed` is `update(walletData)` inside the `try`. The `catch` updates balances to 0 but **leaves `proxyAddress`/`isDeployed` null**. The `hasCreds` branch then runs `state: hasDeployedTradingWallet(ctx) ? "ready" : "connected"`, and `hasDeployedTradingWallet` requires `proxyAddress` truthy.
- **Failure:** A returning user with a deployed deposit-mode vault + CLOB creds connects; `resolveTradingWallet` throws (RPC blip in `getBalance`/`deriveAddress`) → `proxyAddress` stays null → `hasDeployedTradingWallet` false → state `"connected"` and the deploy/setup wizard re-appears for an already-set-up user. Same exposure on the `switchWallet` path (which calls `createDisconnectedContext()` first).
- **Fix:** On the catch path, preserve the prior `proxyAddress`/`isDeployed` (or re-derive deterministically) instead of dropping them; treat a resolve failure as "unknown," not "not deployed."

### 3.4. Sports `games` Map grows unbounded (memory leak) — MED
- **File:** `apps/web/src/lib/sports-websocket-manager.ts:311`
- **What:** New in this diff. `broadcastEvent` does `this.games.set(String(event.gameId), event)` with no eviction/TTL, and the map is never cleared — not in `disconnect()`, `cleanupConnection()`, or `reconnect()`. `getGamesSnapshot()` copies it (`new Map(this.games)`) per event.
- **Failure:** Over a long board/detail session the singleton accumulates every distinct `gameId` ever broadcast (finished games never removed); both the per-event snapshot copy and the downstream match scan grow without bound.
- **Fix:** Evict ended/stale games (TTL or on game-final), and clear the map on disconnect.

### 3.5. Shared sports socket torn down + reconnected on every event navigation — LOW
- **File:** `apps/web/src/hooks/use-sports-websocket.ts:345-347`
- **What:** The consumer effect keys on `[enabled, eventKey]`; cleanup calls `removeConsumer()`, which at `consumerCount === 0` runs `manager.disconnect()` synchronously with no debounce (`sports-websocket-manager.ts:123-128`), immediately followed by `addConsumer()` → `connect()`.
- **Failure:** When this hook is the sole consumer, every navigation to a different event forces a full WebSocket teardown+reconnect, dropping in-flight updates during the gap. (`eventKey` is a memoized stable string, so spurious re-renders don't churn — only genuine event switches do.)
- **Fix:** Add a short disconnect grace window (debounce the count-0 teardown) so back-to-back navigations reuse the socket.

## Correctness — residual edges of round-2 fixes

### 3.6. First-load degraded read still re-shows "Approve" — gap in the R1 fix — MED
- **File:** `apps/extension/src/content/trading/trading-service.ts:804`
- **What:** The R1 fix made `refreshBalance` early-return on a degraded read (`if (approvalStatus.allowanceReadStatus === "degraded") return;`) so it no longer overwrites a *known-good* `hasTradingApproval`. But `hasTradingApproval`/`usdcAllowance` default to `false`/`0`, and the card path (`cardSetupFlow` → `setup-flow.ts:228`) has **no degraded-awareness** — unlike the side panel, which preserves the previous value (`sidepanel.ts:2668-2671`).
- **Failure:** An already-approved user connects and the **first** post-connect allowance read degrades — there is no prior value to preserve, so `hasTradingApproval` stays at its default `false` and the card renders the "Approve permissions" step / a false "Approve" button until a clean read lands.
- **Fix:** Carry a `degraded`/`unknown` tri-state into the card flow (as the side panel does) so a first-read failure renders "checking…", not "Approve."

### 3.7. Persistent degraded read after an on-chain revoke suppresses re-approve UI — trade-off of the R2 fix — MED (plausible)
- **Files:** `apps/extension/src/sidepanel.ts:3408-3418`, `apps/extension/src/content/trading/setup-flow.ts:210-211`
- **What:** The R2 fix guards the latch-clear behind `!isPortfolioSetupCompletionUnknown(data)` (only clear on a non-degraded read) and makes `resolveSetupSurfaceMode` return `"complete"` when `persistedComplete && liveCompleteKnown === false`. That correctly avoids flapping on a transient read — but it also means a **persistently** degraded read can't re-open the wizard.
- **Failure:** User completes setup (latched), later revokes the allowance on-chain, and reads stay degraded → `liveCompleteKnown === false` → surface renders empty, the approve step is never re-surfaced, and orders fail with no prompt.
- **Fix:** Bound the "trust the latch under degraded" window (time- or attempt-capped), or fall back to re-surfacing approve after N consecutive degraded reads.

### 3.8. Real $0 REDEEM with no synthetic counterpart loses its "Lost" label — consequence of the R4 fix — LOW
- **File:** `apps/web/src/components/portfolio/history-table.tsx:27-31`
- **What:** The R4 fix made `getActivity` require an explicit `isLostPosition` flag (set only on the synthetic `lostPositions` path, `merge-history.ts:28`) to render "Lost"; a `REDEEM` with `amount === 0` and no flag now renders neutral "Redeemed" with no Close-lost action.
- **Failure:** A genuinely-lost position surfaced via the **real** activity feed with no matching `lostPositions` entry (e.g. it aged out of the redeemable feed but the on-chain $0 REDEEM row persists) shows neutral "Redeemed" and loses the red tone + Close action it had pre-R4. Common case is covered by dedup; this is the uncovered tail.
- **Fix / confirm:** Decide whether "Redeemed" is the intended label for an already-settled $0 redemption; if a lost position should still be actionable here, derive lost-ness from outcome/price, not solely the synthetic flag.

### 3.9. Non-matched sports ticks still do a full snapshot + scan — residual of R10 — LOW
- **File:** `apps/web/src/hooks/use-sports-websocket.ts:311-316`
- **What:** R10 added an `alreadyMatched` short-circuit for the *pinned* game, but for any incoming update whose `gameId` isn't the match, the listener still runs `getGamesSnapshot()` (full Map copy) + `snapshotToLiveGames()` (a second full Map, a `LiveGameState` per game) + `matchSportsEventToGame()` (O(games) normalized-text scan).
- **Failure:** On an event-detail page whose game isn't live, every tick of every unrelated game across all leagues pays two full-Map allocations + a text scan, indefinitely. Compounds 3.4 (the scan length grows with the unbounded map).
- **Fix:** Match the single incoming event against `currentEvent` before building any snapshot/Maps; only fall back to the full scan when a cheap pre-filter (league/teams) passes.

## Correctness — lower severity / hardening

### 3.10. `ownerAddress` interpolated into innerHTML unescaped — LOW (plausible)
- **File:** `apps/extension/src/content/trading/portfolio-setup-view.ts:14-37`
- **What:** `data-owner-address="${ownerAddress}"` is built raw while adjacent error strings *are* `escapeHtml`'d (`portfolio-setup-view.ts:61`), and the result is `innerHTML`-assigned (`sidepanel.ts:3422`). The address reaches here through only a `typeof === "string"` check — no `0x`-hex validation or `getAddress()` normalization on this path (contrast `trading-handler.ts`, which does normalize).
- **Failure:** A malformed/attacker-influenced address containing `"` breaks out of the attribute. Low exploitability (needs a malicious wallet/session payload), but the file's own convention is to escape.
- **Fix:** `escapeHtml(ownerAddress)` (and/or validate as `0x`-hex before render).

### 3.11. Neg-risk adapter allowance only checked as a boolean, not against the order notional — LOW (plausible)
- **File:** `apps/web/src/hooks/use-clob-client.ts:437`
- **What:** For a neg-risk BUY, only the pUSD→NegRiskExchange allowance is re-read against `requiredPusdRaw`; the pUSD→NegRiskAdapter allowance is only verified as an `approved` boolean at the default threshold, never against the actual order size.
- **Failure:** A finite pUSD→NegRiskAdapter allowance above the threshold but below `requiredPusdRaw` skips the top-up → the order can be rejected at settlement for insufficient adapter allowance. Low practical impact since app-granted approvals use `maxUint256`; bites a manually-set finite adapter allowance.
- **Fix:** Check the adapter allowance against `requiredPusdRaw` too (symmetric with the exchange check).

## Cleanup / altitude

### 3.12. Inline card bypasses the shared setup-surface resolver → "Skip" doesn't carry — altitude
- **File:** `apps/extension/src/content/trading/trading-panel.ts` (`addSetupFlow` / `cardSetupFlow` render gate)
- The side panel routes surface decisions through `resolveSetupSurfaceMode` (honoring persisted/dismissed state), but the card re-derives completion inline and never reads the `setup-flow-storage` dismissal layer — so "Skip for now" in the side panel doesn't carry to the card, despite comments claiming the surfaces "gate identically."
- **Fix:** Centralize the wizard/focused/banner/complete decision in one resolver both surfaces call.

### 3.13. pUSD-spender approval loop duplicated — reuse
- **File:** `packages/shared-types/src/approvals.ts:161`
- `buildClobOrderApprovalTransactions` re-implements the per-spender `buildErc20ApprovalTransaction(PUSD_ADDRESS, spender, maxUint256)` loop already in `buildTradingApprovalTransactions` (`approvals.ts:436`), differing only by neg-risk filtering. Two owners of the spender→approval mapping will drift when a spender is added.
- **Fix:** Extract the spender loop into one helper both functions call.

### 3.14. UI state derived by substring-searching rendered HTML — cleanup
- **File:** `apps/extension/src/sidepanel.ts:3215`
- `wizardExpanded` is computed via `setupSurface.includes("data-portfolio-setup")` — re-parsing markup the renderer already knows. Renaming the attribute silently breaks the funds/table hide logic with no type error.
- **Fix:** Have `renderPortfolioSetupSurface` return `{ html, mode }` instead of throwing the mode away and grepping it back out.

### 3.15. `maxUpstreamPages = 5` hardcoded mid-handler with no "capped" signal — altitude
- **File:** `apps/web/src/app/api/user/positions/route.ts:282`
- A user with >5 upstream pages of lost/low-value rows ahead of their active positions gets a silently truncated set and a possibly-wrong `hasMore`, with no flag that the scan was capped. Compounds 3.1/3.2.
- **Fix:** Lift to a named module-level config alongside `UPSTREAM_TIMEOUT_MS`, and surface `exhausted=false` when the cap is hit so callers know the scan was bounded.

## Refuted this round (checked, not bugs)

- **`negRisk` field name** — consistent end-to-end (`p.negativeRisk` → emitted `negRisk` → consumers read `.negRisk`); the round-1 #2 / round-2 R3 plumbing holds for the positions route.
- **merge-history dedup narrowing (`usdcAmount !== 0`)** — cannot create duplicates; a non-zero REDEEM is a different (winning) outcome than a synthetic lost row, so they never collide.
- **merge-history key mismatch (`outcome` string vs `outcomeIndex`)** — the two key formats are used in separate scopes and never compared cross-wise; cosmetic only.
- **Wallet-mode normalizer divergence** (`normalizeExtensionTradingWalletMode` deposit-default vs shared safe-default) — unreachable: the value is pre-normalized to a concrete mode before `getPolymarketSignatureType`, and the message types constrain the input to `'safe'|'eoa'|'deposit'|undefined`.
- **`ensurePusdSufficient` reorder** — confirmed a clean fix (collateral validated even when no wrap is needed), no remaining bug — re-confirms round-2's refutation.
- **Side-panel approval poll stale proxy** — `loadPortfolio(true)` refreshes `latestPortfolioData` with the deterministically-derived proxy before approve, and `resolvePortfolioApprovalPollAddress` re-derives when the cache is empty (the round-1 #8 / round-2 R8 fixes hold).

## Out-of-scope heads-up (real but pre-existing, not introduced by this diff)

The sports websocket manager **permanently gives up after `MAX_ATTEMPTS` reconnects** (`sports-websocket-manager.ts:254`) and **never arms the pong/liveness timeout on `onopen`** (`sports-websocket-manager.ts:166`) — both can silently hang live updates. The diff doesn't touch these lines, but since it heavily extends this manager, they're worth fixing in the same pass.

## Round-3 blockers

Top priorities (data-loss / trading-flow impact):
1. **3.1** — open positions silently dropped when winning redeemables exist (data loss in the portfolio list).
2. **3.2** — phantom `hasMore` → empty "load more".
3. **3.3** — transient resolve error forces a deployed user back through setup.
4. **3.6** — first-load degraded read still re-shows "Approve" (gap left by the R1 fix).

3.4 (websocket memory leak) is the next tier. 3.6/3.7 share a root cause with round-2 R1/R2: a degraded/partial read needs a true tri-state ("unknown") that survives the *first* read and is *time-bounded* under persistent degradation — neither edge is covered by the current "preserve previous value" approach.

---

## Round-3 resolution status (verified 2026-06-29)

Re-reviewed each round-3 finding file-by-file against the current working tree. **12 of 15 fixed**, 1 partial, 1 open (likely intentional). Each verdict is backed by the current source (not just a rename).

| # | Finding | Status | Resolution |
|---|---------|--------|------------|
| 3.1 | Open positions vanish with winning redeemables | ✅ Fixed | Redeemables now fetched on **every** page (not offset-0-gated), merged into one combined set, sorted once and sliced by the real window `mergedPositions.slice(offset, offset + limit)` — displaced opens reappear on page 2 (`route.ts:304-314,343-353`). |
| 3.2 | Phantom `hasMore` → empty load-more | ✅ Fixed | `hasMore = mergedPositions.length > mergedPageEnd` — no longer references `openPositionsByKey.size > limit` or `!exhausted`; lost rows filtered before the comparison (`route.ts:355`). |
| 3.3 | Transient resolve error forces a deployed user back to setup | ⚠️ Partial | Catch now re-derives `proxyAddress` (`ctx.proxyAddress ?? resolveTradingWalletAddress(...)`), but still sets `isDeployed: walletMode === "eoa" ? true : ctx.isDeployed` — for a non-EOA first connect `ctx.isDeployed` is `null`, so `hasDeployedTradingWallet` is still false and the deployed user is **still** downgraded to `"connected"` (`trading-service.ts:480-506`). The proxy-address gap is closed; the "deployment-state unknown ≠ not deployed" distinction is not. |
| 3.4 | Sports `games` Map unbounded | ✅ Fixed | TTL eviction (`evictStaleGames()`, ended 30m / stale 2h) runs on every `set` and snapshot; `disconnect()` does `this.games.clear()` (`sports-websocket-manager.ts:336-360,149-156`). Caveat: keys off payload timestamps with no hard size-cap backstop, so an entry missing both timestamps persists until the next disconnect. |
| 3.5 | Socket torn down on every event navigation | ✅ Fixed | Removing the last consumer now `scheduleDisconnect()`s a 1.5s grace timer (`DISCONNECT_GRACE_MS`) re-checking `consumerCount === 0`; `addConsumer()` cancels it, so back-to-back navigations reuse the socket (`sports-websocket-manager.ts:121-135,297-305`). |
| 3.6 | First-load degraded read re-shows "Approve" | ✅ Fixed | `refreshBalance` now writes an `approvalReadStatus` tri-state (`complete`/`degraded`/`unknown`); the card renderer intercepts a deployed user with `approvalReadStatus !== "complete"` and shows "Checking approvals…" instead of the Approve step (`trading-service.ts:824-837`, `trading-panel.ts:5346-5353`). Test-locked (`trading-panel-ux.test.ts:358`). |
| 3.7 | Persistent degraded read suppresses re-approve | ✅ Fixed | A consecutive-degraded counter (`PORTFOLIO_SETUP_DEGRADED_LATCH_TRUST_LIMIT`) caps latch trust; past the cap `isPortfolioSetupCompletionUnknown` returns "known", the persisted complete flag is cleared and the wizard/banner re-surfaces (`sidepanel.ts:240-241,3231-3243,3485-3502`). Minor: strict `>` trusts 4 reads before releasing (off-by-one vs the name), but the bound is finite. |
| 3.8 | Real $0 REDEEM loses "Lost" label | 🔵 Open (likely intentional) | Unchanged — `getActivity` still derives lost-ness solely from the synthetic `isLostPosition` flag (`history-table.tsx:27-31`; flag set only at `merge-history.ts:28`). A real $0 REDEEM with no synthetic counterpart still renders neutral "Redeemed" with no Close action. Defensible (a settled on-chain REDEEM is arguably "Redeemed"), but the finding's failure is not closed — needs a product call. |
| 3.9 | Non-matched ticks do full snapshot+scan | ✅ Fixed | Listener now runs a cheap single-entry `matchSportsEventToGame(currentEvent, new Map([[gameId, nextGame]]))` and returns early on a non-match **before** any `getGamesSnapshot()`/full scan (`use-sports-websocket.ts:311-315`). |
| 3.10 | `ownerAddress` unescaped in innerHTML | ✅ Fixed | Computed once as `escapedOwnerAddress = escapeHtml(ownerAddress)` and used in every `data-owner-address` attribute (`portfolio-setup-view.ts:9,17,32,38`). |
| 3.11 | negRisk adapter allowance boolean-only | ✅ Fixed | `ensureV2Approvals` now reads the NegRiskAdapter allowance on-chain (`readErc20Allowance(..., NEG_RISK_ADAPTER_ADDRESS)`) and requires `adapterAllowance >= requiredPusdRaw`, symmetric with the exchange check (`use-clob-client.ts:439-453`). |
| 3.12 | Card bypasses shared surface resolver | ✅ Fixed | Card now calls `resolveSetupSurfaceMode({ flow, persistedComplete, dismissed, liveCompleteKnown })` and reads `readSetupDismissed`/`readSetupComplete` from the shared `setup-flow-storage`; a side-panel "Skip for now" now resolves to `"banner"` and suppresses the card wizard (`trading-panel.ts:5327-5359`). |
| 3.13 | Duplicated pUSD-spender approval loop | ✅ Fixed | Extracted to shared `appendMissingPusdApprovalTransactions(txns, pusdTargets)`, called by both `buildClobOrderApprovalTransactions` and `buildTradingApprovalTransactions` (`approvals.ts:176,434-449,472`). |
| 3.14 | UI state grepped from rendered HTML | ✅ Fixed | `renderPortfolioSetupSurface` returns a typed `{ html, mode }`; consumer reads `setupSurface.mode === "wizard"` — no `.includes("data-portfolio-setup")` remains (`sidepanel.ts:63-66,3286-3287`). |
| 3.15 | `maxUpstreamPages` hardcoded, no capped signal | ✅ Fixed | Now `POSITIONS_UPSTREAM_MAX_PAGES = 5` (module const) and the handler surfaces a `scanCapped` boolean in `pagination` when the cap is hit (`route.ts:11,54,194-196,356-357,427`). |

**Net:** 12/15 fixed. **Remaining:**
- **3.3 (Partial)** — still downgrades a deployed non-EOA user to `"connected"` on a first-connect resolve throw; needs `isDeployed` treated as "unknown" (not `false`) on the catch path, or re-derived deployment state.
- **3.8 (Open)** — likely intentional reclassification of a settled $0 REDEEM to "Redeemed"; confirm the product intent or derive lost-ness from outcome/price.

Two minor follow-ups noted but not blocking: 3.4 has no hard size-cap backstop if upstream omits game timestamps, and 3.7's threshold trusts 4 (not 3) consecutive degraded reads.

---
---

# Round 4 — Re-review of the round-3 fix batch + new code (2026-06-30)

Fresh full-tree review (`git diff HEAD`, now ~7.7k source-diff lines) at the same extra-high-effort recall level (9 finder angles → per-candidate verification → sweep). The diff now contains the round-3 fixes **plus** newly-added code (`relayer.ts` beacon-proxy derivation, `wallet-switch.ts`, `extension-session.ts`, `use-proxy-wallet.ts`, `use-trading-wallet-mode.ts`, `contracts.ts`). This round found that the round-3 fix batch **introduced new regressions** — several tracing to one root cause.

## Root cause: the all-or-nothing `degraded` allowance flag

Findings R4-1, R4-2, and R4-3 share a single origin. The round-2/round-3 work added a `degraded` signal to `handleGetAllAllowances`, but implemented it as **one shared flag flipped by any of ~8 spender reads**, and the read helpers were changed to *throw* (the `fallbackRaw`/`fallbackApproved` per-spender defaults were dropped), so a degraded path that previously couldn't happen now does. A single persistently-flaky spender read (e.g. the neg-risk adapter) now marks the **entire** allowance response degraded on every poll — which then strands the card and wipes the side panel's durable latch. Fixing the flag to be per-spender (or requiring a quorum of failures) defuses all three.

## Correctness — regressions the fix batch introduced

### R4-1. One failed allowance read marks the whole response degraded — HIGH
- **File:** `apps/extension/src/background/trading-handler.ts:630` (handleGetAllAllowances)
- **What:** The per-read fallbacks (`fallbackRaw:0n`/`fallbackApproved:false`) were replaced by `try/catch` wrappers that flip a single shared `degraded` flag and call the underlying reads **without** the fallback — so the reads now throw instead of returning a per-spender zero. One failing read of ~8 → `degraded:true` for the whole response. **Verified CONFIRMED:** prior code (`return ok({ allowances })`) had no degraded path at all for these reads; the new throwing path is new.
- **Failure:** A single contract/RPC that consistently reverts or rate-limits (neg-risk adapter read) trips `degraded` on every poll while the other 7 reads succeed → feeds R4-2 and R4-3.
- **Fix:** Make `degraded` per-spender (only the failed key is unknown), or require ≥N failures before declaring the whole read degraded.

### R4-2. Persistent degraded read strands the card on an infinite "Checking approvals…" — HIGH
- **Files:** `apps/extension/src/content/trading/trading-service.ts:824`, `apps/extension/src/content/trading/trading-panel.ts:5346`
- **What:** `refreshBalance` early-returns on a degraded read (`update({approvalReadStatus:'degraded'}); return;`) without ever setting `hasTradingApproval` (which was reset to `false` on connect/switch). The card render branch `ctx.isDeployed===true && !ctx.hasTradingApproval && ctx.approvalReadStatus!=='complete'` then shows "Checking approvals…" and `return`s — and this gate is evaluated **before** `resolveSetupSurfaceMode`, so the persisted-complete latch can't rescue it. **Verified CONFIRMED.** The card has **none** of the side panel's degraded protections (`preserveDegradedApproval`, the consecutive-degraded latch).
- **Failure:** A fully-onboarded, already-approved user whose allowance proxy is persistently degraded (e.g. knoww.app rate-limiting, or R4-1's single flaky read) sees an infinite "Checking approvals…" spinner on the in-page card and can never reach the order form until a fully-clean read lands.
- **Fix:** Give the card the same degraded resilience as the side panel (preserve last-known-good `hasTradingApproval` on degraded; consult the latch before the spinner gate), ideally via a shared helper (see R4-12).

### R4-3. Degraded-latch overflow wipes the durable setup-complete flag — HIGH
- **File:** `apps/extension/src/sidepanel.ts:241,3262,3528`
- **What:** Once `portfolioSetupConsecutiveDegradedReads` exceeds `PORTFOLIO_SETUP_DEGRADED_LATCH_TRUST_LIMIT`, `isPortfolioSetupCompletionUnknown` returns `false`, so `loadPortfolio`'s `else if (portfolioSetupComplete && !isPortfolioSetupCompletionUnknown(data))` branch fires and calls `writeSetupComplete(addr, false)` — persisting to `chrome.storage.local`. **Verified CONFIRMED:** reachable from a pure upstream outage (no on-chain revoke), because under degraded reads `hasApproval` falls to false → `flow.isComplete` false → the clear branch runs.
- **Failure:** A transient allowance-proxy outage lasting ≥4 consecutive reads erases a fully-onboarded user's durable "setup complete" flag and re-pops the onboarding wizard/banner — persisting the wrong state across reloads until a clean read re-latches. R4-1 makes this easy to hit (one flaky read → degraded every poll).
- **Fix:** Don't clear the durable latch on degraded reads at all (only on a confirmed clean read that shows incomplete); also resolve the off-by-one below.
- **Off-by-one (confirmed):** The `>` gate at `:3262` (after the counter `++`) trusts the latch for reads 1–3 and breaks on the **4th**, while the sibling `preserveDegradedApproval: counter < LIMIT` at `:3502` (before the `++`) stops preserving on the **3rd**. Same `LIMIT=3` constant, two boundaries (4 vs 3) straddling the increment.

### R4-4. Locking the injected wallet force-logs-out the user — HIGH
- **File:** `apps/extension/src/content/trading/trading-service.ts:552` (getConnectedWalletAddress → handleExternalWalletAccountsChanged)
- **What:** The side panel polls `getConnectedWalletAddress()` on every portfolio load; it calls `WalletBridge.getSelectedAccounts()` (non-prompting `eth_accounts`), which returns `[]` when MetaMask is **locked**. `accountListIncludesAddress([], ctx.address)` is false, so it falls straight to `WalletBridge.resetAfterDisconnect()` + `this.reset()` + `auth:logout` — no "locked vs disconnected" distinction. **Verified CONFIRMED** (also fires via the `accountsChanged([])` event on lock).
- **Failure:** A user who merely locks their wallet (or whose wallet auto-locks on idle) is force-disconnected and their knoww session is cleared, even though they never disconnected.
- **Fix:** Treat an empty `eth_accounts` while previously-connected as "locked, keep session"; only disconnect on an explicit account removal or a non-empty list that excludes `ctx.address`.

### R4-5. Portfolio history merge crashes on a lost position with a null `endDate` — MED-HIGH
- **File:** `apps/web/src/components/portfolio/merge-history.ts:14`
- **What:** `resolvedTimestamp = closedTimes[conditionId] || position.endDate;` then `resolvedTimestamp.includes("T")` with no guard. `closedTimes` is sparse and `endDate` is typed `string` but flows unvalidated from the Polymarket Data API (route casts the raw JSON and copies `endDate: p.endDate`). **Verified CONFIRMED.**
- **Failure:** A lost position whose `conditionId` has no `closedTimes` entry and whose `endDate` is `undefined`/`null` → `undefined.includes("T")` throws `TypeError`, taking down the entire portfolio history merge (the whole History tab) for that render.
- **Fix:** Guard/normalize `resolvedTimestamp` (default to a safe value, or skip the row) before `.includes`.

### R4-6. Legacy-safe detection overwrites the user's stored wallet-mode choice — MED
- **File:** `apps/web/src/hooks/use-trading-wallet-mode.ts:80`
- **What:** `detectLegacySafe` now writes the resolved mode back to localStorage whenever `safeDeployed` is true (`if (safeDeployed || storedMode !== null) localStorage.setItem(key, preferredMode)`), and `resolvePreferredTradingWalletMode` forces `'safe'` for any legacy-safe user. The old code guarded this with `!storedModeExists`, protecting an explicit prior choice. **Verified CONFIRMED (regression):** the `!storedModeExists` guard was removed, so a previously-stored `'deposit'`/`'eoa'` is clobbered to `'safe'` and lost across reloads. Reachable and ungated (any user who previously used Polymarket directly has a deployed safe).
- **Note:** The related "clicking Deposit snaps back to safe" claim is **refuted as a bug** — for legacy-safe users the resolver intentionally collapses everything to `'safe'`; deposit was never selectable. The real defect is the durable localStorage clobber of a stored choice.
- **Fix:** Restore the "only write when no explicit stored choice exists" guard.

### R4-7. Sports `games` map still leaks for timestamp-less games — LOW-MED (residual of 3.4)
- **File:** `apps/web/src/lib/sports-websocket-manager.ts:348` (evictStaleGames)
- **What:** Eviction keys solely on `Date.parse(finished_timestamp ?? updatedAt ?? "")` and `if (Number.isNaN(updatedAt)) continue;` — a game whose payload carries neither (both optional on `SportResult`) is **never** evicted; there's no manager-side `receivedAt` fallback. **Verified CONFIRMED, NEW.** Bounded somewhat (keyed by `gameId`, so same-game updates overwrite), but distinct never-timestamped gameIds accumulate for the connection's life.
- **Fix:** Stamp a manager-side `receivedAt` on insert and fall back to it when the upstream timestamp is absent, so TTL is independent of upstream data quality.

### R4-8. Relayer proxy returns 500 instead of 504/upstream-400 on a retry abort — LOW
- **File:** `apps/web/src/app/api/relayer/[...path]/route.ts:317`
- **What:** The 400→HMAC-retry fetch reuses the original `AbortController` (single shared 30s timeout across both attempts + the signing-server round-trip) and is **not** wrapped in the AbortError→504 handler the first fetch has. **Verified CONFIRMED.** An abort/network error on the retry escapes to the generic catch → 500 "Internal server error" instead of 504 or the upstream's actionable 400.
- **Fix:** Wrap the retry in the same AbortError→504 guard; on retry failure fall back to returning the original 400 body.

## Correctness — lower severity / latent

### R4-9. Deep-page positions request returns an empty page — LOW (latent)
- **File:** `apps/web/src/app/api/user/positions/route.ts:284`
- The pagination rewrite always fetches upstream from `offset:0` (capped at `POSITIONS_UPSTREAM_MAX_PAGES`×~100 ≈ 500 rows) and slices `[offset, offset+limit)` locally, so `offset>500` slices an empty tail. **Verified PLAUSIBLE — latent:** every current caller uses `offset=0` and there's no positions "load more," so it's unreachable today, but the API still advertises pagination. Fix when a paginating caller is added (page upstream from the requested offset, or document the cap).

### R4-10. `scanCapped` false-positive on an exact-multiple last page — LOW (trivial)
- **File:** `apps/web/src/app/api/user/positions/route.ts:194`
- `scanCapped` is set true whenever the final allowed page returns a full batch, before checking whether more rows exist. **Verified CONFIRMED but trivial:** `scanCapped` is returned in `pagination` but consumed nowhere in the app (only a test reads it; it isn't even in the consumer's response type). Cosmetic until something reads it.

### R4-11. League-filtered sports views drop games with a missing `leagueAbbreviation` — LOW
- **File:** `apps/web/src/hooks/use-sports-websocket.ts:211`
- `set.has(g.leagueAbbreviation?.toLowerCase())` passes `undefined` into a `Set<string>` when the field is absent (the code's own `?.` signals it can be), silently excluding such games from league-filtered views. **Verified PLAUSIBLE:** filtering-only, no crash, arguably-correct behavior; low impact.

### R4-12 (verify on-chain). Deposit-wallet derivation moved to beacon-proxy init code — PLAUSIBLE
- **File:** `packages/shared-types/src/relayer.ts:335` (derivePolymarketDepositWallet)
- Switched from a direct ERC1967 proxy to beacon-proxy CREATE2 init code with **new** hardcoded constants (`ERC1967_BEACON_PROXY_CONST1/2/3`, `DEPOSIT_WALLET_BEACON_ADDRESS`). If any constant is off, every deposit-wallet address is wrong → `getDeployed('WALLET')` false / deposits to an uncontrolled address. **Verified PLAUSIBLE, likely-correct:** a new in-repo test reproduces a known deployed wallet (`0x82c1…ae13` for owner `0x78f3…95b8`) and passes — strong evidence — but it's a self-authored fixture. **Confirm on-chain:** verify that derived address against the relayer's actual deployed wallet for that owner, and that `DEPOSIT_WALLET_BEACON_ADDRESS` is the factory's real beacon, before shipping deposits.

## Cleanup / altitude (selected)

### R4-13. Card vs side-panel degraded policy is implemented twice and has already drifted — altitude
- The consecutive-degraded latch + `preserveDegradedApproval` live only in `sidepanel.ts`; the card (`trading-service.ts`) just flips to `'degraded'` with no preservation (the root of R4-2). Both feed the shared `resolveSetupSurfaceMode`, but the *resilience policy* is per-surface. Lift a small stateful "degraded latch" helper into `setup-flow.ts` so trust-limit + preserve-last-known-good have one source of truth.

### R4-14. Double `getDeployed('WALLET')` preflight on deposit-wallet deploy — reuse
- **File:** `apps/extension/src/background/relayer-client.ts:429` — `deployDepositWallet` does its own `getDeployed` early-return **and** passes `checkDeployed:true` to `deployDepositWalletRelayerWallet`, which now runs the identical preflight internally. Two redundant relayer round-trips + duplicated "already deployed" logs; drop one (mirror the `deploySafe` path). Also `deploySafeRelayerWallet` (`relayer.ts:768`) inlines the guard the new `getDeployedRelayerWallet` helper already extracts.

### R4-15. EIP-1193 permission-error classification duplicated across runtimes — altitude
- **File:** `apps/web/src/lib/wallet-switch.ts:38` duplicates verbatim the user-rejected/unsupported-method classifier (codes 4001/4200/-32601 + `unsupported|not supported|method not found` regex) in `apps/extension/src/content/trading/bridge.ts:106`. When a wallet returns a new "unsupported" shape, only one runtime gets fixed. Lift a shared wallet-error classifier into `packages/shared-types`.

## Efficiency (brief — not counted in the 15)
- `sports-websocket-manager.ts:99` `getGamesSnapshot()` runs the O(games) eviction sweep **and** clones the full map on every call; with K mounted detail consumers, one broadcast → up to K extra sweeps+clones. Track last-eviction time / expose a read-only view.
- `sidepanel.ts:442` `resolvePreferredPortfolioWalletMode` does an unconditional legacy-safe derive (on-chain `isDeployed` read) on every call, compounded by a second derive in `resolvePortfolioWallet`; cache per owner (invariant).
- `use-clob-client.ts:439` two negRisk allowance reads awaited sequentially → `Promise.all`.
- `positions/route.ts:300` fires a second paginated upstream chain (redeemable=true) on **every** request, ~doubling common-case Data-API calls even for accounts with no redeemables.

## Refuted this round (checked, not bugs)
- **`approveUsdc` setting `state:'ready'` early** — inert; every consumer of `state==='ready'` independently re-gates on `hasCredentials`/`hasDeployedTradingWallet`/`flow.isComplete`.
- **Wallet-mode "snap back from Deposit" lockout** — refuted as a bug; legacy-safe users are intentionally forced to `'safe'` (the real defect is the localStorage clobber, R4-6).
- **`if (parsed.gameId)` dropping gameId 0** — `0` is not a valid Polymarket game id; the guard exists to reject partial frames.
- **EOA CTF "false success with approval hash"** — refuted; a mid-loop throw propagates as `{success:false}`, it does not report success. Only the pre-existing approve-then-act non-atomicity remains (gas wasted if the operation reverts after the approval mines) — low, not introduced by this diff.
- **`addPriceHistory` below-cutoff front-insertion** — unreachable; both callers stamp `entry.timestamp = Date.now()`, so it always tail-appends. Defensive one-liner only.

## Out-of-scope heads-up (real but pre-existing, untouched by this diff)
The sports manager still **gives up permanently after MAX_ATTEMPTS** (`sports-websocket-manager.ts:263`, no `online`/`visibilitychange` re-arm) and the **pong-timeout `reconnect()` bypasses backoff + the attempt cap** (`:230` → resets `reconnectAttempt=0`, immediate `connect()`), yielding a ~10s-period reconnect loop with no cap when a socket opens-pings-then-stalls repeatedly. The diff only added `clearDisconnectGraceTimeout()` to `reconnect()`; these mechanisms are unchanged context — but worth fixing while this manager is being actively extended.

## Round-4 blockers
1. **R4-1** — fix the all-or-nothing `degraded` flag (root of R4-2/R4-3).
2. **R4-2** — card infinite "Checking approvals…" for an approved user under degraded reads.
3. **R4-3** — degraded outage wipes the durable setup-complete flag (+ off-by-one).
4. **R4-4** — locking the wallet force-logs-out the user.
5. **R4-5** — portfolio History tab crashes on a lost position with a null `endDate`.

R4-1/2/3 are one defect wearing three hats: a degraded/partial allowance read must be treated as "unknown — keep last-known-good," per-spender, with one shared resilience policy across card and side panel. R4-12 (deposit-wallet derivation) needs an on-chain confirmation before deposits ship.

---
---

# Round 5 — Round-4 fix verification + fresh full-tree review (2026-07-02)

Fresh full-tree review of the working set (`git diff HEAD`, now ~12.6k insertions / 111 files) at high recall (10 finder angles + 2 fix-verification agents → per-candidate adversarial verification). Both test suites were run as evidence. Round-4 items were re-verified file-by-file first; new findings follow.

## Round-4 resolution status (verified 2026-07-02)

**12 of 15 fixed, 1 partial, 2 not fixed.** All earlier-round spot-checks hold (round-1 #1 `needsWrap` guard order, #2 negRisk plumbing end-to-end, #3 no $0-cash lockout of the SELL form; round-2 R1/R2 degraded-read protections).

| # | Finding | Status | Resolution |
|---|---------|--------|------------|
| R4-1 | All-or-nothing `degraded` flag | ✅ Fixed | Per-read fallbacks restored (`readAllowanceOrZero`/`readApprovalOrFalse` return 0n/false and record the failing key); response carries `degradedKeys`, and `deriveTradingSetupApprovalStatus` only reports degraded when a **required** key failed and approval isn't otherwise provable (`trading-handler.ts:623-695`, `setup-flow.ts:148-162`). |
| R4-2 | Card stuck on "Checking approvals…" | ✅ Fixed | `resolveSetupSurfaceMode` now computed **before** the gate and the gate adds `setupSurfaceMode !== "complete"`, so the persisted latch rescues the card; degraded reads early-return preserving last-known-good (`trading-panel.ts:5330-5351`, `trading-service.ts:828-831`). Residual (minor): a mid-setup user with no latch under a sustained outage sits on the spinner until the header refresh / panel reopen. |
| R4-3 | Degraded outage wipes the durable latch (+ off-by-one) | ✅ Fixed | Latch clear now guarded by `approvalReadStatus !== "degraded"` — a degraded read can never call `writeSetupComplete(addr,false)` (`sidepanel.ts:3526-3531`, the only clear site). Off-by-one resolved: both predicates now trust reads 1–3 (`<` pre-increment / `<=` post-increment, `setup-flow.ts:94,103`). |
| R4-4 | Locking the wallet force-logs-out the user | ❌ **Not fixed** | `handleExternalWalletAccountsChanged` still has no empty-list/locked guard — `accounts=[]` falls through to `resetAfterDisconnect()` + `reset()` + `auth:logout` (`trading-service.ts:552-566`), reachable from both the poll and the event path. **Made worse this round:** a new `provider.on("disconnect", …)` handler posts `accountsChanged([])`, adding transient-RPC-loss as a third logout trigger (see 5.3). |
| R4-5 | History merge crashes on null `endDate` | ✅ Fixed | `normalizeLostPositionTimestamp` type-checks/trims before `.includes("T")`, falling back to a 1970 timestamp (`merge-history.ts:10-23`). |
| R4-6 | Legacy-safe detection clobbers stored web mode | ✅ Fixed | Write now guarded by `storedMode === null` (`use-trading-wallet-mode.ts:79-86`). (The in-memory force-to-safe is intentional policy; but see 5.5 for a new regression in the same hook.) |
| R4-7 | Timestamp-less games never evicted | ✅ Fixed | Manager stamps `gameReceivedAt` on insert; eviction falls back to it (`sports-websocket-manager.ts:342,354-365`). |
| R4-8 | Relayer retry abort → 500 | ✅ Fixed | Retry wrapped in its own AbortError→504 guard; on retry failure the original 400 body is returned (`route.ts:317-360`). Nits: both attempts share one 30s budget; a non-abort `text()` failure can mismatch status/body. |
| R4-9 | Deep-offset positions request returns empty page | ✅ Fixed | Deep offsets now page upstream from the requested offset (`route.ts:273-275`). The fix introduced a regime-boundary wrinkle — see 5.16. |
| R4-10 | `scanCapped` false-positive on exact-multiple page | ❌ Not fixed | Unchanged (`route.ts:194-196`); still cosmetic — nothing consumes `scanCapped`. |
| R4-11 | League filter drops missing `leagueAbbreviation` | ❌ Not fixed | Unchanged (`use-sports-websocket.ts:211,218`). |
| R4-12 | Beacon-proxy derivation constants | ✅ Verified in-repo | New `relayer.test.mjs` pins the CREATE2 constants against a known deployed wallet (`0x82c1…ae13` for owner `0x78f3…95b8`) plus two preflight tests. An independent on-chain double-check before shipping deposits is still advisable. |
| R4-13 | Degraded policy duplicated card vs panel | ⚠️ Partial | Shared helpers now live in `setup-flow.ts:88-107` and both surfaces use `deriveTradingSetupApprovalStatus`/`isSetupApprovalReadKnown` — but the consecutive-degraded **trust-limit counter** is still sidepanel-only; the card preserves last-known-good indefinitely with no bound. |
| R4-14 | Double `getDeployed` preflight | ✅ Fixed | Single delegated preflight via `checkDeployed:true`; `deploySafeRelayerWallet` uses the shared helper, test-locked (`relayer-client.ts:429`, `relayer.ts:768-774`). |
| R4-15 | EIP-1193 classifier duplicated | ✅ Fixed | Both runtimes import `isEip1193UserRejectedError`/`isEip1193UnsupportedMethodError` from shared `trading-errors` (`wallet-switch.ts:1-18`, `bridge.ts:19-20`). The shared classifier itself is over-broad — see 5.13/5.20. |
| 3.3 | Deployed user downgraded on resolve throw | ✅ Fixed | `isDeployed:null` is now treated as unknown: gates fire only on `=== false` (`setup-gates.ts:39`), and `deriveCredentials`/`ensureReady` re-derive via `refreshBalance` when null (`trading-service.ts:641-642,702-703`). Cosmetic residue: state shows "connected" until the next action. |
| 3.8 | Real $0 REDEEM renders "Redeemed" | 🔵 Open (product call) | Unchanged; lost-ness still derives solely from the synthetic flag (`history-table.tsx:27-30`). |
| 3.4-f/u | Games map size-cap backstop | ✅ Closed | The `gameReceivedAt` fallback (R4-7) makes every entry TTL-evictable; growth bounded to the TTL window. |
| EFF-1–4 | Round-4 efficiency notes | ❌ Unchanged | Snapshot sweep+clone per call; sidepanel legacy-safe derive per call; sequential negRisk reads; redeemable chain on every request (now at least concurrent via `Promise.all`). |

## Test evidence

- **Extension suite: 313/314 — 1 failure caused by this diff.** The diff removed the "Browse trending" empty-state button from `ui.ts` but the committed `tests/content/notification-panel-css.test.ts:563` still asserts `data-knoww-browse-trending` → suite is red (see 5.15).
- **Web vitest: green.** The `node --test` failure (`landing-readability-static.test.mjs`, `hover:[animation-play-state:paused]`) is **pre-existing at HEAD** — neither the test nor `page.tsx` is touched by this diff. Out of scope, but it means `pnpm test` in apps/web is red on the branch either way.

## Correctness — new this round (verified)

### 5.1. First auto-wrap zeroes the onramp allowance → onboarded user thrown back into the setup wizard — HIGH (CONFIRMED)
- **Files:** `packages/shared-types/src/trading.ts:369-395`, `apps/extension/src/content/trading/setup-flow.ts:51-53,74-83`, `packages/shared-types/src/approvals.ts:474-481`
- **What:** `buildPusdAutoWrapTransactions` emits `approve(onramp, wrapAmountRaw)` then `wrap(wrapAmountRaw)` — the exact-amount approve **overwrites** the standing allowance and the wrap consumes it entirely, leaving `usdce:COLLATERAL_ONRAMP` at exactly **0 after every auto-wrap BUY**. That key is in `REQUIRED_TRADING_SETUP_APPROVAL_KEYS` with an `allowanceUsd > 0` threshold, and setup grants it finite (`DEFAULT_APPROVAL_AMOUNT = $100`, floored in `handleRelayerApprove`), unlike the maxUint256 exchange/adapter grants.
- **Failure:** BUY with wrap succeeds → `refreshBalance` reads allowance 0 on a **clean** read → `hasTradingApproval=false` with `allowanceReadStatus:'complete'` → `liveCompleteKnown=true` so the persisted latch **cannot** rescue (`setup-flow.ts:257`) → the card wizard replaces the order form at the "Approve" step and the sidepanel wipes the durable flag via `writeSetupComplete(addr,false)`. Recurs after every auto-wrap; hits any user holding USDC.e in the trading wallet. All of round 2–4's degraded-read hardening is bypassed because this read is *clean*.
- **Fix:** grant maxUint256 to the onramp like the other spenders, or exclude consumable allowances from the completeness gate (completeness should be keyed on operator/exchange approvals, not on spend-down allowances). Note `pusd:PUSD_CTF_APPROVAL_TARGET` is also finite/consumable — same class.

### 5.2. Rejected order-time approval leaves the card with no order form (state `error` unrenderable) — HIGH (CONFIRMED)
- **Files:** `apps/extension/src/content/trading/trading-service.ts:1045-1048`, `apps/extension/src/content/trading/trading-panel.ts:5337-5395`
- **What:** `approveUsdc`'s catch now sets `state:'error'`. For a fully-onboarded user (setupSurfaceMode `'complete'`) the render dispatch has **no branch** for `'error'` — not the wizard (mode complete), not the form (requires ready/placing/approving/splitting/merging).
- **Failure:** onboarded user rejects the order-form "Approve pUSD" top-up → re-render leaves header + portfolio bar + error toast, no order form. No recovery: panel reopen only resets when `!hasCredentials`, and `refreshBalance` never mutates `state` — dead until disconnect/switch/reload.
- **Fix:** map `'error'` to the order-form branch (form + inline error), or reset to `'ready'` after surfacing the error.

### 5.3. Provider `disconnect` event now force-logs-out the session (extends unfixed R4-4) — HIGH (CONFIRMED)
- **Files:** `apps/extension/src/page-bridge.ts` (new `subscribeToProviderEvents`), `apps/extension/src/content/trading/trading-service.ts:552-566`
- **What:** New in this diff: `provider.on("disconnect", () => postAccountsChanged(provider, []))`. Combined with the still-unfixed R4-4 (no locked/empty-list guard), a transient RPC/network drop (EIP-1193 code 1013) now takes the same path as account removal: `resetAfterDisconnect()` + `reset()` + `auth:logout`.
- **Fix:** on `disconnect`/empty `eth_accounts` while previously connected, re-query `eth_accounts` (or treat as "locked/offline — keep session"); only log out on explicit removal or a non-empty list excluding `ctx.address`. Fixing R4-4's handler fixes both triggers.

### 5.4. Transient legacy-safe probe failure runs sidepanel actions in deposit mode (and writes it back) — MED (CONFIRMED)
- **File:** `apps/extension/src/sidepanel.ts:429-453`
- **What:** `hasPortfolioLegacySafe` returns false on **any** failure (catch → false; `sendRuntimeMessage` never rejects), and `resolvePreferredPortfolioWalletMode` then persists the resolved mode back to `chrome.storage.local` **unguarded** (`if (preferredMode !== storedMode) writeStoredWalletMode(...)` — no `storedMode === null` guard, unlike the web R4-6 fix).
- **Failure:** the action coinciding with the blip executes with `walletMode:'deposit'` — a `KNOWW_PORTFOLIO_DEPOSIT` misdirects funds to the (empty) deposit wallet instead of the legacy Safe; sells/withdraws fail against a wallet with no positions. The stored value self-heals on the next successful probe, so the durable damage is bounded — the per-action misdirection is the defect.
- **Fix:** distinguish "probe failed" from "safe not deployed" (fail the action or fall back to stored `'safe'`), and guard the write-back like the web fix.

### 5.5. Web hook resolves a stored `safe` mode to `deposit`; RPC failure makes it stick for the session — MED (CONFIRMED)
- **Files:** `apps/web/src/hooks/use-trading-wallet-mode.ts:29-92`, `apps/web/src/lib/rpc.ts:238-243`
- **What:** `readStoredMode` now resolves through `resolvePreferredTradingWalletMode({legacySafeDeployed:false})`, which can never return `'safe'` — a legacy-Safe user starts every load/address-change in `'deposit'` until the async check lands (old code honored stored `'safe'` synchronously). Worse, `checkIsDeployed` **catches internally and returns false**, so an RPC outage flows through the success path and actively sets `'deposit'` for the whole session (the hook's own "leave mode unchanged" catch is nearly dead code).
- **Failure:** deterministic deposit-mode flash ($0 balance, wrong proxy derivation) on every load; under RPC failure a session-long wrong mode — spurious "Create Trading Vault" onboarding and deposits aimed at the deposit wallet. Order execution fails closed (collateral preflight), which caps the severity.
- **Fix:** honor stored `'safe'` synchronously again (it's only ever written for genuine legacy-safe users), and make `checkIsDeployed` failures distinguishable from "not deployed".

### 5.6. Sidepanel Approve/Enable are routed to the active tab, not the wallet-session tab — MED (CONFIRMED)
- **File:** `apps/extension/src/background.ts:1235-1258`
- **What:** `KNOWW_APPROVE_PORTFOLIO_TRADING` (and, by deliberate mirroring, `KNOWW_ENABLE_PORTFOLIO_TRADING`) use `forwardToResolvedContentTab` (active tab), while `KNOWW_PORTFOLIO_REAUTH` uses `resolvePortfolioSigningTabId` — whose own comment says signing "must be relayed *there* — not to whatever tab happens to be active."
- **Failure:** connect on tab A, switch to injected tab B, click Approve/Generate-API-keys in the sidepanel → the message lands on tab B whose per-tab `TradingService` has no `ctx.address` → spurious connect prompt on the wrong tab or "Connected wallet does not match portfolio wallet"; worst with WalletConnect sessions held on tab A.
- **Fix:** route both through `resolvePortfolioSigningTabId`.

### 5.7. Stale `isDeployed=false` in a content tab wedges the credentials step in a sidepanel loop — MED (CONFIRMED)
- **File:** `apps/extension/src/content/trading/trading-service.ts:641-652,702-711`
- **What:** `deriveCredentials`/`ensureReady` only refresh when `!proxyAddress || isDeployed === null`; a cached `false` (tab connected before the vault was deployed via the sidepanel) is never re-read, and **no message propagates deploy completion to content tabs**. The sidepanel's "Generate API keys" forwards to the sticky signing tab → `isTradingWalletDeploymentRequired` fires → aborts and re-opens the sidepanel → loop.
- **Mitigations found:** the floating panel's 10s refresh heals it, and the approve step (when taken) calls `refreshBalance` — the wedge bites when approvals already exist (e.g. prior web setup) or the user only uses the stream card.
- **Fix:** also refresh when `isDeployed === false` on these gates (deployment is monotonic), or broadcast a deploy-complete message to tabs.

### 5.8. Failed "Create vault" is completely silent — MED (CONFIRMED)
- **File:** `apps/extension/src/content/trading/trading-service.ts:1000-1006`
- **What:** `deployWallet`'s catch sets `state:'ready'` (not `'error'`); the wizard surfaces errors only when `state==='error'` and render returns before the toast for non-error states. The comment claiming "the next render surfaces it" is wrong for this path. (Contrast `approveUsdc`, which does set `'error'` — the asymmetry is the tell.)
- **Failure:** user rejects the deploy signature (or relayer fails) → wizard re-renders pristine with zero feedback.
- **Fix:** set `state:'error'` (then also fix 5.2's missing error branch so both paths render).

### 5.9. "Skip for now" leaves the in-page card body empty with no CTA — MED (CONFIRMED)
- **Files:** `apps/extension/src/content/trading/trading-panel.ts:5337-5395`, `setup-flow.ts:260`
- **What:** the sidepanel's "Skip for now" persists `knoww:setup-dismissed`, shared with the card; `resolveSetupSurfaceMode` then returns `'banner'` — a mode the card render **never handles**. For `{state:'connected', hasCredentials:false, mode:'banner'}` no branch matches and the old `addEnableTrading` fallback was deleted.
- **Failure:** card shows header + (empty) portfolio bar and nothing else; the only escape is the obscure Deposit→"Enable Trading" notice, which for an undeployed wallet just bounces back to the sidepanel.
- **Fix:** render an actual banner (compact "Finish setup" CTA) for mode `'banner'`.

### 5.10. No render branch for state `approving` → duplicate approval submissions — MED (CONFIRMED)
- **Files:** `apps/extension/src/content/trading/trading-service.ts:1017,1038-1042`, `trading-panel.ts:5337-5367,1699-1804`
- **What:** the wizard has loading branches for `'deploying'` and `'deriving-credentials'` but none for `'approving'`; the state-change re-render rebuilds a **clickable** Approve button (and resets the amount input) while the first signature is pending. No in-flight guard exists anywhere on the path. A second window exists post-success between `state:'ready'` and `refreshBalance` landing.
- **Failure:** double-click → two concurrent relayer approve flows / two signature prompts (financially idempotent, but confusing and state-mangling).
- **Fix:** add an `'approving'` loading branch (and/or an in-flight guard in `approveUsdc`).

### 5.11. Per-order approval floor removed → approve banner + extra tx on every wrap-needing BUY — MED (CONFIRMED)
- **Files:** `apps/web/src/components/trading/hooks/use-trading-form-state.ts:331-344`, `packages/shared-types/src/approvals.ts:161-186`, `apps/web/src/hooks/use-clob-client.ts:463-466`
- **What:** the `max(required, DEFAULT_TRADING_APPROVAL_RAW)` floor was removed from the banner path; `buildClobOrderApprovalTransactions` grants the USDC.e→onramp spender only the finite bucketed amount (pUSD spenders get maxUint256), which the auto-wrap consumes whole. `ensureV2Approvals` still floors at $100 but doesn't backstop the onramp key (its status check runs at the 1-raw threshold).
- **Failure:** deposit-funded users see the approve banner + an extra signature/tx before **every** wrap-needing BUY (was ~per-$100). Same allowance family as 5.1 — the web-side symptom.
- **Fix:** restore the floor (or grant the onramp maxUint256 like the pUSD spenders). Fixing 5.1's grant strategy resolves this too.

### 5.12. Lost-position close guard is a single slot → duplicate concurrent redeems — MED (CONFIRMED)
- **Files:** `apps/web/src/app/portfolio/page.tsx:200-225`, `history-table.tsx:221`
- **What:** `closingConditionId` blocks only a same-id re-click; clicking B while A is in flight steals the slot (A's button re-enables mid-flight), and A's unconditional `finally { setClosingConditionId(null) }` re-enables B mid-flight. Two concrete interleavings yield duplicate concurrent redeems. Contrast `handleRedeemPosition`'s correct per-id Set.
- **Impact bounded:** CTF redeem is idempotent (second pays 0) — cost is duplicate relayer txs, nonce contention, misleading spinners/toasts.
- **Fix:** reuse the `redeemingPositionIds` Set pattern.

### 5.13. Error mapper classifies the repo's own relayer proxy error as "you declined the wallet prompt" — MED (CONFIRMED)
- **Files:** `packages/shared-types/src/trading-errors.ts:63,81-92,136`, `apps/web/src/app/api/relayer/[...path]/route.ts:303`
- **What:** `isEip1193UserRejectedError` matches bare `denied`, `request rejected`, and `transaction signature` as substrings, and `mapTradingError` runs it **before** the CLOB/relayer branches. The proxy's own new create-failure body — `"Relayer create request rejected"` — matches `request rejected`, so a relayer-side create failure surfaces as "Signing cancelled. You declined the wallet prompt." A WAF 403 "Access denied" or a "transaction signature" CLOB error is likewise stolen from the correct branch.
- **Fix:** anchor the patterns (`user denied|user rejected|rejected the request`), require the EIP-1193 code when present, and/or run relayer/CLOB prefix branches first. Tests only lock in code-4001/4200 basics, so tightening is test-safe.

### 5.14. 90s of degraded reads after a successful approval reports "Approval didn't complete" — MED (CONFIRMED, UX)
- **File:** `apps/extension/src/sidepanel.ts:2249-2310`
- **What:** `hasPortfolioApproval` returns `null` on degraded reads; the poll treats null as falsy (correct to keep polling), but the terminal message conflates "couldn't verify" with "didn't complete", prompting a redundant re-approval. Self-heals once reads recover.
- **Fix:** track whether the window saw only nulls and emit "Couldn't verify approval status — refresh in a moment" instead.

### 5.15. Diff breaks a committed test and leaves orphaned copy ("Browse trending") — MED (CONFIRMED, merge-blocking CI)
- **Files:** `apps/extension/src/content/ui.ts:2437`, `apps/extension/tests/content/notification-panel-css.test.ts:563`
- **What:** the diff intentionally removed the "Browse trending" empty-state button (handler, analytics, doc comment all cleaned), but the committed test still asserts `data-knoww-browse-trending` → **extension suite is red (313/314)**. The empty-state copy still reads "…or browse trending markets" with no affordance left (and the collapsed stack shows no tabs).
- **Fix:** update the test, and reword the orphaned copy (or restore a compact affordance).

## Correctness — lower severity / latent

### 5.16. R4-9's fix created two pagination regimes that misalign at the boundary — LOW (CONFIRMED, latent)
- **File:** `apps/web/src/app/api/user/positions/route.ts:271-277`
- Shallow offsets slice the **merged** list (lost removed, redeemables merged, re-sorted); offsets past 450 (at limit 50) pass the raw offset to both upstream queries — different row spaces, so rows duplicate/vanish at the boundary, and deep pages get an empty `lostPositions` (raw offset applied to the short redeemable list). Latent: every caller uses `offset=0` today.

### 5.17. Relayer `/deployed` fallback may mark the vault deployed before code exists on-chain — MED (PLAUSIBLE)
- **File:** `apps/extension/src/background/trading-handler.ts:562-576`
- New fallback overrides the bytecode check with the relayer's answer; if `/deployed` is record-based (unverifiable from this repo), the deployment wait resolves early and the wizard advances to Approve against a code-less wallet. Worth one empirical check against the relayer.
- **Resolution update:** Closed by policy in the MED tail batch: Polymarket `/deployed` is trusted as authoritative for already-deployed/reconcile paths; bytecode-only polling is used only after fresh create submission to avoid premature UI advancement during normal deploy confirmation.

### 5.18. Stale MAIN-world page-bridge breaks Switch wallet until reload — MED (PLAUSIBLE)
- **Files:** `apps/extension/src/page-bridge.ts` (ALLOWED_METHODS + nonce), `bridge.ts:377`
- `wallet_requestPermissions` is newly allowed; after an extension update the old bridge persists (`__KNOWW_BRIDGE__` guard). Nonce-era stale bridges **drop** the request (24h-timeout hang); pre-nonce ones reject "Method not allowed…", which the unsupported-method classifier doesn't match → rethrow instead of the connect fallback.

### 5.19. Relayer create path now fails closed without builder HMAC — MED (PLAUSIBLE, deliberate)
- **File:** `apps/web/src/app/api/relayer/[...path]/route.ts:257-303`
- Confirmed intentional hardening (tests assert the relayer key must not be used or leaked for creates). Residual: an env with `POLY_RELAYER_API_KEY` but no `BUILDER_SIGNING_SERVER_URL`/`INTERNAL_AUTH_TOKEN` hard-breaks wallet creation with 503, and the generic body hides actionable upstream errors (server logs still carry them). **Deploy-config checklist item before ship.**
- Follow-on: the generic body "Relayer create request rejected" is what 5.13 misclassifies.

### 5.20. viem-wrapped -32002 classified as "method unsupported" in web wallet-switch — LOW (CONFIRMED)
- **Files:** `trading-errors.ts:75`, `apps/web/src/lib/wallet-switch.ts:17`
- viem rewrites -32002 to "Requested resource not available." which matches the bare `not available` pattern → wallet-menu falls back to the generic modal instead of pointing at the pending MetaMask popup. Extension path unaffected (raw message doesn't match).

### 5.21. Per-order approval path never grants the NegRiskAdapter ERC1155 approval — MED (PLAUSIBLE, narrow)
- **File:** `packages/shared-types/src/approvals.ts:126-158` vs `:351-358`
- `isClobOrderApproved`/`buildClobOrderApprovalTransactions` gate a neg-risk SELL on the exchange approval only, while `clobTradingApproved` requires the adapter too. The repo's own empirics treat exchange-only as sufficient for SELLs, and any BUY/full-setup self-heals to the full set — kept as PLAUSIBLE pending V2 server confirmation, reachable mainly for transferred-in tokens.

### 5.22. `planCtfOperationTransactions` ERC1155 preflight ignores `fallbackToApproval` — LOW (CONFIRMED, latent)
- **File:** `packages/shared-types/src/ctf.ts:352-368`
- The ERC20 path honors the flag (degrade to idempotent approval on read failure); the ERC1155 preflight rethrows. No live caller hits it today (the only `fallbackToApproval:true` caller plans `splitPosition`, which skips the preflight) — API inconsistency to fix before a merge/redeem caller opts in.

### 5.23. Just-redeemed lost position keeps an enabled Close button during Data-API lag — LOW (PLAUSIBLE)
- **File:** `apps/web/src/components/portfolio/merge-history.ts:67-72` + positions lag
- The synthetic lost row survives the documented 10–30s indexing window with an enabled button; a re-click submits a second redeem (0-payout no-op — wasted relayer tx + spurious success toast). The dedup's marginal effect is only hiding the real record's timestamp/hash during the window. Disable the button (or optimistically drop the row) after a successful close.

### 5.24. Approval poll can target the owner EOA after a double fault — LOW (PLAUSIBLE)
- **File:** `apps/extension/src/content/trading/portfolio-approval.ts:10-13`
- The `wallet.address || ownerAddress` fallback only misfires if `latestPortfolioData` is nulled mid-approve AND the fresh derive fails simultaneously (the approve UI can't render without a prior successful derive). For EOA mode the fallback is correct. Cleaner: return null on derive failure in non-EOA mode and show "couldn't verify".

### 5.25. `switchWallet` catch can restore a context the provider has moved past — LOW (PLAUSIBLE, narrow)
- **File:** `apps/extension/src/content/trading/trading-service.ts:596-633`
- The claimed "logged-out yet ready" branch is unreachable (everything after `clearPreviousWalletSession` is non-throwing). The surviving race: permissions granted (provider now on B) then `eth_requestAccounts` rejects → ctx restored to A while the provider selects B, and the mid-switch `accountsChanged` was swallowed by `walletSwitchInProgress` and never replayed. Self-heals on the next `getConnectedWalletAddress` poll.

### 5.26. Switch-wallet failure gives no feedback with a loaded portfolio; stale error leaks later — LOW (CONFIRMED)
- **File:** `apps/extension/src/sidepanel.ts:659-675`
- On failure the error is stored but only ever rendered by `renderPortfolioSignedOut`; with a portfolio loaded the spinner just stops. The stale message later surfaces via `loadPortfolio`'s no-session branch and `cancelPortfolioWalletConnect` (normal disconnect does clear it).

### 5.27. Stale `knoww_sidepanel_requested_view` hijacks the next toolbar open — LOW (CONFIRMED)
- **Files:** `apps/extension/src/background.ts:258-266,983`, `sidepanel.ts:6429-6434,3593-3603`
- The key is written on every open but only consumed at panel **boot**; the live-switch handler never clears it, so a later toolbar open lands on portfolio instead of markets (bounded to the browser session; arguably "remembers last view").

### 5.28. Sustained RPC outage leaves a returning credentialed user on a spinner — LOW (PLAUSIBLE, accepted tradeoff)
- **File:** `apps/extension/src/content/trading/trading-panel.ts:5340-5344`
- The round-1 #9 fix dropped `!hasCredentials` from the loading gate; under persistent resolve failure the card shows "Loading trading wallet…" instead of the form. Recovery exists (10s live refresh, header refresh, panel reopen) — worth a timeout/error state on the spinner, not a revert.

## Cleanup / altitude / efficiency (verified)

### 5.29. Three wallet-mode normalizers with divergent 'safe' semantics — altitude
`normalizeExtensionTradingWalletMode` (`setup-gates.ts:20`) coexists with shared `normalizeTradingWalletMode` (defaults safe) and `resolvePreferredTradingWalletMode` (defaults deposit; safe only when legacy-safe-deployed); `trading-service.ts` imports **both** normalizers, and the background SW imports one from the content layer. This family produced 5.4/5.5. One parameterized resolver in shared-types, consumed everywhere.

### 5.30. Degraded-latch policy split into two predicates with phase-dependent operators — altitude
`shouldPreserveDegradedSetupApproval` (`< limit`, pre-increment) vs `isSetupCompletionUnknownFromDegradedRead` (`<= limit`, post-increment) only agree because the counter increments exactly between the call sites (`setup-flow.ts:90-107`, `sidepanel.ts:3503-3516`); plus the un-latch guard carries a **dead conjunct** (`!isPortfolioSetupCompletionUnknown(data)` is tautological once `approvalReadStatus !== 'degraded'`, `sidepanel.ts:3526-3529`). One latch object (owns count, `record()`, `isTrusted()`) would collapse it — and would finish R4-13.

### 5.31. `waitForPortfolioApproval` hand-rolls the poll loop the same diff extracted — reuse
`sidepanel.ts:2244` duplicates `waitForPortfolioTradingWalletDeployment` (`portfolio-approval.ts:33`, injectable + 11 tests) minus its zero-delay/frozen-clock guards, with a dead try/catch (`hasPortfolioApproval` never throws). Extract `pollUntil(predicate, {timeoutMs, nextDelayMs, sleep})`.

### 5.32. Relayer deploy orchestration diverged per wallet type — altitude
`deployDepositWalletRelayerWallet` gained preflight **and** post-submit already-deployed reconciliation; `deploySafeRelayerWallet` has the preflight only (`relayer.ts:768,930`) — the relayer race just fixed for deposits will recur on the safe path. One `deployRelayerWallet({type})` with injected specifics.

### 5.33. Duplicated helpers — reuse
- `readAllowanceOrZero`/`readApprovalOrFalse` (`trading-handler.ts:623`) re-create the shared `fallbackRaw`/`fallbackApproved` options this diff removed; an `onFallback(key)` option would keep one error path and still yield `degradedKeys`.
- Four case-insensitive address comparators (`extension-session.ts:46`, `trading-service.ts:316`, `portfolio-approval.ts:25`, vs `sameAddress` in `bridge.ts:304`) with different trim/prefix handling — export one from shared-types.
- `writeStoredWalletMode` (`sidepanel.ts:417`) is a second, non-normalizing writer of the same chrome.storage key as `storeWalletMode` (`trading-service.ts:192`); currently safe (inputs pre-normalized, readers normalize) but a drift trap.
- The neg-risk "min(exchange, adapter) allowance" rule is hand-rolled in `use-clob-client.ts:444` and `setup-flow.ts:124` — extract to shared-types.
- `syncCardSetupStorage`'s address check is strictly weaker than its token check (`trading-panel.ts:476-489`) — keep the token only.
- `portfolioOwnerAddressValue` shadows `latestPortfolioData.ownerAddress` and goes stale in the `!address` branch (`sidepanel.ts:3483-3493`) — no reachable wrong-owner write (the surface re-renders first), but null it there or drop the shadow.

### 5.34. Efficiency (new this round)
- `fetchPortfolioData` added two serial await stages (approval fan-out, then open orders) after the parallel batch — both independent; `Promise.all` them (`sidepanel.ts:2754`).
- The deployment wait polls via full `resolvePortfolioWallet` (storage read + legacy-safe probe + derive) per attempt — ~2 bytecode reads + up to 2 relayer GETs × ~13 attempts where one deployment check of the known address would do (`sidepanel.ts:2226`).
- `handleDeriveProxyAddress`'s new relayer fallback fires a guaranteed-miss relayer GET on every legacy-safe existence probe for users without a safe (`trading-handler.ts:567`) — make it opt-in per message or cache deployed=true (monotonic).
- `broadcastEvent` runs the full eviction sweep (map walk + `Date.parse` per entry) on **every** websocket message (`sports-websocket-manager.ts:339`) — store parsed expiry on insert, sweep on a coarse timer.
- `loadPortfolio` awaits `readSetupDismissed` then `readSetupComplete` serially (`sidepanel.ts:3508`) — `Promise.all` (trading-panel already does).
- `ensureReady` can run the full refresh fan-out twice in one call when credential derivation sits between (`trading-service.ts:703,717`); also its `hasCreds && !ready` path returns false without re-gating after a successful pre-gate refresh — skip the tail when the pre-gate ran.
- `trading:wallet-connected` (a UI broadcast) matches the background's `trading:` catch-all and spins up the offscreen document to return "Unknown trading message type" (`background.ts:741,1859`) — once per SW session, pure waste; exclude broadcast types.
- The 34-line `log.info("buy_collateral.preflight", …)` block (24 fields, every bigint duplicated raw+formatted) fires on every BUY (`use-clob-client.ts:313-347`) — demote to debug / trim to decision outputs; the logger already stringifies bigints.

## Refuted this round (checked, not bugs)

- **setMode('deposit') divergence for legacy-safe users** — unreachable (the mode chips render only one option; `hasMultipleWalletModes` is always false with `SHOW_EOA_OPTION=false`) and inert (no reader of the raw stored value disagrees).
- **`eoa`→`deposit` coercion in the offscreen handler** — re-refuted (third round): `SHOW_EOA_OPTION` has been false since introduction, no shipped write path can store `'eoa'`, and both writers normalize.
- **`switchWallet` restoring a logged-out session as "ready"** — the post-logout throw branch is unreachable: `clearPreviousWalletSession` catches internally and every step of `applyConnectedWalletAccounts` is non-throwing (only the narrow pre-logout race in 5.25 survives).
- **Stale `portfolioOwnerAddressValue` writing dismissal for the previous owner** — the `!address` branch synchronously re-renders signed-out, removing the dismiss buttons before any click.
- **merge-history dedup enabling double-redeem** — causation corrected: the re-click hazard comes from Data-API lag (exists with or without the dedup); the dedup only hides the real record during the window (kept as 5.23 with that framing).
- **Raw MetaMask -32002 misclassified in the extension bridge** — the raw message matches no pattern; only viem's rewritten text collides (kept as 5.20, web-only).

## Out-of-scope heads-up (pre-existing, not this diff)

- `apps/web` `pnpm test` is red at HEAD independent of this diff: `landing-readability-static.test.mjs` expects `hover:[animation-play-state:paused]` in `page.tsx`, which is absent at HEAD.
- The sports manager's permanent give-up after `MAX_ATTEMPTS` and the pong-timeout reconnect bypassing backoff remain unchanged (flagged rounds 3–4).

## Round-5 blockers

1. **5.1** — auto-wrap zeroes the onramp allowance → recurring wizard takeover + durable latch wipe for onboarded users (clean-read path; bypasses all degraded-read hardening). Fixing the grant strategy also resolves **5.11**.
2. **5.2** — rejected order-time approval leaves the card with no order form (dead until disconnect/reload); fix alongside **5.8**/**5.10** — all three are missing `error`/`approving` handling in the card state machine.
3. **R4-4 (carried) + 5.3** — wallet lock **or** transient provider disconnect force-logs the user out; one guard in `handleExternalWalletAccountsChanged` fixes both triggers.
4. **5.4 + 5.5** — legacy-Safe wallet-mode resolution treats probe failure as "no safe": deposit-misdirection risk on both surfaces; same root cause (5.29's normalizer sprawl).
5. **5.15** — extension test suite is red (merge-blocking): update the browse-trending assertion and the orphaned copy.

Root-cause note: 5.1/5.11 expose a design flaw the degraded-read work couldn't see — the setup-completeness gate keys on **consumable** allowances. Completeness should be derived from operator/exchange approvals (non-depleting) or the onramp grant should be non-finite; anything else re-flips the gate on normal trading activity.

---

## Round-5 fix status (2026-07-02, all confirmed-MED items: 5.1–5.15 except 5.16+ lower-severity tail)

| # | Fix | Where |
|---|-----|-------|
| 5.1 | ✅ Consumable allowances (`usdce:onramp`, `pusd:PUSD_CTF`) removed from `REQUIRED_TRADING_SETUP_APPROVAL_KEYS` — completeness now keys only on non-depleting (maxUint256 / operator) approvals; degraded-key detection narrows consistently. Test: "consumed onramp/CTF allowances do not flip setup completion". | `setup-flow.ts:74`, `setup-flow.test.ts` |
| 5.2 | ✅ Form branch now matches `state === "error" && setupSurfaceMode === "complete"` — a rejected order-time approval keeps the order form + error toast instead of blanking the card. Source-locked in `trading-panel-ux.test.ts`. | `trading-panel.ts:5373` |
| 5.3 | ✅ `handleExternalWalletAccountsChanged` returns early on an empty account list (wallet locked / EIP-1193 `disconnect`) — session kept; disconnect only on a non-empty list excluding `ctx.address`. Covers both R4-4 triggers. Source-locked in `trading-panel-ux.test.ts`. | `trading-service.ts:555` |
| 5.4 | ✅ `hasPortfolioLegacySafe` returns `boolean \| null` (null = probe failed); an unknown probe honors the stored mode and skips the write-back — a transient blip can no longer run an action in deposit mode or clobber stored `safe`. Source-locked in `sidepanel-controls.test.ts`. | `sidepanel.ts:429-465` |
| 5.5 | ✅ Stored `safe` honored synchronously (`legacySafeDeployed: stored === "safe"` in `readStoredMode` and both event handlers), and `detectLegacySafe` treats stored `safe` as legacy-safe evidence so a swallowed `checkIsDeployed` failure can't downgrade the session to deposit mode. Tests added (4/4 green). | `use-trading-wallet-mode.ts` + test |
| 5.6 | ✅ New `forwardToPortfolioSigningTab` helper (resolves via `resolvePortfolioSigningTabId`, remembers the tab) now routes both `KNOWW_ENABLE_PORTFOLIO_TRADING` and `KNOWW_APPROVE_PORTFOLIO_TRADING` — wallet-signing prompts land on the tab holding the wallet session, matching the reauth path. Source-locked. | `background.ts` |
| 5.7 | ✅ Both deployment gates re-read when `isDeployed !== true` (was `=== null`): a stale cached `false` — a vault deployed via the sidepanel wizard, which never notifies content tabs — is re-read before `isTradingWalletDeploymentRequired` can bounce the action back to the sidepanel. Deployment is monotonic, so the re-check is always safe. Source-locked. | `trading-service.ts` (deriveCredentials + ensureReady) |
| 5.9 | ✅ New `addSetupBanner` renders for `setupSurfaceMode === "banner"` as the render dispatch's fallback branch — a dismissed-but-incomplete card now shows "Finish setting up trading" + a Resume-setup button (clears the shared `knoww:setup-dismissed` and re-renders the wizard) instead of an empty body. Placed after the form branch so ready-state users still get the order form. | `trading-panel.ts` |
| 5.10 | ✅ Three layers: a wizard loading branch for `state === "approving" && setupSurfaceMode !== "complete"` (re-render can no longer rebuild a clickable Approve mid-signature); an in-flight guard at the top of `approveUsdc`; and the success path now runs `refreshBalance()` **before** flipping to `"ready"`, closing the post-success window where the stale allowance re-rendered a clickable Approve. Source-locked. | `trading-panel.ts`, `trading-service.ts` |
| 5.12 | ✅ `closingConditionId` single slot replaced with a per-id `ReadonlySet<string>` (mirrors `redeemingPositionIds`): guard, add-on-start, delete-own-id-in-finally; `HistoryTable` takes `closingPositionIds` and derives `isClosing` per row — neither of the two duplicate-redeem interleavings survives. | `portfolio/page.tsx`, `history-table.tsx` |
| 5.13 | ✅ User-rejection classifier tightened to user-anchored patterns (`user rejected \| rejected the request \| user denied \| user cancel`); bare `denied` / `request rejected` / `transaction signature` removed from both `isEip1193UserRejectedError` and `isWalletRejectionError` — the proxy's "Relayer create request rejected", WAF "Access denied", and CLOB "invalid transaction signature" now reach their real branches; MetaMask's classic "User denied transaction signature." still classifies. Tests added in shared-types + extension error-mapping. | `trading-errors.ts:58-98` |
| 5.14 | ✅ `waitForPortfolioApproval` returns a tri-state (`approved`/`not-approved`/`unverified`) tracking whether any read was clean; a window of only degraded/null reads now surfaces "Couldn't verify the approval yet — it may still be confirming" instead of the redundant-re-approval-prompting "Approval didn't complete". Source-locked. | `sidepanel.ts:2256-2290` |
| 5.8 | ✅ `deployWallet`'s catch now sets `state: "error"` (was `"ready"` — a lie, the vault isn't deployed, and the wizard only renders errors for `"error"`), so a rejected Create-vault signature shows the inline wizard error + toast; the next click resets to `"deploying"`. The identical-looking `"ready"` catches in `placeOrder`/`splitPosition`/`mergePositions` are intentionally untouched (those users are fully onboarded and `"ready"` keeps the form usable). Regression test locks the catch state. | `trading-service.ts:1005-1015`, `trading-panel-ux.test.ts` |
| 5.11 | ✅ Fixed at the root instead of restoring the floor (which would **not** have stopped the recurrence — every auto-wrap overwrites the standing onramp allowance with an exact self-approve and consumes it to 0). Since no wrap path needs a standing allowance (web, extension, and agent all execute the self-approving `buildPusdAutoWrapTransactions` batch), the requirement was removed everywhere: `isClobOrderApproved` no longer gates BUYs on `usdcOnramp` (`requireAutoWrap` removed from `ClobOrderApprovalRequirement`), `buildClobOrderApprovalTransactions` no longer grants the per-order onramp allowance (its `approvalAmountRaw` param dropped), and `allApproved` excludes `autoWrapApproved` — which also stops `ensureV2Approvals` and the web onboarding/trading contexts (`setHasUsdcApproval(status.allApproved)`) from re-flipping after every wrap-funded BUY (the web analog of 5.1). Setup's finite onramp grant in `buildTradingApprovalTransactions` is left as-is (harmless). Tests rewritten to lock the new semantics. | `approvals.ts:126-186,370`, `use-trading-form-state.ts:385,414`, `use-clob-client.ts:455,911`, `use-relayer-client.ts:289`, `approvals.test.mjs` |
| 5.15 | ✅ Test updated to lock the *removal* of the Browse-trending CTA (asserts absent); orphaned empty-state copy now points to the sidebar. | `ui.ts:2437`, `notification-panel-css.test.ts:562-567` |

Verification: extension 42 files / **326 passed** (was 313 passed + 1 failed) + `tsc --noEmit` clean; web vitest 59 files / **271 passed** + `tsc --noEmit` clean; shared-types `approvals.test.mjs` + `trading-errors.test.mjs` 6/6. (The web `node --test` landing failure remains — pre-existing at HEAD, out of scope.)

**All 15 confirmed round-5 correctness findings (5.1–5.15) are now fixed.** Remaining open at this point: the lower-severity/latent tail (5.16–5.28 — with 5.17 later closed by policy and 5.19 retained as a deploy-config checklist entry), and the carried-over R4-10/R4-11/3.8.

---

## Round-5 cleanup batch (2026-07-03, items 5.29–5.34 + R4-13 finish)

| # | Fix | Where |
|---|-----|-------|
| 5.29 | ✅ `normalizeExtensionTradingWalletMode` now delegates to the shared `resolvePreferredTradingWalletMode` (stored `safe` = legacy-safe evidence) — the EOA gating and deposit default have exactly one definition. The `trading-service` "both normalizers" mix was already gone; layering (SW importing from content) left as-is. | `setup-gates.ts:20` |
| 5.30 | ✅ The two phase-dependent predicates (`<` pre-increment / `<=` post-increment) collapsed into one inclusive-count `isWithinDegradedSetupTrustWindow`; the preserve decision passes `counter + 1`; the un-latch guard's tautological `!isPortfolioSetupCompletionUnknown` conjunct removed. Tests updated. | `setup-flow.ts:88-118`, `sidepanel.ts` |
| R4-13 | ✅ **Finished:** the card now has the same bounded degraded trust as the side panel — `refreshBalance` counts consecutive degraded reads via the shared window; past the limit it applies the degraded read as authoritative (read status reported "complete" so the surface resolver stops trusting the persisted latch), resetting on any clean read or `reset()`. | `trading-service.ts:138,841-870` |
| 5.31 | ✅ Generic `pollUntil(check, {timeoutMs, nextDelayMs, sleep, now})` extracted (owns the deadline + zero-delay/frozen-clock guards); the deployment waiter and the sidepanel approval wait are now thin predicates on it — no hand-rolled poll loops left. | `portfolio-approval.ts`, `sidepanel.ts` |
| 5.32 | ✅ `submitRelayerWalletCreate` owns the already-deployed submit-race reconcile for BOTH wallet types — the safe path now recovers from a concurrent-deploy rejection exactly like the deposit path (behavioral test added: 5/5). | `relayer.ts` |
| 5.33 | ✅ `sameAddress` exported from shared bridge and used by all three extension comparators; `readAllowanceOrZero/readApprovalOrFalse` ride the shared `fallbackRaw/fallbackApproved` + new `onFallback` option (degraded keys still recorded — test updated to lock the pairing); `writeStoredWalletMode` normalizes on write; the min(exchange, adapter) rule consolidated into shared `readClobOrderPusdAllowance` used by web `ensureV2Approvals`, `handleGetAllowance`, and the order preflight; `syncCardSetupStorage` keeps only the (strictly stronger) token guard; `portfolioOwnerAddressValue` nulled in the sign-out branch. | shared-types, extension, web |
| 5.34 | ✅ Efficiency: `fetchPortfolioData` runs approval + open-orders inside the single concurrent batch (was 3 serial stages); `loadPortfolio` storage reads via `Promise.all`; the deployment wait polls a narrow known-mode deployment check (was the full wallet-resolve fan-out ×13 attempts); the legacy-safe probe opts out of the relayer `getDeployed` fallback (`skipRelayerDeploymentFallback`, was a guaranteed-miss round-trip per probe); `trading:wallet-connected`/broadcast types excluded from the offscreen forward; sports eviction sweep gated to once/minute (backwards-clock safe); `ensureReady` skips the duplicate refresh and promotes a lagging state label to "ready" for a fully-set-up user; the 35-line per-BUY `log.info` preflight block trimmed to a compact `log.debug`. `readClobOrderPusdAllowance` also parallelizes the neg-risk reads (closes EFF-3). | sidepanel, trading-handler, background, sports manager, use-clob-client |

Verification: extension 42 files / **326 passed** + `tsc --noEmit` clean; web 59 files / **271 passed** + `tsc --noEmit` clean; shared-types node tests **60/60** (incl. new safe-deploy reconcile test). Still open after this batch: 5.16–5.28 tail, R4-10/R4-11, 3.8, and the residual efficiency notes (snapshot map clone per call, per-call legacy-safe derive in `resolvePreferredPortfolioWalletMode`, redeemable chain per positions request).

## Round-5 MED tail batch (2026-07-03, items 5.17/5.18/5.21 — tests written first)

| # | Fix | Where |
|---|-----|-------|
| 5.17 | ✅ **Closed by policy:** Polymarket `/deployed` is trusted as authoritative for already-deployed/reconcile paths; bytecode-only polling is used only after fresh create submission to avoid premature UI advancement during normal deploy confirmation. The lenient fallback stays for general resolves (existing wallets, transient RPC misses), and the card path remains safe because the deploy handler polls to `STATE_MINED`/`STATE_CONFIRMED` unless the relayer reports the wallet as already deployed. | `sidepanel.ts` (`deployPortfolioTradingWallet`) |
| 5.18 | ✅ Three layers: (a) `injectMetamaskBridge` replaces a bridge tag left by a previous content-script incarnation (detected by `__KNOWW_BRIDGE_NONCE__` unset in this isolated world) instead of deferring to it; (b) the page-bridge takeover guard is keyed by injection nonce (`takeoverKey = BRIDGE_NONCE ?? true`) so a re-injected bridge installs alongside a stale one, which goes inert (drops mismatched-nonce messages); (c) `isEip1193UnsupportedMethodError` now matches the repo's own bridge allowlist rejection "Method not allowed: …", so a stale pre-nonce bridge's rejection of `wallet_requestPermissions` takes `switchWallet`'s connect fallback instead of rethrowing. Known residual: a pre-nonce stale bridge can double-handle allowlisted requests during takeover (unstamped responses are dropped; wallets coalesce duplicate prompts). | `styles.ts`, `page-bridge.ts`, `trading-errors.ts` |
| 5.21 | ✅ The per-order path now applies the same neg-risk operator rule as `clobTradingApproved`: `isClobOrderApproved` requires `ctfNegRiskExchangeApproval && ctfNegRiskAdapterApproval` for a neg-risk SELL, and `buildClobOrderApprovalTransactions` grants whichever of the two `setApprovalForAll`s is missing. Non-neg-risk SELL unchanged. Self-heals transferred-in-token wallets that never ran full setup. | `approvals.ts:130-186` |
| 5.19 | ✅ **Closed as intended behavior (owner decision, 2026-07-03: expected behavior, do not change).** The create path stays fail-closed: builder-HMAC only, no relayer-key fallback, 503 when signing auth is unavailable. Future rounds must not re-flag this. Ops note stands: a web deploy with `POLY_RELAYER_API_KEY` but no `BUILDER_SIGNING_SERVER_URL`/`INTERNAL_AUTH_TOKEN` hard-breaks wallet creation with 503 — verify both env pairs (web server env, not the extension) before ship. | `route.ts:248-258` (no change) |

Tests written first (verified failing before the fixes): shared-types — neg-risk SELL readiness + scoped-grant tests (`approvals.test.mjs`), bridge-allowlist-rejection classifier test (`trading-errors.test.mjs`); extension — `page-bridge-takeover.test.ts` (nonce-keyed takeover guard, stale-tag replacement, switchWallet fallback shape) and the bytecode-only deployment-wait assert in `sidepanel-controls.test.ts`.

Verification: shared-types **63/63** (60 + 3 new); extension 43 files / **330 passed** (326 + 4 new) + `tsc --noEmit` clean; web 59 files / **271 passed** + `tsc --noEmit` clean. Still open: LOW tail 5.16/5.20/5.22–5.28, R4-10/R4-11, 3.8 (product call), and the residual efficiency notes. 5.19 closed as intended behavior (ops env-check note retained above).

## Round-5 LOW tail batch (2026-07-03, items 5.16/5.20/5.22–5.28 + R4-10/R4-11 — tests written first)

| # | Fix | Where |
|---|-----|-------|
| 5.16 | ✅ The dual pagination regime is gone: every offset now slices the **merged** row space. Deep offsets extend the top scan (dynamic `maxScanPages` up to `POSITIONS_UPSTREAM_ABSOLUTE_MAX_PAGES = 10`, i.e. 1000 rows); past the ceiling the route ends pagination explicitly (`positions: []`, `hasMore: false`, `scanCapped: true`, no upstream call) instead of serving raw-offset rows that duplicate/skip at the boundary. | `positions/route.ts` |
| R4-10 | ✅ `scanCapped` is now probe-verified: after a capped scan, one extra page fetch checks whether rows actually remain; an exact-multiple total clears the flag (probe failure keeps the conservative "capped"). | `positions/route.ts` (`fetchPolymarketPositions`) |
| 5.20 | ✅ `isEip1193UnsupportedMethodError` returns false for code `-32002` and the bare `not available` pattern is method-anchored (`method not available`); new shared `isEip1193PendingRequestError` (-32002 / "already pending" / viem's "resource not available" rewrite); `requestEoaWalletSwitch` treats pending as "switcher already open" (returns true) so the generic modal no longer stacks on the pending MetaMask popup. | `trading-errors.ts`, `wallet-switch.ts` |
| 5.22 | ✅ The ERC-1155 preflight in `planCtfOperationTransactions` honors `fallbackToApproval` exactly like the ERC20 collateral path: a failed read with the flag plans the idempotent `setApprovalForAll` instead of rethrowing; without the flag it still fails closed. | `ctf.ts:352-372` |
| 5.23 | ✅ `closedConditionIds` (session-scoped) marks successfully redeemed conditions; `HistoryTable` gained `closedPositionIds` and keeps Close disabled through the Data-API indexing window — no duplicate 0-payout redeem from a re-click on the surviving synthetic row. | `portfolio/page.tsx`, `history-table.tsx` |
| 5.24 | ✅ `resolvePortfolioApprovalPollAddress` is mode-aware: owner fallback only in EOA mode; in safe/deposit mode a missing **or owner-equal** resolved address (the resolver's own EOA fallback leaking through) or a resolver throw returns null, and the caller maps null to the "couldn't verify" outcome instead of polling the wrong account and claiming rejection. | `portfolio-approval.ts`, `sidepanel.ts` |
| 5.25 | ✅ accountsChanged events swallowed during a deliberate switch are buffered (`pendingAccountsChangedDuringSwitch`) and replayed in `switchWallet`'s `finally` — a failed switch reconciles immediately with the provider's actual account (same policy as the next wallet poll) instead of stranding ctx until it. On success the replay is a no-op (address matches). | `trading-service.ts` |
| 5.26 | ✅ Switch-wallet failure with a loaded portfolio renders through `portfolioTradingError` + `loadPortfolio(true)` (visible error line); the signed-out channel (`portfolioConnectError`) is only set on the branch that renders it immediately, so the stale message can no longer leak into a later signed-out render. | `sidepanel.ts` (`switchPortfolioWallet`) |
| 5.27 | ✅ The live `KNOWW_SHOW_EXTENSION_SIDEPANEL_VIEW` handler now also consumes (removes) the persisted `knoww_sidepanel_requested_view` key — the boot path already removed it after reading — so a leftover value can't hijack the next toolbar open. | `sidepanel.ts` |
| 5.28 | ✅ The "Loading trading wallet…" spinner (isDeployed unknown) is bounded: `WALLET_RESOLVE_SPINNER_TIMEOUT_MS = 15s`, with a self-scheduled deadline re-render, then flips to an inline "Couldn't load your trading wallet" error with a Retry button (re-runs `refreshBalance`). Deadline resets when resolution settles or on disconnect. | `trading-panel.ts` |
| R4-11 | ✅ League-filtered sports views recover membership for feed rows missing `leagueAbbreviation` via the slug's league prefix (`gameMatchesLeagues`, e.g. "nba-lal-bos-…"); rows with neither field stay excluded. | `use-sports-websocket.ts` |

Tests written first (verified failing before the fixes): web — 3 new route tests (probe-cleared `scanCapped`, merged-space deep slice, explicit ceiling; 1 stale source-assert updated to the single-regime invariant), pending-prompt wallet-switch test, league-fallback hook test, disabled-Close component test + page wiring assert; shared-types — pending-classifier test, 2 ERC-1155 fallback tests; extension — mode-aware poll-address tests (1 updated, 1 added), switch-failure/unverified-mapping/view-key-consume sidepanel tests, buffered-replay + spinner-timeout panel tests (1 updated to the buffer invariant).

Verification: shared-types **66/66**; extension 43 files / **336 passed** + `tsc --noEmit` clean; web 59 files / **278 passed** + `tsc --noEmit` clean. Round-5 correctness ledger is now fully closed except: 3.8 (product call), the 5.19 env checklist (non-code), and the documented residual efficiency notes. 5.17 is closed by policy: Polymarket `/deployed` is trusted as authoritative for already-deployed/reconcile paths.

## Post-round-5 field bug: deployed Safe misclassified after wallet switch + sidepanel session desync (fixed 2026-07-03, tests first)

Report: after switching accounts, an already-deployed Safe showed "Create trading vault" on the card, and the side panel showed "Connect a wallet" next to a connected card (recovering only via "Find Wallets"). Extends 3.3/5.7/5.17/5.6.

| Root cause | Fix |
|---|---|
| `readTradingWalletBalance` mapped a **failed** `getBytecode` onto `undefined` — the same value viem returns for a successful no-code read — so every RPC hiccup surfaced as `isDeployed: false`. | Read success tracked separately; `isDeployed` is **omitted** when the read failed, so failed ≠ not-deployed and downstream `??` guards actually work. Behavioral test distinguishes failed/empty/deployed. (`balances.ts`) |
| `resolveTradingWallet` hard-defaulted `balData.isDeployed ?? false` on the exact path that runs after a switch, and threw away the derive handler's relayer-backed answer; `resolveExistingSafeWallet` treated a failed probe as "no legacy safe". | New `ProxyWallet.resolveDeployment` exposes the derive handler's `isDeployed` (bytecode + relayer `/deployed` fallback — the 5.17-hardened path) as the deployment authority: `derived.isDeployed ?? balData.isDeployed ?? null`; unknown stays `null` (bounded loading via the 5.28 timeout, never "Create vault"). Legacy-safe detection decides via the same authority. (`proxy-wallet.ts`, `trading-service.ts`) |
| `refreshBalance`'s `balData.isDeployed ?? ctx.isDeployed` guard was dead (the handler always returned a boolean), so a 10s refresh could downgrade `true → false` mid-session. | Monotonic guard: `ctx.isDeployed === true` never downgrades from a bytecode-only read (deployment can't revert on-chain; ctx resets on account switch, so no cross-account bleed). (`trading-service.ts`) |
| `KNOWW_GET_PORTFOLIO_CONNECTED_WALLET` routed via `resolveContentTargetTabId` (active tab) — 5.6 fixed only Approve/Enable — and the SW never learned the session tab from a **card-side** connect, so the side panel queried session-less tabs and rendered "Connect a wallet". | Lookup routed via `resolvePortfolioSigningTabId` (active-tab fallback inside the resolver; success-latch kept), and the SW latches `portfolioSigningTabId` from the `trading:wallet-connected` broadcast's sender tab. (`background.ts`) |

Residual (accepted): `portfolioSigningTabId` is a SW-module variable and does not survive service-worker restarts; the lookup then falls back to the active tab (pre-existing 5.6 behavior). Persisting it in `chrome.storage.session` is a possible follow-up.

Verification: shared-types **68/68** (+2 balances tests); extension 43 files / **338 passed** (+2: deployment-authority invariants, lookup routing + broadcast latch) + `tsc --noEmit` clean; web 59 files / **278 passed** + `tsc --noEmit` clean.

## QA round: call sites left behind by the shared approval-model upgrades (fixed 2026-07-04, tests first)

Two P1s from QA, both verified real — cross-file misses from this round's shared-model changes (the neg-risk SELL operator-pair rule in `approvals.ts` and the ERC-1155 preflight in `planCtfOperationTransactions`):

| # | Issue | Fix |
|---|---|---|
| QA-1 | Web `ensureSellCtfApproval` read a **single** ERC-1155 operator (`getPusdExchangeApprovalSpender(negRisk)`) and returned as soon as it was approved — but the shared model requires the neg-risk exchange **and** adapter pair for neg-risk SELLs, and the SELL path never reaches `ensureV2Approvals` (BUY-only). A wallet with exchange approved / adapter missing posted and got CLOB's generic balance/allowance rejection. The form's UI gate uses the shared model but is 30s-stale — this preflight is the self-healing last line. | Gate on `checkAllApprovals` + `isClobOrderApproved({side: "SELL", negRisk})`; repair via the scoped path — `approveUsdcForTrading(undefined, {approvalScope})` → `buildClobOrderApprovalTransactions` SELL branch (grants only the missing operators). Orphaned single-operator imports removed. (`use-clob-client.ts`) |
| QA-2 | Extension `handleMergePositions` still used the sync `planCtfOperationTransaction` (no approval planning) and submitted only the merge tx. The merge targets the CTF collateral adapter, which needs ERC-1155 operator approval to pull YES/NO tokens — wallets missing it (older/partial onboarding) reverted on-chain instead of getting the approval batched in. Split and all three web CTF ops had already migrated. | Mirrors split: `await planCtfOperationTransactions({..., client: publicClient, collateralOwner, fallbackToApproval: true})`, executes `plan.approvalTransaction` first when present. Singular planner import removed (source test locks it out of the whole handler). (`background/trading-handler.ts`) |

Tests written first (verified failing): web — 3 behavioral SELL tests (neg-risk adapter-missing → scoped repair before post; fully-approved neg-risk → no repair; standard exchange-missing → scoped repair) in `use-clob-client.test.tsx` (+ `fullyApprovedStatus()` helper extracted); extension — 3 source tests (`trading-handler-ctf-approvals.test.ts`): merge uses the plural planner with client/owner/fallback, approval executes before the merge tx, singular planner absent from the handler.

Verification: extension 44 files / **341 passed** + `tsc --noEmit` clean; web 59 files / **281 passed** + `tsc --noEmit` clean.
