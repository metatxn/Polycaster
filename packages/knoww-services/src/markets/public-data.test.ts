import { describe, expect, it, vi } from "vitest";
import {
  CLOB_API_BASE,
  DATA_API_BASE,
  fetchEventLiveVolume,
  fetchEventPage,
  fetchMarketHolders,
  fetchMarketPageByTagSlug,
  fetchMarketQuotes,
  fetchMarketTrades,
  fetchOpenInterest,
  fetchSportsMarketTypes,
  fetchSportsMetadata,
  fetchSportsTeams,
  fetchTags,
  fetchTraderLeaderboard,
  GAMMA_API_BASE,
} from "./public-data";

const CONDITION_ID = `0x${"a".repeat(64)}`;
const WALLET = `0x${"b".repeat(40)}`;
const TOKEN_ID = "123456789";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recordingFetch(
  respond: (url: URL, init: RequestInit | undefined, index: number) => Response
) {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: new URL(String(input)), init };
      calls.push(call);
      return respond(call.url, init, calls.length - 1);
    }
  ) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("public market data clients", () => {
  it("lists events through keyset pagination and normalizes decimals", async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse({
        events: [
          {
            id: "7",
            slug: "fed-decision",
            title: "Fed decision",
            description: "Quoted upstream text",
            active: true,
            closed: false,
            volume: 1200.5,
            liquidity: "900.25",
            markets: [],
            tags: [{ id: "1", label: "Economics", slug: "economics" }],
          },
        ],
        next_cursor: "next-page",
      })
    );

    const page = await fetchEventPage(
      {
        limit: 10,
        closed: false,
        live: true,
        tagSlug: "economics",
        seriesIds: [42],
        order: "volume24hr",
        ascending: false,
      },
      { fetchImpl }
    );

    expect(calls[0].url.origin).toBe(GAMMA_API_BASE);
    expect(calls[0].url.pathname).toBe("/events/keyset");
    expect(calls[0].url.searchParams.get("tag_slug")).toBe("economics");
    expect(calls[0].url.searchParams.get("live")).toBe("true");
    expect(calls[0].url.searchParams.get("series_id")).toBe("42");
    expect(page).toMatchObject({
      nextCursor: "next-page",
      events: [{ volume: "1200.5", liquidity: "900.25" }],
    });
  });

  it("requests bounded trades by condition id", async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse([
        {
          proxyWallet: WALLET,
          side: "BUY",
          asset: TOKEN_ID,
          conditionId: CONDITION_ID,
          size: 10,
          price: 0.42,
          timestamp: 1_800_000_000,
          title: "Market",
          slug: "market",
          eventSlug: "event",
          outcome: "Yes",
          outcomeIndex: 0,
          transactionHash: `0x${"c".repeat(64)}`,
        },
      ])
    );

    const trades = await fetchMarketTrades(
      { conditionIds: [CONDITION_ID], side: "BUY", limit: 25, offset: 0 },
      { fetchImpl }
    );

    expect(calls[0].url.origin).toBe(DATA_API_BASE);
    expect(calls[0].url.pathname).toBe("/trades");
    expect(calls[0].url.searchParams.get("market")).toBe(CONDITION_ID);
    expect(trades[0]).toMatchObject({ size: "10", price: "0.42" });
  });

  it("combines the four documented CLOB quote endpoints", async () => {
    const { calls, fetchImpl } = recordingFetch((url) => {
      switch (url.pathname) {
        case "/prices":
          return jsonResponse({ [TOKEN_ID]: { BUY: 0.44, SELL: "0.46" } });
        case "/midpoints":
          return jsonResponse({ [TOKEN_ID]: "0.45" });
        case "/spreads":
          return jsonResponse({ [TOKEN_ID]: "0.02" });
        case "/last-trades-prices":
          return jsonResponse([
            { token_id: TOKEN_ID, price: "0.43", side: "SELL" },
          ]);
        default:
          return jsonResponse({}, 404);
      }
    });

    const quotes = await fetchMarketQuotes([TOKEN_ID], { fetchImpl });

    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.url.origin === CLOB_API_BASE)).toBe(true);
    expect(quotes).toEqual([
      {
        tokenId: TOKEN_ID,
        buyPrice: "0.44",
        sellPrice: "0.46",
        midpoint: "0.45",
        spread: "0.02",
        lastTradePrice: "0.43",
        lastTradeSide: "SELL",
      },
    ]);
  });

  it("fetches holders, open interest, and event live volume", async () => {
    const { fetchImpl } = recordingFetch((url) => {
      if (url.pathname === "/holders") {
        return jsonResponse([
          {
            token: TOKEN_ID,
            holders: [
              {
                proxyWallet: WALLET,
                asset: TOKEN_ID,
                amount: 500.25,
                outcomeIndex: 0,
              },
            ],
          },
        ]);
      }
      if (url.pathname === "/oi") {
        return jsonResponse([{ market: CONDITION_ID, value: 1234.5 }]);
      }
      return jsonResponse([
        { total: 800, markets: [{ market: CONDITION_ID, value: 800 }] },
      ]);
    });

    await expect(
      fetchMarketHolders(
        { conditionIds: [CONDITION_ID], limit: 10, minBalance: 1 },
        { fetchImpl }
      )
    ).resolves.toMatchObject([
      { holders: [{ amount: "500.25", proxyWallet: WALLET }] },
    ]);
    await expect(
      fetchOpenInterest([CONDITION_ID], { fetchImpl })
    ).resolves.toEqual([{ conditionId: CONDITION_ID, value: "1234.5" }]);
    await expect(fetchEventLiveVolume(7, { fetchImpl })).resolves.toEqual({
      eventId: 7,
      total: "800",
      markets: [{ conditionId: CONDITION_ID, value: "800" }],
    });
  });

  it("fetches leaderboard and tag records with decimal strings", async () => {
    const { fetchImpl } = recordingFetch((url) => {
      if (url.pathname === "/v1/leaderboard") {
        return jsonResponse([
          {
            rank: "1",
            proxyWallet: WALLET,
            userName: "alice",
            vol: 1000.5,
            pnl: -12.25,
            verifiedBadge: true,
          },
        ]);
      }
      return jsonResponse([{ id: "1", label: "Economics", slug: "economics" }]);
    });

    await expect(
      fetchTraderLeaderboard(
        {
          category: "OVERALL",
          timePeriod: "DAY",
          orderBy: "PNL",
          limit: 25,
          offset: 0,
        },
        { fetchImpl }
      )
    ).resolves.toMatchObject([{ volume: "1000.5", pnl: "-12.25" }]);
    await expect(
      fetchTags({ limit: 20, offset: 0 }, { fetchImpl })
    ).resolves.toEqual([{ id: "1", label: "Economics", slug: "economics" }]);
  });

  it("fetches sports metadata, types, teams, and markets by tag slug", async () => {
    const { fetchImpl } = recordingFetch((url) => {
      if (url.pathname === "/sports") {
        return jsonResponse([
          {
            sport: "football",
            image: "https://example.com/football.png",
            resolution: "https://example.com/rules",
            ordering: "home",
            tags: "4",
            series: "8",
          },
        ]);
      }
      if (url.pathname === "/sports/market-types") {
        return jsonResponse({ marketTypes: ["moneyline"] });
      }
      if (url.pathname === "/teams") {
        return jsonResponse([
          { id: "1", name: "Team A", league: "nfl", abbreviation: "A" },
        ]);
      }
      if (url.pathname === "/tags/slug/nfl") {
        return jsonResponse({ id: "4", label: "NFL", slug: "nfl" });
      }
      return jsonResponse({
        markets: [
          {
            id: "5",
            slug: "team-a-win",
            question: "Will Team A win?",
            conditionId: CONDITION_ID,
            outcomes: '["Yes","No"]',
            outcomePrices: '["0.6","0.4"]',
            clobTokenIds: `["${TOKEN_ID}","987654321"]`,
          },
        ],
        next_cursor: "sports-next",
      });
    });

    await expect(fetchSportsMetadata({ fetchImpl })).resolves.toHaveLength(1);
    await expect(fetchSportsMarketTypes({ fetchImpl })).resolves.toEqual([
      "moneyline",
    ]);
    await expect(
      fetchSportsTeams({ league: "nfl", limit: 20, offset: 0 }, { fetchImpl })
    ).resolves.toMatchObject([{ name: "Team A" }]);
    await expect(
      fetchMarketPageByTagSlug({ tagSlug: "nfl", limit: 20 }, { fetchImpl })
    ).resolves.toMatchObject({
      nextCursor: "sports-next",
      markets: [{ conditionId: CONDITION_ID }],
    });
  });
});
