import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isAllowedOrigin } from "@/lib/origin-guard";

const log = createLogger("api.rpc.polygon");

/**
 * Server-side RPC Proxy for Polygon
 *
 * This proxies RPC requests to Alchemy without exposing the API key to the client.
 * The API key is only accessible server-side.
 *
 * Supports both single and batch JSON-RPC requests.
 */

// Per-endpoint timeout. Keep this low so failed public RPCs do not hold the
// user request open for too long while the proxy tries fallbacks.
const PER_ENDPOINT_TIMEOUT_MS = 5000;

// Maximum request body size (100KB — well above any legitimate JSON-RPC payload)
const MAX_BODY_SIZE = 100 * 1024;

// Maximum JSON-RPC requests per batch. viem/wagmi batching stays well under
// this; larger batches amplify upstream fanout through a shared proxy.
const MAX_BATCH_ITEMS = 10;

// Maximum upstream response size we will buffer. Responses are read through
// a byte-counting stream so a misbehaving upstream (or an eth_getLogs-style
// query with a huge result) cannot exhaust isolate memory.
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;

// eth_feeHistory returns one entry per block and percentile. Bounding both
// axes prevents a small request from asking the upstream for a large matrix.
const MAX_FEE_HISTORY_BLOCKS = 128;
const MAX_FEE_HISTORY_PERCENTILES = 20;

// How long an endpoint stays in the "unhealthy" set after a failure before
// we re-probe it. Short enough that a transient blip doesn't sideline the
// fastest endpoint for long.
const UNHEALTHY_TTL_MS = 60_000;

type RpcEndpoint = {
  name: string;
  url: string;
  provider: "public" | "custom" | "alchemy";
};

const PUBLIC_RPC_ENDPOINTS: RpcEndpoint[] = [
  { name: "drpc", url: "https://polygon.drpc.org", provider: "public" },
  { name: "polygon-rpc", url: "https://polygon-rpc.com", provider: "public" },
  { name: "1rpc", url: "https://1rpc.io/matic", provider: "public" },
  {
    name: "publicnode",
    url: "https://polygon-bor-rpc.publicnode.com",
    provider: "public",
  },
  {
    name: "onfinality",
    url: "https://polygon.api.onfinality.io/public",
    provider: "public",
  },
];

const unhealthyEndpoints = new Map<string, number>();

/**
 * Allowed JSON-RPC methods (allowlist approach).
 *
 * The proxy exists solely so the browser can read Polygon state through our
 * origin (wagmi public client, viem multicall, wallet-token balances). Only
 * the standard read/fee methods those clients issue are forwarded; anything
 * else — signing, tx submission, admin/debug namespaces, and any method a
 * future upstream might add — is rejected by default. Filter methods
 * (eth_newFilter etc.) are deliberately absent: filter ids are per-node
 * state, which a round-robin multi-endpoint proxy cannot honor.
 * `eth_getLogs` is also excluded — no browser flow uses it, and an
 * unbounded block range can force the Worker and provider to produce
 * multi-megabyte responses; re-add it only behind a bounded
 * range/address/topic policy.
 *
 * The set is intentionally minimal: it contains exactly the methods a
 * repository grep shows the app's clients issuing. Every extra method is
 * free Worker/provider quota for anyone who finds this public proxy, so
 * add one only when an actual application flow needs it — never
 * speculatively.
 */
const ALLOWED_RPC_METHODS = new Set([
  // Chain identity
  "eth_chainId",
  // Blocks — number polling + lookup for viem receipt waiting
  "eth_blockNumber",
  "eth_getBlockByNumber",
  // State reads — wagmi public client, viem multicall, token balances
  "eth_call",
  "eth_getBalance",
  "eth_getCode",
  "eth_getTransactionCount",
  // Transactions (read-only lookups)
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  // Gas / fees
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_maxPriorityFeePerGas",
]);

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const HEX_DATA_RE = /^0x(?:[a-fA-F0-9]{2})*$/;
const HEX_QUANTITY_RE = /^0x(?:0|[1-9a-fA-F][a-fA-F0-9]*)$/;
const BLOCK_TAGS = new Set([
  "earliest",
  "finalized",
  "latest",
  "pending",
  "safe",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isHexQuantity(value: unknown): value is string {
  return typeof value === "string" && HEX_QUANTITY_RE.test(value);
}

function isBlockIdentifier(value: unknown): boolean {
  if (typeof value === "string") {
    return BLOCK_TAGS.has(value) || isHexQuantity(value);
  }
  if (!isPlainObject(value)) return false;

  const hasHash = "blockHash" in value;
  const hasNumber = "blockNumber" in value;
  if (hasHash === hasNumber) return false;
  if (hasHash && !HASH_RE.test(String(value.blockHash))) return false;
  if (hasNumber && !isHexQuantity(value.blockNumber)) return false;
  return (
    !("requireCanonical" in value) ||
    typeof value.requireCanonical === "boolean"
  );
}

function isCallObject(value: unknown): boolean {
  if (!isPlainObject(value)) return false;

  for (const key of ["from", "to"] as const) {
    if (key in value && !ADDRESS_RE.test(String(value[key]))) return false;
  }
  for (const key of [
    "chainId",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "nonce",
    "type",
    "value",
  ] as const) {
    if (key in value && !isHexQuantity(value[key])) return false;
  }
  for (const key of ["data", "input"] as const) {
    if (key in value && !HEX_DATA_RE.test(String(value[key]))) return false;
  }
  return true;
}

function areSortedPercentiles(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_FEE_HISTORY_PERCENTILES) {
    return false;
  }

  let previous = -1;
  for (const percentile of value) {
    if (
      typeof percentile !== "number" ||
      !Number.isFinite(percentile) ||
      percentile < 0 ||
      percentile > 100 ||
      percentile < previous
    ) {
      return false;
    }
    previous = percentile;
  }
  return true;
}

function hasParams(
  params: unknown[],
  count: number,
  validators: Array<(value: unknown) => boolean>
): boolean {
  return (
    params.length === count &&
    validators.every((validator, index) => validator(params[index]))
  );
}

function hasValidRpcParams(method: string, paramsValue: unknown): boolean {
  const params = paramsValue === undefined ? [] : paramsValue;
  if (!Array.isArray(params)) return false;

  switch (method) {
    case "eth_chainId":
    case "eth_blockNumber":
    case "eth_gasPrice":
    case "eth_maxPriorityFeePerGas":
      return params.length === 0;

    case "eth_getBlockByNumber":
      // Returning full transaction objects can multiply the response size.
      return hasParams(params, 2, [
        (value) => typeof value === "string" && isBlockIdentifier(value),
        (value) => value === false,
      ]);

    case "eth_getBalance":
    case "eth_getCode":
    case "eth_getTransactionCount":
      return hasParams(params, 2, [
        (value) => typeof value === "string" && ADDRESS_RE.test(value),
        isBlockIdentifier,
      ]);

    case "eth_getTransactionByHash":
    case "eth_getTransactionReceipt":
      return hasParams(params, 1, [
        (value) => typeof value === "string" && HASH_RE.test(value),
      ]);

    case "eth_feeHistory": {
      if (
        !hasParams(params, 3, [
          isHexQuantity,
          isBlockIdentifier,
          areSortedPercentiles,
        ])
      ) {
        return false;
      }
      const blockCount = Number.parseInt(params[0] as string, 16);
      return (
        Number.isSafeInteger(blockCount) &&
        blockCount > 0 &&
        blockCount <= MAX_FEE_HISTORY_BLOCKS
      );
    }

    case "eth_call":
      return (
        params.length >= 1 &&
        params.length <= 3 &&
        isCallObject(params[0]) &&
        (params.length < 2 || isBlockIdentifier(params[1])) &&
        (params.length < 3 || isPlainObject(params[2]))
      );

    case "eth_estimateGas":
      return (
        params.length >= 1 &&
        params.length <= 2 &&
        isCallObject(params[0]) &&
        (params.length < 2 || isBlockIdentifier(params[1]))
      );

    default:
      return false;
  }
}

/**
 * Generates CORS headers for the validated origin.
 * Uses the shared isAllowedOrigin() from origin-guard.ts so the
 * whitelist is maintained in a single place.
 */
function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
    headers.Vary = "Origin";
  }

  return headers;
}

function uniqueEndpoints(endpoints: RpcEndpoint[]): RpcEndpoint[] {
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    if (seen.has(endpoint.url)) return false;
    seen.add(endpoint.url);
    return true;
  });
}

// Get server-side RPC URLs in fallback order. Public endpoints are tried first;
// Alchemy is kept last so the paid/private quota is only used as a final fallback.
function getServerRpcEndpoints(): RpcEndpoint[] {
  const endpoints = [...PUBLIC_RPC_ENDPOINTS];

  const customRpcUrl = process.env.POLYGON_RPC_URL;
  if (customRpcUrl) {
    endpoints.push({
      name: "custom",
      url: customRpcUrl,
      provider: "custom",
    });
  }

  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (alchemyKey) {
    endpoints.push({
      name: "alchemy",
      url: `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      provider: "alchemy",
    });
  }

  return uniqueEndpoints(endpoints);
}

function getHealthyRpcEndpoints(): RpcEndpoint[] {
  const now = Date.now();
  const endpoints = getServerRpcEndpoints();
  const healthy = endpoints.filter((endpoint) => {
    const unhealthyUntil = unhealthyEndpoints.get(endpoint.url);
    if (!unhealthyUntil) return true;
    if (unhealthyUntil <= now) {
      unhealthyEndpoints.delete(endpoint.url);
      return true;
    }
    return false;
  });

  return healthy.length > 0 ? healthy : endpoints;
}

function markEndpointUnhealthy(endpoint: RpcEndpoint, reason: string) {
  unhealthyEndpoints.set(endpoint.url, Date.now() + UNHEALTHY_TTL_MS);
  log.warn("upstream.mark_unhealthy", {
    provider: endpoint.provider,
    endpoint: endpoint.name,
    reason,
    retryAfterMs: UNHEALTHY_TTL_MS,
  });
}

function getRpcErrorPayload(data: unknown): unknown[] {
  const responses = Array.isArray(data) ? data : [data];
  return responses
    .map((response) =>
      typeof response === "object" && response !== null && "error" in response
        ? (response as { error: unknown }).error
        : null
    )
    .filter((error): error is unknown => error !== null);
}

function isRetryableRpcError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const code = "code" in error ? (error as { code: unknown }).code : undefined;
  const message =
    "message" in error ? (error as { message: unknown }).message : undefined;
  const normalizedMessage =
    typeof message === "string" ? message.toLowerCase() : "";

  if (code === -32601) return true;

  return [
    "rate limit",
    "too many",
    "timeout",
    "timed out",
    "temporar",
    "unavailable",
    "overloaded",
    "capacity",
    "limit exceeded",
    "not supported",
    "not available",
  ].some((needle) => normalizedMessage.includes(needle));
}

function isRetryableRpcResponse(data: unknown): boolean {
  const responses = Array.isArray(data) ? data : [data];
  if (responses.length === 0) return false;

  const errors = getRpcErrorPayload(data);
  return (
    errors.length === responses.length && errors.every(isRetryableRpcError)
  );
}

/**
 * Reads a response body with a hard byte cap, then parses JSON. Uses a
 * streaming reader so oversized bodies are cancelled mid-flight instead of
 * fully buffered before the size check.
 */
async function readBoundedJson(
  response: Response,
  maxBytes: number
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; reason: "too_large" | "invalid_json" }
> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    await response.body?.cancel();
    return { ok: false, reason: "too_large" };
  }

  if (!response.body) {
    return { ok: false, reason: "invalid_json" };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(combined)) };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

type EndpointFetchResult =
  | { kind: "success"; data: unknown; status: number }
  // Terminal: a too-large response is driven by the request, so retrying the
  // next endpoint would just re-download the same oversized payload.
  | { kind: "too_large" }
  | { kind: "failed" };

async function fetchFromEndpoint(
  endpoint: RpcEndpoint,
  body: unknown
): Promise<EndpointFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    PER_ENDPOINT_TIMEOUT_MS
  );

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn("upstream.non2xx", {
        provider: endpoint.provider,
        endpoint: endpoint.name,
        status: response.status,
        statusText: response.statusText,
      });
      markEndpointUnhealthy(endpoint, `http_${response.status}`);
      return { kind: "failed" };
    }

    const parsed = await readBoundedJson(response, MAX_UPSTREAM_RESPONSE_BYTES);
    if (!parsed.ok) {
      if (parsed.reason === "too_large") {
        // Not an endpoint-health problem — the request produced an oversized
        // result, so don't sideline the endpoint for other callers.
        log.warn("upstream.response_too_large", {
          provider: endpoint.provider,
          endpoint: endpoint.name,
          maxBytes: MAX_UPSTREAM_RESPONSE_BYTES,
        });
        return { kind: "too_large" };
      }
      log.warn("upstream.invalid_json", {
        provider: endpoint.provider,
        endpoint: endpoint.name,
      });
      markEndpointUnhealthy(endpoint, "invalid_json");
      return { kind: "failed" };
    }
    const data = parsed.data;

    if (isRetryableRpcResponse(data)) {
      log.warn("upstream.retryable_rpc_error", {
        provider: endpoint.provider,
        endpoint: endpoint.name,
      });
      markEndpointUnhealthy(endpoint, "retryable_rpc_error");
      return { kind: "failed" };
    }

    log.debug("upstream.success", {
      provider: endpoint.provider,
      endpoint: endpoint.name,
    });
    return { kind: "success", data, status: response.status };
  } catch (error) {
    const isAbortError = error instanceof Error && error.name === "AbortError";
    log.warn(isAbortError ? "upstream.timeout" : "upstream.fetch_failed", {
      provider: endpoint.provider,
      endpoint: endpoint.name,
      timeoutMs: PER_ENDPOINT_TIMEOUT_MS,
      error,
    });
    markEndpointUnhealthy(endpoint, isAbortError ? "timeout" : "fetch_failed");
    return { kind: "failed" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * @openapi
 * /api/rpc/polygon:
 *   post:
 *     summary: Proxy bounded read-only Polygon JSON-RPC requests.
 *     tags: [Rpc]
 *     responses:
 *       200:
 *         description: Successful response.
 *       400:
 *         description: Invalid JSON-RPC request or method parameters.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Request forbidden.
 *       404:
 *         description: Resource not found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Request failed.
 *       502:
 *         description: Upstream unavailable or response exceeded the byte cap.
 */
export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");

  if (!requestOrigin || !isAllowedOrigin(requestOrigin)) {
    log.warn("origin.rejected", { origin: requestOrigin || "(no origin)" });
    return jsonError("Forbidden: origin not allowed", 403);
  }

  // Rate limit: 30 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const corsHeaders = getCorsHeaders(requestOrigin);

  // Check content-length to reject oversized payloads early
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return jsonError("Request body too large", 413, corsHeaders);
  }

  // Parse JSON body with dedicated error handling
  let body: unknown;
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_SIZE) {
      return jsonError("Request body too large", 413, corsHeaders);
    }
    body = JSON.parse(rawBody);
  } catch (parseError) {
    // Handle JSON parse errors (SyntaxError) with a 400 response
    log.warn("body.invalid_json", { error: parseError });
    return jsonError("Invalid JSON payload", 400, corsHeaders);
  }

  try {
    // Validate the request body structure
    if (!body || (typeof body !== "object" && !Array.isArray(body))) {
      return jsonError("Invalid JSON-RPC request", 400, corsHeaders);
    }

    // Validate JSON-RPC methods against the read-method allowlist
    const isBatch = Array.isArray(body);
    const requests: unknown[] = Array.isArray(body) ? body : [body];
    if (isBatch && requests.length === 0) {
      return jsonError("Empty JSON-RPC batch", 400, corsHeaders);
    }
    if (requests.length > MAX_BATCH_ITEMS) {
      return jsonError(
        `Too many requests in batch (max ${MAX_BATCH_ITEMS})`,
        400,
        corsHeaders
      );
    }
    for (const rpcRequest of requests) {
      const method =
        typeof rpcRequest === "object" &&
        rpcRequest !== null &&
        "method" in rpcRequest
          ? (rpcRequest as { method: unknown }).method
          : undefined;

      if (typeof method !== "string") {
        return jsonError(
          "Invalid JSON-RPC request: missing method",
          400,
          corsHeaders
        );
      }

      if (!ALLOWED_RPC_METHODS.has(method)) {
        log.warn("method.rejected", { method });
        return jsonError(
          `RPC method not allowed through proxy: ${method}`,
          403,
          corsHeaders
        );
      }

      const rpcObject = rpcRequest as Record<string, unknown>;
      if (
        rpcObject.jsonrpc !== "2.0" ||
        !hasValidRpcParams(method, rpcObject.params)
      ) {
        log.warn("params.rejected", { method });
        return jsonError(
          `Invalid params for RPC method: ${method}`,
          400,
          corsHeaders
        );
      }
    }

    const endpoints = getHealthyRpcEndpoints();
    log.debug("upstream.fallback_order", {
      endpoints: endpoints.map((endpoint) => ({
        provider: endpoint.provider,
        endpoint: endpoint.name,
      })),
    });

    for (const endpoint of endpoints) {
      const result = await fetchFromEndpoint(endpoint, body);
      if (result.kind === "success") {
        return NextResponse.json(result.data, {
          status: result.status,
          headers: corsHeaders,
        });
      }
      if (result.kind === "too_large") {
        return jsonError("RPC upstream response too large", 502, corsHeaders);
      }
    }

    log.error("upstream.all_failed", {
      attempted: endpoints.map((endpoint) => ({
        provider: endpoint.provider,
        endpoint: endpoint.name,
      })),
    });
    return jsonError("RPC upstream unavailable", 502, corsHeaders);
  } catch (error) {
    log.error("proxy.failed", { error });
    return jsonError("Internal server error", 500, corsHeaders);
  }
}

/**
 * @openapi
 * /api/rpc/polygon:
 *   options:
 *     summary: Handle preflight for /api/rpc/polygon.
 *     tags: [Rpc]
 *     responses:
 *       200:
 *         description: Preflight response.
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Request forbidden.
 *       404:
 *         description: Resource not found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Request failed.
 */
export async function OPTIONS(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");

  if (!requestOrigin || !isAllowedOrigin(requestOrigin)) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(requestOrigin),
  });
}
