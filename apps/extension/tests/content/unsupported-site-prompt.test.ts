// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISMISSED_SITE_SUPPORT_DURATION_MS,
  installUnsupportedSitePrompt,
  mountUnsupportedSitePrompt,
  SITE_SUPPORT_PROMPT_STATE_KEY,
} from "../../src/content/unsupported-site-prompt";
import { OPEN_SITE_SUPPORT_PROMPT_MESSAGE } from "../../src/site-support";

function createStorage(initial?: unknown) {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set(SITE_SUPPORT_PROMPT_STATE_KEY, initial);
  return {
    values,
    port: {
      get(key: string, callback: (result: Record<string, unknown>) => void) {
        callback({ [key]: values.get(key) });
      },
      set(value: Record<string, unknown>, callback: () => void) {
        for (const [key, entry] of Object.entries(value)) {
          values.set(key, entry);
        }
        callback();
      },
    },
  };
}

describe("automatic unsupported-site prompt", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  it("shows a compact prompt with only the normalized hostname", async () => {
    const storage = createStorage();
    const send = vi.fn();

    await mountUnsupportedSitePrompt({
      hostname: "WWW.Example.COM",
      now: () => 1_000,
      send,
      storage: storage.port,
    });

    const prompt = document.querySelector<HTMLElement>(
      "#knoww-site-support-prompt-root"
    );
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain("example.com");
    expect(prompt?.textContent).not.toContain("http");
    expect(prompt?.getAttribute("data-knoww-site-support-hostname")).toBe(
      "example.com"
    );
    expect(send).not.toHaveBeenCalled();
    expect(prompt?.querySelector(".knoww-stack-title")?.textContent).toContain(
      "Markets"
    );
    expect(
      prompt?.querySelector(".knoww-site-support-floating-section")?.textContent
    ).toContain("Website not supported");
  });

  it("uses the same functional navbar as supported floating panels", async () => {
    const storage = createStorage();
    const send = vi.fn().mockResolvedValue({ ok: true });

    await mountUnsupportedSitePrompt({
      hostname: "example.com",
      send,
      storage: storage.port,
    });

    const prompt = document.querySelector<HTMLElement>(
      "#knoww-site-support-prompt-root"
    );
    const navbar = prompt?.querySelector<HTMLElement>(
      ".knoww-markets-panel-navbar"
    );
    const settings = navbar?.querySelector<HTMLButtonElement>(
      '[aria-label="Open extension settings"]'
    );
    const sidebar = navbar?.querySelector<HTMLButtonElement>(
      '[aria-label="Move markets panel to browser sidebar"]'
    );
    const search = navbar?.querySelector<HTMLButtonElement>(
      '[aria-label="Search markets"]'
    );
    const minimize = navbar?.querySelector<HTMLButtonElement>(
      '[aria-label="Minimize markets panel"]'
    );
    const close = navbar?.querySelector<HTMLButtonElement>(
      '[aria-label="Close markets panel"]'
    );

    expect(navbar).not.toBeNull();
    expect(navbar?.querySelector(".knoww-stack-icon img")).not.toBeNull();
    expect(navbar?.querySelector(".knoww-stack-title")?.textContent).toContain(
      "Markets"
    );
    expect([settings, sidebar, search, minimize, close].every(Boolean)).toBe(
      true
    );

    settings?.click();
    sidebar?.click();
    expect(send).toHaveBeenCalledWith({
      type: "KNOWW_OPEN_EXTENSION_SETTINGS",
    });
    expect(send).toHaveBeenCalledWith({
      type: "KNOWW_OPEN_EXTENSION_SIDEPANEL",
      view: "markets",
    });

    search?.click();
    const searchContainer = prompt?.querySelector<HTMLElement>(
      "#knoww-search-container"
    );
    const searchInput = searchContainer?.querySelector<HTMLInputElement>(
      "#knoww-search-input"
    );
    const clearSearch = searchContainer?.querySelector<HTMLButtonElement>(
      "#knoww-search-clear"
    );
    expect(searchContainer?.classList.contains("knoww-search-open")).toBe(true);
    expect(search?.getAttribute("aria-expanded")).toBe("true");
    expect(searchInput?.placeholder).toBe("Search Polymarket...");
    expect(clearSearch?.getAttribute("aria-label")).toBe("Clear search");
    expect(prompt?.querySelector(".knoww-site-support-search")).toBeNull();

    if (!searchInput) throw new Error("expected shared search input");
    searchInput.value = "election";
    clearSearch?.click();
    expect(searchInput?.value).toBe("");

    minimize?.click();
    expect(prompt?.classList.contains("knoww-stack-minimized")).toBe(true);
    expect(minimize?.getAttribute("aria-label")).toBe("Expand markets panel");

    navbar?.querySelector<HTMLElement>(".knoww-stack-title")?.click();
    expect(prompt?.classList.contains("knoww-stack-minimized")).toBe(false);
  });

  it("loads shared panel fonts from the extension origin", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://knoww-test/${path}`,
      },
    });

    try {
      await mountUnsupportedSitePrompt({
        hostname: "example.com",
        send: vi.fn(),
        storage: createStorage().port,
      });

      const fontFaces = document.querySelector<HTMLStyleElement>(
        "#knoww-markets-panel-font-faces"
      );
      expect(fontFaces?.textContent).toContain(
        'url("chrome-extension://knoww-test/fonts/fraunces-italic-500.woff2")'
      );
      expect(fontFaces?.textContent).toContain(
        'url("chrome-extension://knoww-test/fonts/jetbrains-mono-500.woff2")'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("submits once and remembers successful requests", async () => {
    const storage = createStorage();
    const send = vi.fn().mockResolvedValue({ ok: true });

    await mountUnsupportedSitePrompt({
      hostname: "example.com",
      now: () => 1_000,
      send,
      storage: storage.port,
    });
    const submit = document.querySelector<HTMLButtonElement>(
      "[data-site-support-submit]"
    );
    submit?.click();
    submit?.click();

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith({
      type: "site-support:request",
      hostname: "example.com",
    });
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLElement>("[data-site-support-status]")
          ?.textContent
      ).toBe("Thanks — your request has been sent.");
    });
    expect(storage.values.get(SITE_SUPPORT_PROMPT_STATE_KEY)).toMatchObject({
      requestedHostnames: ["example.com"],
    });

    document.querySelector("#knoww-site-support-prompt-root")?.remove();
    await expect(
      mountUnsupportedSitePrompt({
        hostname: "example.com",
        now: () => 2_000,
        send,
        storage: storage.port,
      })
    ).resolves.toBeNull();
  });

  it("respects a per-site dismissal window", async () => {
    const storage = createStorage();
    const send = vi.fn();
    await mountUnsupportedSitePrompt({
      hostname: "example.com",
      now: () => 1_000,
      send,
      storage: storage.port,
    });

    document
      .querySelector<HTMLButtonElement>("[data-site-support-dismiss]")
      ?.click();
    expect(
      document.querySelector("#knoww-site-support-prompt-root")
    ).toBeNull();
    expect(storage.values.get(SITE_SUPPORT_PROMPT_STATE_KEY)).toMatchObject({
      dismissedUntilByHostname: {
        "example.com": 1_000 + DISMISSED_SITE_SUPPORT_DURATION_MS,
      },
    });

    await expect(
      mountUnsupportedSitePrompt({
        hostname: "example.com",
        now: () => 2_000,
        send,
        storage: storage.port,
      })
    ).resolves.toBeNull();
  });

  it("reopens a dismissed prompt when the user clicks the extension icon", async () => {
    const storage = createStorage({
      requestedHostnames: [],
      dismissedUntilByHostname: { "example.com": 50_000 },
    });
    let onMessage:
      | ((
          message: Record<string, unknown>,
          sendResponse: (response: Record<string, unknown>) => void
        ) => void)
      | undefined;

    installUnsupportedSitePrompt({
      hostname: "example.com",
      now: () => 1_000,
      send: vi.fn(),
      storage: storage.port,
      runtimeMessages: {
        addListener(listener) {
          onMessage = listener;
        },
      },
    });
    await Promise.resolve();
    expect(
      document.querySelector("#knoww-site-support-prompt-root")
    ).toBeNull();

    const sendResponse = vi.fn();
    onMessage?.(
      { type: OPEN_SITE_SUPPORT_PROMPT_MESSAGE, reveal: true },
      sendResponse
    );

    await vi.waitFor(() => {
      expect(
        document.querySelector("#knoww-site-support-prompt-root")
      ).not.toBeNull();
    });
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      surface: "unsupported-site-prompt",
    });
  });

  it("removes a stale supported-site panel before showing the support prompt", async () => {
    const stalePanel = document.createElement("div");
    stalePanel.id = "knoww-notification-stack";
    document.body.append(stalePanel);

    installUnsupportedSitePrompt({
      hostname: "example.com",
      storage: createStorage().port,
      send: vi.fn(),
      runtimeMessages: { addListener() {} },
    });

    await vi.waitFor(() => {
      expect(document.querySelector("#knoww-notification-stack")).toBeNull();
      expect(
        document.querySelector("#knoww-site-support-prompt-root")
      ).not.toBeNull();
    });
  });

  it("uses the same editorial palette and compact dimensions as the Knoww panel", () => {
    const css = readFileSync(
      join(process.cwd(), "src/content/unsupported-site-prompt.css"),
      "utf8"
    );

    expect(css).toContain("#14110d");
    expect(css).toContain("#1b1813");
    expect(css).toContain("#f4efe2");
    expect(css).toMatch(/width:\s*min\(340px,/);
    expect(css).toContain("top: 12px");
    expect(css).toContain('font-family: "KnowwMono"');
    expect(css).toContain('font-family: "KnowwEditorial"');
    expect(css).toContain("z-index: 2147483647");
  });

  it("uses the supported panel's shared search styles", () => {
    const sharedCss = readFileSync(
      join(process.cwd(), "src/content/markets-panel-navbar.css"),
      "utf8"
    );
    const unsupportedCss = readFileSync(
      join(process.cwd(), "src/content/unsupported-site-prompt.css"),
      "utf8"
    );

    expect(sharedCss).toContain(".knoww-search-container");
    expect(sharedCss).toContain(".knoww-search-input-wrapper");
    expect(sharedCss).toContain(".knoww-search-input");
    expect(sharedCss).toContain("border-radius: 20px");
    expect(sharedCss).toContain(".knoww-search-clear");
    expect(unsupportedCss).not.toContain(".knoww-site-support-search-row");
  });

  it("keeps the request button compact instead of stretching across the panel", () => {
    const css = readFileSync(
      join(process.cwd(), "src/content/unsupported-site-prompt.css"),
      "utf8"
    );
    const submitRule = css.match(
      /\.knoww-site-support-floating-submit\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(submitRule).toBeDefined();
    expect(submitRule).toMatch(/width:\s*fit-content/);
    expect(submitRule).toMatch(/min-height:\s*32px/);
    expect(submitRule).not.toMatch(/width:\s*100%/);
  });

  it("shares one navbar implementation with the supported panel", () => {
    const unsupportedSource = readFileSync(
      join(process.cwd(), "src/content/unsupported-site-prompt.ts"),
      "utf8"
    );
    const supportedSource = readFileSync(
      join(process.cwd(), "src/content/ui/notifications.ts"),
      "utf8"
    );

    expect(unsupportedSource).toContain("createMarketsPanelNavbar");
    expect(supportedSource).toContain("createMarketsPanelNavbar");
    expect(unsupportedSource).toContain("createMarketsPanelSearch");
    expect(supportedSource).toContain("createMarketsPanelSearch");
  });

  it("bundles the navbar logo instead of loading it from the host page", () => {
    const navbarSource = readFileSync(
      join(process.cwd(), "src/content/ui/markets-panel-navbar.ts"),
      "utf8"
    );
    const webpackSource = readFileSync(
      join(process.cwd(), "webpack.config.cjs"),
      "utf8"
    );

    expect(navbarSource).toContain(
      'import brandIconUrl from "../../../icons/icon-128.png"'
    );
    expect(navbarSource).not.toContain(
      'resolveExtensionResourceUrl("icons/icon-128.png")'
    );
    expect(webpackSource).toMatch(/test:\s*\/\\\.png\$\/i/);
    expect(webpackSource).toContain('type: "asset/inline"');
  });
});
