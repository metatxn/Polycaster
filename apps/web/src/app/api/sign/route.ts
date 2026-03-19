import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
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
 *   1. Origin + Sec-Fetch-Site validation (blocks external / cross-origin callers)
 *      — OR —  HMAC authentication (for Chrome extension requests)
 *   2. Per-IP rate limiting (30 req/min)
 *   3. Body size limit (10 KB)
 *   4. Request timeout (15 s)
 *
 * Environment variables (server-only, NO NEXT_PUBLIC_ prefix):
 *   BUILDER_SIGNING_SERVER_URL – the upstream signing server URL
 *   INTERNAL_AUTH_TOKEN         – bearer token for the signing server
 *   KNOWW_EXTENSION_SECRET      – shared HMAC secret with the Chrome extension
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_SIZE = 10 * 1024;

function getUpstreamUrl(): string | null {
  return process.env.BUILDER_SIGNING_SERVER_URL || null;
}

function getAuthToken(): string | null {
  return process.env.INTERNAL_AUTH_TOKEN || null;
}

/**
 * Verify an HMAC-signed request from the Chrome extension.
 * Returns true if the signature matches, false otherwise.
 */
async function verifyExtensionHmac(
  request: NextRequest,
  rawBody: string
): Promise<boolean> {
  const secret = process.env.KNOWW_EXTENSION_SECRET;
  if (!secret) return false;

  const signature = request.headers.get("X-Knoww-Signature");
  const timestamp = request.headers.get("X-Knoww-Timestamp");
  if (!signature || !timestamp) return false;

  // Reject timestamps older than 5 minutes
  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const message = `${timestamp}:${rawBody}`;
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const expected = Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

  return expected === signature;
}

export async function POST(request: NextRequest) {
  // Read body early so we can use it for both HMAC check and forwarding.
  // We clone the request to avoid consuming the body stream.
  const rawBody = await request.text();

  // Layer 1: Verify caller identity.
  // First check for extension HMAC auth (X-Knoww-Signature header).
  // Falls back to same-origin check for web app requests.
  const isExtensionRequest = await verifyExtensionHmac(request, rawBody);
  if (!isExtensionRequest) {
    const originResponse = checkOriginAndFetchSite(request);
    if (originResponse) return originResponse;
  }

  // Layer 2: Rate limit — 30 requests per minute per IP
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const upstreamUrl = getUpstreamUrl();
  if (!upstreamUrl) {
    console.error("[Sign Proxy] BUILDER_SIGNING_SERVER_URL is not configured");
    return NextResponse.json(
      { error: "Signing service not configured" },
      { status: 503 }
    );
  }

  if (rawBody.length > MAX_BODY_SIZE) {
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
