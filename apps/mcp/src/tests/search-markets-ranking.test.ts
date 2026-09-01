import { describe, expect, it } from "vitest";
import {
  callTool,
  expectGammaFetch,
  gammaUrl,
  setupGammaFetchStub,
  type ToolCallResult,
} from "./helpers";

setupGammaFetchStub();

const searchEvent = {
  id: "evt-war",
  slug: "geopolitical-outcomes",
  title: "Geopolitical outcomes",
  active: true,
  closed: false,
  endDate: "2027-01-01T00:00:00Z",
  markets: [
    {
      id: "mkt-awards",
      slug: "awards-show",
      question: "Will the awards show air?",
      active: true,
      closed: false,
      conditionId:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      volumeNum: 1000,
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.7","0.3"]',
      clobTokenIds: '["11","12"]',
    },
    {
      id: "mkt-war-funding",
      slug: "war-funding",
      question: "Will war funding pass?",
      active: true,
      closed: false,
      conditionId:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      volumeNum: 100,
      liquidityNum: 25,
      endDate: "2026-10-01T00:00:00Z",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.45","0.55"]',
      clobTokenIds: '["21","22"]',
    },
    {
      id: "mkt-war-end",
      slug: "war-end",
      question: "Will the war end?",
      active: true,
      closed: false,
      conditionId:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      volume: "30.5",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.2","0.8"]',
      clobTokenIds: '["31","32"]',
    },
    {
      id: "mkt-warcraft",
      slug: "warcraft-release",
      question: "Will Warcraft release?",
      active: true,
      closed: false,
      volumeNum: 500,
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.1","0.9"]',
    },
  ],
};

function searchResponse(): Response {
  return Response.json({
    events: [searchEvent],
    tags: [],
    profiles: [],
    pagination: { hasMore: false, totalResults: 1 },
  });
}

describe("search_markets ranked market results", () => {
  it("filters whole words, ranks individual markets by volume, and enriches results", async () => {
    expectGammaFetch(
      "ranked whole-word search",
      gammaUrl("/public-search", "q=war"),
      searchResponse
    );

    const { message } = await callTool("search_markets", 101, {
      query: "war",
      resultType: "markets",
      match: "whole_word",
      sortBy: "volume",
      sortOrder: "desc",
      limit: 20,
    });

    expect(message.error).toBeUndefined();
    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.markets).toEqual([
      {
        id: "mkt-war-funding",
        slug: "war-funding",
        conditionId:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        question: "Will war funding pass?",
        status: "active",
        platform: "polymarket",
        url: "https://knoww.app/events/detail/war-funding",
        endDate: "2026-10-01T00:00:00Z",
        volume: "100",
        volumeUnit: "unspecified",
        liquidity: "25",
        totalOutcomes: 2,
        outcomes: [
          { name: "Yes", price: "0.45", tokenId: "21" },
          { name: "No", price: "0.55", tokenId: "22" },
        ],
        event: {
          id: "evt-war",
          slug: "geopolitical-outcomes",
          title: "Geopolitical outcomes",
          url: "https://knoww.app/events/detail/geopolitical-outcomes",
        },
      },
      {
        id: "mkt-war-end",
        slug: "war-end",
        conditionId:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        question: "Will the war end?",
        status: "active",
        platform: "polymarket",
        url: "https://knoww.app/events/detail/war-end",
        endDate: "2027-01-01T00:00:00Z",
        volume: "30.5",
        volumeUnit: "unspecified",
        totalOutcomes: 2,
        outcomes: [
          { name: "Yes", price: "0.2", tokenId: "31" },
          { name: "No", price: "0.8", tokenId: "32" },
        ],
        event: {
          id: "evt-war",
          slug: "geopolitical-outcomes",
          title: "Geopolitical outcomes",
          url: "https://knoww.app/events/detail/geopolitical-outcomes",
        },
      },
    ]);
    expect(result.structuredContent?.page).toEqual({
      totalResults: 2,
      returnedResults: 2,
      hasMore: false,
    });
    expect(result.structuredContent).not.toHaveProperty("events");
    expect(result.structuredContent?.meta).not.toHaveProperty("nextCursor");
  });

  it("continues ranked results with an opaque cursor", async () => {
    expectGammaFetch(
      "ranked search first page",
      gammaUrl("/public-search", "q=will"),
      searchResponse
    );

    const first = await callTool("search_markets", 102, {
      query: "will",
      resultType: "markets",
      match: "contains",
      sortBy: "volume",
      sortOrder: "desc",
      limit: 2,
    });
    const firstResult = first.message.result as ToolCallResult;
    expect(firstResult.structuredContent?.markets).toHaveLength(2);
    expect(firstResult.structuredContent?.page).toEqual({
      totalResults: 4,
      returnedResults: 2,
      hasMore: true,
    });
    const cursor = (
      firstResult.structuredContent?.meta as { nextCursor?: string }
    )?.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    expect(cursor).not.toContain("will");

    expectGammaFetch(
      "ranked search second page",
      gammaUrl("/public-search", "q=will"),
      searchResponse
    );
    const second = await callTool("search_markets", 103, {
      query: "will",
      resultType: "markets",
      match: "contains",
      sortBy: "volume",
      sortOrder: "desc",
      limit: 2,
      cursor,
    });
    const secondResult = second.message.result as ToolCallResult;
    const secondMarkets = secondResult.structuredContent?.markets as
      | Array<{ id: string }>
      | undefined;
    expect(secondMarkets?.map(({ id }) => id)).toEqual([
      "mkt-war-funding",
      "mkt-war-end",
    ]);
    expect(secondResult.structuredContent?.page).toEqual({
      totalResults: 4,
      returnedResults: 2,
      hasMore: false,
    });
    expect(secondResult.structuredContent?.meta).not.toHaveProperty(
      "nextCursor"
    );
  });

  it("matches a normalized phrase without matching a longer word", async () => {
    expectGammaFetch(
      "exact phrase search",
      gammaUrl("/public-search", "q=Donald+Trump"),
      () =>
        Response.json({
          events: [
            {
              id: "evt-trump",
              slug: "us-politics",
              title: "US politics",
              active: true,
              closed: false,
              markets: [
                {
                  id: "mkt-donald-trump",
                  question: "Will Donald   Trump attend?",
                  active: true,
                  closed: false,
                  outcomes: '["Yes","No"]',
                  outcomePrices: '["0.4","0.6"]',
                },
                {
                  id: "mkt-donald-trumpet",
                  question: "Will Donald Trumpet perform?",
                  active: true,
                  closed: false,
                  outcomes: '["Yes","No"]',
                  outcomePrices: '["0.2","0.8"]',
                },
              ],
            },
          ],
          tags: [],
          profiles: [],
          pagination: { hasMore: false, totalResults: 1 },
        })
    );

    const { message } = await callTool("search_markets", 104, {
      query: "Donald Trump",
      resultType: "markets",
      match: "exact_phrase",
      limit: 20,
    });

    const result = message.result as ToolCallResult;
    const markets = result.structuredContent?.markets as
      | Array<{ id: string }>
      | undefined;
    expect(markets?.map(({ id }) => id)).toEqual(["mkt-donald-trump"]);
  });

  it("rejects an invalid cursor before calling the upstream search", async () => {
    const { message } = await callTool("search_markets", 105, {
      query: "war",
      resultType: "markets",
      cursor: "not-a-cursor",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
  });
});
