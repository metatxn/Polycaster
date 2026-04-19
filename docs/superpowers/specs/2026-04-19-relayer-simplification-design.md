# Polymarket Relayer Simplification — Design Spec (Option B)

**Date:** 2026-04-19
**Cutover deadline:** 2026-04-22 ~11:00 UTC
**Scope:** Rewrite all Polymarket relayer interactions to bypass `@polymarket/builder-relayer-client` and `@polymarket/builder-signing-sdk`. Route relayer requests through a new web backend proxy that uses Polymarket's V2 `RELAYER_API_KEY` auth. Drop the entire HMAC signing infrastructure.

**Parent migration:** Builds on top of the [CLOB V2 migration](./2026-04-19-clob-v2-migration-design.md) (Tasks 1-8 already landed). This spec is the relayer-side counterpart.

## 1. Goals & Non-Goals

### Goals

- Eliminate `@polymarket/builder-signing-sdk` and `@polymarket/builder-relayer-client` from the dependency graph.
- Eliminate the in-app HMAC signing infrastructure: `apps/web/src/lib/remote-builder-config.ts`, `apps/web/src/lib/sign-proxy-url.ts`, `apps/web/src/app/api/sign/route.ts`, `apps/extension/src/background/builder-config.ts`.
- Route all relayer traffic (web + extension) through a single new Next.js endpoint (`/api/relayer/[...path]`) that holds the `RELAYER_API_KEY` server-side and forwards to `https://relayer-v2.polymarket.com`.
- Preserve all current relayer-backed user flows: Safe deployment, approval batches, CTF split/merge/redeem, withdraw, wrap-on-trade.
- Land in time for end-to-end testing before the 2026-04-22 cutover.

### Non-Goals

- Renaming `USDC.e` → `pUSD` in user-facing copy (still deferred).
- Bridge audit (still deferred).
- Changing the underlying Safe / CTF / Polymarket on-chain transaction flow. Same calldata, same signatures, same Polymarket relayer endpoint — only the auth and SDK wrapper change.

## 2. Pre-Migration Verified Facts

| Assumption | Status |
|---|---|
| Polymarket V2 relayer endpoint is `https://relayer-v2.polymarket.com` | Confirmed; codebase already points to it via `POLYMARKET_API.RELAYER.BASE` |
| V2 relayer accepts `RELAYER_API_KEY + RELAYER_API_KEY_ADDRESS` headers as auth alternative to HMAC | Confirmed via `/api-reference/relayer/submit-a-transaction.md` — both auth methods listed; neither deprecated |
| Relayer API Keys are issued via Gamma auth, max 100 per address | Confirmed via `/api-reference/relayer-api-keys/get-all-relayer-api-keys.md` |
| `@polymarket/builder-relayer-client@0.0.8` SDK only exposes HMAC `BuilderConfig` in its constructor | Confirmed by inspection of `client.d.ts` — no `relayerApiKey` parameter |
| Extension's `relayer-client.ts` already implements raw fetch + Safe multiSend logic without the SDK | Confirmed — serves as reference implementation for the web rewrite |
| Web's `use-relayer-client.ts` uses these SDK methods: `RelayClient.deploy()`, `.execute(txs)`, `.getDeployed(addr)`, `.getTransaction(id)`, `.wait()`, plus `deriveSafe()` and `getContractConfig()` | Confirmed by reading the file |
| Web's `use-ctf-operations.ts` uses: `RelayClient.execute(txs)` | Confirmed |
| Web's `use-withdraw.ts` uses: `RelayClient.execute(txs)` | Confirmed |
| Web's `use-clob-client.ts` (after Task 7) uses: `RelayClient.execute(txs)` for wrap-on-trade | Confirmed |
| Extension's `trading-handler.ts` calls `executeViaRelayer()` from `relayer-client.ts` (already raw fetch) | Confirmed |

## 3. Architecture Overview

```
┌────────────────┐                ┌──────────────────────────┐                ┌─────────────────────────┐
│  Web browser   │                │  knoww.app (Next.js)     │                │  relayer-v2.polymarket  │
│  Extension     │  ───POST──→    │  /api/relayer/[...path]  │  ───POST──→    │  /submit /nonce /...    │
│                │                │  - validates caller      │                │                         │
│                │                │  - adds RELAYER_API_KEY  │                │                         │
│                │                │  - forwards body         │                │                         │
└────────────────┘                └──────────────────────────┘                └─────────────────────────┘
```

Three layers change:

1. **New backend:** `apps/web/src/app/api/relayer/[...path]/route.ts` — a single dynamic Next.js route that proxies any path under `/api/relayer/` to `https://relayer-v2.polymarket.com`, attaching `RELAYER_API_KEY` and `RELAYER_API_KEY_ADDRESS` headers from server env vars.

2. **New shared web relayer client:** `apps/web/src/lib/relayer-client.ts` — a thin TypeScript module that exports the operations the SDK previously handled: `derivePolymarketSafe(eoa)`, `getNonce(eoa)`, `executeViaRelayer(walletClient, eoa, txns)`, `getTransaction(id)`, `pollUntilConfirmed(id)`, `getDeployed(safe)`, `deploySafe(walletClient, eoa)`. Internally it uses viem for EIP-712 signing and `fetch` against `/api/relayer/*`. It mirrors the contract of the extension's `relayer-client.ts` so the two implementations stay parallel.

3. **Migrated call sites:**
   - `apps/web/src/hooks/use-relayer-client.ts` — uses the new module instead of `@polymarket/builder-relayer-client`
   - `apps/web/src/hooks/use-ctf-operations.ts` — same
   - `apps/web/src/hooks/use-withdraw.ts` — same
   - `apps/web/src/hooks/use-clob-client.ts` — the Task 7 wrap-on-trade `getRelayClient` is replaced by a call to the new module
   - `apps/extension/src/background/relayer-client.ts` — change `RELAYER_URL` to point at `https://knoww.app/api/relayer`, drop the `createExtensionBuilderConfig` import, drop the `sendAuthedRequest` HMAC header generation. The extension proxy adds the auth on the way through.

The HMAC stack is then deleted, the deps are dropped, and the V2 relayer endpoint sees a single trusted caller (knoww.app's backend) instead of N browser/extension clients.

## 4. Step-by-Step Component Design

Each step is a single commit on the same `clob-v2` feature branch. Every commit must leave `pnpm -r build` and `pnpm -r typecheck` green.

### Step R1 — Backend proxy route

**File:** `apps/web/src/app/api/relayer/[...path]/route.ts` (new)

A dynamic Next.js App Router route that accepts GET and POST for any subpath under `/api/relayer/`. The route:

1. Validates the caller (see auth section below).
2. Constructs the upstream URL: `https://relayer-v2.polymarket.com/{path}` (preserving query string).
3. Forwards the body for POST; forwards query for GET.
4. Adds two headers to the upstream request:
   - `RELAYER_API_KEY: ${process.env.POLY_RELAYER_API_KEY}`
   - `RELAYER_API_KEY_ADDRESS: ${process.env.POLY_RELAYER_API_KEY_ADDRESS}`
5. Returns the upstream response body and status code.

**Caller authentication:**
- **Web (same-origin):** rely on Next.js's same-origin defaults plus an Origin/Referer check (must match `process.env.NEXT_PUBLIC_APP_URL`).
- **Extension (cross-origin):** require `Authorization: Bearer <token>` matching the extension session token, the same pattern the existing `/api/sign` route uses for extensions.

The actual transaction safety comes from the body: every relayer request includes a Safe-tx EIP-712 signature signed by the user's EOA. The Polymarket relayer rejects invalid signatures regardless of who proxies the call. The proxy auth only prevents random internet traffic from burning our Relayer API Key quota.

**Env vars needed:**
```
POLY_RELAYER_API_KEY=<server-side secret>
POLY_RELAYER_API_KEY_ADDRESS=<address that owns the key>
EXTENSION_AUTH_TOKEN=<the existing token used by /api/sign>  (already present)
NEXT_PUBLIC_APP_URL=https://knoww.app  (for origin checks)
```

**Endpoints proxied** (paths Polymarket V2 relayer exposes):
- `POST /submit`
- `GET /nonce`
- `GET /transaction`
- `GET /deployed`

The dynamic `[...path]` route handles all four via `params.path`.

### Step R2 — New shared web relayer client

**File:** `apps/web/src/lib/relayer-client.ts` (new)

The module replicates the small set of operations we actually use from `RelayClient`. Mirror the structure of `apps/extension/src/background/relayer-client.ts` so the two implementations look the same. Key exports:

```ts
export interface RelayerTransaction {
  to: string;
  data: string;
  value: string;
}

export interface RelayerExecuteResult {
  transactionID: string;
  transactionHash: string;
}

// Derivation
export function derivePolymarketSafe(eoaAddress: `0x${string}`): `0x${string}`;

// Read endpoints
export async function getDeployed(safeAddress: `0x${string}`): Promise<boolean>;
export async function getNonce(eoaAddress: `0x${string}`, type: "SAFE" | "PROXY"): Promise<string>;
export async function getTransaction(id: string): Promise<RelayerTxStatus[]>;

// Write
export async function executeViaRelayer(
  walletClient: WalletClient,
  eoaAddress: `0x${string}`,
  transactions: RelayerTransaction[]
): Promise<RelayerExecuteResult>;

export async function deploySafe(
  walletClient: WalletClient,
  eoaAddress: `0x${string}`
): Promise<RelayerExecuteResult>;

// Polling
export async function pollUntilConfirmed(transactionID: string, maxAttempts?: number): Promise<string>;
```

**Internals:**
- All HTTP calls use `fetch('/api/relayer/...')` — no upstream URL anywhere.
- `derivePolymarketSafe` uses CREATE2 with `SAFE_FACTORY_ADDRESS` and `SAFE_INIT_CODE_HASH` from `@knoww/shared-types/contracts` (same as extension).
- `executeViaRelayer` builds a Safe `multiSend` (delegatecall) when there are >1 transactions, computes the EIP-712 SafeTx struct hash, signs via `walletClient.signMessage`, packs the signature (r/s/v), and POSTs to `/api/relayer/submit`.
- `deploySafe` POSTs a SAFE-CREATE-typed transaction to `/api/relayer/submit` (matching the SDK's payload shape — see Polymarket relayer API reference).
- `pollUntilConfirmed` calls `getTransaction` until state is in `["STATE_EXECUTED", "STATE_MINED", "STATE_CONFIRMED"]` or fails on `["STATE_FAILED", "STATE_INVALID"]`.

Use viem (already in the web app) for EIP-712 hashing, signing, and ABI encoding. Reference the extension's ethers v5 implementation for byte-level correctness; viem and ethers produce the same hashes if the inputs match.

### Step R3 — Migrate `use-relayer-client.ts`

Replace all `RelayClient` imports/calls in `apps/web/src/hooks/use-relayer-client.ts` with calls to the new `apps/web/src/lib/relayer-client.ts`:

- `client.deploy()` → `deploySafe(walletClient, address)`
- `client.execute(txs)` → `executeViaRelayer(walletClient, address, txs)`
- `client.getDeployed(safe)` → `getDeployed(safe)`
- `client.getTransaction(id)` → `getTransaction(id)`
- `response.wait()` → `pollUntilConfirmed(response.transactionID)` (or remove if the new module already returns confirmed results)
- `deriveSafe(...)` → `derivePolymarketSafe(...)`
- `getContractConfig(...)` → use `SAFE_FACTORY_ADDRESS` directly (the only field we need)

Drop these imports:
- `import { RelayClient } from "@polymarket/builder-relayer-client"`
- `import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive"`
- `import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config"`
- `import { createBuilderConfig } from "@/lib/remote-builder-config"`
- `import { getBuilderSignProxyUrl } from "@/lib/sign-proxy-url"`

The hook's external API (returned object) stays the same — consumers don't change.

### Step R4 — Migrate `use-ctf-operations.ts` and `use-withdraw.ts`

Same substitutions as R3 for the two remaining web hooks. Both only use `RelayClient.execute(txs)` and the SDK's `getContractConfig`. Replace with `executeViaRelayer(...)` from the new module and direct `SAFE_FACTORY_ADDRESS` use.

### Step R5 — Migrate `use-clob-client.ts` wrap-on-trade

In Task 7 of the parent migration we added `getRelayClient` and `ensurePusdSufficient` inside `use-clob-client.ts`. Both use `RelayClient`. Replace them:

- Delete `getRelayClient` (no longer needed; the new module is stateless).
- In `ensurePusdSufficient`, replace the relayer batch call with `executeViaRelayer(walletClient, address, [approveCall, wrapCall])` followed by `pollUntilConfirmed(...)`.

Also drop the imports of `RelayClient`, `RELAYER_API_URL`, `createBuilderConfig`, `getBuilderSignProxyUrl` from this file.

### Step R6 — Migrate extension `relayer-client.ts`

The extension already implements raw fetch + Safe multiSend without the SDK. Two changes:

1. Update `RELAYER_URL` (line 27) to point to `https://knoww.app/api/relayer` (or `${KNOWW_APP_URL}/api/relayer` derived from `getKnowwAppUrl()` which the extension already has). The proxy adds the upstream URL itself.
2. Delete the `getBuilderHeaders` function and the `createExtensionBuilderConfig` import. Replace `sendAuthedRequest` with calls that send only the existing extension `Authorization: Bearer <token>` header (the proxy uses that for caller auth).

The Safe-tx signing logic stays exactly the same. The bytes the extension produces and ships to `/api/relayer/submit` are unchanged.

### Step R7 — Delete the HMAC stack

Once R3-R6 are landed and green, delete:
- `apps/web/src/lib/remote-builder-config.ts`
- `apps/web/src/lib/sign-proxy-url.ts`
- `apps/web/src/app/api/sign/route.ts`
- `apps/extension/src/background/builder-config.ts`

Verify with `git grep` that no source imports remain. Update any leftover imports that reference deleted modules.

### Step R8 — Drop dependencies

Remove from `apps/web/package.json`:
- `@polymarket/builder-signing-sdk`
- `@polymarket/builder-relayer-client`

Remove from root `package.json`:
- The pnpm override for `@polymarket/builder-signing-sdk`

Remove from `apps/extension/package.json`: nothing (extension never directly depended on either; it imported types via the web app's path which wasn't a real dep).

`pnpm install` to refresh the lockfile.

### Step R9 — Env var configuration

Update `.env` examples and deploy targets:

`apps/web/.env.local.example`:
```
POLY_RELAYER_API_KEY=
POLY_RELAYER_API_KEY_ADDRESS=
# (NEXT_PUBLIC_APP_URL and EXTENSION_AUTH_TOKEN already present)
```

Production hosting (Vercel/Cloudflare Pages): set both new env vars before deploying R1.

Remove (now-unused):
- `BUILDER_SIGNING_SERVER_URL`
- `INTERNAL_AUTH_TOKEN` (only if it was exclusively used by `/api/sign` — verify by grepping)

### Step R10 — Testing

Add to the parent migration's preprod smoke matrix (Task 9 / now Task 15):

| Test | Pass criterion |
|---|---|
| Web Safe deploy (new user) | Safe deployed, address persists |
| Web approve flow (full V2 set) | Single relayer batch covers all approvals |
| Web limit BUY with auto-wrap | approve+wrap+order succeeds atomically |
| Web market BUY with auto-wrap | Same |
| Web limit SELL | Direct order, no wrap |
| Web cancel | Order cancelled |
| Web CTF split | Conditional tokens minted |
| Web CTF merge | Tokens redeemed for collateral |
| Web withdraw | Bridge tx submitted via relayer |
| Extension limit BUY with auto-wrap | Same as web |
| Extension market BUY/SELL | Both succeed |
| Extension cancel | Works |
| Extension relayer-approve | Single batch covers V2 set |
| `/api/relayer/submit` proxy with bad auth | Returns 401 |
| `/api/relayer/submit` with valid extension token | Returns 200 + relayer response |
| `/api/relayer/submit` with valid web origin | Returns 200 + relayer response |

## 5. Rollback Plan

- Each step is a separate commit. If any step breaks, revert that commit and redeploy.
- The HMAC files and deps are NOT deleted until R7-R8. Until then, both code paths can theoretically coexist.
- If we discover a fatal flaw post-cutover, the V2 relayer still accepts HMAC headers — we could re-instate `/api/sign` and the SDK temporarily by reverting R3-R8.
- The Relayer API Key can be revoked from the Polymarket Builder Profile if it leaks.

## 6. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| EIP-712 hash mismatch between viem (web new) and ethers v5 (extension reference) | Medium | Cross-check the produced hash on a known transaction before deploying. Use the extension's existing implementation as the source of truth for byte-level correctness. |
| Safe multiSend payload encoding bug | Medium | Copy the extension's `aggregateSafeTransactions` logic verbatim into viem; verify with a test trade on preprod before the full smoke matrix. |
| The proxy becomes a single point of failure for all relayer traffic | Medium | knoww.app is already in the critical path for the extension's `/api/sign`; net-zero risk change. Add basic monitoring on the new route. |
| Polymarket rate-limits per IP and our backend exceeds the limit | Low | Polymarket's Relayer API Key model implies rate limits are per-key, not per-IP. If they aren't, we add caching or queueing — fix in flight. |
| Relayer API Key gets exposed in logs / leaked | Low | Treat as secret. Don't log request headers in the proxy. Rotate via Polymarket Builder Profile if leaked. |
| Existing `/api/sign` consumers we miss | Low | `git grep` is exhaustive; the only known consumers are the 4 deleted files in R7. |
| Cutover-day breakage from the new code path | Medium-high | Rationale for full preprod testing in R10. If the new path can't be validated by the cutover, revert the entire relayer-simplification branch and ship cutover-survival with the existing HMAC stack. |

## 7. Open Items

- Get the Relayer API Key from the Polymarket Builder Profile (manual step, before R1 is deployed).
- Decide on monitoring: Sentry instrumentation on the new route? Probably yes, mirror what `/api/sign` has.
- Confirm the proxy works under Cloudflare's edge runtime if that's where the web is deployed (Polymarket's relayer endpoints support standard `fetch`; should be fine).

## 8. References

- [Polymarket V2 Migration Guide — Builder Program](https://docs.polymarket.com/v2-migration#builder-program)
- [Polymarket Relayer API Reference](https://docs.polymarket.com/api-reference/relayer)
- [Submit a Transaction](https://docs.polymarket.com/api-reference/relayer/submit-a-transaction.md)
- [Get Relayer API Keys](https://docs.polymarket.com/api-reference/relayer-api-keys/get-all-relayer-api-keys.md)
- Extension reference impl: `apps/extension/src/background/relayer-client.ts`
- Parent migration spec: `docs/superpowers/specs/2026-04-19-clob-v2-migration-design.md`
