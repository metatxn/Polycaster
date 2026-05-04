/**
 * Lightweight Polymarket V2 relayer client for the extension.
 *
 * HTTP/auth handling stays extension-specific, while Safe derivation,
 * multiSend aggregation, SafeTx hashing, and signature packing are shared with
 * the web app through @knoww/shared-types/relayer.
 */

import { logInfo } from "@knoww/logger";
import {
  assertRelayerSubmitAccepted,
  buildSafeCreateSubmitRequest,
  buildSafeSubmitRequest,
  derivePolymarketSafe,
  pollRelayerTransaction,
  prepareSafeCreate,
  prepareSafeExecution,
  type RelayerSubmitResponse,
  type RelayerTransaction,
} from "@knoww/shared-types/relayer";
import { type Address, getAddress } from "viem";
import { EXTENSION_AUTH_REQUIRED_ERROR } from "../types/chrome-messages";
import type { BridgeWalletClient } from "./bridge-signer";
import { getAccessTokenViaMessage } from "./extension-auth";
import { getKnowwAppUrl } from "./extension-session";

const RELAYER_URL = `${getKnowwAppUrl().replace(/\/$/, "")}/api/relayer`;

/**
 * Proxy fetch through the service worker to avoid CORS.
 * The offscreen document has a chrome-extension:// origin which gets blocked
 * by the relayer's CORS policy. The service worker can fetch without CORS
 * restrictions.
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
        if (!response?.ok) {
          reject(new Error(response?.error || "Relayer request failed"));
          return;
        }
        const status = response.status ?? 0;
        if (status < 200 || status >= 300) {
          const payload = response.data
            ? typeof response.data === "string"
              ? response.data
              : JSON.stringify(response.data)
            : "";
          reject(
            new Error(
              `Relayer ${status}${payload ? `: ${payload.slice(0, 300)}` : ""}`
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
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
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
  walletClient: BridgeWalletClient,
  eoaAddress: Address,
  transactions: RelayerTransaction[]
): Promise<{ transactionID: string; txHash: string }> {
  if (transactions.length === 0) throw new Error("No transactions to execute");

  const owner = getAddress(eoaAddress) as Address;
  const safeAddress = derivePolymarketSafe(owner);

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

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      logInfo("relayer.retry", { attempt, reason: lastError?.message });
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    const noncePayload = await sendAuthedRequest<{ nonce: string }>(
      "GET",
      "/nonce",
      undefined,
      { address: owner, type: "SAFE" }
    );

    const prepared = prepareSafeExecution({
      eoaAddress: owner,
      transactions,
      nonce: noncePayload.nonce,
    });
    const signature = await walletClient.signMessage({
      account: owner,
      message: { raw: prepared.hash },
    });

    const requestPayload = JSON.stringify(
      buildSafeSubmitRequest({
        eoaAddress: owner,
        prepared,
        signature,
      })
    );

    const submitResponse = await sendAuthedRequest<RelayerSubmitResponse>(
      "POST",
      "/submit",
      requestPayload
    );
    assertRelayerSubmitAccepted(submitResponse, "submit");

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

async function pollTransaction(transactionID: string): Promise<string> {
  return pollRelayerTransaction({
    transactionID,
    getTransaction: (id) => relayerGet("/transaction", { id }),
    onConfirmed: (transactionHash) =>
      logInfo("relayer.confirmed", { transactionHash }),
  });
}

export async function deployProxyWallet(
  walletClient: BridgeWalletClient,
  eoaAddress: Address
): Promise<{
  transactionID: string;
  txHash: string;
  proxyAddress: string;
  alreadyDeployed?: boolean;
}> {
  const owner = getAddress(eoaAddress) as Address;
  const safeAddress = derivePolymarketSafe(owner);

  logInfo("relayer.deploy-safe.start", { eoaAddress: owner, safeAddress });

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

  const prepared = prepareSafeCreate({ eoaAddress: owner });

  const signature = await walletClient.signTypedData({
    account: owner,
    ...prepared.typedData,
  });

  const requestPayload = JSON.stringify(
    buildSafeCreateSubmitRequest({
      eoaAddress: owner,
      prepared,
      signature,
    })
  );

  const submitResponse = await sendAuthedRequest<RelayerSubmitResponse>(
    "POST",
    "/submit",
    requestPayload
  );
  assertRelayerSubmitAccepted(submitResponse, "deploy");

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
