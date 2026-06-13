import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns the current time and ticks at the given interval", () => {
    const { result } = renderHook(() => useNow(5_000));
    const first = result.current;
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current - first).toBe(5_000);
  });

  it("clears its interval on unmount", () => {
    const { unmount } = renderHook(() => useNow(1_000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
