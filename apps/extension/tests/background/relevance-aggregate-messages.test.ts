import { describe, expect, it, vi } from "vitest";
import { handleRelevanceAggregateMessage } from "../../src/background/relevance-aggregate-messages";
import type { RelevanceAggregateStore } from "../../src/background/relevance-aggregate-store";

function createStore(): RelevanceAggregateStore {
  return {
    record: vi.fn(async () => true),
    exportSnapshot: vi.fn(async () => ({
      schemaVersion: 1,
      updatedAt: 1,
      days: [],
    })),
    clear: vi.fn(async () => {}),
  };
}

describe("handleRelevanceAggregateMessage", () => {
  it("rejects aggregate messages from a different extension sender", async () => {
    const store = createStore();

    const response = await handleRelevanceAggregateMessage(
      { type: "relevance-aggregate:export" },
      "other-extension",
      "knoww-extension",
      store
    );

    expect(response).toEqual({ ok: false, error: "Unauthorized sender" });
    expect(store.exportSnapshot).not.toHaveBeenCalled();
  });

  it("records a valid aggregate sample", async () => {
    const store = createStore();
    const sample = {
      kind: "search",
      source: "network",
      outcome: "success",
      latencyMs: 120,
      candidateCount: 8,
    };

    const response = await handleRelevanceAggregateMessage(
      { type: "relevance-aggregate:record", sample },
      "knoww-extension",
      "knoww-extension",
      store
    );

    expect(response).toEqual({ ok: true });
    expect(store.record).toHaveBeenCalledWith(sample);
  });

  it("rejects invalid aggregate samples", async () => {
    const store = createStore();
    vi.mocked(store.record).mockResolvedValueOnce(false);

    const response = await handleRelevanceAggregateMessage(
      { type: "relevance-aggregate:record", sample: { postText: "private" } },
      "knoww-extension",
      "knoww-extension",
      store
    );

    expect(response).toEqual({
      ok: false,
      error: "Invalid relevance aggregate sample",
    });
  });

  it("exports and clears the background-owned snapshot", async () => {
    const store = createStore();

    const exported = await handleRelevanceAggregateMessage(
      { type: "relevance-aggregate:export" },
      "knoww-extension",
      "knoww-extension",
      store
    );
    const cleared = await handleRelevanceAggregateMessage(
      { type: "relevance-aggregate:clear" },
      "knoww-extension",
      "knoww-extension",
      store
    );

    expect(exported).toEqual({
      ok: true,
      data: { schemaVersion: 1, updatedAt: 1, days: [] },
    });
    expect(cleared).toEqual({ ok: true });
    expect(store.clear).toHaveBeenCalledOnce();
  });

  it("ignores unrelated messages", () => {
    const store = createStore();

    expect(
      handleRelevanceAggregateMessage(
        { type: "something-else" },
        "knoww-extension",
        "knoww-extension",
        store
      )
    ).toBeNull();
  });
});
