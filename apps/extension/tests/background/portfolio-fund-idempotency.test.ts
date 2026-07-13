import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createPortfolioFundIdempotencyCoordinator,
  PortfolioFundIdempotencyError,
  type PortfolioFundIdempotencyStorage,
  portfolioFundIdempotencyStorageKey,
} from "../../src/background/portfolio-fund-idempotency";

class MemoryStorage implements PortfolioFundIdempotencyStorage {
  readonly values: Record<string, unknown> = {};

  async get(key: string | null): Promise<Record<string, unknown>> {
    if (key === null) return { ...this.values };
    return key in this.values ? { [key]: this.values[key] } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.values[key];
    }
  }
}

const KEY = "00000000-0000-4000-8000-000000000001";
const SECOND_KEY = "00000000-0000-4000-8000-000000000002";
const FINGERPRINT = '{"action":"deposit","amount":"10"}';

test("joins concurrent duplicate fund intents and executes money movement once", async () => {
  const storage = new MemoryStorage();
  const coordinator = createPortfolioFundIdempotencyCoordinator(storage);
  let executionCount = 0;
  let releaseExecution!: () => void;
  let notifyStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const execute = async ({
    markMoneyMovementStarted,
  }: {
    markMoneyMovementStarted(): void;
  }) => {
    executionCount += 1;
    markMoneyMovementStarted();
    notifyStarted();
    await gate;
    return { txHash: "0xabc" };
  };

  const first = coordinator.run({
    idempotencyKey: KEY,
    fingerprint: FINGERPRINT,
    execute,
  });
  const second = coordinator.run({
    idempotencyKey: KEY,
    fingerprint: FINGERPRINT,
    execute,
  });

  await started;
  await Promise.resolve();
  releaseExecution();
  assert.deepEqual(await first, { txHash: "0xabc" });
  assert.deepEqual(await second, { txHash: "0xabc" });
  assert.equal(executionCount, 1);
});

test("joins concurrent matching fingerprints even when sidepanels mint different keys", async () => {
  const storage = new MemoryStorage();
  const coordinator = createPortfolioFundIdempotencyCoordinator(storage);
  let executionCount = 0;
  let releaseExecution!: () => void;
  let notifyStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const execute = async () => {
    executionCount += 1;
    notifyStarted();
    await gate;
    return { txHash: "0xabc" };
  };

  const first = coordinator.run({
    idempotencyKey: KEY,
    fingerprint: FINGERPRINT,
    execute,
  });
  const second = coordinator.run({
    idempotencyKey: SECOND_KEY,
    fingerprint: FINGERPRINT,
    execute,
  });

  await started;
  await Promise.resolve();
  releaseExecution();
  assert.deepEqual(await first, { txHash: "0xabc" });
  assert.deepEqual(await second, { txHash: "0xabc" });
  assert.equal(executionCount, 1);
});

test("replays a completed fund result after coordinator recreation", async () => {
  const storage = new MemoryStorage();
  const first = createPortfolioFundIdempotencyCoordinator(storage);
  const result = await first.run({
    idempotencyKey: KEY,
    fingerprint: FINGERPRINT,
    execute: async ({ markMoneyMovementStarted }) => {
      markMoneyMovementStarted();
      return { txHash: "0xcompleted" };
    },
  });
  assert.deepEqual(result, { txHash: "0xcompleted" });

  let replayExecutionCount = 0;
  const recreated = createPortfolioFundIdempotencyCoordinator(storage);
  const replay = await recreated.run({
    idempotencyKey: KEY,
    fingerprint: FINGERPRINT,
    execute: async () => {
      replayExecutionCount += 1;
      return { txHash: "0xduplicate" };
    },
  });

  assert.equal(replayExecutionCount, 0);
  assert.deepEqual(replay, { txHash: "0xcompleted" });
});

test("allows a deliberate new key after an earlier matching intent completed", async () => {
  const storage = new MemoryStorage();
  const coordinator = createPortfolioFundIdempotencyCoordinator(storage);
  const first = await coordinator.run({
    idempotencyKey: KEY,
    fingerprint: FINGERPRINT,
    execute: async ({ markMoneyMovementStarted }) => {
      markMoneyMovementStarted();
      return { txHash: "0xcompleted" };
    },
  });
  let duplicateExecutions = 0;

  const delayed = await coordinator.run({
    idempotencyKey: SECOND_KEY,
    fingerprint: FINGERPRINT,
    execute: async () => {
      duplicateExecutions += 1;
      return { txHash: "0xduplicate" };
    },
  });

  assert.notDeepEqual(delayed, first);
  assert.deepEqual(delayed, { txHash: "0xduplicate" });
  assert.equal(duplicateExecutions, 1);
});

test("fails closed by fingerprint when pending survives with a different key", async () => {
  const storage = new MemoryStorage();
  await storage.set({
    [portfolioFundIdempotencyStorageKey(KEY)]: {
      version: 1,
      idempotencyKey: KEY,
      fingerprint: FINGERPRINT,
      status: "pending",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    },
  });
  const coordinator = createPortfolioFundIdempotencyCoordinator(storage);
  let executionCount = 0;

  await assert.rejects(
    coordinator.run({
      idempotencyKey: SECOND_KEY,
      fingerprint: FINGERPRINT,
      execute: async () => {
        executionCount += 1;
        return { txHash: "0xduplicate" };
      },
    }),
    (error: unknown) =>
      error instanceof PortfolioFundIdempotencyError &&
      error.code === "PENDING_RECONCILIATION"
  );
  assert.equal(executionCount, 0);
});

test("rejects reuse of one fund key for a different normalized fingerprint", async () => {
  const storage = new MemoryStorage();
  const coordinator = createPortfolioFundIdempotencyCoordinator(storage);
  await coordinator.run({
    idempotencyKey: KEY,
    fingerprint: FINGERPRINT,
    execute: async ({ markMoneyMovementStarted }) => {
      markMoneyMovementStarted();
      return { txHash: "0xcompleted" };
    },
  });

  await assert.rejects(
    coordinator.run({
      idempotencyKey: KEY,
      fingerprint: '{"action":"deposit","amount":"11"}',
      execute: async () => ({ txHash: "0xduplicate" }),
    }),
    (error: unknown) =>
      error instanceof PortfolioFundIdempotencyError &&
      error.code === "IDEMPOTENCY_FINGERPRINT_MISMATCH"
  );
});

test("clears an exact auth failure so the same key can retry before submission", async () => {
  const storage = new MemoryStorage();
  const coordinator = createPortfolioFundIdempotencyCoordinator(storage);
  let executionCount = 0;

  await assert.rejects(
    coordinator.run({
      idempotencyKey: KEY,
      fingerprint: FINGERPRINT,
      isSafeToRetryError: (error) =>
        error instanceof Error && error.message === "Extension auth required",
      execute: async ({ markMoneyMovementStarted }) => {
        executionCount += 1;
        markMoneyMovementStarted();
        throw new Error("Extension auth required");
      },
    }),
    /Extension auth required/
  );

  const retry = await coordinator.run({
    idempotencyKey: KEY,
    fingerprint: FINGERPRINT,
    execute: async ({ markMoneyMovementStarted }) => {
      executionCount += 1;
      markMoneyMovementStarted();
      return { txHash: "0xafter-auth" };
    },
  });
  assert.equal(executionCount, 2);
  assert.deepEqual(retry, { txHash: "0xafter-auth" });
});

test("keeps a post-boundary submission failure pending for reconciliation", async () => {
  const storage = new MemoryStorage();
  const coordinator = createPortfolioFundIdempotencyCoordinator(storage);

  await assert.rejects(
    coordinator.run({
      idempotencyKey: KEY,
      fingerprint: FINGERPRINT,
      execute: async ({ markMoneyMovementStarted }) => {
        markMoneyMovementStarted();
        throw new Error("Network response was lost");
      },
    }),
    /Network response was lost/
  );

  await assert.rejects(
    coordinator.run({
      idempotencyKey: KEY,
      fingerprint: FINGERPRINT,
      execute: async () => ({ txHash: "0xduplicate" }),
    }),
    (error: unknown) =>
      error instanceof PortfolioFundIdempotencyError &&
      error.code === "PENDING_RECONCILIATION"
  );
});

test("bounds persisted completed fund results", async () => {
  const storage = new MemoryStorage();
  let nowMs = Date.parse("2026-07-10T00:00:00.000Z");
  const coordinator = createPortfolioFundIdempotencyCoordinator(
    storage,
    () => nowMs
  );

  for (let index = 1; index <= 51; index += 1) {
    const suffix = String(index).padStart(12, "0");
    const idempotencyKey = `00000000-0000-4000-8000-${suffix}`;
    await coordinator.run({
      idempotencyKey,
      fingerprint: `${FINGERPRINT}:${index}`,
      execute: async ({ markMoneyMovementStarted }) => {
        markMoneyMovementStarted();
        return { txHash: `0x${index}` };
      },
    });
    nowMs += 1;
  }

  assert.equal(
    Object.keys(storage.values).filter((key) =>
      key.startsWith("knoww_portfolio_fund_intent_")
    ).length,
    50
  );
});
