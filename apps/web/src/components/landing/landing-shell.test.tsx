import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LandingShell } from "./landing-shell";

const posthog = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: posthog,
}));

vi.mock("@/components/cursor-glow", () => ({
  CursorGlow: () => null,
}));

vi.mock("@/components/kw-theme", () => ({
  KW_PAGE_CLASS: "kw-page",
  useKwTheme: () => ({ colorScheme: "light", theme: "light" }),
}));

describe("LandingShell CTA analytics", () => {
  beforeEach(() => {
    posthog.capture.mockReset();
  });

  it("captures a nested CTA click through the client shell", () => {
    const { getByText } = render(
      <LandingShell trackLandingCtas>
        <a
          href="/markets"
          data-landing-cta="explore_markets"
          data-landing-location="hero"
          data-landing-destination="web_app"
          onClick={(event) => event.preventDefault()}
        >
          <span>Explore markets</span>
        </a>
      </LandingShell>
    );

    fireEvent.click(getByText("Explore markets"));

    expect(posthog.capture).toHaveBeenCalledWith("landing_cta_clicked", {
      cta: "explore_markets",
      destination: "web_app",
      location: "hero",
      page: "home",
      surface: "landing_page",
    });
  });
});
