import { describe, expect, it } from "vitest";
import { isEmbeddedOnboardingSender } from "../../src/onboarding-state";

describe("embedded onboarding authorization", () => {
  const extensionUrl = "chrome-extension://test/onboarding.html";
  it("accepts only the packaged frame on the exact first-party setup page", () => {
    expect(isEmbeddedOnboardingSender(`${extensionUrl}?embedded=1`, "https://knoww.app/extension/connect", extensionUrl, false)).toBe(true);
    expect(isEmbeddedOnboardingSender(`${extensionUrl}?embedded=1`, "https://example.com/extension/connect", extensionUrl, false)).toBe(false);
    expect(isEmbeddedOnboardingSender(`${extensionUrl}?embedded=1`, "https://knoww.app/", extensionUrl, false)).toBe(false);
    expect(isEmbeddedOnboardingSender("https://knoww.app/extension/connect", "https://knoww.app/extension/connect", extensionUrl, false)).toBe(false);
  });
  it("allows localhost only in development builds", () => {
    expect(isEmbeddedOnboardingSender(`${extensionUrl}?embedded=1`, "http://localhost:8000/extension/connect", extensionUrl, false)).toBe(false);
    expect(isEmbeddedOnboardingSender(`${extensionUrl}?embedded=1`, "http://localhost:8000/extension/connect", extensionUrl, true)).toBe(true);
  });
});
