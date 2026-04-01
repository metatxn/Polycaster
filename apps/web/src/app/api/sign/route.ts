import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { requireExtensionSession } from "@/lib/auth/extension-session";
import { checkOriginAndFetchSite } from "@/lib/origin-guard";

/**
 * Server-side proxy for the Builder Signing Server.
 *
 * The Polymarket SDK on the client calls this route instead of the external
 * signing server directly. This keeps the auth token entirely server-side
 * so it never appears in the browser's network tab or JS bundle.
 *
 * Flow:
 *   SDK (browser)   → POST /api/sign → this route → signing.knoww.app/sign
 *   Extension (BG)  → POST /api/sign → this route → signing.knoww.app/sign
 *
 * Security layers:
 *   1. Origin + Sec-Fetch-Site validation for first-party web requests
 *      — OR —  signed extension bearer session for extension requests
 *   2. Per-IP rate limiting (30 req/min)
 *   3. Body size limit (10 KB)
 *   4. Request timeout (15 s)
 *
 * Environment variables (server-only, NO NEXT_PUBLIC_ prefix):
 *   BUILDER_SIGNING_SERVER_URL – the upstream signing server URL
 *   INTERNAL_AUTH_TOKEN         – bearer token for the signing server
 *   EXTENSION_SESSION_SECRET    – extension session signing secret
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_SIZE = 10 * 1024;

function getContentLength(request: NextRequest): number | null {
  const header = request.headers.get("content-length");
  if (!header) return null;

  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Read the request body with a hard byte-size limit.
 * Unlike `request.text()`, this streams the body and aborts as soon as the
 * limit is exceeded — so a missing or spoofed Content-Length header can't
 * force the Worker to buffer an arbitrarily large payload.
 */
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

function getUpstreamUrl(): string | null {
  return process.env.BUILDER_SIGNING_SERVER_URL || null;
}

function getAuthToken(): string | null {
  return process.env.INTERNAL_AUTH_TOKEN || null;
}

export async function POST(request: NextRequest) {
  // Layer 1: Verify caller identity.
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const { response } = await requireExtensionSession(request, "builder:sign");
    if (response) return response;
  } else {
    const originResponse = checkOriginAndFetchSite(request);
    if (originResponse) return originResponse;
  }

  // Layer 2: Rate limit — 30 requests per minute per IP
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) return rateLimitResponse;

  // Layer 3a: Reject obviously oversized payloads before touching the body
  const contentLength = getContentLength(request);
  if (contentLength !== null && contentLength > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 }
    );
  }

  const upstreamUrl = getUpstreamUrl();
  if (!upstreamUrl) {
    console.error("[Sign Proxy] BUILDER_SIGNING_SERVER_URL is not configured");
    return NextResponse.json(
      { error: "Signing service not configured" },
      { status: 503 }
    );
  }

  // Layer 3b: Stream the body with a hard byte cap — defends against
  // missing or spoofed Content-Length headers.
  const rawBody = await readBodyWithLimit(request, MAX_BODY_SIZE);
  if (rawBody === null) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const authToken = getAuthToken();
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    let response: Response;
    try {
      response = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        console.error("[Sign Proxy] Upstream request timed out");
        return NextResponse.json(
          { error: "Signing request timed out" },
          { status: 504 }
        );
      }
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.error(
        "[Sign Proxy] Upstream error:",
        response.status,
        response.statusText
      );
      return NextResponse.json(
        { error: `Signing request failed: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Sign Proxy] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
