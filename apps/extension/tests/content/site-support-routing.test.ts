import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string): string =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("unsupported-site toolbar routing", () => {
  it("registers a lightweight prompt on HTTP(S) pages while keeping full matching allowlisted", () => {
    const hosts = readSource("src/supported-hosts.ts");
    const background = readSource("src/background.ts");
    const webpack = readSource("webpack.config.cjs");

    expect(hosts).toContain("UNSUPPORTED_SITE_SUPPORT_MATCH_PATTERNS");
    expect(hosts).toContain('"http://*/*"');
    expect(hosts).toContain('"https://*/*"');
    expect(background).toContain(
      'const UNSUPPORTED_SITE_SUPPORT_SCRIPT_ID = "knoww-unsupported-site-support"'
    );
    expect(background).toContain("id: UNSUPPORTED_SITE_SUPPORT_SCRIPT_ID");
    expect(background).toContain('js: ["unsupported-site.js"]');
    expect(background).toContain(
      'css: ["markets-panel-navbar.css", "unsupported-site-prompt.css"]'
    );
    expect(background).toContain('css: ["markets-panel-navbar.css"]');
    expect(background).toContain("excludeMatches:");
    expect(webpack).toContain(
      "unsupportedSiteSupportPatterns = extractStringArray("
    );
    expect(webpack).toContain(
      '"unsupported-site": "./src/unsupported-site.ts"'
    );
    expect(webpack).toContain(
      "buildUnsupportedSiteSupportWebAccessibleResources(hostsSource)"
    );
    const unsupportedResources = webpack.slice(
      webpack.indexOf(
        "function buildUnsupportedSiteSupportWebAccessibleResources"
      ),
      webpack.indexOf("const transformersEntry")
    );
    expect(unsupportedResources).not.toContain('"icons/icon-128.png"');
    expect(webpack).toMatch(
      /from:\s*"src\/content\/markets-panel-navbar\.css",\s*to:\s*"markets-panel-navbar\.css"/
    );
  });

  it("routes an unsupported toolbar click to the floating support prompt", () => {
    const background = readSource("src/background.ts");
    const clickHandler = background.slice(
      background.indexOf("chrome.action.onClicked.addListener"),
      background.indexOf("chrome.runtime.onInstalled.addListener")
    );

    expect(clickHandler).toContain("getUnsupportedSiteHostname(tab.url)");
    expect(clickHandler).toContain(
      "showUnsupportedSiteSupportPrompt(tab.id, { reveal: true })"
    );
    expect(clickHandler).not.toContain("openSiteSupportRequest(");
    expect(background).toContain(
      "setPanelBehavior({ openPanelOnActionClick: false })"
    );
    expect(background).toContain(
      'response?.surface === "unsupported-site-prompt"'
    );
    expect(clickHandler.indexOf("getUnsupportedSiteHostname")).toBeLessThan(
      clickHandler.indexOf("cachedNotificationPanelSurface")
    );
  });

  it("repairs unsupported tabs that were already open when the extension updates", () => {
    const background = readSource("src/background.ts");

    expect(background).toContain("refreshOpenUnsupportedSitePrompts()");
    expect(background).toContain(
      "showUnsupportedSiteSupportPrompt(tab.id, { reveal: false })"
    );
  });

  it("does not attach a full URL or path to default usage events", () => {
    const analytics = readSource("src/content/analytics.ts");

    expect(analytics).not.toContain("page_url");
    expect(analytics).not.toContain("page_path");
    expect(analytics).not.toContain("window.location.href");
    expect(analytics).not.toContain("window.location.pathname");
  });
});
