import { createLogger } from "@knoww/logger";
import type { AgentRepository, AgentRunDetail } from "./repository.ts";
import { type AgentExecutionMode, runPaperAgent } from "./run.ts";

const log = createLogger("agent.scheduler");

export const AGENT_EXECUTION_LOCK_LEASE_MS = 10 * 60_000;
export const AGENT_EXECUTION_LOCK_KEY = "agent-execution";

export interface AgentExecutionLockHeartbeat {
  assertHeld(): Promise<void>;
  stop(): Promise<void>;
}

export function startAgentExecutionLockHeartbeat(
  repository: AgentRepository,
  input: { lockKey: string; ownerId: string; leaseMs: number }
): AgentExecutionLockHeartbeat {
  let lockError: Error | null = null;
  let pendingRenewal = Promise.resolve();
  const renew = () => {
    pendingRenewal = pendingRenewal.then(async () => {
      if (lockError) return;
      try {
        const renewed = await repository.renewSchedulerLock(
          input.lockKey,
          input.ownerId,
          new Date().toISOString(),
          input.leaseMs
        );
        if (!renewed) {
          lockError = new Error("Agent execution lock was lost");
        }
      } catch (error) {
        lockError =
          error instanceof Error
            ? error
            : new Error("Agent execution lock renewal failed");
      }
    });
    return pendingRenewal;
  };
  const interval = setInterval(
    () => {
      void renew();
    },
    Math.max(1_000, Math.floor(input.leaseMs / 3))
  );

  return {
    async assertHeld() {
      await renew();
      if (lockError) throw lockError;
    },
    async stop() {
      clearInterval(interval);
      await pendingRenewal;
    },
  };
}

type EnvLike = Record<string, string | undefined>;

export interface ScheduledAgentConfig {
  enabled: boolean;
  executionMode: AgentExecutionMode;
  lockLeaseMs: number;
}

export type ScheduledAgentTickResult =
  | {
      status: "SKIPPED";
      reason: "cron-disabled" | "lock-held";
      executionMode: AgentExecutionMode;
    }
  | {
      status: "RAN";
      executionMode: AgentExecutionMode;
      runId: string;
      itemCount: number;
      tradeCount: number;
      blockedCount: number;
    }
  | {
      status: "FAILED";
      executionMode: AgentExecutionMode;
      error: string;
    };

export interface ScheduledAgentTickOptions {
  env?: EnvLike;
  lockKey?: string;
  now?: () => Date;
  runAgent?: (
    repository: AgentRepository,
    options: {
      executionMode: AgentExecutionMode;
      assertExecutionLock?: () => Promise<void>;
    }
  ) => Promise<AgentRunDetail>;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getScheduledAgentConfig(
  env: EnvLike = process.env
): ScheduledAgentConfig {
  return {
    enabled: env.AGENT_CRON_ENABLED === "true",
    executionMode: env.AGENT_CRON_EXECUTION_MODE === "live" ? "live" : "paper",
    lockLeaseMs: positiveInteger(
      env.AGENT_CRON_LOCK_LEASE_MS,
      AGENT_EXECUTION_LOCK_LEASE_MS
    ),
  };
}

export async function runScheduledAgentTick(
  repository: AgentRepository,
  options: ScheduledAgentTickOptions = {}
): Promise<ScheduledAgentTickResult> {
  const config = getScheduledAgentConfig(options.env);
  if (!config.enabled) {
    return {
      status: "SKIPPED",
      reason: "cron-disabled",
      executionMode: config.executionMode,
    };
  }

  const now = (options.now ?? (() => new Date()))().toISOString();
  const ownerId = crypto.randomUUID();
  const lockKey = options.lockKey ?? AGENT_EXECUTION_LOCK_KEY;
  const lock = await repository.tryAcquireSchedulerLock({
    lockKey,
    ownerId,
    now,
    leaseMs: config.lockLeaseMs,
  });
  if (!lock) {
    return {
      status: "SKIPPED",
      reason: "lock-held",
      executionMode: config.executionMode,
    };
  }

  const heartbeat = startAgentExecutionLockHeartbeat(repository, {
    lockKey,
    ownerId,
    leaseMs: config.lockLeaseMs,
  });

  try {
    const run = await (options.runAgent ?? runPaperAgent)(repository, {
      executionMode: config.executionMode,
      assertExecutionLock: () => heartbeat.assertHeld(),
    });
    log.info("tick.completed", {
      runId: run.id,
      executionMode: config.executionMode,
      itemCount: run.itemCount,
      tradeCount: run.tradeCount,
      blockedCount: run.blockedCount,
    });
    return {
      status: "RAN",
      executionMode: config.executionMode,
      runId: run.id,
      itemCount: run.itemCount,
      tradeCount: run.tradeCount,
      blockedCount: run.blockedCount,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "scheduled agent tick failed";
    log.error("tick.failed", { error });
    return {
      status: "FAILED",
      executionMode: config.executionMode,
      error: message,
    };
  } finally {
    await heartbeat.stop();
    await repository.releaseSchedulerLock(lockKey, ownerId);
  }
}
