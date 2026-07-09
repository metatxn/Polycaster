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

vi.mock("@/lib/extension-auth", () => ({
  extensionCorsHeaders: vi.fn(() => ({})),
  handleExtensionPreflight: vi.fn(() => new Response(null, { status: 204 })),
  verifyExtensionAccessPreAuth: vi.fn(async () => ({
    response: null,
    trust: "session",
  })),
}));

vi.mock("@/lib/openrouter", () => ({
  createAttributedOpenRouter: vi.fn(() => ({
    chat: vi.fn(() => "mock-model"),
  })),
}));

import { POST } from "./route";

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/ai/validate-relevance", () => {
  it("rejects oversized request bodies before invoking the LLM", async () => {
    const req = new NextRequest("https://knoww.app/api/ai/validate-relevance", {
      method: "POST",
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
