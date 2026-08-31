"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

const CTA_IDS = [
  "install_extension",
  "explore_markets",
  "learn_extension",
  "nav_extension",
  "nav_how_it_works",
  "nav_agent",
  "nav_markets",
] as const;

const CTA_LOCATIONS = [
  "header",
  "header_nav",
  "hero",
  "extension_section",
  "final_cta",
] as const;

const CTA_DESTINATIONS = [
  "chrome_web_store",
  "web_app",
  "extension_page",
  "page_section",
] as const;

const SECTION_IDS = [
  "hero",
  "problem",
  "solution",
  "extension",
  "how_it_works",
  "radar",
  "agent",
  "why_now",
  "use_cases",
  "traction",
  "final_cta",
] as const;

function isAllowedValue<T extends string>(
  values: readonly T[],
  value: string | undefined
): value is T {
  return value !== undefined && values.includes(value as T);
}

export function LandingPageAnalytics() {
  useEffect(() => {
    posthog.capture("landing_page_viewed", {
      page: "home",
      surface: "landing_page",
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const section = (entry.target as HTMLElement).dataset.landingSection;
          if (isAllowedValue(SECTION_IDS, section)) {
            posthog.capture("landing_section_viewed", {
              page: "home",
              section,
              surface: "landing_page",
            });
          }
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.35 }
    );

    const sections = document.querySelectorAll<HTMLElement>(
      "[data-landing-section]"
    );
    for (const section of sections) observer.observe(section);

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}

export function captureLandingCtaClick(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;

  const element = target.closest<HTMLElement>("[data-landing-cta]");
  if (!element) return;

  const { landingCta, landingDestination, landingLocation } = element.dataset;
  if (
    !isAllowedValue(CTA_IDS, landingCta) ||
    !isAllowedValue(CTA_LOCATIONS, landingLocation) ||
    !isAllowedValue(CTA_DESTINATIONS, landingDestination)
  ) {
    return;
  }

  posthog.capture("landing_cta_clicked", {
    cta: landingCta,
    destination: landingDestination,
    location: landingLocation,
    page: "home",
    surface: "landing_page",
  });
}
