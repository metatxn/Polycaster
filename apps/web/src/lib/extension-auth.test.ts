import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/extension-session", () => ({
  requireExtensionSession: vi.fn(async (request: NextRequest) =>
    request.headers.get("authorization") === "Bearer valid-session"
      ? {
          response: null,
          session: { sub: "0xabc" },
        }
      : {
          response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
          session: null,
        }
  ),
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

  it("accepts Bearer-authenticated requests with the required scope", async () => {
    const result = await verifyExtensionAccessPreAuth(
      makeRequest({ authorization: "Bearer valid-session" }),
      "ai:extract"
    );
    expect(result.response).toBeNull();
    expect(requireExtensionSession).toHaveBeenCalledWith(
      expect.anything(),
      "ai:extract"
    );
  });

  it("rejects allowed-origin requests without a signed session", async () => {
    const result = await verifyExtensionAccessPreAuth(
      makeRequest({
        origin: "chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc",
      }),
      "ai:extract"
    );
    expect(result.response?.status).toBe(401);
    expect(requireExtensionSession).toHaveBeenCalledWith(
      expect.anything(),
      "ai:extract"
    );
  });

  it("rejects requests with neither Bearer nor allowed origin", async () => {
    const result = await verifyExtensionAccessPreAuth(
      makeRequest({}),
      "ai:extract"
    );
    expect(result.response?.status).toBe(401);
  });
});
