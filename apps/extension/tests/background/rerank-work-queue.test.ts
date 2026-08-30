import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  createRerankWorkQueue,
  RerankQueueCapacityError,
  RerankQueueDeadlineError,
  RerankSupersededError,
} from "../../src/background/rerank-work-queue";

afterEach(() => {
  vi.useRealTimers();
});

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("rerank queue keeps pending work bounded and preserves the newest requests", async () => {
  const queue = createRerankWorkQueue({ maximumPending: 2 });
  const blocker = createDeferred<string>();
  const executionOrder: string[] = [];

  const running = queue.enqueue("post:running", async () => {
    executionOrder.push("running");
    return blocker.promise;
  });
  const dropped = queue.enqueue("post:dropped", async () => {
    executionOrder.push("dropped");
    return "dropped";
  });
  const droppedRejection = assert.rejects(dropped, RerankQueueCapacityError);
  const retained = queue.enqueue("post:retained", async () => {
    executionOrder.push("retained");
    return "retained";
  });
  const newest = queue.enqueue("post:newest", async () => {
    executionOrder.push("newest");
    return "newest";
  });

  assert.deepEqual(queue.snapshot(), { pending: 2, running: true });
  await droppedRejection;

  blocker.resolve("running");
  assert.equal(await running, "running");
  assert.equal(await retained, "retained");
  assert.equal(await newest, "newest");
  assert.deepEqual(executionOrder, ["running", "retained", "newest"]);
  assert.deepEqual(queue.snapshot(), { pending: 0, running: false });
});

test("rerank queue supersedes older pending work for the same post", async () => {
  const queue = createRerankWorkQueue({ maximumPending: 3 });
  const blocker = createDeferred<void>();
  const executionOrder: string[] = [];

  const running = queue.enqueue("post:blocker", async () => {
    executionOrder.push("blocker");
    await blocker.promise;
  });
  const stale = queue.enqueue("post:same", async () => {
    executionOrder.push("stale");
    return "stale";
  });
  const staleRejection = assert.rejects(stale, (error: unknown) => {
    assert.ok(error instanceof RerankSupersededError);
    assert.equal(error.message.includes("post:same"), false);
    return true;
  });
  const latest = queue.enqueue("post:same", async () => {
    executionOrder.push("latest");
    return "latest";
  });

  await staleRejection;
  assert.deepEqual(queue.snapshot(), { pending: 1, running: true });

  blocker.resolve();
  await running;
  assert.equal(await latest, "latest");
  assert.deepEqual(executionOrder, ["blocker", "latest"]);
});

test("rerank queue does not interrupt running work when the same post is queued again", async () => {
  const queue = createRerankWorkQueue({ maximumPending: 2 });
  const blocker = createDeferred<string>();
  const executionOrder: string[] = [];

  const running = queue.enqueue("post:same", async () => {
    executionOrder.push("running");
    return blocker.promise;
  });
  const next = queue.enqueue("post:same", async () => {
    executionOrder.push("next");
    return "next";
  });

  assert.deepEqual(queue.snapshot(), { pending: 1, running: true });
  blocker.resolve("running");

  assert.equal(await running, "running");
  assert.equal(await next, "next");
  assert.deepEqual(executionOrder, ["running", "next"]);
});

test("rerank queue rejects expired work before ONNX inference starts", async () => {
  vi.useFakeTimers();
  const queue = createRerankWorkQueue({
    maximumPending: 2,
    maximumQueueWaitMs: 50,
  });
  const blocker = createDeferred<void>();
  let expiredWorkStarted = false;

  const running = queue.enqueue("post:blocker", () => blocker.promise);
  const expired = queue.enqueue("post:expired", async () => {
    expiredWorkStarted = true;
  });
  const expiredRejection = assert.rejects(expired, (error: unknown) => {
    assert.ok(error instanceof RerankQueueDeadlineError);
    assert.equal(error.queueWaitMs, 51);
    return true;
  });

  await vi.advanceTimersByTimeAsync(51);
  blocker.resolve();
  await running;
  await expiredRejection;

  assert.equal(expiredWorkStarted, false);
});
