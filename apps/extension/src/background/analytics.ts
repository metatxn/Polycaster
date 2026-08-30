import { logDebug, logWarn } from "@knoww/logger";
import { normalizeSiteSupportHostname } from "../site-support";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "../types/settings";
import { getKnowwAppUrl } from "./extension-session";

const ANALYTICS_QUEUE_KEY = "knoww_analytics_queue_v1";
const ANALYTICS_INSTALL_ID_KEY = "knoww_analytics_install_id_v1";
const SITE_SUPPORT_SUBMITTED_HOSTNAMES_KEY =
  "knoww_site_support_submitted_hostnames_v1";
const SETTINGS_STORAGE_KEY = "knowwSettings";
const MAX_BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 1500;
const MAX_PROPERTY_VALUE_LENGTH = 200;

type Primitive = string | number | boolean | null;

export interface AnalyticsTrackInput {
  event: string;
  properties?: Record<string, Primitive | undefined>;
  timestamp?: string;
}

interface QueuedAnalyticsEvent {
  event: string;
  distinctId: string;
  timestamp: string;
  properties: Record<string, Primitive>;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let queueTask: Promise<unknown> = Promise.resolve();

function getStorageArea(): typeof chrome.storage.local {
  return chrome.storage.local;
}

async function isAnalyticsEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(
        { [SETTINGS_STORAGE_KEY]: DEFAULT_USER_SETTINGS },
        (result) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          const settings = result[SETTINGS_STORAGE_KEY] as
            | Partial<UserSettings>
            | undefined;
          resolve(
            settings?.usageAnalyticsEnabled ??
              DEFAULT_USER_SETTINGS.usageAnalyticsEnabled
          );
        }
      );
    } catch {
      resolve(false);
    }
  });
}

function sanitizePrimitive(value: Primitive | undefined): Primitive {
  if (value == null) return null;
  if (typeof value === "string") {
    return value.length > MAX_PROPERTY_VALUE_LENGTH
      ? value.slice(0, MAX_PROPERTY_VALUE_LENGTH)
      : value;
  }
  return value;
}

function sanitizeProperties(
  properties: Record<string, Primitive | undefined> | undefined
): Record<string, Primitive> {
  const sanitized: Record<string, Primitive> = {};

  for (const [key, value] of Object.entries(properties ?? {})) {
    if (!key) continue;
    sanitized[key] = sanitizePrimitive(value);
  }

  return sanitized;
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    getStorageArea().get(key, (result) => {
      resolve(result[key] as T | undefined);
    });
  });
}

function storageSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    getStorageArea().set(value, () => resolve());
  });
}

async function getQueue(): Promise<QueuedAnalyticsEvent[]> {
  return (await storageGet<QueuedAnalyticsEvent[]>(ANALYTICS_QUEUE_KEY)) ?? [];
}

async function setQueue(queue: QueuedAnalyticsEvent[]): Promise<void> {
  await storageSet({ [ANALYTICS_QUEUE_KEY]: queue });
}

async function getOrCreateInstallId(): Promise<string> {
  const existing = await storageGet<string>(ANALYTICS_INSTALL_ID_KEY);
  if (existing) return existing;

  const created = crypto.randomUUID();
  await storageSet({ [ANALYTICS_INSTALL_ID_KEY]: created });
  return created;
}

function scheduleFlush(): void {
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAnalyticsQueue();
  }, FLUSH_DELAY_MS);
}

async function postBatch(events: QueuedAnalyticsEvent[]): Promise<boolean> {
  try {
    const response = await fetch(`${getKnowwAppUrl()}/api/analytics/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      logWarn("analytics.batch_failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    return true;
  } catch (error) {
    logWarn("analytics.batch_request_failed", error);
    return false;
  }
}

function runQueueTask<T>(task: () => Promise<T>): Promise<T> {
  const nextTask = queueTask.then(task, task);
  queueTask = nextTask.then(
    () => undefined,
    () => undefined
  );
  return nextTask;
}

async function flushAnalyticsQueueUnlocked(): Promise<void> {
  while (true) {
    const queue = await getQueue();
    if (queue.length === 0) return;

    const batch = queue.slice(0, MAX_BATCH_SIZE);
    const success = await postBatch(batch);
    if (!success) return;

    await setQueue(queue.slice(batch.length));
  }
}

export async function queueAnalyticsEvent(
  input: AnalyticsTrackInput
): Promise<void> {
  const enabled = await isAnalyticsEnabled();
  if (!enabled) {
    logDebug("analytics.skipped_disabled", { event: input.event });
    return;
  }

  await runQueueTask(async () => {
    const distinctId = await getOrCreateInstallId();
    const queue = await getQueue();

    queue.push({
      event: input.event,
      distinctId,
      timestamp: input.timestamp ?? new Date().toISOString(),
      properties: sanitizeProperties(input.properties),
    });

    await setQueue(queue);

    if (queue.length >= MAX_BATCH_SIZE) {
      await flushAnalyticsQueueUnlocked();
      return;
    }

    scheduleFlush();
  });
}

/**
 * Sends a support request triggered by an explicit button click. This is kept
 * separate from optional usage analytics so turning analytics off does not
 * make a deliberate request appear to succeed while silently dropping it.
 */
export async function submitSiteSupportRequest(
  hostname: string
): Promise<boolean> {
  const normalizedHostname = normalizeSiteSupportHostname(hostname);
  if (!normalizedHostname) return false;

  return runQueueTask(async () => {
    const submittedHostnames =
      (await storageGet<string[]>(SITE_SUPPORT_SUBMITTED_HOSTNAMES_KEY)) ?? [];
    if (submittedHostnames.includes(normalizedHostname)) return true;

    const distinctId = await getOrCreateInstallId();
    const submitted = await postBatch([
      {
        event: "unsupported_site_requested",
        distinctId,
        timestamp: new Date().toISOString(),
        properties: { hostname: normalizedHostname },
      },
    ]);
    if (submitted) {
      await storageSet({
        [SITE_SUPPORT_SUBMITTED_HOSTNAMES_KEY]: [
          ...submittedHostnames,
          normalizedHostname,
        ].slice(-100),
      });
    }
    return submitted;
  });
}

export async function flushAnalyticsQueue(): Promise<void> {
  const enabled = await isAnalyticsEnabled();
  if (!enabled) {
    await runQueueTask(async () => {
      const queue = await getQueue();
      if (queue.length > 0) {
        logDebug("analytics.flush_cleared_disabled", { count: queue.length });
        await setQueue([]);
      }
    });
    return;
  }

  await runQueueTask(flushAnalyticsQueueUnlocked);
}
