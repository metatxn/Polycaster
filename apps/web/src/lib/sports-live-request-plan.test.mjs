import assert from "node:assert/strict";
import test from "node:test";
import {
  getInitialCompanionMarketSlugs,
  shouldFetchScheduledSportsFallback,
} from "./sports-live-request-plan.ts";

test("fetches scheduled sports after the live query settles while live events are present", () => {
  assert.equal(
    shouldFetchScheduledSportsFallback({
      liveQueryLoading: false,
      liveEventCount: 3,
    }),
    true
  );
});

test("waits for the live query before fetching scheduled sports", () => {
  assert.equal(
    shouldFetchScheduledSportsFallback({
      liveQueryLoading: true,
      liveEventCount: 0,
    }),
    false
  );

  assert.equal(
    shouldFetchScheduledSportsFallback({
      liveQueryLoading: false,
      liveEventCount: 0,
    }),
    true
  );
});

test("does not fan out companion market requests on initial live page load", () => {
  const slugs = getInitialCompanionMarketSlugs(
    [
      {
        slug: "nba-lal-okc-2026-05-08",
        title: "Lakers vs. Thunder",
        markets: [
          {
            question: "Lakers vs. Thunder",
            groupItemTitle: "Moneyline",
            sportsMarketType: "moneyline",
          },
        ],
      },
    ],
    0
  );

  assert.deepEqual(slugs, []);
});
