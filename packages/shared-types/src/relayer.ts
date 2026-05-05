import {
  type Address,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  getCreate2Address,
  type Hex,
  hashTypedData,
  keccak256,
  pad,
  parseAbi,
  size,
  toHex,
  zeroAddress,
} from "viem";
import {
  DEPOSIT_WALLET_FACTORY_ADDRESS,
  DEPOSIT_WALLET_IMPLEMENTATION_ADDRESS,
  SAFE_FACTORY_ADDRESS,
  SAFE_INIT_CODE_HASH,
} from "./contracts";

declare function setTimeout(callback: () => void, delay?: number): unknown;

export const POLYMARKET_RELAYER_CHAIN_ID = 137;
export const SAFE_MULTISEND_ADDRESS: Address =
  "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761";
export const SAFE_FACTORY_NAME = "Polymarket Contract Proxy Factory";
export const DEPOSIT_WALLET_DOMAIN_NAME = "DepositWallet";
export const DEPOSIT_WALLET_DOMAIN_VERSION = "1";
const ERC1967_CONST1 =
  "0xcc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3";
const ERC1967_CONST2 =
  "0x5155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076";
const ERC1967_PREFIX = BigInt("0x61003d3d8160233d3973");

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

export type RelayerNonceType = "SAFE" | "PROXY" | "WALLET";

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

export interface DepositWalletCall {
  target: Address;
  value: string;
  data: Hex;
}

export interface RelayerDepositWalletCreateSubmitRequest {
  type: "WALLET-CREATE";
  from: Address;
  to: Address;
}

export interface RelayerDepositWalletSubmitRequest {
  type: "WALLET";
  from: Address;
  to: Address;
  nonce: string;
  signature: Hex;
  depositWalletParams: {
    depositWallet: Address;
    deadline: string;
    calls: DepositWalletCall[];
  };
}

export interface PreparedDepositWalletBatch {
  walletAddress: Address;
  nonce: string;
  deadline: string;
  calls: DepositWalletCall[];
  typedData: {
    domain: {
      name: typeof DEPOSIT_WALLET_DOMAIN_NAME;
      version: typeof DEPOSIT_WALLET_DOMAIN_VERSION;
      chainId: number;
      verifyingContract: Address;
    };
    types: {
      Call: readonly [
        { readonly name: "target"; readonly type: "address" },
        { readonly name: "value"; readonly type: "uint256" },
        { readonly name: "data"; readonly type: "bytes" },
      ];
      Batch: readonly [
        { readonly name: "wallet"; readonly type: "address" },
        { readonly name: "nonce"; readonly type: "uint256" },
        { readonly name: "deadline"; readonly type: "uint256" },
        { readonly name: "calls"; readonly type: "Call[]" },
      ];
    };
    primaryType: "Batch";
    message: {
      wallet: Address;
      nonce: bigint;
      deadline: bigint;
      calls: readonly {
        target: Address;
        value: bigint;
        data: Hex;
      }[];
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

export interface RelayerSigner {
  signMessage(args: { account: Address; message: { raw: Hex } }): Promise<Hex>;
  signTypedData(
    args: { account: Address } & (
      | PreparedRelayerSafeCreate["typedData"]
      | PreparedDepositWalletBatch["typedData"]
    )
  ): Promise<Hex>;
}

export interface RelayerExecutionTransport {
  getNonce(address: Address, type: RelayerNonceType): Promise<string>;
  getDeployed?(address: Address, type?: RelayerNonceType): Promise<boolean>;
  submit(
    request:
      | RelayerSafeSubmitRequest
      | RelayerSafeCreateSubmitRequest
      | RelayerDepositWalletSubmitRequest
      | RelayerDepositWalletCreateSubmitRequest
  ): Promise<RelayerSubmitResponse>;
  getTransaction: RelayerTransactionFetcher;
}

export interface RelayerRetryContext {
  attempt: number;
  maxAttempts: number;
  transactionID?: string;
}

export interface RelayerRetryEvent extends RelayerRetryContext {
  error: Error;
}

export interface RelayerSubmittedEvent {
  attempt: number;
  transactionID: string;
  state: string;
}

export interface RelayerExecutionOptions {
  maxPollAttempts?: number;
  pollIntervalMs?: number;
  onConfirmed?: (transactionHash: string) => void;
  maxSubmitAttempts?: number;
  retryDelayMs?: number;
  shouldRetry?: (error: Error, context: RelayerRetryContext) => boolean;
  onRetry?: (event: RelayerRetryEvent) => void;
  onSubmitted?: (event: RelayerSubmittedEvent) => void;
}

export interface RelayerDepositWalletDeployResult extends RelayerExecuteResult {
  walletAddress: Address;
}

export interface RelayerSafeDeployOptions extends RelayerExecutionOptions {
  checkDeployed?: boolean;
  onAlreadyDeployed?: (safeAddress: Address) => void;
}

export interface RelayerSafeDeployResult extends RelayerExecuteResult {
  safeAddress: Address;
  alreadyDeployed?: boolean;
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

function initCodeHashERC1967(implementation: Address, args: Hex): Hex {
  const n = BigInt((args.length - 2) / 2);
  const combined = ERC1967_PREFIX + (n << BigInt(56));
  return keccak256(
    concat([
      toHex(combined, { size: 10 }),
      implementation,
      "0x6009",
      ERC1967_CONST2,
      ERC1967_CONST1,
      args,
    ])
  );
}

export function derivePolymarketDepositWallet(
  ownerAddress: Address,
  factory: Address = DEPOSIT_WALLET_FACTORY_ADDRESS,
  implementation: Address = DEPOSIT_WALLET_IMPLEMENTATION_ADDRESS
): Address {
  const walletId = pad(ownerAddress, { dir: "left", size: 32 });
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [factory, walletId]
  );
  const salt = keccak256(args);
  const bytecodeHash = initCodeHashERC1967(implementation, args);
  return getCreate2Address({ from: factory, salt, bytecodeHash });
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

export function toDepositWalletCalls(
  transactions: RelayerTransaction[]
): DepositWalletCall[] {
  return transactions.map((tx) => ({
    target: tx.to,
    value: tx.value || "0",
    data: tx.data,
  }));
}

export function prepareDepositWalletBatch(args: {
  ownerAddress: Address;
  walletAddress?: Address;
  transactions: RelayerTransaction[];
  nonce: string;
  deadline: string;
  chainId?: number;
}): PreparedDepositWalletBatch {
  if (args.transactions.length === 0) {
    throw new Error("No transactions to execute");
  }

  const walletAddress =
    args.walletAddress ?? derivePolymarketDepositWallet(args.ownerAddress);
  const calls = toDepositWalletCalls(args.transactions);

  return {
    walletAddress,
    nonce: args.nonce,
    deadline: args.deadline,
    calls,
    typedData: {
      domain: {
        name: DEPOSIT_WALLET_DOMAIN_NAME,
        version: DEPOSIT_WALLET_DOMAIN_VERSION,
        chainId: args.chainId ?? POLYMARKET_RELAYER_CHAIN_ID,
        verifyingContract: walletAddress,
      },
      types: {
        Call: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
        Batch: [
          { name: "wallet", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "calls", type: "Call[]" },
        ],
      },
      primaryType: "Batch",
      message: {
        wallet: walletAddress,
        nonce: BigInt(args.nonce),
        deadline: BigInt(args.deadline),
        calls: calls.map((call) => ({
          target: call.target,
          value: BigInt(call.value),
          data: call.data,
        })),
      },
    },
  };
}

export function buildDepositWalletSubmitRequest(args: {
  ownerAddress: Address;
  prepared: PreparedDepositWalletBatch;
  signature: Hex;
}): RelayerDepositWalletSubmitRequest {
  return {
    type: "WALLET",
    from: args.ownerAddress,
    to: DEPOSIT_WALLET_FACTORY_ADDRESS,
    nonce: args.prepared.nonce,
    signature: args.signature,
    depositWalletParams: {
      depositWallet: args.prepared.walletAddress,
      deadline: args.prepared.deadline,
      calls: args.prepared.calls,
    },
  };
}

export function buildDepositWalletCreateSubmitRequest(
  ownerAddress: Address
): RelayerDepositWalletCreateSubmitRequest {
  return {
    type: "WALLET-CREATE",
    from: ownerAddress,
    to: DEPOSIT_WALLET_FACTORY_ADDRESS,
  };
}

function assertRelayerTransactionsNotEmpty(
  transactions: RelayerTransaction[]
): void {
  if (transactions.length === 0) {
    throw new Error("No transactions to execute");
  }
}

function toRelayerError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getRelayerSubmitAttemptCount(
  options: RelayerExecutionOptions | undefined
): number {
  return Math.max(1, Math.floor(options?.maxSubmitAttempts ?? 1));
}

async function waitForRelayerRetry(options?: RelayerExecutionOptions) {
  const retryDelayMs = options?.retryDelayMs ?? 1500;
  if (retryDelayMs <= 0) return;

  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), retryDelayMs);
  });
}

export function isRetryableSafeNonceRaceError(error: Error): boolean {
  return (
    error.message.includes("STATE_FAILED") ||
    error.message.includes("GS026") ||
    error.message.includes("reverted")
  );
}

async function pollSubmittedRelayerTransaction(
  transactionID: string,
  transport: Pick<RelayerExecutionTransport, "getTransaction">,
  options?: RelayerExecutionOptions
): Promise<string> {
  return pollRelayerTransaction({
    transactionID,
    getTransaction: transport.getTransaction,
    maxAttempts: options?.maxPollAttempts,
    intervalMs: options?.pollIntervalMs,
    onConfirmed: options?.onConfirmed,
  });
}

export async function executeSafeRelayerTransaction(args: {
  signer: RelayerSigner;
  transport: RelayerExecutionTransport;
  eoaAddress: Address;
  transactions: RelayerTransaction[];
  options?: RelayerExecutionOptions;
}): Promise<RelayerExecuteResult> {
  assertRelayerTransactionsNotEmpty(args.transactions);

  const maxAttempts = getRelayerSubmitAttemptCount(args.options);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await waitForRelayerRetry(args.options);
    }

    let transactionID: string | undefined;

    try {
      const nonce = await args.transport.getNonce(args.eoaAddress, "SAFE");
      const prepared = prepareSafeExecution({
        eoaAddress: args.eoaAddress,
        transactions: args.transactions,
        nonce,
      });

      const signature = await args.signer.signMessage({
        account: args.eoaAddress,
        message: { raw: prepared.hash },
      });

      const submitRes = await args.transport.submit(
        buildSafeSubmitRequest({
          eoaAddress: args.eoaAddress,
          prepared,
          signature,
        })
      );
      assertRelayerSubmitAccepted(submitRes, "submit");
      transactionID = submitRes.transactionID;
      args.options?.onSubmitted?.({
        attempt,
        transactionID: submitRes.transactionID,
        state: submitRes.state,
      });

      const transactionHash = await pollSubmittedRelayerTransaction(
        submitRes.transactionID,
        args.transport,
        args.options
      );
      return { transactionID: submitRes.transactionID, transactionHash };
    } catch (error) {
      lastError = toRelayerError(error);
      const context: RelayerRetryContext = {
        attempt,
        maxAttempts,
        transactionID,
      };
      const shouldRetry =
        attempt < maxAttempts - 1 &&
        (args.options?.shouldRetry?.(lastError, context) ?? false);

      if (!shouldRetry) {
        throw lastError;
      }

      args.options?.onRetry?.({ ...context, error: lastError });
    }
  }

  throw lastError ?? new Error("Relayer execution failed");
}

export async function deploySafeRelayerWallet(args: {
  signer: RelayerSigner;
  transport: RelayerExecutionTransport;
  eoaAddress: Address;
  options?: RelayerSafeDeployOptions;
}): Promise<RelayerSafeDeployResult> {
  const prepared = prepareSafeCreate({ eoaAddress: args.eoaAddress });
  if (args.options?.checkDeployed) {
    if (!args.transport.getDeployed) {
      throw new Error("Relayer deployment preflight is not available");
    }
    const deployed = await args.transport.getDeployed(
      prepared.safeAddress,
      "SAFE"
    );
    if (deployed) {
      args.options.onAlreadyDeployed?.(prepared.safeAddress);
      return {
        transactionID: "",
        transactionHash: "",
        safeAddress: prepared.safeAddress,
        alreadyDeployed: true,
      };
    }
  }

  const signature = await args.signer.signTypedData({
    account: args.eoaAddress,
    ...prepared.typedData,
  });

  const submitRes = await args.transport.submit(
    buildSafeCreateSubmitRequest({
      eoaAddress: args.eoaAddress,
      prepared,
      signature,
    })
  );
  assertRelayerSubmitAccepted(submitRes, "deploy");
  args.options?.onSubmitted?.({
    attempt: 0,
    transactionID: submitRes.transactionID,
    state: submitRes.state,
  });

  const transactionHash = await pollSubmittedRelayerTransaction(
    submitRes.transactionID,
    args.transport,
    args.options
  );
  return {
    transactionID: submitRes.transactionID,
    transactionHash,
    safeAddress: prepared.safeAddress,
  };
}

export function buildDepositWalletDeadline(
  ttlSeconds = 1200,
  nowMs = Date.now()
): string {
  return Math.floor(nowMs / 1000 + ttlSeconds).toString();
}

export async function executeDepositWalletRelayerTransaction(args: {
  signer: RelayerSigner;
  transport: RelayerExecutionTransport;
  ownerAddress: Address;
  transactions: RelayerTransaction[];
  walletAddress?: Address;
  deadline?: string;
  deadlineTtlSeconds?: number;
  options?: RelayerExecutionOptions;
}): Promise<RelayerExecuteResult> {
  assertRelayerTransactionsNotEmpty(args.transactions);

  const walletAddress =
    args.walletAddress ?? derivePolymarketDepositWallet(args.ownerAddress);
  const maxAttempts = getRelayerSubmitAttemptCount(args.options);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await waitForRelayerRetry(args.options);
    }

    let transactionID: string | undefined;

    try {
      const nonce = await args.transport.getNonce(args.ownerAddress, "WALLET");
      const prepared = prepareDepositWalletBatch({
        ownerAddress: args.ownerAddress,
        walletAddress,
        transactions: args.transactions,
        nonce,
        deadline:
          args.deadline ?? buildDepositWalletDeadline(args.deadlineTtlSeconds),
      });

      const signature = await args.signer.signTypedData({
        account: args.ownerAddress,
        ...prepared.typedData,
      });

      const submitRes = await args.transport.submit(
        buildDepositWalletSubmitRequest({
          ownerAddress: args.ownerAddress,
          prepared,
          signature,
        })
      );
      assertRelayerSubmitAccepted(submitRes, "submit");
      transactionID = submitRes.transactionID;
      args.options?.onSubmitted?.({
        attempt,
        transactionID: submitRes.transactionID,
        state: submitRes.state,
      });

      const transactionHash = await pollSubmittedRelayerTransaction(
        submitRes.transactionID,
        args.transport,
        args.options
      );
      return { transactionID: submitRes.transactionID, transactionHash };
    } catch (error) {
      lastError = toRelayerError(error);
      const context: RelayerRetryContext = {
        attempt,
        maxAttempts,
        transactionID,
      };
      const shouldRetry =
        attempt < maxAttempts - 1 &&
        (args.options?.shouldRetry?.(lastError, context) ?? false);

      if (!shouldRetry) {
        throw lastError;
      }

      args.options?.onRetry?.({ ...context, error: lastError });
    }
  }

  throw lastError ?? new Error("Relayer execution failed");
}

export async function deployDepositWalletRelayerWallet(args: {
  transport: Pick<RelayerExecutionTransport, "submit" | "getTransaction">;
  ownerAddress: Address;
  options?: RelayerExecutionOptions;
}): Promise<RelayerDepositWalletDeployResult> {
  const walletAddress = derivePolymarketDepositWallet(args.ownerAddress);
  const submitRes = await args.transport.submit(
    buildDepositWalletCreateSubmitRequest(args.ownerAddress)
  );
  assertRelayerSubmitAccepted(submitRes, "deploy");
  args.options?.onSubmitted?.({
    attempt: 0,
    transactionID: submitRes.transactionID,
    state: submitRes.state,
  });

  const transactionHash = await pollSubmittedRelayerTransaction(
    submitRes.transactionID,
    args.transport,
    args.options
  );
  return {
    transactionID: submitRes.transactionID,
    transactionHash,
    walletAddress,
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
