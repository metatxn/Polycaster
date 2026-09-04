import { describe, expect, it } from "vitest";
import {
  isOnboardingWalletSetupUrl,
  parseOnboardingProgress,
  resolveOnboardingStage,
} from "../../src/onboarding-state";

describe("extension onboarding state", () => {
  it("keeps the welcome step until the user starts setup", () => {
    expect(
      resolveOnboardingStage({
        welcomeCompleted: false,
        loggedIn: false,
        hasCredentials: false,
        storeBuild: false,
      })
    ).toBe("welcome");
  });

  it("moves through wallet, trading, and ready stages", () => {
    expect(
      resolveOnboardingStage({
        welcomeCompleted: true,
        loggedIn: false,
        hasCredentials: false,
        storeBuild: false,
      })
    ).toBe("wallet");
    expect(
      resolveOnboardingStage({
        welcomeCompleted: true,
        loggedIn: true,
        hasCredentials: false,
        storeBuild: false,
      })
    ).toBe("trading");
    expect(
      resolveOnboardingStage({
        welcomeCompleted: true,
        loggedIn: true,
        hasCredentials: true,
        storeBuild: false,
      })
    ).toBe("ready");
  });

  it("finishes the read-only store flow after wallet connection", () => {
    expect(
      resolveOnboardingStage({
        welcomeCompleted: true,
        loggedIn: true,
        hasCredentials: false,
        storeBuild: true,
      })
    ).toBe("ready");
  });

  it("recognizes only the dedicated wallet setup URL", () => {
    expect(
      isOnboardingWalletSetupUrl("https://knoww.app/extension/connect")
    ).toBe(true);
    expect(isOnboardingWalletSetupUrl("https://x.com/polymarket")).toBe(false);
    expect(
      isOnboardingWalletSetupUrl("https://not-knoww.example/extension/connect")
    ).toBe(false);
    expect(
      isOnboardingWalletSetupUrl(
        "https://knoww.app/extension/connect?unexpected=value"
      )
    ).toBe(false);
    expect(isOnboardingWalletSetupUrl("not a URL")).toBe(false);
  });

  it("parses only valid persisted progress fields", () => {
    expect(
      parseOnboardingProgress({
        startedAt: "2026-09-04T06:30:00.000Z",
        welcomeCompletedAt: 42,
        walletCheckResult: "connected",
        completedAt: null,
      })
    ).toEqual({
      startedAt: "2026-09-04T06:30:00.000Z",
      walletCheckResult: "connected",
    });
    expect(parseOnboardingProgress("bad value")).toEqual({});
  });
});
