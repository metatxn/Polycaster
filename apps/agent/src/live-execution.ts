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
import { fetchClobBuilderFeeRates } from "@knoww/shared-types/clob";
import { PUSD_DECIMALS } from "@knoww/shared-types/contracts";
import { CTF_JSON_ABI } from "@knoww/shared-types/ctf";
import {
  type ApiKeyCreds,
  assertClobPostOrderSuccess,
  CLOB_ORDER_TYPES,
  type ClobBalanceAllowanceClient,
  type ClobOrderType,
  POLYGON_CHAIN_ID,
  POLYMARKET_API,
  syncClobBalanceAllowance,
  TRADING_SIDES,
} from "@knoww/shared-types/polymarket";
import {
  adaptUnifiedSecureClientForLegacyClob,
  createUnifiedPolymarketSecureClient,
  createUnifiedPolymarketViemSigner,
  type LegacyClobCompatibleClient,
  type UnifiedSdkTradingClient,
} from "@knoww/shared-types/polymarket-unified";
import {
  buildClobOrderPreflightPlan,
  buildPusdAutoWrapTransactions,
  DEFAULT_APPROVAL_AMOUNT,
  formatConditionalShares,
  MIN_MARKETABLE_BUY_TICKET_USD,
  parseApprovalAmountRaw,
  planPusdAutoWrap,
} from "@knoww/shared-types/trading";
import Decimal from "decimal.js";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import {
  blockedFill,
  estimatedBuyFeeUsd,
  existingOrderToFill,
  isSettlementPendingLiveOrder,
  isUnresolvedLiveOrder,
  toFilledFill,
} from "./live-accounting.ts";
import type {
  AgentAction,
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
  /**
   * Builder attribution code (`POLY_BUILDER_CODE`). Must match the code the
   * extension and web app use so all three surfaces attribute volume to the
   * same builder. Null when unset — orders then post unattributed.
   */
  builderCode: string | null;
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

/**
 * The live client is exactly what `adaptUnifiedSecureClientForLegacyClob`
 * returns. This used to be a hand-copied structural duplicate, which drifted:
 * it declared a `getBalanceAllowance?` the shim never attached and typed
 * `getOpenOrders` as `Promise<unknown>`. Importing the shim's own type keeps the
 * agent honest whenever the shim's surface changes.
 */
type LiveClobClient = LegacyClobCompatibleClient;

interface LiveWalletContext {
  signerAddress: Address;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

type UnifiedLiveClobClientDeps = {
  createSecureClient: typeof createUnifiedPolymarketSecureClient;
  createViemSigner: typeof createUnifiedPolymarketViemSigner;
  adaptClient: typeof adaptUnifiedSecureClientForLegacyClob;
};

const defaultUnifiedLiveClobClientDeps: UnifiedLiveClobClientDeps = {
  createSecureClient: createUnifiedPolymarketSecureClient,
  createViemSigner: createUnifiedPolymarketViemSigner,
  adaptClient: adaptUnifiedSecureClientForLegacyClob,
};

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
  /** Injectable delay so tests can run the settlement poll without real time. */
  sleep(ms: number): Promise<void>;
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
  const builderCode = process.env.POLY_BUILDER_CODE?.trim() || null;
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
    builderCode,
  };
}

export async function deriveUnifiedLiveApiCreds(
  walletClient: WalletClient,
  deps: Pick<
    UnifiedLiveClobClientDeps,
    "createSecureClient" | "createViemSigner"
  > = defaultUnifiedLiveClobClientDeps
): Promise<ApiKeyCreds> {
  const { appCredentials } = await deps.createSecureClient({
    signer: deps.createViemSigner(walletClient),
  });
  return appCredentials;
}

export async function createUnifiedLiveClobClient(
  input: {
    config: LiveExecutionConfig;
    walletClient: WalletClient;
    creds: ApiKeyCreds;
    funderAddress: Address;
  },
  deps: UnifiedLiveClobClientDeps = defaultUnifiedLiveClobClientDeps
): Promise<LiveClobClient> {
  if (
    normalizeClobHost(input.config.clobHost) !==
    normalizeClobHost(DEFAULT_CLOB_HOST)
  ) {
    throw new Error(
      "Unified Polymarket SDK live execution requires the production CLOB host"
    );
  }
  const { client } = await deps.createSecureClient({
    signer: deps.createViemSigner(input.walletClient),
    wallet: input.funderAddress,
    credentials: input.creds,
  });
  return deps.adaptClient(client as unknown as UnifiedSdkTradingClient, {
    builderCode: input.config.builderCode ?? undefined,
  }) as LiveClobClient;
}

// Memoize the public CLOB builder-fee endpoint per builder code. The rates
// are effectively static (set by Polymarket per builder), so caching for the
// lifetime of the worker isolate is safe and avoids one extra round-trip per
// preflight. Mirrors the extension's cache in background/trading-handler.ts.
const builderFeeRatesCache = new Map<
  string,
  Promise<{ maker: number; taker: number }>
>();

function getBuilderFeeRates(
  builderCode: string
): Promise<{ maker: number; taker: number }> {
  const cached = builderFeeRatesCache.get(builderCode);
  if (cached) return cached;
  const pending = fetchClobBuilderFeeRates(builderCode).catch((err) => {
    // Don't poison the cache on a transient failure — let the next call retry.
    builderFeeRatesCache.delete(builderCode);
    throw err;
  });
  builderFeeRatesCache.set(builderCode, pending);
  return pending;
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

  async deriveApiCreds({ walletClient }) {
    return deriveUnifiedLiveApiCreds(walletClient);
  },

  async createClobClient(input) {
    return createUnifiedLiveClobClient(input);
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

  async sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
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
  hasUnresolvedLiveOrder?: () => Promise<boolean>;
  /**
   * Overlay the ACTUAL settled fee onto the run-item fill persisted for this
   * order once late reconciliation derives it — the fill was stored with the
   * preflight estimate baked into `cashAfterUsd`, and without this hook the
   * historical accounting would keep the estimate forever. Must be
   * idempotent: the reconcile pass retries after partial failures.
   */
  applySettledFeeToRunFill?: (input: {
    runId: string;
    watchlistItemId: string;
    side: AgentAction;
    feeEstimateUsd: string;
    settledFeeUsd: string;
  }) => Promise<void>;
  assertExecutionLock?: () => Promise<void>;
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

/**
 * One point-in-time balance reading of the trading wallet. Two of these
 * bracket every live submission — `preSubmission` (post-wrap, pre-`postOrder`)
 * and `postSubmission` (immediately after `postOrder` returns). V2 settlement
 * is asynchronous, so neither anchor by itself observes the debit; together
 * they pin the window the settlement lands in, keeping the actual fee
 * derivable off-chain even though no API surface reports it. When the
 * settlement poll does observe the debit, a third `settlement` anchor records
 * the balance the actual fee was derived from.
 */
interface LiveBalanceAnchor {
  capturedAt: string;
  /**
   * Funder wallet the balances were read from. Later-run reconciliation
   * refuses to derive a fee unless the configured wallet still matches — a
   * delta read from a different (e.g. rotated) wallet says nothing about
   * this order's settlement.
   */
  funderAddress: string;
  wallet: {
    pusdBalanceRaw: string;
    usdcEBalanceRaw: string;
    polBalanceRaw: string;
  };
  conditionalBalanceRaw: string;
}

function buildBalanceSnapshotJson(
  preSubmission: LiveBalanceAnchor | null,
  postSubmission: LiveBalanceAnchor | null,
  settlement: LiveBalanceAnchor | null = null
): string | null {
  if (!preSubmission && !postSubmission && !settlement) return null;
  return JSON.stringify(
    settlement
      ? { preSubmission, postSubmission, settlement }
      : { preSubmission, postSubmission }
  );
}

function parseBalanceSnapshot(json: string | null): {
  preSubmission?: LiveBalanceAnchor | null;
  postSubmission?: LiveBalanceAnchor | null;
  settlement?: LiveBalanceAnchor | null;
} | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as {
      preSubmission?: LiveBalanceAnchor | null;
      postSubmission?: LiveBalanceAnchor | null;
      settlement?: LiveBalanceAnchor | null;
    };
  } catch {
    return null;
  }
}

// How long a filled real BUY waits for the asynchronous V2 settlement debit
// to land before giving up and leaving the order reconciliation-pending.
// Bounded by attempt count rather than wall-clock so tests can inject an
// instant `sleep` without the loop spinning in real time.
const SETTLEMENT_POLL_ATTEMPTS = 15;
const SETTLEMENT_POLL_INTERVAL_MS = 2_000;

const PUSD_RAW_PER_USD = new Decimal(10).pow(PUSD_DECIMALS);

/**
 * USD → raw pUSD units, floored so a sub-microdollar remainder from the fill
 * math can never push the settlement threshold above the actual on-chain
 * debit.
 */
function usdToRawFloor(usd: Decimal): bigint {
  return BigInt(
    usd.mul(PUSD_RAW_PER_USD).toDecimalPlaces(0, Decimal.ROUND_DOWN).toString()
  );
}

function rawToUsdString(raw: bigint): string {
  return new Decimal(raw.toString())
    .div(PUSD_RAW_PER_USD)
    .toDecimalPlaces(6)
    .toString();
}

/**
 * Outcome shares → raw conditional-token units. CTF positions use the
 * collateral's 6-decimal scale, so the pUSD conversion applies unchanged.
 */
const sharesToRawFloor = usdToRawFloor;

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
    let signedOrderHash: string | null = null;
    let submittedAt: string | null = null;
    let postedOrderId: string | null = null;
    let submissionAttempted = false;
    let submissionResponseReceived = false;
    let submissionAccepted = false;
    let preSubmissionAnchor: LiveBalanceAnchor | null = null;
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
      // The CLOB rejects a marketable BUY whose signed `makerAmount` is under
      // $1. Block here rather than burning a signature on a certain reject.
      if (
        request.action === TRADING_SIDES.BUY &&
        notional.lt(MIN_MARKETABLE_BUY_TICKET_USD)
      ) {
        return blockedFill(
          request,
          `live execution skipped: BUY notional $${notional.toFixed(2)} is below the $${MIN_MARKETABLE_BUY_TICKET_USD.toFixed(2)} minimum`
        );
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

      // BUY fee reserve from preflight (estimate ?? conservative fallback), in
      // raw pUSD units. Fees are charged on top of the filled notional (the
      // order signs without `maxSpend`), so the fill's cash accounting must
      // subtract this too, scaled by the actual fill ratio for FAK partials.
      let buyFeeEstimateRaw: bigint | null = null;
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
          builderCode: config.builderCode ?? undefined,
          getBuilderFeeRates,
          // The agent only ever posts immediate-or-cancel (FAK/FOK) orders,
          // so a BUY always crosses the book as taker.
          isMarketableBuy: true,
        });

        if (request.action === TRADING_SIDES.BUY) {
          if (!preflight.buy) {
            return blockedFill(request, "live BUY preflight failed");
          }
          buyFeeEstimateRaw = preflight.buy.feeRequirementRaw;
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

        // Refreshing the CLOB's per-funder cache is a real network call now
        // that the shim routes it to the SDK action, so it can fail on its own.
        // A stale cache is not necessarily fatal — the server may already be
        // fresh — and `postOrder` surfaces anything that actually blocks the
        // order, so a failed refresh must not kill an otherwise valid trade.
        try {
          await this.runtime.syncBalanceAllowance(client, {
            tokenId: request.tokenId,
            includeCollateral: request.action === TRADING_SIDES.BUY,
            includeConditional: true,
          });
        } catch (error) {
          log.warn("live.balance_allowance_sync.failed", {
            tokenId: request.tokenId,
            action: request.action,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Post-wrap, pre-submission balance anchor. Persisted with the order
        // so the CLOB's actual settlement debit — which no API surface
        // reports — stays derivable off-chain once settlement lands:
        // fee = preSubmission pUSD − settled pUSD − filled notional. Captured
        // after the wrap so freshly wrapped USDC.e doesn't read as a phantom
        // credit inside the debit window.
        preSubmissionAnchor = await this.captureBalanceAnchor({
          wallet,
          funderAddress,
          tokenId: request.tokenId,
        });
        // Fail closed for BUYs: without this anchor the settlement debit can
        // never be derived, so a fill would be unreconcilable forever.
        // Skipping the trade is cheaper than trading blind. SELL fees come
        // out of the proceeds, so SELLs proceed without it.
        if (!preSubmissionAnchor && request.action === TRADING_SIDES.BUY) {
          return blockedFill(
            request,
            "live execution blocked: could not capture the pre-submission balance anchor required to reconcile the settled fee"
          );
        }
      }

      // The agent only ever wants immediate-or-cancel fills (FAK/FOK), which in
      // V2 means a market order with a price bound — `createOrder` builds a
      // resting GTC/GTD limit order and cannot carry FAK/FOK at all. BUY is
      // quoted in notional USD, SELL in shares; `price` becomes the maxPrice /
      // minPrice the order is signed with, so it can never fill worse than the
      // price the decision was made at.
      const signedOrder = await client.createMarketOrder(
        {
          tokenId: request.tokenId,
          amount:
            request.action === TRADING_SIDES.BUY
              ? notional.toNumber()
              : shares.toNumber(),
          side: request.action,
          price: price.toNumber(),
          orderType: config.orderType,
          // No `maxSpend`: the SDK's default signs the full `amount` and
          // charges fees on top. Passing `maxSpend === notional` instead
          // shrinks the signed `makerAmount`, and the CLOB's `min size: 1`
          // floor is checked against that reduced number. Note the fees land
          // on top of `AGENT_MAX_LIVE_NOTIONAL_USD`, which caps notional
          // exposure rather than total debit.
        },
        request.negRisk ? { negRisk: true } : undefined
      );

      const signedOrderJson = JSON.stringify(signedOrder);
      signedOrderHash = await sha256Hex(signedOrderJson);
      submittedAt = config.dryRun ? null : new Date().toISOString();
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
        submittedAt,
        filledAt: null,
        filledNotionalUsd: "0",
        filledShares: "0",
        feeEstimateUsd: "0",
        settledFeeUsd: null,
        averageFillPrice: null,
        lastSyncedAt: null,
        balanceSnapshotJson: buildBalanceSnapshotJson(
          preSubmissionAnchor,
          null
        ),
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

      await this.deps.assertExecutionLock?.();
      submissionAttempted = true;
      const response = await client.postOrder(signedOrder, config.orderType);
      submissionResponseReceived = true;
      assertClobPostOrderSuccess(response);
      submissionAccepted = true;
      postedOrderId = parseOrderId(response);
      if (!postedOrderId) {
        throw new Error("CLOB response missing order id");
      }
      const execution = parseClobExecution({
        response,
        requestedNotional: notional,
        requestedShares: shares,
        price,
      });
      const buyFeeEstimateUsd = estimatedBuyFeeUsd({
        feeEstimateRaw:
          request.action === TRADING_SIDES.BUY ? buyFeeEstimateRaw : null,
        filledNotionalUsd: execution.filledNotionalUsd,
        requestedNotionalUsd: notional,
      });
      const syncedAt = new Date().toISOString();
      // V2 settlement is asynchronous — the balance right after `postOrder`
      // usually still shows the pre-debit amount. For a filled BUY, poll
      // until the debit lands and derive the ACTUAL fee from the balance
      // delta. On timeout the order persists with `settledFeeUsd` null,
      // which `isUnresolvedLiveOrder` treats as reconciliation-pending:
      // further live orders stay blocked — keeping the wallet quiet so the
      // delta stays attributable — until a later run reconciles it.
      let settledFeeUsd: string | null = null;
      let balanceSnapshotJson: string | null;
      if (
        request.action === TRADING_SIDES.BUY &&
        execution.filledShares.gt(0) &&
        preSubmissionAnchor
      ) {
        const settlement = await this.observeSettledFee({
          wallet,
          funderAddress,
          tokenId: request.tokenId,
          preSubmissionAnchor,
          filledNotionalUsd: execution.filledNotionalUsd,
          filledShares: execution.filledShares,
        });
        settledFeeUsd = settlement.settledFeeUsd;
        balanceSnapshotJson = buildBalanceSnapshotJson(
          preSubmissionAnchor,
          settlement.postSubmissionAnchor,
          settlement.settlementAnchor
        );
      } else {
        // SELLs and unfilled orders have no on-top-of-notional fee to
        // reconcile; a single post-submission anchor still brackets the
        // window for the audit trail.
        balanceSnapshotJson = buildBalanceSnapshotJson(
          preSubmissionAnchor,
          await this.captureBalanceAnchor({
            wallet,
            funderAddress,
            tokenId: request.tokenId,
          })
        );
      }
      await this.deps.upsertLiveOrder({
        idempotencyKey,
        runId: request.runId,
        watchlistItemId: request.watchlistItemId,
        tokenId: request.tokenId,
        side: request.action,
        requestedSizeUsd: notional.toDecimalPlaces(6).toString(),
        price: request.price,
        signedOrderHash,
        orderId: postedOrderId,
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
        feeEstimateUsd: buyFeeEstimateUsd.toDecimalPlaces(6).toString(),
        settledFeeUsd,
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
            postedOrderId ? `:${postedOrderId}` : ""
          }`
        );
      }
      return toFilledFill({
        request,
        // A FAK order can fill only part of the requested size; surface that
        // as PARTIALLY_FILLED so the runner reduces (not closes) the position.
        status:
          execution.status === "PARTIALLY_FILLED"
            ? "PARTIALLY_FILLED"
            : "FILLED",
        notionalUsd: execution.filledNotionalUsd,
        shares: execution.filledShares,
        feeUsd:
          settledFeeUsd !== null
            ? new Decimal(settledFeeUsd)
            : buyFeeEstimateUsd,
        price: execution.averageFillPrice ?? request.price,
        reason: `live-${config.orderType.toLowerCase()}:${
          execution.status === "PARTIALLY_FILLED" ? "partial" : "submitted"
        }${postedOrderId ? `:${postedOrderId}` : ""}`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "live execution failed";
      const outcomeUnknown =
        submissionAttempted &&
        (!submissionResponseReceived || submissionAccepted);
      log.error(outcomeUnknown ? "live.submit.unknown" : "live.submit.failed", {
        idempotencyKey,
        error,
      });
      try {
        await this.deps.upsertLiveOrder({
          idempotencyKey,
          runId: request.runId,
          watchlistItemId: request.watchlistItemId,
          tokenId: request.tokenId,
          side: request.action,
          requestedSizeUsd: notional.toDecimalPlaces(6).toString(),
          price: request.price,
          signedOrderHash,
          orderId: postedOrderId,
          status: outcomeUnknown ? "UNKNOWN" : "FAILED",
          submittedAt: submissionAttempted ? submittedAt : null,
          filledAt: null,
          filledNotionalUsd: "0",
          filledShares: "0",
          feeEstimateUsd: "0",
          settledFeeUsd: null,
          averageFillPrice: null,
          lastSyncedAt: null,
          // Keep the pre-submission anchor on UNKNOWN/FAILED rows — for an
          // UNKNOWN order that did fill, it is the only record of the balance
          // the debit will be measured against.
          balanceSnapshotJson: buildBalanceSnapshotJson(
            preSubmissionAnchor,
            null
          ),
          dryRun: config.dryRun,
          error: message,
        });
      } catch (auditError) {
        // If persistence is unavailable after submission, leave the earlier
        // POSTED row intact instead of attempting a destructive replacement.
        log.error("live.audit_update.failed", {
          idempotencyKey,
          auditError,
          outcomeUnknown,
        });
      }
      return blockedFill(
        request,
        `${outcomeUnknown ? "live execution outcome unknown" : "live execution failed"}: ${message}`
      );
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

    // Self-healing pass before the gate reads: a filled real BUY whose
    // settlement debit was never observed inline blocks all live submissions
    // (see isUnresolvedLiveOrder). The block has kept the wallet quiet since,
    // so a fresh balance read can still attribute the delta — try to derive
    // and persist the settled fee now, then evaluate the gate against the
    // updated rows. Runs after the emergency stop and allowlist checks so a
    // stopped agent performs no wallet activity at all.
    await this.reconcilePendingSettlement(input.config);

    const allLiveOrders = await this.deps.listLiveOrders();
    const hasUnresolvedOrder = this.deps.hasUnresolvedLiveOrder
      ? await this.deps.hasUnresolvedLiveOrder()
      : allLiveOrders.some(isUnresolvedLiveOrder);
    if (hasUnresolvedOrder) {
      return "live execution blocked: an earlier order has an unknown outcome or is pending reconciliation";
    }

    const [dailyOrderCap, dailyNotionalCap] = [
      configuredPositiveInteger("AGENT_LIVE_DAILY_MAX_ORDER_COUNT"),
      configuredPositiveDecimal("AGENT_LIVE_DAILY_MAX_NOTIONAL_USD"),
    ];
    if (!dailyOrderCap && !dailyNotionalCap) return null;

    const orders = allLiveOrders.filter(
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

  /**
   * Poll the wallet until the asynchronous V2 settlement debit for a filled
   * BUY becomes observable, then derive the actual fee:
   *   fee = preSubmission pUSD − settled pUSD − filled notional.
   * Settlement is recognized only when BOTH legs of the fill are visible:
   * the pUSD drop reaching the filled notional (the debit is notional + fee,
   * fee ≥ 0) AND the conditional-token balance gaining at least the filled
   * shares. The token credit is what ties the debit to THIS fill — without
   * it, an unrelated spend landing in the poll window could be misread as
   * settlement. The first successful capture doubles as the post-submission
   * anchor. Returns a null fee when the debit never became observable within
   * the attempt budget, or when the drop implies a fee larger than the
   * notional — a >100% fee cannot come from the CLOB, so something else
   * moved the wallet and the delta is no longer attributable to this order.
   */
  private async observeSettledFee(input: {
    wallet: LiveWalletContext;
    funderAddress: Address;
    tokenId: string;
    preSubmissionAnchor: LiveBalanceAnchor;
    filledNotionalUsd: Decimal;
    filledShares: Decimal;
  }): Promise<{
    settledFeeUsd: string | null;
    postSubmissionAnchor: LiveBalanceAnchor | null;
    settlementAnchor: LiveBalanceAnchor | null;
  }> {
    const preSubmitPusdRaw = BigInt(
      input.preSubmissionAnchor.wallet.pusdBalanceRaw
    );
    const preSubmitConditionalRaw = BigInt(
      input.preSubmissionAnchor.conditionalBalanceRaw
    );
    const filledNotionalRaw = usdToRawFloor(input.filledNotionalUsd);
    const filledSharesRaw = sharesToRawFloor(input.filledShares);
    let postSubmissionAnchor: LiveBalanceAnchor | null = null;
    for (let attempt = 1; attempt <= SETTLEMENT_POLL_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await this.runtime.sleep(SETTLEMENT_POLL_INTERVAL_MS);
      }
      const anchor = await this.captureBalanceAnchor(input);
      if (!anchor) continue;
      postSubmissionAnchor ??= anchor;
      const dropRaw = preSubmitPusdRaw - BigInt(anchor.wallet.pusdBalanceRaw);
      const conditionalGainRaw =
        BigInt(anchor.conditionalBalanceRaw) - preSubmitConditionalRaw;
      if (dropRaw < filledNotionalRaw || conditionalGainRaw < filledSharesRaw) {
        continue;
      }
      const feeRaw = dropRaw - filledNotionalRaw;
      if (feeRaw > filledNotionalRaw) {
        log.warn("live.settlement.delta_out_of_range", {
          attempt,
          dropRaw: dropRaw.toString(),
          filledNotionalRaw: filledNotionalRaw.toString(),
        });
        return {
          settledFeeUsd: null,
          postSubmissionAnchor,
          settlementAnchor: null,
        };
      }
      const settledFeeUsd = rawToUsdString(feeRaw);
      log.info("live.settlement.reconciled", { attempt, settledFeeUsd });
      return { settledFeeUsd, postSubmissionAnchor, settlementAnchor: anchor };
    }
    log.warn("live.settlement.unobserved", {
      attempts: SETTLEMENT_POLL_ATTEMPTS,
      filledNotionalRaw: filledNotionalRaw.toString(),
    });
    return {
      settledFeeUsd: null,
      postSubmissionAnchor,
      settlementAnchor: null,
    };
  }

  /**
   * Later-run settlement reconciliation for a filled real BUY whose debit
   * was not observable inline. Only attempts when EXACTLY one order is
   * pending — the safety-gate block guarantees the wallet saw no agent
   * activity since, so with one candidate the balance delta is attributable;
   * with more than one, no delta can be split and the orders stay blocked
   * for manual resolution (same escape hatch as UNKNOWN rows). Beyond the
   * single-candidate rule, acceptance requires (a) the configured wallet to
   * still be the one the anchor was captured from, and (b) fill-specific
   * evidence: the conditional-token balance must have gained at least the
   * filled shares, which only settlement of this order produces. A derived
   * fee outside [0, filled notional] means something other than settlement
   * moved the wallet (top-up, external spend) — also left for manual
   * resolution.
   */
  private async reconcilePendingSettlement(
    config: LiveExecutionConfig
  ): Promise<void> {
    if (!this.deps.listLiveOrders) return;
    try {
      const pending = (await this.deps.listLiveOrders()).filter(
        isSettlementPendingLiveOrder
      );
      if (pending.length === 0) return;
      if (pending.length > 1) {
        log.warn("live.settlement.reconcile_skipped", {
          reason:
            "multiple orders pending reconciliation; balance delta is not attributable",
          count: pending.length,
        });
        return;
      }
      const order = pending[0];
      const snapshot = parseBalanceSnapshot(order.balanceSnapshotJson);
      const preSubmission = snapshot?.preSubmission;
      if (
        !preSubmission?.wallet?.pusdBalanceRaw ||
        preSubmission.conditionalBalanceRaw == null
      ) {
        return;
      }
      const wallet = await this.runtime.setupWallet(config);
      const funderAddress = (config.funderAddress ??
        wallet.signerAddress) as Address;
      // The anchor's balances belong to the wallet that submitted the order.
      // If the configured wallet has since rotated (or the anchor predates
      // address capture), the delta below would be read from a DIFFERENT
      // wallet and could record an arbitrary movement as the fee.
      if (
        !preSubmission.funderAddress ||
        !sameAddress(preSubmission.funderAddress, funderAddress)
      ) {
        log.warn("live.settlement.reconcile_wallet_mismatch", {
          idempotencyKey: order.idempotencyKey,
          anchorFunderAddress: preSubmission.funderAddress ?? null,
          funderAddress,
        });
        return;
      }
      const anchor = await this.captureBalanceAnchor({
        wallet,
        funderAddress,
        tokenId: order.tokenId,
      });
      if (!anchor) return;
      // Fill-specific evidence: settlement credits the filled shares to the
      // funder's conditional-token balance in the same batch that debits the
      // pUSD. A pUSD drop WITHOUT that credit (unrelated spend, withdrawal)
      // is not this order settling, however plausible the amount looks.
      const filledSharesRaw = sharesToRawFloor(
        new Decimal(order.filledShares || "0")
      );
      const conditionalGainRaw =
        BigInt(anchor.conditionalBalanceRaw) -
        BigInt(preSubmission.conditionalBalanceRaw);
      if (
        filledSharesRaw <= BigInt(0) ||
        conditionalGainRaw < filledSharesRaw
      ) {
        log.warn("live.settlement.reconcile_no_fill_evidence", {
          idempotencyKey: order.idempotencyKey,
          conditionalGainRaw: conditionalGainRaw.toString(),
          filledSharesRaw: filledSharesRaw.toString(),
        });
        return;
      }
      const dropRaw =
        BigInt(preSubmission.wallet.pusdBalanceRaw) -
        BigInt(anchor.wallet.pusdBalanceRaw);
      const filledNotionalRaw = usdToRawFloor(
        new Decimal(order.filledNotionalUsd || "0")
      );
      const feeRaw = dropRaw - filledNotionalRaw;
      if (feeRaw < BigInt(0) || feeRaw > filledNotionalRaw) {
        log.warn("live.settlement.reconcile_out_of_range", {
          idempotencyKey: order.idempotencyKey,
          dropRaw: dropRaw.toString(),
          filledNotionalRaw: filledNotionalRaw.toString(),
        });
        return;
      }
      const settledFeeUsd = rawToUsdString(feeRaw);
      // Correct the persisted run-item fill BEFORE clearing the pending
      // order: the hook is idempotent, so if the upsert below fails the next
      // pass redoes both — whereas the reverse order could strand the
      // estimate in the stored fill with nothing left to retry.
      await this.deps.applySettledFeeToRunFill?.({
        runId: order.runId,
        watchlistItemId: order.watchlistItemId,
        side: order.side,
        feeEstimateUsd: order.feeEstimateUsd,
        settledFeeUsd,
      });
      await this.deps.upsertLiveOrder({
        ...order,
        settledFeeUsd,
        lastSyncedAt: new Date().toISOString(),
        balanceSnapshotJson: JSON.stringify({
          preSubmission: snapshot?.preSubmission ?? null,
          postSubmission: snapshot?.postSubmission ?? null,
          settlement: anchor,
        }),
      });
      log.info("live.settlement.reconciled_late", {
        idempotencyKey: order.idempotencyKey,
        settledFeeUsd,
      });
    } catch (error) {
      // Best-effort: on any failure the gate simply keeps blocking, which is
      // the safe state.
      log.warn("live.settlement.reconcile_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async captureBalanceAnchor(input: {
    wallet: LiveWalletContext;
    funderAddress: Address;
    tokenId: string;
  }): Promise<LiveBalanceAnchor | null> {
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
      return {
        capturedAt: new Date().toISOString(),
        funderAddress: input.funderAddress,
        wallet: {
          pusdBalanceRaw: walletBalance.pusdBalanceRaw,
          usdcEBalanceRaw: walletBalance.usdcEBalanceRaw,
          polBalanceRaw: walletBalance.polBalanceRaw,
        },
        conditionalBalanceRaw: conditionalBalanceRaw.toString(),
      };
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
