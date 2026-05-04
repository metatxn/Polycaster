import { sha256, stringToBytes } from "viem";

type DigestEncoding = "base64" | "hex";
type ByteArray = Uint8Array<ArrayBufferLike>;

function toBytes(value: string | ByteArray): ByteArray {
  if (typeof value === "string") return stringToBytes(value);
  return value;
}

function concatBytes(...arrays: ByteArray[]): ByteArray {
  const length = arrays.reduce((sum, item) => sum + item.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const item of arrays) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
}

function toBase64(bytes: ByteArray): string {
  return Buffer.from(bytes).toString("base64");
}

function hmacSha256(key: ByteArray, message: ByteArray): ByteArray {
  const blockSize = 64;
  let normalizedKey = key;
  if (normalizedKey.length > blockSize) {
    normalizedKey = sha256(normalizedKey, "bytes");
  }

  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(normalizedKey);

  const outerPad = new Uint8Array(blockSize);
  const innerPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i += 1) {
    outerPad[i] = paddedKey[i] ^ 0x5c;
    innerPad[i] = paddedKey[i] ^ 0x36;
  }

  const innerHash = sha256(concatBytes(innerPad, message), "bytes");
  return sha256(concatBytes(outerPad, innerHash), "bytes");
}

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

function sha1(bytes: ByteArray): ByteArray {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 80; i += 1) {
      words[i] = rotateLeft(
        words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16],
        1
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (rotateLeft(a, 5) + f + e + k + words[i]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30) >>> 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const output = new Uint8Array(20);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, h0);
  outputView.setUint32(4, h1);
  outputView.setUint32(8, h2);
  outputView.setUint32(12, h3);
  outputView.setUint32(16, h4);
  return output;
}

export function createHmac(
  algorithm: string,
  key: string | ByteArray
): {
  update: (data: string | ByteArray) => {
    digest: (encoding: DigestEncoding) => string;
  };
  digest: (encoding: DigestEncoding) => string;
} {
  if (algorithm.toLowerCase() !== "sha256") {
    throw new Error(`Unsupported HMAC algorithm: ${algorithm}`);
  }

  let message: ByteArray = new Uint8Array();
  return {
    update(data: string | ByteArray) {
      message = concatBytes(message, toBytes(data));
      return this;
    },
    digest(encoding: DigestEncoding) {
      const digest = hmacSha256(toBytes(key), message);
      if (encoding === "base64") return toBase64(digest);
      if (encoding === "hex") return Buffer.from(digest).toString("hex");
      throw new Error(`Unsupported digest encoding: ${encoding}`);
    },
  };
}

export function createHash(algorithm: string): {
  update: (data: string | ByteArray) => {
    digest: (encoding: DigestEncoding) => string;
  };
  digest: (encoding: DigestEncoding) => string;
} {
  let message: ByteArray = new Uint8Array();
  return {
    update(data: string | ByteArray) {
      message = concatBytes(message, toBytes(data));
      return this;
    },
    digest(encoding: DigestEncoding) {
      const normalized = algorithm.toLowerCase();
      let digest: ByteArray;
      if (normalized === "sha256") {
        digest = sha256(message, "bytes");
      } else if (normalized === "sha1") {
        digest = sha1(message);
      } else {
        throw new Error(`Unsupported hash algorithm: ${algorithm}`);
      }
      if (encoding === "base64") return toBase64(digest);
      if (encoding === "hex") return Buffer.from(digest).toString("hex");
      throw new Error(`Unsupported digest encoding: ${encoding}`);
    },
  };
}

export default { createHash, createHmac };
