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
import {
  fetchBalanceAllowance as fetchSdkBalanceAllowance,
  fetchBuilderFeeRates as fetchSdkBuilderFeeRates,
  fetchMarketInfo as fetchSdkMarketInfo,
  updateBalanceAllowance as updateSdkBalanceAllowance,
} from "@polymarket/client/actions";
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
  CLOB_ORDER_TYPES,
  type ClobOrderType,
  normalizeApiKeyCreds,
  TRADING_SIDES,
  type TradingSide,
} from "./polymarket.ts";

/**
 * The only two order types a V2 market order may carry. GTC/GTD are resting
 * limit-order lifetimes and belong to `createLimitOrder`.
 */
export type MarketClobOrderType =
  | typeof CLOB_ORDER_TYPES.FAK
  | typeof CLOB_ORDER_TYPES.FOK;

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

/**
 * Market-order request as `@polymarket/client` actually accepts it.
 *
 * The SDK validates with zod and **strips unknown keys silently**, so a stray
 * `price` here does not error — it is dropped, and the SDK derives its own
 * bound by walking the live book (`estimateMarketPrice`) instead of honouring
 * the caller's. BUY takes a notional `amount` plus an optional `maxPrice`
 * ceiling and `maxSpend` cap; SELL takes `shares` plus an optional `minPrice`
 * floor. `orderType` is baked into the signed order at creation time (it is
 * not a `postOrder` argument any more) and defaults to FAK.
 *
 * `maxSpend` is passed through but no caller sets it: it caps *total* spend
 * including fees, which makes the SDK shrink the signed `makerAmount` below the
 * requested `amount` — and the CLOB's `min size: 1` floor applies to that
 * reduced number. Callers sign the full amount and pay fees on top.
 */
type UnifiedSdkMarketOrderRequest = {
  tokenId: string;
  side: TradingSide;
  amount?: number | string;
  shares?: number | string;
  maxSpend?: number | string;
  maxPrice?: number | string;
  minPrice?: number | string;
  orderType?: MarketClobOrderType;
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
  tokenId: string;
  /**
   * Market orders: the worst price the caller will accept, mapped to the SDK's
   * `maxPrice` (BUY) / `minPrice` (SELL). Limit orders: the resting price.
   */
  price?: number | string;
  size?: number | string;
  amount?: number | string;
  /** Market BUY only — hard ceiling on total spend including builder fees. */
  maxSpend?: number | string;
  side: TradingSide;
  expiration?: number;
  /**
   * Fill semantics. Market orders accept FAK/FOK; limit orders derive GTC/GTD
   * from `expiration` and must not set this. In V2 the order type is signed
   * into the order at creation time, so it belongs here and not on `postOrder`.
   */
  orderType?: ClobOrderType;
}

export interface LegacyClobBalanceAllowanceRequest {
  assetType: string;
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
  /**
   * `limit` caps how many pages are pulled, not just how many rows come back —
   * see `collectUnifiedPaginator`. Omit it to drain the full book.
   */
  getOpenOrders(options?: { limit?: number }): Promise<LegacyClobOpenOrder[]>;
  fetchMarketInfo?(request: { conditionId: string }): Promise<unknown>;
  getClobMarketInfo?(conditionId: string): Promise<unknown>;
  updateBalanceAllowance(
    request: LegacyClobBalanceAllowanceRequest
  ): Promise<unknown>;
  getBalanceAllowance(
    request: LegacyClobBalanceAllowanceRequest
  ): Promise<unknown>;
  cancelOrder(request: { orderId: string }): Promise<unknown>;
  isOrderScoring(request: { orderId: string }): Promise<{
    scoring: boolean;
  }>;
  areOrdersScoring(request: {
    orderIds: string[];
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
  if (!request.tokenId) {
    throw new Error("Polymarket order token id is required");
  }
  return request.tokenId;
}

/**
 * Narrow a legacy order type to the FAK/FOK pair a market order may carry.
 * `undefined` is passed through so the SDK applies its own FAK default.
 */
function assertMarketOrderType(
  orderType?: ClobOrderType
): MarketClobOrderType | undefined {
  if (orderType === undefined) return undefined;
  if (
    orderType === CLOB_ORDER_TYPES.FAK ||
    orderType === CLOB_ORDER_TYPES.FOK
  ) {
    return orderType;
  }
  throw new Error(
    `Polymarket market orders cannot be ${orderType}; use createOrder for resting GTC/GTD orders`
  );
}

/**
 * Accept a market-order price bound only when it is a usable number. Callers
 * that cannot compute a bound pass `0`, which must be omitted rather than
 * signed as "never fill above zero".
 */
function optionalPriceBound(
  price?: number | string
): number | string | undefined {
  if (price === undefined || price === null || price === "") return undefined;
  const numeric = typeof price === "number" ? price : Number(price);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return price;
}

function assertPostedOrderTypeMatches(
  order: unknown,
  requestedOrderType: unknown
): void {
  if (typeof requestedOrderType !== "string") return;
  if (!isRecord(order)) return;
  const signedOrderType = order.orderType;
  if (typeof signedOrderType !== "string") return;
  if (signedOrderType === requestedOrderType) return;
  throw new Error(
    `Polymarket order was created as ${signedOrderType} but posted as ${requestedOrderType}; set the order type when creating the order`
  );
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
  const { assetType, tokenId } = request;
  if (!assetType) {
    throw new Error("Polymarket balance allowance asset type is required");
  }
  return tokenId ? { assetType, tokenId } : { assetType };
}

type SdkBalanceAllowanceClient = Parameters<
  typeof updateSdkBalanceAllowance
>[0];
type SdkBalanceAllowanceActionRequest = Parameters<
  typeof updateSdkBalanceAllowance
>[1];

/**
 * `@polymarket/client@0.2.0` ships balance/allowance **only** as standalone
 * actions: nothing in `allActions()` is `updateBalanceAllowance`/
 * `fetchBalanceAllowance`. Guarding on the client methods therefore never
 * fires, which is why this sync used to be a silent no-op.
 *
 * The sync matters because we post through the raw `postOrder`. Only
 * `placeMarketOrder`/`placeLimitOrder` carry the SDK's built-in self-heal
 * (catch "allowance is not enough" → approve on-chain → `updateBalanceAllowance`
 * → retry once); `postOrder` has none, so refreshing the server's per-funder
 * cache here is our only protection against a stale-cache rejection.
 *
 * The client methods are still tried first — the SDK documents the instance API
 * as the preferred surface, so a later release that adds them takes over with
 * no change here.
 */
function toSdkBalanceAllowanceArgs(
  client: UnifiedSdkTradingClient,
  request: LegacyClobBalanceAllowanceRequest
): [SdkBalanceAllowanceClient, SdkBalanceAllowanceActionRequest] {
  return [
    client as unknown as SdkBalanceAllowanceClient,
    mapLegacyBalanceAllowanceRequest(
      request
    ) as SdkBalanceAllowanceActionRequest,
  ];
}

type SdkPublicActionClient = Parameters<typeof fetchSdkMarketInfo>[0];

/**
 * Same story as balance/allowance above: `fetchMarketInfo` and
 * `fetchBuilderFeeRates` exist only as standalone actions. They are absent from
 * both the public (62-key) and secure (97-key) action surfaces, so every
 * `if (client.fetchMarketInfo)` guard we wrote was dead code.
 *
 * These two take a `BaseClient` rather than the `BaseSecureClient` the
 * balance/allowance pair wants, so both our public and secure clients are valid
 * arguments — the cast bridges the SDK's nominal branding, not a shape gap.
 */
function toSdkPublicActionClient(client: unknown): SdkPublicActionClient {
  return client as SdkPublicActionClient;
}

function pageItems(page: UnifiedSdkPaginatorPage<unknown>): unknown[] {
  if (Array.isArray(page.items)) return page.items;
  if (Array.isArray(page.data)) return page.data;
  return [];
}

/**
 * Drain a paginator into a flat list, optionally stopping early.
 *
 * `limit` is a page-fetch budget, not just a slice: callers that only need the
 * first handful of orders (the extension's portfolio badge asks for 5) would
 * otherwise pay for every page of a large book before throwing the rest away.
 * The final `slice` keeps the returned count exact, since a page can overshoot.
 */
async function collectUnifiedPaginator(
  paginator: UnifiedSdkPaginator<unknown>,
  limit?: number
): Promise<LegacyClobOpenOrder[]> {
  const items: LegacyClobOpenOrder[] = [];
  const max =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.max(1, Math.floor(limit))
      : undefined;
  const done = () => max !== undefined && items.length >= max;
  const truncate = () => (max === undefined ? items : items.slice(0, max));

  if (typeof paginator.firstPage === "function") {
    const firstPage = await paginator.firstPage();
    items.push(...pageItems(firstPage).map(normalizeLegacyOpenOrder));

    if (
      !done() &&
      firstPage.nextCursor &&
      typeof paginator.from === "function"
    ) {
      for await (const page of paginator.from(firstPage.nextCursor)) {
        items.push(...pageItems(page).map(normalizeLegacyOpenOrder));
        if (done()) break;
      }
    }

    return truncate();
  }

  for await (const page of paginator) {
    items.push(...pageItems(page).map(normalizeLegacyOpenOrder));
    if (done()) break;
  }

  return truncate();
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
      const orderType = assertMarketOrderType(request.orderType);
      const bound = optionalPriceBound(request.price);

      const baseRequest: UnifiedSdkMarketOrderRequest =
        request.side === TRADING_SIDES.SELL
          ? {
              tokenId,
              side: request.side,
              shares: request.amount ?? request.size,
              ...(bound !== undefined ? { minPrice: bound } : {}),
            }
          : {
              tokenId,
              side: request.side,
              amount: request.amount,
              ...(request.maxSpend !== undefined
                ? { maxSpend: request.maxSpend }
                : {}),
              ...(bound !== undefined ? { maxPrice: bound } : {}),
            };
      if (orderType) baseRequest.orderType = orderType;

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
      if (
        request.orderType === CLOB_ORDER_TYPES.FAK ||
        request.orderType === CLOB_ORDER_TYPES.FOK
      ) {
        // A V2 limit order can only be GTC or GTD. Silently creating a resting
        // GTC order for a caller that asked for fill-or-kill is the worst
        // possible failure, so refuse instead.
        throw new Error(
          `Polymarket limit orders cannot be ${request.orderType}; use createMarketOrder with a price bound instead`
        );
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

    async postOrder(order, orderType) {
      // V2 signs the order type into the order itself, so `postOrder` no longer
      // takes one. Callers that still pass one are only allowed to restate what
      // the signed order already says — anything else means intent was lost at
      // creation time and would post silently under the wrong semantics.
      assertPostedOrderTypeMatches(order, orderType);
      return client.postOrder(order);
    },

    async getOpenOrders(options) {
      if (!client.listOpenOrders) return [];
      return collectUnifiedPaginator(client.listOpenOrders(), options?.limit);
    },

    async updateBalanceAllowance(request) {
      if (client.updateBalanceAllowance) {
        return client.updateBalanceAllowance(
          mapLegacyBalanceAllowanceRequest(request)
        );
      }
      return updateSdkBalanceAllowance(
        ...toSdkBalanceAllowanceArgs(client, request)
      );
    },

    async getBalanceAllowance(request) {
      if (client.fetchBalanceAllowance) {
        return client.fetchBalanceAllowance(
          mapLegacyBalanceAllowanceRequest(request)
        );
      }
      return fetchSdkBalanceAllowance(
        ...toSdkBalanceAllowanceArgs(client, request)
      );
    },

    async cancelOrder(request) {
      if (!client.cancelOrder) {
        throw new Error("Unified Polymarket SDK client cannot cancel orders");
      }
      if (!request.orderId) throw new Error("Polymarket order id is required");
      return client.cancelOrder({ orderId: request.orderId });
    },

    async isOrderScoring(request) {
      if (!client.fetchOrderScoring) return { scoring: false };
      if (!request.orderId) throw new Error("Polymarket order id is required");
      return {
        scoring: await client.fetchOrderScoring({ orderId: request.orderId }),
      };
    },

    async areOrdersScoring(request) {
      if (!client.fetchOrdersScoring) return {};
      return client.fetchOrdersScoring({ orderIds: request.orderIds ?? [] });
    },
  };

  // Attached unconditionally. This used to sit behind `if (client.fetchMarketInfo)`,
  // which never fired — market info is a standalone action, not a client method —
  // so every consumer saw `getClobMarketInfo === undefined` and silently fell back
  // to a flat fee estimate. Prefer the client method if a future release adds one.
  const fetchMarketInfo = client.fetchMarketInfo
    ? client.fetchMarketInfo.bind(client)
    : (request: { conditionId: string }) =>
        fetchSdkMarketInfo(
          toSdkPublicActionClient(client),
          request
        ) as Promise<unknown>;
  legacyClient.fetchMarketInfo = (request) => fetchMarketInfo(request);
  legacyClient.getClobMarketInfo = (conditionId) =>
    fetchMarketInfo({ conditionId });

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

// Fail closed on malformed builder-fee payloads: a configured builder whose
// rates read as missing, non-finite, or negative must not normalize to a
// fee-free quote — the throw propagates and the caller's fee estimate falls
// back to the conservative reserve instead.
function normalizeBuilderFeeRates(raw: unknown): ClobBuilderFeeRates {
  if (!isRecord(raw)) {
    throw new Error("Malformed builder fee rates payload");
  }
  return {
    maker: requireBuilderFeeRateNumber(raw.maker, "maker"),
    taker: requireBuilderFeeRateNumber(raw.taker, "taker"),
  };
}

function requireBuilderFeeRateNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `Malformed builder fee rate: ${field} must be a finite non-negative number`
    );
  }
  return value;
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

/**
 * Fee-and-token metadata for a condition, via the SDK's `GET /clob-markets/{id}`.
 *
 * **This is not the same payload as `fetchClobMarket`'s `GET /markets/{id}`.**
 * `/markets` returns the full snake_case market object (question, slug, images,
 * tags, `maker_base_fee`/`taker_base_fee`) but carries **no** `fd` protocol-fee
 * block and no `tbf` builder bps. `/clob-markets` returns the trading-side view
 * — `{fd: {r, e}, tbf, t, mos, mts, nr, …}` — which the SDK parses down to
 * `{feeInfo: {rate, exponent}, tokens: [{tokenId, outcome}]}`.
 *
 * Fee estimation needs `fd`, so it must read *this* endpoint; anything wanting
 * the human-facing market record must stay on `fetchClobMarket`. The two are not
 * interchangeable, which is why `fetchClobMarket` has no unified-SDK branch.
 */
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

  if (client.fetchMarketInfo) {
    return (await client.fetchMarketInfo({ conditionId })) as T;
  }

  return (await fetchSdkMarketInfo(toSdkPublicActionClient(client), {
    conditionId,
  })) as T;
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

  if (client.fetchBuilderFeeRates) {
    return normalizeBuilderFeeRates(
      await client.fetchBuilderFeeRates({ builderCode })
    );
  }

  return normalizeBuilderFeeRates(
    await fetchSdkBuilderFeeRates(toSdkPublicActionClient(client), {
      builderCode,
    })
  );
}
