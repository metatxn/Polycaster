import { generateText } from "ai";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((config) => config),
  },
}));

vi.mock("@/lib/ai-rate-limit", () => ({
  checkAiRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/auth/extension-session", () => ({
  requireExtensionSession: vi.fn(async (request: NextRequest) =>
    request.headers.get("authorization") === "Bearer valid-session"
      ? { response: null, session: { sub: "0xabc" } }
      : {
          response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
          session: null,
        }
  ),
}));

vi.mock("@/lib/openrouter", () => ({
  createAttributedOpenRouter: vi.fn(() => ({
    chat: vi.fn(() => "mock-model"),
  })),
}));

import { POST } from "./route";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/ai/validate-relevance", () => {
  it("rejects an allowed extension origin without a signed session before invoking the LLM", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const req = new NextRequest("https://knoww.app/api/ai/validate-relevance", {
      method: "POST",
      headers: {
        origin: "chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc",
      },
      body: JSON.stringify({
        postText: "Bitcoin is running again",
        marketTitle: "Bitcoin above 100k?",
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("accepts a valid signed session and invokes the LLM", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.mocked(generateText).mockResolvedValue({
      output: {
        relevant: true,
        reason: "Post discusses Bitcoin price",
        confidence: 0.9,
      },
    } as never);
    const req = new NextRequest("https://knoww.app/api/ai/validate-relevance", {
      method: "POST",
      headers: { authorization: "Bearer valid-session" },
      body: JSON.stringify({
        postText: "Bitcoin is running again",
        marketTitle: "Bitcoin above 100k?",
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("rejects oversized request bodies before invoking the LLM", async () => {
    const req = new NextRequest("https://knoww.app/api/ai/validate-relevance", {
      method: "POST",
      headers: { authorization: "Bearer valid-session" },
      body: JSON.stringify({
        postText: "x".repeat(20_000),
        marketTitle: "Bitcoin above 100k?",
      }),
    });

    const res = await POST(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(413);
    expect(body.error).toBe("Request body too large");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects bodies outside the strict request schema", async () => {
    const req = new NextRequest("https://knoww.app/api/ai/validate-relevance", {
      method: "POST",
      headers: { authorization: "Bearer valid-session" },
      body: JSON.stringify({
        postText: "Bitcoin is running again",
        marketTitle: "Bitcoin above 100k?",
        marketTags: ["bitcoin"],
        ignored: "not allowed",
      }),
    });

    const res = await POST(req);
    const body = (await res.json()) as {
      error: string;
      details?: unknown;
    };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid request body");
    expect(body).not.toHaveProperty("details");
    expect(generateText).not.toHaveBeenCalled();
  });
});
