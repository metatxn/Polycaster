import {
  type AnalyticsProperties,
  createOrderAnalyticsTracker,
  type TrackedOrder,
} from "@knoww/shared-types/product-analytics";
import { getAddress } from "viem";
import { isAnalyticsEnabled, queueAnalyticsEvent } from "./analytics";
import { loadClobCredentials } from "./clob-credentials-store";
import { createL2ClobClient } from "./clob-open-orders";

const STORAGE_KEY = "knoww_order_analytics_v2";
async function load(): Promise<TrackedOrder[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}
const tracker = createOrderAnalyticsTracker({
  load,
  async save(orders) {
    await chrome.storage.local.set({ [STORAGE_KEY]: orders });
  },
  capture: queueAnalyticsEvent,
});

export async function rememberAcceptedOrder(
  response: unknown,
  address: string,
  properties: AnalyticsProperties
) {
  if (!(await isAnalyticsEnabled())) return;
  await tracker.remember(response, getAddress(address), properties);
}

let polling: Promise<void> | undefined;
export function pollConfirmedOrders(): Promise<void> {
  if (polling) return polling;
  polling = (async () => {
    if (!(await isAnalyticsEnabled())) {
      await chrome.storage.local.remove(STORAGE_KEY);
      return;
    }
    const wallets = [
      ...new Set(
        (await load())
          .filter((order) => !order.complete)
          .map((order) => order.walletAddress)
      ),
    ];
    for (const address of wallets) {
      const credentials = await loadClobCredentials(address);
      if (!credentials) continue;
      // Credentials-only reads must never open a wallet confirmation prompt.
      try {
        await tracker.poll(
          address,
          await createL2ClobClient({ address, credentials })
        );
      } catch {
        /* Resume on the next alarm. */
      }
    }
  })().finally(() => {
    polling = undefined;
  });
  return polling;
}
