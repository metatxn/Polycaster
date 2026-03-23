import { type NextRequest, NextResponse } from "next/server";
import {
  type ExtensionScope,
  requireExtensionSession,
} from "@/lib/auth/extension-session";

export const ALLOWED_EXTENSION_ORIGINS = [
  "chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc",
  "chrome-extension://naoaonihikedoiemhbolbnolibpmojgf",
  "chrome-extension://cefhmagobkjigobnmhnhldofoangmhei", // remove this later
];

const ALLOWED_REFERER_HOSTS = new Set(["knoww.app", "www.knoww.app"]);

const ALLOWED_ORIGINS_SET = new Set(ALLOWED_EXTENSION_ORIGINS);

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS_SET.has(origin);
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

export async function verifyExtensionAccess(
  request: NextRequest,
  requiredScope: ExtensionScope
): Promise<NextResponse | null> {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const { response } = await requireExtensionSession(request, requiredScope);
    return response;
  }

  return verifyExtensionRequest(request);
}
