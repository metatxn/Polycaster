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
import { POLYMARKET_API } from "@knoww/shared-types/polymarket";
import { ethers } from "ethers";
import type { BridgeSigner } from "./bridge-signer";
import { createExtensionBuilderConfig } from "./builder-config";
import { logInfo } from "./logger";

const RELAYER_URL = POLYMARKET_API.RELAYER.BASE.replace(/\/$/, "");
const CHAIN_ID = 137;
const SAFE_MULTISEND = "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761";

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
        body: body ? JSON.parse(body) : undefined,
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
        if (!response?.ok) {
          reject(new Error(response?.error || `Relayer request failed`));
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

async function getBuilderHeaders(
  method: string,
  path: string,
  body?: string
): Promise<Record<string, string> | undefined> {
  const config = createExtensionBuilderConfig();
  const headers = await config.generateBuilderHeaders(method, path, body);
  if (!headers) return undefined;
  return headers as unknown as Record<string, string>;
}

async function sendAuthedRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: string,
  params?: Record<string, string>
): Promise<T> {
  const builderHeaders = await getBuilderHeaders(method, path, body);
  if (method === "GET") {
    return relayerGet<T>(path, params ?? {}, builderHeaders);
  }
  return relayerPost<T>(path, body ?? "", builderHeaders);
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

  const noncePayload = await sendAuthedRequest<{ nonce: string }>(
    "GET",
    "/nonce",
    undefined,
    { address: eoaAddress, type: "SAFE" }
  );

  const safeTxns: SafeTransaction[] = transactions.map((t) => ({
    to: t.to,
    operation: 0, // Call
    data: t.data,
    value: t.value || "0",
  }));
  const aggregated = aggregateSafeTransactions(safeTxns);

  const structHash = createSafeTxStructHash(
    CHAIN_ID,
    safeAddress,
    aggregated,
    noncePayload.nonce
  );

  const signature = await signer.signMessage(ethers.utils.arrayify(structHash));
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

  const submitResponse = await sendAuthedRequest<{
    transactionID: string;
    state: string;
    transactionHash: string;
  }>("POST", "/submit", requestPayload);

  logInfo("relayer.submitted", {
    transactionID: submitResponse.transactionID,
    state: submitResponse.state,
  });

  const txHash = await pollTransaction(submitResponse.transactionID);
  return { transactionID: submitResponse.transactionID, txHash };
}

async function pollTransaction(transactionID: string): Promise<string> {
  const maxAttempts = 20;
  const intervalMs = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const txns = await relayerGet<RelayerTxStatus[]>("/transaction", {
      id: transactionID,
    });

    if (txns?.length > 0) {
      const tx = txns[0];
      if (FAILURE_STATES.includes(tx.state)) {
        throw new Error(
          `Transaction failed with state: ${tx.state} (hash: ${tx.transactionHash || "none"})`
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
