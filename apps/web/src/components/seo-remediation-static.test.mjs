import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("internal sports links target the final canonical URL", () => {
  const sources = [
    "src/app/about/page.tsx",
    "src/app/how-knoww-works/page.tsx",
    "src/app/guides/[slug]/what-is-a-prediction-market.tsx",
    "src/app/events/sports/[sport]/page.tsx",
    "src/app/events/sports/sports-content.tsx",
    "src/app/home-content.tsx",
  ].map(read);

  for (const source of sources) {
    assert.doesNotMatch(source, /href=["']\/events\/sports["']/);
    assert.doesNotMatch(source, /canonicalUrl\(["']\/events\/sports["']\)/);
  }

  assert.doesNotMatch(
    read("src/app/home-content.tsx"),
    /\{\s*slug:\s*["']sports["']/
  );
});

test("data-nosnippet is only attached to Google-supported wrapper elements", () => {
  const leagueRail = read("src/components/league-rail.tsx");

  assert.doesNotMatch(leagueRail, /<aside\s+data-nosnippet/);
  assert.doesNotMatch(leagueRail, /<select\s+data-nosnippet/);
  assert.match(leagueRail, /<(?:div|section)\s+data-nosnippet/);
});

// The SEO audit proposed "Prediction Markets While You Browse"; the owner kept
// the original title, which already leads with the primary keyword. This test
// locks in that decision so the audit variant is not reintroduced.
test("homepage metadata uses the owner-approved positioning title", () => {
  const homepage = read("src/app/page.tsx");

  assert.match(homepage, /Knoww — Prediction markets for every opinion/);
  assert.doesNotMatch(homepage, /Prediction Markets While You Browse/);
});

test("landing line breaks preserve word boundaries for crawlers and assistive tech", () => {
  const sources = [
    "src/app/page.tsx",
    "src/components/landing/knoww-sections.tsx",
    "src/components/landing/landing-chrome.tsx",
  ].map(read);

  for (const source of sources) {
    assert.doesNotMatch(source, /<br \/>(?!\{" "\}| )/);
  }
});
