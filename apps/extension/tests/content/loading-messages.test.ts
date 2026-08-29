// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  LONG_WAIT_MESSAGE_DELAYS_MS,
  startLoadingMessageSequence,
} from "../../src/loading-messages";

describe("loading message sequences", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("shows calm follow-up messages while an operation continues", () => {
    vi.useFakeTimers();
    const status = document.createElement("div");

    const stop = startLoadingMessageSequence(status, [
      "Creating your account...",
      "Setting up your trading access...",
      "Preparing your account for you...",
    ]);

    expect(status.textContent).toBe("Creating your account...");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.getAttribute("aria-busy")).toBe("true");

    vi.advanceTimersByTime(LONG_WAIT_MESSAGE_DELAYS_MS[0]);
    expect(status.textContent).toBe("Setting up your trading access...");

    vi.advanceTimersByTime(
      LONG_WAIT_MESSAGE_DELAYS_MS[1] - LONG_WAIT_MESSAGE_DELAYS_MS[0]
    );
    expect(status.textContent).toBe("Preparing your account for you...");

    stop();
    expect(status.getAttribute("aria-busy")).toBe("false");
  });

  test("stops pending message changes when the operation finishes", () => {
    vi.useFakeTimers();
    const status = document.createElement("div");

    const stop = startLoadingMessageSequence(status, [
      "Opening your portfolio...",
      "Checking your latest positions...",
      "Bringing your portfolio up to date...",
    ]);

    stop();
    vi.runAllTimers();

    expect(status.textContent).toBe("Opening your portfolio...");
    expect(vi.getTimerCount()).toBe(0);
  });
});
