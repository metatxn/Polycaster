import { describe, expect, it, vi } from "vitest";
import { UpstreamPriceHistoryError } from "../errors";
import { CLOB_API_BASE } from "./orderbook";
import { fetchPriceHistoryByTokenId } from "./price-history";

/**
 * Contract tests against the CLOB /prices-history endpoint. Probed facts
 * that drive the shape here (2026-08-25): the query key is `market` but it
 * carries the TOKEN id, `t` is a seconds epoch number, `p` is a float
 * number, points arrive ascending, an unknown token answers HTTP 200 with
 * {"history": []} (never 404), and a missing time component answers 400.
 */

const TOKEN_ID =
  "27146956652877944551877724690365745048289675287536243265951843487691050802191";

const PARAMS = { startTs: 1_787_600_000, endTs: 1_787_686_400, fidelity: 60 };

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

const RAW_HISTORY = {
  history: [
    { t: 1_787_600_425, p: 0.006 },
    { t: 1_787_604_025, p: 0.007 },
    { t: 1_787_607_625, p: 0.0065 },
  ],
};

describe("fetchPriceHistoryByTokenId", () => {
  it("requests GET /prices-history with market, startTs, endTs, fidelity", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(RAW_HISTORY)
    );

    const points = await fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, {
      fetchImpl,
    });

    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(
      `${CLOB_API_BASE}/prices-history`
    );
    expect(url.searchParams.get("market")).toBe(TOKEN_ID);
    expect(url.searchParams.get("startTs")).toBe(String(PARAMS.startTs));
    expect(url.searchParams.get("endTs")).toBe(String(PARAMS.endTs));
    expect(url.searchParams.get("fidelity")).toBe(String(PARAMS.fidelity));

    expect(points).toEqual([
      { t: 1_787_600_425, p: "0.006" },
      { t: 1_787_604_025, p: "0.007" },
      { t: 1_787_607_625, p: "0.0065" },
    ]);
  });

  it("returns an empty array when history is empty (unknown token answers 200)", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ history: [] }));

    const points = await fetchPriceHistoryByTokenId("123", PARAMS, {
      fetchImpl,
    });

    expect(points).toEqual([]);
  });

  it("rejects a missing or non-array history", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({}));

    await expect(
      fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamPriceHistoryError);
  });

  it("rejects malformed points instead of silently dropping them", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        history: [
          { t: 1_787_600_425, p: 0.5 },
          { t: "1787600425", p: 0.5 },
          { t: 1_787_600_500, p: "0.5" },
          { t: Number.NaN, p: 0.5 },
          { t: 1_787_600_600 },
          { p: 0.5 },
          null,
          "junk",
          { t: 1_787_600_700, p: 0.25 },
        ],
      })
    );

    await expect(
      fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamPriceHistoryError);
  });

  it("rejects out-of-range prices and timestamps outside the requested window", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        history: [
          { t: PARAMS.startTs - 1, p: 0.5 },
          { t: PARAMS.startTs, p: 1.01 },
        ],
      })
    );

    await expect(
      fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamPriceHistoryError);
  });

  it("sorts valid points by timestamp", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        history: [
          { t: PARAMS.startTs + 60, p: 0.4 },
          { t: PARAMS.startTs, p: 0.3 },
        ],
      })
    );

    await expect(
      fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, { fetchImpl })
    ).resolves.toEqual([
      { t: PARAMS.startTs, p: "0.3" },
      { t: PARAMS.startTs + 60, p: "0.4" },
    ]);
  });

  it("throws UpstreamPriceHistoryError carrying the status on a 400", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse(
        { error: "invalid filters: the time component is mandatory" },
        400
      )
    );

    const promise = fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, {
      fetchImpl,
    });

    await expect(promise).rejects.toBeInstanceOf(UpstreamPriceHistoryError);
    await expect(promise).rejects.toMatchObject({ status: 400 });
  });

  it("preserves a 429 status for rate-limit mapping", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({}, 429));

    await expect(
      fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, { fetchImpl })
    ).rejects.toMatchObject({ name: "UpstreamPriceHistoryError", status: 429 });
  });

  it("throws UpstreamPriceHistoryError when the payload is not an object", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse([]));

    await expect(
      fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamPriceHistoryError);
  });

  it("aborts through the timeout signal", async () => {
    await expect(
      fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, {
        fetchImpl: hangingFetch(),
        timeoutMs: 5,
      })
    ).rejects.toThrow();
  });

  it("honors a caller-provided abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchPriceHistoryByTokenId(TOKEN_ID, PARAMS, {
        fetchImpl: hangingFetch(),
        signal: controller.signal,
      })
    ).rejects.toHaveProperty("name", "AbortError");
  });
});
