import { afterEach, describe, expect, it, vi } from "vitest";
import { createPortfolioFundAttemptStore } from "../../src/background/portfolio-fund-attempts";

// The store logs replay/unknown-attempt no-ops via @knoww/logger, which
// emits console.warn in this environment. Silence it so test output stays
// clean while still letting tests assert the warning fired.
function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

function memoryStorage() {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string | null) {
      if (key === null) return Object.fromEntries(data);
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

const input = {
  action: "deposit" as const,
  address: `0x${"a".repeat(40)}`,
  amount: "5",
  chainId: "137",
  tokenSymbol: "USDC.e",
  tokenAddress: `0x${"b".repeat(40)}`,
  tokenDecimals: 6,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("createPortfolioFundAttemptStore", () => {
  it("allocates an attemptId and a valid uuid idempotency key and persists it", async () => {
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const attempt = await store.begin(input);

    expect(UUID_RE.test(attempt.attemptId)).toBe(true);
    expect(UUID_RE.test(attempt.idempotencyKey)).toBe(true);
    expect(attempt.txHash).toBeNull();
    expect(attempt.phase).toBe("none");
    expect(storage.data.size).toBe(1);
  });

  it("returns the same attempt for the same fingerprint across restarts", async () => {
    const storage = memoryStorage();
    const first = await createPortfolioFundAttemptStore(storage).begin(input);
    const second = await createPortfolioFundAttemptStore(storage).begin(input);
    expect(second.attemptId).toBe(first.attemptId);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("returns a different attempt for a different amount", async () => {
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const first = await store.begin(input);
    const second = await store.begin({ ...input, amount: "9" });
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("recordExecution sets txHash and phase submitted; begin afterwards resumes it", async () => {
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const attempt = await store.begin(input);

    await store.recordExecution(
      attempt.attemptId,
      "0xabc123",
      attempt.idempotencyKey
    );

    const resumed = await createPortfolioFundAttemptStore(storage).begin(input);
    expect(resumed.attemptId).toBe(attempt.attemptId);
    expect(resumed.idempotencyKey).toBe(attempt.idempotencyKey);
    expect(resumed.txHash).toBe("0xabc123");
    expect(resumed.phase).toBe("submitted");
  });

  it('complete("credited") retires the attempt so a subsequent begin allocates a fresh one', async () => {
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const attempt = await store.begin(input);
    await store.recordExecution(
      attempt.attemptId,
      "0xabc123",
      attempt.idempotencyKey
    );

    await store.complete(attempt.attemptId, "credited", attempt.idempotencyKey);

    const fresh = await store.begin(input);
    expect(fresh.attemptId).not.toBe(attempt.attemptId);
    expect(fresh.idempotencyKey).not.toBe(attempt.idempotencyKey);
    expect(fresh.txHash).toBeNull();
    expect(fresh.phase).toBe("none");
  });

  it('complete("reverted") likewise retires the attempt so a subsequent begin allocates a fresh one', async () => {
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const attempt = await store.begin(input);
    await store.recordExecution(
      attempt.attemptId,
      "0xabc123",
      attempt.idempotencyKey
    );

    await store.complete(attempt.attemptId, "reverted", attempt.idempotencyKey);

    const fresh = await store.begin(input);
    expect(fresh.attemptId).not.toBe(attempt.attemptId);
    expect(fresh.idempotencyKey).not.toBe(attempt.idempotencyKey);
    expect(fresh.txHash).toBeNull();
    expect(fresh.phase).toBe("none");
  });

  it('recordExecution after complete("credited") never un-terminalizes the attempt', async () => {
    const warn = silenceWarnings();
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const attempt = await store.begin(input);
    await store.recordExecution(
      attempt.attemptId,
      "0xabc123",
      attempt.idempotencyKey
    );
    await store.complete(attempt.attemptId, "credited", attempt.idempotencyKey);

    // Coordinator replay path: a lost sendResponse + client retry re-resolves
    // the same deposit and re-invokes recordExecution on the settled attempt.
    await store.recordExecution(
      attempt.attemptId,
      "0xabc123",
      attempt.idempotencyKey
    );

    const record = [...storage.data.values()].find(
      (value) =>
        (value as { attemptId: string }).attemptId === attempt.attemptId
    ) as { phase: string; txHash: string };
    expect(record.phase).toBe("credited");
    expect(record.txHash).toBe("0xabc123");
    expect(warn).toHaveBeenCalled();

    // The settled attempt must not be resumed — begin allocates fresh.
    const fresh = await store.begin(input);
    expect(fresh.attemptId).not.toBe(attempt.attemptId);
    expect(fresh.idempotencyKey).not.toBe(attempt.idempotencyKey);
    expect(fresh.txHash).toBeNull();
    expect(fresh.phase).toBe("none");
  });

  it("keeps the first terminal outcome when complete is called twice", async () => {
    const warn = silenceWarnings();
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const attempt = await store.begin(input);
    await store.recordExecution(
      attempt.attemptId,
      "0xabc123",
      attempt.idempotencyKey
    );

    await store.complete(attempt.attemptId, "credited", attempt.idempotencyKey);
    await store.complete(attempt.attemptId, "reverted", attempt.idempotencyKey);

    const record = [...storage.data.values()].find(
      (value) =>
        (value as { attemptId: string }).attemptId === attempt.attemptId
    ) as { phase: string };
    expect(record.phase).toBe("credited");
    expect(warn).toHaveBeenCalled();
  });

  it("recordExecution on an unknown attemptId no-ops without creating a record", async () => {
    const warn = silenceWarnings();
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const attempt = await store.begin(input);
    const before = new Map(storage.data);

    await expect(
      store.recordExecution(
        "00000000-0000-4000-8000-00000000dead",
        "0xabc123",
        attempt.idempotencyKey
      )
    ).resolves.toBeUndefined();

    expect(storage.data).toEqual(before);
    expect(warn).toHaveBeenCalled();

    // The known attempt is untouched and still resumable.
    const resumed = await store.begin(input);
    expect(resumed.attemptId).toBe(attempt.attemptId);
    expect(resumed.phase).toBe("none");
  });

  it("recordExecution with a mismatched idempotency key no-ops instead of corrupting the attempt", async () => {
    const warn = silenceWarnings();
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const attempt = await store.begin(input);
    const other = await store.begin({ ...input, amount: "9" });

    // A crossed-wires caller: another attempt's key against this attemptId.
    await store.recordExecution(
      attempt.attemptId,
      "0xwrong",
      other.idempotencyKey
    );

    const record = [...storage.data.values()].find(
      (value) =>
        (value as { attemptId: string }).attemptId === attempt.attemptId
    ) as { phase: string; txHash: string | null };
    expect(record.phase).toBe("none");
    expect(record.txHash).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("complete with a mismatched idempotency key no-ops instead of terminalizing the attempt", async () => {
    const warn = silenceWarnings();
    const storage = memoryStorage();
    const store = createPortfolioFundAttemptStore(storage);
    const attempt = await store.begin(input);
    const other = await store.begin({ ...input, amount: "9" });

    await store.complete(attempt.attemptId, "credited", other.idempotencyKey);

    // Not terminal: begin still resumes the same attempt.
    const resumed = await store.begin(input);
    expect(resumed.attemptId).toBe(attempt.attemptId);
    expect(resumed.phase).toBe("none");
    expect(warn).toHaveBeenCalled();
  });

  it("prunes terminal attempts once they exceed the TTL", async () => {
    const storage = memoryStorage();
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const store = createPortfolioFundAttemptStore(storage, () => nowMs);

    const attempt = await store.begin(input);
    await store.complete(attempt.attemptId, "credited", attempt.idempotencyKey);
    expect(storage.data.size).toBe(1);

    // Advance 31 days — past the 30-day terminal-record TTL.
    nowMs += 31 * 24 * 60 * 60 * 1000;
    const restarted = createPortfolioFundAttemptStore(storage, () => nowMs);
    // A begin call (even for an unrelated fingerprint) triggers pruning.
    await restarted.begin({ ...input, amount: "42" });

    expect(storage.data.size).toBe(1);
    const remaining = [...storage.data.values()][0] as { fingerprint: string };
    expect(remaining.fingerprint).not.toBe(attempt.fingerprint);
  });
});
