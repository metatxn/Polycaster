import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string): string =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("extension wallet connection page", () => {
  it("keeps the user on Knoww and directs them to the extension side panel", () => {
    const page = readSource("src/app/extension/connect/page.tsx");

    expect(page).toContain("Connect your wallet to Knoww");
    expect(page).toContain("Continue in the Knoww side panel");
    expect(page).toContain("Keep this tab open");
    expect(page).not.toContain("x.com");
  });
});
