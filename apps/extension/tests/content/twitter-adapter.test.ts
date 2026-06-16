import assert from "node:assert/strict";
import { test } from "vitest";

function installTwitterDom(): void {
  globalThis.window = {
    location: {
      hostname: "x.com",
    },
    KNOWW_CONFIG: {
      getThemeOverride: () => "auto",
    },
    KNOWW_PLATFORM: {
      registerPlatform() {},
    },
    getComputedStyle: () => ({ backgroundColor: "rgb(0, 0, 0)" }),
    matchMedia: () => ({ matches: false }),
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    body: {},
    querySelector: () => null,
  } as unknown as Document;
}

test("Twitter adapter keeps default social-feed matching behavior", async () => {
  installTwitterDom();
  const { TwitterAdapter } = await import(
    "../../src/content/platforms/twitter"
  );

  assert.equal(TwitterAdapter.resolveDirectMarkets, undefined);
  assert.equal(TwitterAdapter.enableNestedMarketContext, undefined);
});
