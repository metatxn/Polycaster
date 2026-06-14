import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildMatchQuery,
  rankStreamMarkets,
} from "../../src/content/streaming/stream-market-ranking";
import type { Market } from "../../src/types/market";
import type { StreamContext } from "../../src/types/platform";

function market(title: string, volume24hr: number): Market {
  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title,
    source: "polymarket",
    volume24hr,
    tags: [{ label: "Counter-Strike", slug: "counter-strike" }],
  };
}

test("buildMatchQuery strips Twitch broadcast prefixes from esports titles", () => {
  assert.equal(
    buildMatchQuery(
      "Main Broadcast: LIVE: Team Vitality vs MOUZ - IEM Cologne Major 2026"
    ),
    "Team Vitality vs MOUZ"
  );
});

test("rankStreamMarkets pins the watched matchup above higher-volume same-game markets", () => {
  const ctx: StreamContext = {
    game: "Counter-Strike",
    gameSlug: "counter-strike",
    title:
      "Main Broadcast: LIVE: Team Vitality vs MOUZ - IEM Cologne Major 2026",
    tags: ["English"],
    isLive: true,
  };

  const falcons = market(
    "Counter-Strike: Team Falcons vs Monte (BO3)",
    100_000
  );
  const aurora = market("Counter-Strike: Aurora vs G2 (BO3)", 80_000);
  const vitality = market(
    "Counter-Strike: Team Vitality vs MOUZ (BO3)",
    10_000
  );

  const ranked = rankStreamMarkets({
    ctx,
    matchFound: [falcons, aurora, vitality],
    gameFound: [falcons, aurora, vitality],
    maxMarkets: 5,
  });

  assert.equal(ranked[0]?.title, "Counter-Strike: Team Vitality vs MOUZ (BO3)");
  assert.deepEqual(
    ranked.map((m) => m.title),
    [
      "Counter-Strike: Team Vitality vs MOUZ (BO3)",
      "Counter-Strike: Team Falcons vs Monte (BO3)",
      "Counter-Strike: Aurora vs G2 (BO3)",
    ]
  );
});
