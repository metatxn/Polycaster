/**
 * Lightweight Polymarket V2 relayer client for the extension.
 *
 * HTTP/auth handling stays extension-specific, while Safe/deposit wallet
 * derivation, batching, hashing, and signature packing are shared with the web
 * app through @knoww/shared-types/relayer.
 */

import { logInfo } from "@knoww/logger";
import {
  deployDepositWalletRelayerWallet,
  deploySafeRelayerWallet,
  derivePolymarketDepositWallet,
  derivePolymarketSafe,
  executeDepositWalletRelayerTransaction,
  executeSafeRelayerTransaction,
  isRetryableSafeNonceRaceError,
  type RelayerExecutionTransport,
  type RelayerSigner,
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

const relayerTransport: RelayerExecutionTransport = {
  async getNonce(address, type) {
    const noncePayload = await sendAuthedRequest<{ nonce: string }>(
      "GET",
      "/nonce",
      undefined,
      { address, type }
    );
    return noncePayload.nonce;
  },
  async getDeployed(address, type) {
    const params: Record<string, string> = { address };
    if (type) params.type = type;
    const deployed = await sendAuthedRequest<{ deployed: boolean }>(
      "GET",
      "/deployed",
      undefined,
      params
    );
    return deployed.deployed;
  },
  submit(request) {
    return sendAuthedRequest<RelayerSubmitResponse>(
      "POST",
      "/submit",
      JSON.stringify(request)
    );
  },
  getTransaction: (id) => relayerGet("/transaction", { id }),
};

function toRelayerSigner(walletClient: BridgeWalletClient): RelayerSigner {
  return walletClient as unknown as RelayerSigner;
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

  const deployed = await relayerTransport.getDeployed?.(safeAddress, "SAFE");
  if (!deployed) {
    throw new Error(
      "Your trading wallet (Safe) is not deployed. Complete onboarding on knoww.app first."
    );
  }

  const result = await executeSafeRelayerTransaction({
    signer: toRelayerSigner(walletClient),
    transport: relayerTransport,
    eoaAddress: owner,
    transactions,
    options: {
      maxSubmitAttempts: 2,
      shouldRetry: isRetryableSafeNonceRaceError,
      onSubmitted: ({ transactionID, state, attempt }) => {
        logInfo("relayer.submitted", {
          transactionID,
          state,
          attempt,
        });
      },
      onRetry: ({ attempt, error, transactionID }) => {
        logInfo("relayer.nonce-race-detected", {
          transactionID,
          error: error.message,
        });
        logInfo("relayer.retry", {
          attempt: attempt + 1,
          reason: error.message,
        });
      },
      onConfirmed: (transactionHash) =>
        logInfo("relayer.confirmed", { transactionHash }),
    },
  });

  return {
    transactionID: result.transactionID,
    txHash: result.transactionHash,
  };
}

export async function executeViaDepositWallet(
  walletClient: BridgeWalletClient,
  ownerAddress: Address,
  transactions: RelayerTransaction[],
  walletAddress: Address = derivePolymarketDepositWallet(ownerAddress)
): Promise<{ transactionID: string; txHash: string }> {
  if (transactions.length === 0) throw new Error("No transactions to execute");

  const owner = getAddress(ownerAddress) as Address;
  const depositWallet = getAddress(walletAddress) as Address;

  logInfo("relayer.execute-deposit-wallet", {
    walletAddress: depositWallet,
  });

  const deployed = await relayerTransport.getDeployed?.(depositWallet);
  if (!deployed) {
    throw new Error(
      "Your deposit wallet is not deployed. Complete trading wallet setup first."
    );
  }

  const result = await executeDepositWalletRelayerTransaction({
    signer: toRelayerSigner(walletClient),
    transport: relayerTransport,
    ownerAddress: owner,
    walletAddress: depositWallet,
    transactions,
    options: {
      maxSubmitAttempts: 2,
      shouldRetry: isRetryableSafeNonceRaceError,
      onSubmitted: ({ transactionID, state, attempt }) => {
        logInfo("relayer.deposit-wallet.submitted", {
          transactionID,
          state,
          attempt,
        });
      },
      onRetry: ({ attempt, error, transactionID }) => {
        logInfo("relayer.deposit-wallet.retry", {
          transactionID,
          attempt: attempt + 1,
          reason: error.message,
        });
      },
      onConfirmed: (transactionHash) =>
        logInfo("relayer.confirmed", { transactionHash }),
    },
  });

  return {
    transactionID: result.transactionID,
    txHash: result.transactionHash,
  };
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

  const result = await deploySafeRelayerWallet({
    signer: toRelayerSigner(walletClient),
    transport: relayerTransport,
    eoaAddress: owner,
    options: {
      checkDeployed: true,
      onAlreadyDeployed: (deployedSafeAddress) => {
        logInfo("relayer.deploy-safe.already-deployed", {
          safeAddress: deployedSafeAddress,
        });
      },
      onSubmitted: ({ transactionID, state }) => {
        logInfo("relayer.deploy-safe.submitted", {
          transactionID,
          state,
        });
      },
      onConfirmed: (transactionHash) =>
        logInfo("relayer.confirmed", { transactionHash }),
    },
  });

  return {
    transactionID: result.transactionID,
    txHash: result.transactionHash,
    proxyAddress: result.safeAddress,
    ...(result.alreadyDeployed ? { alreadyDeployed: true } : {}),
  };
}

export async function deployDepositWallet(ownerAddress: Address): Promise<{
  transactionID: string;
  txHash: string;
  proxyAddress: string;
  alreadyDeployed?: boolean;
}> {
  const owner = getAddress(ownerAddress) as Address;
  const walletAddress = derivePolymarketDepositWallet(owner);

  logInfo("relayer.deploy-deposit-wallet.start", {
    ownerAddress: owner,
    walletAddress,
  });

  const deployed = await relayerTransport.getDeployed?.(walletAddress);
  if (deployed) {
    logInfo("relayer.deploy-deposit-wallet.already-deployed", {
      walletAddress,
    });
    return {
      transactionID: "",
      txHash: "",
      proxyAddress: walletAddress,
      alreadyDeployed: true,
    };
  }

  const result = await deployDepositWalletRelayerWallet({
    transport: relayerTransport,
    ownerAddress: owner,
    options: {
      onSubmitted: ({ transactionID, state }) => {
        logInfo("relayer.deploy-deposit-wallet.submitted", {
          transactionID,
          state,
        });
      },
      onConfirmed: (transactionHash) =>
        logInfo("relayer.confirmed", { transactionHash }),
    },
  });

  return {
    transactionID: result.transactionID,
    txHash: result.transactionHash,
    proxyAddress: result.walletAddress,
  };
}
