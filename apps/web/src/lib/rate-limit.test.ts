import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _rateLimitStoreSize,
  _resetRateLimitStore,
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
});
