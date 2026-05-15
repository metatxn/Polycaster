import assert from "node:assert/strict";
import test from "node:test";
import { collectSearchEvidence, getAgentSearchStatus } from "./search-tools.ts";

const item = {
  id: "item_1",
  question: "Will the test market resolve Yes?",
  tokenId: "token_1",
  side: "YES",
  outcomeLabel: "Yes",
  marketSlug: "test-market",
  resolutionSource: "https://example.com/resolution",
  newsUrls: [],
  socialNotes: [],
  active: true,
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("reports configured search providers and missing keys", () => {
  const previous = {
    AGENT_LLM_WEB_SEARCH_ENABLED: process.env.AGENT_LLM_WEB_SEARCH_ENABLED,
    AGENT_LLM_WEB_SEARCH_MODE: process.env.AGENT_LLM_WEB_SEARCH_MODE,
    AGENT_SEARCH_PROVIDERS: process.env.AGENT_SEARCH_PROVIDERS,
    EXA_API_KEY: process.env.EXA_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  };
  process.env.AGENT_LLM_WEB_SEARCH_ENABLED = "true";
  process.env.AGENT_LLM_WEB_SEARCH_MODE = "direct";
  process.env.AGENT_SEARCH_PROVIDERS = "tavily,exa,firecrawl";
  process.env.TAVILY_API_KEY = "tvly-test";
  delete process.env.EXA_API_KEY;
  process.env.FIRECRAWL_API_KEY = "fc-test";

  try {
    assert.deepEqual(getAgentSearchStatus(), {
      enabled: true,
      mode: "direct",
      providers: [
        { provider: "tavily", ready: true, missing: [] },
        { provider: "exa", ready: false, missing: ["EXA_API_KEY"] },
        { provider: "firecrawl", ready: true, missing: [] },
      ],
    });
  } finally {
    restoreEnv(previous);
  }
});

test("disables direct provider search when web search mode is native", async () => {
  const previous = {
    AGENT_LLM_WEB_SEARCH_ENABLED: process.env.AGENT_LLM_WEB_SEARCH_ENABLED,
    AGENT_LLM_WEB_SEARCH_MODE: process.env.AGENT_LLM_WEB_SEARCH_MODE,
    AGENT_SEARCH_PROVIDERS: process.env.AGENT_SEARCH_PROVIDERS,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.AGENT_LLM_WEB_SEARCH_ENABLED = "true";
  process.env.AGENT_LLM_WEB_SEARCH_MODE = "native";
  process.env.AGENT_SEARCH_PROVIDERS = "tavily";
  process.env.TAVILY_API_KEY = "tvly-test";
  globalThis.fetch = async () => {
    throw new Error("direct provider search should not run");
  };

  try {
    assert.deepEqual(getAgentSearchStatus(), {
      enabled: false,
      mode: "native",
      providers: [{ provider: "tavily", ready: true, missing: [] }],
    });
    assert.deepEqual(await collectSearchEvidence(item), []);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previous);
  }
});

test("collects and normalizes Tavily, Exa, and Firecrawl results", async () => {
  const previousEnv = {
    AGENT_LLM_WEB_SEARCH_ENABLED: process.env.AGENT_LLM_WEB_SEARCH_ENABLED,
    AGENT_LLM_WEB_SEARCH_MODE: process.env.AGENT_LLM_WEB_SEARCH_MODE,
    AGENT_SEARCH_PROVIDERS: process.env.AGENT_SEARCH_PROVIDERS,
    AGENT_SEARCH_MAX_RESULTS: process.env.AGENT_SEARCH_MAX_RESULTS,
    EXA_API_KEY: process.env.EXA_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  const requested = [];
  process.env.AGENT_LLM_WEB_SEARCH_ENABLED = "true";
  process.env.AGENT_LLM_WEB_SEARCH_MODE = "direct";
  process.env.AGENT_SEARCH_PROVIDERS = "tavily,exa,firecrawl";
  process.env.AGENT_SEARCH_MAX_RESULTS = "2";
  process.env.TAVILY_API_KEY = "tvly-test";
  process.env.EXA_API_KEY = "exa-test";
  process.env.FIRECRAWL_API_KEY = "fc-test";

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requested.push({ url, init });
    if (url === "https://api.tavily.com/search") {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              title: "Tavily title",
              url: "https://tavily.example/story",
              content: "Tavily content",
              score: 0.9,
            },
          ],
        }),
      };
    }
    if (url === "https://api.exa.ai/search") {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              title: "Exa title",
              url: "https://exa.example/story",
              highlights: ["Exa highlight"],
              score: 0.8,
              publishedDate: "2026-05-11T00:00:00.000Z",
            },
          ],
        }),
      };
    }
    if (url === "https://api.firecrawl.dev/v2/search") {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            web: [
              {
                title: "Firecrawl title",
                url: "https://firecrawl.example/story",
                description: "Firecrawl description",
              },
            ],
          },
        }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const results = await collectSearchEvidence(item);

    assert.deepEqual(
      results.map((result) => ({
        provider: result.provider,
        title: result.title,
        kind: result.kind,
        url: result.url,
        excerpt: result.excerpt,
        publishedAt: result.publishedAt,
      })),
      [
        {
          provider: "tavily",
          title: "Tavily title",
          kind: "news",
          url: "https://tavily.example/story",
          excerpt: "Tavily content",
          publishedAt: null,
        },
        {
          provider: "exa",
          title: "Exa title",
          kind: "web",
          url: "https://exa.example/story",
          excerpt: "Exa highlight",
          publishedAt: "2026-05-11T00:00:00.000Z",
        },
        {
          provider: "firecrawl",
          title: "Firecrawl title",
          kind: "web",
          url: "https://firecrawl.example/story",
          excerpt: "Firecrawl description",
          publishedAt: null,
        },
      ]
    );
    assert.equal(requested.length, 3);
    assert.ok(
      requested.every((entry) =>
        String(entry.init?.body).includes("Will the test market resolve Yes?")
      )
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previousEnv);
  }
});

test("classifies market pages as resolution context and social links separately", async () => {
  const previousEnv = {
    AGENT_LLM_WEB_SEARCH_ENABLED: process.env.AGENT_LLM_WEB_SEARCH_ENABLED,
    AGENT_LLM_WEB_SEARCH_MODE: process.env.AGENT_LLM_WEB_SEARCH_MODE,
    AGENT_SEARCH_PROVIDERS: process.env.AGENT_SEARCH_PROVIDERS,
    AGENT_SEARCH_MAX_RESULTS: process.env.AGENT_SEARCH_MAX_RESULTS,
    EXA_API_KEY: process.env.EXA_API_KEY,
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.AGENT_LLM_WEB_SEARCH_ENABLED = "true";
  process.env.AGENT_LLM_WEB_SEARCH_MODE = "direct";
  process.env.AGENT_SEARCH_PROVIDERS = "exa,firecrawl";
  process.env.AGENT_SEARCH_MAX_RESULTS = "3";
  process.env.EXA_API_KEY = "exa-test";
  process.env.FIRECRAWL_API_KEY = "fc-test";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://api.exa.ai/search") {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              title: "Polymarket rules",
              url: "https://polymarket.com/event/test-market",
              highlights: ["Resolution criteria"],
            },
          ],
        }),
      };
    }
    if (url === "https://api.firecrawl.dev/v2/search") {
      return {
        ok: true,
        json: async () => ({
          data: {
            web: [
              {
                title: "Market odds on X",
                url: "https://x.com/example/status/123",
                description: "Odds moved.",
              },
            ],
          },
        }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const results = await collectSearchEvidence(item);

    assert.deepEqual(
      results.map((result) => ({
        provider: result.provider,
        kind: result.kind,
        url: result.url,
      })),
      [
        {
          provider: "exa",
          kind: "resolution",
          url: "https://polymarket.com/event/test-market",
        },
        {
          provider: "firecrawl",
          kind: "social",
          url: "https://x.com/example/status/123",
        },
      ]
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previousEnv);
  }
});

test("continues collecting search evidence when one provider fails", async () => {
  const previousEnv = {
    AGENT_LLM_WEB_SEARCH_ENABLED: process.env.AGENT_LLM_WEB_SEARCH_ENABLED,
    AGENT_LLM_WEB_SEARCH_MODE: process.env.AGENT_LLM_WEB_SEARCH_MODE,
    AGENT_SEARCH_PROVIDERS: process.env.AGENT_SEARCH_PROVIDERS,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    EXA_API_KEY: process.env.EXA_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.AGENT_LLM_WEB_SEARCH_ENABLED = "true";
  process.env.AGENT_LLM_WEB_SEARCH_MODE = "direct";
  process.env.AGENT_SEARCH_PROVIDERS = "tavily,exa";
  process.env.TAVILY_API_KEY = "tvly-test";
  process.env.EXA_API_KEY = "exa-test";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://api.tavily.com/search") {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              title: "Useful news",
              url: "https://news.example/story",
              content: "Useful content",
            },
          ],
        }),
      };
    }
    if (url === "https://api.exa.ai/search") {
      return {
        ok: false,
        status: 503,
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const results = await collectSearchEvidence(item);

    assert.deepEqual(
      results.map((result) => ({
        provider: result.provider,
        kind: result.kind,
        title: result.title,
      })),
      [{ provider: "tavily", kind: "news", title: "Useful news" }]
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previousEnv);
  }
});
