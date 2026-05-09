import assert from "node:assert/strict";
import test from "node:test";

declare const process: { cwd(): string };
declare function require(moduleName: string): unknown;

const { readFileSync } = require("node:fs") as {
  readFileSync(path: string, options: { encoding: "utf8" }): string;
};
const { join } = require("node:path") as {
  join(...parts: string[]): string;
};

function readInlineCss(): string {
  return readFileSync(join(process.cwd(), "src/content/knoww-inline.css"), {
    encoding: "utf8",
  });
}

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

function extractFunctionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start !== -1, `expected ${name} to exist`);
  const bodyStart = source.indexOf("{", start);
  assert.ok(bodyStart !== -1, `expected ${name} body to exist`);

  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }

  throw new Error(`Could not extract ${name}`);
}

test("notification panel title and price typography inherit platform fonts", () => {
  const css = readInlineCss();
  const panelOverride = css.match(
    /\/\* ============================================\s+EDITORIAL PANEL OVERRIDE[\s\S]*$/m
  )?.[0];

  assert.ok(panelOverride, "expected editorial panel override CSS to exist");
  const overrideCss = panelOverride ?? "";
  assert.equal(
    /#knoww-notification-stack\s+\.knoww-notification-(?:title|price-num|price-cents)\s*\{[^}]*font-family:\s*"Georgia"/.test(
      overrideCss
    ),
    false
  );
});

test("notification monetary display calculations use Decimal.js", () => {
  const uiSource = readSource("src/content/ui.ts");
  const volumeFormatter = extractFunctionSource(uiSource, "formatMarketVolume");
  const priceRenderer = extractFunctionSource(uiSource, "renderEditorialPrice");

  assert.equal(/import Decimal from "decimal\.js";/.test(uiSource), true);
  assert.equal(/toDecimal\(/.test(volumeFormatter), true);
  assert.equal(/toDecimal\(prices\[[^\]]+\]\)/.test(priceRenderer), true);
  assert.equal(
    /parseFloat|Math\.round|\/\s*1_000/.test(volumeFormatter),
    false
  );
  assert.equal(
    /Math\.round|leadingPrice\s*\*\s*100/.test(priceRenderer),
    false
  );
});

test("stacked market cards stay inside padded feed containers", () => {
  const css = readInlineCss();

  assert.equal(
    /\.knoww-stacked-cards\s*\{[^}]*box-sizing:\s*border-box\s*!important;/.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-stacked-cards\s+\.knoww-market-card\s*\{[^}]*box-sizing:\s*border-box\s*!important;/.test(
      css
    ),
    true
  );
});

test("market card outcome buttons use theme-aware borders", () => {
  const css = readInlineCss();

  assert.equal(
    /\.knoww-outcome-btn\s*\{[^}]*border:\s*1px\s+solid\s+var\(--knoww-border/.test(
      css
    ),
    true
  );
  assert.equal(
    /\.knoww-outcome-btn\s*\{[^}]*background:\s*var\(--knoww-header-chip-bg/.test(
      css
    ),
    true
  );
});

test("notification panel defines theme palettes for light and dim modes", () => {
  const css = readInlineCss();

  assert.equal(
    /#knoww-notification-stack\.knoww-theme-light\s*\{[^}]*--kse-panel:\s*#[a-fA-F0-9]{6};[^}]*--kse-ink:\s*#[a-fA-F0-9]{6};/.test(
      css
    ),
    true
  );
  assert.equal(
    /#knoww-notification-stack\.knoww-theme-dim\s*\{[^}]*--kse-panel:\s*#[a-fA-F0-9]{6};[^}]*--kse-ink:\s*#[a-fA-F0-9]{6};/.test(
      css
    ),
    true
  );
  assert.equal(
    /#knoww-notification-stack\s+\.knoww-search-input\s*\{[^}]*font-family:\s*inherit\s*!important;/.test(
      css
    ),
    true
  );
});

test("notification panel theme refresh runs when settings change", () => {
  const uiSource = readSource("src/content/ui.ts");
  const mainSource = readSource("src/content/main.ts");
  const globalsSource = readSource("src/types/globals.d.ts");

  assert.equal(/updateNotificationStackTheme,/.test(uiSource), true);
  assert.equal(
    /window\.KNOWW_UI\.updateNotificationStackTheme\?\.\(\)/.test(mainSource),
    true
  );
  assert.equal(
    /updateNotificationStackTheme:\s*\(\)\s*=>\s*void;/.test(globalsSource),
    true
  );
});

test("notification panel see all expands the in-page list", () => {
  const css = readInlineCss();
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(
    /#knoww-notification-stack\.knoww-stack-expanded:not\(\.knoww-stack-minimized\)\s*\{[^}]*width:\s*min\(520px,\s*calc\(100vw - 32px\)\)/.test(
      css
    ),
    true
  );
  assert.equal(
    /#knoww-notification-stack\.knoww-stack-expanded\s+\.knoww-stack-items\s*\{[^}]*max-height:\s*min\(640px,\s*calc\(100vh - 180px\)\)/.test(
      css
    ),
    true
  );
  assert.equal(
    /function applyStackExpandedState\([^)]*expanded:\s*boolean[^)]*\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /container\.classList\.toggle\("knoww-stack-expanded",\s*expanded\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /seeAll\.textContent\s*=\s*formatSeeAllLabel\(expanded,\s*0,\s*0\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /window\.open\(\s*KNOWW_APP_URL\s*\|\|\s*"https:\/\/knoww\.app"/.test(
      uiSource
    ),
    false
  );
});

test("notification panel uses user-facing seen earlier copy and count-aware footer", () => {
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(/"Seen earlier"/.test(uiSource), true);
  assert.equal(/"Recently scrolled out"/.test(uiSource), false);
  assert.equal(
    /function formatSeeAllLabel\(\s*expanded:\s*boolean,\s*totalAvailable:\s*number,\s*totalDisplayed:\s*number\s*\):\s*string/.test(
      uiSource
    ),
    true
  );
  assert.equal(/return `See all \$\{totalAvailable\} →`;/.test(uiSource), true);
  assert.equal(
    /updateStackSeeAllButton\(\s*cachedStackExpanded,\s*totalAvailable,\s*totalDisplayed\s*\)/.test(
      uiSource
    ),
    true
  );
});

test("expanded notification panel has in-panel tabs", () => {
  const css = readInlineCss();
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(
    /type StackFilter = "all" \| "active" \| "seen" \| "trending";/.test(
      uiSource
    ),
    true
  );
  assert.equal(/function createStackTabs\(\)/.test(uiSource), true);
  assert.equal(/data-knoww-stack-filter/.test(uiSource), true);
  assert.equal(/activeFilter === "active"/.test(uiSource), true);
  assert.equal(/activeFilter === "seen"/.test(uiSource), true);
  assert.equal(/activeFilter === "trending"/.test(uiSource), true);
  assert.equal(
    /#knoww-notification-stack\s+\.knoww-stack-tabs\s*\{[^}]*display:\s*none/.test(
      css
    ),
    true
  );
  assert.equal(
    /#knoww-notification-stack\.knoww-stack-expanded\s+\.knoww-stack-tabs\s*\{[^}]*display:\s*flex/.test(
      css
    ),
    true
  );
});

test("expanded notification panel tabs are readable and selected state is obvious", () => {
  const css = readInlineCss();

  assert.equal(
    /#knoww-notification-stack\s+\.knoww-stack-tab\s*\{[^}]*font-size:\s*10px/.test(
      css
    ),
    true
  );
  assert.equal(
    /#knoww-notification-stack\s+\.knoww-stack-tab\s*\{[^}]*padding:\s*8px\s+11px/.test(
      css
    ),
    true
  );
  assert.equal(
    /#knoww-notification-stack\s+\.knoww-stack-tab\.knoww-stack-tab-active\s*\{[^}]*background:\s*var\(--kse-tab-active-bg\)/.test(
      css
    ),
    true
  );
  assert.equal(
    /#knoww-notification-stack\.knoww-theme-light\s*\{[^}]*--kse-tab-active-bg:\s*#[a-fA-F0-9]{6};/.test(
      css
    ),
    true
  );
});

test("expanded trending tab can show more trending markets", () => {
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(/const MAX_TRENDING_DISPLAY = 2;/.test(uiSource), true);
  assert.equal(
    /const MAX_EXPANDED_TRENDING_DISPLAY = 10;/.test(uiSource),
    true
  );
  assert.equal(
    /function getVisibleTrendingMarkets\(\s*realMarketIds:\s*Set<string>,\s*expandedTrending:\s*boolean\s*\):\s*Market\[\]/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /expandedTrending\s*\?\s*trendingPool\s*:\s*visibleTrending/.test(uiSource),
    true
  );
  assert.equal(
    /expandedTrending\s*\?\s*MAX_EXPANDED_TRENDING_DISPLAY\s*:\s*MAX_TRENDING_DISPLAY/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /appendTrendingSection\(\s*itemsContainer,\s*realMarketIds,\s*animationIndex,\s*cachedStackExpanded && activeFilter === "trending"\s*\)/.test(
      uiSource
    ),
    true
  );
});

test("expanded notification panel is clamped back into the viewport", () => {
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(
    /function clampNotificationStackToViewport\(\s*container:\s*HTMLElement\s*\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /window\.innerWidth - rect\.width - NOTIFICATION_STACK_VIEWPORT_MARGIN/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /container\.style\.setProperty\("right",\s*"auto",\s*"important"\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /requestAnimationFrame\(\(\)\s*=>\s*clampNotificationStackToViewport\(container\)\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /window\.addEventListener\("resize",\s*\(\)\s*=>\s*\{[^}]*clampNotificationStackToViewport\(notificationStackContainer\)/s.test(
      uiSource
    ),
    true
  );
});

test("notification panel supports session expansion and keyboard controls", () => {
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(
    /STACK_EXPANDED_SESSION_KEY\s*=\s*"knoww-stack-expanded"/.test(uiSource),
    true
  );
  assert.equal(
    /function readPersistedStackExpanded\(\):\s*boolean/.test(uiSource),
    true
  );
  assert.equal(
    /function persistStackExpanded\(value:\s*boolean\):\s*void/.test(uiSource),
    true
  );
  assert.equal(
    /sessionStorage\.setItem\(\s*STACK_EXPANDED_SESSION_KEY/.test(uiSource),
    true
  );
  assert.equal(
    /function handleNotificationStackKeydown\(e:\s*KeyboardEvent\):\s*void/.test(
      uiSource
    ),
    true
  );
  assert.equal(/e\.key === "Escape"/.test(uiSource), true);
  assert.equal(
    /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/.test(uiSource),
    true
  );
});

test("notification empty and seen-earlier states expose clearer actions", () => {
  const uiSource = readSource("src/content/ui.ts");
  const css = readInlineCss();

  assert.equal(/No markets found on this page yet/.test(uiSource), true);
  assert.equal(/data-knoww-browse-trending/.test(uiSource), true);
  assert.equal(/Browse trending/.test(uiSource), true);
  assert.equal(/knoww-notification-action-label/.test(uiSource), true);
  assert.equal(/Restore/.test(uiSource), true);
  assert.equal(
    /#knoww-notification-stack\s+\.knoww-notification-action-label\s*\{[^}]*color:\s*var\(--kse-ink-dim\)/.test(
      css
    ),
    true
  );
});
