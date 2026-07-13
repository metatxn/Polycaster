import { describe, expect, it } from "vitest";
import {
  buildEventSitemapRoute,
  buildEventSitemapRoutes,
  buildSitemapEventQueries,
  buildStaticSitemapRoutes,
} from "./sitemap";

describe("buildStaticSitemapRoutes", () => {
  it("contains canonical category URLs instead of redirect aliases", () => {
    const urls = buildStaticSitemapRoutes().map((route) => route.url);

    expect(urls).toContain("https://knoww.app/events/tech");
    expect(urls).toContain("https://knoww.app/events/pop-culture");
    expect(urls).toContain("https://knoww.app/events/economy");
    expect(urls).toContain("https://knoww.app/events/geopolitics");
    expect(urls).toContain("https://knoww.app/events/earnings");
    expect(urls).toContain("https://knoww.app/events/mention-markets");
    expect(urls).not.toContain("https://knoww.app/events/sports");
    expect(urls).not.toContain("https://knoww.app/events/technology");
    expect(urls).not.toContain("https://knoww.app/events/culture");
    expect(urls).not.toContain("https://knoww.app/events/economics");
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

describe("buildSitemapEventQueries", () => {
  it("discovers both live events and a guarded set of resolved events", () => {
    const queries = buildSitemapEventQueries();

    expect(queries).toHaveLength(2);
    expect(queries[0].params.get("active")).toBe("true");
    expect(queries[0].params.get("closed")).toBe("false");
    expect(queries[1].params.get("closed")).toBe("true");
    expect(queries[1].params.get("order")).toBe("volume");
    expect(queries[1].maxItems).toBeLessThan(queries[0].maxItems);
  });
});

describe("buildEventSitemapRoutes", () => {
  it("caches only final URL and modification-date fields", () => {
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

    expect(buildEventSitemapRoutes([event])).toEqual([
      {
        url: "https://knoww.app/events/detail/world-cup-winner",
        lastModified: new Date("2026-07-12T08:30:00.000Z"),
      },
    ]);
  });
});

describe("buildEventSitemapRoute", () => {
  it("uses an event's real updated date", () => {
    const route = buildEventSitemapRoute({
      slug: "world-cup-winner",
      updatedAt: "2026-07-12T08:30:00.000Z",
    });

    expect(route).toEqual({
      url: "https://knoww.app/events/detail/world-cup-winner",
      lastModified: new Date("2026-07-12T08:30:00.000Z"),
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
