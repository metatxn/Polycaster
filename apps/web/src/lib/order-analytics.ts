import {
  type AnalyticsProperties,
  analyticsEventUuid,
  createOrderAnalyticsTracker,
  type OrderAnalyticsReader,
  type TrackedOrder,
} from "@knoww/shared-types/product-analytics";
import posthog from "posthog-js";
import { getAddress } from "viem";
import { currentJourneyProperties } from "./journey-attribution";

const STORAGE_KEY = "knoww_order_analytics_v2";

export function captureTradingEvent(
  event: string,
  address: string,
  properties: AnalyticsProperties = {}
) {
  try {
    const wallet = getAddress(address);
    posthog.capture(
      event,
      {
        ...properties,
        distinct_id: wallet,
        wallet_address: wallet,
        product: "web",
        analytics_version: 2,
      },
      { uuid: analyticsEventUuid(event, wallet, properties.$insert_id) }
    );
  } catch {
    /* Analytics cannot block a wallet operation. */
  }
}

const tracker = createOrderAnalyticsTracker({
  async load() {
    const orders = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]"
    ) as TrackedOrder[];
    return Array.isArray(orders) ? orders : [];
  },
  async save(orders) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  },
  async capture({ event, properties }) {
    captureTradingEvent(event, String(properties.wallet_address), properties);
  },
});

// Tracking failures must never change the outcome of a trading operation.
export function rememberAcceptedOrder(
  response: unknown,
  address: string,
  properties: AnalyticsProperties
) {
  if (posthog.has_opted_out_capturing?.()) return Promise.resolve();
  const journey = currentJourneyProperties();
  return tracker
    .remember(response, getAddress(address), {
      ...properties,
      handoff_id: journey.handoff_id ?? null,
      entry_source: journey.entry_source ?? null,
    })
    .catch(() => {});
}

const polling = new Map<string, Promise<void>>();
export function pollConfirmedOrders(
  address: string,
  reader: OrderAnalyticsReader
) {
  if (posthog.has_opted_out_capturing?.()) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
    return Promise.resolve();
  }
  const wallet = getAddress(address);
  const running = polling.get(wallet);
  if (running) return running;
  const next = tracker
    .poll(wallet, reader)
    .catch(() => {})
    .finally(() => polling.delete(wallet));
  polling.set(wallet, next);
  return next;
}
