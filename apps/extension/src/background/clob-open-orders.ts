import { POLYMARKET_API } from "@knoww/shared-types/polymarket";

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

const CLOB_HOST = POLYMARKET_API.CLOB.BASE;
const CLOB_INITIAL_CURSOR = "MA==";
const CLOB_END_CURSOR = "LTE=";

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const s = b64
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function buildClobHmacHeaders(
  address: string,
  credentials: ClobApiCredentials,
  method: string,
  requestPath: string,
  body?: string
): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000);
  // Polymarket signs the canonical path and optional body only; query params
  // are intentionally excluded from the HMAC message.
  const message = `${ts}${method}${requestPath}${body ?? ""}`;
  const keyData = base64ToArrayBuffer(credentials.apiSecret);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await globalThis.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message)
  );
  const sig = arrayBufferToBase64(sigBuf)
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: sig,
    POLY_TIMESTAMP: String(ts),
    POLY_API_KEY: credentials.apiKey,
    POLY_PASSPHRASE: credentials.apiPassphrase,
  };
}

export async function fetchClobOpenOrders(input: {
  address: string;
  credentials: ClobApiCredentials;
  filters?: { market?: string; assetId?: string };
  limit?: number;
}): Promise<ClobOpenOrder[]> {
  const endpoint = "/data/orders";
  const headers = await buildClobHmacHeaders(
    input.address,
    input.credentials,
    "GET",
    endpoint
  );
  const results: ClobOpenOrder[] = [];
  const limit =
    typeof input.limit === "number" ? Math.max(1, input.limit) : undefined;
  let nextCursor = CLOB_INITIAL_CURSOR;

  while (
    nextCursor !== CLOB_END_CURSOR &&
    (limit === undefined || results.length < limit)
  ) {
    const params = new URLSearchParams({ next_cursor: nextCursor });
    if (input.filters?.market) params.set("market", input.filters.market);
    if (input.filters?.assetId) params.set("asset_id", input.filters.assetId);
    const res = await fetch(`${CLOB_HOST}${endpoint}?${params}`, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch open orders: ${res.status}`);
    }

    const payload = (await res.json()) as {
      data?: unknown;
      error?: unknown;
      next_cursor?: unknown;
    };
    if (payload.error) {
      throw new Error(String(payload.error));
    }
    if (Array.isArray(payload.data)) {
      results.push(...(payload.data as ClobOpenOrder[]));
    }

    const next =
      typeof payload.next_cursor === "string"
        ? payload.next_cursor
        : CLOB_END_CURSOR;
    if (next === nextCursor) break;
    nextCursor = next;
  }

  return typeof limit === "number" ? results.slice(0, limit) : results;
}

export const fetchPortfolioOpenOrders = fetchClobOpenOrders;

// Cancel a single resting order via the CLOB `DELETE /order` endpoint. The L2
// HMAC signature covers the method, path and JSON body — the same scheme the
// official clob-client uses for cancelOrder. Throws when the order could not be
// cancelled (the API reports failures in `not_canceled`).
export async function cancelClobOrder(input: {
  address: string;
  credentials: ClobApiCredentials;
  orderId: string;
}): Promise<void> {
  const endpoint = "/order";
  const body = JSON.stringify({ orderID: input.orderId });
  const headers = await buildClobHmacHeaders(
    input.address,
    input.credentials,
    "DELETE",
    endpoint,
    body
  );
  const res = await fetch(`${CLOB_HOST}${endpoint}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Failed to cancel order: ${res.status}`);
  }

  const payload = (await res.json()) as {
    canceled?: unknown;
    not_canceled?: unknown;
    error?: unknown;
  };
  if (payload.error) {
    throw new Error(String(payload.error));
  }
  if (payload.not_canceled && typeof payload.not_canceled === "object") {
    const reason = (payload.not_canceled as Record<string, unknown>)[
      input.orderId
    ];
    if (reason) throw new Error(String(reason));
  }
}
