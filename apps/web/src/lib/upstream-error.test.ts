import { describe, expect, it } from "vitest";

import { sanitizeUpstreamBody } from "./upstream-error";

describe("sanitizeUpstreamBody", () => {
  it("returns short, secret-free bodies unchanged", () => {
    expect(sanitizeUpstreamBody('{"error":"not found"}')).toBe(
      '{"error":"not found"}'
    );
  });

  it("returns an empty string for an empty body", () => {
    expect(sanitizeUpstreamBody("")).toBe("");
  });

  it("redacts credential-like JSON values but keeps surrounding context", () => {
    const out = sanitizeUpstreamBody(
      '{"authorization":"Bearer super-secret-token","msg":"bad request"}'
    );
    expect(out).not.toContain("super-secret-token");
    expect(out).toContain("[redacted]");
    // Non-secret context is preserved for debugging.
    expect(out).toContain("bad request");
  });

  it("redacts a range of credential key names in JSON and query form", () => {
    const cases = [
      '{"token":"abc123"}',
      '{"apiKey":"abc123"}',
      '{"signature":"abc123"}',
      '{"passphrase":"abc123"}',
      '{"password":"abc123"}',
      '{"secret":"abc123"}',
      "cookie=abc123&page=2",
    ];
    for (const body of cases) {
      const out = sanitizeUpstreamBody(body);
      expect(out, body).not.toContain("abc123");
      expect(out, body).toContain("[redacted]");
    }
  });

  it("does not over-redact non-secret query parameters", () => {
    const out = sanitizeUpstreamBody("token=abc123&page=2");
    expect(out).toContain("page=2");
    expect(out).not.toContain("abc123");
  });

  it("truncates long bodies and marks how much was dropped", () => {
    const body = "x".repeat(300);
    const out = sanitizeUpstreamBody(body);
    expect(out.length).toBeLessThan(300);
    expect(out).toContain("[+100 chars]");
  });
});
