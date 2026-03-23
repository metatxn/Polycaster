/**
 * Shared cryptographic utilities.
 *
 * Uses the Web Crypto API (SubtleCrypto) which is available in browsers,
 * service workers, Node.js 18+, and Cloudflare Workers.
 *
 * Type declarations below keep this file self-contained so it compiles
 * under any tsconfig lib setting (no DOM dependency required).
 */

declare const crypto: {
  subtle: {
    importKey(
      format: "raw",
      keyData: ArrayBufferLike | ArrayLike<number>,
      algorithm: { name: string; hash: string },
      extractable: boolean,
      keyUsages: string[]
    ): Promise<CryptoKey>;
    sign(
      algorithm: string,
      key: CryptoKey,
      data: ArrayBufferLike | ArrayLike<number>
    ): Promise<ArrayBuffer>;
  };
};

declare class TextEncoder {
  encode(input: string): Uint8Array;
}

type CryptoKey = {};

/**
 * Compute an HMAC-SHA256 hex digest.
 *
 * @param secret  - The HMAC key (plain string)
 * @param message - The message to authenticate
 * @returns lowercase hex-encoded HMAC signature
 */
export async function computeHmacHex(
  secret: string,
  message: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
