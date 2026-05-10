import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidencePack } from "./evidence.ts";

const item = {
  id: "item_1",
  question: "Will the test market resolve Yes?",
  tokenId: "token_1",
  side: "YES",
  outcomeLabel: "Yes",
  eventStartTime: "2026-05-09T00:00:00.000Z",
  eventEndTime: "2026-05-10T00:00:00.000Z",
  resolutionSource: "https://example.com/resolution",
  newsUrls: [],
  socialNotes: [],
  active: true,
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

test("builds market evidence from the order book without side-less price fetches", async () => {
  const previousFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    assert.match(url, /\/book\?/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        bids: [{ price: "0.40", size: "100" }],
        asks: [{ price: "0.60", size: "50" }],
      }),
    };
  };

  try {
    const evidence = await buildEvidencePack(item);

    assert.equal(evidence.market.price, "0.5");
    assert.equal(evidence.market.liquidityUsd, "70");
    assert.equal(evidence.market.outcomeLabel, "Yes");
    assert.equal(evidence.market.eventEndTime, "2026-05-10T00:00:00.000Z");
    assert.equal(
      evidence.market.resolutionSource,
      "https://example.com/resolution"
    );
    assert.equal(requestedUrls.length, 1);
    assert.ok(!requestedUrls.some((url) => url.includes("/price?")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});
