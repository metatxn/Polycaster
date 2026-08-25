import { describe, expect, it, vi } from "vitest";
import { UpstreamSearchError } from "../errors";
import {
  buildEmptySearchResponse,
  fetchAggregatedSearchData,
  fetchPublicSearchEvents,
  fetchTagEvents,
  getTopOutcome,
  mergeEvents,
  type SearchEvent,
} from "./search";

/**
 * Characterization tests: every behavior here mirrors what
 * apps/web/src/app/api/search/route.ts did before extraction. Changing an
 * expectation means changing the web /api/search contract too.
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
  respond: (url: string) => Response | Promise<Response>
): RecordedFetch {
  const calls: RecordedFetch["calls"] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return respond(url);
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

describe("buildEmptySearchResponse", () => {
  it("returns the empty search shape without a degraded key by default", () => {
    const data = buildEmptySearchResponse();
    expect(data).toEqual({
      events: [],
      tags: [],
      profiles: [],
      pagination: { hasMore: false, totalResults: 0 },
    });
    expect(data).not.toHaveProperty("degraded");
  });

  it("marks the response degraded when asked", () => {
    expect(buildEmptySearchResponse(true).degraded).toBe(true);
  });
});

describe("getTopOutcome", () => {
  it("returns undefined for an empty market list", () => {
    expect(getTopOutcome([])).toBeUndefined();
  });

  it("skips the No side of a Yes/No market even when No has the higher price", () => {
    const outcome = getTopOutcome([
      {
        id: "m1",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.3","0.7"]',
      },
    ]);
    expect(outcome).toEqual({ name: "Yes", price: 0.3 });
  });

  it("prefers groupItemTitle over the raw outcome name", () => {
    const outcome = getTopOutcome([
      {
        id: "m1",
        groupItemTitle: "Arsenal",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.45","0.55"]',
      },
    ]);
    expect(outcome).toEqual({ name: "Arsenal", price: 0.45 });
  });

  it("picks the highest priced outcome of a multi-outcome market", () => {
    const outcome = getTopOutcome([
      {
        id: "m1",
        outcomes: '["Madrid","Barcelona","Other"]',
        outcomePrices: '["0.5","0.4","0.1"]',
      },
    ]);
    expect(outcome).toEqual({ name: "Madrid", price: 0.5 });
  });

  it("compares prices across all markets of the event", () => {
    const outcome = getTopOutcome([
      {
        id: "m1",
        groupItemTitle: "Team A",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.4","0.6"]',
      },
      {
        id: "m2",
        groupItemTitle: "Team B",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.9","0.1"]',
      },
    ]);
    expect(outcome).toEqual({ name: "Team B", price: 0.9 });
  });

  it("compares outcome prices without losing decimal precision", () => {
    const outcome = getTopOutcome([
      {
        id: "m1",
        groupItemTitle: "Lower",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.9","0.1"]',
      },
      {
        id: "m2",
        groupItemTitle: "Higher",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.90000000000000001","0.09999999999999999"]',
      },
    ]);

    expect(outcome?.name).toBe("Higher");
  });

  it("skips markets with unparseable outcome data and keeps going", () => {
    const outcome = getTopOutcome([
      { id: "bad", outcomes: "not-json", outcomePrices: '["0.99"]' },
      {
        id: "good",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.6","0.4"]',
      },
    ]);
    expect(outcome).toEqual({ name: "Yes", price: 0.6 });
  });

  it("returns undefined when every price is zero", () => {
    const outcome = getTopOutcome([
      { id: "m1", outcomes: '["A","B"]', outcomePrices: '["0","0"]' },
    ]);
    expect(outcome).toBeUndefined();
  });
});

describe("mergeEvents", () => {
  it("dedupes by id and keeps the search copy over the tag copy", () => {
    const search: SearchEvent[] = [{ id: "a", title: "A from search" }];
    const tags: SearchEvent[] = [
      { id: "a", title: "A from tag" },
      { id: "b", title: "B" },
    ];

    const merged = mergeEvents(search, tags, 10, "");
    expect(merged.map((e) => e.id)).toEqual(["a", "b"]);
    expect(merged[0].title).toBe("A from search");
  });

  it("drops events that are closed or explicitly inactive", () => {
    const search: SearchEvent[] = [
      { id: "a", title: "Open" },
      { id: "b", title: "Closed", closed: true },
      { id: "c", title: "Inactive", active: false },
    ];

    const merged = mergeEvents(search, [], 10, "");
    expect(merged.map((e) => e.id)).toEqual(["a"]);
  });

  it("with a query, filters tag events by title or market question and preserves order", () => {
    const search: SearchEvent[] = [
      { id: "s1", title: "Bitcoin ETF approval", volume24hr: 1 },
    ];
    const tags: SearchEvent[] = [
      { id: "t1", title: "Unrelated soccer" },
      { id: "t2", title: "Will Bitcoin hit 100k", volume24hr: 999 },
      {
        id: "t3",
        title: "Fed rates",
        markets: [{ id: "m1", question: "Does bitcoin drop?" }],
      },
    ];

    const merged = mergeEvents(search, tags, 10, "bitcoin");
    // Search relevance stays on top; no volume re-sort when a query is set.
    expect(merged.map((e) => e.id)).toEqual(["s1", "t2", "t3"]);
  });

  it("without a query, sorts by 24h volume descending with missing volume as zero", () => {
    const search: SearchEvent[] = [{ id: "a", title: "A", volume24hr: 5 }];
    const tags: SearchEvent[] = [
      { id: "b", title: "B", volume24hr: 100 },
      { id: "c", title: "C" },
    ];

    const merged = mergeEvents(search, tags, 10, "");
    expect(merged.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("caps the merged list at the limit", () => {
    const search: SearchEvent[] = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ];

    expect(mergeEvents(search, [], 2, "")).toHaveLength(2);
  });

  it("attaches topOutcome to events that have markets", () => {
    const search: SearchEvent[] = [
      {
        id: "a",
        title: "With markets",
        markets: [
          { id: "m", outcomes: '["Yes","No"]', outcomePrices: '["0.7","0.3"]' },
        ],
      },
      { id: "b", title: "Without markets" },
    ];

    const merged = mergeEvents(search, [], 10, "");
    expect(merged[0].topOutcome).toEqual({ name: "Yes", price: 0.7 });
    expect(merged[1]).not.toHaveProperty("topOutcome");
  });

  it("falls back to slug then title as the dedupe key when id is empty", () => {
    const tags: SearchEvent[] = [
      { id: "", slug: "same-slug", title: "First" },
      { id: "", slug: "same-slug", title: "Second" },
    ];

    const merged = mergeEvents([], tags, 10, "");
    expect(merged.map((e) => e.title)).toEqual(["First"]);
  });
});

describe("fetchPublicSearchEvents", () => {
  it("short-circuits a blank query without calling fetch", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));

    const result = await fetchPublicSearchEvents("   ", 10, { fetchImpl });
    expect(result).toEqual({
      events: [],
      tags: [],
      profiles: [],
      pagination: { hasMore: false, totalResults: 0 },
    });
    expect(calls).toHaveLength(0);
  });

  it("queries gamma public-search with the exact active-only parameter set", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ events: [] })
    );

    await fetchPublicSearchEvents("bitcoin etf", 15, { fetchImpl });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin).toBe("https://gamma-api.polymarket.com");
    expect(url.pathname).toBe("/public-search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "bitcoin etf",
      limit: "15",
      limit_per_type: "10",
      cache: "true",
      search_tags: "true",
      optimized: "true",
      events_status: "active",
      keep_closed_markets: "0",
      closed: "false",
    });
    expect(
      new Headers(calls[0].init?.headers as HeadersInit).get("accept")
    ).toBe("application/json");
  });

  it("tags events as search results and passes tags, profiles, and pagination through", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        events: [{ id: "e1", title: "Event" }],
        tags: [{ id: "tag1" }],
        profiles: [{ id: "p1" }],
        pagination: { hasMore: true, totalResults: 42 },
      })
    );

    const result = await fetchPublicSearchEvents("bitcoin", 5, { fetchImpl });
    expect(result.events).toEqual([
      { id: "e1", title: "Event", _source: "search" },
    ]);
    expect(result.tags).toEqual([{ id: "tag1" }]);
    expect(result.profiles).toEqual([{ id: "p1" }]);
    expect(result.pagination).toEqual({ hasMore: true, totalResults: 42 });
  });

  it("falls back to counting events when upstream omits pagination", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        events: [
          { id: "e1", title: "One" },
          { id: "e2", title: "Two" },
        ],
      })
    );

    const result = await fetchPublicSearchEvents("bitcoin", 5, { fetchImpl });
    expect(result.pagination).toEqual({ hasMore: false, totalResults: 2 });
  });

  it("rejects malformed nested market data", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        events: [
          {
            id: "e1",
            title: "Malformed",
            markets: [
              {
                id: "m1",
                outcomes: '["Yes","No"]',
                outcomePrices: '["1.2","-0.2"]',
              },
            ],
          },
        ],
      })
    );

    await expect(
      fetchPublicSearchEvents("bitcoin", 5, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamSearchError);
  });

  it("throws UpstreamSearchError with the status for a non-ok response", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({}, 503));

    const error = await fetchPublicSearchEvents("bitcoin", 5, {
      fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UpstreamSearchError);
    expect((error as UpstreamSearchError).status).toBe(503);
  });

  it("aborts a hung upstream request after timeoutMs", async () => {
    await expect(
      fetchPublicSearchEvents("bitcoin", 5, {
        fetchImpl: hangingFetch(),
        timeoutMs: 5,
      })
    ).rejects.toHaveProperty("name", "AbortError");
  });

  it("honors a caller-provided abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchPublicSearchEvents("bitcoin", 5, {
        fetchImpl: hangingFetch(),
        signal: controller.signal,
      })
    ).rejects.toHaveProperty("name", "AbortError");
  });
});

describe("fetchTagEvents", () => {
  it("queries gamma events/keyset ordered by 24h volume and tags results", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ data: [{ id: "t1", title: "Tagged" }] })
    );

    const result = await fetchTagEvents("politics", { fetchImpl });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin).toBe("https://gamma-api.polymarket.com");
    expect(url.pathname).toBe("/events/keyset");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tag_slug: "politics",
      closed: "false",
      limit: "11",
      order: "volume24hr",
      ascending: "false",
    });
    expect(result).toEqual({
      events: [{ id: "t1", title: "Tagged", _source: "tag" }],
      truncated: false,
    });
  });

  it("accepts a bare array payload", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse([{ id: "t1", title: "Bare" }])
    );

    const result = await fetchTagEvents("politics", { fetchImpl });
    expect(result.events).toEqual([
      { id: "t1", title: "Bare", _source: "tag" },
    ]);
  });

  it("fetches one extra event and reports when the requested page is truncated", async () => {
    const payload = Array.from({ length: 4 }, (_, index) => ({
      id: `t${index}`,
      title: `Tagged ${index}`,
    }));
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(payload));

    const result = await fetchTagEvents("politics", { fetchImpl }, 3);

    expect(new URL(calls[0].url).searchParams.get("limit")).toBe("4");
    expect(result.events).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});

describe("fetchAggregatedSearchData", () => {
  const searchPayload = {
    events: [{ id: "s1", title: "Bitcoin up" }],
    tags: [{ id: "tag1" }],
    profiles: [],
    pagination: { hasMore: true, totalResults: 50 },
  };
  const tagPayload = [{ id: "t1", title: "Bitcoin fund", volume24hr: 3 }];

  function routedFetch(overrides?: {
    publicSearch?: Response;
    tag?: Response;
  }): RecordedFetch {
    return recordingFetch((url) =>
      url.includes("/public-search")
        ? (overrides?.publicSearch ?? jsonResponse(searchPayload))
        : (overrides?.tag ?? jsonResponse(tagPayload))
    );
  }

  it("merges search and tag events and keeps the larger totalResults", async () => {
    const { fetchImpl } = routedFetch();

    const data = await fetchAggregatedSearchData("bitcoin", 10, ["crypto"], {
      fetchImpl,
    });

    expect(data.events.map((e) => e.id)).toEqual(["s1", "t1"]);
    expect(data.tags).toEqual([{ id: "tag1" }]);
    expect(data.pagination).toEqual({ hasMore: true, totalResults: 50 });
    expect(data).not.toHaveProperty("degraded");
  });

  it("degrades but returns tag events when public search fails", async () => {
    const { fetchImpl } = routedFetch({ publicSearch: jsonResponse({}, 500) });

    const data = await fetchAggregatedSearchData("bitcoin", 10, ["crypto"], {
      fetchImpl,
    });

    expect(data.degraded).toBe(true);
    expect(data.events.map((e) => e.id)).toEqual(["t1"]);
    expect(data.pagination).toEqual({ hasMore: false, totalResults: 1 });
  });

  it("degrades but returns search events when a tag fetch fails", async () => {
    const { fetchImpl } = routedFetch({ tag: jsonResponse({}, 502) });

    const data = await fetchAggregatedSearchData("bitcoin", 10, ["crypto"], {
      fetchImpl,
    });

    expect(data.degraded).toBe(true);
    expect(data.events.map((e) => e.id)).toEqual(["s1"]);
    expect(data.pagination).toEqual({ hasMore: true, totalResults: 50 });
  });

  it("degrades to an empty result when everything fails", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({}, 500));

    const data = await fetchAggregatedSearchData("bitcoin", 10, ["crypto"], {
      fetchImpl,
    });

    expect(data.degraded).toBe(true);
    expect(data.events).toEqual([]);
    expect(data.pagination).toEqual({ hasMore: false, totalResults: 0 });
  });

  it("threads the timeout into tag fetches and degrades on abort", async () => {
    const data = await fetchAggregatedSearchData("", 10, ["crypto"], {
      fetchImpl: hangingFetch(),
      timeoutMs: 5,
    });

    expect(data.degraded).toBe(true);
    expect(data.events).toEqual([]);
  });

  it("does not convert caller cancellation into a degraded success", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchAggregatedSearchData("bitcoin", 10, ["crypto"], {
        fetchImpl: hangingFetch(),
        signal: controller.signal,
      })
    ).rejects.toHaveProperty("name", "AbortError");
  });

  it("propagates tag truncation into pagination and response metadata", async () => {
    const tagEvents = Array.from({ length: 4 }, (_, index) => ({
      id: `t${index}`,
      title: `Bitcoin ${index}`,
    }));
    const { fetchImpl } = recordingFetch((url) =>
      url.includes("/public-search")
        ? jsonResponse({ events: [] })
        : jsonResponse(tagEvents)
    );

    const data = await fetchAggregatedSearchData("bitcoin", 3, ["crypto"], {
      fetchImpl,
    });

    expect(data.events).toHaveLength(3);
    expect(data.pagination.hasMore).toBe(true);
    expect(data.truncated).toBe(true);
  });
});
