import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

import { GET } from "./route";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const openPosition = {
  proxyWallet: "0x0000000000000000000000000000000000000001",
  asset: "111",
  conditionId:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  size: 1.5,
  avgPrice: 0.6,
  initialValue: 0.9,
  currentValue: 1.5,
  cashPnl: 0.6,
  percentPnl: 66.66,
  totalBought: 1.5,
  realizedPnl: 0,
  percentRealizedPnl: 0,
  curPrice: 1,
  redeemable: false,
  title: "Will France win the 2026 FIFA World Cup?",
  slug: "will-france-win-the-2026-fifa-world-cup",
  icon: "https://example.com/icon.png",
  eventId: "event-1",
  eventSlug: "will-france-win-the-2026-fifa-world-cup",
  outcome: "Yes",
  outcomeIndex: 0,
  oppositeOutcome: "No",
  oppositeAsset: "222",
  endDate: "2026-06-20T00:00:00Z",
  negativeRisk: false,
};

function makePosition(
  overrides: Partial<typeof openPosition> = {}
): typeof openPosition {
  return {
    ...openPosition,
    ...overrides,
  };
}

describe("GET /api/user/positions", () => {
  it("returns 504 for an upstream timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Request timed out", "TimeoutError");
      })
    );

    const res = await GET(
      new NextRequest(
        "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001"
      )
    );

    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: "Request to Polymarket timed out",
    });
  });

  it("merges open and redeemable positions with one merged page slice", () => {
    const source = readSource("src/app/api/user/positions/route.ts");

    expect(source).not.toContain("displayedPositionsByKey");
    expect(source).toMatch(/openPositionsByKey\.set\(key, p\)/);
    expect(source).toMatch(
      /const mergedPositions = \[\.\.\.openPositionsByKey\.values\(\)\]/
    );
    // One merged regime for every offset: the page always slices the merged
    // list at the requested offset — no raw-offset passthrough variable.
    expect(source).toMatch(/mergedPositions\.slice\(offset, mergedPageEnd\)/);
    expect(source).not.toContain("localPageOffset");
  });

  it("starts open and redeemable upstream fetches concurrently", async () => {
    const openResponse = deferred<Response>();
    const redeemableResponse = deferred<Response>();
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        return url.searchParams.get("redeemable") === "true"
          ? redeemableResponse.promise
          : openResponse.promise;
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001"
    );

    const responsePromise = GET(req);
    await Promise.resolve();

    let assertionError: unknown;
    try {
      expect(upstreamFetch).toHaveBeenCalledTimes(2);
    } catch (error) {
      assertionError = error;
    }

    openResponse.resolve(Response.json([]));
    redeemableResponse.resolve(Response.json([]));
    await responsePromise;

    if (assertionError) throw assertionError;
  });

  it("keeps open positions while also fetching redeemable rows and filtering lost rows", async () => {
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.searchParams.get("redeemable") === "true") {
          return Response.json([
            makePosition({
              asset: "333",
              conditionId:
                "0x3333333333333333333333333333333333333333333333333333333333333333",
              title: "Will this market settle?",
              slug: "will-this-market-settle",
              eventSlug: "will-this-market-settle-event",
              curPrice: 1,
              currentValue: 1.5,
              cashPnl: 0.6,
              redeemable: true,
            }),
            makePosition({
              asset: "222",
              conditionId:
                "0x2222222222222222222222222222222222222222222222222222222222222222",
              title: "Will another market settle?",
              slug: "will-another-market-settle",
              eventSlug: "will-another-market-settle-event",
              outcome: "No",
              outcomeIndex: 1,
              curPrice: 0,
              currentValue: 0,
              cashPnl: -0.9,
              redeemable: true,
              negativeRisk: true,
            }),
          ]);
        }
        return Response.json([
          openPosition,
          makePosition({
            asset: "444",
            conditionId:
              "0x4444444444444444444444444444444444444444444444444444444444444444",
            title: "Will Spain win the 2026 FIFA World Cup?",
            slug: "will-spain-win-the-2026-fifa-world-cup",
            eventSlug: "will-spain-win-the-2026-fifa-world-cup",
            currentValue: 0.72,
            cashPnl: -0.11,
          }),
          makePosition({
            asset: "555",
            conditionId:
              "0x5555555555555555555555555555555555555555555555555555555555555555",
            title: "Will a settled losing row leak?",
            slug: "will-a-settled-losing-row-leak",
            eventSlug: "will-a-settled-losing-row-leak",
            outcome: "No",
            outcomeIndex: 1,
            curPrice: 0,
            currentValue: 0,
            cashPnl: -0.9,
            redeemable: true,
          }),
        ]);
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      success: boolean;
      positions: Array<{
        title?: string;
        redeemable: boolean;
        currentPrice: number;
        market: { title: string };
      }>;
      lostPositions: Array<{
        outcome: string;
        negRisk?: boolean;
        market: { title: string };
      }>;
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.positions).toMatchObject([
      {
        redeemable: false,
        market: { title: "Will France win the 2026 FIFA World Cup?" },
      },
      {
        redeemable: true,
        currentPrice: 1,
        market: { title: "Will this market settle?" },
      },
      {
        redeemable: false,
        market: { title: "Will Spain win the 2026 FIFA World Cup?" },
      },
    ]);
    expect(
      body.positions.some(
        (p) => p.market.title === "Will a settled losing row leak?"
      )
    ).toBe(false);
    expect(body.lostPositions).toHaveLength(2);
    expect(body.lostPositions).toEqual([
      expect.objectContaining({
        outcome: "No",
        negRisk: true,
        market: expect.objectContaining({
          title: "Will another market settle?",
        }),
      }),
      expect.objectContaining({
        outcome: "No",
        market: expect.objectContaining({
          title: "Will a settled losing row leak?",
        }),
      }),
    ]);

    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    const openUrl = new URL(String(upstreamFetch.mock.calls[0]?.[0]));
    const redeemableUrl = new URL(String(upstreamFetch.mock.calls[1]?.[0]));
    expect(openUrl.origin).toBe("https://data-api.polymarket.com");
    expect(openUrl.pathname).toBe("/positions");
    expect(openUrl.searchParams.has("redeemable")).toBe(false);
    expect(redeemableUrl.searchParams.get("redeemable")).toBe("true");
  });

  it("does not count a resolving market as both open and lost", async () => {
    const resolvingConditionId =
      "0x7777777777777777777777777777777777777777777777777777777777777777";
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.searchParams.get("redeemable") === "true") {
          return Response.json([
            makePosition({
              asset: "777",
              conditionId: resolvingConditionId,
              title: "Resolving duplicate market",
              slug: "resolving-duplicate-market",
              eventSlug: "resolving-duplicate-market",
              outcome: "No",
              outcomeIndex: 1,
              curPrice: 0,
              currentValue: 0,
              cashPnl: -0.9,
              redeemable: true,
            }),
          ]);
        }

        return Response.json([
          makePosition({
            asset: "777",
            conditionId: resolvingConditionId,
            title: "Resolving duplicate market",
            slug: "resolving-duplicate-market",
            eventSlug: "resolving-duplicate-market",
            outcome: "No",
            outcomeIndex: 1,
            curPrice: 0.2,
            currentValue: 0.3,
            cashPnl: -0.6,
            redeemable: false,
          }),
        ]);
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      positions: Array<{ conditionId: string }>;
      lostPositions: Array<{ conditionId: string }>;
    };

    expect(res.status).toBe(200);
    expect(
      body.positions.some((p) => p.conditionId === resolvingConditionId)
    ).toBe(false);
    expect(body.lostPositions).toHaveLength(1);
    expect(body.lostPositions[0]?.conditionId).toBe(resolvingConditionId);
  });

  it("counts winning redeemable rows toward the returned position limit", async () => {
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.searchParams.get("redeemable") === "true") {
          return Response.json([
            makePosition({
              asset: "333",
              conditionId:
                "0x3333333333333333333333333333333333333333333333333333333333333333",
              title: "Low value resolved winner",
              slug: "low-value-resolved-winner",
              eventSlug: "low-value-resolved-winner",
              currentValue: 1,
              curPrice: 1,
              redeemable: true,
            }),
            makePosition({
              asset: "666",
              conditionId:
                "0x6666666666666666666666666666666666666666666666666666666666666666",
              title: "Second low value resolved winner",
              slug: "second-low-value-resolved-winner",
              eventSlug: "second-low-value-resolved-winner",
              currentValue: 0.9,
              curPrice: 1,
              redeemable: true,
            }),
          ]);
        }

        return Response.json([
          makePosition({
            title: "High value France position",
            currentValue: 9,
          }),
          makePosition({
            asset: "444",
            conditionId:
              "0x4444444444444444444444444444444444444444444444444444444444444444",
            title: "High value Spain position",
            slug: "high-value-spain-position",
            eventSlug: "high-value-spain-position",
            currentValue: 8,
          }),
        ]);
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001&limit=2"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      positions: Array<{ market: { title: string } }>;
      pagination: { hasMore: boolean };
    };

    expect(res.status).toBe(200);
    expect(body.positions.map((p) => p.market.title)).toEqual([
      "High value France position",
      "High value Spain position",
    ]);
    expect(body.positions).toHaveLength(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("paginates after merging open and winning redeemable positions", async () => {
    const openRows = [
      makePosition({
        title: "Open rank 1",
        currentValue: 100,
      }),
      makePosition({
        asset: "444",
        conditionId:
          "0x4444444444444444444444444444444444444444444444444444444444444444",
        title: "Open rank 3",
        slug: "open-rank-3",
        eventSlug: "open-rank-3",
        currentValue: 90,
      }),
      makePosition({
        asset: "555",
        conditionId:
          "0x5555555555555555555555555555555555555555555555555555555555555555",
        title: "Open rank 5",
        slug: "open-rank-5",
        eventSlug: "open-rank-5",
        currentValue: 80,
      }),
      makePosition({
        asset: "666",
        conditionId:
          "0x6666666666666666666666666666666666666666666666666666666666666666",
        title: "Open rank 6",
        slug: "open-rank-6",
        eventSlug: "open-rank-6",
        currentValue: 70,
      }),
    ];
    const redeemableRows = [
      makePosition({
        asset: "777",
        conditionId:
          "0x7777777777777777777777777777777777777777777777777777777777777777",
        title: "Redeemable rank 2",
        slug: "redeemable-rank-2",
        eventSlug: "redeemable-rank-2",
        currentValue: 95,
        curPrice: 1,
        redeemable: true,
      }),
      makePosition({
        asset: "888",
        conditionId:
          "0x8888888888888888888888888888888888888888888888888888888888888888",
        title: "Redeemable rank 4",
        slug: "redeemable-rank-4",
        eventSlug: "redeemable-rank-4",
        currentValue: 85,
        curPrice: 1,
        redeemable: true,
      }),
    ];
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.searchParams.get("redeemable") === "true") {
          return Response.json(redeemableRows);
        }
        const upstreamOffset = Number(url.searchParams.get("offset") ?? 0);
        return Response.json(openRows.slice(upstreamOffset));
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001&limit=2&offset=2"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      positions: Array<{ market: { title: string } }>;
      pagination: { hasMore: boolean };
    };

    expect(res.status).toBe(200);
    expect(body.positions.map((p) => p.market.title)).toEqual([
      "Open rank 3",
      "Redeemable rank 4",
    ]);
    expect(body.pagination.hasMore).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);

    const openUrl = new URL(String(upstreamFetch.mock.calls[0]?.[0]));
    const redeemableUrl = new URL(String(upstreamFetch.mock.calls[1]?.[0]));

    expect(openUrl.searchParams.get("offset")).toBe("0");
    expect(openUrl.searchParams.has("redeemable")).toBe(false);
    expect(redeemableUrl.searchParams.get("offset")).toBe("0");
    expect(redeemableUrl.searchParams.get("redeemable")).toBe("true");
  });

  it("preserves deep offset pages instead of only scanning from the first upstream page", async () => {
    const makeRankedPosition = (rank: number) =>
      makePosition({
        asset: `deep-${rank}`,
        conditionId: `0x${rank.toString(16).padStart(64, "0")}`,
        title: `Deep rank ${rank}`,
        slug: `deep-rank-${rank}`,
        eventSlug: `deep-rank-${rank}`,
        currentValue: 10_000 - rank,
      });
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.searchParams.get("redeemable") === "true") {
          return Response.json([]);
        }

        const upstreamOffset = Number(url.searchParams.get("offset") ?? 0);
        const pageLimit = Number(url.searchParams.get("limit") ?? 100);
        if (upstreamOffset === 600) {
          return Response.json([
            makeRankedPosition(601),
            makeRankedPosition(602),
          ]);
        }

        return Response.json(
          Array.from({ length: pageLimit }, (_, index) =>
            makeRankedPosition(upstreamOffset + index + 1)
          )
        );
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001&limit=2&offset=600"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      positions: Array<{ market: { title: string } }>;
    };

    expect(res.status).toBe(200);
    expect(body.positions.map((p) => p.market.title)).toEqual([
      "Deep rank 601",
      "Deep rank 602",
    ]);

    const openOffsets = upstreamFetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.searchParams.get("redeemable") !== "true")
      .map((url) => url.searchParams.get("offset"));
    expect(openOffsets).toContain("600");
  });

  it("does not report hasMore from capped pages that contain only lost rows", async () => {
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.searchParams.get("redeemable") === "true") {
          return Response.json([]);
        }

        const upstreamOffset = Number(url.searchParams.get("offset") ?? 0);
        const pageLimit = Number(url.searchParams.get("limit") ?? 2);
        return Response.json(
          Array.from({ length: pageLimit }, (_, index) =>
            makePosition({
              asset: `lost-${upstreamOffset + index}`,
              conditionId: `0x${String(upstreamOffset + index + 1).padStart(64, "9")}`,
              title: `Lost row ${upstreamOffset + index}`,
              slug: `lost-row-${upstreamOffset + index}`,
              eventSlug: `lost-row-${upstreamOffset + index}`,
              outcome: "No",
              outcomeIndex: 1,
              curPrice: 0,
              currentValue: 0,
              cashPnl: -0.9,
              redeemable: true,
            })
          )
        );
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001&limit=2"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      positions: unknown[];
      pagination: { hasMore: boolean; scanCapped?: boolean };
    };

    expect(res.status).toBe(200);
    expect(body.positions).toHaveLength(0);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.scanCapped).toBe(true);
  });

  it("clears scanCapped when the scan ends exactly at the cap with nothing left upstream", async () => {
    // limit=2 → 3-row upstream pages, 5-page scan = 15 rows. Exactly 15 lost
    // rows upstream: the last page is full (which used to flag scanCapped)
    // but a probe shows nothing remains.
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.searchParams.get("redeemable") === "true") {
          return Response.json([]);
        }
        const upstreamOffset = Number(url.searchParams.get("offset") ?? 0);
        const pageLimit = Number(url.searchParams.get("limit") ?? 2);
        if (upstreamOffset >= 15) return Response.json([]);
        return Response.json(
          Array.from({ length: pageLimit }, (_, index) =>
            makePosition({
              asset: `lost-${upstreamOffset + index}`,
              conditionId: `0x${String(upstreamOffset + index + 1).padStart(64, "8")}`,
              title: `Lost row ${upstreamOffset + index}`,
              slug: `lost-row-${upstreamOffset + index}`,
              eventSlug: `lost-row-${upstreamOffset + index}`,
              outcome: "No",
              outcomeIndex: 1,
              curPrice: 0,
              currentValue: 0,
              cashPnl: -0.9,
              redeemable: true,
            })
          )
        );
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001&limit=2"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      positions: unknown[];
      pagination: { hasMore: boolean; scanCapped?: boolean };
    };

    expect(res.status).toBe(200);
    expect(body.positions).toHaveLength(0);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.scanCapped).toBe(false);
  });

  it("slices deep offsets from the merged row space, not the raw upstream space", async () => {
    // One lost row outranks every open row. The merged list (lost removed)
    // shifts everything by one, so a deep page must slice the merged space —
    // raw-offset passthrough would return rows offset by the lost count.
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.searchParams.get("redeemable") === "true") {
          return Response.json([]);
        }
        const upstreamOffset = Number(url.searchParams.get("offset") ?? 0);
        const pageLimit = Number(url.searchParams.get("limit") ?? 100);
        return Response.json(
          Array.from({ length: pageLimit }, (_, index) => {
            const rank = upstreamOffset + index + 1;
            if (rank === 1) {
              return makePosition({
                asset: "lost-leader",
                conditionId: `0x${"7".repeat(64)}`,
                title: "Lost leader",
                slug: "lost-leader",
                eventSlug: "lost-leader",
                outcome: "No",
                outcomeIndex: 1,
                curPrice: 0,
                currentValue: 0,
                redeemable: true,
              });
            }
            return makePosition({
              asset: `deep-${rank}`,
              conditionId: `0x${rank.toString(16).padStart(64, "0")}`,
              title: `Deep rank ${rank}`,
              slug: `deep-rank-${rank}`,
              eventSlug: `deep-rank-${rank}`,
              currentValue: 10_000 - rank,
            });
          })
        );
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001&limit=2&offset=598"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      positions: Array<{ market: { title: string } }>;
    };

    expect(res.status).toBe(200);
    expect(body.positions.map((p) => p.market.title)).toEqual([
      "Deep rank 600",
      "Deep rank 601",
    ]);
  });

  it("ends pagination explicitly past the merged scan ceiling instead of misaligned rows", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/positions?user=0x0000000000000000000000000000000000000001&limit=50&offset=1000"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      positions: unknown[];
      lostPositions: unknown[];
      pagination: { hasMore: boolean; scanCapped?: boolean };
    };

    expect(res.status).toBe(200);
    expect(body.positions).toEqual([]);
    expect(body.lostPositions).toEqual([]);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.scanCapped).toBe(true);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
