import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { startDiscoveryWarmup } from "../../src/content/discovery-warmup";

test("startDiscoveryWarmup starts tags and scoring without waiting for idle", () => {
  const warmTags = vi.fn(async () => {});
  const warmScoring = vi.fn(async () => {});

  startDiscoveryWarmup({
    isHidden: () => false,
    warmScoring,
    warmTags,
  });

  assert.equal(warmTags.mock.calls.length, 1);
  assert.equal(warmScoring.mock.calls.length, 1);
});

test("startDiscoveryWarmup skips hidden tabs", () => {
  const warmTags = vi.fn(async () => {});
  const warmScoring = vi.fn(async () => {});

  startDiscoveryWarmup({
    isHidden: () => true,
    warmScoring,
    warmTags,
  });

  assert.equal(warmTags.mock.calls.length, 0);
  assert.equal(warmScoring.mock.calls.length, 0);
});

test("startDiscoveryWarmup reports rejected background work", async () => {
  const failures: string[] = [];

  startDiscoveryWarmup({
    isHidden: () => false,
    onError: (target) => {
      failures.push(target);
    },
    warmScoring: async () => {
      throw new Error("scoring unavailable");
    },
    warmTags: async () => {
      throw new Error("tags unavailable");
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(failures.sort(), ["scoring", "tags"]);
});
