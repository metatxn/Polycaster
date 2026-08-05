import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/origin-guard", () => ({
  isAllowedOrigin: vi.fn(() => true),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://knoww.app/api/rpc/polygon", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "https://knoww.app",
    },
    body: JSON.stringify(body),
  });
}

function rpcCall(method: string, id = 1, params: unknown[] = []) {
  return { jsonrpc: "2.0", id, method, params };
}

/** A response whose streamed body exceeds the given byte count. */
function oversizedStreamResponse(totalBytes: number): Response {
  const chunk = new Uint8Array(64 * 1024);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/rpc/polygon", () => {
  it("rejects an empty JSON-RPC batch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest([]));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects batches above the batch item cap", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const batch = Array.from({ length: 11 }, (_, i) =>
      rpcCall("eth_blockNumber", i)
    );
    const res = await POST(makeRequest(batch));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("max 10");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks write methods without contacting any upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest(rpcCall("eth_sendRawTransaction")));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks methods outside the read allowlist by default", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // eth_getLogs is deliberately excluded: no browser flow needs it and an
    // unbounded range can force multi-megabyte upstream responses.
    // eth_getProof / eth_getBlockReceipts / eth_syncing were trimmed from the
    // allowlist because no application flow calls them — each extra method is
    // free Worker/provider quota for anyone who finds the proxy.
    for (const method of [
      "evm_mine",
      "debug_traceCall",
      "eth_newFilter",
      "eth_getLogs",
      "eth_getProof",
      "eth_getBlockReceipts",
      "eth_syncing",
      "web3_clientVersion",
    ]) {
      const res = await POST(makeRequest(rpcCall(method)));
      expect(res.status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects requests with a missing method", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ jsonrpc: "2.0", id: 1 }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies a valid request and returns the upstream payload", async () => {
    const upstream = { jsonrpc: "2.0", id: 1, result: "0x1234" };
    const fetchMock = vi.fn(async () => Response.json(upstream));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest(rpcCall("eth_blockNumber")));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstream);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects full-transaction block lookups before contacting upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      makeRequest(rpcCall("eth_getBlockByNumber", 1, ["latest", true]))
    );
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid params");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an excessive fee-history range before contacting upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      makeRequest(rpcCall("eth_feeHistory", 1, ["0x1000", "latest", [50]]))
    );
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid params");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a bounded fee-history request", async () => {
    const upstream = {
      jsonrpc: "2.0",
      id: 1,
      result: { oldestBlock: "0x1", baseFeePerGas: ["0x1"] },
    };
    const fetchMock = vi.fn(async () => Response.json(upstream));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      makeRequest(rpcCall("eth_feeHistory", 1, ["0x4", "latest", [10, 50, 90]]))
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstream);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 502 without falling back when content-length exceeds the byte cap", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(1024 * 1024 + 1) },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest(rpcCall("eth_blockNumber")));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("too large");
    // too_large is terminal — retrying another endpoint would re-download
    // the same oversized payload.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels and returns 502 when the streamed body exceeds the byte cap", async () => {
    const fetchMock = vi.fn(async () =>
      oversizedStreamResponse(1024 * 1024 + 1)
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest(rpcCall("eth_blockNumber")));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("too large");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Keep last: failing endpoints are marked unhealthy in module-level state,
  // which would change the endpoint order seen by the tests above.
  it("returns 502 after every endpoint fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest(rpcCall("eth_blockNumber")));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("unavailable");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
