import { afterEach, describe, expect, it, vi } from "vitest";
import { getInitialEvents } from "./server-cache";

describe("getInitialEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps market outcome fields in initial events for stable card SSR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              id: "event-1",
              slug: "event-one",
              title: "Event one",
              markets: [
                {
                  id: "market-1",
                  question: "Will it happen?",
                  outcomes: JSON.stringify(["Yes", "No"]),
                  outcomePrices: JSON.stringify(["0.61", "0.39"]),
                  groupItemTitle: "Yes",
                  clobTokenIds: JSON.stringify(["token-yes", "token-no"]),
                },
              ],
            },
          ],
          next_cursor: "next",
          total_results: "1",
        }),
      } satisfies Partial<Response>)
    );

    const result = await getInitialEvents();

    expect(result?.events[0]?.markets?.[0]).toMatchObject({
      id: "market-1",
      question: "Will it happen?",
      outcomes: JSON.stringify(["Yes", "No"]),
      outcomePrices: JSON.stringify(["0.61", "0.39"]),
      groupItemTitle: "Yes",
    });
  });
});
