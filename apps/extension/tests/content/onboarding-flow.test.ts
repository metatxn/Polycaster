import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string): string =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("install-time extension onboarding", () => {
  it("opens a dedicated onboarding page on first install", () => {
    const background = readSource("src/background.ts");
    const installHandler = background.slice(
      background.indexOf("chrome.runtime.onInstalled.addListener")
    );

    expect(installHandler).toContain(
      'chrome.runtime.getURL("onboarding.html")'
    );
    expect(installHandler).toContain("chrome.tabs.create");
    expect(installHandler).not.toContain("chrome.runtime.openOptionsPage()");
  });

  it("reopens onboarding when an unpacked development build is reloaded", () => {
    const background = readSource("src/background.ts");
    const installHandler = background.slice(
      background.indexOf("chrome.runtime.onInstalled.addListener")
    );

    expect(installHandler).toContain(
      "details.reason === chrome.runtime.OnInstalledReason.UPDATE &&\n    __DEV_MODE__"
    );
    expect(
      installHandler.match(/chrome\.runtime\.getURL\("onboarding\.html"\)/g)
    ).toHaveLength(2);
  });

  it("ships the onboarding page in both extension builds", () => {
    const webpack = readSource("webpack.config.cjs");
    const html = readSource("onboarding.html");

    expect(webpack).toContain('onboarding: "./src/onboarding.tsx"');
    expect(webpack).toContain(
      '{ from: "onboarding.html", to: "onboarding.html" }'
    );
    expect(webpack).toContain(
      '{ from: "src/onboarding.css", to: "onboarding.css" }'
    );
    expect(html).toContain('id="root"');
    expect(html).toContain('src="onboarding.js"');
  });

  it("guides wallet setup and demonstrates injected Polymarket cards on X", () => {
    const onboarding = readSource("src/onboarding.tsx");
    const onboardingState = readSource("src/onboarding-state.ts");
    const background = readSource("src/background.ts");
    const injection = readSource("src/content/injection.ts");
    const demo = readSource("src/content/onboarding-demo.ts");
    const sidepanelSetup = readSource("src/sidepanel/setup.ts");

    expect(onboardingState).toContain("https://x.com/polymarket");
    expect(onboardingState).toContain(
      "https://chromewebstore.google.com/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn"
    );
    expect(onboarding).toContain('type: "KNOWW_START_ONBOARDING_SETUP"');
    expect(background).toContain(
      'msg?.type === "KNOWW_ONBOARDING_DEMO_MARKET_INJECTED"'
    );
    expect(background).toContain('"onboarding_demo_market_injected"');
    expect(injection).toContain("registerOnboardingDemoMarket");
    expect(demo).toContain('window.location.hostname !== "x.com"');
    expect(demo).toContain(
      'window.location.pathname.startsWith("/polymarket")'
    );
    expect(sidepanelSetup).toContain("data-install-metamask");
    expect(sidepanelSetup).toContain('event: "wallet_install_clicked"');
    expect(onboarding).toContain("Market discovery extension");
    expect(onboarding).not.toContain("Trading extension");
  });

  it("records the conversion milestones without page URLs", () => {
    const onboarding = readSource("src/onboarding.tsx");
    const background = readSource("src/background.ts");
    const analyticsSources = `${onboarding}\n${background}`;

    for (const event of [
      "extension_onboarding_started",
      "wallet_provider_check_completed",
      "wallet_install_clicked",
      "trading_onboarding_started",
      "trading_onboarding_completed",
      "extension_install_onboarding_completed",
      "onboarding_demo_opened",
      "onboarding_demo_market_clicked",
    ]) {
      expect(analyticsSources).toContain(event);
    }
    expect(analyticsSources).not.toContain("page_url");
  });
});
