import { generateText } from "ai";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTopicExtractionModelName } from "./model-config";

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

import { GET, POST } from "./route";

const originalOpenRouterLlmModel = process.env.OPENROUTER_LLM_MODEL;

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalOpenRouterLlmModel === undefined) {
    delete process.env.OPENROUTER_LLM_MODEL;
  } else {
    process.env.OPENROUTER_LLM_MODEL = originalOpenRouterLlmModel;
  }
  vi.clearAllMocks();
});

describe("getTopicExtractionModelName", () => {
  it("uses OPENROUTER_LLM_MODEL when configured", () => {
    process.env.OPENROUTER_LLM_MODEL = " anthropic/claude-haiku-4.5 ";

    expect(getTopicExtractionModelName()).toBe("anthropic/claude-haiku-4.5");
  });

  it("falls back to the current extractor model when unset", () => {
    delete process.env.OPENROUTER_LLM_MODEL;

    expect(getTopicExtractionModelName()).toBe("openai/gpt-5.4-nano");
  });
});

describe("POST /api/ai/extract-topics", () => {
  it("rejects an allowed extension origin without a signed session before invoking the LLM", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const req = new NextRequest("https://knoww.app/api/ai/extract-topics", {
      method: "POST",
      headers: {
        origin: "chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc",
      },
      body: JSON.stringify({
        text: "Bitcoin price momentum is accelerating into the weekend",
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
        category: "crypto",
        entities: ["Bitcoin"],
        tags: ["bitcoin"],
        searchQuery: "bitcoin price momentum",
        confidence: 0.9,
      },
    } as never);
    const req = new NextRequest("https://knoww.app/api/ai/extract-topics", {
      method: "POST",
      headers: { authorization: "Bearer valid-session" },
      body: JSON.stringify({
        text: "Authenticated POST extraction for Bitcoin price momentum",
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("rejects oversized request bodies before invoking the LLM", async () => {
    const req = new NextRequest("https://knoww.app/api/ai/extract-topics", {
      method: "POST",
      headers: { authorization: "Bearer valid-session" },
      body: JSON.stringify({
        text: "Bitcoin ".repeat(3000),
      }),
    });

    const res = await POST(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(413);
    expect(body.error).toBe("Request body too large");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects bodies outside the strict request schema", async () => {
    const req = new NextRequest("https://knoww.app/api/ai/extract-topics", {
      method: "POST",
      headers: { authorization: "Bearer valid-session" },
      body: JSON.stringify({
        text: "Bitcoin is running again",
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

describe("GET /api/ai/extract-topics", () => {
  it("rejects an allowed extension origin without a signed session before invoking the LLM", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const req = new NextRequest(
      "https://knoww.app/api/ai/extract-topics?text=Bitcoin+price+momentum+is+accelerating",
      {
        headers: {
          origin: "chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc",
        },
      }
    );

    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("accepts a valid signed session and invokes the LLM", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.mocked(generateText).mockResolvedValue({
      output: {
        category: "crypto",
        entities: ["Bitcoin"],
        tags: ["bitcoin"],
        searchQuery: "bitcoin price momentum",
        confidence: 0.9,
      },
    } as never);
    const req = new NextRequest(
      "https://knoww.app/api/ai/extract-topics?text=Authenticated+GET+extraction+for+Bitcoin+momentum",
      { headers: { authorization: "Bearer valid-session" } }
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(generateText).toHaveBeenCalledOnce();
  });
});
