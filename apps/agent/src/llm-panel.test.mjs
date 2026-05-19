import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrompt,
  getLlmPanelStatus,
  getOpenRouterAttribution,
  inspectModelVoteOutput,
  LlmVoteOutputSchema,
  parseModelVoteOutput,
} from "./llm-panel.ts";
import { configuredNativeWebSearchEnabled } from "./search-tools.ts";
import { ModelVoteSchema } from "./types.ts";

test("includes price movement and order book summary in the model prompt", () => {
  const prompt = JSON.parse(
    buildPrompt({
      capturedAt: "2026-05-12T00:00:00.000Z",
      watchlistItem: {
        id: "item_1",
        question: "Will the test market resolve Yes?",
        tokenId: "token_1",
        side: "YES",
        outcomeLabel: "Yes",
        marketType: "binary",
        eventType: "multi_market",
        outcomes: ["Yes", "No"],
        oppositeOutcomeLabel: "No",
        oppositeTokenId: "token_no",
        eventMarketCount: 3,
        newsUrls: [],
        socialNotes: [],
        active: true,
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      market: {
        question: "Will the test market resolve Yes?",
        tokenId: "token_1",
        conditionId: "condition_1",
        marketSlug: "test-market",
        outcomeLabel: "Yes",
        marketType: "binary",
        eventType: "multi_market",
        outcomes: ["Yes", "No"],
        oppositeOutcomeLabel: "No",
        oppositeTokenId: "token_no",
        eventMarketCount: 3,
        eventStartTime: "2026-05-12T00:00:00.000Z",
        eventEndTime: "2026-05-13T00:00:00.000Z",
        resolutionSource: "https://example.com/resolution",
        price: "0.5",
        bestBid: "0.49",
        bestAsk: "0.51",
        midPrice: "0.5",
        spread: "0.02",
        spreadPct: "4",
        liquidityUsd: "100",
        stale: false,
        orderBook: {
          bidDepthUsdTop5: "60",
          askDepthUsdTop5: "40",
          bidAskImbalanceTop5: "0.2",
          bookPressure: "bid-heavy",
          thin: false,
        },
        priceMovement: {
          currentPrice: "0.5",
          lastTradePrice: "0.5",
          lastTradeAt: "2026-05-12T00:00:00.000Z",
          recentHigh: "0.55",
          recentLow: "0.45",
          priceChange5m: "0.01",
          priceChange1h: "0.03",
          priceChange24h: "0.05",
          trend: "up",
        },
      },
      news: [],
      relatedMarkets: [
        {
          question: "Will the test market resolve Yes?",
          tokenId: "token_1",
          conditionId: "condition_1",
          marketSlug: "test-market",
          outcomeLabel: "Yes",
          marketType: "binary",
          eventType: "multi_market",
          eventEndTime: "2026-05-13T00:00:00.000Z",
          price: "0.5",
          active: true,
          selected: true,
        },
      ],
      search: [
        {
          provider: "tavily",
          kind: "news",
          query: "Will the test market resolve Yes?",
          url: "https://example.com/search-result",
          title: "Search result title",
          excerpt: "Search result excerpt",
          publishedAt: null,
          fetchedAt: "2026-05-12T00:00:00.000Z",
          score: 0.7,
        },
      ],
      social: [],
    })
  );

  assert.equal(prompt.market.tokenId, "token_1");
  assert.equal(prompt.market.conditionId, "condition_1");
  assert.equal(prompt.market.marketSlug, "test-market");
  assert.equal(prompt.market.marketType, "binary");
  assert.equal(prompt.market.eventType, "multi_market");
  assert.deepEqual(prompt.market.outcomes, ["Yes", "No"]);
  assert.equal(prompt.market.oppositeOutcomeLabel, "No");
  assert.equal(prompt.market.oppositeTokenId, "token_no");
  assert.equal(prompt.market.eventMarketCount, 3);
  assert.equal(prompt.market.spread, "0.02");
  assert.equal(prompt.market.spreadPct, "4");
  assert.deepEqual(prompt.market.priceMovement, {
    currentPrice: "0.5",
    lastTradePrice: "0.5",
    lastTradeAt: "2026-05-12T00:00:00.000Z",
    recentHigh: "0.55",
    recentLow: "0.45",
    priceChange5m: "0.01",
    priceChange1h: "0.03",
    priceChange24h: "0.05",
    trend: "up",
  });
  assert.deepEqual(prompt.market.orderBook, {
    bidDepthUsdTop5: "60",
    askDepthUsdTop5: "40",
    bidAskImbalanceTop5: "0.2",
    bookPressure: "bid-heavy",
    thin: false,
  });
  assert.deepEqual(prompt.evidence.relatedMarkets, [
    {
      question: "Will the test market resolve Yes?",
      outcomeLabel: "Yes",
      price: "0.5",
      marketType: "binary",
      eventType: "multi_market",
      eventEndTime: "2026-05-13T00:00:00.000Z",
      selected: true,
    },
  ]);
  assert.deepEqual(prompt.evidence.search, [
    {
      provider: "tavily",
      kind: "news",
      query: "Will the test market resolve Yes?",
      url: "https://example.com/search-result",
      title: "Search result title",
      excerpt: "Search result excerpt",
      publishedAt: null,
    },
  ]);
});

test("frames multi-outcome prompts around the tracked token", () => {
  const prompt = JSON.parse(
    buildPrompt({
      capturedAt: "2026-05-12T00:00:00.000Z",
      watchlistItem: {
        id: "item_1",
        question: "Which team will win?",
        tokenId: "arsenal_token",
        outcomeLabel: "Arsenal",
        marketType: "multi_outcome",
        eventType: "single_market",
        outcomes: ["Arsenal", "Draw", "Chelsea"],
        newsUrls: [],
        socialNotes: [],
        active: true,
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      market: {
        question: "Which team will win?",
        tokenId: "arsenal_token",
        outcomeLabel: "Arsenal",
        marketType: "multi_outcome",
        eventType: "single_market",
        outcomes: ["Arsenal", "Draw", "Chelsea"],
        price: "0.45",
        bestBid: "0.44",
        bestAsk: "0.46",
        midPrice: "0.45",
        spread: "0.02",
        spreadPct: "4.444444",
        liquidityUsd: "100",
        stale: false,
        orderBook: {
          bidDepthUsdTop5: "50",
          askDepthUsdTop5: "50",
          bidAskImbalanceTop5: "0",
          bookPressure: "balanced",
          thin: false,
        },
        priceMovement: {
          currentPrice: "0.45",
          lastTradePrice: null,
          lastTradeAt: null,
          recentHigh: null,
          recentLow: null,
          priceChange5m: null,
          priceChange1h: null,
          priceChange24h: null,
          trend: "unknown",
        },
      },
      news: [],
      relatedMarkets: [
        {
          question: "Which team will win?",
          tokenId: "arsenal_token",
          outcomeLabel: "Arsenal",
          marketType: "multi_outcome",
          eventType: "single_market",
          price: "0.45",
          active: true,
          selected: true,
        },
        {
          question: "Which team will win?",
          tokenId: "draw_token",
          outcomeLabel: "Draw",
          marketType: "multi_outcome",
          eventType: "single_market",
          price: "0.25",
          active: true,
          selected: false,
        },
      ],
      search: [],
      social: [],
    })
  );

  assert.equal(prompt.market.marketType, "multi_outcome");
  assert.equal(prompt.market.outcomeLabel, "Arsenal");
  assert.match(prompt.market.outcomeDescription, /specific outcome wins/);
});

test("reports the LLM panel as blocked when OpenRouter is not configured", () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModels = process.env.AGENT_LLM_MODELS;
  delete process.env.OPENROUTER_API_KEY;
  process.env.AGENT_LLM_MODELS = "model-a,model-b,model-c";

  try {
    const status = getLlmPanelStatus();

    assert.equal(status.ready, false);
    assert.equal(status.provider, "openrouter");
    assert.deepEqual(status.models, ["model-a", "model-b", "model-c"]);
    assert.deepEqual(status.missing, ["OPENROUTER_API_KEY"]);
  } finally {
    if (previousKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousKey;
    }
    if (previousModels === undefined) {
      delete process.env.AGENT_LLM_MODELS;
    } else {
      process.env.AGENT_LLM_MODELS = previousModels;
    }
  }
});

test("enables native OpenRouter web search only for native or both modes", () => {
  const previousEnabled = process.env.AGENT_LLM_WEB_SEARCH_ENABLED;
  const previousMode = process.env.AGENT_LLM_WEB_SEARCH_MODE;
  process.env.AGENT_LLM_WEB_SEARCH_ENABLED = "true";

  try {
    process.env.AGENT_LLM_WEB_SEARCH_MODE = "native";
    assert.equal(configuredNativeWebSearchEnabled(), true);
    process.env.AGENT_LLM_WEB_SEARCH_MODE = "both";
    assert.equal(configuredNativeWebSearchEnabled(), true);
    process.env.AGENT_LLM_WEB_SEARCH_MODE = "direct";
    assert.equal(configuredNativeWebSearchEnabled(), false);
    process.env.AGENT_LLM_WEB_SEARCH_ENABLED = "false";
    process.env.AGENT_LLM_WEB_SEARCH_MODE = "native";
    assert.equal(configuredNativeWebSearchEnabled(), false);
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.AGENT_LLM_WEB_SEARCH_ENABLED;
    } else {
      process.env.AGENT_LLM_WEB_SEARCH_ENABLED = previousEnabled;
    }
    if (previousMode === undefined) {
      delete process.env.AGENT_LLM_WEB_SEARCH_MODE;
    } else {
      process.env.AGENT_LLM_WEB_SEARCH_MODE = previousMode;
    }
  }
});

test("uses stable OpenRouter attribution defaults", () => {
  const previousName = process.env.OPENROUTER_APP_NAME;
  const previousUrl = process.env.OPENROUTER_APP_URL;
  const previousPublicUrl = process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.OPENROUTER_APP_NAME;
  delete process.env.OPENROUTER_APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;

  try {
    assert.deepEqual(getOpenRouterAttribution(), {
      appName: "Knoww",
      appUrl: "https://knoww.app",
    });
  } finally {
    if (previousName === undefined) {
      delete process.env.OPENROUTER_APP_NAME;
    } else {
      process.env.OPENROUTER_APP_NAME = previousName;
    }
    if (previousUrl === undefined) {
      delete process.env.OPENROUTER_APP_URL;
    } else {
      process.env.OPENROUTER_APP_URL = previousUrl;
    }
    if (previousPublicUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = previousPublicUrl;
    }
  }
});

test("allows OpenRouter attribution environment overrides", () => {
  const previousName = process.env.OPENROUTER_APP_NAME;
  const previousUrl = process.env.OPENROUTER_APP_URL;
  process.env.OPENROUTER_APP_NAME = "Knoww Paper Agent";
  process.env.OPENROUTER_APP_URL = "https://agent.knoww.app";

  try {
    assert.deepEqual(getOpenRouterAttribution(), {
      appName: "Knoww Paper Agent",
      appUrl: "https://agent.knoww.app",
    });
  } finally {
    if (previousName === undefined) {
      delete process.env.OPENROUTER_APP_NAME;
    } else {
      process.env.OPENROUTER_APP_NAME = previousName;
    }
    if (previousUrl === undefined) {
      delete process.env.OPENROUTER_APP_URL;
    } else {
      process.env.OPENROUTER_APP_URL = previousUrl;
    }
  }
});

test("parses JSON model vote text without requiring provider structured output", () => {
  const output = parseModelVoteOutput(`\`\`\`json
{
  "resolutionView": "Resolves YES if the event occurs by the deadline.",
  "marketImpliedProbability": 0.55,
  "fairProbability": 0.6,
  "edgePct": 5,
  "evidenceFor": ["news headline supports outcome"],
  "evidenceAgainst": [],
  "missingEvidence": ["primary source confirmation"],
  "action": "HOLD",
  "confidence": 0.52,
  "sizeUsd": "0",
  "reasoning": "Evidence is not strong enough for a paper trade.",
  "citations": ["market-data"],
  "riskFlags": ["low-confidence"]
}
\`\`\``);

  assert.deepEqual(output, {
    resolutionView: "Resolves YES if the event occurs by the deadline.",
    marketImpliedProbability: 0.55,
    fairProbability: 0.6,
    edgePct: 5,
    evidenceFor: ["news headline supports outcome"],
    evidenceAgainst: [],
    missingEvidence: ["primary source confirmation"],
    action: "HOLD",
    confidence: 0.52,
    sizeUsd: "0",
    reasoning: "Evidence is not strong enough for a paper trade.",
    citations: ["market-data"],
    riskFlags: ["low-confidence"],
  });
});

test("rejects malformed model vote text", () => {
  assert.equal(parseModelVoteOutput("I think this should be a hold."), null);
});

test("reports invalid JSON diagnostics for model vote text", () => {
  const inspected = inspectModelVoteOutput("I think this should be a hold.");

  assert.equal(inspected.output, null);
  assert.equal(inspected.debug.status, "invalid-json");
  assert.equal(inspected.debug.rawTextLength, 30);
  assert.deepEqual(inspected.debug.validationIssues, [
    "No JSON object braces found in model response.",
  ]);
});

test("reports truncated JSON diagnostics for incomplete model vote text", () => {
  const inspected = inspectModelVoteOutput(`\`\`\`json
{
  "resolutionView": "Resolves YES if the event occurs by the deadline.",
  "marketImpliedProbability": 0.55
`);

  assert.equal(inspected.output, null);
  assert.equal(inspected.debug.status, "invalid-json");
  assert.deepEqual(inspected.debug.validationIssues, [
    "JSON object was truncated before closing brace.",
  ]);
});

test("reports schema diagnostics for incomplete model vote JSON", () => {
  const inspected = inspectModelVoteOutput(`{"action":"HOLD"}`);

  assert.equal(inspected.output, null);
  assert.equal(inspected.debug.status, "schema-invalid");
  assert.ok(
    inspected.debug.validationIssues?.some((issue) =>
      issue.startsWith("confidence:")
    )
  );
});

test("accepts provider numeric outputs before final vote validation clamps range", () => {
  const providerOutput = {
    resolutionView: "Resolves YES if the event occurs by deadline.",
    marketImpliedProbability: 1.5,
    fairProbability: -1,
    edgePct: 250,
    evidenceFor: [],
    evidenceAgainst: [],
    missingEvidence: [],
    action: "HOLD",
    confidence: 2,
    sizeUsd: "0",
    reasoning:
      "Provider schema must not include numeric min or max constraints because some routes reject them.",
    citations: ["market-data"],
    riskFlags: [],
  };

  assert.equal(LlmVoteOutputSchema.safeParse(providerOutput).success, true);
  assert.equal(
    ModelVoteSchema.safeParse({ provider: "model-a", ...providerOutput })
      .success,
    false
  );
});

test("coerces object-shaped citations from tool-use models into strings", () => {
  const providerOutput = {
    resolutionView: "Resolves YES if the event occurs by deadline.",
    marketImpliedProbability: 0.5,
    fairProbability: 0.5,
    edgePct: 0,
    evidenceFor: [],
    evidenceAgainst: [],
    missingEvidence: [],
    action: "HOLD",
    confidence: 0.5,
    sizeUsd: "0",
    reasoning:
      "Some models (gpt-oss-120b, etc.) return citations as structured objects rather than bare strings; the schema must accept either shape.",
    citations: [
      { url: "https://example.com/a", title: "Example A" },
      { type: "url_citation", url_citation: { url: "https://example.com/b" } },
      { href: "https://example.com/c" },
      "https://example.com/d",
      { title: "Source without URL" },
      { url: "" },
      null,
    ],
    riskFlags: [{ description: "low liquidity" }, "fresh-market"],
  };

  const parsed = LlmVoteOutputSchema.safeParse(providerOutput);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data?.citations, [
    "Example A (https://example.com/a)",
    "https://example.com/b",
    "https://example.com/c",
    "https://example.com/d",
    "Source without URL",
  ]);
  assert.deepEqual(parsed.data?.riskFlags, ["low liquidity", "fresh-market"]);
  assert.equal(
    ModelVoteSchema.safeParse({ provider: "model-a", ...parsed.data }).success,
    true
  );
});

test("accepts provider array outputs before final vote validation checks citation counts", () => {
  const providerOutput = {
    resolutionView: "Resolves YES if the event occurs by deadline.",
    marketImpliedProbability: 0.5,
    fairProbability: 0.5,
    edgePct: 0,
    evidenceFor: [],
    evidenceAgainst: [],
    missingEvidence: [],
    action: "HOLD",
    confidence: 0.5,
    sizeUsd: "0",
    reasoning:
      "Provider schema must not include array minItems or maxItems because Anthropic rejects those JSON Schema keywords.",
    citations: [],
    riskFlags: Array.from({ length: 20 }, (_, index) => `risk-${index}`),
  };

  assert.equal(LlmVoteOutputSchema.safeParse(providerOutput).success, true);
  assert.equal(
    ModelVoteSchema.safeParse({ provider: "model-a", ...providerOutput })
      .success,
    false
  );
});
