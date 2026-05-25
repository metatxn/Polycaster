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

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

test("extension declares and builds a Chrome side panel", () => {
  const manifest = JSON.parse(readSource("manifest.json")) as {
    permissions?: string[];
    side_panel?: { default_path?: string };
  };
  const webpack = readSource("webpack.config.js");
  const sidepanelHtml = readSource("sidepanel.html");

  assert.equal(manifest.permissions?.includes("sidePanel"), true);
  assert.equal(manifest.side_panel?.default_path, "sidepanel.html");
  assert.equal(/sidepanel:\s*"\.\/src\/sidepanel\.ts"/.test(webpack), true);
  assert.equal(
    /from:\s*"sidepanel\.html",\s*to:\s*"sidepanel\.html"/.test(webpack),
    true
  );
  assert.equal(/href="knoww-inline\.css"/.test(sidepanelHtml), true);
});

test("settings default to floating and expose a user-facing placement control", () => {
  const settingsSource = readSource("src/types/settings.ts");
  const optionsSource = readSource("src/options.tsx");

  assert.equal(
    /notificationPanelSurface:\s*"sidebar"\s*\|\s*"floating";/.test(
      settingsSource
    ),
    true
  );
  assert.equal(
    /notificationPanelSurface:\s*"floating"/.test(settingsSource),
    true
  );
  assert.equal(/id="notification-panel-surface"/.test(optionsSource), true);
  assert.equal(
    /value=\{settings\.notificationPanelSurface\}/.test(optionsSource),
    true
  );
});

test("notification stack can move itself into the browser side panel", () => {
  const uiSource = readSource("src/content/ui.ts");
  const backgroundSource = readSource("src/background.ts");
  const sidepanelSource = readSource("src/sidepanel.ts");

  assert.equal(
    /sidebarBtn\.className = "knoww-stack-sidebar";/.test(uiSource),
    true
  );
  assert.equal(/KNOWW_OPEN_EXTENSION_SIDEPANEL/.test(uiSource), true);
  assert.equal(/openSidePanelFromNotificationStack/.test(uiSource), true);
  assert.equal(/ensureNotificationStackLifecyclePort/.test(uiSource), true);
  assert.equal(
    /NOTIFICATION_STACK_PORT_NAME = "knoww-notification-stack"/.test(uiSource),
    true
  );
  assert.equal(
    /chrome\.runtime\.connect\(\{ name: NOTIFICATION_STACK_PORT_NAME \}\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /postMessage\(\{ type: "KNOWW_NOTIFICATION_STACK_ALIVE" \}\)/.test(
      uiSource
    ),
    true
  );
  assert.equal(
    /chrome\.runtime\.onConnect\.addListener/.test(backgroundSource),
    true
  );
  assert.equal(
    /port\.name !== "knoww-notification-stack"/.test(backgroundSource),
    true
  );
  assert.equal(/response\?\.ok !== true/.test(uiSource), true);
  assert.equal(/safeSendMessage/.test(uiSource), true);
  assert.equal(
    /Extension updated\. Refresh this page to reconnect Knoww\./.test(uiSource),
    true
  );
  assert.equal(/showScrollToast\(/.test(uiSource), true);
  assert.equal(/KNOWW_SET_NOTIFICATION_STACK_VISIBILITY/.test(uiSource), true);
  assert.equal(/KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT/.test(uiSource), true);
  assert.equal(
    /msg\?\.type === "KNOWW_OPEN_EXTENSION_SIDEPANEL"/.test(backgroundSource),
    true
  );
  assert.equal(
    /msg\?\.type === "KNOWW_CLOSE_EXTENSION_SIDEPANEL"/.test(backgroundSource),
    true
  );
  assert.equal(/sidePanel\.open/.test(backgroundSource), true);
  assert.equal(/sidePanel\.close/.test(backgroundSource), true);
  assert.equal(/function queryActiveTabId/.test(backgroundSource), true);
  assert.equal(
    /function resolveContentTargetTabId/.test(backgroundSource),
    true
  );
  assert.equal(
    /function forwardToResolvedContentTab/.test(backgroundSource),
    true
  );
  assert.equal(/function reinjectContentScript/.test(backgroundSource), true);
  assert.equal(/chrome\.scripting\.executeScript/.test(backgroundSource), true);
  assert.equal(/files:\s*\["content\.js"\]/.test(backgroundSource), true);
  assert.equal(/isRecoverableContentScriptError/.test(backgroundSource), true);
  assert.equal(/sendMessageToContentTab/.test(backgroundSource), true);
  assert.equal(/chrome\.tabs\.query/.test(backgroundSource), true);
  assert.equal(/chrome\.windows\.getLastFocused/.test(backgroundSource), true);
  assert.equal(/activeTabIdsByWindowId/.test(backgroundSource), true);
  assert.equal(
    /chrome\.tabs\.onActivated\.addListener/.test(backgroundSource),
    true
  );
  assert.equal(
    /chrome\.windows\.onFocusChanged\.addListener/.test(backgroundSource),
    true
  );
  assert.equal(
    /lastSidePanelWindowId = context\.windowId/.test(backgroundSource),
    true
  );
  assert.equal(/cachedNotificationPanelSurface/.test(backgroundSource), true);
  assert.equal(/setPanelBehavior/.test(backgroundSource), true);
  assert.equal(/openPanelOnActionClick/.test(backgroundSource), true);
  assert.equal(
    /chrome\.storage\.onChanged\.addListener/.test(backgroundSource),
    true
  );
  assert.equal(
    /msg\?\.type === "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT"[\s\S]*forwardToResolvedContentTab/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /msg\?\.type === "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT"[\s\S]*trendingLimit:\s*msg\.trendingLimit/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /Chrome side panel API is unavailable/.test(backgroundSource),
    true
  );
  assert.equal(
    /(notificationPanelSurface|surface|cachedNotificationPanelSurface) === "sidebar"/.test(
      backgroundSource
    ),
    true
  );
  assert.equal(
    /KNOWW_SET_NOTIFICATION_STACK_VISIBILITY/.test(sidepanelSource),
    true
  );
  assert.equal(
    /KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT/.test(sidepanelSource),
    true
  );
  assert.equal(/KNOWW_FOCUS_NOTIFICATION_MARKET/.test(sidepanelSource), true);
  assert.equal(/KNOWW_FOCUS_NOTIFICATION_MARKET/.test(backgroundSource), true);
  assert.equal(/KNOWW_SEARCH_NOTIFICATION_MARKETS/.test(sidepanelSource), true);
  assert.equal(
    /KNOWW_SEARCH_NOTIFICATION_MARKETS/.test(backgroundSource),
    true
  );
  assert.equal(/renderMarketRows/.test(sidepanelSource), true);
  assert.equal(/id="knoww-notification-stack"/.test(sidepanelSource), true);
  assert.equal(/knoww-notification-item/.test(sidepanelSource), true);
  assert.equal(/knoww-stack-section-header/.test(sidepanelSource), true);
  assert.equal(/Trending now/.test(sidepanelSource), true);
  assert.equal(/snapshot\.trending/.test(sidepanelSource), true);
  assert.equal(/trendingLimit:\s*5/.test(sidepanelSource), true);
  assert.equal(/data-show-page-panel/.test(sidepanelSource), false);
  assert.equal(/knoww-stack-footer-see-all/.test(sidepanelSource), false);
  assert.equal(/focusMarket\(marketId\)/.test(sidepanelSource), true);
  assert.equal(
    /classList\.toggle\("knoww-search-open"\)/.test(sidepanelSource),
    true
  );
  assert.equal(
    /classList\.toggle\("knoww-search-active"\)/.test(sidepanelSource),
    true
  );
  assert.equal(
    /classList\.remove\("knoww-search-open"\)/.test(sidepanelSource),
    true
  );
  assert.equal(
    /classList\.remove\("knoww-search-active"\)/.test(sidepanelSource),
    true
  );
  assert.equal(/input\.value\.trim\(\) === ""/.test(sidepanelSource), true);
  assert.equal(/searchMarkets\(query\)/.test(sidepanelSource), true);
  assert.equal(
    /SNAPSHOT_REFRESH_INTERVAL_MS\s*=\s*5_000/.test(sidepanelSource),
    true
  );
  assert.equal(
    /setInterval\(\(\) => void refreshSnapshot\(\)/.test(sidepanelSource),
    true
  );
  assert.equal(/knoww-search-container/.test(sidepanelSource), true);
  assert.equal(/knoww-stack-minimize/.test(sidepanelSource), true);
  assert.equal(
    /grid-template-columns:\s*40px minmax\(0,\s*1fr\) 64px/.test(
      sidepanelSource
    ),
    true
  );
  assert.equal(/text-align:\s*left !important/.test(sidepanelSource), true);
  assert.equal(
    /align-items:\s*flex-start !important/.test(sidepanelSource),
    true
  );
  assert.equal(/Sidebar mode/.test(sidepanelSource), false);
  assert.equal(/Refresh markets/.test(sidepanelSource), false);
  assert.equal(/KNOWW_CLOSE_EXTENSION_SIDEPANEL/.test(sidepanelSource), true);
});
