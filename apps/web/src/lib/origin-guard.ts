import { type NextRequest, NextResponse } from "next/server";

/**
 * Allowed origins for same-site API requests.
 * Checked in order: env ALLOWED_ORIGIN → env ALLOWED_ORIGINS → hardcoded list.
 */
const ALLOWED_ORIGINS_WHITELIST = [
  "http://localhost:8000",
  "http://localhost:8787",
  "https://knoww.app",
  "https://www.knoww.app",
];

export function isAllowedOrigin(origin: string): boolean {
  const envSingle = process.env.ALLOWED_ORIGIN;
  if (envSingle && origin === envSingle) return true;

  const envList = process.env.ALLOWED_ORIGINS;
  if (envList) {
    const origins = envList.split(",").map((o) => o.trim());
    if (origins.includes(origin)) return true;
  }

  return ALLOWED_ORIGINS_WHITELIST.includes(origin);
}

/**
 * Validate that an API request originates from our own app running in a
 * real browser on the same origin. Returns a 403 NextResponse if the
 * request fails validation, or `null` if it passes.
 *
 * Two independent checks:
 *
 * 1. **Origin / Referer** — browsers always send `Origin` on same-origin
 *    POST requests. The value must match our allowed domains.
 *
 * 2. **Sec-Fetch-Site** — a browser-controlled header that CANNOT be set
 *    or forged by JavaScript. `same-origin` proves the request was issued
 *    by our own page. This blocks curl, Postman, and cross-origin scripts.
 *    Skipped when the header is absent (older browsers / non-browser dev
 *    tools in dev mode).
 */
export function checkOriginAndFetchSite(
  request: NextRequest
): NextResponse | null {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const secFetchSite = request.headers.get("sec-fetch-site");

  // --- Check 1: Origin (with Referer fallback) ---
  const effectiveOrigin = origin ?? (referer ? new URL(referer).origin : null);

  if (!effectiveOrigin || !isAllowedOrigin(effectiveOrigin)) {
    return NextResponse.json(
      { error: "Forbidden: origin not allowed" },
      { status: 403 }
    );
  }

  // --- Check 2: Sec-Fetch-Site (browser-controlled, unforgeable) ---
  // In production, require same-origin. In dev, allow missing header
  // so that tools like Postman/curl still work locally.
  if (secFetchSite !== null) {
    if (secFetchSite !== "same-origin") {
      return NextResponse.json(
        { error: "Forbidden: cross-site request" },
        { status: 403 }
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    // Modern browsers always send Sec-Fetch-Site. Its absence in
    // production means the request is from a non-browser client.
    return NextResponse.json(
      { error: "Forbidden: missing fetch metadata" },
      { status: 403 }
    );
  }

  return null;
}
