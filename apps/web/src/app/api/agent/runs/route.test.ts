import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(() => null as Response | null),
  getAgentRepository: vi.fn(),
  requireMutatingAgentAdmin: vi.fn(() => null as Response | null),
  runPaperAgent: vi.fn(),
}));

vi.mock("@knoww/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@knoww/agent")>()),
  runPaperAgent: mocks.runPaperAgent,
}));

vi.mock("@/lib/agent/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/api")>()),
  requireMutatingAgentAdmin: mocks.requireMutatingAgentAdmin,
}));

vi.mock("@/lib/agent/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/repository")>()),
  getAgentRepository: mocks.getAgentRepository,
}));

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

import { DurableAgentRepositoryUnavailableError } from "@/lib/agent/repository";
import { POST } from "./route";

const FIRST_IDEMPOTENCY_KEY = "338295e1-bfe2-4f07-91a9-e23bc86379f1";
const SECOND_IDEMPOTENCY_KEY = "7ca67e21-263d-414b-938b-868dd88d15bd";

function liveRequest(idempotencyKey?: string) {
  return new NextRequest("https://knoww.app/api/agent/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://knoww.app",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ executionMode: "live" }),
  });
}

function paperRequest() {
  return new NextRequest("https://knoww.app/api/agent/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://knoww.app",
    },
    body: JSON.stringify({ executionMode: "paper" }),
  });
}

function completedRun(id: string) {
  return {
    id,
    status: "COMPLETED",
    startedAt: "2026-07-10T00:00:00.000Z",
    completedAt: "2026-07-10T00:00:01.000Z" as string | null,
    itemCount: 0,
    tradeCount: 0,
    blockedCount: 0,
    items: [],
  };
}

function createRepository() {
  const runs = new Map<string, ReturnType<typeof completedRun>>();
  let lockOwner: string | null = null;
  const repository = {
    getRun: vi.fn(async (id: string) => runs.get(id) ?? null),
    getRunRequestFingerprint: vi.fn(async () => null as string | null),
    tryAcquireSchedulerLock: vi.fn(
      async (input: { lockKey: string; ownerId: string }) => {
        if (lockOwner) return null;
        lockOwner = input.ownerId;
        return {
          ...input,
          lockedAt: "2026-07-10T00:00:00.000Z",
          expiresAt: "2026-07-10T00:10:00.000Z",
          updatedAt: "2026-07-10T00:00:00.000Z",
        };
      }
    ),
    releaseSchedulerLock: vi.fn(async (_key: string, ownerId: string) => {
      if (lockOwner === ownerId) lockOwner = null;
    }),
  };
  return { repository, runs };
}

beforeEach(() => {
  mocks.checkRateLimit.mockReset();
  mocks.getAgentRepository.mockReset();
  mocks.requireMutatingAgentAdmin.mockReset();
  mocks.runPaperAgent.mockReset();
  mocks.checkRateLimit.mockReturnValue(null);
  mocks.requireMutatingAgentAdmin.mockReturnValue(null);
});

describe("POST /api/agent/runs", () => {
  it("rate limits manual runs before starting agent execution", async () => {
    const rateLimited = Response.json(
      { success: false, error: "Too many requests" },
      { status: 429 }
    );
    mocks.checkRateLimit.mockReturnValue(rateLimited);

    const response = await POST(liveRequest(FIRST_IDEMPOTENCY_KEY));

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledOnce();
    expect(mocks.getAgentRepository).not.toHaveBeenCalled();
    expect(mocks.runPaperAgent).not.toHaveBeenCalled();
  });

  it("requires a UUID idempotency key for live manual runs", async () => {
    const response = await POST(liveRequest());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/idempotency/i);
    expect(mocks.getAgentRepository).not.toHaveBeenCalled();
    expect(mocks.runPaperAgent).not.toHaveBeenCalled();
  });

  it("fails closed when durable storage is unavailable for a live run", async () => {
    mocks.getAgentRepository.mockRejectedValue(
      new DurableAgentRepositoryUnavailableError()
    );

    const response = await POST(liveRequest(FIRST_IDEMPOTENCY_KEY));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toMatch(/durable.*storage/i);
    expect(mocks.runPaperAgent).not.toHaveBeenCalled();
  });

  it("replays a completed live run for a retried idempotency key", async () => {
    const { repository, runs } = createRepository();
    mocks.getAgentRepository.mockResolvedValue(repository);
    mocks.runPaperAgent.mockImplementation(async (_repository, _options) => {
      const run = completedRun(FIRST_IDEMPOTENCY_KEY);
      runs.set(FIRST_IDEMPOTENCY_KEY, run);
      return run;
    });

    const first = await POST(liveRequest(FIRST_IDEMPOTENCY_KEY));
    const retry = await POST(liveRequest(FIRST_IDEMPOTENCY_KEY));
    const firstBody = (await first.json()) as { run: { id: string } };
    const retryBody = (await retry.json()) as { run: { id: string } };

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(firstBody.run.id).toBe(FIRST_IDEMPOTENCY_KEY);
    expect(retryBody.run.id).toBe(FIRST_IDEMPOTENCY_KEY);
    expect(mocks.runPaperAgent).toHaveBeenCalledOnce();
    expect(mocks.runPaperAgent).toHaveBeenCalledWith(
      repository,
      expect.objectContaining({
        executionMode: "live",
        runId: FIRST_IDEMPOTENCY_KEY,
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    expect(mocks.getAgentRepository).toHaveBeenCalledWith({
      requireDurable: true,
    });
  });

  it("rejects reuse of a live idempotency key for a different request", async () => {
    const { repository, runs } = createRepository();
    runs.set(FIRST_IDEMPOTENCY_KEY, completedRun(FIRST_IDEMPOTENCY_KEY));
    repository.getRunRequestFingerprint.mockResolvedValue("a".repeat(64));
    mocks.getAgentRepository.mockResolvedValue(repository);

    const response = await POST(liveRequest(FIRST_IDEMPOTENCY_KEY));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/different live run/i);
    expect(mocks.runPaperAgent).not.toHaveBeenCalled();
  });

  it("does not replay an unfinished live run as a successful response", async () => {
    const { repository, runs } = createRepository();
    runs.set(FIRST_IDEMPOTENCY_KEY, {
      ...completedRun(FIRST_IDEMPOTENCY_KEY),
      status: "RUNNING",
      completedAt: null,
    });
    mocks.getAgentRepository.mockResolvedValue(repository);

    const response = await POST(liveRequest(FIRST_IDEMPOTENCY_KEY));

    expect(response.status).toBe(409);
    expect(mocks.runPaperAgent).not.toHaveBeenCalled();
  });

  it("rejects an overlapping live run while the global execution lock is held", async () => {
    const { repository } = createRepository();
    mocks.getAgentRepository.mockResolvedValue(repository);
    let finishFirstRun!: () => void;
    const firstRunCanFinish = new Promise<void>((resolve) => {
      finishFirstRun = resolve;
    });
    mocks.runPaperAgent.mockImplementationOnce(async () => {
      await firstRunCanFinish;
      return completedRun(FIRST_IDEMPOTENCY_KEY);
    });

    const firstResponsePromise = POST(liveRequest(FIRST_IDEMPOTENCY_KEY));
    await vi.waitFor(() => expect(mocks.runPaperAgent).toHaveBeenCalledOnce());

    const overlappingResponse = await POST(liveRequest(SECOND_IDEMPOTENCY_KEY));
    finishFirstRun();
    const firstResponse = await firstResponsePromise;

    expect(firstResponse.status).toBe(200);
    expect(overlappingResponse.status).toBe(409);
    expect(mocks.runPaperAgent).toHaveBeenCalledOnce();
  });

  it("does not let a paper run overlap a live run holding the global lock", async () => {
    const { repository } = createRepository();
    mocks.getAgentRepository.mockResolvedValue(repository);
    let finishFirstRun!: () => void;
    const firstRunCanFinish = new Promise<void>((resolve) => {
      finishFirstRun = resolve;
    });
    mocks.runPaperAgent.mockImplementationOnce(async () => {
      await firstRunCanFinish;
      return completedRun(FIRST_IDEMPOTENCY_KEY);
    });

    const firstResponsePromise = POST(liveRequest(FIRST_IDEMPOTENCY_KEY));
    await vi.waitFor(() => expect(mocks.runPaperAgent).toHaveBeenCalledOnce());

    const overlappingResponse = await POST(paperRequest());
    finishFirstRun();
    await firstResponsePromise;

    expect(overlappingResponse.status).toBe(409);
    expect(mocks.runPaperAgent).toHaveBeenCalledOnce();
  });
});
