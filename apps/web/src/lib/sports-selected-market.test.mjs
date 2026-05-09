import assert from "node:assert/strict";
import test from "node:test";

import { selectedSportsMarketExists } from "./sports-selected-market.ts";

test("reports a selected sports market as stale when its event disappears", () => {
  assert.equal(
    selectedSportsMarketExists(
      { eventId: "old-event", marketId: "old-market" },
      [
        {
          id: "new-event",
          markets: [{ id: "new-market" }],
        },
      ]
    ),
    false
  );
});

test("reports a selected sports market as stale when its market disappears", () => {
  assert.equal(
    selectedSportsMarketExists(
      { eventId: "current-event", marketId: "old-market" },
      [
        {
          id: "current-event",
          markets: [{ id: "new-market" }],
        },
      ]
    ),
    false
  );
});

test("reports a selected sports market as present when event and market still exist", () => {
  assert.equal(
    selectedSportsMarketExists(
      { eventId: "current-event", marketId: "current-market" },
      [
        {
          id: "current-event",
          markets: [{ id: "current-market" }],
        },
      ]
    ),
    true
  );
});
