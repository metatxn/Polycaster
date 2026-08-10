import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _rateLimitStoreSize,
  _resetRateLimitStore,
  RATE_LIMIT_MAX_ENTRIES,
  rateLimit,
} from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00Z"));
    _resetRateLimitStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit and then blocks", () => {
    const opts = { interval: 60_000, uniqueTokenPerInterval: 3 };
    expect(rateLimit("ip-1", opts).success).toBe(true);
    expect(rateLimit("ip-1", opts).success).toBe(true);
    expect(rateLimit("ip-1", opts).success).toBe(true);
    expect(rateLimit("ip-1", opts).success).toBe(false);
  });

  it("resets after the interval", () => {
    const opts = { interval: 60_000, uniqueTokenPerInterval: 1 };
    expect(rateLimit("ip-2", opts).success).toBe(true);
    expect(rateLimit("ip-2", opts).success).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(rateLimit("ip-2", opts).success).toBe(true);
  });

  it("sweeps expired entries without a module-level timer", () => {
    const opts = { interval: 1_000, uniqueTokenPerInterval: 5 };
    rateLimit("old-1", opts);
    rateLimit("old-2", opts);
    expect(_rateLimitStoreSize()).toBe(2);

    // Both entries are long expired; the next call (any key) triggers the
    // lazy sweep and removes them.
    vi.advanceTimersByTime(61_000);
    rateLimit("fresh", opts);
    expect(_rateLimitStoreSize()).toBe(1); // only "fresh" remains
  });

  it("never retains more identities than the hard store cap", () => {
    const opts = { interval: 60_000, uniqueTokenPerInterval: 5 };

    for (let i = 0; i < RATE_LIMIT_MAX_ENTRIES + 50; i++) {
      rateLimit(`flood-${i}`, opts);
    }

    expect(_rateLimitStoreSize()).toBe(RATE_LIMIT_MAX_ENTRIES);
    expect(
      rateLimit(`flood-${RATE_LIMIT_MAX_ENTRIES + 49}`, opts).remaining
    ).toBe(3);
  });

  it("evicts an expired identity before the oldest active identity", () => {
    const active = { interval: 60_000, uniqueTokenPerInterval: 5 };
    const expiresSoon = { interval: 1_000, uniqueTokenPerInterval: 5 };
    rateLimit("active-oldest", active);
    rateLimit("expired", expiresSoon);
    for (let i = 0; i < RATE_LIMIT_MAX_ENTRIES - 2; i++) {
      rateLimit(`active-${i}`, active);
    }

    vi.advanceTimersByTime(2_000);
    rateLimit("newcomer", active);

    expect(rateLimit("active-oldest", active).remaining).toBe(3);
    expect(_rateLimitStoreSize()).toBe(RATE_LIMIT_MAX_ENTRIES);
  });
});
