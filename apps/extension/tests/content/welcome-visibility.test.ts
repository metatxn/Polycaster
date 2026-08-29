import { afterEach, describe, expect, test, vi } from "vitest";
import {
  showWelcomeForUpTo,
  WELCOME_MAX_VISIBLE_MS,
} from "../../src/content/ui/welcome-visibility";

interface StyleValue {
  priority: string;
  value: string;
}

function createVisibilityElement(initialDisplay?: StyleValue): {
  element: Pick<HTMLElement, "style">;
  property(name: string): StyleValue | undefined;
} {
  const properties = new Map<string, StyleValue>();
  if (initialDisplay) properties.set("display", initialDisplay);

  return {
    element: {
      style: {
        removeProperty(name: string): string {
          const previous = properties.get(name)?.value ?? "";
          properties.delete(name);
          return previous;
        },
        setProperty(name: string, value = "", priority = ""): void {
          properties.set(name, { priority, value });
        },
      } as CSSStyleDeclaration,
    },
    property: (name) => properties.get(name),
  };
}

describe("first-run welcome visibility", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("shows only the welcome state and hides it after three seconds", () => {
    vi.useFakeTimers();
    const welcome = createVisibilityElement({
      priority: "important",
      value: "none",
    });
    const scanning = createVisibilityElement();
    const onHidden = vi.fn();

    const dismiss = showWelcomeForUpTo(
      welcome.element,
      scanning.element,
      onHidden
    );

    expect(welcome.property("display")).toBeUndefined();
    expect(scanning.property("display")).toEqual({
      priority: "important",
      value: "none",
    });

    vi.advanceTimersByTime(WELCOME_MAX_VISIBLE_MS - 1);
    expect(onHidden).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(welcome.property("display")).toEqual({
      priority: "important",
      value: "none",
    });
    expect(scanning.property("display")).toBeUndefined();
    expect(onHidden).toHaveBeenCalledTimes(1);

    dismiss();
    expect(onHidden).toHaveBeenCalledTimes(1);
  });

  test("manual dismissal cancels the pending automatic dismissal", () => {
    vi.useFakeTimers();
    const welcome = createVisibilityElement({
      priority: "important",
      value: "none",
    });
    const scanning = createVisibilityElement();
    const onHidden = vi.fn();

    const dismiss = showWelcomeForUpTo(
      welcome.element,
      scanning.element,
      onHidden
    );

    vi.advanceTimersByTime(500);
    dismiss();
    expect(onHidden).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(WELCOME_MAX_VISIBLE_MS);
    expect(onHidden).toHaveBeenCalledTimes(1);
  });
});
