import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

const ROUTE_CACHE_PROFILES = new Map<string, string>([
  ["markets/info/[conditionID]/route.ts", "events"],
  ["markets/trades/[tokenID]/route.ts", "realtime"],
  ["markets/by-tag/route.ts", "events"],
  ["markets/by-token/[tokenId]/route.ts", "events"],
  ["markets/slug/[slug]/route.ts", "events"],
  ["events/list/route.ts", "events"],
  ["sports/list/route.ts", "static"],
  ["sports/markets/route.ts", "events"],
  ["sports/teams/route.ts", "static"],
  ["comments/route.ts", "search"],
  ["profile/[address]/route.ts", "leaderboard"],
  ["price/pol/route.ts", "priceHistory"],
  ["price/tokens/route.ts", "priceHistory"],
  ["user/public-profile/route.ts", "leaderboard"],
  ["user/details/route.ts", "leaderboard"],
]);

describe("public API cache headers", () => {
  it.each([...ROUTE_CACHE_PROFILES])(
    "%s applies the %s cache profile to successful responses",
    (route, profile) => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api", route),
        "utf8"
      );

      expect(source).toContain("getCacheHeaders");
      expect(source).toContain(`getCacheHeaders("${profile}")`);
    }
  );
});
