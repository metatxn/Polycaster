import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LandingPageAnalytics } from "./landing-page-analytics";

const posthog = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: posthog,
}));

describe("LandingPageAnalytics", () => {
  let intersectionCallback: IntersectionObserverCallback | undefined;
  const observe = vi.fn();
  const unobserve = vi.fn();

  beforeEach(() => {
    posthog.capture.mockReset();
    observe.mockReset();
    unobserve.mockReset();
    intersectionCallback = undefined;
    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0.35];

      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      disconnect = vi.fn();
      observe = observe;
      takeRecords = () => [];
      unobserve = unobserve;
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  it("captures a landing page view when mounted", () => {
    render(<LandingPageAnalytics />);

    expect(posthog.capture).toHaveBeenCalledWith("landing_page_viewed", {
      page: "home",
      surface: "landing_page",
    });
  });

  it("captures bounded CTA metadata from nested click targets", () => {
    const { getByText } = render(
      <>
        <LandingPageAnalytics />
        <a
          href="/markets"
          data-landing-cta="explore_markets"
          data-landing-location="hero"
          data-landing-destination="web_app"
          onClick={(event) => event.preventDefault()}
        >
          <span>Explore markets</span>
        </a>
      </>
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

  it("captures a section once it becomes meaningfully visible", () => {
    const { getByRole } = render(
      <>
        <LandingPageAnalytics />
        <section
          data-landing-section="how_it_works"
          aria-label="How it works"
        />
      </>
    );
    const section = getByRole("region", { name: "How it works" });

    const bounds = section.getBoundingClientRect();
    intersectionCallback?.(
      [
        {
          boundingClientRect: bounds,
          intersectionRatio: 0.5,
          intersectionRect: bounds,
          isIntersecting: true,
          rootBounds: null,
          target: section,
          time: 0,
        },
      ],
      {} as IntersectionObserver
    );

    expect(posthog.capture).toHaveBeenCalledWith("landing_section_viewed", {
      page: "home",
      section: "how_it_works",
      surface: "landing_page",
    });
    expect(unobserve).toHaveBeenCalledWith(section);
  });
});
