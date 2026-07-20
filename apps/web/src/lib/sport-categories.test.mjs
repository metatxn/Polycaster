import assert from "node:assert/strict";
import test from "node:test";
import { getSportEntry } from "./sport-categories.ts";

test("resolves an active league entry to its Gamma tag slug and series id", () => {
  const mls = getSportEntry("mls");

  assert.equal(mls?.tagSlug, "mls-2025");
  assert.equal(mls?.seriesId, 10189);
});

test("returns undefined for the retired FIFA World Cup entry", () => {
  // Removed after the 2026 World Cup concluded; kept as a guard so the
  // entry isn't silently reintroduced without a deliberate decision.
  assert.equal(getSportEntry("fifa-world-cup"), undefined);
});
