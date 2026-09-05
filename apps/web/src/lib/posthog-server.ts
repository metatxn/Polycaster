import { analyticsEventUuid } from "@knoww/shared-types/product-analytics";
import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

type Primitive = string | number | boolean | null;

export interface ServerPostHogEvent {
  distinctId: string;
  event: string;
  properties?: Record<string, Primitive>;
  timestamp?: string;
}

function getPostHogProjectKey(): string | null {
  return (
    process.env.POSTHOG_PROJECT_API_KEY ||
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
    null
  );
}

function getPostHogHost(): string {
  return (
    process.env.POSTHOG_HOST ||
    process.env.NEXT_PUBLIC_POSTHOG_HOST ||
    DEFAULT_POSTHOG_HOST
  ).replace(/\/$/, "");
}

export function isPostHogServerConfigured(): boolean {
  return process.env.NODE_ENV === "production" && !!getPostHogProjectKey();
}

export function getPostHogClient(): PostHog {
  if (!posthogClient) {
    const key = getPostHogProjectKey();
    if (!key) {
      throw new Error("PostHog server key is not configured");
    }

    posthogClient = new PostHog(key, {
      host: getPostHogHost(),
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}

export async function captureServerEvents(
  events: ServerPostHogEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const posthog = getPostHogClient();
  for (const event of events) {
    posthog.capture({
      distinctId: event.distinctId,
      event: event.event,
      properties: {
        ...event.properties,
        environment: event.properties?.environment ?? process.env.NODE_ENV,
      },
      timestamp: event.timestamp ? new Date(event.timestamp) : undefined,
      uuid: analyticsEventUuid(
        event.event,
        event.distinctId,
        event.properties?.$insert_id
      ),
    });
  }
  await posthog.flush();
}

export async function captureServerEvent(
  event: ServerPostHogEvent
): Promise<void> {
  await captureServerEvents([event]);
}
