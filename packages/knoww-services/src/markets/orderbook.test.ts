import { describe, expect, it, vi } from "vitest";
import { UpstreamOrderbookError } from "../errors";
import { CLOB_API_BASE, fetchOrderbookByTokenId } from "./orderbook";

/**
 * Contract tests against the CLOB /book endpoint. Probed facts that drive
 * the shape here (2026-08-25): every scalar arrives as a snake_case string,
 * timestamp is a milliseconds epoch string, levels arrive worst-to-best on
 * both sides (sorting is the caller's job), unknown token ids answer 404
 * with {"error": "..."}, and historical payloads have carried camelCase
 * variants (tokenId, minOrderSize, tickSize) plus numeric level values.
 */

const TOKEN_ID =
  "27146956652877944551877724690365745048289675287536243265951843487691050802191";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface RecordedFetch {
  fetchImpl: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
}

function recordingFetch(
  respond: (url: string, callIndex: number) => Response | Promise<Response>
): RecordedFetch {
  const calls: RecordedFetch["calls"] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return respond(url, calls.length - 1);
    }
  ) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Never resolves; rejects with the abort reason once the signal fires. */
function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason ?? new Error("aborted"));
      });
    })) as typeof fetch;
}

const RAW_BOOK = {
  market: "0x0e5e7d3f9bde74f60fbfd5ba4d9c1e2b8a2f4c6d8e0a1b3c5d7e9f0a2b4c6d8e",
  asset_id: TOKEN_ID,
  timestamp: "1787664963975",
  hash: "5b686e63f5f6a2c9d4e1b8a7f0c3d6e9",
  bids: [
    { price: "0.001", size: "40" },
    { price: "0.005", size: "2772.86" },
  ],
  asks: [
    { price: "0.999", size: "1210.05" },
    { price: "0.007", size: "888.47" },
  ],
  min_order_size: "5",
  tick_size: "0.001",
  neg_risk: true,
  last_trade_price: "0.005",
};

describe("fetchOrderbookByTokenId", () => {
  it("requests GET /book?token_id= and normalizes the snapshot", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(RAW_BOOK));

    const book = await fetchOrderbookByTokenId(TOKEN_ID, { fetchImpl });

    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(`${CLOB_API_BASE}/book`);
    expect(url.searchParams.get("token_id")).toBe(TOKEN_ID);

    // Upstream level order is preserved verbatim; extras like neg_risk and
    // last_trade_price are dropped.
    expect(book).toEqual({
      market: RAW_BOOK.market,
      assetId: TOKEN_ID,
      timestamp: "1787664963975",
      hash: RAW_BOOK.hash,
      bids: [
        { price: "0.001", size: "40" },
        { price: "0.005", size: "2772.86" },
      ],
      asks: [
        { price: "0.999", size: "1210.05" },
        { price: "0.007", size: "888.47" },
      ],
      minOrderSize: "5",
      tickSize: "0.001",
    });
  });

  it("rejects incomplete levels instead of silently dropping them", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        bids: [
          { price: 0.45, size: 100.5 },
          { price: "0.44" },
          { size: "5" },
          { price: "", size: "3" },
          null,
          "junk",
        ],
        asks: [{ price: "0.5", size: 10 }],
      })
    );

    await expect(
      fetchOrderbookByTokenId(TOKEN_ID, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamOrderbookError);
  });

  it("accepts camelCase fallback keys", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        tokenId: "999",
        minOrderSize: "5",
        tickSize: "0.01",
        bids: [],
        asks: [],
      })
    );

    const book = await fetchOrderbookByTokenId("999", { fetchImpl });

    expect(book).toEqual({
      assetId: "999",
      minOrderSize: "5",
      tickSize: "0.01",
      bids: [],
      asks: [],
    });
  });

  it("rejects missing or non-array level collections", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ market: "0xabc", bids: "nope" })
    );

    await expect(
      fetchOrderbookByTokenId(TOKEN_ID, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamOrderbookError);
  });

  it("rejects out-of-range prices and non-positive sizes", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        asset_id: TOKEN_ID,
        bids: [{ price: "1.01", size: "2" }],
        asks: [{ price: "0.5", size: "0" }],
      })
    );

    await expect(
      fetchOrderbookByTokenId(TOKEN_ID, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamOrderbookError);
  });

  it("rejects a book for a different token", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ ...RAW_BOOK, asset_id: "different-token" })
    );

    await expect(
      fetchOrderbookByTokenId(TOKEN_ID, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamOrderbookError);
  });

  it("returns null when the CLOB answers 404", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse(
        { error: "No orderbook exists for the requested token id" },
        404
      )
    );

    const book = await fetchOrderbookByTokenId("123", { fetchImpl });

    expect(book).toBeNull();
  });

  it("throws UpstreamOrderbookError carrying the status on server failure", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ error: "boom" }, 500)
    );

    const promise = fetchOrderbookByTokenId(TOKEN_ID, { fetchImpl });

    await expect(promise).rejects.toBeInstanceOf(UpstreamOrderbookError);
    await expect(promise).rejects.toMatchObject({ status: 500 });
  });

  it("preserves a 429 status for rate-limit mapping", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({}, 429));

    await expect(
      fetchOrderbookByTokenId(TOKEN_ID, { fetchImpl })
    ).rejects.toMatchObject({ name: "UpstreamOrderbookError", status: 429 });
  });

  it("throws UpstreamOrderbookError when the payload is not an object", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse([]));

    await expect(
      fetchOrderbookByTokenId(TOKEN_ID, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamOrderbookError);
  });

  it("aborts through the timeout signal", async () => {
    await expect(
      fetchOrderbookByTokenId(TOKEN_ID, {
        fetchImpl: hangingFetch(),
        timeoutMs: 5,
      })
    ).rejects.toThrow();
  });

  it("honors a caller-provided abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchOrderbookByTokenId(TOKEN_ID, {
        fetchImpl: hangingFetch(),
        signal: controller.signal,
      })
    ).rejects.toHaveProperty("name", "AbortError");
  });
});
