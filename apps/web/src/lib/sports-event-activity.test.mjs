import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCurrentSportsEvent,
  isLiveOrRecentlyStartedSportsEvent,
  isUpcomingSportsEvent,
  RECENTLY_STARTED_SPORTS_EVENT_WINDOW_MS,
} from "./sports-event-activity.ts";

const NOW = Date.parse("2026-05-08T12:00:00Z");

describe("isCurrentSportsEvent", () => {
  it("excludes active Gamma events whose sports schedule has already ended", () => {
    assert.equal(
      isCurrentSportsEvent(
        {
          active: true,
          closed: false,
          startTime: "2026-04-22T09:30:00Z",
          endDate: "2026-04-29T05:30:00Z",
        },
        NOW
      ),
      false
    );
  });

  it("keeps live events even when the event end date is stale upstream", () => {
    assert.equal(
      isCurrentSportsEvent(
        {
          active: true,
          closed: false,
          live: true,
          startTime: "2026-05-08T01:30:00Z",
          endDate: "2026-05-07T04:00:00Z",
        },
        NOW
      ),
      true
    );
  });

  it("keeps scheduled events that have not started yet", () => {
    assert.equal(
      isCurrentSportsEvent(
        {
          active: true,
          closed: false,
          startTime: "2026-05-09T01:30:00Z",
          endDate: "2026-05-09T04:30:00Z",
        },
        NOW
      ),
      true
    );
  });

  it("keeps recently started events when no end date is available", () => {
    assert.equal(
      isCurrentSportsEvent(
        {
          active: true,
          closed: false,
          startTime: new Date(
            NOW - RECENTLY_STARTED_SPORTS_EVENT_WINDOW_MS + 1000
          ).toISOString(),
        },
        NOW
      ),
      true
    );
  });

  it("excludes stale games even when Gamma keeps the settlement end date in the future", () => {
    assert.equal(
      isCurrentSportsEvent(
        {
          active: true,
          closed: false,
          startTime: new Date(
            NOW - RECENTLY_STARTED_SPORTS_EVENT_WINDOW_MS - 1000
          ).toISOString(),
          endDate: "2026-05-15T04:00:00Z",
        },
        NOW
      ),
      false
    );
  });

  it("excludes events that are explicitly inactive, closed, or ended", () => {
    assert.equal(isCurrentSportsEvent({ active: false }, NOW), false);
    assert.equal(isCurrentSportsEvent({ closed: true }, NOW), false);
    assert.equal(isCurrentSportsEvent({ ended: true }, NOW), false);
  });
});

describe("isLiveOrRecentlyStartedSportsEvent", () => {
  it("excludes recently started events once the primary result is proposed", () => {
    assert.equal(
      isLiveOrRecentlyStartedSportsEvent(
        {
          active: true,
          closed: false,
          startTime: "2026-05-08T11:00:00Z",
          markets: [
            {
              sportsMarketType: "moneyline",
              umaResolutionStatus: "proposed",
            },
            {
              sportsMarketType: "cricket_toss_winner",
              umaResolutionStatus: "resolved",
            },
          ],
        },
        NOW
      ),
      false
    );
  });

  it("keeps recently started sports events in the live bucket before Gamma sets live", () => {
    assert.equal(
      isLiveOrRecentlyStartedSportsEvent(
        {
          active: true,
          closed: false,
          startTime: "2026-05-08T11:00:00Z",
        },
        NOW
      ),
      true
    );
  });

  it("does not treat a proposed toss market as a completed match", () => {
    assert.equal(
      isLiveOrRecentlyStartedSportsEvent(
        {
          active: true,
          closed: false,
          startTime: "2026-05-08T11:00:00Z",
          markets: [
            {
              sportsMarketType: "moneyline",
              umaResolutionStatuses: "[]",
            },
            {
              sportsMarketType: "cricket_toss_winner",
              umaResolutionStatus: "proposed",
            },
          ],
        },
        NOW
      ),
      true
    );
  });
});

describe("isUpcomingSportsEvent", () => {
  it("keeps future sports events", () => {
    assert.equal(
      isUpcomingSportsEvent(
        {
          active: true,
          closed: false,
          startTime: "2026-05-09T01:30:00Z",
        },
        NOW
      ),
      true
    );
  });

  it("excludes non-live sports events once kickoff is in the past", () => {
    assert.equal(
      isUpcomingSportsEvent(
        {
          active: true,
          closed: false,
          startTime: "2026-05-08T01:30:00Z",
          endDate: "2026-05-15T01:30:00Z",
        },
        NOW
      ),
      false
    );
  });

  it("keeps untimed futures while their settlement end date is still future", () => {
    assert.equal(
      isUpcomingSportsEvent(
        {
          active: true,
          closed: false,
          endDate: "2026-05-15T01:30:00Z",
        },
        NOW
      ),
      true
    );
  });
});
