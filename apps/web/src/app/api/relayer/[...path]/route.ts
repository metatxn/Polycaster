import { createLogger } from "@knoww/logger";
import { RELAYER_API_ORIGIN } from "@knoww/shared-types/polymarket";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { requireExtensionSession } from "@/lib/auth/extension-session";
import { checkOriginAndFetchSite } from "@/lib/origin-guard";

const log = createLogger("api.relayer");

/**
 * Server-side proxy for Polymarket's V2 Relayer.
 *
 * The web app and extension call this route instead of Polymarket's relayer
 * directly. Secrets stay server-side — they never appear in the browser bundle,
 * extension bundle, or network requests from either client.
 *
 * Flow:
 *   Browser    → POST /api/relayer/{path} → this route → Polymarket relayer/{path}
 *   Extension  → POST /api/relayer/{path} → this route → Polymarket relayer/{path}
 *
 * Auth strategy:
 *   - SAFE-CREATE and WALLET-CREATE deploy requests prefer builder-HMAC
 *     headers, matching the published Polymarket builder SDK's deploy paths,
 *     and fall back to RELAYER_API_KEY auth where the relayer environment
 *     expects V2 key auth.
 *   - All other upstream relayer calls use RELAYER_API_KEY +
 *     RELAYER_API_KEY_ADDRESS headers.
 *
 * Security layers (mirror /api/sign):
 *   1. Origin + Sec-Fetch-Site validation for first-party web requests
 *      — OR — signed extension bearer session for extension requests
 *   2. Per-IP rate limiting (60 req/min — relayer flows are chattier than signing)
 *   3. Body size limit (16 KB — multiSend payloads can be larger than HMAC asks)
 *   4. Request timeout (30 s — relayer can be slower than signing server)
 *
 * Environment variables consumed by this server route:
 *   POLY_RELAYER_API_KEY         – Polymarket V2 relayer API key
 *   POLY_RELAYER_API_KEY_ADDRESS – Address that owns the relayer key
 *   POLY_BUILDER_CODE            – builder attribution code for relayer calls
 *                                  (falls back to NEXT_PUBLIC_POLY_BUILDER_CODE)
 *   BUILDER_SIGNING_SERVER_URL   – signing server for SAFE/WALLET-CREATE
 *   INTERNAL_AUTH_TOKEN          – bearer token for the signing server
 *   EXTENSION_SESSION_SECRET     – extension session signing secret
 */

const UPSTREAM_BASE = RELAYER_API_ORIGIN;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_SIZE = 16 * 1024;

// Allow-listed Polymarket relayer endpoints.
const ALLOWED_PATHS = new Set(["submit", "nonce", "transaction", "deployed"]);

/**
 * Headers returned by the builder signing server. Keys match Polymarket's
 * upstream expectations exactly.
 */
interface BuilderHmacHeaders {
  POLY_BUILDER_API_KEY: string;
  POLY_BUILDER_TIMESTAMP: string;
  POLY_BUILDER_PASSPHRASE: string;
  POLY_BUILDER_SIGNATURE: string;
}

async function getBuilderHmacHeaders(
  method: string,
  path: string,
  body: string
): Promise<BuilderHmacHeaders | null> {
  const signUrl = process.env.BUILDER_SIGNING_SERVER_URL;
  const token = process.env.INTERNAL_AUTH_TOKEN;
  if (!signUrl || !token) {
    log.error("signing.config.missing", {
      reason:
        "BUILDER_SIGNING_SERVER_URL / INTERNAL_AUTH_TOKEN not configured for relayer create auth",
    });
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
      log.error("signing.response.non2xx", {
        status: res.status,
      });
      return null;
    }
    return (await res.json()) as BuilderHmacHeaders;
  } catch (err) {
    log.error("signing.fetch.failed", { err });
    return null;
  }
}

function getRelayerApiKeyHeaders(): Record<string, string> | null {
  const apiKey = process.env.POLY_RELAYER_API_KEY;
  const apiKeyAddress = process.env.POLY_RELAYER_API_KEY_ADDRESS;
  if (!apiKey || !apiKeyAddress) {
    log.error("config.missing", {
      reason: "POLY_RELAYER_API_KEY(_ADDRESS) not configured",
    });
    return null;
  }
  return {
    RELAYER_API_KEY: apiKey,
    RELAYER_API_KEY_ADDRESS: apiKeyAddress,
  };
}

function getBuilderCodeHeaders(): Record<string, string> {
  const builderCode =
    process.env.POLY_BUILDER_CODE ?? process.env.NEXT_PUBLIC_POLY_BUILDER_CODE;
  const trimmedBuilderCode = builderCode?.trim();
  return trimmedBuilderCode ? { "X-Builder-Code": trimmedBuilderCode } : {};
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
    return jsonError(`Path not allowed: /${head}`, 400);
  }

  // Layer 3b: oversize body fast-reject
  const contentLength = getContentLength(request);
  if (contentLength !== null && contentLength > MAX_BODY_SIZE) {
    return jsonError("Request body too large", 413);
  }

  // Layer 3c: streamed body with hard byte cap
  let body: string | undefined;
  let parsedBody: Record<string, unknown> | undefined;
  if (method === "POST") {
    const rawBody = await readBodyWithLimit(request, MAX_BODY_SIZE);
    if (rawBody === null) {
      return jsonError("Request body too large", 413);
    }
    // Validate JSON shape so we don't forward garbage, and keep the parsed
    // form for selecting the correct upstream auth scheme below.
    try {
      parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonError("Invalid JSON payload", 400);
    }
    body = rawBody;
  }

  const upstreamUrl = `${UPSTREAM_BASE}/${pathSegments.join("/")}${request.nextUrl.search}`;
  const submitType =
    method === "POST" &&
    pathSegments[0] === "submit" &&
    parsedBody &&
    typeof parsedBody.type === "string"
      ? parsedBody.type
      : null;
  const safeCreateBody =
    method === "POST" &&
    pathSegments[0] === "submit" &&
    (submitType === "SAFE-CREATE" || submitType === "WALLET-CREATE") &&
    typeof body === "string"
      ? body
      : null;
  const safeSubmitBody =
    method === "POST" &&
    pathSegments[0] === "submit" &&
    (submitType === "SAFE" || submitType === "WALLET") &&
    typeof body === "string"
      ? body
      : null;

  const upstreamHeaders: Record<string, string> = {};
  const builderCodeHeaders = getBuilderCodeHeaders();
  let usedBuilderHmac = false;
  if (method === "POST") {
    upstreamHeaders["Content-Type"] = "application/json";
  }

  if (safeCreateBody !== null) {
    const hmacHeaders = await getBuilderHmacHeaders(
      "POST",
      `/${pathSegments.join("/")}`,
      safeCreateBody
    );
    if (hmacHeaders) {
      Object.assign(upstreamHeaders, hmacHeaders);
      usedBuilderHmac = true;
    } else {
      const apiKeyHeaders = getRelayerApiKeyHeaders();
      if (!apiKeyHeaders) {
        return jsonError("Relayer not configured", 503);
      }
      Object.assign(upstreamHeaders, apiKeyHeaders);
    }
  } else {
    const apiKeyHeaders = getRelayerApiKeyHeaders();
    if (!apiKeyHeaders) {
      return jsonError("Relayer not configured", 503);
    }
    Object.assign(upstreamHeaders, apiKeyHeaders);
  }
  Object.assign(upstreamHeaders, builderCodeHeaders);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let upstream: Response;
    let upstreamBody: string;
    try {
      upstream = await fetch(upstreamUrl, {
        method,
        headers: upstreamHeaders,
        body,
        signal: controller.signal,
      });
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        log.error("upstream.timeout", {
          method,
          path: pathSegments.join("/"),
        });
        return jsonError("Relayer request timed out", 504);
      }
      throw fetchError;
    }

    upstreamBody = await upstream.text();

    if (upstream.status === 400 && safeCreateBody !== null && usedBuilderHmac) {
      log.warn("create.builderHmac.rejected.retryingRelayerKey", {
        path: pathSegments.join("/"),
        status: upstream.status,
        type: submitType,
      });
      const apiKeyHeaders = getRelayerApiKeyHeaders();
      if (apiKeyHeaders) {
        upstream = await fetch(upstreamUrl, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...apiKeyHeaders,
            ...builderCodeHeaders,
          },
          body: safeCreateBody,
          signal: controller.signal,
        });
        upstreamBody = await upstream.text();
      }
    }

    if (upstream.status === 400 && safeSubmitBody !== null) {
      log.warn("safe.relayerKey.rejected.retryingHmac", {
        path: pathSegments.join("/"),
        status: upstream.status,
      });
      const hmacHeaders = await getBuilderHmacHeaders(
        "POST",
        `/${pathSegments.join("/")}`,
        safeSubmitBody
      );
      if (hmacHeaders) {
        upstream = await fetch(upstreamUrl, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...hmacHeaders,
            ...builderCodeHeaders,
          },
          body: safeSubmitBody,
          signal: controller.signal,
        });
        upstreamBody = await upstream.text();
      }
    }

    if (upstream.status < 200 || upstream.status >= 300) {
      log.error("upstream.non2xx", {
        method,
        path: pathSegments.join("/"),
        status: upstream.status,
      });
    }

    return new NextResponse(upstreamBody, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    log.error("proxy.failed", {
      method,
      path: pathSegments.join("/"),
      err: error,
    });
    return jsonError("Internal server error", 500);
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
