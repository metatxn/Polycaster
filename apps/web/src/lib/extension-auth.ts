import { type NextRequest, NextResponse } from "next/server";
import {
  type ExtensionScope,
  requireExtensionSession,
} from "@/lib/auth/extension-session";

export const ALLOWED_EXTENSION_ORIGINS = [
  "chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc",
  "chrome-extension://naoaonihikedoiemhbolbnolibpmojgf",
  "chrome-extension://cefhmagobkjigobnmhnhldofoangmhei", // dev-environment build of the extension — keep
];

const ALLOWED_REFERER_HOSTS = new Set(["knoww.app", "www.knoww.app"]);

const ALLOWED_ORIGINS_SET = new Set(ALLOWED_EXTENSION_ORIGINS);

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS_SET.has(origin)) return true;
  if (
    process.env.NODE_ENV === "development" &&
    origin.startsWith("chrome-extension://")
  ) {
    return true;
  }
  return false;
}

/**
 * Build CORS headers for a validated chrome-extension origin.
 * Returns an empty object when the origin is not allowed.
 */
export function extensionCorsHeaders(
  request: NextRequest
): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !isOriginAllowed(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Standard OPTIONS handler for routes called by the extension.
 */
export function handleExtensionPreflight(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  if (!origin || !isOriginAllowed(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: extensionCorsHeaders(request),
  });
}

export function isRefererAllowed(referer: string | null): boolean {
  if (!referer) return false;
  try {
    const url = new URL(referer);
    return url.protocol === "https:" && ALLOWED_REFERER_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Verify that a request comes from the Knoww extension.
 *
 * This gate is intentionally low-trust and should only be used for routes
 * that are safe to expose to installed extension contexts.
 *
 * Privileged routes like `/api/sign` must use bearer-authenticated sessions
 * instead of relying on Origin / Referer.
 */
export async function verifyExtensionRequest(
  request: NextRequest
): Promise<NextResponse | null> {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (isOriginAllowed(origin) || isRefererAllowed(referer)) {
    return null;
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export interface ExtensionPreAuthResult {
  /** Non-null means the request must be rejected with this response. */
  response: NextResponse | null;
}

/**
 * Verify signed extension-session access for paid AI endpoints.
 *
 * Origin and Referer are CORS signals, not authentication: non-browser clients
 * can forge both. Production callers must therefore present a valid Bearer
 * session with the route's required scope before any paid generation occurs.
 */
export async function verifyExtensionAccessPreAuth(
  request: NextRequest,
  requiredScope: ExtensionScope
): Promise<ExtensionPreAuthResult> {
  if (process.env.NODE_ENV === "development") {
    return { response: null };
  }

  const { response } = await requireExtensionSession(request, requiredScope);
  return { response };
}
