import assert from "node:assert/strict";
import { test } from "vitest";
import {
  COMBINED_SEARCH_RESULT_LIMIT,
  capCombinedSearchResults,
  capPolymarketSearchResults,
  POLYMARKET_SEARCH_RESULT_LIMIT,
} from "../../src/content/retrieval-limits";

test("Polymarket retrieval stays at eight until wider capacity is approved", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => index + 1);

  assert.equal(POLYMARKET_SEARCH_RESULT_LIMIT, 8);
  assert.deepEqual(
    capPolymarketSearchResults(candidates),
    candidates.slice(0, 8)
  );
  assert.equal(candidates.length, 25);
});

test("combined retrieval stays at ten until wider capacity is approved", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => index + 1);

  assert.equal(COMBINED_SEARCH_RESULT_LIMIT, 10);
  assert.deepEqual(
    capCombinedSearchResults(candidates),
    candidates.slice(0, 10)
  );
  assert.equal(candidates.length, 25);
});
