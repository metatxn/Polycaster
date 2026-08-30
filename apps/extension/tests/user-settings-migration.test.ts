import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_SETTINGS,
  mergeStoredUserSettings,
  type StoredUserSettings,
} from "../src/types/settings";

describe("mergeStoredUserSettings", () => {
  it("enables usage analytics for new installations without overriding an explicit opt-out", () => {
    expect(DEFAULT_USER_SETTINGS.usageAnalyticsEnabled).toBe(true);
    expect(mergeStoredUserSettings().usageAnalyticsEnabled).toBe(true);
    expect(
      mergeStoredUserSettings({ usageAnalyticsEnabled: false })
        .usageAnalyticsEnabled
    ).toBe(false);
  });

  it("keeps both remote AI flows off for new installations", () => {
    const settings = mergeStoredUserSettings();

    expect(settings.aiGateRetryEnabled).toBe(false);
    expect(settings.aiCandidateValidationEnabled).toBe(false);
    expect("aiExtractionEnabled" in settings).toBe(false);
    expect(settings.productionRerankerEnabled).toBe(false);
  });

  it.each([true, false])(
    "migrates the legacy shared AI value %s to both controls",
    (legacyValue) => {
      const settings = mergeStoredUserSettings({
        aiExtractionEnabled: legacyValue,
      });

      expect(settings.aiGateRetryEnabled).toBe(legacyValue);
      expect(settings.aiCandidateValidationEnabled).toBe(legacyValue);
      expect("aiExtractionEnabled" in settings).toBe(false);
    }
  );

  it("prefers independent controls over the legacy shared value", () => {
    const settings = mergeStoredUserSettings({
      aiExtractionEnabled: true,
      aiGateRetryEnabled: false,
      aiCandidateValidationEnabled: true,
    });

    expect(settings.aiGateRetryEnabled).toBe(false);
    expect(settings.aiCandidateValidationEnabled).toBe(true);
  });

  it("preserves nested defaults while applying stored overrides", () => {
    const settings = mergeStoredUserSettings({
      platforms: { twitter: false },
      sources: { polymarket: false },
    } as StoredUserSettings);

    expect(settings.platforms.twitter).toBe(false);
    expect(settings.platforms.reddit).toBe(
      DEFAULT_USER_SETTINGS.platforms.reddit
    );
    expect(settings.sources.polymarket).toBe(false);
    expect(settings.sources.kalshi).toBe(DEFAULT_USER_SETTINGS.sources.kalshi);
  });

  it("clamps the production reranker off without promotion evidence", () => {
    const blocked = mergeStoredUserSettings({
      productionRerankerEnabled: true,
    });
    const promoted = mergeStoredUserSettings(
      { productionRerankerEnabled: true },
      { productionRerankerPromoted: true }
    );

    expect(blocked.productionRerankerEnabled).toBe(false);
    expect(promoted.productionRerankerEnabled).toBe(true);
  });
});
