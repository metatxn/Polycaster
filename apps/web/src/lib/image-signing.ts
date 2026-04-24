import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Must match SIGNATURE_LENGTH in the optimizer Worker. */
const SIGNATURE_LENGTH = 16;

/**
 * HMAC-SHA256 signature of `url|width|quality|type` truncated to
 * SIGNATURE_LENGTH hex chars. 64-bit truncation is plenty for abuse
 * gating — full 256-bit forgery resistance isn't needed here and shorter
 * URLs help CDN cache key hygiene.
 *
 * Payload shape must match the Worker's `verifySignature` exactly,
 * including the trailing `type` field (usually empty — we rely on the
 * optimizer's Accept-header negotiation instead of pinning a format).
 *
 * Pure-JS via @noble/hashes so the same implementation works in Node
 * (SSR render on OpenNext's Node runtime), browsers, and edge workers.
 */
export function signImageUrl(
  src: string,
  width: number,
  quality: number,
  key: string,
  type = ""
): string {
  const payload = `${src}|${width}|${quality}|${type}`;
  const encoder = new TextEncoder();
  const mac = hmac(sha256, encoder.encode(key), encoder.encode(payload));
  return bytesToHex(mac).slice(0, SIGNATURE_LENGTH);
}
