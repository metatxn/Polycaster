import { describe, expect, it } from "vitest";
import { liveArgumentsFromSearch } from "./mcp-live-arguments";

describe("liveArgumentsFromSearch", () => {
  it("rejects malformed upstream identifiers", () => {
    expect(
      liveArgumentsFromSearch({
        jsonrpc: "2.0",
        id: 1,
        result: {
          structuredContent: {
            events: [
              {
                id: "1e3",
                slug: "../private-event",
                markets: [
                  {
                    slug: "invalid/market",
                    conditionId: "0x1234",
                    outcomes: [{ tokenId: "-1" }],
                  },
                ],
              },
            ],
          },
        },
      })
    ).toEqual({});
  });
});
