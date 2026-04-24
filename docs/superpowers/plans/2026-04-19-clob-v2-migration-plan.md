# Polymarket CLOB V2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `apps/web` and `apps/extension` from Polymarket CLOB V1 (`@polymarket/clob-client@5.8.1`) to V2 (`@polymarket/clob-client-v2@1.0.0`) before the 2026-04-22 cutover, so order placement/cancel/fetch and builder attribution keep working.

**Architecture:** Keep relayer transport/auth (HMAC via `/api/sign`) intact. Swap CLOB SDK only. Switch CLOB collateral approvals from USDC.e → pUSD on V2 exchange addresses. Add a wrap-on-trade step that converts USDC.e → pUSD through the existing relayer batch (atomic via Safe `multiSend`) when the user is short pUSD.

**Tech Stack:** TypeScript, Next.js 15 (web), webpack-built Chrome extension (MV3), pnpm workspaces, viem (web reads), ethers v5 (extension/relayer), `@polymarket/clob-client-v2@1.0.0`, `@polymarket/builder-relayer-client@0.0.8` (unchanged), `@polymarket/builder-signing-sdk@1.0.0` (unchanged, relayer use only).

**Spec:** [docs/superpowers/specs/2026-04-19-clob-v2-migration-design.md](../specs/2026-04-19-clob-v2-migration-design.md)

---

## File-by-File Map

| File | Why it changes | Task |
|---|---|---|
| `apps/web/package.json` | Swap clob-client → clob-client-v2; remove unused order-utils | T1 |
| `apps/extension/package.json` | Same | T1 |
| `apps/web/src/hooks/use-clob-client.ts` | Constructor refactor + remove feeRateBps + builderConfig swap + wrap-on-trade | T1, T2, T3, T6 |
| `apps/web/src/hooks/use-notifications.ts` | Constructor refactor | T1 |
| `apps/web/src/hooks/use-clob-credentials.ts` | Constructor refactor (3 sites) | T1 |
| `apps/extension/src/background/trading-handler.ts` | Static→dynamic import, constructor refactor, remove feeRateBps, builderConfig swap, wrap-on-trade approval set | T1, T2, T3, T6 |
| `apps/extension/webpack.config.js` | Inject `process.env.POLY_BUILDER_CODE` via DefinePlugin | T3 |
| `apps/extension/.env.example` | Add `POLY_BUILDER_CODE` placeholder | T3 |
| `apps/web/.env.local.example` | Create with `NEXT_PUBLIC_POLY_BUILDER_CODE` placeholder | T3 |
| `packages/shared-types/src/contracts.ts` | V2 exchange addresses, new pUSD + Onramp constants, new approval target lists | T4 |
| `apps/web/src/constants/contracts.ts` | Re-export pUSD + Onramp | T4 |
| `apps/web/src/lib/approvals.ts` | Check pUSD allowances on V2 exchanges instead of USDC.e | T5 |

**Files explicitly NOT touched (relayer-only, intentionally preserved):**
- `apps/web/src/lib/remote-builder-config.ts`
- `apps/web/src/lib/sign-proxy-url.ts`
- `apps/web/src/app/api/sign/route.ts`
- `apps/extension/src/background/builder-config.ts`
- `apps/web/src/hooks/use-relayer-client.ts`
- `apps/web/src/hooks/use-ctf-operations.ts`
- `apps/web/src/hooks/use-withdraw.ts`
- `apps/extension/src/background/relayer-client.ts`

---

## Task 0: Branch Setup

**Files:** none

- [ ] **Step 0.1: Confirm working branch**

Run: `git status && git branch --show-current`
Expected: clean working tree on `clob-v2` branch (or whatever branch the team is using for this migration). If not clean, stop and ask the user.

- [ ] **Step 0.2: Capture baseline build state**

Run: `pnpm install && pnpm -r typecheck 2>&1 | tail -5 && pnpm -r build 2>&1 | tail -5`
Expected: typecheck and build both succeed against V1 SDK. If they don't, stop — the migration shouldn't fight pre-existing breakage.

---

## Task 1: Dependency Swap + Constructor Refactor (single commit)

**Spec section:** Step 1.

**Why combined:** changing the import name to `clob-client-v2` will break compilation everywhere until the constructors are also updated. Splitting these would leave one commit with a broken build, violating the "every commit green" goal.

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/extension/package.json`
- Modify: `pnpm-lock.yaml` (regenerated)
- Modify: `apps/web/src/hooks/use-clob-client.ts:97-122, 409-410`
- Modify: `apps/web/src/hooks/use-notifications.ts:101-126` (re-read before editing — line numbers may have shifted)
- Modify: `apps/web/src/hooks/use-clob-credentials.ts:341, 468, 629` (3 sites)
- Modify: `apps/extension/src/background/trading-handler.ts:29, 323-333, 446`

- [ ] **Step 1.1: Update web package.json**

Edit `apps/web/package.json`:

```diff
-    "@polymarket/clob-client": "5.8.1",
-    "@polymarket/order-utils": "3.0.1",
+    "@polymarket/clob-client-v2": "1.0.0",
```

Keep `@polymarket/builder-signing-sdk@1.0.0` and `@polymarket/builder-relayer-client@0.0.8` — both are still used by the relayer flow.

- [ ] **Step 1.2: Update extension package.json**

Edit `apps/extension/package.json`:

```diff
-    "@polymarket/clob-client": "5.8.1",
-    "@polymarket/order-utils": "3.0.1",
+    "@polymarket/clob-client-v2": "1.0.0",
```

- [ ] **Step 1.3: Refresh lockfile**

Run: `pnpm install`
Expected: succeeds; `pnpm-lock.yaml` updates. Note any peer-dep warnings — they should be benign for a SDK swap.

- [ ] **Step 1.4: Refactor `apps/web/src/hooks/use-clob-client.ts` constructors**

Re-read the file before editing in case line numbers shifted. Replace the authenticated constructor (originally `~line 97-122`):

```ts
const [{ ClobClient }, signer] = await Promise.all([
  import("@polymarket/clob-client-v2"),
  getEthersSigner(),
]);

const builderConfig = createBuilderConfig({
  url: getBuilderSignProxyUrl(),
});

const creds = {
  key: credentials.apiKey,
  secret: credentials.apiSecret,
  passphrase: credentials.apiPassphrase,
};

return new ClobClient({
  host: CLOB_HOST,
  chain: CHAIN_ID,
  signer,
  creds,
  signatureType: SignatureType.POLY_GNOSIS_SAFE,
  funderAddress: proxyAddress,
  // TEMP: legacy proxy-signing config; Step 3 swaps this to { builderCode }
  builderConfig: builderConfig as unknown as { builderCode: string },
});
```

And the read-only constructor (originally `~line 409-410`):

```ts
const { ClobClient } = await import("@polymarket/clob-client-v2");
const client = new ClobClient({ host: CLOB_HOST, chain: CHAIN_ID });
```

- [ ] **Step 1.5: Refactor `apps/web/src/hooks/use-notifications.ts` constructor**

Re-read the file. Replace the import + constructor pattern (originally `~line 101-126`):

```ts
const [{ ClobClient }, signer] = await Promise.all([
  import("@polymarket/clob-client-v2"),
  getEthersSigner(),
]);

return new ClobClient({
  host: process.env.NEXT_PUBLIC_POLYMARKET_HOST || "https://clob.polymarket.com",
  chain: 137,
  signer,
  creds,
  signatureType: SignatureType.POLY_GNOSIS_SAFE,
  funderAddress: proxyAddress,
});
```

(No `builderConfig` here because the V1 site didn't pass one.)

- [ ] **Step 1.6: Refactor `apps/web/src/hooks/use-clob-credentials.ts` constructors**

Re-read the file. There are 3 ClobClient construction sites. For each, change the `import("@polymarket/clob-client")` → `import("@polymarket/clob-client-v2")` and convert positional args to options object using the same pattern as Step 1.4. Sites that pass only host/chain should use:

```ts
new ClobClient({ host: CLOB_HOST, chain: CHAIN_ID })
```

Authenticated sites with creds and signer use the full options object.

- [ ] **Step 1.7: Refactor `apps/extension/src/background/trading-handler.ts`**

Re-read the file before editing. Three changes:

1. Convert the static import (line 29) to dynamic. Delete the top-level `import { ClobClient } from "@polymarket/clob-client";` line entirely.

2. In `handlePlaceOrder` (around line 323), replace the constructor:

```ts
const { ClobClient } = await import("@polymarket/clob-client-v2");
const builderConfig = createExtensionBuilderConfig();

// ... creds construction stays the same

const client = new ClobClient({
  host: CLOB_HOST,
  chain: POLYGON_CHAIN_ID,
  signer,
  creds,
  signatureType: SIGNATURE_TYPES.POLY_GNOSIS_SAFE,
  funderAddress: msg.proxyAddress,
  // TEMP: legacy proxy-signing config; Task 3 swaps this to { builderCode }
  builderConfig: builderConfig as unknown as { builderCode: string },
});
```

3. In `handleGetFeeRate` (around line 446), replace the constructor:

```ts
const { ClobClient } = await import("@polymarket/clob-client-v2");
const client = new ClobClient({ host: CLOB_HOST, chain: POLYGON_CHAIN_ID });
```

- [ ] **Step 1.8: Verify build is green**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both succeed. The temporary `as unknown as` casts on `builderConfig` should be flagged by lint as a code smell — that's intentional, Task 3 fixes them.

- [ ] **Step 1.9: Commit**

```bash
git add apps/web/package.json apps/extension/package.json pnpm-lock.yaml \
        apps/web/src/hooks/use-clob-client.ts \
        apps/web/src/hooks/use-notifications.ts \
        apps/web/src/hooks/use-clob-credentials.ts \
        apps/extension/src/background/trading-handler.ts
git commit -m "refactor(clob-v2): swap to clob-client-v2 and refactor constructors

- Replace @polymarket/clob-client@5.8.1 with @polymarket/clob-client-v2@1.0.0
  in both web and extension package.json
- Remove @polymarket/order-utils (phantom dep, never imported in source)
- Refactor 7 ClobClient call sites from positional args to V2 options object
- Convert extension's static clob-client import to dynamic (V2 is ESM-only)
- Keep legacy builderConfig wired in via temporary cast; Task 3 will replace
  with V2 { builderCode } shape"
```

---

## Task 2: Order Creation Cleanup

**Spec section:** Step 2.

**Files:**
- Modify: `apps/web/src/hooks/use-clob-client.ts:142-215` (createOrder fn)
- Modify: `apps/extension/src/background/trading-handler.ts:303-439` (handlePlaceOrder fn)

- [ ] **Step 2.1: Remove `feeRateBps` from web order creation**

Re-read `apps/web/src/hooks/use-clob-client.ts`. In the `createOrder` callback, delete the `feeRateBps` variable and remove it from both order objects:

```ts
// Delete this line:
const feeRateBps = await client.getFeeRateBps(params.tokenId);
```

Then in the market-order branch:

```ts
const order = await client.createMarketOrder(
  {
    tokenID: params.tokenId,
    amount: marketAmount,
    side: params.side,
    // feeRateBps removed (V2: protocol-determined at match time)
    ...(params.price > 0 ? { price: params.price } : {}),
  },
  orderOptions
);
```

And in the limit-order branch:

```ts
const order = await client.createOrder(
  {
    tokenID: params.tokenId,
    price: params.price,
    size: params.size,
    side: params.side,
    // feeRateBps removed
    expiration:
      params.orderType === OrderType.GTD ? params.expiration : 0,
  },
  orderOptions
);
```

The standalone `getFeeRateBps` callback further down (around line 406) stays — it's used by UI display code. Just don't pass its result back into orders.

- [ ] **Step 2.2: Remove `feeRateBps` from extension order creation**

Re-read `apps/extension/src/background/trading-handler.ts`. In `handlePlaceOrder`:

```ts
// Delete this line:
const feeRateBps = await client.getFeeRateBps(msg.tokenId);
```

Update the market-order object:

```ts
const marketOrder: Record<string, unknown> = {
  tokenID: msg.tokenId,
  amount: marketAmount,
  side: msg.side,
  // feeRateBps removed
  orderType,
};
```

Update the limit-order object:

```ts
const order = await client.createOrder(
  {
    tokenID: msg.tokenId,
    price: msg.price,
    size: msg.size,
    side: msg.side as any,
    // feeRateBps removed
    expiration: orderType === "GTD" ? msg.expiration : 0,
  },
  orderOptions
);
```

Also remove `feeRateBps` from any `logInfo("trading.place-order.limit-params", { … })` argument that includes it.

`handleGetFeeRate` (the separate handler that returns the fee rate to UI) stays — it's still useful for display.

- [ ] **Step 2.3: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both succeed.

- [ ] **Step 2.4: Commit**

```bash
git add apps/web/src/hooks/use-clob-client.ts apps/extension/src/background/trading-handler.ts
git commit -m "refactor(clob-v2): drop feeRateBps from order creation

V2 determines fees at match time; integrators must not embed feeRateBps
in signed orders. Removes the getFeeRateBps() pre-call from order
placement flows. The standalone getFeeRateBps lookup used for UI
display remains — only the order-injection path is removed."
```

---

## Task 3: Builder Attribution Swap (CLOB-side only)

**Spec section:** Step 3.

**Critical guard:** Do NOT delete `remote-builder-config.ts`, `sign-proxy-url.ts`, `/api/sign/route.ts`, or extension `builder-config.ts`. They are still used by the relayer's HMAC signing path. This task only swaps the value passed into `ClobClient`.

**Files:**
- Modify: `apps/extension/webpack.config.js` (DefinePlugin)
- Create or modify: `apps/extension/.env.example`
- Create: `apps/web/.env.local.example`
- Modify: `apps/web/src/hooks/use-clob-client.ts` (replace temporary cast)
- Modify: `apps/extension/src/background/trading-handler.ts` (replace temporary cast)

- [ ] **Step 3.1: Add webpack DefinePlugin entry for the extension**

Re-read `apps/extension/webpack.config.js`. Find the existing `new webpack.DefinePlugin({...})` block (around line 215) and add one entry:

```js
new webpack.DefinePlugin({
  __DEV_MODE__: JSON.stringify(devMode),
  "process.env.NODE_DEBUG": JSON.stringify(""),
  "process.env.NODE_ENV": JSON.stringify(
    isProduction ? "production" : "development"
  ),
  "process.env.POLY_BUILDER_CODE": JSON.stringify(
    process.env.POLY_BUILDER_CODE || ""
  ),
}),
```

`require("dotenv").config()` is already called at the top of the file, so a local `.env` populates `process.env` at build time and the value gets baked into the bundle.

- [ ] **Step 3.2: Add `POLY_BUILDER_CODE` to extension .env.example**

Re-read `apps/extension/.env.example`. Append (or create the file with) this entry:

```
# Polymarket V2 builder attribution code (bytes32 hex string).
# Obtain from https://polymarket.com/settings?tab=builder
# Public identifier — not a secret.
POLY_BUILDER_CODE=
```

- [ ] **Step 3.3: Create `apps/web/.env.local.example`**

If the file doesn't exist, create it with at minimum:

```
# Polymarket V2 builder attribution code (bytes32 hex string).
# Public identifier — not a secret. Exposed to browser bundle.
NEXT_PUBLIC_POLY_BUILDER_CODE=

# Polymarket CLOB host. Override to https://clob-v2.polymarket.com for preprod.
NEXT_PUBLIC_POLYMARKET_HOST=https://clob.polymarket.com
NEXT_PUBLIC_POLYMARKET_CHAIN_ID=137
```

- [ ] **Step 3.4: Replace temporary cast in `use-clob-client.ts`**

Re-read the authenticated constructor in `apps/web/src/hooks/use-clob-client.ts`. Remove the legacy `createBuilderConfig`/`getBuilderSignProxyUrl` imports IF they are not used elsewhere in the file (relayer hooks live in different files; check the imports at the top). Then replace the construction:

```ts
const builderCode = process.env.NEXT_PUBLIC_POLY_BUILDER_CODE;

return new ClobClient({
  host: CLOB_HOST,
  chain: CHAIN_ID,
  signer,
  creds,
  signatureType: SignatureType.POLY_GNOSIS_SAFE,
  funderAddress: proxyAddress,
  ...(builderCode ? { builderConfig: { builderCode } } : {}),
});
```

If `createBuilderConfig` and `getBuilderSignProxyUrl` are only used in this hook, also delete those two imports from the top of the file. Verify by grepping: `pnpm exec rg "createBuilderConfig|getBuilderSignProxyUrl" apps/web/src` — if any other file uses them, leave the imports in `use-clob-client.ts` alone.

- [ ] **Step 3.5: Replace temporary cast in `trading-handler.ts`**

Re-read `apps/extension/src/background/trading-handler.ts`. In `handlePlaceOrder`, replace the legacy builder-config wiring:

```ts
// Remove these two lines:
const builderConfig = createExtensionBuilderConfig();
// ...
// builderConfig: builderConfig as unknown as { builderCode: string },

// Replace with:
const builderCode = process.env.POLY_BUILDER_CODE;

const client = new ClobClient({
  host: CLOB_HOST,
  chain: POLYGON_CHAIN_ID,
  signer,
  creds,
  signatureType: SIGNATURE_TYPES.POLY_GNOSIS_SAFE,
  funderAddress: msg.proxyAddress,
  ...(builderCode ? { builderConfig: { builderCode } } : {}),
});
```

Also remove the now-unused `import { createExtensionBuilderConfig } from "./builder-config";` at the top of `trading-handler.ts` IF the import is only used at the deleted site. Verify: `pnpm exec rg "createExtensionBuilderConfig" apps/extension/src` — if `relayer-client.ts` still imports it (it does, at line 24), the file `builder-config.ts` stays. Only the `trading-handler.ts` import line is removed.

- [ ] **Step 3.6: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both succeed. The `as unknown as` casts from Task 1 are gone.

- [ ] **Step 3.7: Verify relayer files still in place**

Run:
```bash
ls apps/web/src/lib/remote-builder-config.ts \
   apps/web/src/lib/sign-proxy-url.ts \
   apps/web/src/app/api/sign/route.ts \
   apps/extension/src/background/builder-config.ts
```
Expected: all four files exist (we did not delete them).

- [ ] **Step 3.8: Commit**

```bash
git add apps/extension/webpack.config.js apps/extension/.env.example \
        apps/web/.env.local.example \
        apps/web/src/hooks/use-clob-client.ts \
        apps/extension/src/background/trading-handler.ts
git commit -m "refactor(clob-v2): swap CLOB builder attribution to builderCode

- Replace HMAC proxy-signing builderConfig with V2 { builderCode } shape
  at ClobClient construction sites in web and extension
- Inject POLY_BUILDER_CODE via webpack DefinePlugin in the extension
- Add NEXT_PUBLIC_POLY_BUILDER_CODE to web env example
- Relayer-only files (remote-builder-config.ts, sign-proxy-url.ts,
  /api/sign/route.ts, extension builder-config.ts) deliberately preserved —
  the relayer flow still needs HMAC headers signed server-side"
```

---

## Task 4: Update Contract Addresses

**Spec section:** Step 4.

**Files:**
- Modify: `packages/shared-types/src/contracts.ts`
- Modify: `apps/web/src/constants/contracts.ts` (re-exports)

- [ ] **Step 4.1: Update `packages/shared-types/src/contracts.ts`**

Re-read the file. Apply these edits:

```ts
/** USDC.e (Bridged USDC) — kept for bridge flows and Onramp wrapping */
export const USDC_E_ADDRESS =
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
export const USDC_E_DECIMALS = 6;

/** Polymarket USD (pUSD) — V2 trading collateral */
export const PUSD_ADDRESS =
  "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as const;
export const PUSD_DECIMALS = 6;

/** Collateral Onramp — wraps USDC.e → pUSD */
export const COLLATERAL_ONRAMP_ADDRESS =
  "0x93070a847efEf7F70739046A929D47a521F5B8ee" as const;

/** Conditional Tokens Framework (CTF) — ERC1155 outcome tokens (unchanged) */
export const CTF_ADDRESS =
  "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" as const;

/** CTF Exchange V2 — Standard binary markets */
export const CTF_EXCHANGE_ADDRESS =
  "0xE111180000d2663C0091e4f400237545B87B996B" as const;

/** Neg Risk CTF Exchange V2 — Negative risk markets */
export const NEG_RISK_CTF_EXCHANGE_ADDRESS =
  "0xe2222d279d744050d28e00520010520000310F59" as const;

/** Neg Risk Adapter (unchanged) */
export const NEG_RISK_ADAPTER_ADDRESS =
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const;

/** Polymarket Safe Factory (unchanged) */
export const SAFE_FACTORY_ADDRESS =
  "0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b" as const;

/** Safe init code hash for CREATE2 (unchanged) */
export const SAFE_INIT_CODE_HASH =
  "0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf" as const;

export const CONTRACTS = {
  USDC_E: USDC_E_ADDRESS,
  PUSD: PUSD_ADDRESS,
  COLLATERAL_ONRAMP: COLLATERAL_ONRAMP_ADDRESS,
  CTF: CTF_ADDRESS,
  CTF_EXCHANGE: CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE: NEG_RISK_CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER: NEG_RISK_ADAPTER_ADDRESS,
  SAFE_FACTORY: SAFE_FACTORY_ADDRESS,
} as const;

/** USDC.e approval target — needed for the Onramp `wrap()` call */
export const USDC_E_ONRAMP_APPROVAL_TARGET = COLLATERAL_ONRAMP_ADDRESS;

/** pUSD approval targets — V2 trading collateral approvals */
export const PUSD_APPROVAL_TARGETS = [
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
] as const;

/** ERC-1155 outcome token approval targets (unchanged) */
export const CTF_APPROVAL_OPERATORS = [
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
] as const;
```

Note: the old `USDC_APPROVAL_TARGETS` constant is replaced by `PUSD_APPROVAL_TARGETS` + `USDC_E_ONRAMP_APPROVAL_TARGET`. If anything still imports `USDC_APPROVAL_TARGETS`, those import sites will break — fix them in the same task by replacing with the appropriate new constant.

- [ ] **Step 4.2: Find and fix old `USDC_APPROVAL_TARGETS` consumers**

Run: `pnpm exec rg "USDC_APPROVAL_TARGETS" --type ts`
For each match, decide whether the consumer wants pUSD-to-V2-exchanges (use `PUSD_APPROVAL_TARGETS`) or USDC.e-to-Onramp (use `USDC_E_ONRAMP_APPROVAL_TARGET`). Update the import and usage. Show the agent the diff before committing.

- [ ] **Step 4.3: Update web re-exports**

Re-read `apps/web/src/constants/contracts.ts`. If it re-exports from `@knoww/shared-types/contracts`, ensure it now also re-exports `PUSD_ADDRESS`, `PUSD_DECIMALS`, `COLLATERAL_ONRAMP_ADDRESS`, `PUSD_APPROVAL_TARGETS`, and `USDC_E_ONRAMP_APPROVAL_TARGET`.

- [ ] **Step 4.4: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both succeed. If anything broke, it's an unfixed `USDC_APPROVAL_TARGETS` consumer — fix and re-run.

- [ ] **Step 4.5: Commit**

```bash
git add packages/shared-types/src/contracts.ts apps/web/src/constants/contracts.ts
git commit -m "feat(clob-v2): switch to V2 exchange addresses and add pUSD constants

- CTF_EXCHANGE_ADDRESS: V1 0x4bFb… → V2 0xE111…
- NEG_RISK_CTF_EXCHANGE_ADDRESS: V1 0xC5d5… → V2 0xe222…
- Add PUSD_ADDRESS, PUSD_DECIMALS, COLLATERAL_ONRAMP_ADDRESS
- Replace USDC_APPROVAL_TARGETS with PUSD_APPROVAL_TARGETS (for trading)
  and USDC_E_ONRAMP_APPROVAL_TARGET (for wrapping)
- Keep USDC_E_ADDRESS (still used by bridge and Onramp input)"
```

---

## Task 5: Update Web Approval Check to Use pUSD

**Spec section:** Step 5 (allowance-check half).

**Files:**
- Modify: `apps/web/src/lib/approvals.ts`

- [ ] **Step 5.1: Switch approval check from USDC.e → pUSD on V2 exchanges**

Re-read `apps/web/src/lib/approvals.ts`. Replace the file body so that:
- The ERC-20 allowance check reads `pUSD` allowance on `CTF_EXCHANGE`, `NEG_RISK_CTF_EXCHANGE`, `NEG_RISK_ADAPTER`.
- A separate ERC-20 allowance check reads `USDC.e` allowance on `COLLATERAL_ONRAMP_ADDRESS`.
- ERC-1155 (CTF outcome token) approvals stay unchanged.

```ts
import { erc20Abi } from "viem";
import { CONTRACTS } from "@/constants/contracts";
import { getPublicClient } from "@/lib/rpc";

const ERC1155_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    name: "isApprovedForAll",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const APPROVAL_THRESHOLD = BigInt(1_000_000_000_000); // 1M tokens (6 decimals)

export interface ApprovalStatus {
  // pUSD approvals (V2 trading collateral)
  pusdCtfExchange: boolean;
  pusdNegRiskExchange: boolean;
  pusdNegRiskAdapter: boolean;
  // USDC.e approval to Onramp (for wrap)
  usdcOnramp: boolean;
  // ERC-1155 outcome token approvals (unchanged)
  ctfExchangeApproval: boolean;
  ctfNegRiskExchangeApproval: boolean;
  ctfNegRiskAdapterApproval: boolean;
  allApproved: boolean;
}

let lastApprovalCheck = 0;
const MIN_APPROVAL_CHECK_INTERVAL = 200;

async function throttleApprovalCheck(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastApprovalCheck;
  if (elapsed < MIN_APPROVAL_CHECK_INTERVAL) {
    await new Promise((r) =>
      setTimeout(r, MIN_APPROVAL_CHECK_INTERVAL - elapsed)
    );
  }
  lastApprovalCheck = Date.now();
}

async function checkErc20Allowance(
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`
): Promise<boolean> {
  try {
    await throttleApprovalCheck();
    const client = getPublicClient();
    const allowance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
    return allowance >= APPROVAL_THRESHOLD;
  } catch (err) {
    console.error("[Approvals] Failed to check ERC-20 allowance:", err);
    return false;
  }
}

async function checkErc1155Approval(
  owner: `0x${string}`,
  operator: `0x${string}`
): Promise<boolean> {
  try {
    await throttleApprovalCheck();
    const client = getPublicClient();
    return await client.readContract({
      address: CONTRACTS.CTF,
      abi: ERC1155_ABI,
      functionName: "isApprovedForAll",
      args: [owner, operator],
    });
  } catch (err) {
    console.error("[Approvals] Failed to check ERC-1155 approval:", err);
    return false;
  }
}

export async function checkAllApprovals(
  safeAddress: string
): Promise<ApprovalStatus> {
  const owner = safeAddress as `0x${string}`;

  const [
    pusdCtfExchange,
    pusdNegRiskExchange,
    pusdNegRiskAdapter,
    usdcOnramp,
    ctfExchangeApproval,
    ctfNegRiskExchangeApproval,
    ctfNegRiskAdapterApproval,
  ] = await Promise.all([
    checkErc20Allowance(CONTRACTS.PUSD, owner, CONTRACTS.CTF_EXCHANGE),
    checkErc20Allowance(CONTRACTS.PUSD, owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE),
    checkErc20Allowance(CONTRACTS.PUSD, owner, CONTRACTS.NEG_RISK_ADAPTER),
    checkErc20Allowance(CONTRACTS.USDC_E, owner, CONTRACTS.COLLATERAL_ONRAMP),
    checkErc1155Approval(owner, CONTRACTS.CTF_EXCHANGE),
    checkErc1155Approval(owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE),
    checkErc1155Approval(owner, CONTRACTS.NEG_RISK_ADAPTER),
  ]);

  const allApproved =
    pusdCtfExchange &&
    pusdNegRiskExchange &&
    pusdNegRiskAdapter &&
    usdcOnramp &&
    ctfExchangeApproval &&
    ctfNegRiskExchangeApproval &&
    ctfNegRiskAdapterApproval;

  return {
    pusdCtfExchange,
    pusdNegRiskExchange,
    pusdNegRiskAdapter,
    usdcOnramp,
    ctfExchangeApproval,
    ctfNegRiskExchangeApproval,
    ctfNegRiskAdapterApproval,
    allApproved,
  };
}

export async function needsApprovals(safeAddress: string): Promise<boolean> {
  const status = await checkAllApprovals(safeAddress);
  return !status.allApproved;
}
```

- [ ] **Step 5.2: Find and fix consumers of the old `ApprovalStatus` shape**

Run: `pnpm exec rg "usdcCtf|usdcNegRiskExchange|usdcNegRiskAdapter|usdcCtfExchange" --type ts apps/web/src`
For each match in UI components or hooks, update to use the new field names (`pusdCtfExchange`, `pusdNegRiskExchange`, `pusdNegRiskAdapter`, `usdcOnramp`). If the UI displays "USDC" approval status to the user, leave the user-facing text alone (UI copy refresh is out of scope) but make sure the boolean it reads matches the new field.

- [ ] **Step 5.3: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both succeed.

- [ ] **Step 5.4: Commit**

```bash
git add apps/web/src/lib/approvals.ts
# plus any consumer files updated in 5.2
git commit -m "feat(clob-v2): check pUSD allowance on V2 exchanges + USDC.e on Onramp

The V2 CLOB settles in pUSD, so trading-collateral approvals must target
pUSD against the V2 exchange addresses. USDC.e remains relevant only as
the input to the Collateral Onramp wrap() call. ERC-1155 outcome-token
approvals are unchanged."
```

---

## Task 6: Wrap-on-Trade — Extension Approval Set

**Spec section:** Step 5 (write-side, extension).

**Why extension first:** the extension's `handleRelayerApprove` already builds a relayer batch and is the cleanest place to teach the system about the new approval set. The web side will follow a similar pattern in Task 7.

**Files:**
- Modify: `apps/extension/src/background/trading-handler.ts:758-868` (`handleRelayerApprove` and supporting constants)

- [ ] **Step 6.1: Add Onramp + pUSD imports**

Re-read `apps/extension/src/background/trading-handler.ts`. Update the contracts import at the top:

```ts
import {
  CTF_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  COLLATERAL_ONRAMP_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  PUSD_ADDRESS,
  SAFE_FACTORY_ADDRESS,
  SAFE_INIT_CODE_HASH,
  USDC_E_ADDRESS,
} from "@knoww/shared-types/contracts";
```

- [ ] **Step 6.2: Rewrite `handleRelayerApprove` for V2 approval set**

Replace the `erc20Targets`, `erc1155Operators`, and the allowance-check block in `handleRelayerApprove` so it:

- Approves **USDC.e → Onramp** (single target).
- Approves **pUSD → CTF Exchange V2, Neg Risk Exchange V2, Neg Risk Adapter**.
- Approves **outcome tokens (ERC-1155) → CTF Exchange V2, Neg Risk Exchange V2, Neg Risk Adapter**.

```ts
async function handleRelayerApprove(
  msg: TradingRelayerApproveMessage,
  sender: chrome.runtime.MessageSender
): Promise<TradingResponse> {
  const tabId = sender.tab?.id;
  if (!tabId) return fail("No active tab for signing");

  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const signer = new BridgeSigner(msg.address, tabId, provider);

  const erc20Iface = new ethers.utils.Interface(ERC20_APPROVE_ABI);
  const erc1155Iface = new ethers.utils.Interface(ERC1155_SET_APPROVAL_ABI);
  const MAX_UINT256 = ethers.constants.MaxUint256;

  // USDC.e gets approved to the Onramp only (for wrap()).
  const usdcSpender = COLLATERAL_ONRAMP_ADDRESS;

  // pUSD gets approved to the V2 exchanges and adapter for trading.
  const pusdSpenders = [
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_CTF_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ];

  // ERC-1155 outcome tokens approve the same exchanges/adapter as operators.
  const erc1155Operators = [
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_CTF_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ];

  const proxyAddress = deriveProxyAddressSync(msg.address);

  let needsUsdc = false;
  const needsPusd: string[] = [];
  const needsErc1155: string[] = [];

  try {
    const usdc = new ethers.Contract(
      USDC_E_ADDRESS,
      ERC20_ALLOWANCE_ABI,
      provider
    );
    const pusd = new ethers.Contract(
      PUSD_ADDRESS,
      ERC20_ALLOWANCE_ABI,
      provider
    );
    const ctf = new ethers.Contract(
      CTF_ADDRESS,
      ERC1155_IS_APPROVED_ABI,
      provider
    );
    const THRESHOLD = ethers.utils.parseUnits("1000000", 6);

    const [usdcAllowance, pusdAllowances, erc1155Results] = await Promise.all([
      usdc
        .allowance(proxyAddress, usdcSpender)
        .catch(() => ethers.BigNumber.from(0)),
      Promise.all(
        pusdSpenders.map((s) =>
          pusd
            .allowance(proxyAddress, s)
            .catch(() => ethers.BigNumber.from(0))
        )
      ),
      Promise.all(
        erc1155Operators.map((op) =>
          ctf.isApprovedForAll(proxyAddress, op).catch(() => false)
        )
      ),
    ]);

    if (usdcAllowance.lt(THRESHOLD)) needsUsdc = true;
    for (let i = 0; i < pusdSpenders.length; i++) {
      if (pusdAllowances[i].lt(THRESHOLD)) needsPusd.push(pusdSpenders[i]);
    }
    for (let i = 0; i < erc1155Operators.length; i++) {
      if (!erc1155Results[i]) needsErc1155.push(erc1155Operators[i]);
    }
  } catch {
    needsUsdc = true;
    needsPusd.push(...pusdSpenders);
    needsErc1155.push(...erc1155Operators);
  }

  if (!needsUsdc && needsPusd.length === 0 && needsErc1155.length === 0) {
    return ok({ txHash: "", alreadyApproved: true });
  }

  const txns: Array<{ to: string; data: string; value: string }> = [];

  if (needsUsdc) {
    txns.push({
      to: USDC_E_ADDRESS,
      data: erc20Iface.encodeFunctionData("approve", [
        usdcSpender,
        MAX_UINT256,
      ]),
      value: "0",
    });
  }

  for (const spender of needsPusd) {
    txns.push({
      to: PUSD_ADDRESS,
      data: erc20Iface.encodeFunctionData("approve", [spender, MAX_UINT256]),
      value: "0",
    });
  }

  for (const operator of needsErc1155) {
    txns.push({
      to: CTF_ADDRESS,
      data: erc1155Iface.encodeFunctionData("setApprovalForAll", [
        operator,
        true,
      ]),
      value: "0",
    });
  }

  logInfo("trading.relayer-approve.submit", { txnCount: txns.length });
  const result = await executeViaRelayer(signer, txns);
  return ok({ txHash: result.txHash, success: true });
}
```

- [ ] **Step 6.3: Update `handleGetAllAllowances` to read pUSD allowances**

Replace the body of `handleGetAllAllowances` so the returned `allowances` object includes pUSD allowances on V2 exchanges and USDC.e allowance on the Onramp:

```ts
async function handleGetAllAllowances(
  msg: TradingGetAllAllowancesMessage
): Promise<TradingResponse> {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const usdc = new ethers.Contract(
    USDC_E_ADDRESS,
    ERC20_ALLOWANCE_ABI,
    provider
  );
  const pusd = new ethers.Contract(
    PUSD_ADDRESS,
    ERC20_ALLOWANCE_ABI,
    provider
  );
  const ctf = new ethers.Contract(
    CTF_ADDRESS,
    ERC1155_IS_APPROVED_ABI,
    provider
  );

  const pusdSpenders = [
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_CTF_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ];
  const erc1155Operators = [
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_CTF_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ];

  const allowances: Record<string, number> = {};

  const [usdcOnramp, pusdResults, erc1155Results] = await Promise.all([
    usdc
      .allowance(msg.ownerAddress, COLLATERAL_ONRAMP_ADDRESS)
      .catch(() => ethers.BigNumber.from(0)),
    Promise.all(
      pusdSpenders.map((s) =>
        pusd
          .allowance(msg.ownerAddress, s)
          .catch(() => ethers.BigNumber.from(0))
      )
    ),
    Promise.all(
      erc1155Operators.map((op) =>
        ctf.isApprovedForAll(msg.ownerAddress, op).catch(() => false)
      )
    ),
  ]);

  allowances[`usdce:${COLLATERAL_ONRAMP_ADDRESS}`] = Number(
    ethers.utils.formatUnits(usdcOnramp, 6)
  );
  for (let i = 0; i < pusdSpenders.length; i++) {
    allowances[`pusd:${pusdSpenders[i]}`] = Number(
      ethers.utils.formatUnits(pusdResults[i], 6)
    );
  }
  for (let i = 0; i < erc1155Operators.length; i++) {
    allowances[`erc1155:${erc1155Operators[i]}`] = erc1155Results[i] ? 1 : 0;
  }

  return ok({ allowances });
}
```

- [ ] **Step 6.4: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both succeed. Any UI consumer of the old allowance-key format (e.g. extension popup that reads `allowances[CTF_EXCHANGE_ADDRESS]`) needs adjustment — search and fix.

- [ ] **Step 6.5: Commit**

```bash
git add apps/extension/src/background/trading-handler.ts
git commit -m "feat(clob-v2): extend extension relayer approval set for pUSD + Onramp

handleRelayerApprove now batches:
- USDC.e → Collateral Onramp (enables wrap())
- pUSD → CTF Exchange V2 + Neg Risk Exchange V2 + Neg Risk Adapter
- ERC-1155 outcome tokens → same V2 exchanges/adapter (unchanged set)

Allowance read in handleGetAllAllowances is updated to match the new
key format so the popup can display approval status correctly."
```

---

## Task 7: Wrap-on-Trade — Web Approval Set + Pre-Order Wrap

**Spec section:** Step 5 (write-side, web).

**Files:**
- Modify: `apps/web/src/hooks/use-clob-client.ts:252-328` (`updateAllowance`) + `:142-215` (`createOrder`)
- Reference: `apps/web/src/hooks/use-relayer-client.ts` for the relayer execute pattern

- [ ] **Step 7.1: Refactor `updateAllowance` to approve pUSD + USDC.e-Onramp**

Re-read `apps/web/src/hooks/use-clob-client.ts`. Replace the `updateAllowance` callback:

```ts
const updateAllowance = useCallback(async () => {
  if (!address) throw new Error("Wallet not connected");

  setIsLoading(true);
  setError(null);

  try {
    const [{ createWalletClient, custom, maxUint256 }, { polygon }] =
      await Promise.all([import("viem"), import("viem/chains")]);

    const ERC20_APPROVE_ABI = [
      {
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
      },
    ] as const;

    const walletClient = createWalletClient({
      chain: polygon,
      // biome-ignore lint/suspicious/noExplicitAny: window.ethereum is the wallet provider
      transport: custom(window.ethereum as any),
      account: address,
    });

    const { createPublicClient, http } = await import("viem");
    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(getRpcUrl()),
    });

    await walletClient.requestAddresses();

    const approve = async (
      token: `0x${string}`,
      spender: `0x${string}`
    ) => {
      const hash = await walletClient.writeContract({
        account: address,
        address: token,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [spender, maxUint256],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        pollingInterval: 5_000,
        timeout: 120_000,
        confirmations: 1,
      });
      if (receipt.status !== "success") {
        throw new Error(`Approval failed for ${spender}`);
      }
      return hash;
    };

    const hashes = await Promise.all([
      approve(USDC_E_ADDRESS, COLLATERAL_ONRAMP_ADDRESS),
      approve(PUSD_ADDRESS, CTF_EXCHANGE_ADDRESS),
      approve(PUSD_ADDRESS, NEG_RISK_CTF_EXCHANGE_ADDRESS),
    ]);

    return {
      success: true,
      hashes,
      message:
        "Approved USDC.e → Onramp and pUSD → CTF Exchange V2 + Neg Risk Exchange V2",
    };
  } catch (err) {
    const error =
      err instanceof Error ? err : new Error("Failed to approve");
    setError(error);
    throw error;
  } finally {
    setIsLoading(false);
  }
}, [address]);
```

Update the imports at the top of the file to include `PUSD_ADDRESS` and `COLLATERAL_ONRAMP_ADDRESS`:

```ts
import {
  COLLATERAL_ONRAMP_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  PUSD_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "@/constants/contracts";
```

- [ ] **Step 7.2: Add a `getPusdBalance` helper**

In the same file, after `getUsdcBalance`, add a sibling helper that reads pUSD balance. This will be used by the wrap-on-trade detection in Step 7.4:

```ts
const getPusdBalance = useCallback(
  async (walletAddress?: string) => {
    const targetAddress = walletAddress || proxyAddress;
    if (!targetAddress) throw new Error("No wallet address");

    const { createPublicClient, http, formatUnits } = await import("viem");
    const { polygon } = await import("viem/chains");

    const ERC20_BALANCE_ABI = [
      {
        inputs: [{ name: "owner", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const;

    const client = createPublicClient({
      chain: polygon,
      transport: http(getRpcUrl()),
    });

    const balance = await client.readContract({
      address: PUSD_ADDRESS,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [targetAddress as `0x${string}`],
    });

    return {
      balance: Number(formatUnits(balance, PUSD_DECIMALS)),
      balanceRaw: balance.toString(),
      decimals: PUSD_DECIMALS,
    };
  },
  [proxyAddress]
);
```

Add `getPusdBalance` to the returned object at the bottom of the hook.

- [ ] **Step 7.3: Add wrap-on-trade pre-flight to `createOrder`**

This is the central wrap-on-trade behavior for web. Inside `createOrder`, before calling `client.createOrder` / `client.createMarketOrder`, check whether the user has enough pUSD; if not, dispatch a relayer batch to wrap USDC.e first.

Because `useClobClient` already imports `useRelayerClient` is *not* imported here directly today — relayer execution needs the user's `walletClient`, not the ethers signer. The cleanest path is to extract a small helper that other hooks can call. For this task, inline the wrap call using viem (web users already have a connected `window.ethereum` — for web, the wrap can be a direct user-signed transaction or a relayer batch; we choose the relayer batch to match the extension and keep the user gas-free).

Add a helper at the module level (above `useClobClient`):

```ts
import { COLLATERAL_ONRAMP_ABI } from "@/constants/abi"; // see Step 7.5
// ...

async function ensurePusdSufficient(args: {
  proxyAddress: `0x${string}`;
  requiredPusd: bigint;
  executeViaRelayer: (
    txns: Array<{ to: string; data: string; value: string }>
  ) => Promise<{ txHash: string }>;
  publicClient: ReturnType<typeof createPublicClient>;
}): Promise<{ wrapped: bigint } | null> {
  const { proxyAddress, requiredPusd, executeViaRelayer, publicClient } = args;

  const ERC20_BALANCE_ABI = [
    { inputs: [{ name: "owner", type: "address" }], name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }], stateMutability: "view",
      type: "function" },
  ] as const;

  const pusdBalance = (await publicClient.readContract({
    address: PUSD_ADDRESS, abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf", args: [proxyAddress],
  })) as bigint;
  if (pusdBalance >= requiredPusd) return null;

  const shortfall = requiredPusd - pusdBalance;

  const usdcBalance = (await publicClient.readContract({
    address: USDC_E_ADDRESS, abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf", args: [proxyAddress],
  })) as bigint;
  if (usdcBalance < shortfall) {
    throw new Error(
      `Insufficient collateral: need ${shortfall} more pUSD (or USDC.e to wrap), have ${pusdBalance} pUSD + ${usdcBalance} USDC.e`
    );
  }

  // Build approve(USDC.e → Onramp) + wrap() batch
  const { encodeFunctionData } = await import("viem");
  const ERC20_APPROVE_ABI = [
    { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
      name: "approve", outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable", type: "function" },
  ] as const;

  const approveData = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [COLLATERAL_ONRAMP_ADDRESS, shortfall],
  });
  const wrapData = encodeFunctionData({
    abi: COLLATERAL_ONRAMP_ABI,
    functionName: "wrap",
    args: [USDC_E_ADDRESS, proxyAddress, shortfall],
  });

  await executeViaRelayer([
    { to: USDC_E_ADDRESS, data: approveData, value: "0" },
    { to: COLLATERAL_ONRAMP_ADDRESS, data: wrapData, value: "0" },
  ]);

  return { wrapped: shortfall };
}
```

Then inside `createOrder`, call this before posting the order. The required pUSD amount for a limit order is `price * size` (BUY) or `0` (SELL — no collateral movement on sell). Compute the requirement carefully:

```ts
// Inside createOrder, after computing orderOptions and before client.createOrder:

if (params.side === Side.BUY) {
  const requiredPusd = BigInt(
    Math.ceil(params.price * params.size * 10 ** PUSD_DECIMALS)
  );
  const { createPublicClient, http } = await import("viem");
  const { polygon } = await import("viem/chains");
  const publicClient = createPublicClient({
    chain: polygon, transport: http(getRpcUrl()),
  });

  // executeViaRelayer comes from useRelayerClient — we need to inject it.
  // For this task, accept it as an argument or hoist it via a callback.
  // See Step 7.4 for wiring.
  const wrapResult = await ensurePusdSufficient({
    proxyAddress: proxyAddress as `0x${string}`,
    requiredPusd,
    executeViaRelayer,
    publicClient,
  });
  if (wrapResult) {
    console.info("[clob-v2] auto-wrapped USDC.e → pUSD", { wrapped: wrapResult.wrapped.toString() });
  }
}
```

- [ ] **Step 7.4: Wire `executeViaRelayer` into `useClobClient`**

`useClobClient` doesn't currently know about the relayer. The cleanest wiring is to pull `executeViaRelayer` (or whatever the actual exported function is named) from `apps/web/src/hooks/use-relayer-client.ts` inside the hook:

```ts
// At the top of the file:
import { useRelayerClient } from "./use-relayer-client";

// Inside useClobClient body:
const { execute: executeViaRelayer } = useRelayerClient();
```

If the relayer hook exposes a different shape (e.g. a function that takes the wallet client and returns an `execute` method), inspect its API and adapt. The contract is: a function that takes an array of `{ to, data, value }` transactions and returns a promise resolving to `{ txHash: string }` after the relayer confirms.

If the relayer hook isn't already a stable API, add a thin wrapper inside `useClobClient` rather than restructuring `use-relayer-client.ts`.

- [ ] **Step 7.5: Add Onramp ABI to a shared constant**

Re-read `apps/web/src/constants/contracts.ts`. Add (or create alongside in `apps/web/src/constants/abi.ts`):

```ts
export const COLLATERAL_ONRAMP_ABI = [
  {
    inputs: [
      { name: "_asset", type: "address" },
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
    ],
    name: "wrap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_asset", type: "address" },
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
    ],
    name: "unwrap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
```

- [ ] **Step 7.6: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both succeed.

- [ ] **Step 7.7: Commit**

```bash
git add apps/web/src/hooks/use-clob-client.ts apps/web/src/constants/contracts.ts \
        apps/web/src/constants/abi.ts
git commit -m "feat(clob-v2): wrap USDC.e → pUSD on demand before placing buy orders

- updateAllowance now approves pUSD → V2 exchanges and USDC.e → Onramp
- Add getPusdBalance helper
- Before posting a BUY order, check pUSD balance; if short, dispatch a
  relayer batch (approve USDC.e → Onramp + wrap()) so the order can post
- SELL orders skip the wrap check (no collateral movement)"
```

---

## Task 8: Wrap-on-Trade — Extension Pre-Order Wrap

**Spec section:** Step 5 (write-side, extension trading flow).

**Files:**
- Modify: `apps/extension/src/background/trading-handler.ts` (`handlePlaceOrder`)

- [ ] **Step 8.1: Add a wrap helper for extension trading**

Re-read `apps/extension/src/background/trading-handler.ts`. Add a helper near the bottom (above `deriveProxyAddressSync`):

```ts
const COLLATERAL_ONRAMP_WRAP_ABI = [
  "function wrap(address _asset, address _to, uint256 _amount)",
];

async function ensurePusdSufficient(
  signer: BridgeSigner,
  proxyAddress: string,
  requiredPusd: ethers.BigNumber,
  provider: ethers.providers.StaticJsonRpcProvider
): Promise<void> {
  const pusd = new ethers.Contract(
    PUSD_ADDRESS,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );
  const usdc = new ethers.Contract(
    USDC_E_ADDRESS,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );

  const pusdBalance: ethers.BigNumber = await pusd.balanceOf(proxyAddress);
  if (pusdBalance.gte(requiredPusd)) return;

  const shortfall = requiredPusd.sub(pusdBalance);
  const usdcBalance: ethers.BigNumber = await usdc.balanceOf(proxyAddress);
  if (usdcBalance.lt(shortfall)) {
    throw new Error(
      `Insufficient collateral: need ${shortfall.toString()} more pUSD (or USDC.e to wrap)`
    );
  }

  const erc20Iface = new ethers.utils.Interface([
    "function approve(address spender, uint256 amount) returns (bool)",
  ]);
  const onrampIface = new ethers.utils.Interface(COLLATERAL_ONRAMP_WRAP_ABI);

  const approveCalldata = erc20Iface.encodeFunctionData("approve", [
    COLLATERAL_ONRAMP_ADDRESS,
    shortfall,
  ]);
  const wrapCalldata = onrampIface.encodeFunctionData("wrap", [
    USDC_E_ADDRESS,
    proxyAddress,
    shortfall,
  ]);

  await executeViaRelayer(signer, [
    { to: USDC_E_ADDRESS, data: approveCalldata, value: "0" },
    { to: COLLATERAL_ONRAMP_ADDRESS, data: wrapCalldata, value: "0" },
  ]);

  logInfo("trading.auto-wrap", { wrapped: shortfall.toString() });
}
```

- [ ] **Step 8.2: Call `ensurePusdSufficient` from `handlePlaceOrder` for BUY orders**

In `handlePlaceOrder`, before the market-order or limit-order branches, when `msg.side === "BUY"`:

```ts
if (msg.side === "BUY") {
  // Required pUSD = price * size for limit, or amount for market BUY
  const requiredPusd =
    orderType === "FAK" || orderType === "FOK"
      ? ethers.utils.parseUnits(
          String(msg.amount ?? msg.size),
          6
        )
      : ethers.utils.parseUnits(String(msg.price * msg.size), 6);

  await ensurePusdSufficient(
    signer,
    msg.proxyAddress,
    requiredPusd,
    provider
  );
}
```

- [ ] **Step 8.3: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both succeed.

- [ ] **Step 8.4: Commit**

```bash
git add apps/extension/src/background/trading-handler.ts
git commit -m "feat(clob-v2): auto-wrap USDC.e → pUSD before extension BUY orders

handlePlaceOrder now checks pUSD balance and, for BUY orders, dispatches
a single relayer batch (approve USDC.e → Onramp + wrap) when the user is
short pUSD. SELL orders skip the check."
```

---

## Task 9: Preprod Testing on `clob-v2.polymarket.com`

**Spec section:** Step 6.

**Files:** none (configuration + manual testing)

- [ ] **Step 9.1: Switch hosts to preprod**

Edit local `apps/web/.env.local`:
```
NEXT_PUBLIC_POLYMARKET_HOST=https://clob-v2.polymarket.com
```

Edit local `apps/extension/.env`:
```
POLY_BUILDER_CODE=<paste your builder code, or leave blank for unattributed>
# Add a CLOB host override if your extension code reads one — otherwise
# POLYMARKET_API.CLOB.BASE in @knoww/shared-types/polymarket needs a temp swap.
```

If the extension's CLOB host is hardcoded in `@knoww/shared-types/polymarket`, do NOT commit that swap — keep it as a local-only change for testing. Restore it before the cutover deploy.

- [ ] **Step 9.2: Run the smoke test matrix**

Build and run both apps:
```bash
pnpm -r build
pnpm --filter web dev
# in another terminal, load the extension dist into Chrome via chrome://extensions
```

For each row, manually verify in the app:

| Test | Pass criterion |
|---|---|
| Web: limit BUY | Order appears in open orders |
| Web: limit SELL | Order appears in open orders |
| Web: market BUY (FOK) | Fill returned, balance updates |
| Web: market SELL (FOK) | Fill returned, balance updates |
| Web: cancel single order | Order removed |
| Web: open orders fetch | Returns user's orders |
| Web: notifications fetch | Returns notifications |
| Web: neg-risk market trade | Order signs against neg-risk V2 exchange |
| Web: first-trade approve+wrap | Single relayer batch covers approval, wrap, and order |
| Web: API key derivation (new user) | New user can derive credentials |
| Web: relayer-backed CTF op (split or merge) | Existing CTF flow still works |
| Web: relayer-backed withdraw | Existing withdraw flow still works |
| Extension: limit BUY | Order appears in open orders |
| Extension: market BUY (FOK) | Fill returned |
| Extension: market SELL (FOK) | Fill returned |
| Extension: cancel | Order removed |
| Extension: relayer approve | Single batch approves USDC.e→Onramp + pUSD→V2 exchanges |
| Builder attribution | Test order appears under our builder code at https://builders.polymarket.com |

- [ ] **Step 9.3: File any bugs found**

If smoke tests fail:
- Code bug: add a fix commit to the feature branch and re-test.
- Spec ambiguity (e.g. CTF split needs pUSD too): document the new finding in the spec, decide whether to fix in this PR or follow-up branch.
- Polymarket-side bug: file with Polymarket support, note in cutover runbook.

- [ ] **Step 9.4: Restore production hosts in .env**

Switch `NEXT_PUBLIC_POLYMARKET_HOST` back to `https://clob.polymarket.com` in local `.env` files. (The repo's committed env example already points to prod.)

---

## Task 10: Cutover Day Runbook

**Spec section:** Step 7.

**Files:** none (operational)

- [ ] **Step 10.1: Pre-cutover checklist (T-1 day, before 2026-04-21 EOD)**

- All commits from Tasks 1-8 are merged to main.
- `NEXT_PUBLIC_POLY_BUILDER_CODE` is set in production hosting (Vercel/Cloudflare Pages).
- `POLY_BUILDER_CODE` is set in the extension build env for the next release.
- Web is deployed to production with V2 SDK.
- Extension is built and uploaded to the Chrome Web Store with V2 SDK.
- A user-facing maintenance banner is staged: "Polymarket maintenance 2026-04-22 11:00–12:00 UTC. All open orders will be cleared."

- [ ] **Step 10.2: Cutover-day actions (2026-04-22, around 11:00 UTC)**

- 10:30 UTC: Surface the maintenance banner in both apps.
- 11:00 UTC: Cutover begins. Trading endpoints will 5xx for ~1 hour. Don't auto-retry aggressively.
- During cutover: monitor https://status.polymarket.com.
- 12:00 UTC (or when status page goes green): place one smoke test order in production (limit BUY, small size, then cancel).

- [ ] **Step 10.3: Post-cutover monitoring (first hour after 12:00 UTC)**

- Monitor production error logs for CLOB-related failures.
- Monitor user-facing error reports / Discord / support tickets.
- If we see widespread "insufficient allowance" errors, surface a one-tap "Re-approve" CTA in the trading UI (the existing approve flow now produces the V2 set, so it's a single user click).
- Update banner: "Polymarket V2 is live. If your old open orders are gone, you can re-place them now."

- [ ] **Step 10.4: Track follow-up branches**

Create issues for the deferred work:
1. UI copy refresh (USDC.e → pUSD) across deposit, withdraw, balance, and trading-warning components.
2. Bridge audit — confirm bridge externally still uses USDC.e and that wrap+trade UX is clear to users.
3. Relayer V2 migration — once `@polymarket/builder-relayer-client` ships a V2 release, drop the HMAC proxy stack (`/api/sign`, `remote-builder-config.ts`, `sign-proxy-url.ts`, extension `builder-config.ts`).
4. CTF split/merge collateral question — confirm whether `splitPosition(USDC.e, …)` still works after V2 cutover or whether it needs to switch to pUSD; this depends on how Polymarket reconfigures the CTF contract.

---

## Self-Review Checklist (post-execution)

Before opening the PR, the executing agent should verify:

- [ ] All 8 implementation commits land sequentially and each one passes `pnpm -r typecheck && pnpm -r build`.
- [ ] No file was deleted that the spec said to preserve (`remote-builder-config.ts`, `sign-proxy-url.ts`, `/api/sign/route.ts`, extension `builder-config.ts`).
- [ ] `git grep "@polymarket/clob-client\b"` returns no matches in source files (only docs/lockfile).
- [ ] `git grep "feeRateBps" apps/web/src apps/extension/src` returns only the standalone display helper (`getFeeRateBps` callback in `use-clob-client.ts` and `handleGetFeeRate` in `trading-handler.ts`), not order-creation injection.
- [ ] `git grep "USDC_APPROVAL_TARGETS"` returns no matches (replaced).
- [ ] `git grep "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E\|0xC5d563A36AE78145C45a50134d48A1215220f80a"` returns no matches in source (V1 exchange addresses gone).
- [ ] `apps/extension/webpack.config.js` has the `process.env.POLY_BUILDER_CODE` DefinePlugin entry.
- [ ] All 12 preprod smoke tests pass.
- [ ] PR description summarizes the 8 commits and links the spec.
