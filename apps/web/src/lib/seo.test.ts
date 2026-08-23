import { describe, expect, it } from "vitest";
import {
  buildEventDetailPath,
  buildEventPageDescription,
  buildEventPageTitle,
  buildNoIndexMetadata,
  getEventSeoStatus,
  isEventClosedForSeo,
  isEventResolvedForSeo,
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

describe("buildEventPageTitle", () => {
  it("applies the live template while cleaning whitespace", () => {
    expect(buildEventPageTitle("  World Cup Winner  ")).toBe(
      "World Cup Winner — Live Odds & Probability"
    );
  });

  it("does not claim a result for a closed but unresolved event", () => {
    expect(buildEventPageTitle("World Cup Winner", { status: "closed" })).toBe(
      "World Cup Winner — Trading Closed & Final Odds"
    );
  });

  it("applies the result template only to resolved events", () => {
    expect(
      buildEventPageTitle("World Cup Winner", { status: "resolved" })
    ).toBe("World Cup Winner — Result & Final Odds");
  });

  it("falls back to a generic title when the event has no usable title", () => {
    expect(buildEventPageTitle("   ")).toBe("Prediction Markets");
  });
});

describe("buildEventPageDescription", () => {
  it("embeds the question in the live template", () => {
    expect(buildEventPageDescription({ title: "World Cup Winner" })).toBe(
      "Follow live odds for World Cup Winner. View the leading outcome, probability movement, volume, liquidity, and resolution date."
    );
  });

  it("describes final trading odds without claiming an unresolved result", () => {
    expect(
      buildEventPageDescription({ title: "World Cup Winner", status: "closed" })
    ).toBe(
      "Trading has ended for World Cup Winner. Review the final trading odds, volume, resolution criteria, and settlement status on Knoww."
    );
  });

  it("embeds the question in the resolved template", () => {
    expect(
      buildEventPageDescription({
        title: "World Cup Winner",
        status: "resolved",
      })
    ).toBe(
      "See the final result, closing probability, and market history for World Cup Winner on Knoww."
    );
  });
});

describe("isEventClosedForSeo", () => {
  it("treats closed or ended events as closed and everything else as live", () => {
    expect(isEventClosedForSeo({ closed: true })).toBe(true);
    expect(isEventClosedForSeo({ ended: true })).toBe(true);
    expect(isEventClosedForSeo({ closed: false, ended: false })).toBe(false);
    expect(isEventClosedForSeo(null)).toBe(false);
  });
});

describe("event settlement state", () => {
  const resolvedMarket = {
    id: "1",
    active: false,
    closed: true,
    umaResolutionStatus: "resolved",
  };

  it("distinguishes live, closed-unresolved, and resolved events", () => {
    expect(
      getEventSeoStatus({
        active: true,
        closed: false,
        markets: [{ id: "1", active: true, closed: false }],
      })
    ).toBe("live");
    expect(
      getEventSeoStatus({
        active: false,
        closed: true,
        markets: [{ id: "1", active: false, closed: true }],
      })
    ).toBe("closed");
    expect(
      getEventSeoStatus({
        active: false,
        closed: true,
        markets: [resolvedMarket],
      })
    ).toBe("resolved");
  });

  it("does not treat proposed or partially settled events as resolved", () => {
    expect(
      isEventResolvedForSeo({
        closed: true,
        markets: [
          {
            id: "1",
            closed: true,
            umaResolutionStatus: "proposed",
          },
        ],
      })
    ).toBe(false);
    expect(
      isEventResolvedForSeo({
        closed: true,
        markets: [
          resolvedMarket,
          { id: "2", closed: true, umaResolutionStatus: "unresolved" },
        ],
      })
    ).toBe(false);
  });

  it("fails closed when resolution fields conflict or contain mixed states", () => {
    expect(
      isEventResolvedForSeo({
        closed: true,
        markets: [
          {
            id: "1",
            closed: true,
            umaResolutionStatus: "proposed",
            umaResolutionStatuses: '["resolved"]',
          },
        ],
      })
    ).toBe(false);
    expect(
      isEventResolvedForSeo({
        closed: true,
        markets: [
          {
            id: "1",
            closed: true,
            umaResolutionStatuses: '["proposed", "resolved"]',
          },
        ],
      })
    ).toBe(false);
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

  it("indexes durable resolved events with useful context", () => {
    const event = {
      slug: "world-cup-2026-winner",
      title: "World Cup 2026 Winner",
      description:
        "This market resolves from the official tournament result after the final match and includes detailed settlement criteria for readers.",
      volume: "10000.00",
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

  it("indexes high-volume resolved events with rendered outcome context", () => {
    const event = {
      slug: "will-xauusd-hit-week-of-august-10-2026",
      title: "What will Gold (XAUUSD) hit Week of August 10 2026?",
      description: "What will Gold (XAUUSD) hit Week of August 10 2026?",
      volume: "51033.27",
      active: true,
      closed: true,
      markets: [
        {
          id: "1",
          active: false,
          closed: true,
          groupItemTitle: "↑ $4,400",
          outcomePrices: '["1", "0"]',
          umaResolutionStatus: "resolved",
        },
      ],
    };

    expect(shouldIndexEventPage(event)).toBe(true);
    expect(shouldListEventInSitemap(event)).toBe(true);
  });

  it("does not index thin resolved events", () => {
    expect(
      shouldIndexEventPage({
        slug: "thin-result",
        title: "Thin Result",
        description: "Resolved.",
        volume: "9999.99",
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

  it("indexes substantial ended events while settlement is disputed", () => {
    const event = {
      slug: "cs2-pure-drama-2026-08-05",
      title: "Counter-Strike: PURE vs Drama eSports",
      description:
        "This completed match page retains the market rules, trading history, settlement source, and current dispute status for readers following the final resolution.",
      volume: "37780.37",
      active: true,
      closed: false,
      ended: true,
      markets: [
        {
          id: "3355610",
          active: true,
          closed: false,
          umaResolutionStatus: "disputed",
        },
      ],
    };

    expect(getEventSeoStatus(event)).toBe("closed");
    expect(shouldIndexEventPage(event)).toBe(true);
    expect(shouldListEventInSitemap(event)).toBe(true);
  });

  it("does not index resolved events without source or outcome context", () => {
    expect(
      shouldIndexEventPage({
        slug: "context-free-result",
        title: "Context-free Result",
        description: "Resolved.",
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
      })
    ).toBe(false);
  });

  it("keeps thin ended events out of the index", () => {
    expect(
      shouldIndexEventPage({
        slug: "thin-ended-event",
        title: "Thin Ended Event",
        description: "Trading ended.",
        volume: "9999.99",
        active: true,
        closed: false,
        ended: true,
        markets: [{ id: "1", active: true, closed: false }],
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
