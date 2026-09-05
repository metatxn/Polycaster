type AnalyticsValue = string | number | boolean | null | undefined;

type AnalyticsProperties = Record<string, AnalyticsValue>;
let pageUrl = "";
let pageViewId = "";

function getPageContext(): AnalyticsProperties {
  if (pageUrl !== window.location.href) {
    pageUrl = window.location.href;
    pageViewId = crypto.randomUUID();
  }
  const platformName = window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown";

  return {
    page_view_id: pageViewId,
    host: window.location.hostname,
    platform: platformName,
  };
}

function isAnalyticsEnabled(): boolean {
  const settings = window.KNOWW_CONFIG?.getUserSettings?.();
  return settings?.usageAnalyticsEnabled ?? false;
}

async function track(
  event: string,
  properties: AnalyticsProperties = {}
): Promise<void> {
  try {
    if (!isAnalyticsEnabled()) return;

    await window.KNOWW_UTILS?.safeSendMessage?.({
      type: "analytics:track",
      event,
      properties: {
        ...getPageContext(),
        ...properties,
      },
    });
  } catch {
    // Swallow analytics errors so they never disrupt runtime
  }
}

const KNOWW_ANALYTICS = {
  track,
};

if (typeof window !== "undefined") {
  window.KNOWW_ANALYTICS = KNOWW_ANALYTICS;
}

export { KNOWW_ANALYTICS };
