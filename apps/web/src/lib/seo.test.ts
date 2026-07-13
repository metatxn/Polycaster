import { describe, expect, it } from "vitest";
import {
  buildEventDetailPath,
  buildNoIndexMetadata,
  buildPredictionMarketTitle,
  shouldIndexEventPage,
  shouldListEventInSitemap,
} from "./seo";

describe("buildEventDetailPath", () => {
  it("uses the event slug instead of a numeric lookup alias", () => {
    expect(buildEventDetailPath("30615", "world-cup-winner")).toBe(
      "/events/detail/world-cup-winner"
    );
  });

  it("falls back to the requested identifier when the API has no slug", () => {
    expect(buildEventDetailPath("30615", null)).toBe("/events/detail/30615");
  });
});

describe("buildPredictionMarketTitle", () => {
  it("adds search intent while cleaning whitespace", () => {
    expect(buildPredictionMarketTitle("  World Cup Winner  ")).toBe(
      "World Cup Winner Polymarket Odds"
    );
  });

  it("does not duplicate prediction-market wording", () => {
    expect(buildPredictionMarketTitle("Bitcoin Prediction Market")).toBe(
      "Bitcoin Prediction Market"
    );
  });
});

describe("buildNoIndexMetadata", () => {
  it("keeps utility pages crawlable so robots can see the noindex directive", () => {
    expect(
      buildNoIndexMetadata({
        title: "Search Markets",
        description: "Search Knoww markets.",
      })
    ).toEqual({
      title: "Search Markets",
      description: "Search Knoww markets.",
      robots: { index: false, follow: true },
    });
  });
});

describe("shouldIndexEventPage", () => {
  it("indexes active events with at least one open market", () => {
    expect(
      shouldIndexEventPage({
        title: "World Cup Winner",
        active: true,
        closed: false,
        archived: false,
        markets: [{ id: "1", active: true, closed: false }],
      })
    ).toBe(true);
  });

  it("does not index archived events", () => {
    expect(
      shouldIndexEventPage({
        title: "Archived Market",
        active: false,
        archived: true,
        markets: [{ id: "1", active: true, closed: false }],
      })
    ).toBe(false);
  });

  it("does not index events without open markets", () => {
    expect(
      shouldIndexEventPage({
        title: "Closed Market",
        active: false,
        closed: true,
        markets: [{ id: "1", active: true, closed: true }],
      })
    ).toBe(false);
  });

  it("indexes resolved events only when they have durable context and meaningful volume", () => {
    const event = {
      slug: "world-cup-2026-winner",
      title: "World Cup 2026 Winner",
      description:
        "This market resolves to the team that wins the 2026 FIFA World Cup after the final match is completed and the official result is published.",
      volume: "250000",
      active: false,
      closed: true,
      markets: [
        {
          id: "1",
          active: false,
          closed: true,
          umaResolutionStatus: "resolved",
        },
      ],
    };

    expect(shouldIndexEventPage(event)).toBe(true);
    expect(shouldListEventInSitemap(event)).toBe(true);
  });

  it("does not index thin resolved events solely because they are settled", () => {
    expect(
      shouldIndexEventPage({
        slug: "thin-resolved-event",
        title: "Thin Resolved Event",
        description: "Resolved.",
        volume: "50",
        active: false,
        closed: true,
        markets: [
          {
            id: "1",
            active: false,
            closed: true,
            umaResolutionStatus: "resolved",
          },
        ],
      })
    ).toBe(false);
  });

  it("keeps live, upcoming, closed, and resolved markets in the expected SEO states", () => {
    const cases = [
      {
        name: "live",
        event: {
          slug: "fifa-live",
          title: "FIFA Live",
          active: true,
          closed: false,
          live: true,
          markets: [{ id: "1", active: true, closed: false }],
        },
        indexable: true,
      },
      {
        name: "upcoming",
        event: {
          slug: "fifa-upcoming",
          title: "FIFA Upcoming",
          active: true,
          closed: false,
          ended: false,
          markets: [{ id: "1", active: true, closed: false }],
        },
        indexable: true,
      },
      {
        name: "closed",
        event: {
          slug: "fifa-closed",
          title: "FIFA Closed",
          active: false,
          closed: true,
          markets: [{ id: "1", active: false, closed: true }],
        },
        indexable: false,
      },
      {
        name: "resolved",
        event: {
          slug: "fifa-resolved",
          title: "FIFA Resolved",
          active: true,
          closed: false,
          markets: [
            {
              id: "1",
              active: true,
              closed: false,
              umaResolutionStatus: "resolved",
            },
          ],
        },
        indexable: false,
      },
      {
        name: "unresolved",
        event: {
          slug: "fifa-unresolved",
          title: "FIFA Unresolved",
          active: true,
          closed: false,
          markets: [
            {
              id: "1",
              active: true,
              closed: false,
              umaResolutionStatus: "unresolved",
            },
          ],
        },
        indexable: true,
      },
    ];

    for (const { event, indexable } of cases) {
      expect(shouldIndexEventPage(event)).toBe(indexable);
      expect(shouldListEventInSitemap(event)).toBe(indexable);
    }
  });
});

describe("shouldListEventInSitemap", () => {
  it("lists canonical active events with slugs and open markets", () => {
    expect(
      shouldListEventInSitemap({
        slug: "world-cup-winner",
        title: "World Cup Winner",
        active: true,
        closed: false,
        archived: false,
        markets: [{ id: "1", active: true, closed: false }],
      })
    ).toBe(true);
  });

  it("does not list events that are not indexable", () => {
    expect(
      shouldListEventInSitemap({
        slug: "closed-market",
        title: "Closed Market",
        active: false,
        closed: true,
        markets: [{ id: "1", active: true, closed: true }],
      })
    ).toBe(false);
  });

  it("does not list child events that duplicate their parent page", () => {
    expect(
      shouldListEventInSitemap({
        slug: "world-cup-winner-more-markets",
        title: "World Cup Winner More Markets",
        parentEventId: "30615",
        active: true,
        closed: false,
        markets: [{ id: "1", active: true, closed: false }],
      })
    ).toBe(false);
  });
});
