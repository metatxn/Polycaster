import posthog from "posthog-js";
import { getPostHogBrowserHost } from "./src/lib/posthog-browser-config";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (token && process.env.NODE_ENV === "production") {
  posthog.init(token, {
    api_host: getPostHogBrowserHost(process.env.NEXT_PUBLIC_POSTHOG_HOST),
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
  });
}
