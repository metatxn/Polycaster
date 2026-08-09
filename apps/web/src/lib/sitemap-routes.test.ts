import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDES } from "./guides";
import {
  buildCategorySitemapRoutes,
  buildEventSitemapRoute,
  buildEventSitemapRoutes,
  buildGuideSitemapRoutes,
  buildSitemapEventQueries,
  buildSitemapIndexUrls,
  buildStaticSitemapRoutes,
  escapeXml,
  fetchSitemapEventRoutes,
  renderSitemapIndexXml,
  renderUrlSetXml,
  SITEMAP_SEGMENTS,
} from "./sitemap-routes";
import { SPORT_GROUPS } from "./sport-categories";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildStaticSitemapRoutes", () => {
  it("lists the core canonical pages, including the trust pages", () => {
    const urls = buildStaticSitemapRoutes().map((route) => route.url);

    expect(urls).toContain("https://knoww.app/");
    expect(urls).toContain("https://knoww.app/markets");
    expect(urls).toContain("https://knoww.app/extension");
    expect(urls).toContain("https://knoww.app/about");
    expect(urls).toContain("https://knoww.app/how-knoww-works");
    expect(urls).toContain("https://knoww.app/privacy");
    expect(urls).toContain("https://knoww.app/terms");
  });

  it("leaves category URLs to the categories segment", () => {
    const urls = buildStaticSitemapRoutes().map((route) => route.url);

    expect(urls.some((url) => url.includes("/events/"))).toBe(false);
  });

  it("contains each static URL once and does not claim a fresh modification date", () => {
    const routes = buildStaticSitemapRoutes();
    const urls = routes.map((route) => route.url);

    expect(new Set(urls).size).toBe(urls.length);
    expect(routes.every((route) => route.lastModified === undefined)).toBe(
      true
    );
  });
});

describe("buildCategorySitemapRoutes", () => {
  const populatedSportCounts = Object.fromEntries([
    ["sports", 1],
    ...SPORT_GROUPS.flatMap((group) => [
      [group.tagSlug, 1],
      ...group.leagues.map((league) => [league.tagSlug, 1]),
    ]),
  ]);

  it("contains canonical category URLs instead of redirect aliases", () => {
    const urls = buildCategorySitemapRoutes(populatedSportCounts).map(
      (route) => route.url
    );

    expect(urls).toContain("https://knoww.app/events/tech");
    expect(urls).toContain("https://knoww.app/events/pop-culture");
    expect(urls).toContain("https://knoww.app/events/economy");
    expect(urls).toContain("https://knoww.app/events/geopolitics");
    expect(urls).toContain("https://knoww.app/events/earnings");
    expect(urls).toContain("https://knoww.app/events/mention-markets");
    expect(urls).toContain("https://knoww.app/events/sports/live");
    expect(urls).not.toContain("https://knoww.app/events/sports");
    expect(urls).not.toContain("https://knoww.app/events/technology");
    expect(urls).not.toContain("https://knoww.app/events/culture");
    expect(urls).not.toContain("https://knoww.app/events/economics");
  });

  it("omits sports categories with a successful zero inventory count", () => {
    const emptyGroup = SPORT_GROUPS[0];
    const populatedGroup = SPORT_GROUPS.at(-1);
    const counts = {
      ...populatedSportCounts,
      [emptyGroup.tagSlug]: 0,
    };

    const urls = buildCategorySitemapRoutes(counts).map((route) => route.url);

    expect(urls).not.toContain(
      `https://knoww.app/events/sports/${emptyGroup.slug}`
    );
    expect(urls).toContain(
      `https://knoww.app/events/sports/${populatedGroup?.slug}`
    );
  });
});

describe("buildGuideSitemapRoutes", () => {
  it("lists the guides index and every registered guide with its content date", () => {
    const routes = buildGuideSitemapRoutes();
    const urls = routes.map((route) => route.url);

    expect(urls[0]).toBe("https://knoww.app/guides");
    expect(routes).toHaveLength(GUIDES.length + 1);
    for (const guide of GUIDES) {
      const route = routes.find(
        (entry) => entry.url === `https://knoww.app/guides/${guide.slug}`
      );
      expect(route?.lastModified).toBe(guide.dateModified);
    }
  });
});

describe("buildSitemapEventQueries", () => {
  it("queries active events for the live-markets segment", () => {
    const queries = buildSitemapEventQueries("active");

    expect(queries).toHaveLength(1);
    expect(queries[0].params.get("active")).toBe("true");
    expect(queries[0].params.get("closed")).toBe("false");
    expect(queries[0].params.get("archived")).toBe("false");
    expect(queries[0].params.get("order")).toBe("volume24hr");
  });

  it("queries closed events separately for durable evergreen results", () => {
    const queries = buildSitemapEventQueries("evergreen");

    expect(queries).toHaveLength(1);
    expect(queries[0].params.get("closed")).toBe("true");
    expect(queries[0].params.get("archived")).toBe("false");
    expect(queries[0].params.get("order")).toBe("volume");
  });
});

describe("fetchSitemapEventRoutes", () => {
  it("throws when the upstream catalog is unavailable instead of caching an empty sitemap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Gamma unavailable"))
    );

    await expect(fetchSitemapEventRoutes("active")).rejects.toThrow(
      "Gamma unavailable"
    );
  });
});

describe("buildEventSitemapRoutes", () => {
  it("does not treat volatile market-feed updates as page modifications", () => {
    const event = {
      slug: "world-cup-winner",
      title: "World Cup Winner",
      description: "Resolution details",
      volume: "250000",
      active: true,
      closed: false,
      archived: false,
      updatedAt: "2026-07-12T08:30:00.000Z",
      image: "https://example.com/large-image.png",
      markets: [
        {
          id: "1",
          active: true,
          closed: false,
          umaResolutionStatus: "unresolved",
          question: "A large nested market payload",
        },
      ],
    };

    expect(buildEventSitemapRoutes([event], "active")).toEqual([
      {
        url: "https://knoww.app/events/detail/world-cup-winner",
      },
    ]);
  });

  it("keeps resolved evergreen pages out of the active sitemap", () => {
    const event = {
      slug: "world-cup-result",
      title: "World Cup Result",
      description:
        "This market resolved from the official tournament result after the final match and contains detailed settlement context for readers.",
      volume: "250000",
      active: false,
      closed: true,
      archived: false,
      markets: [
        {
          id: "1",
          active: false,
          closed: true,
          umaResolutionStatus: "resolved",
        },
      ],
    };

    expect(buildEventSitemapRoutes([event], "active")).toEqual([]);
    expect(buildEventSitemapRoutes([event], "evergreen")).toEqual([
      {
        url: "https://knoww.app/events/detail/world-cup-result",
      },
    ]);
  });

  it("omits closed-unresolved pages from both market sitemaps", () => {
    const event = {
      slug: "unsettled-final",
      title: "Unsettled Final",
      description:
        "This market has detailed rules and enough explanatory context, but its settlement is still pending and must not be called a result.",
      volume: "250000",
      active: false,
      closed: true,
      markets: [
        {
          id: "1",
          active: false,
          closed: true,
          umaResolutionStatus: "proposed",
        },
      ],
    };

    expect(buildEventSitemapRoutes([event], "active")).toEqual([]);
    expect(buildEventSitemapRoutes([event], "evergreen")).toEqual([]);
  });
});

describe("buildEventSitemapRoute", () => {
  it("omits lastModified when only the volatile feed timestamp is available", () => {
    const route = buildEventSitemapRoute({
      slug: "world-cup-winner",
      updatedAt: "2026-07-12T08:30:00.000Z",
    });

    expect(route).toEqual({
      url: "https://knoww.app/events/detail/world-cup-winner",
    });
  });

  it("omits lastModified when the source has no valid content date", () => {
    expect(
      buildEventSitemapRoute({
        slug: "world-cup-winner",
        updatedAt: "not-a-date",
      })
    ).toEqual({
      url: "https://knoww.app/events/detail/world-cup-winner",
    });
  });

  it("does not present schedule dates as content modification dates", () => {
    expect(
      buildEventSitemapRoute({
        slug: "world-cup-winner",
        startDate: "2026-06-01T00:00:00.000Z",
        endDate: "2026-07-19T00:00:00.000Z",
      })
    ).toEqual({
      url: "https://knoww.app/events/detail/world-cup-winner",
    });
  });
});

describe("sitemap index", () => {
  it("publishes active and evergreen market URLs in separate segments", () => {
    expect(SITEMAP_SEGMENTS).toContain("markets");
    expect(SITEMAP_SEGMENTS).toContain("evergreen-markets");
  });

  it("points at every segment as a .xml file", () => {
    expect(buildSitemapIndexUrls()).toEqual(
      SITEMAP_SEGMENTS.map(
        (segment) => `https://knoww.app/sitemaps/${segment}.xml`
      )
    );
  });

  it("renders sitemap index XML without lastmod entries", () => {
    const xml = renderSitemapIndexXml([
      "https://knoww.app/sitemaps/static.xml",
    ]);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    expect(xml).toContain(
      "<sitemap><loc>https://knoww.app/sitemaps/static.xml</loc></sitemap>"
    );
    expect(xml).not.toContain("<lastmod>");
  });
});

describe("renderUrlSetXml", () => {
  it("renders locs, normalizes lastModified to ISO, and omits it when absent", () => {
    const xml = renderUrlSetXml([
      { url: "https://knoww.app/markets" },
      {
        url: "https://knoww.app/guides/what-is-a-prediction-market",
        lastModified: "2026-08-08",
      },
      {
        url: "https://knoww.app/events/detail/world-cup-winner",
        lastModified: new Date("2026-07-12T08:30:00.000Z"),
      },
    ]);

    expect(xml).toContain("<url><loc>https://knoww.app/markets</loc></url>");
    expect(xml).toContain(
      "<url><loc>https://knoww.app/guides/what-is-a-prediction-market</loc><lastmod>2026-08-08T00:00:00.000Z</lastmod></url>"
    );
    expect(xml).toContain(
      "<url><loc>https://knoww.app/events/detail/world-cup-winner</loc><lastmod>2026-07-12T08:30:00.000Z</lastmod></url>"
    );
  });

  it("escapes XML-reserved characters in URLs", () => {
    const xml = renderUrlSetXml([
      { url: "https://knoww.app/events/detail/a&b<c>" },
    ]);

    expect(xml).toContain(
      "<loc>https://knoww.app/events/detail/a&amp;b&lt;c&gt;</loc>"
    );
    expect(xml).not.toContain("a&b");
  });
});

describe("escapeXml", () => {
  it("escapes all five reserved characters", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});
