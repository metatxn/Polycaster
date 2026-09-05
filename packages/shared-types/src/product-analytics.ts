import Decimal from "decimal.js";
import { sha256, stringToHex } from "viem";

/** A deterministic UUIDv8 for PostHog's event UUID, not merely a custom property. */
export function analyticsEventUuid(
  event: string,
  wallet: string,
  insertId: unknown
): string | undefined {
  if (typeof insertId !== "string" || !insertId) return undefined;
  const hash = sha256(
    stringToHex(JSON.stringify([event, wallet, insertId]))
  ).slice(2, 34);
  const variant = ((Number.parseInt(hash[16], 16) & 3) | 8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20)}`;
}

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null | undefined
>;
export type AnalyticsEvent = { event: string; properties: AnalyticsProperties };
export type TrackedOrder = {
  orderId: string;
  walletAddress: string;
  createdAt: number;
  properties: AnalyticsProperties;
  fills: Record<string, { shares: string; value: string }>;
  failedTrades: string[];
  complete?: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function acceptedOrderId(response: unknown): string | null {
  const value = record(response);
  if (value.ok === false || value.success === false) return null;
  const id = value.orderId ?? value.orderID ?? value.order_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function assertOrderCancelled(response: unknown, orderId: string): void {
  const value = record(response);
  const cancelled = value.canceled ?? value.cancelled;
  if (!Array.isArray(cancelled) || !cancelled.includes(orderId)) {
    throw new Error("The exchange did not confirm cancellation of this order.");
  }
}

export interface OrderAnalyticsReader {
  fetchOrder(request: { orderId: string }): Promise<unknown>;
  fetchTrade(request: { id: string }): Promise<unknown>;
}

/** Only exchange-confirmed trades belonging to this exact order contribute volume. */
export function reconcileOrderFills(
  previous: TrackedOrder,
  order: unknown,
  trades: unknown[]
): { state: TrackedOrder; events: AnalyticsEvent[] } {
  const state = {
    ...previous,
    fills: { ...previous.fills },
    failedTrades: [...previous.failedTrades],
  };
  const events: AnalyticsEvent[] = [];
  const snapshot = record(order);
  if (snapshot.id !== state.orderId) return { state, events };
  const base: AnalyticsProperties = {
    ...state.properties,
    wallet_address: state.walletAddress,
    order_id: state.orderId,
    analytics_version: 2,
  };
  for (const raw of trades) {
    const trade = record(raw);
    const id = trade.id;
    if (typeof id !== "string" || state.fills[id]) continue;
    const maker = Array.isArray(trade.makerOrders)
      ? trade.makerOrders
          .map(record)
          .find((entry) => entry.orderId === state.orderId)
      : undefined;
    const taker = trade.takerOrderId === state.orderId;
    if (!taker && !maker) continue;
    if (trade.status === "FAILED" && !state.failedTrades.includes(id)) {
      state.failedTrades.push(id);
      events.push({
        event: "trade_fill_failed",
        properties: {
          ...base,
          trade_id: id,
          $insert_id: `fill-failed:${state.walletAddress}:${state.orderId}:${id}`,
        },
      });
    }
    if (
      trade.status !== "CONFIRMED" ||
      typeof trade.transactionHash !== "string" ||
      !trade.transactionHash
    )
      continue;
    try {
      const shares = new Decimal(
        String(taker ? trade.size : maker?.matchedAmount)
      );
      const price = new Decimal(String(taker ? trade.price : maker?.price));
      if (
        !shares.isFinite() ||
        !price.isFinite() ||
        shares.lte(0) ||
        price.lt(0) ||
        price.gt(1)
      )
        continue;
      const value = shares.mul(price);
      state.fills[id] = { shares: shares.toString(), value: value.toString() };
      events.push({
        event: "trade_fill_confirmed",
        properties: {
          ...base,
          trade_id: id,
          transaction_hash: trade.transactionHash,
          filled_shares: shares.toNumber(),
          filled_value: value.toNumber(),
          $insert_id: `fill:${state.walletAddress}:${state.orderId}:${id}`,
        },
      });
    } catch {
      /* Invalid venue amounts never become volume. */
    }
  }
  if (state.complete || Object.keys(state.fills).length === 0)
    return { state, events };
  const total = Object.values(state.fills).reduce(
    (sum, fill) => sum.add(fill.shares),
    new Decimal(0)
  );
  const value = Object.values(state.fills).reduce(
    (sum, fill) => sum.add(fill.value),
    new Decimal(0)
  );
  let full = false;
  try {
    const original = new Decimal(String(snapshot.originalSize));
    full = original.isFinite() && original.gt(0) && total.gte(original);
  } catch {
    /* Keep an unknown order size pending. */
  }
  const properties = {
    ...base,
    filled_shares: total.toNumber(),
    filled_value: value.toNumber(),
  };
  if (full) {
    state.complete = true;
    for (const event of [
      "order_filled",
      "order_succeeded",
      ...(base.side === "SELL" ? ["sell_succeeded"] : []),
    ]) {
      events.push({
        event,
        properties: {
          ...properties,
          $insert_id: `${event}:${state.walletAddress}:${state.orderId}`,
        },
      });
    }
  } else if (events.some((entry) => entry.event === "trade_fill_confirmed")) {
    events.push({
      event: "order_partially_filled",
      properties: {
        ...properties,
        $insert_id: `partial:${state.walletAddress}:${state.orderId}:${total}`,
      },
    });
  }
  return { state, events };
}

export function createOrderAnalyticsTracker(deps: {
  load(): Promise<TrackedOrder[]>;
  save(orders: TrackedOrder[]): Promise<void>;
  capture(event: AnalyticsEvent): Promise<void>;
}) {
  let task: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = task.then(fn, fn);
    task = next.catch(() => {});
    return next;
  };
  return {
    remember(
      response: unknown,
      walletAddress: string,
      properties: AnalyticsProperties
    ) {
      return serialize(async () => {
        const orderId = acceptedOrderId(response);
        if (!orderId) return;
        const orders = await deps.load();
        if (
          orders.some(
            (entry) =>
              entry.orderId === orderId && entry.walletAddress === walletAddress
          )
        )
          return;
        const state = {
          orderId,
          walletAddress,
          properties,
          createdAt: Date.now(),
          fills: {},
          failedTrades: [],
        };
        await deps.capture({
          event: "order_accepted",
          properties: {
            ...properties,
            wallet_address: walletAddress,
            order_id: orderId,
            $insert_id: `accepted:${walletAddress}:${orderId}`,
          },
        });
        await deps.save([...orders, state]);
      });
    },
    poll(walletAddress: string, reader: OrderAnalyticsReader) {
      return serialize(async () => {
        const orders = await deps.load();
        // Rotate the queue so one unavailable order cannot starve later orders.
        const selected = orders
          .filter(
            (entry) => entry.walletAddress === walletAddress && !entry.complete
          )
          .slice(0, 10);
        for (const pending of selected) {
          try {
            const order = await reader.fetchOrder({ orderId: pending.orderId });
            const ids = record(order).associateTrades;
            const unread = Array.isArray(ids)
              ? ids
                  .filter(
                    (id): id is string =>
                      typeof id === "string" && !pending.fills[id]
                  )
                  .slice(0, 50)
              : [];
            const trades = [];
            for (const id of unread) {
              try {
                trades.push(await reader.fetchTrade({ id }));
              } catch {
                /* Other trades can still be confirmed. */
              }
            }
            const { state, events } = reconcileOrderFills(
              pending,
              order,
              trades
            );
            for (const event of events) await deps.capture(event);
            Object.assign(pending, state);
          } catch {
            /* Failed reads stay pending; they are not failed trades. */
          }
        }
        const retained = orders.filter(
          (entry) => Date.now() - entry.createdAt < 90 * 86_400_000
        );
        await deps.save([
          ...retained.filter((entry) => !selected.includes(entry)),
          ...selected.filter((entry) => retained.includes(entry)),
        ]);
      });
    },
  };
}
