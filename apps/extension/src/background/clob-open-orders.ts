// Static, not `await import(...)`: this module is eagerly inlined into
// background.js (see the note at the top of ../background.ts) because a classic
// MV3 service worker cannot fetch a webpack async chunk at runtime. Both this
// file and the SDK are already `__STORE_BUILD__`-excluded from the store graph,
// which `scripts/assert-production-bundle.mjs` enforces.
import {
  adaptUnifiedSecureClientForLegacyClob,
  createUnifiedPolymarketCredentialsOnlySigner,
  createUnifiedPolymarketSecureClient,
  type LegacyClobCompatibleClient,
  type UnifiedSdkTradingClient,
} from "@knoww/shared-types/polymarket-unified";

export type ClobApiCredentials = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
};

export type ClobOpenOrder = {
  id?: string;
  order_id?: string;
  maker?: string;
  asset_id?: string;
  token_id?: string;
  side?: string;
  price?: string | number;
  original_size?: string | number;
  size_matched?: string | number;
  status?: string;
  created_at?: string | number;
  expiration?: string | number;
};

export type PortfolioClobOpenOrder = ClobOpenOrder;

type L2ClobClientDeps = {
  createCredentialsOnlySigner: typeof createUnifiedPolymarketCredentialsOnlySigner;
  createSecureClient: typeof createUnifiedPolymarketSecureClient;
  adaptClient: typeof adaptUnifiedSecureClientForLegacyClob;
};

const defaultL2ClobClientDeps: L2ClobClientDeps = {
  createCredentialsOnlySigner: createUnifiedPolymarketCredentialsOnlySigner,
  createSecureClient: createUnifiedPolymarketSecureClient,
  adaptClient: adaptUnifiedSecureClientForLegacyClob,
};

/**
 * Build an L2-only CLOB client: one that authenticates every request with the
 * API-key HMAC and never a wallet signature.
 *
 * The surfaces reached this way — `GET /data/orders`, `DELETE /order`,
 * `GET /balance-allowance/update` — all take that HMAC, so a credentials-only
 * signer covers them, and `allowFreshAuthentication: false` turns any
 * unexpected signing attempt into a loud throw instead of a silent prompt from
 * the service worker.
 *
 * `wallet` defaults to the signer's own address, which makes the SDK classify
 * the account as an EOA and return immediately instead of running a
 * deposit-wallet derivation that is pointless here and unusable with a signer
 * that cannot sign. Pass the funder explicitly when the request carries a
 * `signature_type` — the SDK derives that from the wallet type, so it has to
 * describe the account that actually holds the balance. `POLY_ADDRESS` comes
 * from the signer either way, so the wire requests are identical to the
 * hand-signed ones these replaced.
 */
export async function createL2ClobClient(
  input: {
    address: string;
    credentials: ClobApiCredentials;
    wallet?: string;
  },
  deps: L2ClobClientDeps = defaultL2ClobClientDeps
): Promise<LegacyClobCompatibleClient> {
  const { client } = await deps.createSecureClient({
    signer: deps.createCredentialsOnlySigner(input.address),
    wallet: input.wallet ?? input.address,
    credentials: input.credentials,
    allowFreshAuthentication: false,
  });

  return deps.adaptClient(client as unknown as UnifiedSdkTradingClient);
}

/**
 * List the account's resting orders.
 *
 * `limit` is honoured by the shim as a page budget, so the portfolio badge
 * (which wants five) still stops after the first page instead of walking the
 * whole book.
 */
export async function fetchClobOpenOrders(
  input: {
    address: string;
    credentials: ClobApiCredentials;
    limit?: number;
  },
  deps: L2ClobClientDeps = defaultL2ClobClientDeps
): Promise<ClobOpenOrder[]> {
  const client = await createL2ClobClient(input, deps);
  return client.getOpenOrders(
    typeof input.limit === "number" ? { limit: input.limit } : undefined
  );
}

export const fetchPortfolioOpenOrders = fetchClobOpenOrders;

/**
 * `DELETE /order` answers 200 even when the CLOB refuses the cancel; the reason
 * lands in `not_canceled[orderId]`, which the SDK's schema renames `notCanceled`.
 * Both spellings are read so this survives either path.
 */
function cancelRejectionReason(
  result: unknown,
  orderId: string
): string | null {
  if (typeof result !== "object" || result === null) return null;
  const record = result as Record<string, unknown>;
  const rejected = record.notCanceled ?? record.not_canceled;
  if (typeof rejected !== "object" || rejected === null) return null;
  const reason = (rejected as Record<string, unknown>)[orderId];
  return reason ? String(reason) : null;
}

/**
 * Cancel a single resting order.
 *
 * Runs through the unified SDK's `cancelOrder` rather than a hand-signed
 * `DELETE /order` — see `createL2ClobClient` for why a credentials-only signer
 * is enough.
 *
 * Still throws when the order could not be cancelled.
 */
export async function cancelClobOrder(
  input: {
    address: string;
    credentials: ClobApiCredentials;
    orderId: string;
  },
  deps: L2ClobClientDeps = defaultL2ClobClientDeps
): Promise<void> {
  const client = await createL2ClobClient(input, deps);
  const result = await client.cancelOrder({ orderId: input.orderId });

  const reason = cancelRejectionReason(result, input.orderId);
  if (reason) throw new Error(reason);
}
