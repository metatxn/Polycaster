# Extension Canonical Funding State Machine — Design

**Date:** 2026-07-10
**Status:** Approved (pending user spec review)
**Scope decision:** Funding unification first; content-script lazy-loading is a separate follow-up project.

## Problem

The extension implements the deposit/withdraw ("funding") flow twice, with different
state, different rendering, and — critically — different money-movement mechanisms:

- `apps/extension/src/sidepanel.ts` (6,576 lines) runs deposits/withdrawals through the
  background viem path (`KNOWW_PORTFOLIO_DEPOSIT` / `KNOWW_PORTFOLIO_WITHDRAW` →
  `executePortfolioDeposit` / `executePortfolioWithdraw`) and is protected by the
  portfolio-fund idempotency coordinator (persisted intent keys, `PENDING_RECONCILIATION`).
- `apps/extension/src/content/trading/trading-panel.ts` (5,776 lines) implements its own
  deposit wizard (`depositStep`: `method → token | bridge-select → amount → confirm`,
  ~14 module-level state variables) and moves money via **content-side**
  `WalletBridge.sendTransaction` (`executeDeposit`, line ~4104). That path:
  - bypasses the idempotency coordinator entirely (duplicate submissions possible), and
  - violates the project rule that deposits use the background viem path (raw
    content-side `eth_sendTransaction` triggers MetaMask "likely to fail / network fee
    unavailable" warnings).

Every funding fix must currently be discovered and applied twice; the finding-8
idempotency fix landed only on the sidepanel path, which is how this gap was found.

## Goals

1. One canonical, pure funding state machine used by both surfaces.
2. All funding money movement goes through the background path with idempotency intents.
3. Delete the trading-panel's content-side deposit execution.
4. Both large files shrink; funding logic becomes independently unit-testable.

**Non-goals:** unifying rendering (each surface keeps its renderer); unifying read
transports (token/asset list fetching stays surface-local behind the gateway); the
content-script lazy-loading/dispatcher work (separate project); any withdraw UI in the
trading panel (machine supports withdraw; only sidepanel renders it today).

**UX policy:** light normalization is acceptable — where the two surfaces disagree on
step order, labels, or error treatment, converge on the better of the two. No layout
rewrites. But the deposit flow should be consistent and in same order across both surfaces.

## Architecture

```
apps/extension/src/funding/
  machine.ts      — FundingState union, FundingEvent union, pure reducer
  controller.ts   — effect runner; owns idempotency intent lifecycle
  gateway.ts      — FundingGateway interface + per-surface implementations
  index.ts        — public exports
apps/extension/tests/funding/
  machine.test.ts
  controller.test.ts
```

`src/funding/` lives outside `src/content/` because both webpack entries
(`content`, `sidepanel`) import it.

### machine.ts — pure state machine

Elm-style: `reduce(state, event) → [nextState, Effect[]]`. No DOM, no `chrome.*`,
no timers — effects are plain data descriptors executed by the controller.

States (discriminated union on `step`, with `flow: "deposit" | "withdraw"`):

```
deposit (wallet method — executable):
          idle → method → select-token
          → amount (quote preview when the resolved route requires conversion)
          → confirm → submitting → confirming (phase: on-chain → bridge-credit)
          → done | error
deposit (bridge method — passive, never executes):
          idle → method → select-bridge-asset (searchable)
          → bridge-address-ready (copyable deposit address, minCheckoutUsd
            notice; terminal apart from BACK/RESET — no amount, no SUBMIT,
            no `execute` effect ever emitted from this branch)
withdraw: idle → amount+destination → quote → confirm → submitting
          → confirming (status polling) → done | error
```

The passive bridge branch mirrors today's panel behavior exactly: the user
copies an address and sends funds externally; the extension never signs. If
bridge-address deposits are ever monitored for credit, that polling gets its own
non-executable effect specified separately — it must not share the executable
deposit's confirmation states.

The canonical step order above applies to both surfaces (per UX policy: the
deposit flow must be consistent and in the same order everywhere). A surface
that offers only one method skips `method` and starts at its selection step.

Events: `START`, `SELECT_METHOD`, `SELECT_TOKEN`, `SELECT_BRIDGE_ASSET`,
`SET_AMOUNT`, `SET_QUERY`, `SET_DESTINATION`, `BACK`, `SUBMIT`, `RETRY`, `RESET`,
plus effect-result events (`TOKENS_LOADED`, `ASSETS_LOADED`, `QUOTE_OK`,
`QUOTE_FAILED`, `EXECUTED`, `EXECUTION_FAILED`, `CONFIRMED`, `CREDITED`,
`STATUS_UPDATE`). Every effect-result event carries the `attemptId`/`effectId`
it belongs to (see "Effect correlation" below).

Effects: `loadTokens`, `loadBridgeAssets`, `fetchQuote`, `execute`,
`pollWithdrawStatus`, `awaitDepositCredit`.

Reducer-owned invariants (unit-tested):

- `SUBMIT` while `submitting`/`confirming` is a no-op (renderer-independent
  double-click protection, on top of the coordinator).
- **Effect correlation:** the reducer stamps each attempt with an `attemptId` and
  each emitted effect with an `effectId`; any effect-result event whose IDs do not
  match the active attempt/effect is dropped. This generalizes the stale-quote
  guard to *all* async results (token loads, asset loads, execution responses,
  receipt waits, credit checks, status updates) across `RESET`, retry, account or
  wallet-mode change, and renderer remount.
- `BACK` navigation rules per step; `BACK` is disabled once `submitting`.
- Amount validation is decimal-string based (`normalizeCtfPusdAmount`-style); no
  JavaScript floating-point arithmetic anywhere in the machine — all comparisons,
  conversions, and fingerprint inputs use Decimal.js on decimal strings or raw
  base-unit strings (constructing `Decimal` from an already-narrowed `number`
  does not recover precision and is prohibited).
- Minimum checkout (bridge `minCheckoutUsd`) and over-balance checks gate `confirm`.
- The passive bridge branch can never reach `submitting` (no reachable
  transition; asserted in tests).

### controller.ts — effects + attempt lifecycle

`createFundingController(gateway, dispatchRender)`:

- Executes effect descriptors via the gateway; feeds results back as events
  stamped with their `attemptId`/`effectId`.
- Exposes `dispose()`: cancels timers, aborts in-flight reads where supported,
  and guarantees no event is dispatched after disposal (renderer unmount safety).
- Timers (quote debounce, status polling backoff) live here, not in the machine.

**Attempt lifecycle — background-owned.** Funding attempts are allocated, persisted,
and resolved by the background worker, not by per-surface key managers. Rationale
(verified): the current `createPortfolioFundIntentKeyManager` is constructed in the
sidepanel with `navigator.locks` and `sessionStorage`, both of which are
context-scoped — in a content script, `sessionStorage` belongs to the host page
(wrong domain and a data-leak surface) and Web Locks do not span the
chrome-extension and page origins. The background service worker is the only
single-threaded authority both surfaces already talk to, and its
portfolio-fund-idempotency coordinator already dedupes by key and by fingerprint.

Concretely:

- A `begin-attempt` background message (new, thin) takes the normalized command,
  computes the fingerprint, and returns either a fresh attempt
  (`{ attemptId, idempotencyKey }`) or the existing attempt for that fingerprint
  — including any recorded execution result (transaction hash, confirmation
  phase) so a surface can **resume confirmation instead of re-executing**.
- The attempt record persists (chrome.storage.local, background-owned) the
  attempt ID, idempotency key, fingerprint, execution result incl. transaction
  hash, and confirmation phase.
- An attempt completes (key retired) only on a **deterministic terminal
  outcome**: credited/confirmed success, or a confirmed on-chain revert. Ambiguous
  outcomes — timeout after submission, controller/tab reload before receipt,
  status-poll failure — retain the attempt; `RETRY` reuses the same key, and the
  background coordinator replays the recorded result so confirmation resumes.
- A new key is allocated only after a terminal outcome, and a post-revert retry
  requires an explicit user action to start a new transfer.
- `IDEMPOTENCY_FINGERPRINT_MISMATCH` **fails closed**: surfaced as a
  non-retryable error state (it indicates a bug or storage corruption); the
  controller never silently regenerates a key.
- `PENDING_RECONCILIATION` → dedicated error state; both renderers show the
  "a previous attempt may still be processing" treatment; no auto-retry.

Cross-surface at-most-once therefore has two layers: the background coordinator's
in-flight/pending fingerprint dedup (already shipped) plus background-owned
attempt allocation, so concurrent submissions of the same normalized command from
the sidepanel and the trading panel resolve to one attempt and at most one
transfer. The existing sidepanel-local key manager wiring is removed in step 3.

### gateway.ts — transport seam

```ts
interface FundingGateway {
  loadWalletTokens(): Promise<FundingToken[]>;
  loadBridgeAssets(): Promise<FundingBridgeAsset[]>;
  fetchQuote(input: FundingQuoteRequest): Promise<FundingQuote>;
  beginAttempt(command: FundingCommand): Promise<FundingAttempt>;  // background, always
  execute(attempt: FundingAttempt): Promise<FundingExecutionResult>; // background, always
  awaitDepositCredit(input: FundingCreditQuery): Promise<FundingCreditResult>;
  pollWithdrawStatus(input: FundingStatusQuery): Promise<FundingStatusResult>;
}
```

**Canonical DTOs (defined in `src/funding/`, not borrowed from either surface):**

- `FundingToken` — one normalized token model; both surfaces map their existing
  `PortfolioWalletToken` / `DepositToken` shapes into it at the gateway boundary.
- `FundingCommand` — discriminated union (`deposit` | `withdraw`) carrying the
  normalized inputs the fingerprint is computed from.
- `FundingQuote`, `FundingExecutionResult`, `FundingCreditResult`,
  `FundingStatusResult` — typed results; no `unknown` passthrough to the machine.
- Monetary values in every DTO are decimal strings or raw base-unit strings;
  never `number`.
- Errors crossing the gateway are structured `{ code, message }` with an
  allowlisted code set; raw exception text and stack traces never reach the
  machine or a renderer.
- Every background funding message payload and every untrusted bridge-api
  response is runtime-validated at the gateway boundary; missing or invalid
  destination/chain/token/decimals/amount/quote/idempotency fields are rejected
  with structured errors.

Rules:

- `execute` is background-only on every implementation: `KNOWW_PORTFOLIO_DEPOSIT` /
  `KNOWW_PORTFOLIO_WITHDRAW` runtime messages. No gateway implementation may sign or
  send transactions from content/sidepanel context.
- Reads keep each surface's existing transport for now (sidepanel: its existing
  token/quote/status messages incl. `KNOWW_PORTFOLIO_WITHDRAW_QUOTE` /
  `KNOWW_PORTFOLIO_WITHDRAW_STATUS`; trading-panel: existing `bridge-api` reads for
  assets/quotes). Read-transport unification is a possible later cleanup, not this
  project.
- The `NO_CONTENT_TAB` background response is surfaced as a distinct error so the
  sidepanel keeps its knoww.app-funds-page fallback.

### Surface adoption

Both surfaces become `render(state)` + `dispatch(event)` against a controller
instance.

**Sidepanel (adopted first — lowest risk, already on the background path):**
replace the fund-flow module state (`portfolioFundView`, `portfolioDepositStep`,
`portfolioDepositToken`, withdraw quote/status timers and run counters, submit/retry
plumbing) with the controller. HTML-string rendering stays.

**Trading-panel (second — includes the money-path switch):** delete the ~14
`deposit*` module variables, `startDepositFlow`, `executeDeposit`,
`depositFetchQuote`, receipt-waiting and bridge-credit polling; render the same
wizard from machine state. `SUBMIT` now dispatches through the controller to the
background path. Wallet prompts still appear in the same tab (the background bridge
wallet client signs through the content tab), but transactions are viem-built —
this also fixes the MetaMask "likely to fail" UX for panel deposits.

Analytics stay in the surfaces (sidepanel events; `trackPanelAnalytics` in the
panel), driven from state transitions, so existing event streams are preserved.

**Feature-parity checklist (must hold after adoption):** wallet + bridge deposit
methods; bridge-asset search; quote preview with loading state; `minCheckoutUsd`
floor; direct-route (no-quote) handling; on-chain receipt wait; bridge-credit
polling; balance refresh on completion; withdraw quote → execute → status flow;
`NO_CONTENT_TAB` fallback; `PENDING_RECONCILIATION` treatment.

## Error handling

Machine error states carry `{ code, message, retryable }` with an allowlisted
code set:

- `PENDING_RECONCILIATION` — terminal for the attempt; renderers show the
  reconciliation message; no auto-retry.
- `IDEMPOTENCY_FINGERPRINT_MISMATCH` — **fails closed**: non-retryable error
  state; never silently regenerates a key.
- Ambiguous outcome (timeout after submission, reload before receipt) —
  retryable, but `RETRY` resumes the **same attempt** (same key, recorded
  transaction hash) rather than starting a new transfer.
- Confirmed on-chain revert → attempt terminates; an explicitly user-initiated
  new transfer allocates a fresh attempt.
- Quote failure → retryable, returns to `amount`.
- `NO_CONTENT_TAB` — sidepanel-specific fallback rendering.
- Renderers only ever see structured codes/messages; raw exceptions and stack
  traces stop at the gateway.

## Testing & verification

1. **Reducer transition-table tests** — every state × event for both flows,
   including double-`SUBMIT`, `BACK` rules, validation gates, and the
   unreachability of `submitting` from the passive bridge branch.
2. **Effect-correlation tests** — stale results after `RESET` + new `START`;
   account/wallet-mode change while reads are in flight; retry while an older
   poll response is delayed; renderer unmount/remount with active timers
   (`dispose()` semantics); two controller instances receiving results out of
   order — no stale effect may transition a newer attempt.
3. **Attempt-lifecycle tests (controller + background coordinator)** —
   execution response received but controller restarts before receipt
   confirmation; receipt/status request times out after submission; replay of a
   completed background result resumes confirmation without executing again; a
   confirmed revert permits an explicitly initiated new attempt; fingerprint
   mismatch fails closed.
4. **Cross-context test** — sidepanel and trading panel submit the same
   normalized command concurrently; exactly one transfer executes.
5. **Surface tests** — update existing suites (`trading-panel-ux.test.ts` etc.);
   add renderer tests that drive synthetic states through key steps.
6. **Gates** — full extension vitest suite, `pnpm typecheck`, extension build.
7. **Manual QA** — wallet deposit, passive bridge-address deposit, withdraw,
   double-click submit, service-worker restart mid-flow, tab reload right after
   wallet confirmation (expect resume/`PENDING_RECONCILIATION`, never a duplicate
   transfer).

## Success criteria

- Zero content-side `sendTransaction` calls for executable funding anywhere in
  the extension.
- The passive bridge-address method remains available and never invokes
  `execute`.
- One definition of funding steps/state; grep for `depositStep` finds only the
  machine.
- Trading-panel deposits carry background-owned attempts (idempotency keys)
  end-to-end; controller/tab reload after submission resumes the same attempt
  and transaction hash.
- Concurrent submissions from both surfaces execute at most once.
- No stale effect can transition a newer attempt.
- Runtime validation rejects missing/invalid destination, chain, token,
  decimals, amount, quote, and idempotency fields with structured safe errors;
  no raw exception or stack text reaches a renderer.
- Canonical funding calculations contain no JavaScript floating-point
  arithmetic.
- `sidepanel.ts` + `trading-panel.ts` shrink by roughly 500–800 lines combined.
- All suites and typecheck green.

## Sequencing (input to the implementation plan)

1. Canonical DTOs + `machine.ts` + exhaustive reducer/effect-correlation tests.
2. Background attempt authority: `begin-attempt` message + attempt persistence
   layered on the existing portfolio-fund-idempotency coordinator; lifecycle
   tests (resume, replay, revert, mismatch fail-closed).
3. `controller.ts` + `gateway.ts` + tests (fake gateway; dispose semantics).
4. Sidepanel adoption (gateway impl over existing messages; delete local fund
   state and the sidepanel-local intent-key wiring).
5. Trading-panel adoption + money-path switch for the wallet method (delete
   `executeDeposit` and friends); passive bridge branch preserved as-is.
6. Cross-context test, dead-code sweep, parity checklist pass, full gates,
   manual QA.

## Risks

- **Behavioral drift in the panel wizard** — mitigated by the parity checklist and
  by keeping the panel renderer unchanged.
- **Wallet-prompt UX change for panel deposits** — intended improvement (viem-built
  transactions), verified in manual QA.
- **Two webpack entries importing one module** — no new mechanism; shared modules
  are already bundled per-entry. Bundle-size check in the final step.
- **New background surface (`begin-attempt`)** — one new runtime message and an
  attempt-persistence layer on the existing coordinator; kept thin (allocation +
  lookup only) so the coordinator remains the single execution authority. Its
  lifecycle tests land in step 2, before any surface depends on it.

## Codex review — disposition

All six review points were verified against the codebase and incorporated into the
sections above. Summary of what changed and why:

1. **Attempt retained through reconciliation — accepted (real duplicate-transfer
   hole).** The original design completed the intent when `execute` returned,
   before receipt/credit confirmation; an ambiguous failure plus retry could
   allocate a new key and re-submit (the background coordinator intentionally
   permits a new key for a completed fingerprint, since legitimate repeat
   deposits exist). Now: attempts persist `{attemptId, key, fingerprint, txHash,
   phase}`, complete only on deterministic terminal outcomes, retries resume the
   same attempt, and fingerprint mismatch fails closed. See "controller.ts".
2. **Cross-surface atomicity — accepted with a verified nuance.** Confirmed the
   sidepanel constructs the key manager with `navigator.locks` + `sessionStorage`,
   which are context-scoped (and in a content script, page-owned) — so per-surface
   managers cannot coordinate. Attempts are now background-owned. Nuance kept in
   the design: the shipped background coordinator's in-flight/pending fingerprint
   dedup already provides at-most-once for concurrent submissions; background
   attempt ownership closes the remaining ambiguous-outcome window. The
   cross-context concurrency test is added.
3. **Passive bridge-address flow — accepted (verified in
   `renderDepositConfirmStep`: bridge method shows a copyable address, no amount,
   no execution).** The machine now has a non-executable
   `select-bridge-asset → bridge-address-ready` branch that can never reach
   `submitting`.
4. **Canonical gateway contracts — accepted.** Normalized DTOs
   (`FundingToken`, `FundingCommand`, typed results), decimal-string money with
   Decimal.js-only arithmetic, allowlisted structured error codes, and runtime
   validation at the gateway boundary are now specified.
5. **Effect correlation/cancellation — accepted.** `attemptId`/`effectId` on
   every effect-result, reducer drop rules, controller `dispose()` semantics, and
   the five stale-result test scenarios are now specified.
6. **Expanded completion gates — accepted.** Folded into Success criteria and
   Testing & verification.
