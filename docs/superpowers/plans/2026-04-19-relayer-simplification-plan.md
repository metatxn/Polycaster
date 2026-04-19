# Polymarket Relayer Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@polymarket/builder-relayer-client` and `@polymarket/builder-signing-sdk` with a thin custom relayer client that talks to a new Next.js backend proxy at `/api/relayer/[...path]`. The proxy authenticates upstream with `POLY_RELAYER_API_KEY` (a server-side secret). The HMAC signing infrastructure is then deleted entirely.

**Architecture:** All relayer traffic flows browser/extension → `knoww.app/api/relayer/*` → `relayer-v2.polymarket.com`. The proxy strips client-side auth, attaches `RELAYER_API_KEY + RELAYER_API_KEY_ADDRESS` headers, forwards body verbatim. EIP-712 SafeTx signing happens client-side via viem (web) or ethers v5 (extension, unchanged) using the same calldata Polymarket's relayer expects.

**Tech Stack:** Next.js 15 App Router (proxy), viem (web signing), ethers v5 (extension signing — unchanged), pnpm.

**Spec:** [docs/superpowers/specs/2026-04-19-relayer-simplification-design.md](../specs/2026-04-19-relayer-simplification-design.md)
**Reference impl (extension, already raw fetch):** `apps/extension/src/background/relayer-client.ts`

---

## File-by-File Map

| File | Why it changes | Task |
|---|---|---|
| `apps/web/src/app/api/relayer/[...path]/route.ts` | NEW — proxy route | R1 |
| `apps/web/.env.local.example` | Add `POLY_RELAYER_API_KEY` + `_ADDRESS` placeholders | R1 |
| `apps/web/src/lib/relayer-client.ts` | NEW — replaces SDK | R2 |
| `apps/web/src/hooks/use-relayer-client.ts` | Replace SDK calls with new module | R3 |
| `apps/web/src/hooks/use-ctf-operations.ts` | Replace SDK calls with new module | R4 |
| `apps/web/src/hooks/use-withdraw.ts` | Replace SDK calls with new module | R4 |
| `apps/web/src/hooks/use-clob-client.ts` | Replace `getRelayClient` + `ensurePusdSufficient` SDK usage | R5 |
| `apps/extension/src/background/relayer-client.ts` | Point `RELAYER_URL` at proxy; drop HMAC header logic | R6 |
| `apps/web/src/lib/remote-builder-config.ts` | DELETE | R7 |
| `apps/web/src/lib/sign-proxy-url.ts` | DELETE | R7 |
| `apps/web/src/app/api/sign/route.ts` | DELETE | R7 |
| `apps/extension/src/background/builder-config.ts` | DELETE | R7 |
| `apps/web/package.json` | Remove `@polymarket/builder-relayer-client`, `@polymarket/builder-signing-sdk` | R8 |
| `package.json` (root) | Remove `@polymarket/builder-signing-sdk` pnpm override | R8 |
| `pnpm-lock.yaml` | Regenerated | R8 |

---

## Task R1: Backend Proxy Route

**Goal:** A single Next.js route that authenticates the caller, forwards the request to V2 relayer with `RELAYER_API_KEY` headers, returns the response.

**Files:**
- Create: `apps/web/src/app/api/relayer/[...path]/route.ts`
- Modify: `apps/web/.env.local.example`

- [ ] **Step R1.1: Create the proxy route**

Create `apps/web/src/app/api/relayer/[...path]/route.ts`:

```ts
import { type NextRequest, NextResponse } from "next/server";

const UPSTREAM_BASE = "https://relayer-v2.polymarket.com";

const RELAYER_API_KEY = process.env.POLY_RELAYER_API_KEY;
const RELAYER_API_KEY_ADDRESS = process.env.POLY_RELAYER_API_KEY_ADDRESS;

// Allow-listed paths under /api/relayer/* — anything else is rejected.
const ALLOWED_PATHS = new Set(["submit", "nonce", "transaction", "deployed"]);

function unauthorized(reason: string) {
  return NextResponse.json({ ok: false, error: reason }, { status: 401 });
}

function badRequest(reason: string) {
  return NextResponse.json({ ok: false, error: reason }, { status: 400 });
}

function serverError(reason: string) {
  console.error("[relayer-proxy] server error:", reason);
  return NextResponse.json({ ok: false, error: reason }, { status: 500 });
}

/**
 * Authorize the caller. Two paths:
 * 1. Extension: requires Authorization: Bearer <EXTENSION_AUTH_TOKEN>
 * 2. Web: requires same-origin (Origin or Referer header matches NEXT_PUBLIC_APP_URL)
 */
function authorize(req: NextRequest): { ok: true } | { ok: false; reason: string } {
  // Extension path: bearer token
  const auth = req.headers.get("authorization");
  const expectedExtensionToken = process.env.EXTENSION_AUTH_TOKEN;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (expectedExtensionToken && token === expectedExtensionToken) {
      return { ok: true };
    }
    return { ok: false, reason: "invalid extension token" };
  }

  // Web path: same-origin check
  const expectedOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (!expectedOrigin) {
    return { ok: false, reason: "NEXT_PUBLIC_APP_URL not configured" };
  }
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (origin === expectedOrigin) return { ok: true };
  if (referer?.startsWith(expectedOrigin)) return { ok: true };
  return { ok: false, reason: "origin not allowed" };
}

async function proxy(
  req: NextRequest,
  pathSegments: string[],
  method: "GET" | "POST"
) {
  if (!RELAYER_API_KEY || !RELAYER_API_KEY_ADDRESS) {
    return serverError("relayer api key not configured");
  }

  const auth = authorize(req);
  if (!auth.ok) return unauthorized(auth.reason);

  const path = pathSegments.join("/");
  if (!ALLOWED_PATHS.has(pathSegments[0] ?? "")) {
    return badRequest(`path not allowed: /${path}`);
  }

  const search = req.nextUrl.search;
  const upstreamUrl = `${UPSTREAM_BASE}/${path}${search}`;

  const upstreamHeaders: Record<string, string> = {
    RELAYER_API_KEY,
    RELAYER_API_KEY_ADDRESS,
  };
  let body: string | undefined;
  if (method === "POST") {
    upstreamHeaders["Content-Type"] = "application/json";
    body = await req.text();
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      body,
    });
  } catch (err) {
    return serverError(
      `upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const responseBody = await upstreamRes.text();
  return new NextResponse(responseBody, {
    status: upstreamRes.status,
    headers: {
      "Content-Type":
        upstreamRes.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(req, path, "GET");
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(req, path, "POST");
}
```

- [ ] **Step R1.2: Add env placeholders**

Append to `apps/web/.env.local.example`:

```
# Polymarket V2 Relayer API Key — server-side secret.
# Obtain from https://polymarket.com/settings?tab=builder → "Relayer API Keys".
# Used by /api/relayer/[...path] to authenticate to relayer-v2.polymarket.com.
POLY_RELAYER_API_KEY=
POLY_RELAYER_API_KEY_ADDRESS=
```

- [ ] **Step R1.3: Verify build is green**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both pass. The new route's behavior isn't tested yet — that comes in R10.

- [ ] **Step R1.4: Commit**

```bash
git add apps/web/src/app/api/relayer apps/web/.env.local.example
git commit -m "feat(relayer-v2): add /api/relayer/[...path] proxy with RELAYER_API_KEY auth

Single Next.js dynamic route forwards GET/POST requests under /api/relayer/*
to https://relayer-v2.polymarket.com/{submit,nonce,transaction,deployed}.

Caller authentication:
- Extension: Authorization: Bearer <EXTENSION_AUTH_TOKEN>
- Web: same-origin (Origin/Referer matches NEXT_PUBLIC_APP_URL)

Upstream auth uses POLY_RELAYER_API_KEY + POLY_RELAYER_API_KEY_ADDRESS
server-side env vars; never reaches the client."
```

---

## Task R2: New Shared Web Relayer Client

**Goal:** A small TypeScript module that exposes the operations our hooks need, using viem + raw fetch instead of `@polymarket/builder-relayer-client`.

**File:**
- Create: `apps/web/src/lib/relayer-client.ts`

**Reference implementation:** `apps/extension/src/background/relayer-client.ts` (already raw fetch + ethers v5; we're porting its logic to viem).

- [ ] **Step R2.1: Read the reference implementation**

Open and read `apps/extension/src/background/relayer-client.ts` end-to-end. Note these helper patterns we'll need to mirror in viem:
- `deriveSafeAddress(eoa)` — CREATE2 with `SAFE_FACTORY_ADDRESS` + `SAFE_INIT_CODE_HASH`
- `aggregateSafeTransactions(txns)` — multiSend via `SAFE_MULTISEND` (`0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761`)
- `createSafeTxStructHash(chainId, safe, tx, nonce)` — EIP-712 SafeTx hash
- `splitAndPackSignature(sig)` — r/s/v packing with v adjustment for Safe
- `executeViaRelayer(signer, txns)` — full flow: derive Safe, get nonce, build agg, sign, submit, poll
- `pollTransaction(transactionID)` — state machine over success/failure states

The web version uses **viem instead of ethers**. Equivalents:
| ethers v5 | viem |
|---|---|
| `ethers.utils.defaultAbiCoder.encode` | `encodeAbiParameters` |
| `ethers.utils.keccak256` | `keccak256` |
| `ethers.utils.getCreate2Address` | `getContractAddress({ opcode: 'CREATE2', ... })` |
| `ethers.utils.solidityPack` | `encodePacked` |
| `ethers.utils.Interface().encodeFunctionData` | `encodeFunctionData` |
| `ethers.utils._TypedDataEncoder.hash(domain, types, values)` | `hashTypedData({ domain, types, primaryType, message })` |
| `signer.signMessage(arrayify(hash))` | `walletClient.signMessage({ message: { raw: hash } })` |

- [ ] **Step R2.2: Create the new module**

Create `apps/web/src/lib/relayer-client.ts`:

```ts
/**
 * Polymarket V2 Relayer Client (web).
 *
 * Replaces @polymarket/builder-relayer-client with a thin custom client that:
 *   - Talks to /api/relayer/[...path] (which proxies to relayer-v2.polymarket.com
 *     and adds RELAYER_API_KEY headers server-side)
 *   - Builds Safe multiSend transactions with viem
 *   - Signs SafeTx EIP-712 with the user's viem WalletClient
 *
 * Mirrors the structure of apps/extension/src/background/relayer-client.ts
 * (which does the same thing with ethers v5 inside the extension service worker).
 */

import {
  SAFE_FACTORY_ADDRESS,
  SAFE_INIT_CODE_HASH,
} from "@knoww/shared-types/contracts";
import {
  type Address,
  type Hex,
  type WalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  keccak256,
  parseAbi,
  size,
  zeroAddress,
} from "viem";

const PROXY_BASE = "/api/relayer";
const SAFE_MULTISEND: Address = "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761";
const CHAIN_ID = 137;

const SUCCESS_STATES = new Set(["STATE_EXECUTED", "STATE_MINED", "STATE_CONFIRMED"]);
const FAILURE_STATES = new Set(["STATE_FAILED", "STATE_INVALID"]);

export interface RelayerTransaction {
  to: Address;
  data: Hex;
  value: string; // decimal string, matches Polymarket relayer payload
}

interface SafeTransaction {
  to: Address;
  operation: 0 | 1; // 0 = Call, 1 = DelegateCall
  data: Hex;
  value: string;
}

export interface RelayerExecuteResult {
  transactionID: string;
  transactionHash: string;
}

interface RelayerTxStatus {
  transactionID: string;
  transactionHash: string;
  state: string;
  errorMsg?: string;
}

/**
 * Derive the user's Polymarket Safe address via CREATE2.
 * Matches @polymarket/builder-relayer-client's deriveSafe().
 */
export function derivePolymarketSafe(eoaAddress: Address): Address {
  const salt = keccak256(
    encodeAbiParameters([{ type: "address" }], [eoaAddress])
  );
  return getContractAddress({
    opcode: "CREATE2",
    from: SAFE_FACTORY_ADDRESS as Address,
    salt,
    bytecodeHash: SAFE_INIT_CODE_HASH as Hex,
  });
}

/**
 * Aggregate >1 transactions into a single Safe multiSend (delegatecall).
 * Single-tx batches pass through unchanged.
 */
function aggregateSafeTransactions(txns: SafeTransaction[]): SafeTransaction {
  if (txns.length === 1) return txns[0];

  const packed = txns
    .map((tx) => {
      const dataLen = size(tx.data);
      return encodePacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [tx.operation, tx.to, BigInt(tx.value), BigInt(dataLen), tx.data]
      );
    })
    .reduce<Hex>((acc, cur) => `${acc}${cur.slice(2)}` as Hex, "0x");

  const data = encodeFunctionData({
    abi: parseAbi(["function multiSend(bytes transactions)"]),
    functionName: "multiSend",
    args: [packed],
  });

  return {
    to: SAFE_MULTISEND,
    value: "0",
    data,
    operation: 1,
  };
}

/**
 * EIP-712 hash of a SafeTx for signing.
 */
function safeTxHash(args: {
  chainId: number;
  safe: Address;
  tx: SafeTransaction;
  nonce: string;
}): Hex {
  const { chainId, safe, tx, nonce } = args;
  return keccak256(
    encodePacked(
      ["bytes1", "bytes1", "bytes32", "bytes32"],
      [
        "0x19",
        "0x01",
        // Domain separator
        keccak256(
          encodeAbiParameters(
            [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
            [
              keccak256(
                new TextEncoder().encode(
                  "EIP712Domain(uint256 chainId,address verifyingContract)"
                ).buffer as ArrayBuffer
              ) as Hex,
              BigInt(chainId),
              safe,
            ]
          )
        ),
        // SafeTx struct hash
        keccak256(
          encodeAbiParameters(
            [
              { type: "bytes32" }, // typehash
              { type: "address" }, // to
              { type: "uint256" }, // value
              { type: "bytes32" }, // keccak(data)
              { type: "uint8" },   // operation
              { type: "uint256" }, // safeTxGas
              { type: "uint256" }, // baseGas
              { type: "uint256" }, // gasPrice
              { type: "address" }, // gasToken
              { type: "address" }, // refundReceiver
              { type: "uint256" }, // nonce
            ],
            [
              keccak256(
                new TextEncoder().encode(
                  "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
                ).buffer as ArrayBuffer
              ) as Hex,
              tx.to,
              BigInt(tx.value),
              keccak256(tx.data),
              tx.operation,
              0n,
              0n,
              0n,
              zeroAddress,
              zeroAddress,
              BigInt(nonce),
            ]
          )
        ),
      ]
    )
  );
}

/**
 * Pack r/s/v for Safe contract verification. Adjusts v: 0/1 -> 31/32, 27/28 -> 31/32.
 */
function packSignature(signature: Hex): Hex {
  const raw = signature.startsWith("0x") ? signature.slice(2) : signature;
  const r = BigInt(`0x${raw.slice(0, 64)}`);
  const s = BigInt(`0x${raw.slice(64, 128)}`);
  let v = parseInt(raw.slice(128, 130), 16);
  if (v === 0 || v === 1) v += 31;
  else if (v === 27 || v === 28) v += 4;
  return encodePacked(["uint256", "uint256", "uint8"], [r, s, v]);
}

// ── HTTP helpers ──

async function proxyGet<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(`${PROXY_BASE}/${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`relayer GET /${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function proxyPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`relayer POST /${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

// ── Public API ──

export async function getDeployed(safeAddress: Address): Promise<boolean> {
  const res = await proxyGet<{ deployed: boolean }>("deployed", {
    address: safeAddress,
  });
  return res.deployed;
}

export async function getNonce(
  eoaAddress: Address,
  type: "SAFE" | "PROXY" = "SAFE"
): Promise<string> {
  const res = await proxyGet<{ nonce: string }>("nonce", {
    address: eoaAddress,
    type,
  });
  return res.nonce;
}

export async function getTransaction(
  transactionID: string
): Promise<RelayerTxStatus[]> {
  return proxyGet<RelayerTxStatus[]>("transaction", { id: transactionID });
}

export async function pollUntilConfirmed(
  transactionID: string,
  maxAttempts = 20,
  intervalMs = 2000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const txns = await getTransaction(transactionID);
    if (txns.length > 0) {
      const tx = txns[0];
      if (FAILURE_STATES.has(tx.state)) {
        const detail = tx.errorMsg ? `: ${tx.errorMsg}` : "";
        throw new Error(
          `Transaction ${transactionID} failed (${tx.state})${detail}`
        );
      }
      if (SUCCESS_STATES.has(tx.state)) {
        return tx.transactionHash;
      }
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`Transaction ${transactionID} did not confirm in time`);
}

export async function executeViaRelayer(
  walletClient: WalletClient,
  eoaAddress: Address,
  transactions: RelayerTransaction[]
): Promise<RelayerExecuteResult> {
  if (transactions.length === 0) {
    throw new Error("No transactions to execute");
  }

  const safeAddress = derivePolymarketSafe(eoaAddress);

  const safeTxns: SafeTransaction[] = transactions.map((t) => ({
    to: t.to,
    operation: 0,
    data: t.data,
    value: t.value || "0",
  }));
  const aggregated = aggregateSafeTransactions(safeTxns);

  const nonce = await getNonce(eoaAddress, "SAFE");
  const hash = safeTxHash({
    chainId: CHAIN_ID,
    safe: safeAddress,
    tx: aggregated,
    nonce,
  });

  const signature = await walletClient.signMessage({
    account: eoaAddress,
    message: { raw: hash },
  });
  const packedSig = packSignature(signature);

  const submitRes = await proxyPost<{
    transactionID: string;
    state: string;
    transactionHash: string;
  }>("submit", {
    from: eoaAddress,
    to: aggregated.to,
    proxyWallet: safeAddress,
    data: aggregated.data,
    nonce,
    signature: packedSig,
    signatureParams: {
      gasPrice: "0",
      operation: String(aggregated.operation),
      safeTxnGas: "0",
      baseGas: "0",
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
    },
    type: "SAFE",
    metadata: "",
  });

  if (FAILURE_STATES.has(submitRes.state)) {
    throw new Error(
      `Relayer rejected submit immediately (${submitRes.state})`
    );
  }

  const txHash = await pollUntilConfirmed(submitRes.transactionID);
  return {
    transactionID: submitRes.transactionID,
    transactionHash: txHash,
  };
}

export async function deploySafe(
  walletClient: WalletClient,
  eoaAddress: Address
): Promise<RelayerExecuteResult> {
  const nonce = await getNonce(eoaAddress, "PROXY");
  // For SAFE-CREATE the body shape Polymarket expects differs slightly.
  // Read the extension's deploy-equivalent behavior or the SDK's
  // executeSafeTransactions / _deploy private impl for the exact body.
  // For now we stub this and document it as TODO during R3 implementation.
  throw new Error(
    "deploySafe not yet implemented in custom relayer client; " +
      "see SDK's _deploy for body shape"
  );
}
```

> **Note on `deploySafe`:** the SAFE-CREATE body is not the same as the SAFE submit body. The exact shape requires reading the SDK's `_deploy` private method (it's in `client.js` of `@polymarket/builder-relayer-client`). The implementer should inspect that file once during this task and translate the body verbatim. Don't ship without `deploySafe` working — `use-relayer-client.ts` calls it.

- [ ] **Step R2.3: Implement `deploySafe` by inspecting the SDK**

Read `node_modules/@polymarket/builder-relayer-client/dist/client.js` for the `_deploy` method. Translate the request body it builds into the `deploySafe` function above. The endpoint is still `/submit` but with `type: "SAFE-CREATE"` (or whatever the SDK uses).

- [ ] **Step R2.4: Cross-check the SafeTx hash against extension output**

Before continuing, sanity-check the new `safeTxHash` produces the same bytes as the extension's `createSafeTxStructHash` for an identical input. Pick a known transaction (e.g. an approve) and compute the hash both ways:

```ts
// Quick test — paste in a Node REPL or temp file:
import { safeTxHash } from "@/lib/relayer-client";
// vs ethers (manual)
const hashViem = safeTxHash({ chainId: 137, safe: "0x...", tx: { to: "0x...", data: "0x...", value: "0", operation: 0 }, nonce: "1" });
// Print both, must match.
```

If hashes don't match, the EIP-712 encoding is wrong. Compare each step (typehash, struct hash, domain separator) in isolation.

- [ ] **Step R2.5: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: typecheck passes; web build passes (the new module is unused by any consumer yet — that's R3+).

- [ ] **Step R2.6: Commit**

```bash
git add apps/web/src/lib/relayer-client.ts
git commit -m "feat(relayer-v2): add custom web relayer client with viem + /api/relayer

Mirrors apps/extension/src/background/relayer-client.ts (ethers v5) but
implemented with viem for the web app. Operations: derivePolymarketSafe,
getDeployed, getNonce, getTransaction, pollUntilConfirmed, executeViaRelayer,
deploySafe.

All HTTP calls go through /api/relayer/[...path] (added in R1). No SDK
dependency, no HMAC headers, no client-side secrets."
```

---

## Task R3: Migrate `use-relayer-client.ts`

**File:**
- Modify: `apps/web/src/hooks/use-relayer-client.ts`

- [ ] **Step R3.1: Replace SDK imports with new module**

Re-read `apps/web/src/hooks/use-relayer-client.ts`. Replace these imports at the top:

```ts
// REMOVE:
// import { createBuilderConfig } from "@/lib/remote-builder-config";
// import { getBuilderSignProxyUrl } from "@/lib/sign-proxy-url";
// (no static "@polymarket/builder-relayer-client" import)

// ADD:
import {
  derivePolymarketSafe,
  deploySafe as relayerDeploySafe,
  executeViaRelayer,
  getDeployed,
  pollUntilConfirmed,
} from "@/lib/relayer-client";
```

- [ ] **Step R3.2: Replace `getClient` callback**

The `getClient` callback that constructs `new RelayClient(...)` is no longer needed — the new module is stateless. Delete it.

- [ ] **Step R3.3: Replace `deriveSafeAddress` callback**

Replace its body:

```ts
const deriveSafeAddress = useCallback(async (): Promise<string | null> => {
  if (!address) return null;
  try {
    return derivePolymarketSafe(address as `0x${string}`);
  } catch (err) {
    console.warn("[RelayerClient] derive failed:", err);
    return null;
  }
}, [address]);
```

Remove the dynamic imports of `@polymarket/builder-relayer-client/dist/builder/derive` and `@polymarket/builder-relayer-client/dist/config`.

- [ ] **Step R3.4: Replace `deploySafe` callback**

Replace `await client.deploy()` and `await response.wait()` with the new module's `deploySafe`:

```ts
const deploySafe = useCallback(async () => {
  if (!walletClient || !address) {
    return { success: false, error: "Wallet not connected" };
  }
  setState((prev) => ({ ...prev, isLoading: true, error: null }));
  try {
    const result = await relayerDeploySafe(walletClient, address as `0x${string}`);
    const safe = derivePolymarketSafe(address as `0x${string}`);
    setState((prev) => ({
      ...prev,
      isLoading: false,
      proxyAddress: safe,
      hasDeployedSafe: true,
    }));
    return { success: true, transactionHash: result.transactionHash, proxyAddress: safe };
  } catch (err) {
    // Existing "safe already deployed" handling
    const errMessage = err instanceof Error ? err.message : String(err);
    if (errMessage.toLowerCase().includes("safe already deployed")) {
      const derived = derivePolymarketSafe(address as `0x${string}`);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        proxyAddress: derived,
        hasDeployedSafe: true,
      }));
      return {
        success: true,
        transactionHash: "",
        proxyAddress: derived,
        alreadyDeployed: true,
      };
    }
    const errorMessage = errMessage || "Failed to deploy Safe";
    setState((prev) => ({ ...prev, isLoading: false, error: errorMessage }));
    return { success: false, error: errorMessage };
  }
}, [walletClient, address]);
```

- [ ] **Step R3.5: Replace `approveUsdcForTrading` execute call**

Replace `client.execute(approvalTxs)` followed by polling with a single `executeViaRelayer`:

```ts
// In approveUsdcForTrading, replace the entire client.execute + polling block with:
const result = await executeViaRelayer(
  walletClient,
  address as `0x${string}`,
  approvalTxs.map((t) => ({
    to: t.to as `0x${string}`,
    data: t.data as `0x${string}`,
    value: t.value,
  }))
);
// Result: { transactionID, transactionHash }. No need to poll separately.

setState((prev) => ({ ...prev, isLoading: false }));
return { success: true, transactionHash: result.transactionHash };
```

The existing retry-on-`STATE_FAILED` loop can stay if you wrap `executeViaRelayer` in the same try/catch + retry. But `executeViaRelayer` throws on failure states already — so the retry can just catch the throw and retry.

- [ ] **Step R3.6: Replace `client.getDeployed(safe)` in approveUsdcForTrading**

```ts
const isDeployed = await getDeployed(expectedSafe as `0x${string}`);
```

- [ ] **Step R3.7: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both pass. There may be type errors if existing consumers pass `string` where `Address` is expected — narrow with `as \`0x${string}\``.

- [ ] **Step R3.8: Commit**

```bash
git add apps/web/src/hooks/use-relayer-client.ts
git commit -m "refactor(relayer-v2): use custom relayer client in use-relayer-client hook

Drops @polymarket/builder-relayer-client and the HMAC builderConfig;
calls the new /api/relayer proxy via apps/web/src/lib/relayer-client.ts.

All public hook API unchanged; consumers don't need updates."
```

---

## Task R4: Migrate `use-ctf-operations.ts` and `use-withdraw.ts`

**Files:**
- Modify: `apps/web/src/hooks/use-ctf-operations.ts`
- Modify: `apps/web/src/hooks/use-withdraw.ts`

- [ ] **Step R4.1: Migrate `use-ctf-operations.ts`**

Re-read the file. Find every `RelayClient` import and call. Replace with `executeViaRelayer` from `@/lib/relayer-client`. Drop `createBuilderConfig` / `getBuilderSignProxyUrl` imports if present.

The pattern:

```ts
// before
const { RelayClient } = await import("@polymarket/builder-relayer-client");
const builderConfig = createBuilderConfig({ url: getBuilderSignProxyUrl() });
const client = new RelayClient(RELAYER_API_URL, POLYGON_CHAIN_ID, walletClient, builderConfig);
const response = await client.execute(txs);
const result = await client.getTransaction(response.transactionID);
// ...

// after
import { executeViaRelayer } from "@/lib/relayer-client";
// ...
const result = await executeViaRelayer(
  walletClient,
  address as `0x${string}`,
  txs.map(t => ({ to: t.to as `0x${string}`, data: t.data as `0x${string}`, value: t.value }))
);
// result.transactionHash is the on-chain tx hash, already polled to confirmation
```

- [ ] **Step R4.2: Migrate `use-withdraw.ts`**

Same substitutions as R4.1.

- [ ] **Step R4.3: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both pass.

- [ ] **Step R4.4: Commit**

```bash
git add apps/web/src/hooks/use-ctf-operations.ts apps/web/src/hooks/use-withdraw.ts
git commit -m "refactor(relayer-v2): use custom relayer client in CTF + withdraw hooks

Drops the SDK + HMAC builderConfig from use-ctf-operations and use-withdraw.
Both now go through /api/relayer via apps/web/src/lib/relayer-client.ts."
```

---

## Task R5: Migrate `use-clob-client.ts` Wrap-on-Trade

**File:**
- Modify: `apps/web/src/hooks/use-clob-client.ts`

- [ ] **Step R5.1: Drop SDK imports**

Re-read `apps/web/src/hooks/use-clob-client.ts`. Delete these imports:
- `createBuilderConfig` from `@/lib/remote-builder-config`
- `getBuilderSignProxyUrl` from `@/lib/sign-proxy-url`
- `RELAYER_API_URL` from `@/constants/polymarket` (if no longer used)

Add:
```ts
import { executeViaRelayer } from "@/lib/relayer-client";
```

- [ ] **Step R5.2: Delete `getRelayClient`**

The `getRelayClient` callback added in Task 7 of the parent migration is no longer needed. Delete it entirely.

- [ ] **Step R5.3: Replace the relayer call in `ensurePusdSufficient`**

Find the part of `ensurePusdSufficient` that constructs/uses `RelayClient`. Replace with:

```ts
await executeViaRelayer(
  walletClient,
  address as `0x${string}`,
  [
    { to: USDC_E_ADDRESS as `0x${string}`, data: approveCalldata, value: "0" },
    { to: COLLATERAL_ONRAMP_ADDRESS as `0x${string}`, data: wrapCalldata, value: "0" },
  ]
);
```

The function signature for `ensurePusdSufficient` may need to take `walletClient` and `address` if it's at module-level rather than inside the hook closure. Keep the existing wiring; only change the relayer invocation.

- [ ] **Step R5.4: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both pass.

- [ ] **Step R5.5: Commit**

```bash
git add apps/web/src/hooks/use-clob-client.ts
git commit -m "refactor(relayer-v2): use custom relayer client for wrap-on-trade

Replaces the Task 7 RelayClient wiring inside ensurePusdSufficient with
a direct executeViaRelayer call. getRelayClient callback removed."
```

---

## Task R6: Migrate Extension `relayer-client.ts`

**File:**
- Modify: `apps/extension/src/background/relayer-client.ts`

- [ ] **Step R6.1: Point `RELAYER_URL` at the proxy**

Re-read `apps/extension/src/background/relayer-client.ts`. The current line 27 is:

```ts
const RELAYER_URL = POLYMARKET_API.RELAYER.BASE.replace(/\/$/, "");
```

Replace with the proxy URL derived from the knoww.app base:

```ts
import { getKnowwAppUrl } from "./extension-session";
// ...
const RELAYER_URL = `${getKnowwAppUrl().replace(/\/$/, "")}/api/relayer`;
```

(`getKnowwAppUrl` is the existing helper used by `builder-config.ts` to derive the host for `/api/sign`.)

- [ ] **Step R6.2: Drop HMAC header generation**

Delete the `getBuilderHeaders` function and its `createExtensionBuilderConfig` import. Also delete the `import { createExtensionBuilderConfig } from "./builder-config";` at the top.

- [ ] **Step R6.3: Replace `sendAuthedRequest` to send extension bearer instead**

The proxy authenticates via `Authorization: Bearer <EXTENSION_AUTH_TOKEN>`. Replace `sendAuthedRequest` to:

```ts
async function sendAuthedRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: string,
  params?: Record<string, string>
): Promise<T> {
  // The existing auth flow used getAccessTokenViaMessage from builder-config.ts.
  // Keep that pattern — the extension session token IS the EXTENSION_AUTH_TOKEN.
  const token = await getAccessTokenViaMessage();
  if (!token) {
    throw new Error(EXTENSION_AUTH_REQUIRED_ERROR);
  }
  const headers = { Authorization: `Bearer ${token}` };

  if (method === "GET") {
    return relayerGet<T>(path, params ?? {}, headers);
  }
  return relayerPost<T>(path, body ?? "", headers);
}
```

`getAccessTokenViaMessage` currently lives in `builder-config.ts`. Move it into `relayer-client.ts` (or a new `extension-auth.ts` shared helper) since `builder-config.ts` is being deleted in R7.

- [ ] **Step R6.4: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both pass. Trade-handler still uses `executeViaRelayer` from this file; its callers don't change.

- [ ] **Step R6.5: Commit**

```bash
git add apps/extension/src/background/relayer-client.ts apps/extension/src/background/extension-auth.ts
# or whatever filename you chose for the moved getAccessTokenViaMessage
git commit -m "refactor(relayer-v2): point extension relayer at /api/relayer proxy

- RELAYER_URL switched from relayer-v2.polymarket.com to knoww.app/api/relayer
- HMAC header generation deleted (proxy adds RELAYER_API_KEY upstream)
- Auth is now just the existing extension Bearer token"
```

---

## Task R7: Delete the HMAC Stack

**Files:**
- Delete: `apps/web/src/lib/remote-builder-config.ts`
- Delete: `apps/web/src/lib/sign-proxy-url.ts`
- Delete: `apps/web/src/app/api/sign/route.ts`
- Delete: `apps/extension/src/background/builder-config.ts`

- [ ] **Step R7.1: Verify no remaining imports**

```bash
git grep -l "remote-builder-config\|sign-proxy-url\|builder-config\|/api/sign" apps/web/src apps/extension/src
```

Expected: no source matches. If any remain, fix them before deleting.

- [ ] **Step R7.2: Delete the files**

```bash
git rm apps/web/src/lib/remote-builder-config.ts \
       apps/web/src/lib/sign-proxy-url.ts \
       apps/web/src/app/api/sign/route.ts \
       apps/extension/src/background/builder-config.ts
```

- [ ] **Step R7.3: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both pass.

- [ ] **Step R7.4: Commit**

```bash
git commit -m "chore(relayer-v2): delete HMAC signing stack

The relayer now uses RELAYER_API_KEY auth via /api/relayer proxy. The
HMAC infrastructure is no longer used by any consumer:

- apps/web/src/lib/remote-builder-config.ts
- apps/web/src/lib/sign-proxy-url.ts
- apps/web/src/app/api/sign/route.ts
- apps/extension/src/background/builder-config.ts

Verified zero source imports remain."
```

---

## Task R8: Drop Dependencies

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package.json` (root)
- Modify: `pnpm-lock.yaml`

- [ ] **Step R8.1: Remove from web package.json**

Edit `apps/web/package.json`, delete:

```json
"@polymarket/builder-relayer-client": "0.0.8",
"@polymarket/builder-signing-sdk": "1.0.0",
```

- [ ] **Step R8.2: Remove root override**

Edit `package.json` (root), delete from `pnpm.overrides`:

```json
"@polymarket/builder-signing-sdk": "1.0.0",
```

- [ ] **Step R8.3: Refresh lockfile**

Run: `pnpm install`
Expected: succeeds; lockfile updates.

- [ ] **Step R8.4: Verify build**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: both pass.

- [ ] **Step R8.5: Commit**

```bash
git add apps/web/package.json package.json pnpm-lock.yaml
git commit -m "chore(relayer-v2): drop @polymarket/builder-relayer-client and builder-signing-sdk

Both deps are no longer imported anywhere in source. The relayer flow
runs entirely through /api/relayer/[...path] proxy + apps/web/src/lib/
relayer-client.ts."
```

---

## Task R9: Production Env Configuration

**Files:** none (operational)

- [ ] **Step R9.1: Set production env vars**

In Vercel / Cloudflare Pages (or wherever the web app deploys):

```
POLY_RELAYER_API_KEY=<from Polymarket Builder Profile>
POLY_RELAYER_API_KEY_ADDRESS=<address that owns the key>
```

`NEXT_PUBLIC_APP_URL` and `EXTENSION_AUTH_TOKEN` should already be set.

Remove these (now-unused):

```
BUILDER_SIGNING_SERVER_URL
INTERNAL_AUTH_TOKEN  # only if it was exclusively used by /api/sign — verify with git log
```

- [ ] **Step R9.2: Verify env in deploy preview**

Deploy a preview to Vercel/Cloudflare. Hit `https://<preview>/api/relayer/deployed?address=0x0000…` with a known Safe address. Expected: returns `{ "deployed": false }` (or true). If returns 401, the env vars aren't set or NEXT_PUBLIC_APP_URL is wrong.

---

## Task R10: End-to-End Smoke Tests

**Files:** none (manual)

- [ ] **Step R10.1: Local preprod**

Set local `apps/web/.env.local`:
```
NEXT_PUBLIC_POLYMARKET_HOST=https://clob-v2.polymarket.com
POLY_RELAYER_API_KEY=<dev key>
POLY_RELAYER_API_KEY_ADDRESS=<dev address>
```

Run `pnpm --filter web dev` and load the extension dist into Chrome.

- [ ] **Step R10.2: Run the smoke matrix**

For each row, run on web AND extension where applicable:

| Test | Pass |
|---|---|
| Web: Safe deploy (new test EOA) | Safe address persists |
| Web: full V2 approval batch | Single relayer batch confirms |
| Web: limit BUY with auto-wrap | approve+wrap+order succeed |
| Web: market BUY with auto-wrap | Same |
| Web: limit SELL | Order posts |
| Web: cancel | Order removed |
| Web: CTF split | Conditional tokens minted |
| Web: CTF merge | Tokens redeemed |
| Web: withdraw | Bridge tx submitted |
| Extension: limit BUY with auto-wrap | Same |
| Extension: market BUY/SELL | Both work |
| Extension: cancel | Works |
| Extension: relayer-approve | V2 set approved in one batch |
| `/api/relayer/submit` no auth | 401 |
| `/api/relayer/submit` invalid bearer | 401 |
| `/api/relayer/submit` valid extension bearer | 200 |
| `/api/relayer/submit` valid web origin | 200 |
| `/api/relayer/foo` (not in allow list) | 400 |

If anything fails, file a fix commit on the branch and re-run.

---

## Self-Review Checklist (post-execution, before merge)

- [ ] `git grep "@polymarket/builder-relayer-client\|@polymarket/builder-signing-sdk"` — only matches in lockfile / docs.
- [ ] `git grep "BuilderConfig\|createBuilderConfig\|createExtensionBuilderConfig"` — no source matches.
- [ ] `git grep "/api/sign"` — no source matches.
- [ ] `pnpm -r typecheck && pnpm -r build` green.
- [ ] R10 smoke matrix all green on preprod.
- [ ] Production env vars set in hosting.
- [ ] Cutover-day banner ready (independent of this branch — see parent migration Task 16).
