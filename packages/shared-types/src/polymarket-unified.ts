import {
  createPublicClient as createPolymarketPublicClient,
  createSecureClient as createPolymarketSecureClient,
  type PublicClientOptions,
  type SecureClient,
  type SecureClientOptions,
  type Signer,
  type SignerTransactionRequest,
  type TransactionHandle,
  type TransactionOutcome,
  type TypedDataPayload,
} from "@polymarket/client";
import type { WalletClient } from "viem";
import { waitForTransactionReceipt } from "viem/actions";
import {
  type ClobBuilderFeeRates,
  type ClobOrderBook,
  type ClobPriceHistoryParams,
  type ClobPriceHistoryResponse,
  normalizeClobOrderBook,
} from "./clob.ts";
import {
  type ApiKeyCreds,
  type ApiKeyCredsLike,
  normalizeApiKeyCreds,
  TRADING_SIDES,
  type TradingSide,
} from "./polymarket.ts";

export interface UnifiedPolymarketPublicClient {
  fetchOrderBook(request: { tokenId: string }): Promise<unknown>;
  fetchOrderBooks?(request: Array<{ tokenId: string }>): Promise<unknown>;
  fetchMarketInfo?(request: { conditionId: string }): Promise<unknown>;
  fetchPrice?(request: {
    tokenId: string;
    side: TradingSide;
  }): Promise<unknown>;
  fetchPriceHistory?(request: {
    tokenId: string;
    startTs?: number;
    endTs?: number;
    fidelity?: number;
  }): Promise<unknown>;
  fetchBuilderFeeRates?(request: { builderCode: string }): Promise<unknown>;
}

export interface UnifiedPolymarketPublicClientOptions
  extends PublicClientOptions {
  client?: UnifiedPolymarketPublicClient;
}

export type UnifiedPolymarketSecureClient = SecureClient;

export interface UnifiedPolymarketSecureClientResult<
  TClient = UnifiedPolymarketSecureClient,
> {
  client: TClient;
  appCredentials: ApiKeyCreds;
}

type UnifiedSdkApiKeyCreds = {
  key: string;
  secret: string;
  passphrase: string;
};

type CreateSecureClientImpl<TClient> = (
  options: Record<string, unknown>
) => Promise<TClient>;

export interface UnifiedPolymarketSecureClientOptions<TClient = unknown>
  extends Partial<Pick<PublicClientOptions, "apiKey" | "environment">> {
  signer: SecureClientOptions["signer"] | unknown;
  wallet?: string;
  credentials?: ApiKeyCreds;
  nonce?: number;
  /**
   * Allow the SDK to ask the signer for fresh L1 auth if supplied credentials
   * are rejected. Passive reads should set this to false so background polling
   * can never open a wallet signature prompt.
   */
  allowFreshAuthentication?: boolean;
  createSecureClientImpl?: CreateSecureClientImpl<TClient>;
}

const FRESH_AUTHENTICATION_BLOCKED_MESSAGE =
  "Stored Polymarket API credentials require explicit re-authentication.";
const FRESH_AUTHENTICATION_BLOCKED_NAME =
  "PolymarketFreshAuthenticationRequiredError";

function createPolymarketFreshAuthenticationRequiredError(): Error {
  const error = new Error(FRESH_AUTHENTICATION_BLOCKED_MESSAGE);
  error.name = FRESH_AUTHENTICATION_BLOCKED_NAME;
  return error;
}

export function isPolymarketFreshAuthenticationRequiredError(
  error: unknown
): boolean {
  if (!isRecord(error)) return false;

  const name = typeof error.name === "string" ? error.name : "";
  const message = typeof error.message === "string" ? error.message : "";
  return (
    name === FRESH_AUTHENTICATION_BLOCKED_NAME ||
    message.includes(FRESH_AUTHENTICATION_BLOCKED_MESSAGE)
  );
}

type UnifiedSdkMarketOrderRequest = {
  tokenId: string;
  side: TradingSide;
  amount?: number | string;
  shares?: number | string;
  price?: number | string;
  builderCode?: string;
};

type UnifiedSdkLimitOrderRequest = {
  tokenId: string;
  price: number | string;
  size: number | string;
  side: TradingSide;
  expiration?: number;
  builderCode?: string;
};

type UnifiedSdkBalanceAllowanceRequest = {
  assetType: string;
  tokenId?: string;
};

type UnifiedSdkPaginatorPage<TItem> = {
  items?: TItem[];
  data?: TItem[];
  nextCursor?: string | null;
};

type UnifiedSdkPaginator<TItem> = AsyncIterable<
  UnifiedSdkPaginatorPage<TItem>
> & {
  firstPage?: () => Promise<UnifiedSdkPaginatorPage<TItem>>;
  from?: (
    cursor?: string | null
  ) => AsyncIterable<UnifiedSdkPaginatorPage<TItem>>;
};

export interface UnifiedSdkTradingClient {
  createMarketOrder(request: UnifiedSdkMarketOrderRequest): Promise<unknown>;
  createLimitOrder(request: UnifiedSdkLimitOrderRequest): Promise<unknown>;
  postOrder(order: unknown): Promise<unknown>;
  listOpenOrders?(): UnifiedSdkPaginator<unknown>;
  fetchMarketInfo?(request: { conditionId: string }): Promise<unknown>;
  fetchOrderScoring?(request: { orderId: string }): Promise<boolean>;
  fetchOrdersScoring?(request: {
    orderIds: string[];
  }): Promise<Record<string, boolean>>;
  updateBalanceAllowance?(
    request: UnifiedSdkBalanceAllowanceRequest
  ): Promise<unknown>;
  fetchBalanceAllowance?(
    request: UnifiedSdkBalanceAllowanceRequest
  ): Promise<unknown>;
  cancelOrder?(request: { orderId: string }): Promise<unknown>;
}

export interface LegacyClobOrderRequest {
  tokenID?: string;
  tokenId?: string;
  price?: number | string;
  size?: number | string;
  amount?: number | string;
  side: TradingSide;
  expiration?: number;
}

export interface LegacyClobBalanceAllowanceRequest {
  asset_type?: string;
  assetType?: string;
  token_id?: string;
  tokenId?: string;
}

export interface LegacyClobCompatibleClient {
  createMarketOrder(
    request: LegacyClobOrderRequest,
    options?: unknown
  ): Promise<unknown>;
  createOrder(
    request: LegacyClobOrderRequest,
    options?: unknown
  ): Promise<unknown>;
  postOrder(order: unknown, orderType?: unknown): Promise<unknown>;
  getOpenOrders(): Promise<LegacyClobOpenOrder[]>;
  fetchMarketInfo?(request: { conditionId: string }): Promise<unknown>;
  getClobMarketInfo?(conditionId: string): Promise<unknown>;
  updateBalanceAllowance(
    request: LegacyClobBalanceAllowanceRequest
  ): Promise<unknown>;
  getBalanceAllowance?(
    request: LegacyClobBalanceAllowanceRequest
  ): Promise<unknown>;
  cancelOrder(request: {
    orderID?: string;
    orderId?: string;
  }): Promise<unknown>;
  isOrderScoring(request: { order_id?: string; orderId?: string }): Promise<{
    scoring: boolean;
  }>;
  areOrdersScoring(request: {
    orderIds?: string[];
    order_ids?: string[];
  }): Promise<Record<string, boolean>>;
}

export interface LegacyClobOpenOrder {
  id?: string;
  order_id?: string;
  maker?: string;
  maker_address?: string;
  asset_id?: string;
  token_id?: string;
  tokenId?: string;
  side?: string;
  price?: string | number;
  original_size?: string | number;
  originalSize?: string | number;
  size_matched?: string | number;
  sizeMatched?: string | number;
  status?: string;
  created_at?: string | number;
  createdAt?: string | number;
  expiration?: string | number;
  expiresAt?: string | number;
}

export interface LegacyClobAdapterOptions {
  builderCode?: string;
}

export function createUnifiedPolymarketPublicClient(
  options: Omit<UnifiedPolymarketPublicClientOptions, "client"> = {}
): UnifiedPolymarketPublicClient {
  return createPolymarketPublicClient(options) as UnifiedPolymarketPublicClient;
}

type WalletClientAccount = NonNullable<WalletClient["account"]>;

function getWalletClientAccount(
  walletClient: WalletClient
): WalletClientAccount {
  if (!walletClient.account) {
    throw new Error("Polymarket signer requires a wallet client with account");
  }
  return walletClient.account;
}

function getWalletClientAddress(walletClient: WalletClient): string {
  const account = getWalletClientAccount(walletClient);
  return typeof account === "string" ? account : account.address;
}

async function assertWalletClientChain(
  walletClient: WalletClient,
  chainId: number
): Promise<void> {
  const activeChainId =
    walletClient.chain?.id ?? (await walletClient.getChainId());
  if (activeChainId !== chainId) {
    throw new Error(
      `Wallet client is connected to chain ${activeChainId}, expected ${chainId}`
    );
  }
}

class ViemTransactionHandle implements TransactionHandle {
  readonly transactionId = null;

  readonly #walletClient: WalletClient;
  #transactionHash: TransactionOutcome["transactionHash"];

  constructor(
    transactionHash: TransactionOutcome["transactionHash"],
    walletClient: WalletClient
  ) {
    this.#transactionHash = transactionHash;
    this.#walletClient = walletClient;
  }

  get transactionHash() {
    return this.#transactionHash;
  }

  async wait(): Promise<TransactionOutcome> {
    const receipt = await waitForTransactionReceipt(
      this.#walletClient as Parameters<typeof waitForTransactionReceipt>[0],
      { hash: this.#transactionHash as `0x${string}` }
    );
    this.#transactionHash =
      receipt.transactionHash as TransactionOutcome["transactionHash"];

    if (receipt.status === "reverted") {
      throw new Error(`Transaction ${this.#transactionHash} reverted`);
    }

    return {
      transactionHash: this.#transactionHash,
      transactionId: null,
    };
  }
}

export function createUnifiedPolymarketViemSigner(
  walletClient: WalletClient
): Signer {
  const account = getWalletClientAccount(walletClient);

  return {
    async getAddress() {
      return getWalletClientAddress(walletClient) as Awaited<
        ReturnType<Signer["getAddress"]>
      >;
    },
    async signTypedData(payload: TypedDataPayload) {
      const signature = await (
        walletClient.signTypedData as (
          args: TypedDataPayload & { account: WalletClientAccount }
        ) => Promise<string>
      )({
        account,
        ...payload,
      });
      return signature as Awaited<ReturnType<Signer["signTypedData"]>>;
    },
    async signMessage(message) {
      const signature = await walletClient.signMessage({
        account,
        message: { raw: message as `0x${string}` },
      });
      return signature as Awaited<ReturnType<Signer["signMessage"]>>;
    },
    async sendTransaction(request: SignerTransactionRequest) {
      await assertWalletClientChain(walletClient, request.chainId);
      const transactionHash = await (
        walletClient.sendTransaction as (
          args: Record<string, unknown>
        ) => Promise<string>
      )({
        account,
        to: request.to,
        data: request.data,
        value: request.value,
      });
      return new ViemTransactionHandle(
        transactionHash as TransactionOutcome["transactionHash"],
        walletClient
      );
    },
  };
}

function throwFreshAuthenticationRequired(): never {
  throw createPolymarketFreshAuthenticationRequiredError();
}

export function createUnifiedPolymarketCredentialsOnlySigner(
  address: string
): Signer {
  return {
    async getAddress() {
      return address as Awaited<ReturnType<Signer["getAddress"]>>;
    },
    async signTypedData(_payload: TypedDataPayload) {
      throwFreshAuthenticationRequired();
    },
    async signMessage(_message: Parameters<Signer["signMessage"]>[0]) {
      throwFreshAuthenticationRequired();
    },
    async sendTransaction(_request: SignerTransactionRequest) {
      throwFreshAuthenticationRequired();
    },
  };
}

function blockFreshAuthentication(signer: unknown): unknown {
  if (!isRecord(signer) && typeof signer !== "function") return signer;

  return new Proxy(signer as object, {
    get(target, prop, receiver) {
      if (
        prop === "signTypedData" ||
        prop === "signMessage" ||
        prop === "sendTransaction"
      ) {
        return async () => {
          throwFreshAuthenticationRequired();
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

function getLegacyTokenId(request: LegacyClobOrderRequest): string {
  const tokenId = request.tokenId ?? request.tokenID;
  if (!tokenId) throw new Error("Polymarket order token id is required");
  return tokenId;
}

function withBuilderCode<TRequest extends Record<string, unknown>>(
  request: TRequest,
  builderCode?: string
): TRequest {
  if (!builderCode) return request;
  return { ...request, builderCode };
}

function mapLegacyBalanceAllowanceRequest(
  request: LegacyClobBalanceAllowanceRequest
): UnifiedSdkBalanceAllowanceRequest {
  const assetType = request.assetType ?? request.asset_type;
  if (!assetType) {
    throw new Error("Polymarket balance allowance asset type is required");
  }

  const tokenId = request.tokenId ?? request.token_id;
  return tokenId ? { assetType, tokenId } : { assetType };
}

function pageItems(page: UnifiedSdkPaginatorPage<unknown>): unknown[] {
  if (Array.isArray(page.items)) return page.items;
  if (Array.isArray(page.data)) return page.data;
  return [];
}

async function collectUnifiedPaginator(
  paginator: UnifiedSdkPaginator<unknown>
): Promise<LegacyClobOpenOrder[]> {
  const items: LegacyClobOpenOrder[] = [];

  if (typeof paginator.firstPage === "function") {
    const firstPage = await paginator.firstPage();
    items.push(...pageItems(firstPage).map(normalizeLegacyOpenOrder));

    if (firstPage.nextCursor && typeof paginator.from === "function") {
      for await (const page of paginator.from(firstPage.nextCursor)) {
        items.push(...pageItems(page).map(normalizeLegacyOpenOrder));
      }
    }

    return items;
  }

  for await (const page of paginator) {
    items.push(...pageItems(page).map(normalizeLegacyOpenOrder));
  }

  return items;
}

function recordString(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" ? raw : undefined;
}

function recordStringOrNumber(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" || typeof raw === "number" ? raw : undefined;
}

function normalizeLegacyOpenOrder(order: unknown): LegacyClobOpenOrder {
  if (!isRecord(order)) return {};

  const normalized: LegacyClobOpenOrder = {
    id: recordString(order, "id"),
    order_id: recordString(order, "order_id") ?? recordString(order, "orderId"),
    maker:
      recordString(order, "maker") ??
      recordString(order, "maker_address") ??
      recordString(order, "makerAddress") ??
      recordString(order, "owner"),
    asset_id:
      recordString(order, "asset_id") ??
      recordString(order, "assetId") ??
      recordString(order, "tokenId"),
    token_id:
      recordString(order, "token_id") ??
      recordString(order, "tokenId") ??
      recordString(order, "asset_id"),
    tokenId: recordString(order, "tokenId") ?? recordString(order, "asset_id"),
    side: recordString(order, "side"),
    price: recordStringOrNumber(order, "price"),
    original_size:
      recordStringOrNumber(order, "original_size") ??
      recordStringOrNumber(order, "originalSize") ??
      recordStringOrNumber(order, "size"),
    originalSize:
      recordStringOrNumber(order, "originalSize") ??
      recordStringOrNumber(order, "original_size") ??
      recordStringOrNumber(order, "size"),
    size_matched:
      recordStringOrNumber(order, "size_matched") ??
      recordStringOrNumber(order, "sizeMatched"),
    sizeMatched:
      recordStringOrNumber(order, "sizeMatched") ??
      recordStringOrNumber(order, "size_matched"),
    status: recordString(order, "status"),
    created_at:
      recordStringOrNumber(order, "created_at") ??
      recordStringOrNumber(order, "createdAt"),
    createdAt:
      recordStringOrNumber(order, "createdAt") ??
      recordStringOrNumber(order, "created_at"),
    expiration:
      recordStringOrNumber(order, "expiration") ??
      recordStringOrNumber(order, "expiresAt"),
    expiresAt:
      recordStringOrNumber(order, "expiresAt") ??
      recordStringOrNumber(order, "expiration"),
  };

  for (const key of Object.keys(normalized) as Array<
    keyof LegacyClobOpenOrder
  >) {
    if (normalized[key] === undefined) {
      delete normalized[key];
    }
  }

  return normalized;
}

export function adaptUnifiedSecureClientForLegacyClob(
  client: UnifiedSdkTradingClient,
  options: LegacyClobAdapterOptions = {}
): LegacyClobCompatibleClient {
  const legacyClient: LegacyClobCompatibleClient = {
    async createMarketOrder(request) {
      const tokenId = getLegacyTokenId(request);
      const baseRequest = {
        tokenId,
        side: request.side,
        ...(request.side === TRADING_SIDES.SELL
          ? { shares: request.amount ?? request.size }
          : { amount: request.amount }),
        ...(request.price !== undefined ? { price: request.price } : {}),
      };
      return client.createMarketOrder(
        withBuilderCode(baseRequest, options.builderCode)
      );
    },

    async createOrder(request) {
      if (request.price === undefined) {
        throw new Error("Polymarket limit order price is required");
      }
      if (request.size === undefined) {
        throw new Error("Polymarket limit order size is required");
      }

      const baseRequest = {
        tokenId: getLegacyTokenId(request),
        price: request.price,
        size: request.size,
        side: request.side,
        ...(request.expiration ? { expiration: request.expiration } : {}),
      };
      return client.createLimitOrder(
        withBuilderCode(baseRequest, options.builderCode)
      );
    },

    async postOrder(order) {
      return client.postOrder(order);
    },

    async getOpenOrders() {
      if (!client.listOpenOrders) return [];
      return collectUnifiedPaginator(client.listOpenOrders());
    },

    async updateBalanceAllowance(request) {
      if (!client.updateBalanceAllowance) {
        return undefined;
      }
      return client.updateBalanceAllowance(
        mapLegacyBalanceAllowanceRequest(request)
      );
    },

    async cancelOrder(request) {
      if (!client.cancelOrder) {
        throw new Error("Unified Polymarket SDK client cannot cancel orders");
      }
      const orderId = request.orderId ?? request.orderID;
      if (!orderId) throw new Error("Polymarket order id is required");
      return client.cancelOrder({ orderId });
    },

    async isOrderScoring(request) {
      if (!client.fetchOrderScoring) return { scoring: false };
      const orderId = request.orderId ?? request.order_id;
      if (!orderId) throw new Error("Polymarket order id is required");
      return { scoring: await client.fetchOrderScoring({ orderId }) };
    },

    async areOrdersScoring(request) {
      if (!client.fetchOrdersScoring) return {};
      return client.fetchOrdersScoring({
        orderIds: request.orderIds ?? request.order_ids ?? [],
      });
    },
  };

  if (client.fetchMarketInfo) {
    const fetchMarketInfo = client.fetchMarketInfo;
    legacyClient.fetchMarketInfo = (request) => fetchMarketInfo(request);
    legacyClient.getClobMarketInfo = (conditionId) =>
      fetchMarketInfo({ conditionId });
  }

  if (client.fetchBalanceAllowance) {
    const fetchBalanceAllowance = client.fetchBalanceAllowance;
    legacyClient.getBalanceAllowance = (request) =>
      fetchBalanceAllowance(mapLegacyBalanceAllowanceRequest(request));
  }

  return legacyClient;
}

function toUnifiedSdkApiKeyCreds(
  credentials: ApiKeyCreds
): UnifiedSdkApiKeyCreds {
  return {
    key: credentials.apiKey,
    secret: credentials.apiSecret,
    passphrase: credentials.apiPassphrase,
  };
}

function getClientCredentials(client: unknown): ApiKeyCreds {
  if (!isRecord(client)) {
    throw new Error("Unified Polymarket SDK client did not return credentials");
  }
  return normalizeApiKeyCreds(client.credentials as ApiKeyCredsLike);
}

export async function createUnifiedPolymarketSecureClient<
  TClient = UnifiedPolymarketSecureClient,
>(
  options: UnifiedPolymarketSecureClientOptions<TClient>
): Promise<UnifiedPolymarketSecureClientResult<TClient>> {
  const signer =
    options.credentials && options.allowFreshAuthentication === false
      ? blockFreshAuthentication(options.signer)
      : options.signer;
  const clientOptions: Record<string, unknown> = {
    signer,
  };

  if (options.wallet) clientOptions.wallet = options.wallet;
  if (options.apiKey) clientOptions.apiKey = options.apiKey;
  if (options.environment) clientOptions.environment = options.environment;

  if (options.credentials) {
    clientOptions.credentials = toUnifiedSdkApiKeyCreds(options.credentials);
  } else if (options.nonce !== undefined) {
    clientOptions.nonce = options.nonce;
  }

  const createSecureClientImpl =
    options.createSecureClientImpl ??
    ((secureOptions: Record<string, unknown>) =>
      createPolymarketSecureClient(
        secureOptions as SecureClientOptions
      ) as Promise<TClient>);
  const client = await createSecureClientImpl(clientOptions);

  return {
    client,
    appCredentials: getClientCredentials(client),
  };
}

export async function fetchUnifiedClobOrderBook(
  tokenId: string,
  options: UnifiedPolymarketPublicClientOptions = {}
): Promise<ClobOrderBook> {
  const client =
    options.client ??
    createUnifiedPolymarketPublicClient({
      apiKey: options.apiKey,
      environment: options.environment,
    });

  const data = await client.fetchOrderBook({ tokenId });
  return normalizeClobOrderBook(data);
}

function optionalFiniteNumber(
  value: string | number | undefined
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buildPriceHistoryRequest(
  tokenId: string,
  params: ClobPriceHistoryParams
): {
  tokenId: string;
  startTs?: number;
  endTs?: number;
  fidelity?: number;
} {
  const request: {
    tokenId: string;
    startTs?: number;
    endTs?: number;
    fidelity?: number;
  } = { tokenId };
  const startTs = optionalFiniteNumber(params.startTs);
  const endTs = optionalFiniteNumber(params.endTs);
  const fidelity = optionalFiniteNumber(params.fidelity);
  if (startTs !== undefined) request.startTs = startTs;
  if (endTs !== undefined) request.endTs = endTs;
  if (fidelity !== undefined) request.fidelity = fidelity;
  return request;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBuilderFeeRates(raw: unknown): ClobBuilderFeeRates {
  if (!isRecord(raw)) return { maker: 0, taker: 0 };
  const maker = typeof raw.maker === "number" ? raw.maker : 0;
  const taker = typeof raw.taker === "number" ? raw.taker : 0;
  return { maker, taker };
}

export async function fetchUnifiedClobOrderBooks(
  tokenIds: readonly string[],
  options: UnifiedPolymarketPublicClientOptions = {}
): Promise<ClobOrderBook[]> {
  if (tokenIds.length === 0) return [];
  const client =
    options.client ??
    createUnifiedPolymarketPublicClient({
      apiKey: options.apiKey,
      environment: options.environment,
    });

  if (!client.fetchOrderBooks) {
    throw new Error("Unified Polymarket SDK client cannot fetch order books");
  }

  const data = await client.fetchOrderBooks(
    tokenIds.map((tokenId) => ({ tokenId }))
  );
  return Array.isArray(data) ? data.map(normalizeClobOrderBook) : [];
}

export async function fetchUnifiedClobMarket<T = unknown>(
  conditionId: string,
  options: UnifiedPolymarketPublicClientOptions = {}
): Promise<T> {
  const client =
    options.client ??
    createUnifiedPolymarketPublicClient({
      apiKey: options.apiKey,
      environment: options.environment,
    });

  if (!client.fetchMarketInfo) {
    throw new Error("Unified Polymarket SDK client cannot fetch market info");
  }

  return (await client.fetchMarketInfo({ conditionId })) as T;
}

export async function fetchUnifiedClobPrice<T = unknown>(
  tokenId: string,
  side: TradingSide,
  options: UnifiedPolymarketPublicClientOptions = {}
): Promise<T> {
  const client =
    options.client ??
    createUnifiedPolymarketPublicClient({
      apiKey: options.apiKey,
      environment: options.environment,
    });

  if (!client.fetchPrice) {
    throw new Error("Unified Polymarket SDK client cannot fetch price");
  }

  return (await client.fetchPrice({ tokenId, side })) as T;
}

export async function fetchUnifiedClobPriceHistory<
  T = ClobPriceHistoryResponse,
>(
  tokenId: string,
  params: ClobPriceHistoryParams = {},
  options: UnifiedPolymarketPublicClientOptions = {}
): Promise<T> {
  const client =
    options.client ??
    createUnifiedPolymarketPublicClient({
      apiKey: options.apiKey,
      environment: options.environment,
    });

  if (!client.fetchPriceHistory) {
    throw new Error("Unified Polymarket SDK client cannot fetch price history");
  }

  const data = await client.fetchPriceHistory(
    buildPriceHistoryRequest(tokenId, params)
  );
  return { history: Array.isArray(data) ? data : [] } as T;
}

export async function fetchUnifiedClobBuilderFeeRates(
  builderCode: string,
  options: UnifiedPolymarketPublicClientOptions = {}
): Promise<ClobBuilderFeeRates> {
  const client =
    options.client ??
    createUnifiedPolymarketPublicClient({
      apiKey: options.apiKey,
      environment: options.environment,
    });

  if (!client.fetchBuilderFeeRates) {
    throw new Error("Unified Polymarket SDK client cannot fetch builder fees");
  }

  return normalizeBuilderFeeRates(
    await client.fetchBuilderFeeRates({ builderCode })
  );
}
