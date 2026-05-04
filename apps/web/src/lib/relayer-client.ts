/**
 * Polymarket V2 Relayer Client (web).
 *
 * Replaces @polymarket/builder-relayer-client with a thin custom client that:
 *   - Talks to /api/relayer/[...path] (which proxies to relayer-v2.polymarket.com
 *     and adds RELAYER_API_KEY headers server-side)
 *   - Builds Safe multiSend transactions with viem
 *   - Signs SafeTx EIP-712 with the user's viem WalletClient
 *
 * The SafeTx EIP-712 hash, Safe derivation, multiSend aggregation, and
 * signature packing live in @knoww/shared-types/relayer so the web app and
 * extension use the same implementation.
 */

import {
  assertRelayerSubmitAccepted,
  buildSafeCreateSubmitRequest,
  buildSafeSubmitRequest,
  pollRelayerTransaction,
  prepareSafeCreate,
  prepareSafeExecution,
  type RelayerExecuteResult,
  type RelayerSubmitResponse,
  type RelayerTransaction,
  type RelayerTxStatus,
} from "@knoww/shared-types/relayer";
import type { Address, WalletClient } from "viem";

const PROXY_BASE = "/api/relayer";

export { derivePolymarketSafe } from "@knoww/shared-types/relayer";

// ── HTTP helpers (always go through /api/relayer/[...path]) ──

function buildProxyUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${PROXY_BASE}/${path}`, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function proxyGet<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const res = await fetch(buildProxyUrl(path, params), { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`relayer GET /${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function proxyPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(buildProxyUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
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

/**
 * Poll /transaction until the relayer reports a successful state.
 * Throws if the relayer reports a failed state or if we time out.
 * Mirrors pollTransaction() in apps/extension/src/background/relayer-client.ts.
 */
export async function pollUntilConfirmed(
  transactionID: string,
  maxAttempts = 20,
  intervalMs = 2000
): Promise<string> {
  return pollRelayerTransaction({
    transactionID,
    getTransaction,
    maxAttempts,
    intervalMs,
  });
}

/**
 * Execute a batch of calls via the user's Polymarket Safe, through the V2 relayer.
 *
 * Flow:
 *  1. Derive the user's Safe (CREATE2).
 *  2. Wrap each input tx as SafeTransaction (operation=Call), then multiSend-aggregate
 *     if there are >1.
 *  3. Fetch the Safe's current nonce from the relayer.
 *  4. Build the SafeTx EIP-712 hash and ask the wallet to sign it as a raw message.
 *  5. Pack r/s/v into Gnosis's contract-signature format.
 *  6. POST /submit with type="SAFE".
 *  7. Poll /transaction until confirmed.
 */
export async function executeViaRelayer(
  walletClient: WalletClient,
  eoaAddress: Address,
  transactions: RelayerTransaction[]
): Promise<RelayerExecuteResult> {
  if (transactions.length === 0) {
    throw new Error("No transactions to execute");
  }

  const nonce = await getNonce(eoaAddress, "SAFE");
  const prepared = prepareSafeExecution({
    eoaAddress,
    transactions,
    nonce,
  });

  const signature = await walletClient.signMessage({
    account: eoaAddress,
    message: { raw: prepared.hash },
  });

  // Post-Apr-21-2026: /submit returns immediately with { transactionID, state }
  // — no `transactionHash`. We obtain the on-chain hash by polling /transaction
  // with `transactionID` in `pollUntilConfirmed` below.
  const submitRes = await proxyPost<RelayerSubmitResponse>("submit", {
    ...buildSafeSubmitRequest({
      eoaAddress,
      prepared,
      signature,
    }),
  });

  assertRelayerSubmitAccepted(submitRes, "submit");

  const txHash = await pollUntilConfirmed(submitRes.transactionID);
  return {
    transactionID: submitRes.transactionID,
    transactionHash: txHash,
  };
}

/**
 * Deploy the user's Polymarket Safe via the relayer.
 *
 * The SAFE-CREATE request is different from a regular SafeTx:
 *   - No nonce, no multiSend, no SafeTx EIP-712 hash.
 *   - The user signs a CreateProxy EIP-712 message directly against the Safe
 *     factory's domain (name="Polymarket Contract Proxy Factory", chainId,
 *     verifyingContract=SafeFactory).
 *   - `to` is the Safe factory, `data` is empty ("0x") — the relayer builds
 *     the factory call server-side.
 *   - `type` is "SAFE-CREATE" (not "SAFE").
 *   - `signatureParams` mirror the EIP-712 values: { paymentToken, payment,
 *     paymentReceiver }. The SDK always sends all zeros here.
 *
 * Reverse-engineered from `buildSafeCreateTransactionRequest()` in
 * @polymarket/builder-relayer-client/dist/builder/create.js (SDK 0.0.8).
 */
export async function deploySafe(
  walletClient: WalletClient,
  eoaAddress: Address
): Promise<RelayerExecuteResult> {
  const prepared = prepareSafeCreate({ eoaAddress });

  // CreateProxy EIP-712: domain includes a `name`, unlike SafeTx.
  const signature = await walletClient.signTypedData({
    account: eoaAddress,
    ...prepared.typedData,
  });

  // SAFE-CREATE does not take a nonce — the factory deploys at a deterministic
  // CREATE2 address with no pre-existing state. The upstream /nonce endpoint
  // only accepts `type=SAFE | PROXY` (per the public OpenAPI spec); requesting
  // `SAFECREATE` returns 400 "bad request".
  //
  // Post-Apr-21-2026: /submit returns immediately with { transactionID, state };
  // the on-chain hash is only available from /transaction polling.
  const submitRes = await proxyPost<RelayerSubmitResponse>("submit", {
    ...buildSafeCreateSubmitRequest({
      eoaAddress,
      prepared,
      signature,
    }),
  });

  assertRelayerSubmitAccepted(submitRes, "deploy");

  const txHash = await pollUntilConfirmed(submitRes.transactionID);
  return {
    transactionID: submitRes.transactionID,
    transactionHash: txHash,
  };
}
