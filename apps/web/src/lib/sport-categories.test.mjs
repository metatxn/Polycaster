import assert from "node:assert/strict";
import test from "node:test";
import { getSportEntry } from "./sport-categories.ts";

test("uses the active Gamma tag slug for FIFA World Cup", () => {
  const fifa = getSportEntry("fifa-world-cup");

  assert.equal(fifa?.tagSlug, "fifa-world-cup");
  assert.equal(fifa?.seriesId, 11433);
});
