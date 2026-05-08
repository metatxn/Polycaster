import assert from "node:assert/strict";
import test from "node:test";
import { getSportRailOpenGroupSlugsFromEvents } from "./sport-rail-open-groups.ts";

const groups = [
  {
    slug: "basketball",
    tagSlug: "basketball",
    leagues: [{ tagSlug: "nba" }],
  },
  {
    slug: "soccer",
    tagSlug: "soccer",
    leagues: [{ tagSlug: "lib" }],
  },
  {
    slug: "baseball",
    tagSlug: "baseball",
    leagues: [{ tagSlug: "mlb" }],
  },
];

test("opens basketball when a live event is tagged NBA", () => {
  const openGroups = getSportRailOpenGroupSlugsFromEvents(
    [
      {
        tags: [{ slug: "sports" }, { slug: "nba" }, { slug: "basketball" }],
      },
    ],
    groups
  );

  assert.deepEqual(openGroups, ["basketball"]);
});

test("opens parent groups for live league tags", () => {
  const openGroups = getSportRailOpenGroupSlugsFromEvents(
    [
      { tags: [{ slug: "mlb" }, { slug: "baseball" }] },
      { tags: [{ slug: "soccer" }, { slug: "lib" }] },
    ],
    groups
  );

  assert.deepEqual(openGroups, ["baseball", "soccer"]);
});

test("ignores generic sports tags without a matching group or league", () => {
  const openGroups = getSportRailOpenGroupSlugsFromEvents(
    [{ tags: [{ slug: "sports" }, { slug: "games" }] }],
    groups
  );

  assert.deepEqual(openGroups, []);
});
