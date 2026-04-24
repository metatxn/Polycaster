/**
 * Lightweight Polymarket Relayer client for the extension.
 *
 * Replicates the critical parts of @polymarket/builder-relayer-client's
 * Safe transaction flow without importing the heavy SDK (which drags in
 * axios, viem, and node:crypto).
 *
 * Flow:
 *  1. Derive the user's Safe address (CREATE2)
 *  2. GET /nonce to get the Safe's current nonce from the relayer
 *  3. Build an EIP-712 SafeTx struct hash
 *  4. Sign via BridgeSigner (MetaMask prompt — just a signature, no gas)
 *  5. POST /submit with builder auth headers
 *  6. Poll GET /transaction until confirmed
 */

import {
  SAFE_FACTORY_ADDRESS,
  SAFE_INIT_CODE_HASH,
} from "@knoww/shared-types/contracts";
import { ethers } from "ethers";
import { EXTENSION_AUTH_REQUIRED_ERROR } from "../types/chrome-messages";
import type { BridgeSigner } from "./bridge-signer";
import { getAccessTokenViaMessage } from "./extension-auth";
import { getKnowwAppUrl } from "./extension-session";
import { logInfo } from "./logger";

const RELAYER_URL = `${getKnowwAppUrl().replace(/\/$/, "")}/api/relayer`;
const CHAIN_ID = 137;
const SAFE_MULTISEND = "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761";
/**
 * EIP-712 domain `name` used when signing SAFE-CREATE intents (distinct from
 * SafeTx, which doesn't include `name`). Must match Polymarket's factory
 * domain exactly — a mismatch makes the recovered signer wrong and the
 * relayer will reject.
 */
const SAFE_FACTORY_NAME = "Polymarket Contract Proxy Factory";

interface Transaction {
  to: string;
  data: string;
  value: string;
}

interface SafeTransaction {
  to: string;
  operation: number; // 0 = Call, 1 = DelegateCall
  data: string;
  value: string;
}

interface RelayerTxStatus {
  transactionID: string;
  transactionHash: string;
  state: string;
}

const SUCCESS_STATES = ["STATE_EXECUTED", "STATE_MINED", "STATE_CONFIRMED"];
const FAILURE_STATES = ["STATE_FAILED", "STATE_INVALID"];

function deriveSafeAddress(eoaAddress: string): string {
  const encoded = ethers.utils.defaultAbiCoder.encode(
    ["address"],
    [eoaAddress]
  );
  const salt = ethers.utils.keccak256(encoded);
  return ethers.utils.getCreate2Address(
    SAFE_FACTORY_ADDRESS,
    salt,
    SAFE_INIT_CODE_HASH
  );
}

function aggregateSafeTransactions(txns: SafeTransaction[]): SafeTransaction {
  if (txns.length === 1) return txns[0];

  const packed = txns
    .map((tx) => {
      const dataBytes = ethers.utils.arrayify(tx.data);
      return ethers.utils.solidityPack(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [tx.operation, tx.to, tx.value, dataBytes.length, dataBytes]
      );
    })
    .reduce((acc, cur) => ethers.utils.hexConcat([acc, cur]), "0x");

  const iface = new ethers.utils.Interface([
    "function multiSend(bytes transactions)",
  ]);
  const data = iface.encodeFunctionData("multiSend", [packed]);

  return {
    to: SAFE_MULTISEND,
    value: "0",
    data,
    operation: 1, // DelegateCall for multisend
  };
}

function createSafeTxStructHash(
  chainId: number,
  safe: string,
  tx: SafeTransaction,
  nonce: string
): string {
  const domain = { chainId, verifyingContract: safe };
  const types = {
    SafeTx: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const values = {
    to: tx.to,
    value: tx.value,
    data: tx.data,
    operation: tx.operation,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ethers.constants.AddressZero,
    refundReceiver: ethers.constants.AddressZero,
    nonce,
  };

  return ethers.utils._TypedDataEncoder.hash(domain, types, values);
}

function splitAndPackSignature(sig: string): string {
  const raw = sig.startsWith("0x") ? sig.slice(2) : sig;
  const r = ethers.BigNumber.from(`0x${raw.slice(0, 64)}`);
  const s = ethers.BigNumber.from(`0x${raw.slice(64, 128)}`);
  let v = parseInt(raw.slice(128, 130), 16);

  if (v === 0 || v === 1) v += 31;
  else if (v === 27 || v === 28) v += 4;

  return ethers.utils.solidityPack(["uint256", "uint256", "uint8"], [r, s, v]);
}

/**
 * Proxy fetch through the service worker to avoid CORS.
 * The offscreen document has a chrome-extension:// origin which gets
 * blocked by the relayer's CORS policy. The service worker can fetch
 * without CORS restrictions.
 */
function proxyFetch<T>(
  url: string,
  method: "GET" | "POST",
  headers?: Record<string, string>,
  body?: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "fetch-json",
        url,
        method,
        headers: headers ?? {},
        // Keep JSON as the original string — parse+stringify can theoretically
        // alter edge-case payloads; the background handler accepts raw strings.
        body: body ?? undefined,
      },
      (response: {
        ok: boolean;
        data?: T;
        error?: string;
        status?: number;
      }) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(chrome.runtime.lastError.message || "Proxy fetch failed")
          );
          return;
        }
        // The background's `fetch-json` handler sets `ok: true` whenever the
        // response body parses as JSON — even for HTTP 4xx/5xx. Without this
        // status check, a 400 from the upstream relayer would be handed to
        // the caller as a "successful" payload containing the error body,
        // producing opaque downstream failures (e.g. signature-mismatched
        // SAFE-CREATE surfaced as undefined `transactionID` during polling).
        if (!response?.ok) {
          reject(new Error(response?.error || `Relayer request failed`));
          return;
        }
        const status = response.status ?? 0;
        if (status < 200 || status >= 300) {
          const body = response.data
            ? typeof response.data === "string"
              ? response.data
              : JSON.stringify(response.data)
            : "";
          reject(
            new Error(
              `Relayer ${status}${body ? `: ${body.slice(0, 300)}` : ""}`
            )
          );
          return;
        }
        resolve(response.data as T);
      }
    );
  });
}

async function relayerGet<T>(
  path: string,
  params: Record<string, string>,
  headers?: Record<string, string>
): Promise<T> {
  const url = new URL(`${RELAYER_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return proxyFetch<T>(url.toString(), "GET", headers);
}

async function relayerPost<T>(
  path: string,
  body: string,
  headers?: Record<string, string>
): Promise<T> {
  return proxyFetch<T>(
    `${RELAYER_URL}${path}`,
    "POST",
    { "Content-Type": "application/json", ...headers },
    body
  );
}

async function sendAuthedRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: string,
  params?: Record<string, string>
): Promise<T> {
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

export async function executeViaRelayer(
  signer: BridgeSigner,
  transactions: Transaction[]
): Promise<{ transactionID: string; txHash: string }> {
  if (transactions.length === 0) throw new Error("No transactions to execute");

  const eoaAddress = await signer.getAddress();
  const safeAddress = deriveSafeAddress(eoaAddress);

  logInfo("relayer.execute-safe", { safeAddress });

  const deployed = await sendAuthedRequest<{ deployed: boolean }>(
    "GET",
    "/deployed",
    undefined,
    { address: safeAddress }
  );
  if (!deployed.deployed) {
    throw new Error(
      "Your trading wallet (Safe) is not deployed. Complete onboarding on knoww.app first."
    );
  }

  const safeTxns: SafeTransaction[] = transactions.map((t) => ({
    to: t.to,
    operation: 0, // Call
    data: t.data,
    value: t.value || "0",
  }));
  const aggregated = aggregateSafeTransactions(safeTxns);

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      logInfo("relayer.retry", { attempt, reason: lastError?.message });
      await new Promise((r) => setTimeout(r, 1500));
    }

    const noncePayload = await sendAuthedRequest<{ nonce: string }>(
      "GET",
      "/nonce",
      undefined,
      { address: eoaAddress, type: "SAFE" }
    );

    const structHash = createSafeTxStructHash(
      CHAIN_ID,
      safeAddress,
      aggregated,
      noncePayload.nonce
    );

    const signature = await signer.signMessage(
      ethers.utils.arrayify(structHash)
    );
    const packedSig = splitAndPackSignature(signature);

    const requestPayload = JSON.stringify({
      from: eoaAddress,
      to: aggregated.to,
      proxyWallet: safeAddress,
      data: aggregated.data,
      nonce: noncePayload.nonce,
      signature: packedSig,
      signatureParams: {
        gasPrice: "0",
        operation: String(aggregated.operation),
        safeTxnGas: "0",
        baseGas: "0",
        gasToken: ethers.constants.AddressZero,
        refundReceiver: ethers.constants.AddressZero,
      },
      type: "SAFE",
      metadata: "",
    });

    // Post-Apr-21-2026: /submit returns immediately with { transactionID, state }
    // — no `transactionHash`. pollTransaction() below fetches the on-chain hash
    // by polling /transaction with `transactionID`.
    const submitResponse = await sendAuthedRequest<{
      transactionID: string;
      state: string;
    }>("POST", "/submit", requestPayload);

    logInfo("relayer.submitted", {
      transactionID: submitResponse.transactionID,
      state: submitResponse.state,
      attempt,
    });

    try {
      const txHash = await pollTransaction(submitResponse.transactionID);
      return { transactionID: submitResponse.transactionID, txHash };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isNonceRace =
        lastError.message.includes("STATE_FAILED") ||
        lastError.message.includes("GS026") ||
        lastError.message.includes("reverted");

      if (!isNonceRace || attempt >= maxRetries - 1) {
        throw lastError;
      }
      logInfo("relayer.nonce-race-detected", {
        transactionID: submitResponse.transactionID,
        error: lastError.message,
      });
    }
  }

  throw lastError ?? new Error("Relayer execution failed");
}

interface RelayerTxDetail extends RelayerTxStatus {
  errorMsg?: string;
}

async function pollTransaction(transactionID: string): Promise<string> {
  const maxAttempts = 20;
  const intervalMs = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const txns = await relayerGet<RelayerTxDetail[]>("/transaction", {
      id: transactionID,
    });

    if (txns?.length > 0) {
      const tx = txns[0];
      if (FAILURE_STATES.includes(tx.state)) {
        const detail = tx.errorMsg ? `: ${tx.errorMsg}` : "";
        throw new Error(
          `Transaction failed with state: ${tx.state}${detail} (hash: ${tx.transactionHash || "none"})`
        );
      }
      if (SUCCESS_STATES.includes(tx.state)) {
        logInfo("relayer.confirmed", { transactionHash: tx.transactionHash });
        return tx.transactionHash;
      }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return transactionID;
}

/**
 * Deploy the user's Polymarket Safe (trading wallet) via the relayer.
 *
 * Mirrors `deploySafe()` in `apps/web/src/lib/relayer-client.ts`. The SAFE-CREATE
 * request differs from a regular SafeTx:
 *   - No multiSend, no SafeTx EIP-712 hash.
 *   - `nonce` comes from GET /nonce?type=SAFECREATE (required by relayer /submit).
 *   - The user signs a CreateProxy EIP-712 message against the Safe factory's
 *     domain (name="Polymarket Contract Proxy Factory", chainId, verifyingContract
 *     = SAFE_FACTORY_ADDRESS) — note the `name` field, which SafeTx doesn't have.
 *   - `to` is the Safe factory, `data` is "0x" — the relayer builds the factory
 *     call server-side.
 *   - `type` is "SAFE-CREATE" (not "SAFE").
 *   - `signatureParams` mirror the EIP-712 values: { paymentToken, payment,
 *     paymentReceiver }. All three are zero for gasless onboarding.
 *
 * Returns `alreadyDeployed: true` if the Safe already exists on-chain, so
 * callers can short-circuit without double-prompting the user.
 */
export async function deployProxyWallet(signer: BridgeSigner): Promise<{
  transactionID: string;
  txHash: string;
  proxyAddress: string;
  alreadyDeployed?: boolean;
}> {
  // Checksum the EOA — MetaMask returns addresses in lowercase, but the web
  // path uses viem's already-checksummed `Address` type. Some relayer
  // validators do case-sensitive address comparisons against the signature
  // recovery, and we want the extension to send the exact same bytes the web
  // sends.
  const eoaAddress = ethers.utils.getAddress(await signer.getAddress());
  const safeAddress = deriveSafeAddress(eoaAddress);

  logInfo("relayer.deploy-safe.start", { eoaAddress, safeAddress });

  // Short-circuit if the Safe is already on-chain. Without this the relayer
  // would bounce the SAFE-CREATE with an opaque error, and the user would
  // see a failed signing request for a no-op.
  const deployedCheck = await sendAuthedRequest<{ deployed: boolean }>(
    "GET",
    "/deployed",
    undefined,
    { address: safeAddress }
  );
  if (deployedCheck.deployed) {
    logInfo("relayer.deploy-safe.already-deployed", { safeAddress });
    return {
      transactionID: "",
      txHash: "",
      proxyAddress: safeAddress,
      alreadyDeployed: true,
    };
  }

  const paymentToken = ethers.constants.AddressZero;
  const payment = "0";
  const paymentReceiver = ethers.constants.AddressZero;

  const domain = {
    name: SAFE_FACTORY_NAME,
    chainId: CHAIN_ID,
    verifyingContract: SAFE_FACTORY_ADDRESS,
  };
  const types = {
    CreateProxy: [
      { name: "paymentToken", type: "address" },
      { name: "payment", type: "uint256" },
      { name: "paymentReceiver", type: "address" },
    ],
  };
  const message = { paymentToken, payment, paymentReceiver };

  const signature = await signer._signTypedData(domain, types, message);

  // SAFE-CREATE does not take a nonce — the factory deploys at a deterministic
  // CREATE2 address with no pre-existing state. The upstream relayer's /nonce
  // endpoint only accepts `type=SAFE | PROXY` (verified against the public
  // OpenAPI spec); requesting `SAFECREATE` returns 400 "bad request".
  const requestBody = {
    from: eoaAddress,
    to: SAFE_FACTORY_ADDRESS,
    proxyWallet: safeAddress,
    data: "0x",
    signature,
    signatureParams: {
      paymentToken,
      payment,
      paymentReceiver,
    },
    type: "SAFE-CREATE",
  };
  const requestPayload = JSON.stringify(requestBody);

  // Post-Apr-21-2026: /submit returns immediately with { transactionID, state };
  // the on-chain hash comes from the /transaction poll below.
  const submitResponse = await sendAuthedRequest<{
    transactionID: string;
    state: string;
  }>("POST", "/submit", requestPayload);

  if (FAILURE_STATES.includes(submitResponse.state)) {
    throw new Error(
      `Relayer rejected deploy immediately (${submitResponse.state})`
    );
  }

  logInfo("relayer.deploy-safe.submitted", {
    transactionID: submitResponse.transactionID,
    state: submitResponse.state,
  });

  const txHash = await pollTransaction(submitResponse.transactionID);
  return {
    transactionID: submitResponse.transactionID,
    txHash,
    proxyAddress: safeAddress,
  };
}
