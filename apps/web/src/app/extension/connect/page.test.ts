import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string): string =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("extension wallet connection page", () => {
  it("hosts packaged onboarding while preserving the green background and recovery instructions", () => {
    const page = readSource("src/app/extension/connect/page.tsx");

    expect(page).toContain("Connect your wallet to Knoww");
    expect(page).toContain("<OnboardingSlot />");
    const slot = readSource("src/app/extension/connect/onboarding-slot.tsx");
    expect(slot).toContain('id="knoww-extension-onboarding"');
    expect(slot).toContain('slot.current.dataset.ready = "true"');
    expect(page).toContain("kw-hero-aurora-noise-a");
    expect(slot).toContain("refresh this page");
    expect(page).toContain("<OnboardingLoading />");
    expect(page).not.toContain("Set up your Knoww extension");
    expect(page).not.toContain("Continue in the Knoww side panel");
    expect(page).not.toContain("x.com");
  });
});
