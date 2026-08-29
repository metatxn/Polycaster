import assert from "node:assert/strict";
import { test } from "vitest";

import {
  appendUniquePostEntries,
  partitionViewportBatch,
  processBatchProgressively,
  selectViewportBatch,
} from "../../src/content/post-analysis-batching";

interface TestEntry {
  id: string;
  post: {
    getBoundingClientRect(): { bottom: number; top: number };
  };
}

function entry(id: string, top: number, bottom: number): TestEntry {
  return {
    id,
    post: {
      getBoundingClientRect: () => ({ bottom, top }),
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

test("selectViewportBatch limits work to the nearest visible posts", () => {
  const selected = selectViewportBatch(
    [
      entry("far-above", -900, -800),
      entry("visible-top", 20, 120),
      entry("far-below", 1_600, 1_700),
      entry("visible-center", 430, 530),
      entry("just-below", 1_020, 1_120),
    ],
    3,
    1_000
  );

  assert.deepEqual(
    selected.map(({ id }) => id),
    ["visible-center", "visible-top", "just-below"]
  );
});

test("selectViewportBatch keeps input order when posts have equal priority", () => {
  const selected = selectViewportBatch(
    [entry("first", 100, 200), entry("second", 100, 200)],
    2,
    1_000
  );

  assert.deepEqual(
    selected.map(({ id }) => id),
    ["first", "second"]
  );
});

test("partitionViewportBatch keeps unselected posts pending in priority order", () => {
  const partitioned = partitionViewportBatch(
    [
      entry("far-above", -900, -800),
      entry("visible-top", 20, 120),
      entry("far-below", 1_600, 1_700),
      entry("visible-center", 430, 530),
      entry("just-below", 1_020, 1_120),
    ],
    2,
    1_000
  );

  assert.deepEqual(
    partitioned.selected.map(({ id }) => id),
    ["visible-center", "visible-top"]
  );
  assert.deepEqual(
    partitioned.deferred.map(({ id }) => id),
    ["just-below", "far-below", "far-above"]
  );
});

test("appendUniquePostEntries merges pending posts in one deduplicated pass", () => {
  const unkeyed = entry("unkeyed", 0, 100);
  const pending = [
    { ...entry("first", 0, 100), key: "post-1" },
    { ...unkeyed, key: null },
  ];
  const added = appendUniquePostEntries(pending, [
    { ...entry("same-key-new-element", 0, 100), key: "post-1" },
    { ...unkeyed, key: null },
    { ...entry("second", 0, 100), key: "post-2" },
    { ...entry("new-unkeyed", 0, 100), key: null },
  ]);

  assert.equal(added, 2);
  assert.deepEqual(
    pending.map(({ id }) => id),
    ["first", "unkeyed", "second", "new-unkeyed"]
  );
});

test("processBatchProgressively delivers a fast result before the batch finishes", async () => {
  const slow = deferred<string>();
  const fast = deferred<string>();
  const delivered: string[] = [];

  const processing = processBatchProgressively(
    [slow.promise, fast.promise],
    2,
    (item) => item,
    (result) => {
      delivered.push(result);
    }
  );

  fast.resolve("fast");
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(delivered, ["fast"]);

  slow.resolve("slow");
  const completed = await processing;

  assert.deepEqual(delivered, ["fast", "slow"]);
  assert.deepEqual(completed, ["slow", "fast"]);
});
