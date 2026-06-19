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
