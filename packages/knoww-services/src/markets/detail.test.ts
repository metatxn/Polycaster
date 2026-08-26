import { describe, expect, it, vi } from "vitest";
import { UpstreamMarketError } from "../errors";
import { fetchMarketByIdentifier, type MarketIdentifier } from "./detail";

/**
 * Contract tests against the Gamma /markets identifier lookups used by the
 * web slug/by-token routes and apps/agent resolutions. Two probed facts
 * drive the shape here: identifier lookups return an array, and Gamma's
 * default filter hides closed markets, so a closed=true retry is required.
 */

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

const ACTIVE_MARKET = {
  id: "1163699",
  question: "Clarity Act signed into law in 2026?",
  slug: "clarity-act-signed-into-law-in-2026",
  closed: false,
  active: true,
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.145", "0.855"]',
};

const CLOSED_MARKET = {
  id: "12",
  question: "Will Joe Biden get Coronavirus before the election?",
  slug: "will-joe-biden-get-coronavirus-before-the-election",
  closed: true,
  active: true,
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0", "0"]',
};

describe("fetchMarketByIdentifier", () => {
  it.each<[MarketIdentifier["kind"], string, string]>([
    ["slug", "clarity-act-signed-into-law-in-2026", "slug"],
    ["conditionId", `0x${"ab".repeat(32)}`, "condition_ids"],
    [
      "tokenId",
      "53135072462907880191400140706440867753044989936304433583131786753949599718775",
      "clob_token_ids",
    ],
  ])(
    "maps a %s identifier to the %s query param",
    async (kind, value, param) => {
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse([ACTIVE_MARKET])
      );

      const market = await fetchMarketByIdentifier(
        { kind, value },
        { fetchImpl }
      );

      expect(market).toEqual(ACTIVE_MARKET);
      expect(calls).toHaveLength(1);
      const url = new URL(calls[0].url);
      expect(`${url.origin}${url.pathname}`).toBe(
        "https://gamma-api.polymarket.com/markets"
      );
      expect(url.searchParams.get(param)).toBe(value);
      expect(url.searchParams.has("closed")).toBe(false);
    }
  );

  it("sends an Accept: application/json header", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse([ACTIVE_MARKET])
    );

    await fetchMarketByIdentifier(
      { kind: "slug", value: "clarity-act-signed-into-law-in-2026" },
      { fetchImpl }
    );

    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("accept")).toBe("application/json");
  });

  it("does not issue the closed=true retry when the first query finds the market", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse([ACTIVE_MARKET])
    );

    await fetchMarketByIdentifier(
      { kind: "slug", value: "clarity-act-signed-into-law-in-2026" },
      { fetchImpl }
    );

    expect(calls).toHaveLength(1);
  });

  it("retries with closed=true when the default filter hides a closed market", async () => {
    const { fetchImpl, calls } = recordingFetch((_url, callIndex) =>
      jsonResponse(callIndex === 0 ? [] : [CLOSED_MARKET])
    );

    const market = await fetchMarketByIdentifier(
      { kind: "slug", value: CLOSED_MARKET.slug },
      { fetchImpl }
    );

    expect(market).toEqual(CLOSED_MARKET);
    expect(calls).toHaveLength(2);
    const retryUrl = new URL(calls[1].url);
    expect(retryUrl.searchParams.get("slug")).toBe(CLOSED_MARKET.slug);
    expect(retryUrl.searchParams.get("closed")).toBe("true");
  });

  it("returns null when both queries come back empty", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse([]));

    const market = await fetchMarketByIdentifier(
      { kind: "slug", value: "no-such-market" },
      { fetchImpl }
    );

    expect(market).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("round-trips identifier values through URL encoding losslessly", async () => {
    const hostileSlug = "a&b=c d/e?f";
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse([ACTIVE_MARKET])
    );

    await fetchMarketByIdentifier(
      { kind: "slug", value: hostileSlug },
      { fetchImpl }
    );

    const url = new URL(calls[0].url);
    expect(url.searchParams.get("slug")).toBe(hostileSlug);
    expect(url.searchParams.get("b")).toBeNull();
  });

  it("throws UpstreamMarketError with the status on a non-ok response", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({}, 429));

    const attempt = fetchMarketByIdentifier(
      { kind: "slug", value: "clarity-act-signed-into-law-in-2026" },
      { fetchImpl }
    );

    await expect(attempt).rejects.toBeInstanceOf(UpstreamMarketError);
    await expect(attempt).rejects.toMatchObject({ status: 429 });
  });

  it("throws UpstreamMarketError when the payload is not an array", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ markets: [ACTIVE_MARKET] })
    );

    await expect(
      fetchMarketByIdentifier(
        { kind: "slug", value: "clarity-act-signed-into-law-in-2026" },
        { fetchImpl }
      )
    ).rejects.toBeInstanceOf(UpstreamMarketError);
  });

  it("throws UpstreamMarketError when the first element has no string id", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse([{ question: "id went missing" }])
    );

    await expect(
      fetchMarketByIdentifier(
        { kind: "slug", value: "clarity-act-signed-into-law-in-2026" },
        { fetchImpl }
      )
    ).rejects.toBeInstanceOf(UpstreamMarketError);
  });

  it("rejects malformed nested fields instead of returning an unsafe cast", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse([
        {
          ...ACTIVE_MARKET,
          events: [{ id: 123, title: "Wrong id type" }],
          outcomePrices: '["1.1","-0.1"]',
        },
      ])
    );

    await expect(
      fetchMarketByIdentifier(
        { kind: "slug", value: ACTIVE_MARKET.slug },
        { fetchImpl }
      )
    ).rejects.toBeInstanceOf(UpstreamMarketError);
  });

  it("aborts through the timeout signal when the upstream hangs", async () => {
    await expect(
      fetchMarketByIdentifier(
        { kind: "slug", value: "clarity-act-signed-into-law-in-2026" },
        { fetchImpl: hangingFetch(), timeoutMs: 5 }
      )
    ).rejects.toThrow();
  });

  it("honors a caller-provided abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchMarketByIdentifier(
        { kind: "slug", value: ACTIVE_MARKET.slug },
        { fetchImpl: hangingFetch(), signal: controller.signal }
      )
    ).rejects.toHaveProperty("name", "AbortError");
  });
});
