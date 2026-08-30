import { describe, expect, it } from "vitest";
import {
  getRequestableSiteHostname,
  getUnsupportedSiteHostname,
  isSupportedSiteUrl,
} from "../src/site-support";

describe("unsupported-site request targeting", () => {
  it.each([
    "https://x.com/knoww",
    "https://www.reddit.com/r/predictionmarkets",
    "https://meta.stackoverflow.com/questions/1",
  ])("recognizes supported URLs before offering a request for %s", (url) => {
    expect(isSupportedSiteUrl(url)).toBe(true);
    expect(getUnsupportedSiteHostname(url)).toBeNull();
  });

  it("returns only a normalized hostname for an unsupported public website", () => {
    expect(
      getRequestableSiteHostname(
        "https://WWW.Example.COM/private/path?token=do-not-send#fragment"
      )
    ).toBe("example.com");
    expect(
      getUnsupportedSiteHostname(
        "https://WWW.Example.COM/private/path?token=do-not-send#fragment"
      )
    ).toBe("example.com");
  });

  it.each([
    undefined,
    "",
    "not a URL",
    "chrome://extensions",
    "file:///Users/example/private.html",
    "http://localhost:3000/dashboard",
    "http://127.0.0.1:8000/private",
    "https://intranet/private",
    "https://[::1]/private",
  ])("does not offer to transmit non-public or browser URLs: %s", (url) => {
    expect(getRequestableSiteHostname(url)).toBeNull();
    expect(getUnsupportedSiteHostname(url)).toBeNull();
  });
});
