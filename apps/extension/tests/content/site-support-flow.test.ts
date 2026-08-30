// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSiteSupportSurface,
  renderSiteSupportSurface,
} from "../../src/sidepanel/site-support";

describe("unsupported-site support request surface", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="root">
        <div data-sidepanel-main>Markets</div>
        ${renderSiteSupportSurface()}
      </div>`;
  });

  it("shows only the hostname and submits it once", async () => {
    let resolveRequest: ((value: { ok: boolean }) => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveRequest = resolve;
        })
    );
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing test root");
    const surface = createSiteSupportSurface(root, { send });

    surface.show("example.com");
    expect(
      root.querySelector<HTMLElement>("[data-site-support-hostname]")
        ?.textContent
    ).toBe("example.com");
    expect(
      root.querySelector<HTMLElement>("[data-sidepanel-main]")?.hidden
    ).toBe(true);

    const button = root.querySelector<HTMLButtonElement>(
      "[data-site-support-submit]"
    );
    button?.click();
    button?.click();

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "site-support:request",
      hostname: "example.com",
    });
    expect(button?.disabled).toBe(true);

    resolveRequest?.({ ok: true });
    await vi.waitFor(() => {
      expect(
        root.querySelector<HTMLElement>("[data-site-support-status]")
          ?.textContent
      ).toBe("Thanks — your request has been sent.");
    });
  });

  it("allows a failed request to be retried", async () => {
    const send = vi.fn().mockResolvedValue({
      ok: false,
      error: "unavailable",
    });
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing test root");
    const surface = createSiteSupportSurface(root, { send });

    surface.show("example.com");
    root
      .querySelector<HTMLButtonElement>("[data-site-support-submit]")
      ?.click();

    await vi.waitFor(() => {
      expect(
        root.querySelector<HTMLButtonElement>("[data-site-support-submit]")
          ?.disabled
      ).toBe(false);
    });
    expect(
      root.querySelector<HTMLElement>("[data-site-support-status]")?.textContent
    ).toBe("We couldn't send your request. Please try again.");
  });

  it("uses the editorial Knoww palette in the side panel", async () => {
    const { SITE_SUPPORT_STYLES } = await import(
      "../../src/sidepanel/site-support"
    );

    expect(SITE_SUPPORT_STYLES).toContain("#14110d");
    expect(SITE_SUPPORT_STYLES).toContain("#1b1813");
    expect(SITE_SUPPORT_STYLES).toContain("#f4efe2");
  });
});
