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
    expect(rootLayout).not.toContain("AppRouteProviders");
    expect(rootLayout).not.toContain("WalletRouteProviders");
    expect(rootLayout).toContain("<ThemeProviders>{children}</ThemeProviders>");
  });

  it.each(PRODUCT_LAYOUTS)("wraps %s in wallet route providers", (layout) => {
    const productLayout = source(`src/app/${layout}`);

    expect(productLayout).not.toContain('from "next/headers"');
    expect(productLayout).toMatch(
      /<WalletRouteProviders>\s*\{children\}\s*<\/WalletRouteProviders>/
    );
  });

  it("reads cookies only inside the wallet route provider boundary", () => {
    const provider = source("src/components/wallet-route-providers.tsx");
    const appProviders = source("src/components/app-route-providers.tsx");
    const contextProvider = source("src/context/index.tsx");

    expect(provider).toContain('from "next/headers"');
    expect(provider).toContain("cookieToInitialState(");
    expect(provider).toContain(
      "<AppRouteProviders initialState={initialState}>"
    );
    expect(provider).not.toContain("cookies={");
    expect(appProviders).toContain(
      "<ContextProvider initialState={initialState}>"
    );
    expect(contextProvider).not.toContain("cookieToInitialState");
  });
});
