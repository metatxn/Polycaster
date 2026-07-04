import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

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

  assert.equal(/import \{ Decimal \} from "decimal\.js";/.test(uiSource), true);
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

test("notification stack close persists until explicitly reopened", () => {
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(
    /const STACK_DISMISSED_STORAGE_KEY = "knoww-stack-dismissed";/.test(
      uiSource
    ),
    true
  );
  assert.equal(/function readPersistedStackDismissed/.test(uiSource), true);
  assert.equal(/function persistStackDismissed/.test(uiSource), true);
  assert.equal(
    /persistStackDismissed\(true\);[\s\S]*notification_stack_closed/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /readPersistedStackDismissed\(\)\.then\(\(dismissed\) => \{[\s\S]*if \(dismissed\) return;[\s\S]*createNotificationStack\(\);/.test(
      uiSource
    ),
    true
  );
});

test("notification stack exposes settings and action-open controls", () => {
  const uiSource = readSource("src/content/ui.ts");
  const backgroundSource = readSource("src/background.ts");

  assert.equal(/KNOWW_OPEN_EXTENSION/.test(uiSource), true);
  assert.equal(/KNOWW_OPEN_EXTENSION_SETTINGS/.test(uiSource), true);
  assert.equal(
    /settingsBtn\.className = "knoww-stack-settings";/.test(uiSource),
    true
  );
  assert.equal(
    /safeSendMessage\(\{\s*type:\s*"KNOWW_OPEN_EXTENSION_SETTINGS"/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /msg\?\.type === "KNOWW_OPEN_EXTENSION_SETTINGS"[\s\S]*chrome\.runtime\.openOptionsPage\(\)/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /chrome\.tabs\.sendMessage\([^)]*type: "KNOWW_OPEN_EXTENSION"/s.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /chrome\.action\.onClicked\.addListener\(\(\) => \{\s*chrome\.runtime\.openOptionsPage\(\);\s*\}\);/.test(
      backgroundSource
    ),
    false
  );
});

test("notification stack icon reopen restores preferred top-right position", () => {
  const uiSource = readSource("src/content/ui.ts");
  const resetSource = extractFunctionSource(
    uiSource,
    "resetNotificationStackToPreferredPosition"
  );
  const visibilitySource = extractFunctionSource(
    uiSource,
    "setNotificationStackVisibility"
  );

  assert.equal(/style\.removeProperty\("left"\)/.test(resetSource), true);
  assert.equal(/style\.removeProperty\("top"\)/.test(resetSource), true);
  assert.equal(/style\.removeProperty\("right"\)/.test(resetSource), true);
  assert.equal(
    /resetNotificationStackToPreferredPosition\(notificationStackContainer\)/.test(
      visibilitySource
    ),
    true
  );
});

test("notification stack snapshot includes trending and supports sidepanel focus", () => {
  const uiSource = readSource("src/content/ui.ts");
  const snapshotSource = extractFunctionSource(
    uiSource,
    "getNotificationStackSnapshot"
  );
  const timerSource = extractFunctionSource(
    uiSource,
    "startTrendingFetchTimer"
  );
  const fetchSource = extractFunctionSource(uiSource, "fetchAndCacheTrending");
  const focusSource = extractFunctionSource(
    uiSource,
    "focusNotificationStackMarket"
  );

  assert.equal(/startTrendingFetchTimer\(\)/.test(snapshotSource), true);
  assert.equal(/trendingFetchInFlight\s*=\s*false/.test(uiSource), true);
  assert.equal(/trendingFetchInFlight/.test(timerSource), true);
  assert.equal(/trendingFetchTimer/.test(timerSource), true);
  assert.equal(/trendingPool\.length > 0/.test(timerSource), true);
  assert.equal(/cancelTrendingFetchTimer\(\)/.test(timerSource), false);
  assert.equal(
    /finally\s*\{[\s\S]*trendingFetchInFlight\s*=\s*false/.test(fetchSource),
    true
  );
  assert.equal(/getVisibleTrendingMarkets/.test(snapshotSource), true);
  assert.equal(/trendingLimit/.test(snapshotSource), true);
  assert.equal(/trending:\s*trendingMarkets\.map/.test(snapshotSource), true);
  assert.equal(
    /summarizeSnapshotMarket\(market,\s*"trending"\)/.test(snapshotSource),
    true
  );
  assert.equal(/selectRepresentativeMarketEntries/.test(focusSource), true);
  assert.equal(/scrollToMarket\(/.test(focusSource), true);
  assert.equal(/visibleTrending/.test(focusSource), true);
  assert.equal(/trendingPool/.test(focusSource), true);
  assert.equal(/KNOWW_FOCUS_NOTIFICATION_MARKET/.test(uiSource), true);
});

test("notification stack supports sidepanel search requests", () => {
  const uiSource = readSource("src/content/ui.ts");
  const searchSource = extractFunctionSource(
    uiSource,
    "searchNotificationStackMarkets"
  );

  assert.equal(
    /searchPolymarketEvents\(query,\s*\[\]\)/.test(searchSource),
    true
  );
  assert.equal(
    /summarizeSnapshotMarket\(market,\s*"trending"\)/.test(searchSource),
    true
  );
  assert.equal(/url:\s*buildMarketUrl\(market\)/.test(uiSource), true);
  assert.equal(/KNOWW_SEARCH_NOTIFICATION_MARKETS/.test(uiSource), true);
});

test("notification stack dedupe prefers visible duplicate market cards", () => {
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(/function isCardInViewport/.test(uiSource), true);
  assert.equal(/function classifyInjectedMarketEntry/.test(uiSource), true);
  assert.equal(
    /function selectRepresentativeMarketEntries/.test(uiSource),
    true
  );
  assert.equal(
    /if \(current\.status !== "active" && classified\.status === "active"\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /const \{ activeMarkets, scrolledOutMarkets \} =\s*selectRepresentativeMarketEntries\(markets\);/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /Deduplicate by market id \(prefer visible active cards\)/.test(uiSource),
    true
  );
});

test("notification click scrolls to cards without any highlight pulse", () => {
  const css = readInlineCss();
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(/\.knoww-market-card\.knoww-highlight/.test(css), false);
  assert.equal(/knoww-highlight-pulse/.test(css), false);
  assert.equal(/classList\.add\("knoww-highlight"\)/.test(uiSource), false);
  assert.equal(/classList\.remove\("knoww-highlight"\)/.test(uiSource), false);
});

test("notification panel does not expose the footer see all control", () => {
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
  assert.equal(/knoww-stack-footer-see-all/.test(uiSource), false);
  assert.equal(/knoww-stack-footer-see-all/.test(css), false);
  assert.equal(/notification_stack_see_all_clicked/.test(uiSource), false);
  assert.equal(/formatSeeAllLabel/.test(uiSource), false);
  assert.equal(
    /window\.open\(\s*KNOWW_APP_URL\s*\|\|\s*"https:\/\/knoww\.app"/.test(
      uiSource
    ),
    false
  );
});

test("notification panel shows trending between active and seen earlier", () => {
  const uiSource = readSource("src/content/ui.ts");
  const updateSource = extractFunctionSource(
    uiSource,
    "updateNotificationStack"
  );
  const activeIndex = updateSource.indexOf('"Active now"');
  const trendingIndex = updateSource.indexOf("appendTrendingSection(");
  const seenIndex = updateSource.indexOf('"Seen earlier"');

  assert.notEqual(activeIndex, -1);
  assert.notEqual(trendingIndex, -1);
  assert.notEqual(seenIndex, -1);
  assert.equal(activeIndex < trendingIndex, true);
  assert.equal(trendingIndex < seenIndex, true);
});

test("notification panel uses user-facing seen earlier copy without count-aware footer", () => {
  const uiSource = readSource("src/content/ui.ts");

  assert.equal(/"Seen earlier"/.test(uiSource), true);
  assert.equal(/"Recently scrolled out"/.test(uiSource), false);
  assert.equal(
    /function formatSeeAllLabel\(\s*expanded:\s*boolean,\s*totalAvailable:\s*number,\s*totalDisplayed:\s*number\s*\):\s*string/.test(
      uiSource
    ),
    false
  );
  assert.equal(
    /return `See all \$\{totalAvailable\} →`;/.test(uiSource),
    false
  );
  assert.equal(
    /updateStackSeeAllButton\(\s*cachedStackExpanded,\s*totalAvailable,\s*totalDisplayed\s*\)/.test(
      uiSource
    ),
    false
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
    /function getVisibleTrendingMarkets\(\s*realMarketIds:\s*Set<string>,\s*expandedTrending:\s*boolean,\s*limitOverride\?:\s*number\s*\):\s*Market\[\]/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /expandedTrending\s*\|\|\s*cappedLimit > MAX_TRENDING_DISPLAY/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /Math\.min\(limit,\s*MAX_EXPANDED_TRENDING_DISPLAY\)/.test(uiSource),
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
  // The "Browse trending" CTA was removed from the empty state (market
  // browsing lives in the sidebar now) — lock the removal so the dead
  // affordance doesn't creep back without its handler.
  assert.equal(/data-knoww-browse-trending/.test(uiSource), false);
  assert.equal(/Browse trending/.test(uiSource), false);
  assert.equal(/knoww-notification-action-label/.test(uiSource), true);
  assert.equal(/Restore/.test(uiSource), true);
  assert.equal(
    /#knoww-notification-stack\s+\.knoww-notification-action-label\s*\{[^}]*color:\s*var\(--kse-ink-dim\)/.test(
      css
    ),
    true
  );
});
