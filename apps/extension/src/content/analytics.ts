type AnalyticsValue = string | number | boolean | null | undefined;

type AnalyticsProperties = Record<string, AnalyticsValue>;

function getPageContext(): AnalyticsProperties {
  const platformName = window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown";

  return {
    host: window.location.hostname,
    page_url: window.location.href,
    page_path: window.location.pathname,
    platform: platformName,
  };
}

function isAnalyticsEnabled(): boolean {
  const settings = window.KNOWW_CONFIG.getUserSettings();
  return settings.usageAnalyticsEnabled;
}

async function track(
  event: string,
  properties: AnalyticsProperties = {}
): Promise<void> {
  if (!isAnalyticsEnabled()) return;

  await window.KNOWW_UTILS.safeSendMessage({
    type: "analytics:track",
    event,
    properties: {
      ...getPageContext(),
      ...properties,
    },
  });
}

const KNOWW_ANALYTICS = {
  track,
};

if (typeof window !== "undefined") {
  window.KNOWW_ANALYTICS = KNOWW_ANALYTICS;
}

export { KNOWW_ANALYTICS };
