import { DEFAULT_USER_SETTINGS } from "./types/settings";

// Read consent ahead of the click so navigation keeps its user activation.
// Unknown or unavailable preferences must not decorate an outbound URL.
let analyticsEnabled = false;
let settingsChanged = false;
function readAnalyticsPreference(value: unknown): boolean {
  if (value === undefined) return DEFAULT_USER_SETTINGS.usageAnalyticsEnabled;
  if (!value || typeof value !== "object") return false;
  if (!("usageAnalyticsEnabled" in value)) {
    return DEFAULT_USER_SETTINGS.usageAnalyticsEnabled;
  }
  return value.usageAnalyticsEnabled === true;
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.knowwSettings) return;
    settingsChanged = true;
    analyticsEnabled = readAnalyticsPreference(changes.knowwSettings.newValue);
  });
  chrome.storage.sync.get(
    {
      knowwSettings: {
        usageAnalyticsEnabled: DEFAULT_USER_SETTINGS.usageAnalyticsEnabled,
      },
    },
    (result) => {
      if (settingsChanged || chrome.runtime.lastError) return;
      analyticsEnabled = readAnalyticsPreference(result.knowwSettings);
    }
  );
} catch {
  // Navigation remains available without an analytics preference.
}

/** Record a requested destination, not proof that the remote page loaded. */
export function openTrackedDestination(
  url?: string | URL,
  target?: string,
  features?: string
): Window | null {
  let destination = url;
  try {
    const parsed = new URL(String(url));
    const isKnoww =
      parsed.hostname === "knoww.app" ||
      parsed.hostname === "www.knoww.app" ||
      parsed.hostname === "localhost";
    const isPolymarket = [
      "polymarket.com",
      "www.polymarket.com",
      "polymarket.us",
      "www.polymarket.us",
    ].includes(parsed.hostname);
    if (analyticsEnabled && (isKnoww || isPolymarket)) {
      const handoffId = isKnoww ? crypto.randomUUID() : undefined;
      if (isKnoww && handoffId) {
        parsed.searchParams.set("utm_source", "knoww_extension");
        parsed.searchParams.set("handoff_id", handoffId);
        destination = parsed.toString();
      }
      void chrome.runtime
        .sendMessage({
          type: "analytics:track",
          event: isKnoww
            ? "extension_web_handoff_opened"
            : "polymarket_opened_via_knoww",
          properties: {
            destination_host: parsed.hostname,
            navigation_stage: "requested",
            ...(handoffId ? { handoff_id: handoffId } : {}),
          },
        })
        .catch(() => {});
    }
  } catch {
    /* Navigation still works if analytics is unavailable. */
  }
  return window.open(destination, target, features);
}
