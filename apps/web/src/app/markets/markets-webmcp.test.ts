import { describe, expect, it, vi } from "vitest";
import {
  createMarketsWebMcpTools,
  type MarketsWebMcpSnapshot,
} from "./markets-webmcp";

const snapshot: MarketsWebMcpSnapshot = {
  viewMode: "trending",
  filters: {
    volume24hr: null,
    volumeWeekly: null,
    volumeWindow: "24h",
    liquidity: 50_000,
    status: ["active"],
    tagSlug: "politics",
    endWithin: "all",
  },
  pagination: {
    loadedCount: 2,
    hasMore: true,
    isLoading: false,
    isLoadingMore: false,
  },
  events: [
    {
      id: "event-1",
      slug: "first-event",
      title: "First event",
      active: true,
      closed: false,
      live: false,
      ended: false,
      volume: "1000000",
      volume24hr: 125000,
      liquidity: 75000,
      marketCount: 3,
    },
    {
      id: "event-2",
      slug: "second-event",
      title: "Second event",
      active: true,
      closed: false,
      live: true,
      ended: false,
      volume: "800000",
      volume24hr: 90000,
      liquidity: 62000,
      marketCount: 2,
    },
  ],
  dataUpdatedAt: "2026-09-03T10:00:00.000Z",
  observedAt: "2026-09-03T10:00:01.000Z",
};

function setup(currentSnapshot: MarketsWebMcpSnapshot = snapshot) {
  const applyFilters = vi.fn();
  const resetFilters = vi.fn();
  const openEvent = vi.fn();
  const loadMore = vi.fn().mockResolvedValue({
    beforeCount: 2,
    afterCount: 4,
    hasMore: false,
  });
  const searchEvents = vi.fn().mockResolvedValue({
    events: [
      {
        id: "event-3",
        slug: "searched-event",
        title: "Searched event",
        active: true,
        closed: false,
        live: false,
        ended: false,
        volume: 500000,
        volume24hr: 44000,
        liquidity: 25000,
        marketCount: 1,
        topOutcome: { name: "Yes", price: 0.64 },
      },
    ],
    totalResults: 1,
    hasMore: false,
  });
  const tools = createMarketsWebMcpTools({
    getSnapshot: () => currentSnapshot,
    applyFilters,
    resetFilters,
    openEvent,
    loadMore,
    searchEvents,
  });
  const byName = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Missing tool: ${name}`);
    return tool;
  };

  return {
    applyFilters,
    byName,
    loadMore,
    openEvent,
    resetFilters,
    searchEvents,
    tools,
  };
}

describe("markets page WebMCP tools", () => {
  it("registers the five markets-page tools", () => {
    const { tools } = setup();

    expect(tools.map((tool) => tool.name)).toEqual([
      "get_markets_page_context",
      "search_events",
      "set_market_filters",
      "open_event",
      "load_more_markets",
    ]);
  });

  it("returns a bounded page context without private user data", async () => {
    const { byName } = setup();
    const tool = byName("get_markets_page_context");

    await expect(tool.execute({ limit: 1 })).resolves.toMatchObject({
      view: "trending",
      filters: {
        minimum_liquidity: 50_000,
        status: ["active"],
        tag_slug: "politics",
      },
      pagination: { loaded_count: 2, has_more: true },
      events: [
        {
          event_id: "event-1",
          event_slug: "first-event",
          title: "First event",
          market_count: 3,
          path: "/events/detail/first-event",
        },
      ],
      truncated: true,
    });
    await expect(tool.execute({ limit: 21 })).rejects.toThrow(
      "Invalid markets-page context input"
    );
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("searches with the active tag and remembers results for navigation", async () => {
    const { byName, openEvent, searchEvents } = setup();
    const tool = byName("search_events");

    await expect(
      tool.execute({ query: "election", limit: 5 })
    ).resolves.toMatchObject({
      query: "election",
      tag_slug: "politics",
      total_results: 1,
      has_more: false,
      events: [
        {
          event_id: "event-3",
          event_slug: "searched-event",
          title: "Searched event",
          top_outcome: { name: "Yes", price: 0.64 },
          path: "/events/detail/searched-event",
        },
      ],
    });
    expect(searchEvents).toHaveBeenCalledWith("election", 5, "politics");

    await expect(
      byName("open_event").execute({ event_id: "event-3" })
    ).resolves.toMatchObject({ opened: true, event_id: "event-3" });
    expect(openEvent).toHaveBeenCalledWith("/events/detail/searched-event");
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("rejects oversized searches and hides upstream error details", async () => {
    const { byName, searchEvents } = setup();
    const tool = byName("search_events");

    await expect(tool.execute({ query: "x" })).rejects.toThrow(
      "Invalid event search"
    );
    searchEvents.mockRejectedValueOnce(new Error("internal upstream details"));
    await expect(tool.execute({ query: "valid" })).rejects.toThrow(
      "Event search is temporarily unavailable"
    );
  });

  it("bounds search output even if the upstream returns too many events", async () => {
    const { byName, searchEvents } = setup();
    searchEvents.mockResolvedValueOnce({
      events: Array.from({ length: 12 }, (_, index) => ({
        id: `extra-${index}`,
        slug: `extra-${index}`,
        title: `Extra event ${index}`,
        active: true,
        closed: false,
        live: false,
        ended: false,
        marketCount: 1,
      })),
      totalResults: 12,
      hasMore: true,
    });

    const result = (await byName("search_events").execute({
      query: "extra",
      limit: 3,
    })) as { events: unknown[] };

    expect(result.events).toHaveLength(3);
    await expect(
      byName("open_event").execute({ event_id: "extra-3" })
    ).rejects.toThrow("Event is not available from this page");
  });

  it("applies only supported filter values and can reset them", async () => {
    const { applyFilters, byName, resetFilters } = setup();
    const tool = byName("set_market_filters");

    await expect(
      tool.execute({
        view: "new",
        minimum_volume_24h: 100_000,
        minimum_liquidity: null,
        volume_window: "1wk",
        status: ["active", "live"],
        tag_slug: "crypto",
        end_within: "7d",
      })
    ).resolves.toMatchObject({
      changed: true,
      reset: false,
      applied: {
        view: "new",
        minimum_volume_24h: 100_000,
        minimum_liquidity: null,
        volume_window: "1wk",
        status: ["active", "live"],
        tag_slug: "crypto",
        end_within: "7d",
      },
    });
    expect(applyFilters).toHaveBeenCalledWith({
      viewMode: "new",
      volume24hr: 100_000,
      liquidity: null,
      volumeWindow: "1wk",
      status: ["active", "live"],
      tagSlug: "crypto",
      endWithin: "7d",
    });

    await expect(tool.execute({ reset: true })).resolves.toEqual({
      changed: true,
      reset: true,
    });
    expect(resetFilters).toHaveBeenCalledOnce();

    await expect(tool.execute({})).rejects.toThrow(
      "At least one market filter is required"
    );
    await expect(tool.execute({ reset: false })).rejects.toThrow(
      "At least one market filter is required"
    );
    await expect(
      tool.execute({ reset: true, view: "trending" })
    ).rejects.toThrow("reset cannot be combined with other filters");
    await expect(
      tool.execute({ status: ["active", "active"] })
    ).rejects.toThrow("Market filter values are invalid");
  });

  it("opens only events from the current page or latest search", async () => {
    const { byName, openEvent } = setup();
    const tool = byName("open_event");

    await expect(tool.execute({ event_id: "event-1" })).resolves.toMatchObject({
      opened: true,
      event_id: "event-1",
      path: "/events/detail/first-event",
    });
    expect(openEvent).toHaveBeenCalledWith("/events/detail/first-event");

    await expect(tool.execute({ event_id: "unknown-event" })).rejects.toThrow(
      "Event is not available from this page"
    );
    expect(openEvent).toHaveBeenCalledTimes(1);
  });

  it("loads one page and reports before and after counts", async () => {
    const { byName, loadMore } = setup();
    const tool = byName("load_more_markets");

    await expect(tool.execute({})).resolves.toEqual({
      requested: true,
      loaded: true,
      before_count: 2,
      after_count: 4,
      has_more: false,
    });
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it("does not request another page when pagination is exhausted", async () => {
    const exhaustedSnapshot: MarketsWebMcpSnapshot = {
      ...snapshot,
      pagination: { ...snapshot.pagination, hasMore: false },
    };
    const { byName, loadMore } = setup(exhaustedSnapshot);

    await expect(byName("load_more_markets").execute({})).resolves.toEqual({
      requested: false,
      loaded: false,
      before_count: 2,
      after_count: 2,
      has_more: false,
      reason: "No more markets are available",
    });
    expect(loadMore).not.toHaveBeenCalled();
  });
});
