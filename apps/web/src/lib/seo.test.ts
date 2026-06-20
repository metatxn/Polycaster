import { describe, expect, it } from "vitest";
import {
  buildPredictionMarketTitle,
  shouldIndexEventPage,
  shouldListEventInSitemap,
} from "./seo";

describe("buildPredictionMarketTitle", () => {
  it("adds search intent while cleaning whitespace", () => {
    expect(buildPredictionMarketTitle("  World Cup Winner  ")).toBe(
      "World Cup Winner Prediction Market & Live Odds"
    );
  });

  it("does not duplicate prediction-market wording", () => {
    expect(buildPredictionMarketTitle("Bitcoin Prediction Market")).toBe(
      "Bitcoin Prediction Market"
    );
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
});
