import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebMcpTool } from "@/lib/webmcp";
import type { MarketsWebMcpSnapshot } from "./markets-webmcp";
import { useMarketsWebMcp } from "./use-markets-webmcp";

const webMcpMocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  register: vi.fn(),
}));

vi.mock("@/lib/webmcp", () => ({
  registerWebMcpTools: webMcpMocks.register,
}));

function createSnapshot(title: string): MarketsWebMcpSnapshot {
  return {
    viewMode: "categories",
    filters: {
      volume24hr: null,
      volumeWeekly: null,
      volumeWindow: "24h",
      liquidity: null,
      status: ["active"],
      tagSlug: null,
      endWithin: "all",
    },
    pagination: {
      loadedCount: 1,
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
    },
    events: [
      {
        id: "event-1",
        slug: "event-1",
        title,
        active: true,
        closed: false,
        live: false,
        ended: false,
        marketCount: 1,
      },
    ],
    observedAt: "2026-09-03T10:00:00.000Z",
  };
}

describe("useMarketsWebMcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webMcpMocks.register.mockReturnValue(webMcpMocks.cleanup);
  });

  it("registers once, serves fresh page state, and cleans up on unmount", async () => {
    const actions = {
      applyFilters: vi.fn(),
      resetFilters: vi.fn(),
      openEvent: vi.fn(),
      loadMore: vi.fn().mockResolvedValue({
        beforeCount: 1,
        afterCount: 1,
        hasMore: false,
      }),
      searchEvents: vi.fn().mockResolvedValue({
        events: [],
        totalResults: 0,
        hasMore: false,
      }),
    };
    const { rerender, unmount } = renderHook(
      ({ snapshot }) => useMarketsWebMcp({ snapshot, ...actions }),
      { initialProps: { snapshot: createSnapshot("Initial title") } }
    );

    expect(webMcpMocks.register).toHaveBeenCalledTimes(1);
    rerender({ snapshot: createSnapshot("Fresh title") });

    const tools = webMcpMocks.register.mock.calls[0]?.[0] as WebMcpTool[];
    expect(tools).toHaveLength(5);
    const contextTool = tools.find(
      (tool) => tool.name === "get_markets_page_context"
    );
    await expect(contextTool?.execute({})).resolves.toMatchObject({
      events: [{ title: "Fresh title" }],
    });
    expect(webMcpMocks.register).toHaveBeenCalledTimes(1);

    unmount();
    expect(webMcpMocks.cleanup).toHaveBeenCalledOnce();
  });
});
