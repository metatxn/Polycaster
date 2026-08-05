# Polymarket Unified SDK — Migration Gap Tracker

**Audit date:** 2026-07-25
**Reference doc:** https://docs.polymarket.com/getting-started/migrate-from-previous-sdks
**SDK under audit:** `@polymarket/client@0.1.0-beta.18` (pnpm catalog)

## Context

The repo is on the unified SDK **by dependency** but not **by usage**. The legacy packages
(`@polymarket/clob-client-v2`, `@polymarket/builder-relayer-client`, `@polymarket/builder-signing-sdk`)
are gone from every `package.json`, and there is exactly one SDK import point:

- `packages/shared-types/src/polymarket-unified.ts` → `adaptUnifiedSecureClientForLegacyClob`

All three consumers (web, extension, agent) talk only to that shim. The centralization is
correct design — it means one file fixes everyone. The defect is that the shim's **exported
surface is the legacy CLOB API**, and where the unified SDK diverges the shim degrades
silently (optional method typings + `if (!client.x) return …` guards) instead of failing loudly.

Consumers:
- `apps/web` — `src/hooks/use-clob-client.ts`
- `apps/extension` — `src/background/trading-handler.ts` via `src/background/unified-clob-client.ts`
  (webpack aliases `@knoww/shared-types` → `packages/shared-types/src`, so shim fixes land on next build)
- `apps/agent` — `src/live-execution.ts` (declares its own copy of the legacy interface)

Verification notes: every claim below was checked against the installed SDK `dist/`
(`types-Dde2p6Ix.d.ts` for signatures, `chunk-PB6EZLUZ.js` for the runtime zod schemas,
`actions/index.js` + `index.js` export tables for what is/isn't attached to the client).

---

## Suggested order of work

1. ~~**Batch A (one PR):** #1, #2, #5~~ — ✅ **done 2026-07-26** (see each issue for what shipped).
2. ~~**Batch B:** #3 + #4~~ — ✅ **done 2026-07-27** via option (a); needs live verification
   (place a market SELL and confirm the pre-flight no longer blocks a genuinely sellable position).
3. ~~**Batch C:** #6 + #7 + #11's leftover + #15~~ — ✅ **done 2026-07-27**. #6 turned out to be
   mis-specified (`/markets/` ≠ `/clob-markets/`) and uncovered a live zero-protocol-fee bug in
   the BUY pre-flight; needs live verification (place a small market BUY on web **and** on the
   extension and confirm the quoted fee is non-zero and the two surfaces agree).
4. ~~**Batch D:** #8–#14~~ — ✅ **done 2026-07-27**, and it closes the tracker. Only #10 and #13
   had adoptable work in them (the extension's last raw-HMAC path, and eager paging); #8, #9, #12
   and #14 are **not adoptable** against beta.18 for one shared reason — see
   [the gasless invariant](#the-gasless-invariant--why-8-9-and-12-are-not-adoptable) — and are
   recorded as deliberate keeps rather than debt. Nothing in Batch D changes order semantics, so
   it carries no new live-verification burden beyond a portfolio open-orders read and one
   split/merge.

> **Batch A needs live verification before it ships to users.** The changes are type-clean and
> unit-tested, but nothing here has been exercised against a live V2 book. Place one small
> market BUY, one market SELL, and one FOK order on web and on the extension, and confirm the
> fill price respects the bound and the total debited equals the quoted amount **plus** the
> quoted fee (fees are charged on top — see #5).
>
> Include a **$1.00 market BUY** in that pass. The ticket minimum came down from $1.04 to $1.00
> when `maxSpend` was dropped (#5), and the CLOB's `min size: 1` floor is exactly the number this
> case sits on.
>
> Add one more case now that the partial-fill toggle is live (2026-07-27): on a thin book, place a
> market order with "Allow partial fill" **on** and confirm it fills the quoted partial amount at
> or better than the quoted bound, then repeat with it **off** and confirm the ticket blocks with
> "Insufficient liquidity".

---

## 🔴 Live trading-behavior bugs

### 1. Market orders have no price / slippage protection — ✅ FIXED 2026-07-26

**What's wrong:** The shim forwards a `price` key. beta.18's market-order schema has no `price`
key — BUY takes `maxPrice`, SELL takes `minPrice`. Zod's default parse **silently strips unknown
keys**, so the caller's bound disappears without an error.

Runtime schema (extracted from `chunk-PB6EZLUZ.js`):
```
BUY:  { side, amount, maxSpend?, maxPrice? }  + base { tokenId, builderCode?, orderType?: FAK|FOK }
SELL: { side, shares, minPrice? }             + same base
```

**Anchors:**
- `packages/shared-types/src/polymarket-unified.ts:539-552` (`createMarketOrder`, `price` forwarded at :547)
- `apps/web/src/hooks/use-clob-client.ts:668-677`
- `apps/extension/src/background/trading-handler.ts:476`

**Impact:** The caller's explicit slippage bound is silently discarded, web and extension.

**What it is _not_ (verified 2026-07-27, against `chunk-PB6EZLUZ.js`):** this does not sign an
_unbounded_ order. When `maxPrice`/`minPrice` is absent, `createMarketOrder` falls back to
`estimateMarketPrice`, which fetches `/book` and walks live depth for the requested amount — so a
bound is always signed, just the SDK's rather than ours. For FOK the estimator throws
`InsufficientLiquidityError` when the book cannot cover the full amount; for FAK it falls back to
the best available level. Two consequences worth keeping straight:

- The defect is **silent substitution**, not absence. A ticket that quoted the user 0.55 could sign
  at whatever the book said a moment later, with no error anywhere.
- **Omitting the bound is a safe default, not a hole.** Anywhere we cannot compute a bound we can
  legitimately send none and let the SDK walk the book itself. This is exactly what the one-click
  stream paths do (see below).

The price bound governs fill price only. It is not a cap on money at risk — the SDK's `maxSpend`
is the only all-in cap, and we deliberately do not set it (see #5), so a market BUY's exposure is
its `amount` plus fees charged on top.

**Fix:** In the shim, map `price` → `maxPrice` when `side === BUY`, `minPrice` when `side === SELL`.
Callers need no change.

**Shipped:** `polymarket-unified.ts` `createMarketOrder` now builds the BUY and SELL request
shapes separately and maps `price` → `maxPrice` / `minPrice`. A new `optionalPriceBound` helper
drops non-finite and `<= 0` values, because callers that cannot compute a bound pass `0` and
signing "never fill above zero" would guarantee a no-fill. Covered by
`polymarket-unified.test.mjs` ("maps legacy market-order requests…", "drops unusable market-order
price bounds").

**Web:** already safe — `params.price` is `marketOrderPrice`, which is the book's worst fill price
× 1.005 (BUY) / 0.995 (SELL) rounded to tick, and `0` when the book cannot fill.

**Extension panel:** ✅ closed 2026-07-27. The panel used to send `price: 0` on every market order
(`panel/order-view.ts` set `price = undefined` in market mode), which the background's
`if (msg.price && msg.price > 0)` guard dropped, leaving the SDK to estimate its own bound.
`getMarketPriceBound` now computes the same slippage-buffered bound the web ticket signs — the
walk's `worstPrice` × 1.005 rounded **up** to tick (BUY) or × 0.995 rounded **down** (SELL),
clamped to `[tick, 1 − tick]` — and the submit site passes it through.

The point of this change is **quote fidelity, not slippage protection**: the panel shows the user a
specific worst price and cost, so the order should sign against *that* number rather than against a
book the SDK re-fetches moments later. It also restores web/extension parity. `getMarketPriceBound`
returns `undefined` when there is no walk to price against, which is exactly the case the submit
button already blocks.

**Extension — one-click stream cards: considered, deliberately left alone.**
`submitStreamMarketOrder` and `submitStreamMarketSell` in `content/trading/trading-glue.ts` still
send `price: 0`, so the SDK estimates the bound. That is the right call for these paths, not a gap:
they quote no worst price to the user, so there is no quote to stay faithful to, and they hold no
book. A version that fetched a book content-side was written and reverted — when that fetch fails it
can only fall back to the card's stale display price, which is strictly worse than the SDK's
fresh walk against live depth.

---

### 2. FOK market orders silently execute as FAK — ✅ FIXED 2026-07-26

**What's wrong:** beta.18's `postOrder(order: SignedOrder)` takes **one** parameter
(`types-Dde2p6Ix.d.ts:3319`). Order type must be set at *create* time via the request's
`orderType` field. The shim's `postOrder` accepts the legacy 2nd arg and drops it.

**Anchors:**
- `packages/shared-types/src/polymarket-unified.ts:574-576` (arg dropped)
- `apps/web/src/hooks/use-clob-client.ts:684`, `:707`
- `apps/extension/src/background/trading-handler.ts:486` (market), `:526` (limit)
- `apps/agent/src/live-execution.ts:1028`
- FOK source: `apps/web/src/components/trading/hooks/use-trading-form-state.ts:475-519`
  (MARKET + `allowPartialFill === false` → `ClobOrderType.FOK` at :483-485)

**Impact:** A user who turns OFF "allow partial fill" still gets a partially-fillable order
(FAK is the SDK default). Real, reachable via the web UI.

**Not affected:** GTC/GTD limit orders — the shim forwards `expiration` into `createLimitOrder`
and the SDK derives GTD vs GTC correctly.

**Worse than first reported — `apps/agent` was posting resting GTC orders.** The agent built a
**limit** order with `expiration: 0` (`live-execution.ts:977-986`), so the shim omitted
`expiration` and the SDK created a **GTC** order that rests on the book, while `config.orderType`
(default **FOK**, `live-execution.ts:54`) was dropped at `postOrder`. An operator who configured
fill-or-kill got an open resting order instead. This is materially worse than the web's FOK→FAK
downgrade and is why the agent had to be fixed in the same pass rather than deferred to #15.

**Fix:** Thread `orderType` into the shim's `createMarketOrder` request object. Keep the shim's
`postOrder` accepting the legacy 2nd arg during transition (either ignore it or throw if it
disagrees with the created order), then remove it.

**Shipped:**
- Shim `createMarketOrder` forwards `orderType`; `assertMarketOrderType` throws if a caller passes
  GTC/GTD to the market path.
- Shim `createOrder` throws if a caller passes FAK/FOK to the limit path — silently creating a
  resting order for someone who asked for fill-or-kill is the worst available failure.
- Shim `postOrder` keeps the legacy 2nd arg but now runs `assertPostedOrderTypeMatches`: if the
  caller names an order type that disagrees with what the order was signed as, it throws
  (`created as GTC but posted as FOK`). This makes the whole class of bug non-reintroducible; the
  arg can be dropped once all three callers stop passing it.
- Web (`use-clob-client.ts`) passes `orderType: params.orderType` on market orders.
- Extension (`trading-handler.ts`) sets `orderType` on the market request. Behavior-neutral at the
  time — the extension only ever sent FAK; it now sends FOK too (see the follow-up below).
- Agent (`live-execution.ts`) migrated from `createOrder` to `createMarketOrder` with
  `orderType: config.orderType` and `price` as the bound; BUY sends `notional`, SELL sends `shares`.
  Its `LiveClobClient` type and the `live-execution.test.mjs` mock were updated to match.

**Extension impact:** one-line edit — `orderType` is already in scope as
`msg.orderType || "GTC"` (`trading-handler.ts:390`); move it into the request at `:476`
instead of passing it to `postOrder`.

**Follow-up shipped 2026-07-27 — "Allow partial fill" is now a real choice on both surfaces.**
FOK is all-or-nothing: the SDK's own wording on `PrepareMarketBuyOrderRequest.maxPrice` is "for
FOK, the full `amount` must fill within this bound or the order is killed. For FAK, any immediately
available liquidity within this bound fills and the remainder is canceled." A thin book is
therefore an *acceptance* problem for FOK only — `InsufficientLiquidityError` never appears in the
create/post error unions — so blocking every short book was blocking orders FAK would have filled.

- **Web** (`use-trading-form-state.ts`): `hasInsufficientLiquidity` now means "FOK, or no depth at
  all". A short book with `allowPartialFill` on becomes `isPartialFillAvailable`, which keeps the
  submit button live (`canPlaceMarketOrder`), sizes `calculations.size`/`total` to the walk, and
  feeds a `partialFill` object the ticket renders as "Fills $X of $Y". `marketOrderPrice` returns
  the buffered `worstPrice` for partial walks too — falling through to `0` would have been dropped
  by `optionalPriceBound`, leaving the SDK to re-estimate a bound that no longer matches the quote.
- **Extension** (`panel/order-view.ts`, `panel/panel-state.ts`, `knoww-inline.css`): new
  `allowPartialFill` panel state (defaults `true`, reset per panel open) drives a market-mode
  "Allow partial fill" switch; `getPanelOrderType()` returns FAK/FOK from it; the liquidity gate
  and the approval preview it short-circuits both accept the partial case; and the order summary
  shows a "Partial fill — $X of $Y" row. `getOrderShareSize` now returns the walked `filledSize`
  for market SELLs as well, so a partial SELL displays the size that gets signed, and the
  sell-the-whole-position snap is skipped on a partial so the signed size stays equal to the quote.

Both surfaces sign the *walked* size/notional rather than the requested one, so the ticket and the
exchange see the same number — which is also why the marketable-BUY $1 minimum still fires
correctly on a ticket that partially fills below it.

---

### 3. Pre-order balance/allowance sync is a silent no-op in BOTH apps — ✅ FIXED 2026-07-27 via **option (a)**

**What was wrong:** `updateBalanceAllowance` is **not attached** to the beta.18 client (verified:
`allActions(client)` returns 97 methods, none matching `/balance|allowance/`; both live on the
`@polymarket/client/actions` subpath as standalone `(client, request)` functions). The shim guarded
with `if (!client.updateBalanceAllowance) return undefined;` → always returned undefined.

**Why (a), not (b).** Three independent lines of evidence:
1. **Static** — the `.d.ts` declares both only as `declare function …(client: BaseSecureClient, request)`.
2. **Runtime** — the complete 97-method `allActions` surface contains neither name, so both shim
   guards were permanently false.
3. **Behavioural** — the SDK's own remedy for a stale server cache *is* `updateBalanceAllowance`,
   but it only calls it inside `placeMarketOrder` / `placeLimitOrder`, which wrap the post in a
   self-heal (catch a 400 containing `"allowance is not enough"` → `fetchBalanceAllowance` →
   approve on-chain → `updateBalanceAllowance` → retry once). We post through the raw `postOrder`,
   which has **none** of that (see #12). Deleting our sync would leave nothing.

A live V2 market order placed before the fix succeeded with the sync a total no-op — explained by
already-warm approvals and cache, not by the sync being unnecessary.

**Fix applied:** the shim now tries the client method first (so a later SDK release that adds the
documented instance API takes over automatically) and otherwise calls the standalone action.
`getBalanceAllowance` is attached unconditionally and is now **required** on
`LegacyClobCompatibleClient`.

**Anchors (post-fix):**
- `packages/shared-types/src/polymarket-unified.ts` — `toSdkBalanceAllowanceArgs` +
  `updateBalanceAllowance` / `getBalanceAllowance` on the adapter
- `packages/shared-types/src/polymarket.ts` — `syncClobBalanceAllowance` caller (unchanged, now live)
- `apps/web/src/hooks/use-clob-client.ts` — retry loop now actually retries; post-signing resyncs
  do real work
- `apps/extension/src/background/trading-handler.ts:445-462` — `trading.balance-updated` is now
  a truthful log

**Verified:** `@polymarket/client/actions` resolves under the extension's webpack build
(`pnpm run build:dev` compiles) and under the Next/TS build (`tsc --noEmit` clean in both).

---

### 4. SELL pre-flight share-balance guard is unreachable — ✅ FIXED 2026-07-27 (fell out of #3)

**What was wrong:** `getBalanceAllowance` was only attached `if (client.fetchBalanceAllowance)`,
which is never true in beta.18, so the web guard short-circuited and SELL orders skipped the
share-balance pre-flight entirely.

**Fix applied:** the shim attaches `getBalanceAllowance` unconditionally, so the web guard is live.
The now-redundant `!balanceAllowanceClient.getBalanceAllowance` short-circuit was removed and the
local `ClobBalanceAllowanceReadableClient` type makes the method non-optional.

**Hardening that came with it:** making the guard live turned the sync from a guaranteed no-op
into a real network call, so the failure paths had to be handled rather than inherited:
- **web (SELL):** a throw used to abort the order on the *first* attempt, skipping the remaining
  four rungs of `CLOB_BALANCE_SYNC_DELAYS_MS`. It now records the error and keeps walking the
  ladder; the error is only surfaced if *every* attempt failed, and a clean read clears it so a
  genuinely-missing balance still gets the friendly message rather than a stale 5xx.
- **agent:** the sync at `apps/agent/src/live-execution.ts` was unguarded and would have killed
  otherwise-valid live trades. Wrapped non-fatally with a `live.balance_allowance_sync.failed`
  warn — matching web's BUY path and the extension's `trading.balance-update-failed` — since a
  stale cache is not necessarily fatal and `postOrder` surfaces anything that actually blocks.

**Anchors (post-fix):**
- `apps/web/src/hooks/use-clob-client.ts:125-131` (method non-optional)
- `apps/web/src/hooks/use-clob-client.ts:561-615` (`syncBalanceAllowance`, guard live + retry)
- `apps/agent/src/live-execution.ts` (non-fatal sync around `runtime.syncBalanceAllowance`)

**Regression tests:** `apps/web/src/hooks/use-clob-client.test.tsx` →
- *"blocks a SELL whose shares the CLOB has not indexed yet"* — the friendly
  "Polymarket has not indexed these shares for trading yet" error fires and `postOrder` is never
  called.
- *"retries a SELL sync that fails transiently instead of aborting"* — one rejected
  `updateBalanceAllowance` does not stop the order; the next rung succeeds and `postOrder` runs.

The pre-existing SELL tests now exercise the real balance read.

**Extension impact:** none (web-only guard).

---

### 5. `maxSpend` on market BUYs — ✅ RESOLVED 2026-07-27 as **deliberately not set**

> **Current state — read this first.** `maxSpend` is **never set**, on any surface, on purpose.
> Market BUYs sign the full `amount` and pay fees **on top**, which is the SDK's documented
> default. The history below records a shipped `maxSpend = amount` change on 2026-07-26 and its
> reversal a day later; the reversal is the standing decision.
>
> **Do not re-introduce `maxSpend = amount`.** It caused a live production failure. If a future
> requirement needs an all-in spend cap, read the reversal section for what breaks and size the
> cap above the CLOB floor by a *price-dependent* margin, never a flat one.

**The rule:** `amount` is **notional**, not total spend. The ticket quotes the amount, quotes the
estimated fee beside it, and quotes the sum as "Est. total". The user is charged that total.

**Why `maxSpend` stays unset (verified against `dist/types-Dde2p6Ix.d.ts:3029-3053` and the
runtime reducer in `chunk-PB6EZLUZ.js`):**

1. **It shrinks the signed order, and the CLOB's floor applies to the shrunk number.** With
   `maxSpend` set, the SDK solves `maxSpend / (1 + r/price + builderRate)` and signs *that* as
   `makerAmount`. A $1.04 ticket on a $0.098 outcome signed as **$0.99** and the exchange rejected
   it: `invalid amount for a marketable BUY order ($0.99), min size: 1`.
2. **No static minimum can compensate.** The protocol fee is charged per share, so as a fraction of
   the amount it scales as `rate / price` and grows without bound on cheap outcomes: ~3% at $0.50,
   ~5% at $0.10, ~9% at $0.02. The $1.04 constant was built on a flat 300 bps and was therefore
   wrong everywhere except mid-book.
3. **The cap was modelled, not enforced.** `Fu` reduces using the *estimated* price, while the
   exchange charges the protocol fee per share on the *actual* FAK fill. A cap that can be
   exceeded anyway is not worth the failure mode it introduces.
4. **It contradicted our own pre-flight.** `buildClobOrderPreflightPlan` already reserves
   `requiredPusdRaw + feeRequirementRaw` — fees on top — so collateral checks and order signing
   disagreed about what the order cost.

The SDK's own TSDoc is explicit that unset is the default: *"By default, the SDK prepares the
order for this full buy amount and applicable fees are paid on top… Leave it unset to pay fees on
top of `amount`."*

**Shipped 2026-07-27:**
- `maxSpend` removed from all three call sites — `use-clob-client.ts`, `trading-handler.ts`,
  `live-execution.ts` (both create sites) — each with a comment naming the failure it caused.
- `MIN_MARKETABLE_BUY_TICKET_USD` reduced from **$1.04 → $1.00** (now simply
  `CLOB_MIN_MARKETABLE_BUY_NOTIONAL_USD`). Signed `makerAmount` equals the typed amount, so the
  server's floor applies to it directly and the fee markup is not just unnecessary but unsound.
- **"Est. total" row** added beside the existing fee row on both tickets
  (`trading-form.tsx`, `panel/order-view.ts`). The fee row alone was written for the `maxSpend`
  world, where it explained where the shares went; on top-of-amount pricing the number the user
  actually needs is the debit, so both rows render together or neither does.
- The shim still **accepts and forwards** `maxSpend` (`UnifiedSdkMarketOrderRequest.maxSpend`,
  covered by `polymarket-unified.test.mjs:351,370`). That is intentional: it is a legitimate SDK
  capability we simply do not use, and keeping the passthrough means adopting it later is a
  call-site decision, not a shim change.

**Open item for the owner:** the agent's `AGENT_MAX_LIVE_NOTIONAL_USD` now caps *notional*, not
total debit — real spend exceeds it by the fee (~3% mid-book, more on cheap outcomes). Flagged in
a comment at the call site; tightening the gate is a risk-limit decision, not a bug fix.

---

<details>
<summary><strong>History — the original issue and the 2026-07-26 fix that was reversed</strong></summary>

#### Original finding (2026-07-25)

**What's wrong:** Per the migration doc, the SDK adds fees **on top of** `amount` unless
`maxSpend` caps total spend. `maxSpend` is the `userUSDCBalance` replacement. Nothing in the
repo sets it.

**Anchors:**
- `packages/shared-types/src/polymarket-unified.ts:539-552` (request built without `maxSpend`)
- Check for double-counting: `apps/web/src/components/trading/hooks/use-trading-form-state.ts:514`
  (`calculations.total` — does it already include estimated fees?)

**Impact:** A "spend $50" order actually costs $50 + taker fees. If the UI already shows a
fee-inclusive total, the user is quoted one number and charged another.

**Fix:** Decide product semantics (is `amount` "notional" or "total spend"?). If total spend,
set `maxSpend: amount` in the shim.

**Decision — `amount` is total spend, so `maxSpend = amount`.** Verified the double-counting
question: for a market BUY the ticket's `calculations.total` is
`calculateBuySlippageForAmount(...).totalNotional`, which when `canFill` is exactly the dollar
figure the user typed (`slippage.ts:229-289` — the walk terminates when the budget hits zero), and
it excludes fees. So today the user is quoted $X and charged $X + taker fee. Capping at the quoted
number means fees come out of the budget and the user gets marginally fewer shares — strictly
less surprising for a retail ticket than silently overspending.

**Shipped:** `maxSpend` added to `LegacyClobOrderRequest` and forwarded for BUY only.
Set at both call sites (not in the shim) so it stays an explicit caller decision:
`use-clob-client.ts` (`params.side === Side.BUY`) and `trading-handler.ts`
(`msg.side === "BUY"`). The agent also caps at `notional`.

**Not set for:** market SELLs (no such concept — SELL is share-denominated) and limit orders.

**Extension impact:** one-line edit at the call site, mirroring web.

**Follow-up 2026-07-27 — the $1 floor and the fee row.** ⚠️ *The $1.04 minimum described here was
superseded the same day; only the fee-row and preflight-price parts survive. See the current
decision above.* Capping at the quoted number has a
second-order effect the decision above did not account for: because the SDK reduces the signed
`makerAmount` by the fee, a $1.00 ticket signs ~$0.99, and the CLOB rejects it with
`invalid amount for a marketable BUY order ($0.99), min size: 1`. The server's floor applies to
the *signed* number, not the typed one, so the ticket minimum has to carry the fee reserve.

- `MIN_MARKETABLE_BUY_TICKET_USD` (= **$1.04**) added to `packages/shared-types/src/trading.ts`:
  the CLOB's $1 floor grossed up by the conservative `FALLBACK_FEE_BPS` (300) plus a cent of
  headroom for the SDK's round-down of `makerAmount` to 2 dp. Real fees are ~100 bps, so this
  only ever over-clears. Enforced on web (`use-trading-form-state.ts`), extension
  (`order-view.ts`) and agent (`live-execution.ts`, which blocks rather than burning a
  signature on a certain reject).
- **Fee row added to both tickets**, which is what makes the tradeoff legible rather than silent
  — the original "quoted one number and charged another" concern applies in reverse under
  `maxSpend` (same dollars, fewer shares). Web reads it through the new `estimateBuyFee` on
  `useClobClient` (React Query, keyed on rounded ticket inputs); the extension reads
  `estimatedFeeRaw` off the preflight response it was already fetching for the approval preview.
  Both render nothing — not `$0.00` — when the market's fee details cannot be read, and
  `formatFeeUsd` prints `<$0.01` for genuinely sub-cent fees.
- The extension previously sent `price: 0` on market-order preflights. Harmless for collateral
  (a market BUY is sized by amount) but fatal for the fee, whose protocol component is a curve in
  `price · (1 − price)` and is therefore 0 at that endpoint. It now sends the implied average fill
  price (`getPreflightPrice`). The separate `price: 0` on extension order *placement* (issue #1's
  open follow-up) is untouched.

</details>

---

## 🟠 SDK-bypass / dead-code cleanup

### 6. Four `useUnifiedSdk: false` bypasses exist because the shim looks for methods that were never attached — ✅ FIXED 2026-07-27

**What's wrong:** `fetchMarketInfo`, `fetchBuilderFeeRates` (and `fetchTickSize`, `fetchNegRisk`)
are **not client methods** in beta.18 — they're exported from the `@polymarket/client/actions`
subpath as `(client, request)` functions. The shim's optional-property guards therefore never
fire, so market info / fee rates permanently fall back to raw HTTP.

**Anchors:**
- `packages/shared-types/src/polymarket-unified.ts:40-55` (optional declarations)
- `packages/shared-types/src/polymarket-unified.ts` — `if (client.fetchMarketInfo)` conditional
  attachment in `adaptUnifiedSecureClientForLegacyClob` (never runs)
- `packages/shared-types/src/polymarket-unified.ts` — `fetchUnifiedClobMarket` /
  `fetchUnifiedClobBuilderFeeRates` (always throw)
- Bypass flags: `apps/extension/src/background/trading-handler.ts:152`, `:168`, `:702`;
  `apps/extension/src/background.ts:2143`

**Impact:** The SDK is bypassed for all market metadata; the "unified" code paths are dead.

**⚠️ This issue's original premise was wrong, and fixing it uncovered a live fee bug.**
Verified by live `curl`, not by reading the migration doc:

| | `GET /markets/{conditionId}` | `GET /clob-markets/{conditionId}` |
|---|---|---|
| Returns | full snake_case record: `question`, `description`, `market_slug`, `end_date_iso`, `icon`, `image`, `tags`, `rewards`, `tokens`, `neg_risk`, `minimum_tick_size`, `maker_base_fee`, `taker_base_fee` | compact trading view: `{r, t, c, mos, mts, mbf, tbf, ao, nr, cbos, aot, ibce, fd:{r,e}}` |
| Carries `fd` protocol-fee curve | **no** | **yes** |
| SDK accessor | none | `fetchMarketInfo` → `{feeInfo:{rate,exponent}, tokens:[{tokenId,outcome}]}` (drops `tbf`) |

The SDK's `fetchMarketInfo` is therefore **not** a drop-in for `fetchClobMarket` — different
endpoint, different payload. Routing `fetchClobMarket` through it would have silently stripped
every human-facing field the API routes serve.

**The live bug this exposed:** `parseProtocolFeeDetails` reads `fd.r` / `fd.e`. The extension's
BUY pre-flight was feeding it `fetchClobMarket`'s `/markets/` payload, which has no `fd`, so the
**protocol fee estimated to 0 on every pre-flight**. Web passed `null` (dead guard) and silently
used `estimateFallbackFeeRaw`. Both now read the right endpoint.

**Fix applied:**
- Split the two endpoints in `packages/shared-types/src/clob.ts`: `fetchClobMarket` keeps
  `/markets/{id}` and deliberately has **no** unified branch; new `fetchClobMarketInfo` reads
  `/clob-markets/{id}` and carries the SDK branch.
- `packages/shared-types/src/polymarket-unified.ts` imports `fetchMarketInfo` /
  `fetchBuilderFeeRates` from `@polymarket/client/actions` behind a `toSdkPublicActionClient`
  cast (they take a `BaseClient`, not the `BaseSecureClient` the balance/allowance pair wants),
  and attaches `fetchMarketInfo` / `getClobMarketInfo` **unconditionally** in
  `adaptUnifiedSecureClientForLegacyClob`.
- `parseProtocolFeeDetails` now also reads the SDK's parsed `feeInfo.{rate,exponent}` spelling.
- All four bypass flags removed. `trading-handler.ts` fee pre-flight moved to
  `fetchClobMarketInfo`; builder rates come from `fetchClobBuilderFeeRates`.
- Since the SDK's parsed market info **drops `tbf`**, `apps/web/src/hooks/use-clob-client.ts`
  gained a module-level builder-rate cache sourced from `/fees/builder-fees/{code}` and passes
  `builderCode` + `getBuilderFeeRates` to both `estimateBuyFee` and the submit-time
  `buildClobOrderPreflightPlan` — so the ticket preview and the reserved collateral agree, and
  match what the extension pre-flight and the CLOB itself compute.

**Extension impact:** verified — `build:prod`, `STORE_BUILD=true build:prod`,
`assert-production-bundle.mjs` and `smoke-esm-modules.mjs` all pass; `background.js` contains
zero `__webpack_require__.e(` calls, so nothing became a runtime-loadable chunk the classic MV3
service worker could not fetch.

---

### 7. Optional-method typings + silent guards hide real API mismatches (root cause) — ✅ RESOLVED 2026-07-27

**What's wrong:** The shim types SDK methods as optional and degrades silently — `return []`,
`return undefined`, permanent HTTP fallback — so every divergence from the real SDK becomes a
runtime no-op instead of a compile error. This is the mechanism behind #3, #4, #6, and #11.

**Anchors:** `packages/shared-types/src/polymarket-unified.ts:40-55`
(`UnifiedPolymarketPublicClient`), plus the `UnifiedSdkTradingClient` shape.

**Resolved as:** the *substantive* half — dead guards that could never fire — is gone. `#3`
made the balance/allowance pair non-degrading and `getBalanceAllowance` required on
`LegacyClobCompatibleClient`; `#6` removed the last `if (client.fetchMarketInfo)` /
`if (client.fetchBuilderFeeRates)` guards and replaced the always-throwing helpers with real
action calls. Confirmed against the runtime surface: `allActions(stub)` yields 97 keys on the
secure client and 62 on the public one (87 shared), and `fetchMarketInfo`, `fetchBuilderFeeRates`,
`fetchTickSize`, `fetchNegRisk` appear on **neither** — every guard against them was dead code.

**The remaining optional declarations are kept deliberately.** `UnifiedPolymarketPublicClient`
(`:44-59`), `UnifiedSdkTradingClient` (`:181-198`), `LegacyClobCompatibleClient` (`:226-252`)
and `UnifiedClobOrderBookClient` (`clob.ts:24-39`) are the shapes of the *caller-injected*
`options.client` / `options.unifiedClient` test seam, exercised by `clob.test.mjs` and
`polymarket-unified.test.mjs`. They describe what a test double may supply, not what the SDK
guarantees — making them required would force every fake to implement the full surface for no
safety gain.

---

## 🟡 Doc-alignment (works today, off the supported path)

### The gasless invariant — why #8, #9 and #12 are not adoptable

Every on-chain write helper in `@polymarket/client@0.1.0-beta.18` branches on the wallet type:

```js
e.account.walletType === WalletType.EOA
  ? /* direct tx through the signer */
  : yield* await Y(e, { calls, metadata })
```

and the proxy-wallet branch `Y` opens with

```js
invariant(
  e.supportsGasless,
  "Gasless transactions require a Relayer API Key or Builder API Key in the client configuration."
)
```

where `get supportsGasless() { return this.context.apiKey?.supportGasless ?? false }`.

**No caller in this monorepo passes `apiKey`**, so `supportsGasless` is `false` everywhere, and every
SDK write helper — `splitPosition`, `mergePositions`, `redeemPositions`, `setupTradingApprovals`,
`approveErc20`, `approveErc1155ForAll`, and the auto-approval retry inside
`placeMarketOrder` / `placeLimitOrder` — **throws** for our proxy-wallet users. Our users are
overwhelmingly proxy wallets (`POLY_PROXY` / `POLY_GNOSIS_SAFE` / deposit wallet), which is the whole
reason the in-house relayer exists.

Adopting any of these would replace a working gasless path with a hard throw. In `place*Order`'s case
it is worse than a throw: the invariant fires inside the retry wrapper and would **mask** the real
CLOB `400 allowance is not enough` that the retry exists to handle.

These stay hand-rolled until either the SDK gains a relayer-free gasless path or we obtain a
Polymarket relayer/builder API key with `supportGasless`.

---

### 8. Split / merge / redeem hand-encode CTF calldata instead of using SDK actions — ⛔ NOT ADOPTABLE 2026-07-27

**What's wrong:** `splitPosition` (`:3551`), `mergePositions` (`:3583`), `redeemPositions`
(`:3625`) are attached to the client and build the transactions internally. The repo encodes
from raw ABIs and executes through its own relayer. `redeemPositions` isn't used at all.

**Anchors:**
- `packages/shared-types/src/ctf.ts:53-61` (raw ABIs)
- `apps/extension/src/background/trading-handler.ts:810` (`splitPosition`), `:866` (`mergePositions`)
- `apps/web/src/hooks/use-ctf-operations.ts:169-249`

**Impact:** Maintenance burden; drift risk if Polymarket changes contracts/addresses.

**Resolution 2026-07-27 — keep the hand-encoded calldata.** `splitPosition` / `mergePositions` /
`redeemPositions` all route through the gasless branch for proxy wallets and would throw; see
[the gasless invariant](#the-gasless-invariant--why-8-9-and-12-are-not-adoptable). The ABI surface we
encode is three functions on two contracts, and `packages/shared-types/src/ctf.ts` is the single
place they live, so the drift risk is bounded and cheap to re-check.

The sub-item **was** actionable and is done: the post-split raw-HMAC cache poke
(`clobUpdateBalanceAllowance`) is gone — `syncBalancesAfterCTF` now builds an L2 client and calls the
shim's `updateBalanceAllowance` through the shared `syncClobBalanceAllowance`. See #10.

---

### 9. Approvals hand-orchestrated instead of `setupTradingApprovals()` — ⛔ NOT ADOPTABLE 2026-07-27

**What's wrong:** The SDK exposes `setupTradingApprovals()` (`:3460`), plus `approveErc20` /
`approveErc1155ForAll` / `setupGaslessWallet`. The repo hand-rolls the sequence.

**Anchors:** `apps/web/src/hooks/use-clob-client.ts:608` (`ensureSellCtfApproval`),
`:615` (`ensureV2Approvals`), `:634` (`ensurePusdSufficient`)

**Keep:** the pUSD auto-wrap in `ensurePusdSufficient` is product logic, not something the SDK does.

**Resolution 2026-07-27 — keep the hand-orchestrated sequence.** `setupTradingApprovals`,
`approveErc20` and `approveErc1155ForAll` are all write helpers behind
[the gasless invariant](#the-gasless-invariant--why-8-9-and-12-are-not-adoptable), so they throw for
every proxy wallet. Beyond that, our sequence does two things the SDK's does not and that the product
needs: the pUSD auto-wrap above, and the min(exchange, neg-risk adapter) allowance rule that #3
established.

---

### 10. Auth via raw HTTP; no `endAuthentication()` — ✅ PARTIALLY FIXED 2026-07-27

**What's wrong:** API-key derivation and L1/L2 headers are built by hand instead of letting
`createSecureClient` handle auth. There's no revoke path anywhere.

**Anchors:**
- `apps/extension/src/background/trading-handler.ts:326-327`
  (`createOrDeriveClobApiKey`, `buildClobL1Headers`)
- `apps/web/src/app/api/auth/derive-api-key/route.ts:134`
- `apps/extension/src/background/clob-open-orders.ts:50` (`buildClobHmacHeaders`)
- Unused SDK method: `endAuthentication()` (`types-Dde2p6Ix.d.ts:3896`)

**Fixed — the hand-rolled L2 HMAC is gone.** `buildClobHmacHeaders` and its two base64 helpers are
deleted. `apps/extension/src/background/clob-open-orders.ts` now exports one
`createL2ClobClient({ address, credentials, wallet? })` that builds a secure client from a
**credentials-only signer** with `allowFreshAuthentication: false`, and every L2 surface in the
extension background runs through it: open-order reads, `cancelOrder`, and the post-split/merge
balance poke in `trading-handler.ts`.

Wire parity was proven against the decompiled beta.18 before switching:

- `listOpenOrders` → `secureClob.get("/data/orders", …)` with the same L2 HMAC; it maps
  `tokenId` → `asset_id` and `nextCursor` → `next_cursor` internally.
- `updateBalanceAllowance` → `secureClob.get("/balance-allowance/update", …)` with
  `signature_type` derived from the account's wallet type via the SDK's own map — which agrees
  exactly with our `getPolymarketSignatureType(mode)` (EOA→EOA, safe→POLY_GNOSIS_SAFE,
  deposit wallet→POLY_1271). That is why the poke passes the funder as `wallet` and the read paths
  do not: `POLY_ADDRESS` comes from the signer either way, but `signature_type` must describe the
  account that actually holds the balance.

`walletType` derivation is pure CREATE2 math, not an RPC call, so a signer that cannot sign is safe
to pair with a real proxy address.

**Kept as-is:**
- **L1 key derivation** (`createOrDeriveClobApiKey` + `buildClobL1Headers`). The SDK's equivalent
  wants a full signing wallet at client-construction time; in the extension that means opening a
  MetaMask prompt from the service worker on a path that currently derives silently from a cached
  signature, and in web it means moving a server-route responsibility into the browser.
- **`endAuthentication()`**. We have no revoke UI to hang it on, and calling it would invalidate a
  key that is cached per-wallet across web, extension and agent. Worth revisiting if a
  "disconnect trading" control is ever added.

---

### 11. Legacy request casing at the boundaries — ✅ FIXED 2026-07-26

**What's wrong:** Legacy snake_case / `orderID` shapes persist where the SDK expects
`orderId` / camelCase.

**Anchors:**
- `apps/web/src/hooks/use-clob-client.ts:945` — `cancelOrder({ orderID: orderId })`
  (shim remaps at `polymarket-unified.ts:592-599`, so it works, but the contract is wrong)
- `apps/extension/src/background/clob-open-orders.ts:154` — raw `{ orderID }` HTTP cancel,
  bypasses the SDK entirely
- `packages/shared-types/src/polymarket.ts:479-490` — `asset_type` / `token_id` targets
- `tokenID` in order builders

**Fix:** Fold into #7's interface tightening; migrate the extension's raw cancel onto the shim.

**Shipped:** every *request-side* TS contract we own is now canonical camelCase, and the
dual-spelling fallbacks that used to paper over the difference are gone — so a legacy
spelling is now a compile error rather than a silent remap.

- `packages/shared-types/src/polymarket-unified.ts`
  - `LegacyClobOrderRequest.tokenID?` / `tokenId?` → required `tokenId: string`
  - `LegacyClobBalanceAllowanceRequest` `{asset_type?, assetType?, token_id?, tokenId?}` →
    `{assetType: string; tokenId?: string}`
  - `cancelOrder` / `isOrderScoring` / `areOrdersScoring` → `{orderId}` / `{orderId}` /
    `{orderIds}`; the `?? request.orderID`, `?? request.order_id`, `?? request.order_ids`
    fallbacks removed
- `packages/shared-types/src/polymarket.ts` — `ClobBalanceAllowanceTarget` is now
  `{assetType, tokenId?}`; `buildClobBalanceAllowanceTargets` emits that shape
- Call sites migrated: web `use-clob-client.ts` (order builders, `getBalanceAllowance`,
  `cancelOrder`), web `clob/market-data.ts` (`isOrderScoring`, plus its now-false
  "SDK uses snake_case" comment), extension `trading-handler.ts` (order builders, log
  fields, `clobUpdateBalanceAllowance`), agent `live-execution.ts` (`LiveClobClient`
  order + balance-allowance arg types, `createMarketOrder` call), and the shim/agent/web
  test suites

**Deliberately left alone** — these are genuine wire/storage formats, not our contracts:
- CLOB query params: `book?token_id=`, `price?token_id=`, `books?token_ids` in `clob.ts`.
  (Two entries formerly listed here no longer exist: the raw `token_id=`/`asset_type=`
  params on `/balance-allowance/update` went away with #10's fix, and the raw `{orderID}`
  DELETE cancel was migrated onto the shim — see the 2026-07-27 leftover note below.)
- Response-side normalizers, which mirror what the CLOB actually returns:
  `LegacyClobOpenOrder` (`polymarket-unified.ts:246-250, 551-562`),
  `live-execution.ts:88/272` (`orderID` on post-order responses),
  `use-open-orders.ts` / `sidepanel/portfolio.ts` open-order parsing, notification payloads
- SQLite column names in `apps/agent/src/repository.ts`
- Public Next.js route params (`/api/markets/orderbook/[tokenID]`, `?tokenID=`) — renaming
  those is a breaking API change, not a refactor

**Leftover closed 2026-07-27 — the extension's raw-HTTP cancel now runs through the shim.**
`cancelClobOrder` (`apps/extension/src/background/clob-open-orders.ts`) no longer hand-signs
`DELETE /order`; it builds a secure client and calls the shim's `cancelOrder({orderId})`.
Three things had to be established from the SDK's `dist` before this was safe:

- **`POLY_ADDRESS` is the *signer* address, not the wallet.** The SDK's L2 header builder reads
  `this.account.signer`, so `createUnifiedPolymarketCredentialsOnlySigner(input.address)`
  reproduces the raw path's header byte-for-byte. Cancels are L2-only — the CLOB authenticates
  them with the API-key HMAC and never a wallet signature — so a signer that cannot sign is
  sufficient, and `allowFreshAuthentication: false` turns any unexpected signing attempt into a
  loud throw rather than a silent prompt from the service worker.
- **`wallet` must be passed as the signer's own address.** `createSecureClient` short-circuits on
  `walletType === EOA` and returns immediately; omitting `wallet` would send it down the
  deposit-wallet derivation/deployment path, which a credentials-only signer cannot complete.
- **The SDK does not preserve the old throw-on-refusal contract.** `CancelOrdersResponseSchema`
  resolves 200 even when the CLOB refuses, putting the reason in `notCanceled[orderId]` (wire:
  `not_canceled`). A `cancelRejectionReason` helper reads both spellings and re-throws, so the
  sidepanel still can't optimistically drop an order that is in fact still resting.

The import is **static, not `await import(...)`** — this module is eagerly inlined into
`background.js` because a classic MV3 service worker cannot fetch a webpack async chunk at
runtime. Both this file and the SDK are already in `assert-production-bundle.mjs`'s
`STORE_FORBIDDEN_MODULE_MARKERS`, so the store contract can't regress; the store build was
re-run to confirm.

**Verified:** `pnpm -r run typecheck` clean; shared-types 73/73, agent 90/90, web node
77/77, web vitest 346/346, extension vitest 651/651; biome clean on all changed files.

---

### 12. `placeLimitOrder` / `placeMarketOrder` unused — ⛔ NOT ADOPTABLE 2026-07-27

**What's wrong:** Everything is manual create → sign → post. The SDK's `place*` methods bundle
the auto-allowance handling the doc advertises.

**Anchors:** `types-Dde2p6Ix.d.ts` (`placeMarketOrder`, `placeLimitOrder`);
callers `apps/web/src/hooks/use-clob-client.ts:668-707`,
`apps/extension/src/background/trading-handler.ts:476-526`

**What they actually buy (decompiled from beta.18):** `placeMarketOrder` / `placeLimitOrder` wrap
the raw post in a self-heal — catch a 400 whose message contains `"allowance is not enough"` →
`fetchBalanceAllowance` for the side's asset type → if the allowance really is short, send the
on-chain approval (`approveErc20` max for BUY, `setApprovalForAll` for SELL), `.wait()`, call
`updateBalanceAllowance` to refresh the server cache, then retry the post **once**. Our raw
`postOrder` path has none of this.

**Note:** the manual sync kept in #3 is what stands in for this today. Adopting `place*Order` would
make that sync a belt-and-braces layer rather than the only protection — but it also moves order
signing inside the SDK, so it is a real behavioral change, not a refactor.

**Resolution 2026-07-27 — keep create → sign → post.** The self-heal's whole value is the on-chain
approval it sends, and that call sits behind
[the gasless invariant](#the-gasless-invariant--why-8-9-and-12-are-not-adoptable). For a proxy wallet
the retry path throws *while handling* the `400 allowance is not enough`, replacing an actionable CLOB
error with a misleading "Gasless transactions require a Relayer API Key" — strictly worse than today.
Our up-front `syncClobBalanceAllowance` (#3) plus the pre-flight allowance check (#9) cover the same
failure mode before the post, rather than after it.

---

### 13. Paginators eagerly drained; newer list APIs unused — ✅ FIXED 2026-07-27 (paging); list APIs kept unused

**What's wrong:** `listOpenOrders` returns `Paginated<OpenOrder[]>` (`:3426`); the shim drains
all pages into an array via `collectUnifiedPaginator`, and returns `[]` if the method is missing.

**Anchors:** `packages/shared-types/src/polymarket-unified.ts:578-581`

**Unused:** `listTrades`, `listAccountTrades`, `listBuilderTrades`, `listCurrentRewards`.
`listCurrentRewards` / `getTrades` are relevant to the V2 cost-basis gap
(V2 positions show $0 cost basis until the Data API indexes V2 fills).

**Fixed — `limit` is now a page budget, not a slice.** `collectUnifiedPaginator` takes an optional
`limit`, stops requesting pages as soon as it has that many rows, and slices the tail so the count
stays exact when a page overshoots. It prefers `firstPage()` + `from(cursor)` when the paginator
exposes them, so a caller that only wants the first handful never issues a second request. The shim's
`getOpenOrders(options?: { limit?: number })` forwards it, and the extension's portfolio badge
(`limit: 5`) now costs one page instead of the whole book. Covered by
`polymarket-unified.test.mjs` ("stops paging open orders once the limit is met").

**Kept unused — the newer list APIs.** `listTrades` / `listAccountTrades` / `listBuilderTrades` /
`listCurrentRewards` have no caller because nothing in the product reads them yet. The one place they
would earn their keep is the V2 cost-basis gap, and that is an upstream Data API indexing lag expected
to resolve at cutover — adopting `getTrades` as a client-side fallback is the unblocker **if it
doesn't**, tracked there rather than here.

---

### 14. Builder / relayer SDK helpers unused — 🟢 KEEP 2026-07-27

**What's wrong:** `builderApiKey()`, `remoteBuilderSigning()`, `buildHmacSignature()`,
`relayerApiKey()` are unused. Builder code is threaded per-order; relayer auth uses an
in-house HMAC service.

**Anchors:** `apps/web/src/lib/relayer-client.ts`, `apps/web/src/hooks/use-relayer-client.ts`,
`BUILDER_SIGNING_SERVER_URL`

**Do not change:** the relayer's fail-closed create behavior is an accepted design decision.
Low priority overall.

**Resolution 2026-07-27 — keep the in-house helpers.** These four are the SDK's way of *configuring*
a client with relayer/builder credentials, which is precisely the `apiKey` we do not hold; adopting
them is the same blocker as
[the gasless invariant](#the-gasless-invariant--why-8-9-and-12-are-not-adoptable), approached from the
config side. Separately, `builderApiKey()` / `relayerApiKey()` would put a shared secret in the
browser and the extension bundle, whereas today the builder code is a public per-order field and
relayer auth is signed by a server we control. Revisit only if Polymarket issues us a
`supportGasless` key.

---

### 15. `apps/agent` duplicates the legacy interface independently — ✅ FIXED 2026-07-27

**What's wrong:** The agent declares its own `postOrder(order, orderType?)` / `getOpenOrders`
shape rather than consuming the shim's types, so it drifts independently.

**Anchors:** `apps/agent/src/live-execution.ts:95-111` (interface), `:875`, `:1028`

**Fix:** Any shim contract change (#2, #7) must include the agent, or it silently diverges.

**Partially addressed 2026-07-26:** #2 proved this exactly — the agent's private interface had
drifted into posting resting GTC orders. Its order path now uses `createMarketOrder` and its
interface declares `createMarketOrder` instead of `createOrder`.

**Closed 2026-07-27:** the hand-copied 20-line interface is gone —
`type LiveClobClient = LegacyClobCompatibleClient`, imported from the shim. The copy had already
drifted twice over: it declared a `getBalanceAllowance?` the shim never attached, and typed
`getOpenOrders` as `Promise<unknown>`. Agent tests 90/90, `tsc --noEmit` clean.

---

## Extension-specific notes

The extension bundles the shim's **source** (webpack alias at `apps/extension/webpack.config.cjs:209-211`),
loaded via dynamic import at `apps/extension/src/background/unified-clob-client.ts:26`. So:

- Shim fixes land on the next `webpack` build — no publish/version step.
- **Free for the extension:** #1, #3, #5, #7 (behavior), #4 (n/a).
- **Done:** #2 (`orderType` in the create request), #6 (four `useUnifiedSdk: false` flags gone —
  though the market-info one was a real endpoint fix, not a flag flip), #11 (`clob-open-orders.ts`
  raw cancel now on the shim).
- **Extension-only work remaining:** post-split cache poke (#3/#8), CTF planning (#8).

**Import shape matters here.** `unified-clob-client.ts:26` uses a dynamic import whose specifier
must stay a string *literal* (a variable triggers webpack's "Critical dependency: the request of
a dependency is an expression"). `clob-open-orders.ts` uses a **static** import instead, because
a classic MV3 service worker cannot fetch an async chunk at runtime. After any change here,
confirm `dist/background.js` contains zero `__webpack_require__.e(` calls and that
`STORE_BUILD=true pnpm run build:prod` still passes.

MV3 checks after touching the shim:
1. `@polymarket/client/actions` are pure `(client, request)` fetch wrappers — no DOM/`window`,
   so they're service-worker safe. Webpack 5 resolves the `exports` subpath fine.
2. Re-run the bundle gates: `apps/extension/scripts/assert-production-bundle.mjs` and
   `apps/extension/scripts/smoke-esm-modules.mjs` (both assert on bundle contents).
3. No offscreen boundary is crossed — the shim client lives in the service worker
   (`trading-handler.ts`), where `chrome.storage.session` access is available.

---

## Audit — 2026-07-28

Independent review of the full staged diff (31 files, +3064/−464) against issues #1–#15 above.
Method: five parallel review passes (doc-claims compliance, shallow bug scan, git-history
regression trace, prior-PR context, code-comment compliance), each finding then independently
re-verified against the staged code and scored for confidence; only findings that survived
verification are recorded here. The prior-PR pass could not run (`gh` CLI not installed on the
review machine) — treat that lens as not-covered, not clean.

### Verdict

The staged code matches this document's claims on every load-bearing invariant checked:

- **No `maxSpend` at any of the three market-BUY call sites** (`use-clob-client.ts`,
  `trading-handler.ts`, `live-execution.ts`), and the fee-headroom markup is gone with it —
  `MIN_MARKETABLE_BUY_TICKET_USD` equals the CLOB floor exactly ($1.00).
- **Price bounds always forwarded**: `getMarketPriceBound` (extension) and `marketOrderPrice`
  (web) both produce a real bound on partial (FAK) walks, so the shim's `optionalPriceBound`
  never silently drops to an unbounded book-walk.
- **Order type signed at create time**: FAK/FOK bakes into `createMarketOrder` on all three
  surfaces; `assertPostedOrderTypeMatches` is a no-op for GTC/GTD (signed limit orders carry no
  `orderType` string), so no false-positive throw on the limit path.
- **MV3 constraint verified empirically**, not just in source: `dist/background.js` built from
  this tree contains zero `__webpack_require__.e(` calls and `dist/chunks/` has no
  `polymarket-unified` chunk.
- **Balance/allowance attached unconditionally** with the `@polymarket/client/actions`
  fallback; the SELL sync retry ladder keeps `CLOB_BALANCE_SYNC_DELAYS_MS` unchanged and only
  changed the loop body (transient errors no longer abort — covered by new regression tests).
- **Casing sweep is complete**: no orphaned `tokenID`/`orderID`/`asset_type` callers remain
  against the narrowed interfaces; the remaining old-spelling hits are genuine wire/storage
  formats (raw DTOs, SQLite columns, public Next.js route params).
- **Reserved-collateral preflight** (`buildClobOrderPreflightPlan`) is intact and unchanged in
  shape.

One functional issue and three staleness notes below. A fourth candidate (the
`msg.orderType || "GTC"` default in `trading-handler.ts` mis-routing a hypothetical falsy-type
market order) was investigated and **refuted**: `isMarketOrderType("GTC")` is false, so the
default routes to the limit path and `assertMarketOrderType` is never reached; no live caller
omits `orderType` anyway.

### Confirmed issue (1)

**Extension partial-fill market BUY can bypass the $1-minimum guard** — confidence 100.

`apps/extension/src/content/trading/panel/order-view.ts:1719-1725` (in `addSubmitButton`):

```ts
const marketableBuyNotional = isMarketBuyAmount
  ? panelState.marketBuyAmount
  : cost;
const belowMinNotional =
  isMarketableBuy && marketableBuyNotional < MIN_MARKETABLE_BUY_TICKET_USD;
```

The guard compares the **typed** dollar amount, but the submit path
(`order-view.ts:1939`) sends `amount: cost`, where `getCost()` returns the walked
book notional (`slip.totalNotional`) — the actual signed `makerAmount`. With
"Allow partial fill" on (FAK), a $10 ticket against $0.60 of book depth passes the
guard (10 ≥ 1) but signs a $0.60 order, which the CLOB rejects server-side with the
`min size: 1` error this migration's guard exists to pre-empt. The web surface does
this correctly — `isBelowMarketableBuyMinNotional` in `use-trading-form-state.ts`
compares `calculations.total` (walked notional). This also means the claim in
issue #13's discussion that the $1 minimum "still fires correctly on a ticket that
partially fills below it" holds for web but **not** for the extension.

**Fix:** use `cost` for both branches (it already falls back to
`panelState.marketBuyAmount` when no walk is available).

**Fixed 2026-07-28:** the guard now compares `cost` directly — the ternary is gone, and the
comment above it documents why the signed (walked) notional, not the typed amount, is what
the $1 floor applies to.

### Staleness notes (verified, non-functional)

1. `apps/web/src/components/trading-form.tsx:1153-1154` — the staged diff adds a comment above
   the `Minimum order:` string saying market buys "sign fees out of the amount, so the ticket
   has to carry the fee reserve." That describes the **reverted** `maxSpend === amount` design;
   the current implementation charges fees on top and the minimum carries no reserve, as the
   sibling comments in `trading.ts` and `order-view.ts:1722-1723` correctly state. Rendered
   value is right; only the prose is wrong — but it misdocuments the maxSpend ban, which has
   caused a live regression before. **Fixed 2026-07-28** — comment rewritten to match the
   no-`maxSpend` siblings.
2. This document's "Deliberately left alone" list (issue #11 follow-up, line ~675) cites raw
   `token_id=`/`asset_type=` params at `trading-handler.ts:755-758` — that helper
   (`clobUpdateBalanceAllowance`) is deleted by this same diff's #10 fix; the anchor is stale.
   **Fixed 2026-07-28** — entry pruned from the list.
3. Same list (lines ~676-677) cites "the raw `{orderID}` DELETE body at
   `clob-open-orders.ts:154`" as left alone, contradicting the "Leftover closed 2026-07-27"
   addendum a few lines below and the staged file itself (shim `cancelOrder({orderId})` only,
   ~130 lines total). The list predates the addendum and was not pruned.
   **Fixed 2026-07-28** — entry pruned from the list.
