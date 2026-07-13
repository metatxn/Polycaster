import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, test, vi } from "vitest";

const platformManifest = vi.hoisted(() => ({
  findMatchingPlatforms: vi.fn(),
}));

const platformRegistry = vi.hoisted(() => ({
  registerPlatform: vi.fn(),
  detectPlatform: vi.fn(),
}));

vi.mock("../../src/content/platform-manifest", () => ({
  findMatchingPlatforms: platformManifest.findMatchingPlatforms,
}));

vi.mock("../../src/content/platform-registry", () => ({
  KNOWW_PLATFORM: platformRegistry,
}));

import { loadPlatformAdapter } from "../../src/content/platform-loader";

interface TestAdapter {
  name: string;
}

interface TestManifestEntry {
  file: string;
  name: string;
  matchers: RegExp[];
}

function manifestEntry(name: string): TestManifestEntry {
  return { file: name, name, matchers: [] };
}

beforeEach(() => {
  platformManifest.findMatchingPlatforms.mockReset();
  platformRegistry.registerPlatform.mockReset();
  platformRegistry.detectPlatform.mockReset();
});

describe("loadPlatformAdapter", () => {
  test("imports and registers the Twitter adapter for a Twitter URL", async () => {
    const twitterAdapter: TestAdapter = { name: "twitter" };
    platformManifest.findMatchingPlatforms.mockReturnValue([
      manifestEntry("twitter"),
    ]);
    platformRegistry.detectPlatform.mockReturnValue(twitterAdapter);
    const importModule = vi.fn().mockResolvedValue({
      adapter: twitterAdapter,
    });

    const loaded = await loadPlatformAdapter(
      new URL("https://twitter.com/home"),
      importModule
    );

    assert.equal(loaded, true);
    assert.deepEqual(platformManifest.findMatchingPlatforms.mock.calls, [
      ["twitter.com"],
    ]);
    assert.deepEqual(importModule.mock.calls, [["twitter"]]);
    assert.deepEqual(platformRegistry.registerPlatform.mock.calls, [
      [twitterAdapter],
    ]);
    assert.equal(platformRegistry.detectPlatform.mock.calls.length, 1);
  });

  test("returns false for an unsupported host without importing a module", async () => {
    platformManifest.findMatchingPlatforms.mockReturnValue([]);
    const importModule = vi.fn();

    const loaded = await loadPlatformAdapter(
      new URL("https://unsupported.example/feed"),
      importModule
    );

    assert.equal(loaded, false);
    assert.deepEqual(platformManifest.findMatchingPlatforms.mock.calls, [
      ["unsupported.example"],
    ]);
    assert.equal(importModule.mock.calls.length, 0);
    assert.equal(platformRegistry.registerPlatform.mock.calls.length, 0);
    assert.equal(platformRegistry.detectPlatform.mock.calls.length, 0);
  });

  test("continues to the next matching candidate when a module has no adapter export", async () => {
    const secondAdapter: TestAdapter = { name: "second" };
    platformManifest.findMatchingPlatforms.mockReturnValue([
      manifestEntry("first"),
      manifestEntry("second"),
    ]);
    platformRegistry.detectPlatform.mockReturnValue(secondAdapter);
    const importModule = vi.fn(async (name: string) =>
      name === "first" ? {} : { adapter: secondAdapter }
    );

    const loaded = await loadPlatformAdapter(
      new URL("https://overlap.example/feed"),
      importModule
    );

    assert.equal(loaded, true);
    assert.deepEqual(importModule.mock.calls, [["first"], ["second"]]);
    assert.deepEqual(platformRegistry.registerPlatform.mock.calls, [
      [secondAdapter],
    ]);
    assert.equal(platformRegistry.detectPlatform.mock.calls.length, 1);
  });

  test("continues when the first registered candidate is not detected", async () => {
    const firstAdapter: TestAdapter = { name: "first" };
    const secondAdapter: TestAdapter = { name: "second" };
    platformManifest.findMatchingPlatforms.mockReturnValue([
      manifestEntry("first"),
      manifestEntry("second"),
    ]);
    platformRegistry.detectPlatform
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(secondAdapter);
    const importModule = vi.fn(async (name: string) => ({
      adapter: name === "first" ? firstAdapter : secondAdapter,
    }));

    const loaded = await loadPlatformAdapter(
      new URL("https://overlap.example/feed"),
      importModule
    );

    assert.equal(loaded, true);
    assert.deepEqual(importModule.mock.calls, [["first"], ["second"]]);
    assert.deepEqual(platformRegistry.registerPlatform.mock.calls, [
      [firstAdapter],
      [secondAdapter],
    ]);
    assert.equal(platformRegistry.detectPlatform.mock.calls.length, 2);
  });

  test("continues to the next candidate when the first import rejects", async () => {
    const secondAdapter: TestAdapter = { name: "second" };
    platformManifest.findMatchingPlatforms.mockReturnValue([
      manifestEntry("first"),
      manifestEntry("second"),
    ]);
    platformRegistry.detectPlatform.mockReturnValue(secondAdapter);
    const importModule = vi.fn(async (name: string) => {
      if (name === "first") {
        throw new Error("first platform bundle failed to load");
      }
      return { adapter: secondAdapter };
    });

    const loaded = await loadPlatformAdapter(
      new URL("https://overlap.example/feed"),
      importModule
    );

    assert.equal(loaded, true);
    assert.deepEqual(importModule.mock.calls, [["first"], ["second"]]);
    assert.deepEqual(platformRegistry.registerPlatform.mock.calls, [
      [secondAdapter],
    ]);
    assert.equal(platformRegistry.detectPlatform.mock.calls.length, 1);
  });
});

test("startup awaits adapter loading immediately after user settings and before platform lookup", () => {
  const source = readFileSync(
    new URL("../../src/content/main.ts", import.meta.url),
    "utf8"
  );
  const settingsCall = "await loadUserSettings();";
  const loaderCall = "const platformLoaded = await loadPlatformAdapter(";
  const loaderGuard = "if (!platformLoaded)";
  const platformLookup = "window.KNOWW_PLATFORM?.getCurrentPlatform?.();";
  const settingsEnd = source.indexOf(settingsCall) + settingsCall.length;
  const loaderStart = source.indexOf(loaderCall);
  const platformLookupStart = source.indexOf(platformLookup);

  assert.ok(settingsEnd >= settingsCall.length, "expected settings load");
  assert.equal(
    source.slice(settingsEnd, loaderStart).trim(),
    "",
    "expected adapter loading immediately after settings load"
  );
  assert.ok(
    loaderStart < platformLookupStart,
    "expected adapter loading before the first platform registry lookup"
  );
  const loaderGuardStart = source.indexOf(loaderGuard, loaderStart);
  assert.ok(
    loaderGuardStart > loaderStart && loaderGuardStart < platformLookupStart,
    "expected failed adapter loading to return before platform lookup"
  );
});
