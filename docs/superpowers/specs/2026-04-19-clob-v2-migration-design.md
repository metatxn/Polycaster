# Polymarket CLOB V2 Migration — Design Spec

**Date:** 2026-04-19
**Cutover deadline:** 2026-04-22 ~11:00 UTC (Polymarket maintenance window, ~1 hour)
**Scope:** Cutover-survival migration for both `apps/web` and `apps/extension`. UI copy refresh and bridge audit deferred to follow-up branches.

## 1. Goals & Non-Goals

### Goals

- Order placement (limit + market BUY/SELL), cancel, open-orders fetch, notifications, and builder attribution all continue to work for web and extension users after the V2 cutover.
- Code compiles, type-checks, and runs against `https://clob-v2.polymarket.com` for preprod validation, then against `https://clob.polymarket.com` for production.
- Each commit on the feature branch is independently reviewable and leaves the build green, so we can stop early if blocked and still ship a partial improvement.

### Non-Goals (deferred to follow-up branches)

- Renaming `USDC.e` → `pUSD` in user-facing copy across deposit, withdraw, balance, and trading-warning components.
- Bridge deposit/withdraw flow audit. Bridges remain externally `USDC.e`-oriented; we only touch CLOB collateral.
- Migrating the relayer SDK (`@polymarket/builder-relayer-client@0.0.8`) to a newer version (none exists yet) or rewriting the extension's hand-rolled relayer client (`apps/extension/src/background/relayer-client.ts`).
- Changing how relayer requests are authenticated. The HMAC `BuilderConfig` flow that goes through `/api/sign` stays intact for relayer use.
- Removing `@polymarket/builder-signing-sdk` from relayer-only call sites.

**Note:** The relayer's *transport and auth* are unchanged, but Step 6 *uses* the relayer to send new types of transactions (approve USDC.e to Onramp, wrap USDC.e → pUSD). That is a relayer payload change, not a relayer infrastructure change. The risk model for Step 6 is documented in Section 6.

## 2. Pre-Migration Verified Facts

These were unverified assumptions in the report and were confirmed during pre-flight investigation:

| Assumption | Status |
|---|---|
| `@polymarket/clob-client-v2@1.0.0` exists on npm | Confirmed |
| Package is ESM-only (`"type": "module"`) | Confirmed — codebase already uses dynamic `import()` for 5/6 V1 sites; one static import in extension needs conversion |
| `getFeeRateBps(tokenID)` still exists in V2 | Confirmed (`client.d.ts:56`) — we stop *passing* fee into orders; the method itself is fine for display |
| `cancelOrder`, `cancelOrders`, `cancelAll`, `cancelMarketOrders` all still exist | Confirmed (`client.d.ts:108-111`) — no cancel-flow changes needed |
| `UserOrderV2.expiration` still accepted by SDK | Confirmed (`ordersV2.d.ts`) — keep `expiration` on order construction; only the raw EIP-712 signed struct dropped it |
| `createOrder` accepts `UserOrderV1 \| UserOrderV2` | Confirmed — backward compat is real, but we move to V2 shapes anyway |
| `BuilderConfig = { builderCode: string }` | Confirmed (`clob.d.ts:8`) |
| V2 SDK exports `getContractConfig(chainID)` with `exchangeV2`/`negRiskExchangeV2`/`collateral` (pUSD) baked in | Confirmed (`config.js`) — we may import addresses from the SDK rather than re-hardcoding |
| `@polymarket/order-utils@3.0.1` is unused in source | Confirmed — phantom dep, safe to remove |
| pUSD: `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` | Confirmed via docs.polymarket.com/resources/contracts |
| CollateralOnramp: `0x93070a847efEf7F70739046A929D47a521F5B8ee` with `wrap(asset, _to, amount)` | Confirmed via docs.polymarket.com/concepts/pusd |

## 3. Architecture Overview

The change touches three layers:

1. **Dependency layer** — `@polymarket/clob-client` → `@polymarket/clob-client-v2`; `@polymarket/order-utils` removed; `@polymarket/builder-signing-sdk` and `@polymarket/builder-relayer-client` retained for relayer-only paths.

2. **CLOB integration layer** — All `ClobClient` instantiation sites (5 in web, 2 in extension) refactor from positional args to options object. All `createOrder`/`createMarketOrder` call sites stop passing `feeRateBps`/`nonce`/`taker`. Builder attribution stops going through the `/api/sign` proxy and starts being a single `builderCode` string passed to the SDK.

3. **Collateral layer** — Approval logic and trading flows switch from approving USDC.e → pUSD on the V2 exchange contracts. A wrap-on-trade helper checks pUSD balance and prepends a `wrap()` call to the relayer batch when the user has USDC.e but no pUSD.

The relayer flow (`use-relayer-client.ts`, `use-ctf-operations.ts`, `use-withdraw.ts`, extension `relayer-client.ts`) is **untouched** in this migration. Its builder auth, signing flow, and SDK version stay the same.

## 4. Step-by-Step Component Design

Each step is a single commit on the feature branch. Every commit must leave `pnpm -r build` and `pnpm -r typecheck` green so we can revert any single step in isolation.

### Step 1 — Dependency swap + constructor refactor (single commit)

Bundling these together because changing the import name to `@polymarket/clob-client-v2` will break compilation until the constructor calls are also updated. Splitting them would leave one commit with a broken build.

**Dependency changes:**
- `apps/web/package.json`: replace `@polymarket/clob-client@5.8.1` → `@polymarket/clob-client-v2@1.0.0`. Remove unused `@polymarket/order-utils@3.0.1`. Keep `@polymarket/builder-signing-sdk@1.0.0` and `@polymarket/builder-relayer-client@0.0.8`.
- `apps/extension/package.json`: replace `@polymarket/clob-client@5.8.1` → `@polymarket/clob-client-v2@1.0.0`. Remove `@polymarket/order-utils@3.0.1`.
- `package.json` (root): keep `@polymarket/builder-signing-sdk@1.0.0` override.
- `pnpm-lock.yaml`: refreshed via `pnpm install`.

**Web call sites to refactor:**
- `apps/web/src/hooks/use-clob-client.ts:98, 112, 409` (authenticated + read-only)
- `apps/web/src/hooks/use-notifications.ts:102, 120`
- `apps/web/src/hooks/use-clob-credentials.ts:341, 468, 629`

**Extension call sites to refactor:**
- `apps/extension/src/background/trading-handler.ts:29, 323, 446`

**Refactor pattern:**

```ts
// before (V1)
new ClobClient(host, chainId, signer, creds, sigType, funder, undefined, false, builderConfig)

// after (V2)
new ClobClient({
  host,
  chain: chainId,
  signer,
  creds,
  signatureType: sigType,
  funderAddress: funder,
  builderConfig,  // SHAPE STILL OLD HERE — Step 4 swaps to { builderCode }
})
```

**Static-import conversion:** `apps/extension/src/background/trading-handler.ts:29` is a static `import { ClobClient } from "@polymarket/clob-client"`. V2 is ESM-only; convert to dynamic `await import("@polymarket/clob-client-v2")` to match the rest of the codebase.

**Builder-config compatibility note:** This commit keeps the existing `BuilderConfig` (from `remote-builder-config.ts` / `createExtensionBuilderConfig`) wired into the V2 ClobClient. The V2 SDK's `BuilderConfig` interface is only `{ builderCode: string }`, so the legacy proxy-signing config will *type-mismatch*. We resolve this by casting through `unknown` at the construction site as a temporary measure. Step 4 properly replaces the value. Without this temporary cast, the build breaks until Step 4 — which is the trade-off here. If the cast is unacceptable, fold Step 4 into this commit too.

**Validation:** `pnpm -r typecheck` and `pnpm -r build` both pass.

### Step 2 — Order creation cleanup

**Files:**
- `apps/web/src/hooks/use-clob-client.ts` — remove `feeRateBps` from `createOrder` and `createMarketOrder` call sites; drop the `getFeeRateBps()` pre-call that fetches and injects it. Add optional `builderCode` and `userUSDCBalance` (market BUY only).
- `apps/extension/src/background/trading-handler.ts` — same cleanup.

**Note:** `getFeeRateBps()` itself is still callable for display purposes. We just stop *passing* its return value into order params.

**Order shape (V2):**

```ts
const order: UserOrderV2 = {
  tokenID, price, size, side,
  expiration,           // keep — defaults to 0 (no expiry)
  builderCode,          // new — optional, set when env var present
};

const marketOrder: UserMarketOrderV2 = {
  tokenID, amount, side, orderType,
  userUSDCBalance,      // new — pass when known, enables fee-aware fills
  builderCode,
};
```

**Validation:** Type-check passes. SDK accepts the order shapes (they're typed).

### Step 3 — Builder attribution swap (CLOB-side only)

**Critical:** The `/api/sign` route and the `RemoteBuilderConfig` / `createExtensionBuilderConfig` helpers are *also* used by the relayer flow for HMAC-signed relayer headers. The relayer's secret cannot live in the browser, so the proxy route must stay alive. **Do not delete those files in this step.** Only swap the value passed into `ClobClient`.

**New environment variable:** `POLY_BUILDER_CODE` (a public bytes32 value from the Builder Profile page; not a secret).
- Web: add to `apps/web/.env.local.example` and hosting/CI as `NEXT_PUBLIC_POLY_BUILDER_CODE` so it's readable in the browser bundle.
- Extension: add to `apps/extension/.env.example` as `POLY_BUILDER_CODE`. Inject it via webpack `DefinePlugin` in `apps/extension/webpack.config.js` by adding:
  ```js
  "process.env.POLY_BUILDER_CODE": JSON.stringify(process.env.POLY_BUILDER_CODE || ""),
  ```
  Then read `process.env.POLY_BUILDER_CODE` in extension code. (Webpack already runs `dotenv.config()` so a local `.env` works in dev.)

**ClobClient construction changes** (the 5+2 sites from Step 1):
- Replace the existing legacy `builderConfig` argument with the V2 shape:
  ```ts
  builderConfig: builderCode ? { builderCode } : undefined
  ```
  where `builderCode` is read from the env var above.
- Remove the `unknown`-cast that Step 1 introduced as a temporary measure.

**Files left alone (still needed for relayer):**
- `apps/web/src/lib/remote-builder-config.ts` — keep; relayer hooks (`use-relayer-client.ts`, `use-ctf-operations.ts`, `use-withdraw.ts`) still call `createBuilderConfig()` for their HMAC signing.
- `apps/web/src/lib/sign-proxy-url.ts` — keep; resolves `/api/sign` URL.
- `apps/web/src/app/api/sign/route.ts` — keep; the relayer's HMAC headers are still signed server-side.
- `apps/extension/src/background/builder-config.ts` — keep; extension relayer (`relayer-client.ts:24, 212`) imports `createExtensionBuilderConfig` for relayer auth.
- `@polymarket/builder-signing-sdk@1.0.0` — keep as a dependency.

**Optional cleanup (out of scope for cutover-survival):** Once the relayer SDK gets a V2 release, the entire HMAC proxy stack can be removed. That's a follow-up branch.

**Validation:** Builder attribution shows up at https://builders.polymarket.com after a test order on preprod. Relayer-backed flows (CTF split/merge/redeem, withdraw, Safe deploy) still work.

### Step 4 — Contract address update

**File:** `packages/shared-types/src/contracts.ts`

```ts
// Updated V2 exchange addresses
export const CTF_EXCHANGE_ADDRESS = "0xE111180000d2663C0091e4f400237545B87B996B";
export const NEG_RISK_CTF_EXCHANGE_ADDRESS = "0xe2222d279d744050d28e00520010520000310F59";

// New: pUSD collateral and Onramp
export const PUSD_ADDRESS = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
export const PUSD_DECIMALS = 6;
export const COLLATERAL_ONRAMP_ADDRESS = "0x93070a847efEf7F70739046A929D47a521F5B8ee";

// Keep USDC.e — bridge and Onramp input still use it
export const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
export const USDC_E_DECIMALS = 6;
```

**Approval-list update:** Wherever the code today approves USDC.e to the CLOB exchanges, switch to approving **pUSD** to the V2 exchanges. USDC.e approvals to the **CollateralOnramp** are added separately (Step 5).

### Step 5 — pUSD wrap-on-trade

The CLOB V2 exchange settles in pUSD. Today the proxy wallet (Safe) holds USDC.e. We need to convert before trading.

**Approach:** Detect-and-wrap inside the existing trading flows, executed via the relayer (so the user pays no gas).

**Web flow** (`apps/web/src/hooks/use-clob-client.ts` + `use-relayer-client.ts`):
- Before any order placement, check pUSD balance of `proxyAddress`.
- If pUSD balance < required collateral AND USDC.e balance ≥ shortfall, build a relayer batch:
  1. `approve(USDC_E, COLLATERAL_ONRAMP_ADDRESS, shortfall)` — only if allowance < shortfall.
  2. `wrap(USDC_E, proxyAddress, shortfall)` on `COLLATERAL_ONRAMP_ADDRESS`.
- After batch confirms, post the order.

**Extension flow** (`apps/extension/src/background/trading-handler.ts` + `relayer-client.ts`):
- Same logic, executed through the extension's existing relayer client.

**Approval flow update** (`apps/web/src/lib/approvals.ts`, `use-clob-client.ts`):
- Replace the V1 approval set (USDC.e → V1 exchanges) with the V2 set: `USDC.e → CollateralOnramp`, `pUSD → CTF Exchange V2`, `pUSD → Neg Risk Exchange V2`. All max-uint256, matching the existing pattern.
- The pre-V2 USDC.e-to-V1-exchange approvals on chain are harmless after cutover (the V1 exchanges are dead). We do not need to revoke them.
- A first-time post-cutover trade by an existing user will trigger a one-time re-approval batch.

**Validation:** First trade by a fresh user goes through approve → wrap → place order in a single user interaction.

### Step 6 — Preprod testing

**Switch hosts:** Set `NEXT_PUBLIC_POLYMARKET_HOST=https://clob-v2.polymarket.com` in web `.env.local` and the extension equivalent.

**Manual smoke matrix** (run for both web and extension):

| Test | Pass criterion |
|---|---|
| Limit order BUY | Order appears in open orders |
| Limit order SELL | Order appears in open orders |
| Market order BUY (FOK) | Fill returned, balance updates |
| Market order SELL (FOK) | Fill returned, balance updates |
| Cancel single order | Order removed from open orders |
| Open orders fetch | Returns user's orders |
| Notifications fetch | Returns notifications |
| Neg-risk market trade | Order signs against neg-risk V2 exchange |
| First-trade approve+wrap | Single relayer batch covers approval, wrap, and order |
| Builder attribution | Order appears under our builder code at builders.polymarket.com |
| API key derivation | New users can derive credentials |
| Relayer-backed CTF op | Existing CTF split/merge/redeem still works (regression check on Step 3 cleanup) |
| Relayer-backed withdraw | Existing withdraw flow still works (regression check on Step 3 cleanup) |

### Step 7 — Cutover-day deployment

**Pre-cutover:**
- Switch hosts back to `https://clob.polymarket.com` in production env vars.
- Deploy web + extension before 2026-04-22 11:00 UTC.
- Surface a banner: "Polymarket maintenance 11:00–12:00 UTC. All open orders will be cleared."

**During cutover (~1 hour):**
- Trading endpoints will 5xx. Don't auto-retry aggressively.
- Pause any in-app polling that's not strictly needed.

**Post-cutover:**
- Smoke-test one trade in production.
- Monitor Polymarket Status, Discord, and our error logs for the first hour.
- Communicate to users: open orders need to be re-placed.

## 5. Rollback Plan

- The feature branch is sequential commits; each commit compiles. If a step breaks something we don't catch in preprod, revert that step's commit and redeploy.
- The migration cannot be partially rolled back after April 22 — V1 endpoints stop working. The only post-cutover rollback is forward-fix.
- Pre-cutover (before April 22), full rollback = revert the feature branch merge to main.

## 6. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| ESM-only SDK breaks Next.js bundle | Low | Codebase already uses dynamic `import()` for clob-client in 5/6 sites; one static extension import gets converted in Step 1 |
| Step 3 deletes a file the relayer needs | Medium | Step 3 explicitly leaves `remote-builder-config.ts`, `sign-proxy-url.ts`, `/api/sign`, and `builder-config.ts` in place; only the *value passed to ClobClient* changes. Step 6 includes regression tests for relayer flows |
| Relayer SDK breaks because builder-signing-sdk types change | Low | Pin builder-signing-sdk to current `1.0.0`; relayer flow not touched |
| Step 5 adds wrap+approve transactions to relayer batches that the relayer/Safe rejects | Medium | The relayer already executes arbitrary calls via Safe `multiSend` (see `relayer-client.ts:66-90`); wrap+approve are vanilla ERC-20/Onramp calls. Smoke-test on preprod before cutover |
| pUSD wrapping during a trade fails partway | Medium | Use single relayer batch (atomic via `multiSend`); on failure, surface error and don't post the order |
| Existing approvals not migrated; users hit "insufficient allowance" on first post-cutover trade | High | Step 5 adds pUSD-to-V2-exchange approvals to the first-time approval batch; existing users trigger a one-time re-approval |
| `POLY_BUILDER_CODE` not set in prod env | Low | Code path falls back to no-attribution (orders still post, just unattributed); add a deploy checklist item |
| Webpack `DefinePlugin` not updated; extension can't read `POLY_BUILDER_CODE` | Low | Step 3 explicitly updates `apps/extension/webpack.config.js`; smoke-tested by builder leaderboard check on extension trade |
| Order-book wipe at cutover surprises users | High (UX) | Pre-cutover banner + post-cutover messaging |

## 7. Open Items After Spec Approval

- Confirm with stakeholders: do we have a builder code? If not, Step 4 still works (no env var = no attribution); we can add it later without code changes.
- Decide: is web + extension a single PR or two? Recommend single PR since the changes are coupled (shared-types + similar refactors).
- Plan post-cutover follow-up branches: (a) UI copy USDC.e → pUSD, (b) bridge audit, (c) relayer V2 migration when SDK ships.

## 8. References

- [Polymarket V2 Migration Guide](https://docs.polymarket.com/v2-migration)
- [Polymarket Contracts](https://docs.polymarket.com/resources/contracts)
- [pUSD Concept](https://docs.polymarket.com/concepts/pusd)
- [Builder Profile](https://polymarket.com/settings?tab=builder)
- [Builder Leaderboard](https://builders.polymarket.com)
- Repo report: `polymarket-v2-migration-report.md`
