import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/auth/extension-session", () => ({
  requireExtensionSession: vi.fn(async () => ({ response: null })),
}));

vi.mock("@/lib/origin-guard", () => ({
  checkOriginAndFetchSite: vi.fn(() => null),
}));

import { POST } from "./route";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/relayer/[...path]", () => {
  it("rejects extra path segments before attaching relayer credentials", async () => {
    process.env.POLY_RELAYER_API_KEY = "relayer-key";
    process.env.POLY_RELAYER_API_KEY_ADDRESS =
      "0x0000000000000000000000000000000000000001";

    const upstreamFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ transactionID: "tx-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/relayer/submit/anything",
      {
        method: "POST",
        body: JSON.stringify({
          type: "SAFE",
          transactions: [],
        }),
      }
    );

    const res = await POST(req, {
      params: Promise.resolve({ path: ["submit", "anything"] }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Path not allowed");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("forwards the configured builder code to Polymarket relayer submit requests", async () => {
    process.env.POLY_RELAYER_API_KEY = "relayer-key";
    process.env.POLY_RELAYER_API_KEY_ADDRESS =
      "0x0000000000000000000000000000000000000001";
    process.env.NEXT_PUBLIC_POLY_BUILDER_CODE = "0xbuilder";

    const upstreamFetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        return new Response(JSON.stringify({ transactionID: "tx-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest("https://knoww.app/api/relayer/submit", {
      method: "POST",
      body: JSON.stringify({
        type: "SAFE",
        transactions: [],
      }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ path: ["submit"] }),
    });

    expect(res.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const init = upstreamFetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      RELAYER_API_KEY: "relayer-key",
      RELAYER_API_KEY_ADDRESS: "0x0000000000000000000000000000000000000001",
      "X-Builder-Code": "0xbuilder",
    });
  });

  it("does not fall back to relayer key auth for create requests when builder auth is unavailable", async () => {
    process.env.POLY_RELAYER_API_KEY = "relayer-key";
    process.env.POLY_RELAYER_API_KEY_ADDRESS =
      "0x0000000000000000000000000000000000000001";
    delete process.env.BUILDER_SIGNING_SERVER_URL;
    delete process.env.INTERNAL_AUTH_TOKEN;

    const upstreamFetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        return new Response(JSON.stringify({ transactionID: "tx-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest("https://knoww.app/api/relayer/submit", {
      method: "POST",
      body: JSON.stringify({
        type: "WALLET-CREATE",
        from: "0x0000000000000000000000000000000000000002",
      }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ path: ["submit"] }),
    });

    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Relayer create auth not configured");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("does not retry create requests with relayer key auth after builder auth is rejected", async () => {
    process.env.POLY_RELAYER_API_KEY = "relayer-key";
    process.env.POLY_RELAYER_API_KEY_ADDRESS =
      "0x0000000000000000000000000000000000000001";
    process.env.BUILDER_SIGNING_SERVER_URL = "https://signer.knoww.test/hmac";
    process.env.INTERNAL_AUTH_TOKEN = "internal-token";

    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        if (String(input) === "https://signer.knoww.test/hmac") {
          return new Response(
            JSON.stringify({
              POLY_BUILDER_API_KEY: "builder-key",
              POLY_BUILDER_TIMESTAMP: "1",
              POLY_BUILDER_PASSPHRASE: "builder-passphrase",
              POLY_BUILDER_SIGNATURE: "builder-signature",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        return new Response(
          JSON.stringify({
            error:
              "from 0x0000000000000000000000000000000000000002 does not match auth 0x0000000000000000000000000000000000000001",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest("https://knoww.app/api/relayer/submit", {
      method: "POST",
      body: JSON.stringify({
        type: "SAFE-CREATE",
        from: "0x0000000000000000000000000000000000000002",
      }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ path: ["submit"] }),
    });
    const body = await res.text();

    expect(res.status).toBe(400);
    expect(body).toContain("Relayer create request rejected");
    expect(body).not.toContain("0x0000000000000000000000000000000000000001");
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(upstreamFetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      POLY_BUILDER_API_KEY: "builder-key",
    });
    expect(upstreamFetch.mock.calls[1]?.[1]?.headers).not.toMatchObject({
      RELAYER_API_KEY_ADDRESS: "0x0000000000000000000000000000000000000001",
    });
  });

  it("returns a timeout when the safe submit HMAC retry is aborted", async () => {
    process.env.POLY_RELAYER_API_KEY = "relayer-key";
    process.env.POLY_RELAYER_API_KEY_ADDRESS =
      "0x0000000000000000000000000000000000000001";
    process.env.BUILDER_SIGNING_SERVER_URL = "https://signer.knoww.test/hmac";
    process.env.INTERNAL_AUTH_TOKEN = "internal-token";

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    let relayerAttempts = 0;
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        if (String(input) === "https://signer.knoww.test/hmac") {
          return new Response(
            JSON.stringify({
              POLY_BUILDER_API_KEY: "builder-key",
              POLY_BUILDER_TIMESTAMP: "1",
              POLY_BUILDER_PASSPHRASE: "builder-passphrase",
              POLY_BUILDER_SIGNATURE: "builder-signature",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        relayerAttempts += 1;
        if (relayerAttempts === 1) {
          return new Response(
            JSON.stringify({ error: "relayer key rejected" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        throw abortError;
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest("https://knoww.app/api/relayer/submit", {
      method: "POST",
      body: JSON.stringify({
        type: "SAFE",
        transactions: [],
      }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ path: ["submit"] }),
    });
    const body = await res.text();

    expect(res.status).toBe(504);
    expect(body).toContain("Relayer request timed out");
    expect(upstreamFetch).toHaveBeenCalledTimes(3);
  });
});
