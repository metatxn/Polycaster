const SENSITIVE_PROPERTY_KEYS = new Set([
  "address",
  "authorization",
  "body",
  "challengetoken",
  "message",
  "pagetext",
  "pageurl",
  "posttext",
  "query",
  "searchquery",
  "signature",
  "token",
  "url",
  "walletaddress",
]);
const SENSITIVE_PROPERTY_SUFFIXES = ["address", "path", "token", "url"];

function normalizePropertyKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export function sanitizeAnalyticsProperties<T>(
  properties: Record<string, T>
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => {
      const normalizedKey = normalizePropertyKey(key);
      return (
        !SENSITIVE_PROPERTY_KEYS.has(normalizedKey) &&
        !SENSITIVE_PROPERTY_SUFFIXES.some((suffix) =>
          normalizedKey.endsWith(suffix)
        )
      );
    })
  );
}
