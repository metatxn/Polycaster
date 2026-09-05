import { analyticsEventUuid } from "@knoww/shared-types/product-analytics";
import posthog from "posthog-js";
import { createJourneyAttribution } from "./src/lib/journey-attribution";
import { getPostHogBrowserHost } from "./src/lib/posthog-browser-config";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (token && process.env.NODE_ENV === "production") {
  let journey: ReturnType<typeof createJourneyAttribution> | undefined;
  try {
    journey = createJourneyAttribution(window.sessionStorage);
  } catch {
    /* Storage is optional. */
  }
  posthog.init(token, {
    api_host: getPostHogBrowserHost(process.env.NEXT_PUBLIC_POSTHOG_HOST),
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
    before_send(event) {
      if (!event) return event;
      // Attribution expires per tab; never persist it as a person property.
      if (posthog.has_opted_out_capturing?.()) {
        journey?.clear();
        delete event.properties.entry_source;
        delete event.properties.handoff_id;
      } else if (!("handoff_id" in event.properties)) {
        delete event.properties.entry_source;
        Object.assign(event.properties, journey?.properties());
      }
      event.properties.environment = ["knoww.app", "www.knoww.app"].includes(
        window.location.hostname
      )
        ? "production"
        : "development";
      const uuid = analyticsEventUuid(
        event.event,
        String(event.properties.distinct_id),
        event.properties.$insert_id
      );
      if (uuid) event.uuid = uuid;
      return event;
    },
  });
  posthog.register({ product: "web", analytics_version: 2 });
  posthog.unregister?.("entry_source");
  if (posthog.has_opted_out_capturing?.()) journey?.clear();
  else if (journey?.receive(new URL(window.location.href))) {
    posthog.capture("extension_web_handoff_received", journey.properties());
  }
  document.addEventListener(
    "click",
    (event) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const destination = new URL(anchor.href);
      if (
        [
          "polymarket.com",
          "www.polymarket.com",
          "polymarket.us",
          "www.polymarket.us",
        ].includes(destination.hostname)
      ) {
        posthog.capture("polymarket_opened_via_knoww", {
          destination_host: destination.hostname,
          navigation_stage: "requested",
        });
      }
    },
    true
  );
}
