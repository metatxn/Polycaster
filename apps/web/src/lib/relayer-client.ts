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
 *
 * The SafeTx EIP-712 hash, Safe derivation, multiSend aggregation, and
 * signature packing were cross-checked against the extension's ethers v5
 * implementation and produce byte-identical outputs for every tested input.
 */

import {
  SAFE_FACTORY_ADDRESS,
  SAFE_INIT_CODE_HASH,
} from "@knoww/shared-types/contracts";
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  type Hex,
  hashTypedData,
  keccak256,
  parseAbi,
  size,
  type WalletClient,
  zeroAddress,
} from "viem";

const PROXY_BASE = "/api/relayer";
const SAFE_MULTISEND: Address = "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761";
const CHAIN_ID = 137;

/**
 * Safe Factory EIP-712 domain name used when signing SAFE-CREATE intents.
 * Matches the SDK's `SAFE_FACTORY_NAME` constant.
 */
const SAFE_FACTORY_NAME = "Polymarket Contract Proxy Factory";

const SUCCESS_STATES = new Set([
  "STATE_EXECUTED",
  "STATE_MINED",
  "STATE_CONFIRMED",
]);
const FAILURE_STATES = new Set(["STATE_FAILED", "STATE_INVALID"]);

export interface RelayerTransaction {
  to: Address;
  data: Hex;
  /** Decimal-string value matching the Polymarket relayer payload. */
  value: string;
}

interface SafeTransaction {
  to: Address;
  /** 0 = Call, 1 = DelegateCall (used for the multiSend wrapper). */
  operation: 0 | 1;
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

// ── Cryptographic primitives (cross-checked against the extension) ──

/**
 * Derive the user's Polymarket Safe address via CREATE2.
 * Matches @polymarket/builder-relayer-client's deriveSafe() and the extension's
 * deriveSafeAddress() in apps/extension/src/background/relayer-client.ts.
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
 *
 * Produces byte-identical output to the extension's aggregateSafeTransactions()
 * in apps/extension/src/background/relayer-client.ts (verified by cross-check
 * script against a multi-tx approve + dummy payload; 650 hex chars match).
 */
function aggregateSafeTransactions(txns: SafeTransaction[]): SafeTransaction {
  if (txns.length === 1) {
    return txns[0];
  }

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
 *
 * Produces byte-identical hash to the extension's createSafeTxStructHash()
 * in apps/extension/src/background/relayer-client.ts (verified byte-for-byte
 * against ethers v5's _TypedDataEncoder.hash for single-tx and multiSend
 * inputs at nonce=0, 5, and 42).
 */
function safeTxHash(args: {
  chainId: number;
  safe: Address;
  tx: SafeTransaction;
  nonce: string;
}): Hex {
  const { chainId, safe, tx, nonce } = args;
  return hashTypedData({
    domain: { chainId, verifyingContract: safe },
    types: {
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
    },
    primaryType: "SafeTx",
    message: {
      to: tx.to,
      value: BigInt(tx.value),
      data: tx.data,
      operation: tx.operation,
      safeTxGas: BigInt(0),
      baseGas: BigInt(0),
      gasPrice: BigInt(0),
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce: BigInt(nonce),
    },
  });
}

/**
 * Pack r/s/v for Safe contract verification. Adjusts v:
 *   0 / 1   → 31 / 32  (pre-EIP-155 recoverable ids)
 *   27 / 28 → 31 / 32  (legacy recoverable ids, offset by +4)
 *
 * Matches splitAndPackSignature() in apps/extension/src/background/relayer-client.ts.
 */
function packSignature(signature: Hex): Hex {
  const raw = signature.startsWith("0x") ? signature.slice(2) : signature;
  const r = BigInt(`0x${raw.slice(0, 64)}`);
  const s = BigInt(`0x${raw.slice(64, 128)}`);
  let v = Number.parseInt(raw.slice(128, 130), 16);
  if (v === 0 || v === 1) {
    v += 31;
  } else if (v === 27 || v === 28) {
    v += 4;
  } else {
    throw new Error(`Invalid signature v byte: ${v}`);
  }
  return encodePacked(["uint256", "uint256", "uint8"], [r, s, v]);
}

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
 * Poll /transaction until the state is in SUCCESS_STATES.
 * Throws if the relayer reports a FAILURE_STATES state or if we time out.
 * Mirrors pollTransaction() in apps/extension/src/background/relayer-client.ts.
 */
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
          `Transaction ${transactionID} failed (${tx.state})${detail} (hash: ${tx.transactionHash || "none"})`
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

  const safeAddress = derivePolymarketSafe(eoaAddress);

  const safeTxns: SafeTransaction[] = transactions.map((t) => ({
    to: t.to,
    operation: 0, // Call
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
      `Relayer rejected submit immediately (${submitRes.state}) (hash: ${submitRes.transactionHash || "none"})`
    );
  }

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
  const safeAddress = derivePolymarketSafe(eoaAddress);

  const paymentToken = zeroAddress;
  const payment = "0";
  const paymentReceiver = zeroAddress;

  // CreateProxy EIP-712: domain includes a `name`, unlike SafeTx.
  const signature = await walletClient.signTypedData({
    account: eoaAddress,
    domain: {
      name: SAFE_FACTORY_NAME,
      chainId: CHAIN_ID,
      verifyingContract: SAFE_FACTORY_ADDRESS as Address,
    },
    types: {
      CreateProxy: [
        { name: "paymentToken", type: "address" },
        { name: "payment", type: "uint256" },
        { name: "paymentReceiver", type: "address" },
      ],
    },
    primaryType: "CreateProxy",
    message: {
      paymentToken,
      payment: BigInt(payment),
      paymentReceiver,
    },
  });

  const submitRes = await proxyPost<{
    transactionID: string;
    state: string;
    transactionHash: string;
  }>("submit", {
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
  });

  if (FAILURE_STATES.has(submitRes.state)) {
    throw new Error(
      `Relayer rejected deploy immediately (${submitRes.state}) (hash: ${submitRes.transactionHash || "none"})`
    );
  }

  const txHash = await pollUntilConfirmed(submitRes.transactionID);
  return {
    transactionID: submitRes.transactionID,
    transactionHash: txHash,
  };
}
