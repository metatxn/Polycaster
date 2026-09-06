// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { OnboardingActionButton } from "../../src/onboarding-action-button";

describe("onboarding action feedback", () => {
  it("shows a spinner, blocks repeated clicks, and clears busy state on completion", async () => {
    let finish!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        React.createElement(
          OnboardingActionButton,
          { onClick: action },
          "Find wallets"
        )
      );
    });
    const button = container.querySelector("button");
    if (!button) throw new Error("Action button missing");
    await React.act(async () => {
      button.click();
    });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".button-spinner")).not.toBeNull();
    button.click();
    expect(action).toHaveBeenCalledTimes(1);
    await React.act(async () => {
      finish();
    });
    expect(button.disabled).toBe(false);
    expect(button.querySelector(".button-spinner")).toBeNull();
    await React.act(async () => {
      root.unmount();
    });
  });

  it("shows an error and allows retry after a rejected action", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        React.createElement(
          OnboardingActionButton,
          {
            onClick: async () => {
              throw new Error("Failed");
            },
          },
          "Open settings"
        )
      );
    });
    const button = container.querySelector("button");
    if (!button) throw new Error("Action button missing");
    await React.act(async () => {
      button.click();
    });
    expect(button.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Please try again"
    );
    await React.act(async () => {
      root.unmount();
    });
  });
});
