import { fetchClobOrderBook } from "@knoww/shared-types/clob";
import type { LegacyClobCompatibleClient } from "@knoww/shared-types/polymarket-unified";

export async function fetchOrderBook(tokenId: string, host: string) {
  return fetchClobOrderBook(tokenId, { host });
}

export async function fetchOpenOrders(client: LegacyClobCompatibleClient) {
  const orders = await client.getOpenOrders();
  return orders || [];
}

export async function checkOrderScoring(
  client: LegacyClobCompatibleClient,
  orderId: string
): Promise<boolean> {
  // SDK uses snake_case: order_id
  const response = await client.isOrderScoring({ order_id: orderId });
  return !!response.scoring;
}

export async function checkOrdersScoring(
  client: LegacyClobCompatibleClient,
  orderIds: string[]
): Promise<Record<string, boolean>> {
  // The SDK method might return a dictionary/record of orderId -> scoring
  return client.areOrdersScoring({ orderIds });
}
