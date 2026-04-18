# Polymarket CLOB V2 Migration Report

Reviewed on: April 18, 2026  
Primary source: [Polymarket V2 Migration Guide](https://docs.polymarket.com/v2-migration)

## Executive Summary

Polymarket is cutting over to CLOB V2 on April 22, 2026 at approximately 11:00 UTC (approximately 16:30 IST), with roughly 1 hour of downtime. All open orders will be wiped during the cutover and must be re-placed afterward.

This repository is still materially aligned to CLOB V1:

- `@polymarket/clob-client` is still used in both web and extension packages.
- The web app still depends on `@polymarket/builder-signing-sdk`.
- Trading flows still fetch and pass `feeRateBps`.
- Builder attribution still relies on a remote signing proxy and HMAC-style builder config.
- Contract constants, approval logic, wallet token lists, and user-facing copy are still centered on `USDC.e`.

The migration is therefore not just a package bump. It requires coordinated changes across SDK initialization, order creation, builder attribution, contract constants, collateral handling, and cutover operations.

## Official V2 Changes That Matter

From the V2 migration guide:

- The SDK moves from `@polymarket/clob-client` to `@polymarket/clob-client-v2`.
- `ClobClient` construction changes from positional args to an options object, and `chainId` becomes `chain`.
- Two additional positional args also removed: `tickSizeTtlMs` and `geoBlockToken`.
- Order creation no longer accepts `feeRateBps`, `nonce`, or `taker`.
- `expiration` is removed from the raw EIP-712 signed order struct (affects manual signers only); the V2 SDK's `UserOrderV2` type still accepts `expiration` for time-bounded orders.
- V2 introduces optional `builderCode` on orders.
- Market buys can optionally pass `userUSDCBalance` so the SDK can compute fee-adjusted fills.
- Fee handling moves to protocol/match time; integrators should stop calculating or embedding fees in signed orders.
- New `getClobMarketInfo(conditionID)` method replaces `getFeeRateBps()` — returns tick size, min order size, fee details, and RFQ flag.
- Builder HMAC headers and `@polymarket/builder-signing-sdk` are removed for CLOB order attribution.
- Builder attribution becomes a single `builderCode` field; `BuilderConfig` shape changes to `{ builderCode: string }`.
- Exchange signing domain version changes from `"1"` to `"2"` for raw/manual order signing.
- L1/L2 API authentication does not change. Existing API keys continue to work.
- Onchain cancel is removed; order cancellation moves to operator-controlled `pauseUser`/`unpauseUser`.
- Collateral moves from `USDC.e` to `pUSD`. API-only integrators must call `wrap()` on the Collateral Onramp contract; polymarket.com users are handled automatically.
- WebSocket URLs and most message payloads are unchanged. The `fee_rate_bps` field on `last_trade_price` events continues to reflect actual trade fees.
- V2 SDK includes a hot-swap mechanism: it auto-detects when V2 goes live and switches without manual code changes if on the latest SDK version.
- Pre-cutover testing should target `https://clob-v2.polymarket.com`.
- After cutover, production remains `https://clob.polymarket.com`.

## Current Repo Findings

### 1. SDK usage is still V1

Current package usage:

- Root override still references `@polymarket/builder-signing-sdk` in `package.json`.
- Web app dependencies include:
  - `@polymarket/clob-client`
  - `@polymarket/builder-signing-sdk`
- Extension dependencies include:
  - `@polymarket/clob-client`

Main V1 constructor/order call sites:

- `apps/web/src/hooks/use-clob-client.ts`
- `apps/web/src/hooks/use-notifications.ts`
- `apps/web/src/hooks/use-clob-credentials.ts`
- `apps/extension/src/background/trading-handler.ts`

### 2. Order creation is still fee-rate based

The following flows still call `getFeeRateBps()` and inject `feeRateBps` into orders:

- `apps/web/src/hooks/use-clob-client.ts`
- `apps/extension/src/background/trading-handler.ts`

This is incompatible with the V2 model, where fee parameters are no longer user-settable on the order. The migration guide's documented path is to replace `getFeeRateBps()` calls with `getClobMarketInfo(conditionID)`, which returns an object with `fd` (fee details including rate, exponent, and takerOnly flag), `mts` (minimum tick size), `mos` (minimum order size), `t` (tokens), and `rfqe` (RFQ enabled). Whether `getFeeRateBps()` is literally absent from the V2 SDK or simply deprecated is not explicitly stated in the migration guide — verify against the installed package before removing call sites. Any display or calculation logic that reads fee rates should move to `getClobMarketInfo()`.

### 3. Builder attribution is still HMAC/proxy based

The repo currently maintains a full builder-signing proxy stack:

- `apps/web/src/lib/remote-builder-config.ts`
- `apps/web/src/lib/sign-proxy-url.ts`
- `apps/web/src/app/api/sign/route.ts`
- `apps/extension/src/background/builder-config.ts`

These are V1-era builder attribution mechanisms. The migration guide explicitly says CLOB order attribution should move to `builderCode`, and that `@polymarket/builder-signing-sdk` and `POLY_BUILDER_*` headers are gone for V2 orders.

### 4. Contracts and approvals are still V1-centric

Hardcoded legacy values and approval assumptions exist in:

- `packages/shared-types/src/contracts.ts`
- `apps/web/src/lib/approvals.ts`
- `apps/web/src/hooks/use-clob-client.ts`
- `apps/extension/src/background/trading-handler.ts`

Notable current assumptions:

- Main exchange: `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`
- Neg-risk exchange: `0xC5d563A36AE78145C45a50134d48A1215220f80a`
- Collateral token: `USDC.e`

The V2 migration guide shows the exchange signing addresses changing to:

- Standard exchange: `0xE111180000d2663C0091e4f400237545B87B996B`
- Neg-risk exchange: `0xe2222d279d744050d28e00520010520000310F59`

### 5. User-facing product language still assumes USDC.e everywhere

`USDC.e` is deeply embedded across the UI and extension, including:

- `apps/web/src/hooks/use-wallet-tokens.ts`
- `apps/web/src/components/trading/allowance-warning.tsx`
- `apps/web/src/hooks/use-withdraw.ts`
- `apps/web/src/components/deposit/*`
- `apps/web/src/components/withdraw-modal.tsx`
- `apps/extension/src/content/trading/trading-panel.ts`

This should be reviewed carefully against the V2 collateral model (`pUSD`).

### 6. Authentication is mostly unchanged

The migration guide explicitly says L1/L2 auth stays the same. That means these areas are lower-risk conceptually:

- `packages/shared-types/src/polymarket.ts` (`CLOB_AUTH_DOMAIN` stays version `"1"`)
- `apps/web/src/hooks/use-clob-credentials.ts`
- `apps/web/src/app/api/auth/derive-api-key/route.ts`
- `apps/extension/src/content/trading/credentials.ts`

However, any of these files that instantiate `ClobClient` still need SDK import and constructor updates.

## Required Migration Steps

### Step 1: Upgrade SDK dependencies

Replace V1 package usage first.

Required actions:

- Replace `@polymarket/clob-client` with `@polymarket/clob-client-v2`.
- Remove `@polymarket/builder-signing-sdk` from the repo where it is only used for CLOB order attribution.
- Refresh `pnpm-lock.yaml`.

Primary files:

- `package.json`
- `apps/web/package.json`
- `apps/extension/package.json`
- `pnpm-lock.yaml`

Expected outcome:

- All direct CLOB imports resolve from the V2 package.
- Legacy builder-signing dependency is removed from the web app if no longer needed elsewhere.

### Step 2: Refactor all `ClobClient` construction to V2 options-object form

The guide calls this the most visible SDK change.

Required actions:

- Refactor every `new ClobClient(...)` positional construction into the V2 options object.
- Rename `chainId` usage to `chain`.
- Remove `tickSizeTtlMs` from any config (it is gone in V2).
- Remove `geoBlockToken` from any config (also removed in V2, confirmed by the official guide).

Primary files:

- `apps/web/src/hooks/use-clob-client.ts`
- `apps/web/src/hooks/use-notifications.ts`
- `apps/web/src/hooks/use-clob-credentials.ts`
- `apps/extension/src/background/trading-handler.ts`

Validation:

- Public/read-only client creation still works.
- Authenticated client creation still works for proxy wallet users.
- Notification fetches and read-only key operations still work.

### Step 3: Rewrite order creation for V2

This is a required behavioral change.

Required actions:

- Remove `getFeeRateBps()` calls from order placement flows. Replace any downstream usage with `getClobMarketInfo(conditionID)`, which returns `mts` (min tick size), `mos` (min order size), and `fd` (fee details).
- Stop passing `feeRateBps` into limit and market order creation.
- Do not attempt to manage order nonces. V2 uses `timestamp` (milliseconds) for uniqueness; the SDK sets this automatically.
- `expiration` is removed from the raw EIP-712 signed struct (relevant for anyone doing manual EIP-712 signing outside the SDK). The V2 SDK's `UserOrderV2` type still accepts `expiration` as a user-facing parameter — continue passing it for time-bounded orders as before. Do not remove it from SDK-level order construction.
- Add optional `builderCode` where attribution is desired.
- For market BUY orders, consider passing `userUSDCBalance` to improve fee-adjusted amount calculations.

Primary files:

- `apps/web/src/hooks/use-clob-client.ts`
- `apps/extension/src/background/trading-handler.ts`

Validation:

- Limit orders still post correctly.
- Market BUY and SELL orders still compute expected size/cost.
- Neg-risk order flow still signs against the correct exchange context.

### Step 4: Replace builder HMAC flow with `builderCode`

For CLOB order attribution, the current proxy-based signing model should be removed or significantly simplified.

Required actions:

- Remove `POLY_BUILDER_*` request-header assumptions from CLOB order flows. Removed headers include: `POLY_BUILDER_API_KEY`, `POLY_BUILDER_SECRET`, `POLY_BUILDER_PASSPHRASE`, `POLY_BUILDER_SIGNATURE`.
- Replace remote/local builder-signing configuration with `builderCode`.
- `builderCode` is a public `bytes32` identifier obtained from the Polymarket Builder Profile at https://polymarket.com/settings?tab=builder. It is not a secret and should be stored in a plain env var such as `POLY_BUILDER_CODE`.
- The V2 `BuilderConfig` shape is simply `{ builderCode: string }`. The full signing proxy stack (`remote-builder-config.ts`, `sign-proxy-url.ts`, `api/sign/route.ts`) is no longer required for CLOB order attribution.
- Pass `builderCode` either:
  - per order (in the order params), or
  - once at client construction via V2 `builderConfig: { builderCode: string }`
- Verify builder attribution at https://builders.polymarket.com after testing on the V2 preprod endpoint.

Likely impacted files:

- `apps/web/src/lib/remote-builder-config.ts`
- `apps/web/src/lib/sign-proxy-url.ts`
- `apps/web/src/app/api/sign/route.ts`
- `apps/extension/src/background/builder-config.ts`
- `apps/web/src/hooks/use-clob-client.ts`

Important note:

The migration guide is explicit for CLOB orders. This repo also uses relayer flows (`RelayClient` from `@polymarket/builder-relayer-client`) for gasless operations across three hooks: `use-relayer-client.ts`, `use-ctf-operations.ts`, and `use-withdraw.ts`, plus `apps/extension/src/background/relayer-client.ts` in the extension. Those flows need a separate confirmation pass because the relayer SDK may have its own V2 migration path. Do not remove relayer-side auth code until the latest relayer SDK/docs are confirmed.

### Step 5: Update raw/manual signing assumptions and contract references

If any part of the system inspects signed orders or depends on exchange addresses, those assumptions must move to V2.

Required actions:

- Update any code that depends on old exchange verifying contracts.
- Update any code that inspects raw order fields and assumes:
  - `nonce`
  - `feeRateBps`
  - `taker`
- Account for new raw order fields:
  - `timestamp`
  - `metadata`
  - `builder`
- If there is any manual EIP-712 order signing outside the SDK, change exchange domain version from `"1"` to `"2"`.

Primary files to review:

- `packages/shared-types/src/contracts.ts`
- `apps/web/src/hooks/use-clob-client.ts`
- `apps/extension/src/background/trading-handler.ts`

### Step 6: Resolve the `USDC.e` to `pUSD` collateral transition

This is the broadest repo-wide product change.

Required actions:

- Replace hardcoded trading-collateral assumptions that say Polymarket trading uses `USDC.e`.
- Review approval targets and allowance checks against the V2 collateral design.
- Review wallet balances, deposit flows, withdrawal flows, bridge copy, and trading warnings.
- **For API-only integrators (including the extension):** The migration guide states that API-only traders should call `wrap()` on the Collateral Onramp contract to convert USDC.e → pUSD before trading; polymarket.com users are handled automatically by the frontend. Whether this wrapping must live directly in the app (e.g. in `trading-handler.ts`) or can be delegated to another service (relayer, bridge, etc.) is an implementation decision that should be confirmed against the relayer V2 docs and the pUSD wrapping flow. See Polymarket docs at `/concepts/pusd` and `/resources/contracts` for the Collateral Onramp address and available wrapping methods.
- Add the canonical pUSD token address to `packages/shared-types/src/contracts.ts` once confirmed from `/resources/contracts`.
- Confirm whether CTF split/merge/redeem and bridge flows remain externally `USDC.e`-oriented or now require explicit `pUSD` wrapping/unwrapping in app logic.

Primary files:

- `packages/shared-types/src/contracts.ts`
- `apps/web/src/lib/approvals.ts`
- `apps/web/src/hooks/use-wallet-tokens.ts`
- `apps/web/src/hooks/use-withdraw.ts`
- `apps/web/src/components/trading/allowance-warning.tsx`
- `apps/web/src/components/trading/balance-warning.tsx`
- `apps/web/src/components/deposit/*`
- `apps/web/src/components/withdraw-modal.tsx`
- `apps/extension/src/content/trading/trading-panel.ts`
- `apps/extension/src/background/trading-handler.ts`

Important caution:

While the migration guide says collateral becomes `pUSD`, other Polymarket docs pages and search snippets still surfaced `USDC.e` for bridge/CTF flows when this report was prepared. Treat the migration guide as the source of truth for the cutover, but validate bridge and CTF behavior against the latest contract/docs before mass-renaming every `USDC.e` path.

### Step 6b: Audit cancel-order flows against the new cancellation model

Onchain order cancellation is removed in V2. The exchange now uses operator-controlled `pauseUser`/`unpauseUser`. Search the codebase for any call to `client.cancelOrder()`, `client.cancelOrders()`, or similar, and confirm whether the V2 SDK provides equivalent methods or whether the behaviour has fundamentally changed.

### Step 6c: Review `@polymarket/order-utils` usage

Both `apps/web/package.json` and `apps/extension/package.json` depend on `@polymarket/order-utils@3.0.1`. This package is not addressed in the current migration report. If it contains order-construction helpers, EIP-712 type definitions, or address constants, it may need a V2-compatible version bump alongside the client upgrade. Audit all `@polymarket/order-utils` imports and confirm whether a V2 build of the package is available or required.

### Step 7: Keep auth flows intact, but update SDK imports/usages

The guide says API auth is unchanged, so avoid unnecessary rewrites here.

Required actions:

- Preserve the existing L1 auth message/domain logic unless newer official docs say otherwise.
- Keep API-key creation/derivation behavior intact.
- Only adjust package imports and client construction where needed.

Primary files:

- `packages/shared-types/src/polymarket.ts`
- `apps/web/src/hooks/use-clob-credentials.ts`
- `apps/web/src/app/api/auth/derive-api-key/route.ts`
- `apps/extension/src/content/trading/credentials.ts`

### Step 8: Test against preprod and plan cutover-day operations

Required actions:

- Test against `https://clob-v2.polymarket.com` before April 22, 2026.
- Exercise:
  - API key derivation
  - limit order placement
  - market BUY
  - market SELL
  - open-order fetch
  - notifications
  - neg-risk orders
  - wallet/approval flows
  - builder attribution
- Verify order attribution appears on the Builder Leaderboard if builder tracking is required.
- Prepare operational handling for the order-book wipe.

Cutover-day checklist:

- Deploy V2-compatible code before April 22, 2026 11:00 UTC.
- Pause any automation that expects V1 order persistence.
- Re-create all required resting orders after the maintenance window.
- Monitor Polymarket Status, Discord, and production error logs during the first hour after cutover.

## Suggested Execution Order

1. Upgrade dependencies and compile against the V2 SDK.
2. Refactor all `ClobClient` constructors.
3. Rewrite order creation to remove `feeRateBps`.
4. Replace CLOB builder attribution with `builderCode`.
5. Update contract/address assumptions.
6. Validate collateral behavior (`pUSD` vs `USDC.e`) before broad UI copy changes.
7. Run preprod regression tests on `clob-v2.polymarket.com`.
8. Prepare cutover operational runbook for order re-placement.

## Repo-Specific High-Risk Areas

- `apps/web/src/hooks/use-clob-client.ts`
  - Central trading hook; combines constructor shape, fee handling, approvals, balances, and order posting.
- `apps/extension/src/background/trading-handler.ts`
  - Mirrors the same V1 assumptions in extension trading. Also the highest-risk path for pUSD `wrap()` since extension users are API-only.
- `apps/web/src/lib/remote-builder-config.ts` and `apps/web/src/app/api/sign/route.ts`
  - Likely removable or heavily reduced for CLOB order attribution.
- `packages/shared-types/src/contracts.ts`
  - Single source of truth for trading-contract assumptions. Needs pUSD address and new exchange addresses.
- `apps/web/src/hooks/use-withdraw.ts` and `apps/extension/src/content/trading/trading-panel.ts`
  - Heavy `USDC.e` product assumptions that may no longer match V2 collateral semantics.
- `apps/web/src/hooks/use-relayer-client.ts`, `apps/web/src/hooks/use-ctf-operations.ts`, `apps/extension/src/background/relayer-client.ts`
  - All instantiate `RelayClient` with V1-era `BuilderConfig`. Need separate verification once relayer V2 migration path is confirmed.
- `@polymarket/order-utils@3.0.1` (both packages)
  - Not yet assessed for V2 compatibility. May contain hardcoded V1 order struct types or addresses.

## Open Questions To Resolve Before Coding

1. Does Polymarket provide a V2-compatible relayer flow that still needs builder auth, or does relayer usage also move to a simpler builder-code model? (Check latest `@polymarket/builder-relayer-client` release notes.)
2. What is the canonical `pUSD` token address for production? (See `/resources/contracts` on the Polymarket docs site.) What is the Collateral Onramp contract address for `wrap()` calls?
3. Do bridge deposit/withdraw flows remain `USDC.e`-based externally while trading settles internally in `pUSD`, or do the bridge APIs themselves change?
4. Are there any internal services or backend jobs outside this repo that also place/cancel Polymarket orders and must be migrated in parallel?
5. Does `@polymarket/order-utils` have a V2 release? If so, what changed? If not, does the repo use any of its types/helpers in ways that conflict with V2 order structs (`timestamp`, `metadata`, `builder` replacing `nonce`, `feeRateBps`, `taker`)?
6. What is the V2 SDK's equivalent for cancel-order flows? Does `client.cancelOrder()` still work in `@polymarket/clob-client-v2`, or is cancellation now purely operator-driven?
7. Does the V2 SDK's hot-swap mechanism work transparently for this app (i.e., will switching to `clob-client-v2` be sufficient), or is manual cutover coordination still required for the extension's service worker context?

## Bottom Line

This repo is not yet ready for the April 22, 2026 CLOB V2 cutover.

The minimum required work is:

- move to `@polymarket/clob-client-v2`
- refactor all `ClobClient` construction
- remove `feeRateBps`-based order creation
- replace builder HMAC signing with `builderCode` for CLOB orders
- update exchange/collateral assumptions
- test end-to-end on `https://clob-v2.polymarket.com`

Without those changes, order placement will fail after cutover and any open-order restoration process will also break.

## References

- [Polymarket CLOB V2 Migration Guide](https://docs.polymarket.com/v2-migration)
- [Polymarket Status](https://status.polymarket.com)
- [Polymarket Builder Profile](https://polymarket.com/settings?tab=builder)
