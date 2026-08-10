import { describe, expect, it } from "vitest";
import { TRUSTED_CLIENT_IP_HEADER, withTrustedClientIp } from "./client-ip";

function withCloudflareMetadata(request: Request): Request {
  Object.defineProperty(request, "cf", { value: { colo: "DEL" } });
  return request;
}

describe("withTrustedClientIp", () => {
  it("overwrites a caller-supplied internal identity at the Worker boundary", () => {
    const request = withCloudflareMetadata(
      new Request("https://knoww.app/api/search", {
        headers: {
          "cf-connecting-ip": "203.0.113.10",
          [TRUSTED_CLIENT_IP_HEADER]: "spoofed",
        },
      })
    );

    const trustedRequest = withTrustedClientIp(request);

    expect(trustedRequest.headers.get(TRUSTED_CLIENT_IP_HEADER)).toBe(
      "203.0.113.10"
    );
  });

  it("removes a caller-supplied identity outside the Cloudflare boundary", () => {
    const request = new Request("https://knoww.app/api/search", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        [TRUSTED_CLIENT_IP_HEADER]: "spoofed",
      },
    });

    const trustedRequest = withTrustedClientIp(request);

    expect(trustedRequest.headers.has(TRUSTED_CLIENT_IP_HEADER)).toBe(false);
  });
});
