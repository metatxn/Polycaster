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
- Migrating the relayer flow (`@polymarket/builder-relayer-client`) to anything new. The V2 migration guide is CLOB-only; the relayer SDK has no V2 release. Relayer-side `BuilderConfig` stays.
- Removing `@polymarket/builder-signing-sdk` from relayer-only call sites (it's still imported by the relayer signing path).

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

Each step is a single commit on the feature branch.

### Step 1 — Dependency surgery

**Files:**
- `package.json` (root): keep `@polymarket/builder-signing-sdk@1.0.0` override (still used by relayer signing path).
- `apps/web/package.json`: replace `@polymarket/clob-client@5.8.1` → `@polymarket/clob-client-v2@1.0.0`. Remove `@polymarket/order-utils@3.0.1`. Keep `@polymarket/builder-signing-sdk@1.0.0` and `@polymarket/builder-relayer-client@0.0.8`.
- `apps/extension/package.json`: replace `@polymarket/clob-client@5.8.1` → `@polymarket/clob-client-v2@1.0.0`. Remove `@polymarket/order-utils@3.0.1`.
- `pnpm-lock.yaml`: refreshed via `pnpm install`.

**Validation:** `pnpm install` succeeds. `pnpm -r build` may break in this commit because of import-name changes — that's fine, Step 2 fixes it.

### Step 2 — Constructor refactor

**Web call sites:**
- `apps/web/src/hooks/use-clob-client.ts:112` (authenticated client)
- `apps/web/src/hooks/use-clob-client.ts:410` (unauthenticated fee-rate client)
- `apps/web/src/hooks/use-notifications.ts:120` (notifications client)
- `apps/web/src/hooks/use-clob-credentials.ts:341, 468, 629` (3 sites for credential derivation)

**Extension call sites:**
- `apps/extension/src/background/trading-handler.ts:323` (authenticated)
- `apps/extension/src/background/trading-handler.ts:446` (unauthenticated)

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
  builderConfig,  // shape changes in Step 4
})
```

**Static-import conversion:** `apps/extension/src/background/trading-handler.ts:29` is a static `import { ClobClient } from "@polymarket/clob-client"`. V2 is ESM-only; convert to dynamic `await import("@polymarket/clob-client-v2")` to match the rest of the codebase and avoid bundler issues in the extension service worker.

**Validation:** `pnpm -r typecheck` passes.

### Step 3 — Order creation cleanup

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

### Step 4 — Builder attribution swap

**New environment variable:** `POLY_BUILDER_CODE` (a public bytes32 value from the Builder Profile page; not a secret).
- Web: add to `apps/web/.env.local.example` and Vercel/hosting envs as `NEXT_PUBLIC_POLY_BUILDER_CODE` (needs to be readable in the browser).
- Extension: add to `apps/extension/.env.example` as `VITE_POLY_BUILDER_CODE`.

**ClobClient construction** (Step 2 sites): pass `builderConfig: { builderCode: process.env.NEXT_PUBLIC_POLY_BUILDER_CODE }` (or extension equivalent) when the env var is set; omit otherwise.

**Files to delete (CLOB-only proxy stack):**
- `apps/web/src/lib/remote-builder-config.ts`
- `apps/web/src/lib/sign-proxy-url.ts`
- `apps/web/src/app/api/sign/route.ts`
- `apps/extension/src/background/builder-config.ts`

**Files to update (relayer still uses BuilderConfig):**
- The 3 relayer-using web hooks (`use-relayer-client.ts`, `use-ctf-operations.ts`, `use-withdraw.ts`) currently import their relayer `BuilderConfig` factory from `apps/web/src/lib/remote-builder-config.ts`. Since that file is being deleted, introduce a new minimal helper at `apps/web/src/lib/relayer-builder-config.ts` containing only what the relayer needs (the HMAC signing path), and switch the 3 hooks to import from it.
- `apps/extension/src/background/relayer-client.ts` — already self-contained; verify no leftover import of `builder-config.ts`.
- Keep `@polymarket/builder-signing-sdk@1.0.0` as a dependency. The relayer flow still needs both its types and its signing helpers.

**Validation:** Builder attribution shows up at https://builders.polymarket.com after a test order on preprod.

### Step 5 — Contract address update

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

**Approval-list update:** Wherever the code today approves USDC.e to the CLOB exchanges, switch to approving **pUSD** to the V2 exchanges. USDC.e approvals to the **CollateralOnramp** are added separately (Step 6).

### Step 6 — pUSD wrap-on-trade

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

### Step 7 — Preprod testing

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

### Step 8 — Cutover-day deployment

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
| ESM-only SDK breaks Next.js bundle | Low | Codebase already uses dynamic `import()` for clob-client; one static import gets converted |
| Relayer SDK breaks because builder-signing-sdk types change | Low | Pin builder-signing-sdk to current `1.0.0`; relayer flow not touched |
| pUSD wrapping during a trade fails partway | Medium | Use single relayer batch (atomic); on failure, surface error and don't post the order |
| Existing approvals not migrated; users hit "insufficient allowance" on first post-cutover trade | High | Step 6 adds pUSD-to-V2-exchange approvals to the first-time approval batch; existing users will trigger a one-time re-approval |
| `NEXT_PUBLIC_POLY_BUILDER_CODE` not set in prod | Low | Code path falls back to no-attribution (orders still post, just unattributed); add a deploy checklist item |
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
