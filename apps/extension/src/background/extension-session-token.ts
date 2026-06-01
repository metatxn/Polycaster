/**
 * Pure decoders for the extension session token (a signed JWT-like token issued
 * by knoww.app). These run inside the background worker so the raw token never
 * needs to be handed to content/UI surfaces just to read the wallet address
 * out of it — callers ask the worker for derived session info instead.
 */

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  return atob(padded);
}

function getExtensionSessionPayloadSegment(token: string): string | null {
  const parts = token.split(".");
  if (parts.length === 2) return parts[0];
  if (parts.length >= 3) return parts[1];
  return null;
}

export function decodeExtensionSessionAddress(
  token: string | null
): string | null {
  if (!token) return null;
  const payload = getExtensionSessionPayloadSegment(token);
  if (!payload) return null;

  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as { sub?: unknown };
    return typeof claims.sub === "string" &&
      claims.sub.toLowerCase().startsWith("0x")
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}
