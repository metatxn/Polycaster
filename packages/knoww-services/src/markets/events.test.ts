import { describe, expect, it, vi } from "vitest";
import { UpstreamEventError } from "../errors";
import {
  type EventIdentifier,
  fetchChildEvents,
  fetchEventByIdentifier,
  fetchOpenMarketsByEventSlug,
} from "./events";

/**
 * Contract tests against the Gamma event endpoints used by the web
 * events/[id] route. Probed facts that drive the shape here: /events/{id}
 * and /events/slug/{slug} return a single object (not an array), Gamma
 * answers 422 for malformed slugs (equivalent to not found), and negRisk
 * child events hang off ?parent_event_id=.
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

const PARENT_EVENT = {
  id: "35908",
  title: "Clarity Act",
  slug: "clarity-act",
  closed: false,
  active: true,
  markets: [
    {
      id: "1163699",
      question: "Clarity Act signed into law in 2026?",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.145", "0.855"]',
    },
  ],
};

describe("fetchEventByIdentifier", () => {
  it("looks up a numeric id through GET /events/{id}", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(PARENT_EVENT)
    );

    const event = await fetchEventByIdentifier(
      { kind: "id", value: "35908" },
      { fetchImpl }
    );

    expect(event).toEqual(PARENT_EVENT);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://gamma-api.polymarket.com/events/35908"
    );
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("accept")).toBe("application/json");
  });

  it("looks up a slug through GET /events/slug/{slug}", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(PARENT_EVENT)
    );

    const event = await fetchEventByIdentifier(
      { kind: "slug", value: "clarity-act" },
      { fetchImpl }
    );

    expect(event).toEqual(PARENT_EVENT);
    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://gamma-api.polymarket.com/events/slug/clarity-act"
    );
  });

  it("path-encodes hostile identifier values", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(PARENT_EVENT)
    );

    await fetchEventByIdentifier(
      { kind: "slug", value: "a/b?c" },
      { fetchImpl }
    );

    expect(calls[0].url).toBe(
      "https://gamma-api.polymarket.com/events/slug/a%2Fb%3Fc"
    );
  });

  it("returns null on a 404", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ error: "not found" }, 404)
    );

    const event = await fetchEventByIdentifier(
      { kind: "id", value: "999999999" },
      { fetchImpl }
    );

    expect(event).toBeNull();
  });

  it("returns null on a 422 for a slug lookup (Gamma's malformed-slug answer)", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ error: "unprocessable" }, 422)
    );

    const event = await fetchEventByIdentifier(
      { kind: "slug", value: "no-such-event" },
      { fetchImpl }
    );

    expect(event).toBeNull();
  });

  it("throws UpstreamEventError on a 422 for an id lookup", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ error: "unprocessable" }, 422)
    );

    const attempt = fetchEventByIdentifier(
      { kind: "id", value: "35908" },
      { fetchImpl }
    );

    await expect(attempt).rejects.toBeInstanceOf(UpstreamEventError);
    await expect(attempt).rejects.toMatchObject({ status: 422 });
  });

  it("throws UpstreamEventError with the status on other non-ok responses", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({}, 503));

    const attempt = fetchEventByIdentifier(
      { kind: "slug", value: "clarity-act" },
      { fetchImpl }
    );

    await expect(attempt).rejects.toBeInstanceOf(UpstreamEventError);
    await expect(attempt).rejects.toMatchObject({ status: 503 });
  });

  it("returns null when the body is null", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse(null));

    const event = await fetchEventByIdentifier(
      { kind: "slug", value: "clarity-act" },
      { fetchImpl }
    );

    expect(event).toBeNull();
  });

  it("throws UpstreamEventError when the body has no string id", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ title: "id went missing" })
    );

    await expect(
      fetchEventByIdentifier({ kind: "id", value: "35908" }, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamEventError);
  });

  it("rejects malformed nested markets", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        ...PARENT_EVENT,
        markets: [
          {
            id: "1163699",
            outcomes: '["Yes","No"]',
            outcomePrices: '["not-a-price","0.5"]',
          },
        ],
      })
    );

    await expect(
      fetchEventByIdentifier({ kind: "id", value: "35908" }, { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamEventError);
  });

  it("aborts through the timeout signal when the upstream hangs", async () => {
    await expect(
      fetchEventByIdentifier(
        { kind: "slug", value: "clarity-act" },
        { fetchImpl: hangingFetch(), timeoutMs: 5 }
      )
    ).rejects.toThrow();
  });

  it("honors a caller-provided abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchEventByIdentifier(
        { kind: "slug", value: "clarity-act" },
        { fetchImpl: hangingFetch(), signal: controller.signal }
      )
    ).rejects.toHaveProperty("name", "AbortError");
  });
});

describe("fetchChildEvents", () => {
  it("queries /events by parent_event_id with closed=false and a bounded limit", async () => {
    const child = { ...PARENT_EVENT, id: "41001", title: "Most Sixes" };
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse([child]));

    const result = await fetchChildEvents("35908", { fetchImpl });

    expect(result).toEqual({ events: [child], truncated: false });
    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://gamma-api.polymarket.com/events"
    );
    expect(url.searchParams.get("parent_event_id")).toBe("35908");
    expect(url.searchParams.get("closed")).toBe("false");
    expect(url.searchParams.get("limit")).toBe("51");
  });

  it("returns the bounded child page with an explicit truncation flag", async () => {
    const children = Array.from({ length: 51 }, (_, index) => ({
      ...PARENT_EVENT,
      id: String(41_000 + index),
    }));
    const { fetchImpl } = recordingFetch(() => jsonResponse(children));

    const result = await fetchChildEvents("35908", { fetchImpl });

    expect(result.events).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it("rejects a batch containing malformed child events", async () => {
    const child = { ...PARENT_EVENT, id: "41001" };
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse([child, { title: "no id" }, null])
    );

    await expect(
      fetchChildEvents("35908", { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamEventError);
  });

  it("throws UpstreamEventError when the payload is not an array", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ events: [] }));

    await expect(
      fetchChildEvents("35908", { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamEventError);
  });

  it("throws UpstreamEventError with the status on a non-ok response", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({}, 429));

    const attempt = fetchChildEvents("35908", { fetchImpl });

    await expect(attempt).rejects.toBeInstanceOf(UpstreamEventError);
    await expect(attempt).rejects.toMatchObject({ status: 429 });
  });
});

describe("fetchOpenMarketsByEventSlug", () => {
  it("queries /markets by events_slug with closed=false", async () => {
    const market = { id: "1163699", question: "Clarity Act?" };
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse([market]));

    const markets = await fetchOpenMarketsByEventSlug("clarity-act", {
      fetchImpl,
    });

    expect(markets).toEqual([market]);
    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://gamma-api.polymarket.com/markets"
    );
    expect(url.searchParams.get("events_slug")).toBe("clarity-act");
    expect(url.searchParams.get("closed")).toBe("false");
  });

  it("rejects a batch containing malformed markets", async () => {
    const market = { id: "1163699" };
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse([market, { question: "no id" }])
    );

    await expect(
      fetchOpenMarketsByEventSlug("clarity-act", { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamEventError);
  });

  it("throws UpstreamEventError when the payload is not an array", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ markets: [] }));

    await expect(
      fetchOpenMarketsByEventSlug("clarity-act", { fetchImpl })
    ).rejects.toBeInstanceOf(UpstreamEventError);
  });

  it("throws UpstreamEventError with the status on a non-ok response", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({}, 500));

    const attempt = fetchOpenMarketsByEventSlug("clarity-act", { fetchImpl });

    await expect(attempt).rejects.toBeInstanceOf(UpstreamEventError);
    await expect(attempt).rejects.toMatchObject({ status: 500 });
  });
});

// Type-level check: the identifier union stays closed over id and slug.
const _identifiers: EventIdentifier[] = [
  { kind: "id", value: "35908" },
  { kind: "slug", value: "clarity-act" },
];
void _identifiers;
