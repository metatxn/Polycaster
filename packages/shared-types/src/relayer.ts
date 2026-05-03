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
  zeroAddress,
} from "viem";
import { SAFE_FACTORY_ADDRESS, SAFE_INIT_CODE_HASH } from "./contracts";

declare function setTimeout(callback: () => void, delay?: number): unknown;

export const POLYMARKET_RELAYER_CHAIN_ID = 137;
export const SAFE_MULTISEND_ADDRESS: Address =
  "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761";
export const SAFE_FACTORY_NAME = "Polymarket Contract Proxy Factory";

export const RELAYER_SUCCESS_STATES = new Set([
  "STATE_EXECUTED",
  "STATE_MINED",
  "STATE_CONFIRMED",
]);
export const RELAYER_FAILURE_STATES = new Set([
  "STATE_FAILED",
  "STATE_INVALID",
]);

export interface RelayerTransaction {
  to: Address;
  data: Hex;
  value: string;
}

export interface SafeTransaction {
  to: Address;
  operation: 0 | 1;
  data: Hex;
  value: string;
}

export interface RelayerExecuteResult {
  transactionID: string;
  transactionHash: string;
}

export interface RelayerTxStatus {
  transactionID: string;
  transactionHash: string;
  state: string;
  errorMsg?: string;
}

export interface RelayerSubmitResponse {
  transactionID: string;
  state: string;
}

export interface RelayerSafeSubmitRequest {
  from: Address;
  to: Address;
  proxyWallet: Address;
  data: Hex;
  nonce: string;
  signature: Hex;
  signatureParams: {
    gasPrice: "0";
    operation: string;
    safeTxnGas: "0";
    baseGas: "0";
    gasToken: Address;
    refundReceiver: Address;
  };
  type: "SAFE";
  metadata: "";
}

export interface PreparedRelayerSafeExecution {
  safeAddress: Address;
  aggregated: SafeTransaction;
  nonce: string;
  hash: Hex;
}

export interface RelayerSafeCreateSubmitRequest {
  from: Address;
  to: Address;
  proxyWallet: Address;
  data: "0x";
  signature: Hex;
  signatureParams: {
    paymentToken: Address;
    payment: "0";
    paymentReceiver: Address;
  };
  type: "SAFE-CREATE";
}

export interface PreparedRelayerSafeCreate {
  safeAddress: Address;
  paymentToken: Address;
  payment: "0";
  paymentReceiver: Address;
  typedData: {
    domain: {
      name: typeof SAFE_FACTORY_NAME;
      chainId: number;
      verifyingContract: Address;
    };
    types: {
      CreateProxy: readonly [
        { readonly name: "paymentToken"; readonly type: "address" },
        { readonly name: "payment"; readonly type: "uint256" },
        { readonly name: "paymentReceiver"; readonly type: "address" },
      ];
    };
    primaryType: "CreateProxy";
    message: {
      paymentToken: Address;
      payment: bigint;
      paymentReceiver: Address;
    };
  };
}

export type RelayerTransactionFetcher = (
  transactionID: string
) => Promise<RelayerTxStatus[]>;

export interface RelayerPollOptions {
  transactionID: string;
  getTransaction: RelayerTransactionFetcher;
  maxAttempts?: number;
  intervalMs?: number;
  onConfirmed?: (transactionHash: string) => void;
}

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

export function aggregateSafeTransactions(
  txns: SafeTransaction[]
): SafeTransaction {
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

  return {
    to: SAFE_MULTISEND_ADDRESS,
    value: "0",
    data: encodeFunctionData({
      abi: parseAbi(["function multiSend(bytes transactions)"]),
      functionName: "multiSend",
      args: [packed],
    }),
    operation: 1,
  };
}

export function safeTxHash(args: {
  chainId?: number;
  safe: Address;
  tx: SafeTransaction;
  nonce: string;
}): Hex {
  const { chainId = POLYMARKET_RELAYER_CHAIN_ID, safe, tx, nonce } = args;
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

export function packSafeSignature(signature: Hex): Hex {
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

export function toSafeTransactions(
  transactions: RelayerTransaction[]
): SafeTransaction[] {
  return transactions.map((tx) => ({
    to: tx.to,
    operation: 0,
    data: tx.data,
    value: tx.value || "0",
  }));
}

export function prepareSafeExecution(args: {
  eoaAddress: Address;
  transactions: RelayerTransaction[];
  nonce: string;
  chainId?: number;
}): PreparedRelayerSafeExecution {
  if (args.transactions.length === 0) {
    throw new Error("No transactions to execute");
  }

  const safeAddress = derivePolymarketSafe(args.eoaAddress);
  const aggregated = aggregateSafeTransactions(
    toSafeTransactions(args.transactions)
  );
  const hash = safeTxHash({
    chainId: args.chainId ?? POLYMARKET_RELAYER_CHAIN_ID,
    safe: safeAddress,
    tx: aggregated,
    nonce: args.nonce,
  });

  return {
    safeAddress,
    aggregated,
    nonce: args.nonce,
    hash,
  };
}

export function buildSafeSubmitRequest(args: {
  eoaAddress: Address;
  prepared: PreparedRelayerSafeExecution;
  signature: Hex;
}): RelayerSafeSubmitRequest {
  return {
    from: args.eoaAddress,
    to: args.prepared.aggregated.to,
    proxyWallet: args.prepared.safeAddress,
    data: args.prepared.aggregated.data,
    nonce: args.prepared.nonce,
    signature: packSafeSignature(args.signature),
    signatureParams: {
      gasPrice: "0",
      operation: String(args.prepared.aggregated.operation),
      safeTxnGas: "0",
      baseGas: "0",
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
    },
    type: "SAFE",
    metadata: "",
  };
}

export function prepareSafeCreate(args: {
  eoaAddress: Address;
  chainId?: number;
}): PreparedRelayerSafeCreate {
  const safeAddress = derivePolymarketSafe(args.eoaAddress);
  const paymentToken = zeroAddress;
  const payment = "0";
  const paymentReceiver = zeroAddress;

  return {
    safeAddress,
    paymentToken,
    payment,
    paymentReceiver,
    typedData: {
      domain: {
        name: SAFE_FACTORY_NAME,
        chainId: args.chainId ?? POLYMARKET_RELAYER_CHAIN_ID,
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
    },
  };
}

export function buildSafeCreateSubmitRequest(args: {
  eoaAddress: Address;
  prepared: PreparedRelayerSafeCreate;
  signature: Hex;
}): RelayerSafeCreateSubmitRequest {
  return {
    from: args.eoaAddress,
    to: SAFE_FACTORY_ADDRESS as Address,
    proxyWallet: args.prepared.safeAddress,
    data: "0x",
    signature: args.signature,
    signatureParams: {
      paymentToken: args.prepared.paymentToken,
      payment: args.prepared.payment,
      paymentReceiver: args.prepared.paymentReceiver,
    },
    type: "SAFE-CREATE",
  };
}

export function assertRelayerSubmitAccepted(
  response: RelayerSubmitResponse,
  action: "submit" | "deploy"
): void {
  if (RELAYER_FAILURE_STATES.has(response.state)) {
    throw new Error(
      `Relayer rejected ${action} immediately (${response.state})`
    );
  }
}

export async function pollRelayerTransaction(
  options: RelayerPollOptions
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 20;
  const intervalMs = options.intervalMs ?? 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const txns = await options.getTransaction(options.transactionID);

    if (txns?.length > 0) {
      const tx = txns[0];
      if (RELAYER_FAILURE_STATES.has(tx.state)) {
        const detail = tx.errorMsg ? `: ${tx.errorMsg}` : "";
        throw new Error(
          `Transaction ${options.transactionID} failed (${tx.state})${detail} (hash: ${tx.transactionHash || "none"})`
        );
      }
      if (RELAYER_SUCCESS_STATES.has(tx.state)) {
        options.onConfirmed?.(tx.transactionHash);
        return tx.transactionHash;
      }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), intervalMs);
      });
    }
  }

  throw new Error(
    `Transaction ${options.transactionID} did not confirm in time`
  );
}
