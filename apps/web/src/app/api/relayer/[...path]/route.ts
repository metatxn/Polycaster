import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { requireExtensionSession } from "@/lib/auth/extension-session";
import { checkOriginAndFetchSite } from "@/lib/origin-guard";

/**
 * Server-side proxy for Polymarket's V2 Relayer.
 *
 * The web app and extension call this route instead of relayer-v2.polymarket.com
 * directly. This keeps POLY_RELAYER_API_KEY entirely server-side — it never
 * appears in the browser bundle, extension bundle, or network requests from
 * either client.
 *
 * Flow:
 *   Browser    → POST /api/relayer/{path} → this route → relayer-v2.polymarket.com/{path}
 *   Extension  → POST /api/relayer/{path} → this route → relayer-v2.polymarket.com/{path}
 *
 * Security layers (mirror /api/sign):
 *   1. Origin + Sec-Fetch-Site validation for first-party web requests
 *      — OR — signed extension bearer session for extension requests
 *   2. Per-IP rate limiting (60 req/min — relayer flows are chattier than signing)
 *   3. Body size limit (16 KB — multiSend payloads can be larger than HMAC asks)
 *   4. Request timeout (30 s — relayer can be slower than signing server)
 *
 * Environment variables (server-only, NO NEXT_PUBLIC_ prefix):
 *   POLY_RELAYER_API_KEY         – Polymarket V2 relayer API key
 *   POLY_RELAYER_API_KEY_ADDRESS – Address that owns the relayer key
 *   EXTENSION_SESSION_SECRET     – extension session signing secret
 */

const UPSTREAM_BASE = "https://relayer-v2.polymarket.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_SIZE = 16 * 1024;

// Allow-listed Polymarket relayer endpoints.
const ALLOWED_PATHS = new Set(["submit", "nonce", "transaction", "deployed"]);

function getContentLength(request: NextRequest): number | null {
  const header = request.headers.get("content-length");
  if (!header) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readBodyWithLimit(
  request: NextRequest,
  maxBytes: number
): Promise<string | null> {
  const body = request.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function authorize(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const { response } = await requireExtensionSession(
      request,
      "relayer:submit"
    );
    return response ?? null;
  }
  return checkOriginAndFetchSite(request) ?? null;
}

async function proxy(
  request: NextRequest,
  pathSegments: string[],
  method: "GET" | "POST"
): Promise<NextResponse> {
  // Layer 1: caller identity
  const authError = await authorize(request);
  if (authError) return authError;

  // Layer 2: rate limit (60/min/IP)
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  // Layer 3a: path allow-list
  const head = pathSegments[0] ?? "";
  if (!ALLOWED_PATHS.has(head)) {
    return NextResponse.json(
      { error: `Path not allowed: /${head}` },
      { status: 400 }
    );
  }

  // Layer 3b: oversize body fast-reject
  const contentLength = getContentLength(request);
  if (contentLength !== null && contentLength > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 }
    );
  }

  // Server config check
  const apiKey = process.env.POLY_RELAYER_API_KEY;
  const apiKeyAddress = process.env.POLY_RELAYER_API_KEY_ADDRESS;
  if (!apiKey || !apiKeyAddress) {
    console.error(
      "[Relayer Proxy] POLY_RELAYER_API_KEY(_ADDRESS) not configured"
    );
    return NextResponse.json(
      { error: "Relayer not configured" },
      { status: 503 }
    );
  }

  // Layer 3c: streamed body with hard byte cap
  let body: string | undefined;
  if (method === "POST") {
    const rawBody = await readBodyWithLimit(request, MAX_BODY_SIZE);
    if (rawBody === null) {
      return NextResponse.json(
        { error: "Request body too large" },
        { status: 413 }
      );
    }
    // Validate JSON shape so we don't forward garbage
    try {
      JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }
    body = rawBody;
  }

  const upstreamUrl = `${UPSTREAM_BASE}/${pathSegments.join("/")}${request.nextUrl.search}`;
  const upstreamHeaders: Record<string, string> = {
    RELAYER_API_KEY: apiKey,
    RELAYER_API_KEY_ADDRESS: apiKeyAddress,
  };
  if (method === "POST") {
    upstreamHeaders["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method,
        headers: upstreamHeaders,
        body,
        signal: controller.signal,
      });
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        console.error("[Relayer Proxy] Upstream timed out");
        return NextResponse.json(
          { error: "Relayer request timed out" },
          { status: 504 }
        );
      }
      throw fetchError;
    }

    const upstreamBody = await upstream.text();
    return new NextResponse(upstreamBody, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("[Relayer Proxy] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path, "GET");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path, "POST");
}
