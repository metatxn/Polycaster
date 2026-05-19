import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRepository } from "./repository.ts";
import { runScheduledAgentTick } from "./scheduler.ts";

function withCronEnv(env, fn) {
  const previous = {
    AGENT_CRON_ENABLED: process.env.AGENT_CRON_ENABLED,
    AGENT_CRON_EXECUTION_MODE: process.env.AGENT_CRON_EXECUTION_MODE,
    AGENT_CRON_LOCK_LEASE_MS: process.env.AGENT_CRON_LOCK_LEASE_MS,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("scheduled agent tick skips when cron is disabled", async () => {
  await withCronEnv({ AGENT_CRON_ENABLED: undefined }, async () => {
    const repository = createAgentRepository();
    let called = false;

    const result = await runScheduledAgentTick(repository, {
      runAgent: async () => {
        called = true;
        throw new Error("runner should not be called");
      },
    });

    assert.equal(called, false);
    assert.equal(result.status, "SKIPPED");
    assert.equal(result.reason, "cron-disabled");
  });
});

test("scheduled agent tick runs paper mode under an acquired lock", async () => {
  await withCronEnv({ AGENT_CRON_ENABLED: "true" }, async () => {
    const repository = createAgentRepository();
    const calls = [];

    const result = await runScheduledAgentTick(repository, {
      now: () => new Date("2026-05-14T12:00:00.000Z"),
      runAgent: async (_repository, options) => {
        calls.push(options);
        return {
          id: "run-1",
          status: "COMPLETED",
          startedAt: "2026-05-14T12:00:00.000Z",
          completedAt: "2026-05-14T12:00:01.000Z",
          itemCount: 0,
          tradeCount: 0,
          blockedCount: 0,
          items: [],
        };
      },
    });

    assert.equal(result.status, "RAN");
    assert.equal(result.executionMode, "paper");
    assert.equal(result.runId, "run-1");
    assert.deepEqual(calls, [{ executionMode: "paper" }]);
  });
});

test("scheduled agent tick skips when another worker holds the lock", async () => {
  await withCronEnv({ AGENT_CRON_ENABLED: "true" }, async () => {
    const repository = createAgentRepository();
    const acquired = await repository.tryAcquireSchedulerLock({
      lockKey: "agent-cron",
      ownerId: "other-worker",
      now: "2026-05-14T12:00:00.000Z",
      leaseMs: 60_000,
    });
    assert.notEqual(acquired, null);

    const result = await runScheduledAgentTick(repository, {
      now: () => new Date("2026-05-14T12:00:10.000Z"),
      runAgent: async () => {
        throw new Error("runner should not be called");
      },
    });

    assert.equal(result.status, "SKIPPED");
    assert.equal(result.reason, "lock-held");
  });
});
