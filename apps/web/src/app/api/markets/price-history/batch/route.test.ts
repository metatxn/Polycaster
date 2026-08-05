import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/cache-headers", () => ({
  getCacheHeaders: vi.fn(() => ({ "Cache-Control": "public, max-age=60" })),
}));

vi.mock("@knoww/shared-types/clob", () => {
  class ClobRequestError extends Error {
    status: number;
    constructor(message: string, response: { status: number }) {
      super(message);
      this.status = response.status;
    }
  }
  return {
    ClobRequestError,
    fetchClobPriceHistory: vi.fn(),
  };
});

import {
  ClobRequestError,
  fetchClobPriceHistory,
} from "@knoww/shared-types/clob";
import { POST } from "./route";

interface BatchResponseBody {
  success: boolean;
  partial?: boolean;
  histories: Array<{
    tokenId: string;
    status: string;
    history: Array<{ t: number; p: number }>;
  }>;
  error?: string;
  code?: string;
  estimatedTotalPoints?: number;
  maxTotalPoints?: number;
  minimumFidelity?: number;
}

function makeTokenIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(10_000_000_000 + i));
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://knoww.app/api/markets/price-history/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("POST /api/markets/price-history/batch", () => {
  it("rejects batches above the token cap", async () => {
    const res = await POST(makeRequest({ tokenIds: makeTokenIds(41) }));
    expect(res.status).toBe(400);
    expect(fetchClobPriceHistory).not.toHaveBeenCalled();
  });

  it("allows the default 40-token, 30-day hourly chart request", async () => {
    vi.mocked(fetchClobPriceHistory).mockResolvedValue({ history: [] });

    const res = await POST(makeRequest({ tokenIds: makeTokenIds(40) }));

    expect(res.status).toBe(200);
    expect(fetchClobPriceHistory).toHaveBeenCalledTimes(40);
  });

  it("rejects requests whose estimated point count exceeds the worker budget", async () => {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

    const res = await POST(
      makeRequest({
        tokenIds: makeTokenIds(12),
        startTs: thirtyDaysAgo,
        fidelity: 1,
      })
    );
    const body = (await res.json()) as BatchResponseBody;

    expect(res.status).toBe(400);
    expect(body.code).toBe("PRICE_HISTORY_BUDGET_EXCEEDED");
    expect(body.estimatedTotalPoints).toBeGreaterThan(body.maxTotalPoints ?? 0);
    expect(body.minimumFidelity).toBe(18);
    expect(body.histories).toEqual([]);
    expect(fetchClobPriceHistory).not.toHaveBeenCalled();
  });

  it("returns a complete batch with the standard cache profile", async () => {
    vi.mocked(fetchClobPriceHistory).mockResolvedValue({
      history: [{ t: 1, p: 0.5 }],
    });

    const res = await POST(makeRequest({ tokenIds: makeTokenIds(3) }));
    const body = (await res.json()) as BatchResponseBody;

    expect(res.status).toBe(200);
    expect(body.partial).toBe(false);
    expect(body.histories).toHaveLength(3);
    expect(body.histories.every((entry) => entry.status === "ok")).toBe(true);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("marks failed tokens per-entry and disables caching for partial batches", async () => {
    const [okId, missingId, brokenId] = makeTokenIds(3);
    vi.mocked(fetchClobPriceHistory).mockImplementation(async (tokenId) => {
      if (tokenId === missingId) {
        throw new ClobRequestError("not found", {
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      }
      if (tokenId === brokenId) throw new Error("upstream exploded");
      return { history: [{ t: 1, p: 0.5 }] };
    });

    const res = await POST(
      makeRequest({ tokenIds: [okId, missingId, brokenId] })
    );
    const body = (await res.json()) as BatchResponseBody;
    const statusByToken = new Map(
      body.histories.map((entry) => [entry.tokenId, entry.status])
    );

    expect(res.status).toBe(200);
    expect(body.partial).toBe(true);
    expect(statusByToken.get(okId)).toBe("ok");
    expect(statusByToken.get(missingId)).toBe("not_found");
    expect(statusByToken.get(brokenId)).toBe("upstream_error");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("treats not_found entries as complete data, not a partial batch", async () => {
    const [okId, missingId] = makeTokenIds(2);
    vi.mocked(fetchClobPriceHistory).mockImplementation(async (tokenId) => {
      if (tokenId === missingId) {
        throw new ClobRequestError("not found", {
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      }
      return { history: [{ t: 1, p: 0.5 }] };
    });

    const res = await POST(makeRequest({ tokenIds: [okId, missingId] }));
    const body = (await res.json()) as BatchResponseBody;
    const statusByToken = new Map(
      body.histories.map((entry) => [entry.tokenId, entry.status])
    );

    expect(res.status).toBe(200);
    // A permanent 404 is a stable answer — the batch stays cacheable and
    // clients must not fast-poll it forever.
    expect(body.partial).toBe(false);
    expect(statusByToken.get(missingId)).toBe("not_found");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("never runs more than the pool concurrency in parallel", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(fetchClobPriceHistory).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { history: [] };
    });

    const res = await POST(makeRequest({ tokenIds: makeTokenIds(12) }));

    expect(res.status).toBe(200);
    expect(fetchClobPriceHistory).toHaveBeenCalledTimes(12);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("reports tokens that exceed the per-token timeout as timeout entries", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchClobPriceHistory).mockImplementation(
      (_tokenId, _query, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.requestInit?.signal as
            | AbortSignal
            | undefined;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );

    const resPromise = POST(makeRequest({ tokenIds: makeTokenIds(2) }));
    await vi.advanceTimersByTimeAsync(9_000);
    const res = await resPromise;
    const body = (await res.json()) as BatchResponseBody;

    expect(res.status).toBe(200);
    expect(body.partial).toBe(true);
    expect(body.histories.every((entry) => entry.status === "timeout")).toBe(
      true
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
