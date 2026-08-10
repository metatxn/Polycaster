import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const PRODUCT_LAYOUTS = [
  "agent/layout.tsx",
  "events/layout.tsx",
  "leaderboard/layout.tsx",
  "live/layout.tsx",
  "markets/layout.tsx",
  "portfolio/layout.tsx",
  "profile/layout.tsx",
  "search/layout.tsx",
  "sports/layout.tsx",
  "whales/layout.tsx",
];

describe("wallet provider scope", () => {
  it("keeps the root layout independent of request headers and wallet providers", () => {
    const rootLayout = source("src/app/layout.tsx");

    expect(rootLayout).not.toContain('from "next/headers"');
    expect(rootLayout).not.toContain("RootRouteShell");
  });

  it.each(PRODUCT_LAYOUTS)("wraps %s in wallet route providers", (layout) => {
    expect(source(`src/app/${layout}`)).toContain("WalletRouteProviders");
  });

  it("reads cookies only inside the wallet route provider boundary", () => {
    const provider = source("src/components/wallet-route-providers.tsx");

    expect(provider).toContain('from "next/headers"');
    expect(provider).toContain("<AppRouteProviders cookies={cookies}>");
  });
});
