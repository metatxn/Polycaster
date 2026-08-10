import { describe, expect, it, vi } from "vitest";

const multicall = vi.fn(async () => {
  throw new DOMException("Request timed out", "TimeoutError");
});

vi.mock("@/lib/rpc", () => ({
  getPublicClient: vi.fn(() => ({ multicall })),
}));

import { getSafeOwnersBatch } from "./safe-owner";

describe("getSafeOwnersBatch", () => {
  it("propagates request timeouts instead of caching empty owners", async () => {
    await expect(
      getSafeOwnersBatch(
        ["0x0000000000000000000000000000000000000001"],
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
