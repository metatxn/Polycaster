import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const globals = read("src/app/globals.css");
const landingPage = read("src/app/page.tsx");
const landingStyles = read("src/app/styles/landing-route.css");
const privacyPage = read("src/app/privacy/page.tsx");
const productStyles = read("src/app/styles/product.css");

const productLayouts = [
  "src/app/agent/layout.tsx",
  "src/app/events/layout.tsx",
  "src/app/leaderboard/layout.tsx",
  "src/app/live/layout.tsx",
  "src/app/markets/layout.tsx",
  "src/app/portfolio/layout.tsx",
  "src/app/profile/layout.tsx",
  "src/app/search/layout.tsx",
  "src/app/sports/layout.tsx",
  "src/app/whales/layout.tsx",
];

test("root CSS contains only shared foundation styles", () => {
  for (const surfaceStylesheet of [
    "marketing.css",
    "landing.css",
    "tweet-overlay.css",
    "markets.css",
    "onboarding.css",
    "ticket.css",
  ]) {
    assert.doesNotMatch(globals, new RegExp(surfaceStylesheet));
  }

  assert.match(globals, /@import "tailwindcss";/);
  assert.match(globals, /@import "\.\/styles\/theme-base\.css";/);
  assert.match(globals, /@import "\.\/styles\/base\.css";/);
  assert.match(globals, /@import "\.\/styles\/app-tokens\.css";/);
});

test("marketing routes own their required styles", () => {
  assert.match(landingPage, /import "\.\/styles\/landing-route\.css";/);
  assert.match(landingStyles, /@import "\.\/marketing\.css";/);
  assert.match(landingStyles, /@import "\.\/landing\.css";/);
  assert.match(landingStyles, /@import "\.\/tweet-overlay\.css";/);
  assert.match(privacyPage, /import "\.\.\/styles\/marketing\.css";/);
});

test("product route layouts own the product stylesheet", () => {
  assert.match(productStyles, /@reference "\.\.\/globals\.css";/);
  assert.match(productStyles, /@import "\.\/markets\.css";/);
  assert.match(productStyles, /@import "\.\/onboarding\.css";/);
  assert.match(productStyles, /@import "\.\/ticket\.css";/);

  for (const layoutPath of productLayouts) {
    assert.ok(
      existsSync(layoutPath),
      `${layoutPath} must define a CSS boundary`
    );
    assert.match(
      read(layoutPath),
      /import "@\/app\/styles\/product\.css";/,
      `${layoutPath} must import the product stylesheet`
    );
  }
});
