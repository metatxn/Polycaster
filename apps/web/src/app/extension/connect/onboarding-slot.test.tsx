import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingLoading } from "./onboarding-slot";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("extension startup loading", () => {
  it("shows only a loading message during normal startup", () => {
    vi.useFakeTimers();
    render(<OnboardingLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Knoww setup");
    expect(screen.queryByText(/enable or update Knoww/)).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText(/enable or update Knoww/)).toBeNull();
  });

  it("offers recovery if the extension has not loaded after eight seconds", () => {
    vi.useFakeTimers();
    render(<OnboardingLoading />);
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByText(/enable or update Knoww/)).toBeVisible();
  });

  it("does not reshow the fallback after the extension dismisses it", () => {
    vi.useFakeTimers();
    const { container } = render(<OnboardingLoading />);
    const fallback = container.querySelector<HTMLElement>(
      "#knoww-extension-onboarding-fallback"
    );
    if (!fallback) throw new Error("Missing startup fallback");
    fallback.hidden = true;
    act(() => vi.advanceTimersByTime(8000));
    expect(fallback).not.toBeVisible();
    expect(screen.queryByText(/enable or update Knoww/)).toBeNull();
  });
});
