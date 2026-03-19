import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isAllowedOrigin } from "@/lib/origin-guard";

/**
 * Server-side RPC Proxy for Polygon
 *
 * This proxies RPC requests to Alchemy without exposing the API key to the client.
 * The API key is only accessible server-side.
 *
 * Supports both single and batch JSON-RPC requests.
 */

// Timeout for RPC requests (30 seconds)
const RPC_TIMEOUT_MS = 30000;

// Maximum request body size (100KB — well above any legitimate JSON-RPC payload)
const MAX_BODY_SIZE = 100 * 1024;

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

// Get the RPC URL server-side (API key is not exposed to client)
function getServerRpcUrl(): string {
  // Priority 1: Alchemy (best for production)
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (alchemyKey) {
    console.log("[RPC Proxy] Using Alchemy RPC for Polygon (server-side)");
    return `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  // Priority 2: Custom RPC URL (server-side)
  const customRpcUrl = process.env.POLYGON_RPC_URL;
  if (customRpcUrl) {
    return customRpcUrl;
  }

  // Priority 3: Public Polygon RPC (has strict rate limits)
  return "https://polygon-rpc.com";
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");

  if (!requestOrigin || !isAllowedOrigin(requestOrigin)) {
    console.warn(
      "[RPC Proxy] Rejected request from disallowed origin:",
      requestOrigin || "(no origin)"
    );
    return NextResponse.json(
      { error: "Forbidden: origin not allowed" },
      { status: 403 }
    );
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
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413, headers: corsHeaders }
    );
  }

  // Parse JSON body with dedicated error handling
  let body: unknown;
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_SIZE) {
      return NextResponse.json(
        { error: "Request body too large" },
        { status: 413, headers: corsHeaders }
      );
    }
    body = JSON.parse(rawBody);
  } catch (parseError) {
    // Handle JSON parse errors (SyntaxError) with a 400 response
    console.warn(
      "[RPC Proxy] Invalid JSON payload:",
      parseError instanceof Error ? parseError.message : parseError
    );
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    // Validate the request body structure
    if (!body || (typeof body !== "object" && !Array.isArray(body))) {
      return NextResponse.json(
        { error: "Invalid JSON-RPC request" },
        { status: 400, headers: corsHeaders }
      );
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
        return NextResponse.json(
          { error: "Invalid JSON-RPC request: missing method" },
          { status: 400, headers: corsHeaders }
        );
      }

      if (BLOCKED_RPC_METHODS.has(method)) {
        return NextResponse.json(
          { error: `RPC method not allowed through proxy: ${method}` },
          { status: 403, headers: corsHeaders }
        );
      }
    }

    const rpcUrl = getServerRpcUrl();

    // Set up AbortController with timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

    let response: Response;
    try {
      // Forward the request to the actual RPC endpoint
      response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (fetchError) {
      // Handle abort/timeout errors
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        console.error(
          "[RPC Proxy] Request timed out after",
          RPC_TIMEOUT_MS,
          "ms"
        );
        return NextResponse.json(
          { error: "RPC request timed out" },
          { status: 504, headers: corsHeaders }
        );
      }
      throw fetchError; // Re-throw other errors to be caught by outer catch
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.error(
        "[RPC Proxy] Upstream error:",
        response.status,
        response.statusText
      );
      return NextResponse.json(
        { error: `RPC request failed: ${response.statusText}` },
        { status: response.status, headers: corsHeaders }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { headers: corsHeaders });
  } catch (error) {
    console.error("[RPC Proxy] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
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
