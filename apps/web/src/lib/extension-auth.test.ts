import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/extension-session", () => ({
  requireExtensionSession: vi.fn(async () => ({
    response: null,
    session: { sub: "0xabc" },
  })),
}));

import { requireExtensionSession } from "@/lib/auth/extension-session";
import { verifyExtensionAccessPreAuth } from "./extension-auth";

function makeRequest(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

describe("verifyExtensionAccessPreAuth", () => {
  it("does not run under the dev bypass (guards the suite against vacuous passes)", () => {
    expect(process.env.NODE_ENV).not.toBe("development");
  });

  it("returns session trust for Bearer-authenticated requests", async () => {
    const result = await verifyExtensionAccessPreAuth(
      makeRequest({ authorization: "Bearer token123" }),
      "ai:extract"
    );
    expect(result.trust).toBe("session");
    expect(result.response).toBeNull();
    expect(requireExtensionSession).toHaveBeenCalled();
  });

  it("returns low-trust for allowed-origin requests without a Bearer token", async () => {
    const result = await verifyExtensionAccessPreAuth(
      makeRequest({
        origin: "chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc",
      }),
      "ai:extract"
    );
    expect(result.trust).toBe("low-trust");
    expect(result.response).toBeNull();
  });

  it("rejects requests with neither Bearer nor allowed origin", async () => {
    const result = await verifyExtensionAccessPreAuth(
      makeRequest({}),
      "ai:extract"
    );
    expect(result.response?.status).toBe(403);
  });
});
