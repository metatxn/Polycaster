import { computeHmacHex } from "@knoww/shared-types/crypto";
import { type NextRequest, NextResponse } from "next/server";

const MAX_TIMESTAMP_DRIFT_MS = 60_000;

const ALLOWED_ORIGINS = [
  "chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc",
  "chrome-extension://naoaonihikedoiemhbolbnolibpmojgf",
  "chrome-extension://cefhmagobkjigobnmhnhldofoangmhei", // remove this later
];

const ALLOWED_REFERER_HOSTS = new Set(["knoww.app", "www.knoww.app"]);

const ALLOWED_ORIGINS_SET = new Set(ALLOWED_ORIGINS);

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS_SET.has(origin);
}

function isRefererAllowed(referer: string | null): boolean {
  if (!referer) return false;
  try {
    const url = new URL(referer);
    return url.protocol === "https:" && ALLOWED_REFERER_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const len = Math.max(bufA.byteLength, bufB.byteLength);
  let diff = bufA.byteLength ^ bufB.byteLength;
  for (let i = 0; i < len; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Verify that a request comes from the Knoww extension.
 *
 * Authentication paths (checked in order):
 *   1. **HMAC signature** — if X-Knoww-Signature / X-Knoww-Timestamp headers
 *      are present, verify the HMAC. This is the primary auth path for
 *      extension background service workers (which may not send an Origin).
 *   2. **Origin / Referer** — for browser-originated same-site requests that
 *      don't carry HMAC headers (e.g. first-party knoww.app pages).
 *
 * Returns null if the request is authentic, or a NextResponse (401/403/500)
 * to short-circuit the handler.
 */
export async function verifyExtensionRequest(
  request: NextRequest
): Promise<NextResponse | null> {
  const signature = request.headers.get("x-knoww-signature");
  const timestamp = request.headers.get("x-knoww-timestamp");

  // Path 1: HMAC authentication (extension service worker requests)
  if (signature && timestamp) {
    const secret = process.env.KNOWW_EXTENSION_SECRET;
    if (!secret) {
      console.error(
        "[extension-auth] KNOWW_EXTENSION_SECRET is not configured — rejecting request"
      );
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 }
      );
    }

    const ts = Number(timestamp);
    if (
      Number.isNaN(ts) ||
      Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS
    ) {
      return NextResponse.json({ error: "Request expired" }, { status: 401 });
    }

    const bodyText = await request.clone().text();
    const message = `${timestamp}:${bodyText}`;
    const expected = await computeHmacHex(secret, message);

    if (!timingSafeEqual(signature, expected)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    return null;
  }

  // Path 2: Origin / Referer gate (same-site browser requests)
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (isOriginAllowed(origin) || isRefererAllowed(referer)) {
    return null;
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
