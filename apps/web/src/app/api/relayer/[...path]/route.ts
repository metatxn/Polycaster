import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { requireExtensionSession } from "@/lib/auth/extension-session";
import { checkOriginAndFetchSite } from "@/lib/origin-guard";

/**
 * Server-side proxy for Polymarket's V2 Relayer.
 *
 * The web app and extension call this route instead of relayer-v2.polymarket.com
 * directly. Secrets stay server-side — they never appear in the browser bundle,
 * extension bundle, or network requests from either client.
 *
 * Flow:
 *   Browser    → POST /api/relayer/{path} → this route → relayer-v2.polymarket.com/{path}
 *   Extension  → POST /api/relayer/{path} → this route → relayer-v2.polymarket.com/{path}
 *
 * Auth strategy (picked per request type):
 *   - `type: "SAFE-CREATE"` or `type: "SAFE"` on POST /submit → builder signing
 *     server produces POLY_BUILDER_* HMAC headers for the upstream request.
 *     The v2 relayer rejects these with an opaque 400 "bad request" when only
 *     RELAYER_API_KEY is sent (verified for SAFE-CREATE on the wire; SAFE batch
 *     submits match the same failure mode as of Apr 2026).
 *   - Other submits (e.g. PROXY) and all GETs → RELAYER_API_KEY +
 *     RELAYER_API_KEY_ADDRESS headers.
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
 *   BUILDER_SIGNING_SERVER_URL   – upstream signing server (signing.knoww.app/sign)
 *   INTERNAL_AUTH_TOKEN          – bearer token for the signing server
 *   EXTENSION_SESSION_SECRET     – extension session signing secret
 */

const UPSTREAM_BASE = "https://relayer-v2.polymarket.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_SIZE = 16 * 1024;

// Allow-listed Polymarket relayer endpoints.
const ALLOWED_PATHS = new Set(["submit", "nonce", "transaction", "deployed"]);

/**
 * Headers returned by the builder signing server. Keys match Polymarket's
 * upstream expectations exactly — don't lowercase or rename them.
 */
interface BuilderHmacHeaders {
  POLY_BUILDER_API_KEY: string;
  POLY_BUILDER_TIMESTAMP: string;
  POLY_BUILDER_PASSPHRASE: string;
  POLY_BUILDER_SIGNATURE: string;
}

/**
 * Fetch HMAC headers from the signing server for a specific (method, path, body)
 * triple. Returns `null` if the signing server is misconfigured or rejects us,
 * so callers can surface a clean 503 instead of a blind 500.
 *
 * The signing server computes: HMAC-SHA256(secret, timestamp + method + path + body)
 * and returns the full POLY_BUILDER_* header quad.
 */
async function getBuilderHmacHeaders(
  method: string,
  path: string,
  body: string
): Promise<BuilderHmacHeaders | null> {
  const signUrl = process.env.BUILDER_SIGNING_SERVER_URL;
  const token = process.env.INTERNAL_AUTH_TOKEN;
  if (!signUrl || !token) {
    console.error(
      "[Relayer Proxy] BUILDER_SIGNING_SERVER_URL / INTERNAL_AUTH_TOKEN not configured — cannot sign SAFE / SAFE-CREATE"
    );
    return null;
  }

  try {
    const res = await fetch(signUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method, path, body }),
    });
    if (!res.ok) {
      console.error(
        "[Relayer Proxy] signing server returned non-2xx:",
        res.status,
        await res.text().catch(() => "")
      );
      return null;
    }
    return (await res.json()) as BuilderHmacHeaders;
  } catch (err) {
    console.error("[Relayer Proxy] signing server fetch failed:", err);
    return null;
  }
}

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
  let parsedBody: Record<string, unknown> | undefined;
  if (method === "POST") {
    const rawBody = await readBodyWithLimit(request, MAX_BODY_SIZE);
    if (rawBody === null) {
      return NextResponse.json(
        { error: "Request body too large" },
        { status: 413 }
      );
    }
    // Validate JSON shape so we don't forward garbage, and keep the parsed
    // form for the builder-HMAC submit detection below.
    try {
      parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }
    body = rawBody;
  }

  const upstreamUrl = `${UPSTREAM_BASE}/${pathSegments.join("/")}${request.nextUrl.search}`;
  const upstreamHeaders: Record<string, string> = {};
  if (method === "POST") {
    upstreamHeaders["Content-Type"] = "application/json";
  }

  // Auth strategy: SAFE and SAFE-CREATE submits require builder HMAC auth.
  // RELAYER_API_KEY alone returns opaque 400 "bad request" (see proxy logs).
  const submitType =
    method === "POST" &&
    pathSegments[0] === "submit" &&
    parsedBody &&
    typeof parsedBody.type === "string"
      ? parsedBody.type
      : null;
  const needsBuilderHmac =
    method === "POST" &&
    pathSegments[0] === "submit" &&
    typeof body === "string" &&
    (submitType === "SAFE-CREATE" || submitType === "SAFE");

  if (needsBuilderHmac) {
    const hmacHeaders = await getBuilderHmacHeaders(
      "POST",
      `/${pathSegments.join("/")}`,
      body as string
    );
    if (!hmacHeaders) {
      return NextResponse.json(
        { error: "Signing service unavailable for relayer submit" },
        { status: 503 }
      );
    }
    Object.assign(upstreamHeaders, hmacHeaders);
  } else {
    upstreamHeaders.RELAYER_API_KEY = apiKey;
    upstreamHeaders.RELAYER_API_KEY_ADDRESS = apiKeyAddress;
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

    if (upstream.status < 200 || upstream.status >= 300) {
      console.error(
        "[Relayer Proxy] Upstream non-2xx:",
        method,
        pathSegments.join("/"),
        upstream.status,
        upstreamBody.slice(0, 500)
      );
    }

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
