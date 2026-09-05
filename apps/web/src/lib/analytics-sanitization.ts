import { getAddress } from "viem";

const SENSITIVE_PROPERTY_KEYS = new Set([
  "address",
  "authorization",
  "apikey",
  "apisecret",
  "apipassphrase",
  "privatekey",
  "seedphrase",
  "password",
  "credentials",
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
]);
const SENSITIVE_PROPERTY_SUFFIXES = ["address", "path", "token", "url"];

type AnalyticsPropertyValue = string | number | boolean | null;

function normalizePropertyKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, AnalyticsPropertyValue>
): Record<string, AnalyticsPropertyValue> {
  const sanitized: Record<string, AnalyticsPropertyValue> = {};

  for (const [key, value] of Object.entries(properties)) {
    const normalizedKey = normalizePropertyKey(key);

    if (normalizedKey === "walletaddress") {
      if (typeof value !== "string") continue;
      try {
        sanitized.wallet_address = getAddress(value);
      } catch {
        // Invalid or incorrectly checksummed addresses do not reach analytics.
      }
      continue;
    }

    if (
      SENSITIVE_PROPERTY_KEYS.has(normalizedKey) ||
      SENSITIVE_PROPERTY_SUFFIXES.some((suffix) =>
        normalizedKey.endsWith(suffix)
      )
    ) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
