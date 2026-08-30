import type { RelevanceAggregateSnapshot } from "../relevance-aggregate-telemetry";
import type { RelevanceAggregateStore } from "./relevance-aggregate-store";

type RelevanceAggregateResponse =
  | { ok: true; data?: RelevanceAggregateSnapshot }
  | { ok: false; error: string };

const RELEVANCE_AGGREGATE_MESSAGE_TYPES = new Set([
  "relevance-aggregate:record",
  "relevance-aggregate:export",
  "relevance-aggregate:clear",
]);

export function handleRelevanceAggregateMessage(
  message: unknown,
  senderId: string | undefined,
  runtimeId: string,
  store: RelevanceAggregateStore
): Promise<RelevanceAggregateResponse> | null {
  if (typeof message !== "object" || message === null) return null;
  const input = message as { type?: unknown; sample?: unknown };
  if (
    typeof input.type !== "string" ||
    !RELEVANCE_AGGREGATE_MESSAGE_TYPES.has(input.type)
  ) {
    return null;
  }

  if (senderId !== runtimeId) {
    return Promise.resolve({ ok: false, error: "Unauthorized sender" });
  }

  if (input.type === "relevance-aggregate:record") {
    return store
      .record(input.sample)
      .then((recorded) =>
        recorded
          ? { ok: true }
          : { ok: false, error: "Invalid relevance aggregate sample" }
      );
  }

  if (input.type === "relevance-aggregate:export") {
    return store.exportSnapshot().then((data) => ({ ok: true, data }) as const);
  }

  return store.clear().then(() => ({ ok: true }) as const);
}
