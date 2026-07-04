import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

describe("PortfolioPage redeem actions", () => {
  it("does not wire one CTF loading flag into every redeem row", () => {
    const source = readSource("src/app/portfolio/page.tsx");

    expect(source).not.toMatch(/redeemActionsDisabled=\{isRedeemingCtf\}/);
    expect(source).not.toMatch(/!position\.conditionId \|\| isRedeemingCtf/);
    expect(source).toMatch(/redeemingPositionIds/);
  });
});
