import { createLogger } from "@knoww/logger";
import {
  buildTradingApprovalTransactions,
  getPusdExchangeApprovalSpender,
  readErc1155Approval,
  readPusdExchangeAllowance,
  readTradingApprovalStatus,
  type TradingApprovalStatus,
} from "@knoww/shared-types/approvals";
import { readTradingWalletBalance } from "@knoww/shared-types/balances";
import { CTF_JSON_ABI } from "@knoww/shared-types/ctf";
import {
  type ApiKeyCreds,
  assertClobPostOrderSuccess,
  buildClobAuthViemTypedData,
  buildClobL1Headers,
  CLOB_ORDER_TYPES,
  type ClobBalanceAllowanceClient,
  type ClobOrderType,
  createOrDeriveClobApiKey,
  getPolymarketSignatureType,
  POLYGON_CHAIN_ID,
  POLYMARKET_API,
  syncClobBalanceAllowance,
  TRADING_SIDES,
} from "@knoww/shared-types/polymarket";
import {
  buildClobOrderPreflightPlan,
  buildPusdAutoWrapTransactions,
  DEFAULT_APPROVAL_AMOUNT,
  formatConditionalShares,
  parseApprovalAmountRaw,
  planPusdAutoWrap,
} from "@knoww/shared-types/trading";
import Decimal from "decimal.js";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import type {
  AgentClobCredentialRecord,
  AgentClobCredentialUpsert,
  ExecutionAdapter,
  LiveOrderRecord,
  LiveOrderStatus,
  LiveOrderUpsert,
  PaperFill,
  PaperOrderRequest,
} from "./types.ts";

const log = createLogger("agent.live-execution");

const DEFAULT_CLOB_HOST = POLYMARKET_API.CLOB.BASE;
const DEFAULT_MAX_LIVE_NOTIONAL_USD = "5";
const DEFAULT_LIVE_ORDER_TYPE = CLOB_ORDER_TYPES.FOK;

/**
 * Belt-and-suspenders env config for the live-execution path.
 *
 * The defaults are deliberately conservative:
 *   - kill switch (`AGENT_LIVE_ENABLED`) defaults to false
 *   - dry-run (`AGENT_LIVE_DRY_RUN`) defaults to true even when enabled
 *   - per-trade cap defaults to $5
 *
 * Disabling dry-run additionally requires the explicit confirmation flag
 * `AGENT_LIVE_CONFIRMED=I_UNDERSTAND_THIS_IS_REAL_MONEY` so that a partial
 * deployment can't accidentally route orders to the real CLOB.
 */
export interface LiveExecutionConfig {
  enabled: boolean;
  dryRun: boolean;
  confirmedReal: boolean;
  privateKey: string | null;
  funderAddress: string | null;
  maxLiveNotionalUsd: string;
  clobHost: string;
  chainId: number;
  rpcUrl: string;
  orderType: ClobOrderType;
}

type LivePostOrderResponse = {
  success?: boolean;
  error?: unknown;
  errorMsg?: unknown;
  message?: unknown;
  takingAmount?: unknown;
  makingAmount?: unknown;
  orderID?: string;
  orderId?: string;
  id?: string;
  status?: string;
};

type LiveClobClient = ClobBalanceAllowanceClient & {
  getOpenOrders(): Promise<unknown>;
  getClobMarketInfo(conditionId: string): Promise<unknown>;
  getBalanceAllowance?: (args: {
    asset_type: string;
    token_id?: string;
  }) => Promise<{ balance?: string | number | bigint }>;
  createOrder(
    order: {
      tokenID: string;
      price: number;
      size: number;
      side: string;
      expiration: number;
    },
    options?: { negRisk?: boolean }
  ): Promise<unknown>;
  postOrder(order: unknown, orderType?: ClobOrderType): Promise<unknown>;
};

interface LiveWalletContext {
  signerAddress: Address;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

export interface LiveExecutionRuntime {
  setupWallet(config: LiveExecutionConfig): Promise<LiveWalletContext>;
  deriveApiCreds(input: {
    clobHost: string;
    signerAddress: Address;
    walletClient: WalletClient;
  }): Promise<ApiKeyCreds>;
  createClobClient(input: {
    config: LiveExecutionConfig;
    walletClient: WalletClient;
    creds: ApiKeyCreds;
    funderAddress: Address;
  }): Promise<LiveClobClient>;
  readTradingWalletBalance: typeof readTradingWalletBalance;
  readTradingApprovalStatus: typeof readTradingApprovalStatus;
  readPusdExchangeAllowance: typeof readPusdExchangeAllowance;
  readErc1155Approval: typeof readErc1155Approval;
  readConditionalBalanceRaw(input: {
    publicClient: PublicClient;
    owner: Address;
    tokenId: string;
  }): Promise<bigint>;
  sendTransactions(input: {
    publicClient: PublicClient;
    walletClient: WalletClient;
    account: Address;
    transactions: Array<{ to: Address; data: Hex; value: string }>;
  }): Promise<void>;
  syncBalanceAllowance(
    client: ClobBalanceAllowanceClient,
    options: {
      tokenId?: string;
      includeCollateral?: boolean;
      includeConditional?: boolean;
    }
  ): Promise<void>;
}

function getRpcUrl(): string {
  const alchemyKey = process.env.ALCHEMY_API_KEY?.trim();
  if (alchemyKey) {
    return `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }
  return process.env.POLYGON_RPC_URL?.trim() || "https://polygon-rpc.com";
}

function configuredLiveOrderType(): ClobOrderType {
  const raw = process.env.AGENT_LIVE_ORDER_TYPE?.trim().toUpperCase();
  if (raw === CLOB_ORDER_TYPES.FAK || raw === CLOB_ORDER_TYPES.FOK) {
    return raw;
  }
  return DEFAULT_LIVE_ORDER_TYPE;
}

export function getLiveExecutionConfig(): LiveExecutionConfig {
  const enabled = process.env.AGENT_LIVE_ENABLED === "true";
  // Default to dry-run unless explicitly set to "false".
  const dryRun = process.env.AGENT_LIVE_DRY_RUN !== "false";
  const confirmedReal =
    process.env.AGENT_LIVE_CONFIRMED === "I_UNDERSTAND_THIS_IS_REAL_MONEY";
  const privateKey = process.env.AGENT_WALLET_PRIVATE_KEY?.trim() || null;
  const funderAddress = process.env.AGENT_FUNDER_ADDRESS?.trim() || null;
  const maxLiveNotionalUsd =
    process.env.AGENT_MAX_LIVE_NOTIONAL_USD?.trim() ||
    DEFAULT_MAX_LIVE_NOTIONAL_USD;
  const clobHost =
    process.env.POLYMARKET_HOST?.trim() ||
    process.env.NEXT_PUBLIC_POLYMARKET_HOST?.trim() ||
    DEFAULT_CLOB_HOST;
  return {
    enabled,
    dryRun,
    confirmedReal,
    privateKey,
    funderAddress,
    maxLiveNotionalUsd,
    clobHost,
    chainId: POLYGON_CHAIN_ID,
    rpcUrl: getRpcUrl(),
    orderType: configuredLiveOrderType(),
  };
}

const DEFAULT_TRADING_APPROVAL_RAW = parseApprovalAmountRaw(
  DEFAULT_APPROVAL_AMOUNT
);
const DRY_RUN_API_CREDS: ApiKeyCreds = {
  apiKey: "agent-dry-run-stub",
  apiSecret: "agent-dry-run-stub",
  apiPassphrase: "agent-dry-run-stub",
};

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function parseOrderId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const record = response as LivePostOrderResponse;
  return record.orderID ?? record.orderId ?? record.id ?? null;
}

function decimalFromUnknown(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  try {
    const decimal = new Decimal(String(value));
    return decimal.isFinite() && decimal.gte(0) ? decimal : null;
  } catch {
    return null;
  }
}

function parseClobExecution(input: {
  response: unknown;
  requestedNotional: Decimal;
  requestedShares: Decimal;
  price: Decimal;
}): {
  status: LiveOrderStatus;
  filledNotionalUsd: Decimal;
  filledShares: Decimal;
  averageFillPrice: string | null;
} {
  const record =
    input.response && typeof input.response === "object"
      ? (input.response as LivePostOrderResponse)
      : {};
  const rawStatus = String(record.status ?? "").toLowerCase();
  const filledNotional =
    decimalFromUnknown(record.takingAmount) ?? new Decimal(0);
  const filledShares =
    decimalFromUnknown(record.makingAmount) ?? new Decimal(0);
  const averageFillPrice =
    filledNotional.gt(0) && filledShares.gt(0)
      ? filledNotional.div(filledShares).toDecimalPlaces(6).toString()
      : null;

  if (
    rawStatus === "matched" ||
    rawStatus === "filled" ||
    rawStatus === "complete" ||
    rawStatus === "completed"
  ) {
    return {
      status: "FILLED",
      filledNotionalUsd: filledNotional.gt(0)
        ? filledNotional
        : input.requestedNotional,
      filledShares: filledShares.gt(0) ? filledShares : input.requestedShares,
      averageFillPrice:
        averageFillPrice ?? input.price.toDecimalPlaces(6).toString(),
    };
  }
  if (rawStatus === "canceled" || rawStatus === "cancelled") {
    return {
      status: "CANCELED",
      filledNotionalUsd: filledNotional,
      filledShares,
      averageFillPrice,
    };
  }
  if (filledShares.gt(0) || filledNotional.gt(0)) {
    return {
      status: "PARTIALLY_FILLED",
      filledNotionalUsd: filledNotional,
      filledShares,
      averageFillPrice,
    };
  }
  return {
    status: "OPEN",
    filledNotionalUsd: new Decimal(0),
    filledShares: new Decimal(0),
    averageFillPrice: null,
  };
}

function toFilledFill(input: {
  request: PaperOrderRequest;
  notionalUsd: Decimal;
  shares: Decimal;
  price: string;
  reason: string;
}): PaperFill {
  return {
    id: crypto.randomUUID(),
    runId: input.request.runId,
    watchlistItemId: input.request.watchlistItemId,
    tokenId: input.request.tokenId,
    status: "FILLED",
    side: input.request.action,
    price: input.price,
    notionalUsd: input.notionalUsd.toDecimalPlaces(6).toString(),
    shares: input.shares.toDecimalPlaces(6).toString(),
    cashAfterUsd:
      input.request.action === "SELL"
        ? new Decimal(input.request.portfolio.cashUsd)
            .add(input.notionalUsd)
            .toDecimalPlaces(6)
            .toString()
        : new Decimal(input.request.portfolio.cashUsd)
            .sub(input.notionalUsd)
            .toDecimalPlaces(6)
            .toString(),
    reason: input.reason,
    createdAt: new Date().toISOString(),
  };
}

const defaultRuntime: LiveExecutionRuntime = {
  async setupWallet(config) {
    const [viem, viemAccounts, viemChains] = await Promise.all([
      import("viem"),
      import("viem/accounts"),
      import("viem/chains"),
    ]);
    const account = viemAccounts.privateKeyToAccount(
      config.privateKey as `0x${string}`
    );
    const transport = viem.http(config.rpcUrl, {
      retryCount: 3,
      retryDelay: 1000,
      timeout: 10_000,
    });
    return {
      signerAddress: account.address,
      walletClient: viem.createWalletClient({
        account,
        chain: viemChains.polygon,
        transport,
      }) as WalletClient,
      publicClient: viem.createPublicClient({
        chain: viemChains.polygon,
        transport,
      }) as PublicClient,
    };
  },

  async deriveApiCreds({ clobHost, signerAddress, walletClient }) {
    const auth = buildClobAuthViemTypedData({ address: signerAddress });
    const signature = await walletClient.signTypedData({
      account: signerAddress,
      ...auth.typedData,
    });
    const result = await createOrDeriveClobApiKey(
      clobHost,
      buildClobL1Headers({
        address: signerAddress,
        signature,
        timestamp: auth.timestamp,
        nonce: auth.nonce,
      })
    );
    if (!result.success || !result.data) {
      throw new Error(
        result.deriveError || result.createError || "CLOB API auth failed"
      );
    }
    return result.data;
  },

  async createClobClient({ config, walletClient, creds, funderAddress }) {
    const { ClobClient } = await import("@polymarket/clob-client-v2");
    return new ClobClient({
      host: config.clobHost,
      chain: config.chainId,
      signer: walletClient as never,
      creds: {
        key: creds.apiKey,
        secret: creds.apiSecret,
        passphrase: creds.apiPassphrase,
      },
      signatureType: getPolymarketSignatureType("eoa") as never,
      funderAddress,
    }) as LiveClobClient;
  },

  readTradingWalletBalance,
  readTradingApprovalStatus,
  readPusdExchangeAllowance,
  readErc1155Approval,

  async readConditionalBalanceRaw({ publicClient, owner, tokenId }) {
    const balances = (await publicClient.readContract({
      address: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" as Address,
      abi: CTF_JSON_ABI,
      functionName: "balanceOfBatch",
      args: [[owner], [BigInt(tokenId)]],
    })) as readonly bigint[];
    return balances[0] ?? BigInt(0);
  },

  async sendTransactions({
    publicClient,
    walletClient,
    account,
    transactions,
  }) {
    const { polygon } = await import("viem/chains");
    for (const tx of transactions) {
      const hash = await walletClient.sendTransaction({
        account,
        chain: polygon,
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value || "0"),
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  },

  syncBalanceAllowance: syncClobBalanceAllowance,
};

/**
 * Stable, deterministic idempotency key. The same (run, watchlist item,
 * side) triple must never produce two live submissions — if a retry happens
 * for any reason, the adapter looks up the existing row and returns its
 * cached result rather than re-signing or re-submitting.
 */
export function buildLiveIdempotencyKey(
  request: Pick<PaperOrderRequest, "runId" | "watchlistItemId" | "action">
): string {
  return `${request.runId}:${request.watchlistItemId}:${request.action}`;
}

export interface LiveExecutionAdapterDeps {
  upsertLiveOrder: (record: LiveOrderUpsert) => Promise<LiveOrderRecord>;
  getLiveOrderByIdempotencyKey: (
    key: string
  ) => Promise<LiveOrderRecord | null>;
  listLiveOrders?: () => Promise<LiveOrderRecord[]>;
  getClobCredential?: (
    key: string
  ) => Promise<AgentClobCredentialRecord | null>;
  upsertClobCredential?: (
    record: AgentClobCredentialUpsert
  ) => Promise<AgentClobCredentialRecord>;
  runtime?: Partial<LiveExecutionRuntime>;
}

interface CredentialEncryptionConfig {
  secret: string;
  keyVersion: string;
}

interface EncryptedCredentialPayload {
  v: 1;
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeClobHost(host: string): string {
  return host.trim().replace(/\/+$/, "").toLowerCase();
}

function buildClobCredentialKey(input: {
  clobHost: string;
  signerAddress: string;
  funderAddress: string;
}): string {
  return `${normalizeClobHost(input.clobHost)}:${input.signerAddress.toLowerCase()}:${input.funderAddress.toLowerCase()}`;
}

function getCredentialEncryptionConfig(): CredentialEncryptionConfig | null {
  const secret = process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!secret) return null;
  return {
    secret,
    keyVersion:
      process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY_VERSION?.trim() || "v1",
  };
}

function configuredPositiveInteger(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function configuredPositiveDecimal(name: string): Decimal | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    const value = new Decimal(raw);
    return value.isFinite() && value.gt(0) ? value : null;
  } catch {
    return null;
  }
}

function configuredSet(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isTodayIso(value: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
  );
}

function parsePreviousCredentialKeys(): CredentialEncryptionConfig[] {
  return (process.env.AGENT_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) {
        return { keyVersion: "previous", secret: entry };
      }
      return {
        keyVersion: entry.slice(0, separator).trim(),
        secret: entry.slice(separator + 1).trim(),
      };
    })
    .filter((entry) => entry.secret);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const bytes = base64ToBytes(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function importCredentialEncryptionKey(
  secret: string
): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function assertApiKeyCreds(value: unknown): asserts value is ApiKeyCreds {
  if (!value || typeof value !== "object") {
    throw new Error("cached CLOB credentials are not an object");
  }
  const record = value as Partial<ApiKeyCreds>;
  if (
    typeof record.apiKey !== "string" ||
    typeof record.apiSecret !== "string" ||
    typeof record.apiPassphrase !== "string"
  ) {
    throw new Error("cached CLOB credentials are malformed");
  }
}

async function encryptApiCreds(
  creds: ApiKeyCreds,
  secret: string
): Promise<string> {
  const key = await importCredentialEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(creds))
  );
  const payload: EncryptedCredentialPayload = {
    v: 1,
    alg: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(payload);
}

async function decryptApiCreds(
  encryptedCredentials: string,
  secret: string
): Promise<ApiKeyCreds> {
  const payload = JSON.parse(
    encryptedCredentials
  ) as Partial<EncryptedCredentialPayload>;
  if (
    payload.v !== 1 ||
    payload.alg !== "AES-GCM" ||
    typeof payload.iv !== "string" ||
    typeof payload.ciphertext !== "string"
  ) {
    throw new Error("cached CLOB credential payload is malformed");
  }
  const key = await importCredentialEncryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(payload.iv) },
    key,
    base64ToArrayBuffer(payload.ciphertext)
  );
  const creds = JSON.parse(new TextDecoder().decode(plaintext));
  assertApiKeyCreds(creds);
  return creds;
}

function blockedFill(request: PaperOrderRequest, reason: string): PaperFill {
  return {
    id: crypto.randomUUID(),
    runId: request.runId,
    watchlistItemId: request.watchlistItemId,
    tokenId: request.tokenId,
    status: "BLOCKED",
    side: request.action,
    price: request.price,
    notionalUsd: "0",
    shares: "0",
    cashAfterUsd: request.portfolio.cashUsd,
    reason,
    createdAt: new Date().toISOString(),
  };
}

function existingOrderToFill(
  existing: LiveOrderRecord,
  request: PaperOrderRequest
): PaperFill {
  // Map cached audit row back to a PaperFill so the caller flow is
  // identical to fresh submissions. Dry-runs report BLOCKED (no funds
  // moved); successful POSTs flip to FILLED once the CLOB confirms a fill.
  if (existing.status === "FILLED" || existing.status === "PARTIALLY_FILLED") {
    const notional = new Decimal(
      existing.filledNotionalUsd || existing.requestedSizeUsd
    );
    const shares = new Decimal(existing.filledShares || "0");
    return {
      id: existing.idempotencyKey,
      runId: existing.runId,
      watchlistItemId: existing.watchlistItemId,
      tokenId: existing.tokenId,
      status: "FILLED",
      side: existing.side,
      price: existing.averageFillPrice ?? existing.price,
      notionalUsd: notional.toDecimalPlaces(6).toString(),
      shares: shares.gt(0)
        ? shares.toDecimalPlaces(6).toString()
        : notional.div(existing.price).toDecimalPlaces(6).toString(),
      cashAfterUsd: new Decimal(request.portfolio.cashUsd)
        .sub(notional)
        .toDecimalPlaces(6)
        .toString(),
      reason: `idempotent-replay:${existing.status}`,
      createdAt: existing.createdAt,
    };
  }
  return blockedFill(
    request,
    `idempotent-replay:${existing.status}${existing.error ? `:${existing.error}` : ""}`
  );
}

export class LiveExecutionAdapter implements ExecutionAdapter {
  readonly mode = "live" as const;
  private readonly deps: LiveExecutionAdapterDeps;
  private readonly runtime: LiveExecutionRuntime;

  constructor(deps: LiveExecutionAdapterDeps) {
    this.deps = deps;
    this.runtime = { ...defaultRuntime, ...(deps.runtime ?? {}) };
  }

  async execute(request: PaperOrderRequest): Promise<PaperFill> {
    const config = getLiveExecutionConfig();

    // Step 1 — kill switch. The env flag MUST be set explicitly. Default
    // off so a forgotten config never accidentally goes live.
    if (!config.enabled) {
      return blockedFill(
        request,
        "live execution disabled: AGENT_LIVE_ENABLED is not 'true'"
      );
    }

    // Step 2 — real-submission requires belt-and-suspenders confirmation.
    if (!config.dryRun && !config.confirmedReal) {
      return blockedFill(
        request,
        "live execution requires AGENT_LIVE_CONFIRMED=I_UNDERSTAND_THIS_IS_REAL_MONEY when AGENT_LIVE_DRY_RUN=false"
      );
    }

    // Step 3 — wallet must be configured.
    if (!config.privateKey) {
      return blockedFill(request, "AGENT_WALLET_PRIVATE_KEY is not configured");
    }

    // Step 4 — idempotency. If a row already exists for this triple, never
    // re-sign or re-submit; replay the cached outcome instead.
    const idempotencyKey = buildLiveIdempotencyKey(request);
    const existing =
      await this.deps.getLiveOrderByIdempotencyKey(idempotencyKey);
    if (existing) {
      log.info("live.replay.existing_order", {
        idempotencyKey,
        status: existing.status,
        dryRun: existing.dryRun,
      });
      return existingOrderToFill(existing, request);
    }

    // Step 5 — reject HOLD (paper adapter does the same; keep symmetry).
    if (request.action === "HOLD") {
      return blockedFill(request, "live execution skipped: action is HOLD");
    }

    // Step 6 — cap the size against the per-trade live cap. This is on
    // top of the regular risk gate; the live cap is a stricter floor so
    // even a misconfigured paper portfolio can't oversize a real order.
    const requested = new Decimal(request.requestedSizeUsd);
    const liveCap = new Decimal(config.maxLiveNotionalUsd);
    if (requested.lte(0) || liveCap.lte(0)) {
      return blockedFill(
        request,
        `live execution skipped: zero size (requested=${requested}, cap=${liveCap})`
      );
    }
    const cappedSize = Decimal.min(requested, liveCap);

    let signerAddress: string;
    const price = new Decimal(request.price);
    const shares =
      request.reduceOnly && request.action === TRADING_SIDES.SELL
        ? new Decimal(request.requestedShares ?? "0")
        : cappedSize.div(price);
    const notional = shares.mul(price);
    try {
      if (!price.isFinite() || price.lte(0)) {
        return blockedFill(request, "live execution skipped: invalid price");
      }
      if (!shares.isFinite() || shares.lte(0)) {
        return blockedFill(request, "live execution skipped: invalid size");
      }
      const safetyBlock = await this.checkLiveSafetyGates({
        config,
        request,
        notional,
      });
      if (safetyBlock) return blockedFill(request, safetyBlock);

      const wallet = await this.runtime.setupWallet(config);
      signerAddress = wallet.signerAddress;
      const funderAddress = (config.funderAddress ?? signerAddress) as Address;
      if (!config.dryRun && !sameAddress(funderAddress, signerAddress)) {
        return blockedFill(
          request,
          "live execution blocked: external funder/proxy wallets are not supported by the agent live adapter yet"
        );
      }

      const creds = await this.getApiCreds({
        config,
        signerAddress: wallet.signerAddress,
        walletClient: wallet.walletClient,
        funderAddress,
      });
      const client = await this.runtime.createClobClient({
        config,
        walletClient: wallet.walletClient,
        creds,
        funderAddress,
      });

      if (!config.dryRun) {
        const preflight = await buildClobOrderPreflightPlan({
          side: request.action,
          orderType: config.orderType,
          size: shares.toNumber(),
          price: price.toNumber(),
          amount:
            request.action === TRADING_SIDES.BUY
              ? notional.toNumber()
              : undefined,
          conditionId: request.conditionId,
          marketInfoClient: client,
          getOpenOrders: () => client.getOpenOrders(),
        });

        if (request.action === TRADING_SIDES.BUY) {
          if (!preflight.buy) {
            return blockedFill(request, "live BUY preflight failed");
          }
          const [balance, approvalStatus] = await Promise.all([
            this.runtime.readTradingWalletBalance(
              wallet.publicClient,
              funderAddress
            ),
            this.runtime.readTradingApprovalStatus(
              wallet.publicClient,
              funderAddress,
              { approvalAmountRaw: preflight.buy.requiredCollateralRaw }
            ),
          ]);
          const allowance = await this.runtime.readPusdExchangeAllowance(
            wallet.publicClient,
            funderAddress,
            request.negRisk
          );
          await this.ensureTradingApprovals({
            wallet,
            funderAddress,
            approvalStatus,
            requiredRaw:
              preflight.buy.requiredCollateralRaw > allowance
                ? preflight.buy.requiredCollateralRaw
                : BigInt(0),
          });
          const wrapPlan = planPusdAutoWrap({
            pusdBalanceRaw: BigInt(balance.pusdBalanceRaw),
            usdcEBalanceRaw: BigInt(balance.usdcEBalanceRaw),
            requiredPusdRaw: preflight.buy.requiredPusdRaw,
            reservedPusdRaw: preflight.buy.reservedPusdRaw,
            estimatedFeeRaw: preflight.buy.estimatedFeeRaw,
          });
          if (!wrapPlan.hasEnoughBaseCollateral) {
            return blockedFill(
              request,
              "live BUY blocked: insufficient pUSD/USDC.e collateral"
            );
          }
          if (wrapPlan.needsWrap) {
            await this.runtime.sendTransactions({
              publicClient: wallet.publicClient,
              walletClient: wallet.walletClient,
              account: wallet.signerAddress,
              transactions: buildPusdAutoWrapTransactions(
                funderAddress,
                wrapPlan.wrapAmountRaw
              ),
            });
          }
        } else if (request.action === TRADING_SIDES.SELL) {
          if (!preflight.sell) {
            return blockedFill(request, "live SELL preflight failed");
          }
          const conditionalBalanceRaw =
            await this.runtime.readConditionalBalanceRaw({
              publicClient: wallet.publicClient,
              owner: funderAddress,
              tokenId: request.tokenId,
            });
          if (conditionalBalanceRaw < preflight.sell.requiredConditionalRaw) {
            return blockedFill(
              request,
              `live SELL blocked: wallet holds ${formatConditionalShares(
                conditionalBalanceRaw
              )} shares, needs ${formatConditionalShares(
                preflight.sell.requiredConditionalRaw
              )}`
            );
          }
          const exchange = getPusdExchangeApprovalSpender(request.negRisk);
          const approved = await this.runtime.readErc1155Approval(
            wallet.publicClient,
            funderAddress,
            exchange
          );
          if (!approved) {
            await this.ensureTradingApprovals({
              wallet,
              funderAddress,
              approvalStatus: await this.runtime.readTradingApprovalStatus(
                wallet.publicClient,
                funderAddress
              ),
              requiredRaw: BigInt(0),
            });
          }
        }

        await this.runtime.syncBalanceAllowance(client, {
          tokenId: request.tokenId,
          includeCollateral: request.action === TRADING_SIDES.BUY,
          includeConditional: true,
        });
      }

      const signedOrder = await client.createOrder(
        {
          tokenID: request.tokenId,
          price: price.toNumber(),
          size: shares.toNumber(),
          side: request.action,
          expiration: 0,
        },
        request.negRisk ? { negRisk: true } : undefined
      );

      const signedOrderJson = JSON.stringify(signedOrder);
      const signedOrderHash = await sha256Hex(signedOrderJson);
      await this.deps.upsertLiveOrder({
        idempotencyKey,
        runId: request.runId,
        watchlistItemId: request.watchlistItemId,
        tokenId: request.tokenId,
        side: request.action,
        requestedSizeUsd: notional.toDecimalPlaces(6).toString(),
        price: request.price,
        signedOrderHash,
        orderId: null,
        status: config.dryRun ? "DRY_RUN" : "POSTED",
        submittedAt: config.dryRun ? null : new Date().toISOString(),
        filledAt: null,
        filledNotionalUsd: "0",
        filledShares: "0",
        averageFillPrice: null,
        lastSyncedAt: null,
        balanceSnapshotJson: null,
        dryRun: config.dryRun,
        error: null,
      });

      if (config.dryRun) {
        log.info("live.dry_run.signed", {
          idempotencyKey,
          signerAddress,
          cappedSize: cappedSize.toString(),
          price: request.price,
        });
        return blockedFill(
          request,
          "live-dry-run: order signed, audit row persisted, NOT submitted"
        );
      }

      const response = await client.postOrder(signedOrder, config.orderType);
      assertClobPostOrderSuccess(response);
      const orderId = parseOrderId(response);
      const execution = parseClobExecution({
        response,
        requestedNotional: notional,
        requestedShares: shares,
        price,
      });
      const syncedAt = new Date().toISOString();
      const balanceSnapshotJson = await this.captureBalanceSnapshot({
        wallet,
        funderAddress,
        tokenId: request.tokenId,
      });
      await this.deps.upsertLiveOrder({
        idempotencyKey,
        runId: request.runId,
        watchlistItemId: request.watchlistItemId,
        tokenId: request.tokenId,
        side: request.action,
        requestedSizeUsd: notional.toDecimalPlaces(6).toString(),
        price: request.price,
        signedOrderHash,
        orderId,
        status: execution.status,
        submittedAt: syncedAt,
        filledAt:
          execution.status === "FILLED" ||
          execution.status === "PARTIALLY_FILLED"
            ? syncedAt
            : null,
        filledNotionalUsd: execution.filledNotionalUsd
          .toDecimalPlaces(6)
          .toString(),
        filledShares: execution.filledShares.toDecimalPlaces(6).toString(),
        averageFillPrice: execution.averageFillPrice,
        lastSyncedAt: syncedAt,
        balanceSnapshotJson,
        dryRun: false,
        error: null,
      });
      if (
        execution.status === "OPEN" ||
        execution.status === "CANCELED" ||
        execution.filledShares.lte(0)
      ) {
        return blockedFill(
          request,
          `live-${config.orderType.toLowerCase()}:order-${execution.status.toLowerCase()}${
            orderId ? `:${orderId}` : ""
          }`
        );
      }
      return toFilledFill({
        request,
        notionalUsd: execution.filledNotionalUsd,
        shares: execution.filledShares,
        price: execution.averageFillPrice ?? request.price,
        reason: `live-${config.orderType.toLowerCase()}:submitted${
          orderId ? `:${orderId}` : ""
        }`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "live execution failed";
      log.error("live.submit.failed", { idempotencyKey, error });
      await this.deps.upsertLiveOrder({
        idempotencyKey,
        runId: request.runId,
        watchlistItemId: request.watchlistItemId,
        tokenId: request.tokenId,
        side: request.action,
        requestedSizeUsd: notional.toDecimalPlaces(6).toString(),
        price: request.price,
        signedOrderHash: null,
        orderId: null,
        status: "FAILED",
        submittedAt: null,
        filledAt: null,
        filledNotionalUsd: "0",
        filledShares: "0",
        averageFillPrice: null,
        lastSyncedAt: null,
        balanceSnapshotJson: null,
        dryRun: config.dryRun,
        error: message,
      });
      return blockedFill(request, `live execution failed: ${message}`);
    }
  }

  private async getApiCreds(input: {
    config: LiveExecutionConfig;
    signerAddress: Address;
    walletClient: WalletClient;
    funderAddress: Address;
  }): Promise<ApiKeyCreds> {
    if (input.config.dryRun) return DRY_RUN_API_CREDS;

    const encryption = getCredentialEncryptionConfig();
    if (
      !encryption ||
      !this.deps.getClobCredential ||
      !this.deps.upsertClobCredential
    ) {
      return this.runtime.deriveApiCreds({
        clobHost: input.config.clobHost,
        signerAddress: input.signerAddress,
        walletClient: input.walletClient,
      });
    }

    const credentialKey = buildClobCredentialKey({
      clobHost: input.config.clobHost,
      signerAddress: input.signerAddress,
      funderAddress: input.funderAddress,
    });
    const clobHost = normalizeClobHost(input.config.clobHost);
    const signerAddress = input.signerAddress.toLowerCase();
    const funderAddress = input.funderAddress.toLowerCase();

    try {
      const cached = await this.deps.getClobCredential(credentialKey);
      if (cached?.encryptionKeyVersion === encryption.keyVersion) {
        return await decryptApiCreds(
          cached.encryptedCredentials,
          encryption.secret
        );
      }
      if (cached) {
        for (const previous of parsePreviousCredentialKeys()) {
          if (
            previous.keyVersion !== "previous" &&
            cached.encryptionKeyVersion !== previous.keyVersion
          ) {
            continue;
          }
          try {
            const creds = await decryptApiCreds(
              cached.encryptedCredentials,
              previous.secret
            );
            await this.deps.upsertClobCredential({
              credentialKey,
              clobHost,
              signerAddress,
              funderAddress,
              encryptedCredentials: await encryptApiCreds(
                creds,
                encryption.secret
              ),
              encryptionKeyVersion: encryption.keyVersion,
            });
            return creds;
          } catch {}
        }
      }
    } catch (error) {
      log.warn("live.clob_creds.cache_read_failed", {
        credentialKey,
        error,
      });
    }

    const creds = await this.runtime.deriveApiCreds({
      clobHost: input.config.clobHost,
      signerAddress: input.signerAddress,
      walletClient: input.walletClient,
    });

    try {
      await this.deps.upsertClobCredential({
        credentialKey,
        clobHost,
        signerAddress,
        funderAddress,
        encryptedCredentials: await encryptApiCreds(creds, encryption.secret),
        encryptionKeyVersion: encryption.keyVersion,
      });
    } catch (error) {
      log.warn("live.clob_creds.cache_write_failed", {
        credentialKey,
        error,
      });
    }

    return creds;
  }

  private async checkLiveSafetyGates(input: {
    config: LiveExecutionConfig;
    request: PaperOrderRequest;
    notional: Decimal;
  }): Promise<string | null> {
    if (process.env.AGENT_LIVE_EMERGENCY_STOP === "true") {
      return "live execution blocked: AGENT_LIVE_EMERGENCY_STOP is active";
    }

    const tokenAllowlist = configuredSet("AGENT_LIVE_ALLOWLIST_TOKEN_IDS");
    if (
      tokenAllowlist.size > 0 &&
      !tokenAllowlist.has(input.request.tokenId.toLowerCase())
    ) {
      return "live execution blocked: token is not in AGENT_LIVE_ALLOWLIST_TOKEN_IDS";
    }

    const conditionAllowlist = configuredSet(
      "AGENT_LIVE_ALLOWLIST_CONDITION_IDS"
    );
    if (
      conditionAllowlist.size > 0 &&
      !conditionAllowlist.has((input.request.conditionId ?? "").toLowerCase())
    ) {
      return "live execution blocked: condition is not in AGENT_LIVE_ALLOWLIST_CONDITION_IDS";
    }

    if (input.config.dryRun || !this.deps.listLiveOrders) return null;

    const [dailyOrderCap, dailyNotionalCap] = [
      configuredPositiveInteger("AGENT_LIVE_DAILY_MAX_ORDER_COUNT"),
      configuredPositiveDecimal("AGENT_LIVE_DAILY_MAX_NOTIONAL_USD"),
    ];
    if (!dailyOrderCap && !dailyNotionalCap) return null;

    const orders = (await this.deps.listLiveOrders()).filter(
      (order) =>
        !order.dryRun &&
        isTodayIso(order.submittedAt ?? order.createdAt) &&
        order.status !== "FAILED" &&
        order.status !== "CANCELED"
    );
    if (dailyOrderCap && orders.length >= dailyOrderCap) {
      return `live execution blocked: daily order cap reached (${orders.length}/${dailyOrderCap})`;
    }
    if (dailyNotionalCap) {
      const used = orders.reduce(
        (sum, order) => sum.plus(order.requestedSizeUsd || "0"),
        new Decimal(0)
      );
      if (used.plus(input.notional).gt(dailyNotionalCap)) {
        return `live execution blocked: daily notional cap would be exceeded (${used
          .plus(input.notional)
          .toDecimalPlaces(6)
          .toString()}/${dailyNotionalCap.toString()})`;
      }
    }
    return null;
  }

  private async captureBalanceSnapshot(input: {
    wallet: LiveWalletContext;
    funderAddress: Address;
    tokenId: string;
  }): Promise<string | null> {
    try {
      const [walletBalance, conditionalBalanceRaw] = await Promise.all([
        this.runtime.readTradingWalletBalance(
          input.wallet.publicClient,
          input.funderAddress
        ),
        this.runtime.readConditionalBalanceRaw({
          publicClient: input.wallet.publicClient,
          owner: input.funderAddress,
          tokenId: input.tokenId,
        }),
      ]);
      return JSON.stringify({
        capturedAt: new Date().toISOString(),
        wallet: {
          pusdBalanceRaw: walletBalance.pusdBalanceRaw,
          usdcEBalanceRaw: walletBalance.usdcEBalanceRaw,
          polBalanceRaw: walletBalance.polBalanceRaw,
        },
        conditionalBalanceRaw: conditionalBalanceRaw.toString(),
      });
    } catch (error) {
      log.warn("live.balance_snapshot.failed", { error });
      return null;
    }
  }

  private async ensureTradingApprovals(input: {
    wallet: LiveWalletContext;
    funderAddress: Address;
    approvalStatus: TradingApprovalStatus;
    requiredRaw: bigint;
  }): Promise<void> {
    const needsBaseline = !input.approvalStatus.allApproved;
    const needsRequired = input.requiredRaw > BigInt(0);
    if (!needsBaseline && !needsRequired) return;
    const approvalRaw =
      input.requiredRaw > DEFAULT_TRADING_APPROVAL_RAW
        ? input.requiredRaw
        : DEFAULT_TRADING_APPROVAL_RAW;
    const transactions = buildTradingApprovalTransactions(
      input.approvalStatus,
      approvalRaw
    );
    if (transactions.length === 0) return;
    await this.runtime.sendTransactions({
      publicClient: input.wallet.publicClient,
      walletClient: input.wallet.walletClient,
      account: input.wallet.signerAddress,
      transactions,
    });
  }

  async submitLiveOrder(_request: unknown): Promise<never> {
    throw new Error(
      "Use execute() via runPaperAgent with executionMode='live'."
    );
  }
}
