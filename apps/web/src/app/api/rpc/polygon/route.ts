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
 * Blocked JSON-RPC methods (denylist approach).
 *
 * We block write/signing methods that should never go through a shared proxy.
 * Everything else (reads, gas estimation, fee queries, etc.) is allowed,
 * which avoids breaking when viem/wagmi/wallet SDKs add new read methods.
 */
const BLOCKED_RPC_METHODS = new Set([
  // Transaction submission — users should sign and submit via their own wallet
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  // Signing — must happen client-side via the user's wallet
  "eth_sign",
  "eth_signTransaction",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  // Account management — these are wallet-level operations
  "eth_accounts",
  "eth_requestAccounts",
  "eth_coinbase",
  // Mining/admin — not applicable
  "eth_mining",
  "eth_submitWork",
  "eth_submitHashrate",
  "admin_addPeer",
  "admin_removePeer",
  "admin_nodeInfo",
  "debug_traceTransaction",
  "debug_traceBlockByNumber",
  "debug_traceBlockByHash",
  "miner_start",
  "miner_stop",
  "personal_newAccount",
  "personal_unlockAccount",
  "personal_importRawKey",
]);

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

async function fetchFromEndpoint(
  endpoint: RpcEndpoint,
  body: unknown
): Promise<{ data: unknown; status: number } | null> {
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
      return null;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      log.warn("upstream.invalid_json", {
        provider: endpoint.provider,
        endpoint: endpoint.name,
        error,
      });
      markEndpointUnhealthy(endpoint, "invalid_json");
      return null;
    }

    if (isRetryableRpcResponse(data)) {
      log.warn("upstream.retryable_rpc_error", {
        provider: endpoint.provider,
        endpoint: endpoint.name,
      });
      markEndpointUnhealthy(endpoint, "retryable_rpc_error");
      return null;
    }

    log.debug("upstream.success", {
      provider: endpoint.provider,
      endpoint: endpoint.name,
    });
    return { data, status: response.status };
  } catch (error) {
    const isAbortError = error instanceof Error && error.name === "AbortError";
    log.warn(isAbortError ? "upstream.timeout" : "upstream.fetch_failed", {
      provider: endpoint.provider,
      endpoint: endpoint.name,
      timeoutMs: PER_ENDPOINT_TIMEOUT_MS,
      error,
    });
    markEndpointUnhealthy(endpoint, isAbortError ? "timeout" : "fetch_failed");
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

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

    // Validate JSON-RPC methods against denylist
    const requests = Array.isArray(body) ? body : [body];
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

      if (BLOCKED_RPC_METHODS.has(method)) {
        return jsonError(
          `RPC method not allowed through proxy: ${method}`,
          403,
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
      if (result) {
        return NextResponse.json(result.data, {
          status: result.status,
          headers: corsHeaders,
        });
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
