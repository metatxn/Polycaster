import assert from "node:assert/strict";
import test from "node:test";
import { decodeExtensionSessionAddress } from "../../src/background/extension-session-token";

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeToken(claims: Record<string, unknown>, segments = 3): string {
  const payload = base64Url(JSON.stringify(claims));
  if (segments === 2) return `${payload}.sig`;
  return `header.${payload}.sig`;
}

test("decodeExtensionSessionAddress extracts a 0x sub from a 3-part token", () => {
  const token = makeToken({
    sub: "0xAbC0000000000000000000000000000000000001",
  });
  assert.equal(
    decodeExtensionSessionAddress(token),
    "0xAbC0000000000000000000000000000000000001"
  );
});

test("decodeExtensionSessionAddress reads the first segment of a 2-part token", () => {
  const token = makeToken({ sub: "0xdef" }, 2);
  assert.equal(decodeExtensionSessionAddress(token), "0xdef");
});

test("decodeExtensionSessionAddress returns null for a non-address sub", () => {
  assert.equal(
    decodeExtensionSessionAddress(makeToken({ sub: "alice" })),
    null
  );
});

test("decodeExtensionSessionAddress returns null for null / malformed tokens", () => {
  assert.equal(decodeExtensionSessionAddress(null), null);
  assert.equal(decodeExtensionSessionAddress("not-a-jwt"), null);
  assert.equal(decodeExtensionSessionAddress("a.!!!notbase64!!!.c"), null);
});
