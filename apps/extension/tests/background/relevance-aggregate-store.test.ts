import { describe, expect, it } from "vitest";
import {
  createRelevanceAggregateStore,
  RELEVANCE_AGGREGATE_STORAGE_KEY,
} from "../../src/background/relevance-aggregate-store";

function memoryStorage() {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string | null) {
      if (key === null) return Object.fromEntries(data);
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    },
  };
}

const searchSample = {
  kind: "search",
  source: "network",
  outcome: "success",
  latencyMs: 120,
  candidateCount: 8,
} as const;

describe("createRelevanceAggregateStore", () => {
  it("serializes concurrent writes so counters are not lost", async () => {
    const storage = memoryStorage();
    const store = createRelevanceAggregateStore(storage, () =>
      Date.UTC(2026, 7, 29, 12)
    );

    await Promise.all([store.record(searchSample), store.record(searchSample)]);

    const snapshot = await store.exportSnapshot();
    expect(snapshot.days[0].search.requests).toBe(2);
    expect(snapshot.days[0].search.candidateTotal).toBe(16);
  });

  it("rejects malformed messages without writing storage", async () => {
    const storage = memoryStorage();
    const store = createRelevanceAggregateStore(storage);

    await expect(
      store.record({ ...searchSample, candidateCount: -1 })
    ).resolves.toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it("returns a clean empty snapshot when persisted data is malformed", async () => {
    const storage = memoryStorage();
    storage.data.set(RELEVANCE_AGGREGATE_STORAGE_KEY, {
      schemaVersion: 1,
      days: "not-an-array",
      postText: "must not escape",
    });
    const store = createRelevanceAggregateStore(storage, () =>
      Date.UTC(2026, 7, 29, 12)
    );

    const snapshot = await store.exportSnapshot();
    expect(snapshot).toEqual({
      schemaVersion: 1,
      updatedAt: Date.UTC(2026, 7, 29, 12),
      days: [],
    });
    expect(JSON.stringify(snapshot)).not.toContain("must not escape");
  });

  it("clears the persisted aggregate snapshot", async () => {
    const storage = memoryStorage();
    const store = createRelevanceAggregateStore(storage);
    await store.record(searchSample);

    await store.clear();

    expect(storage.data.has(RELEVANCE_AGGREGATE_STORAGE_KEY)).toBe(false);
  });
});
