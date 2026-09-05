import {
  normalizeSiteSupportHostname,
  OPEN_SITE_SUPPORT_PROMPT_MESSAGE,
} from "../site-support";
import { isWebmailUrl } from "../webmail";
import {
  createMarketsPanelNavbar,
  type MarketsPanelNavbar,
  setMarketsPanelNavbarMinimized,
} from "./ui/markets-panel-navbar";
import {
  createMarketsPanelSearch,
  type MarketsPanelSearch,
} from "./ui/markets-panel-search";

export const SITE_SUPPORT_PROMPT_STATE_KEY =
  "knoww_unsupported_site_prompt_state_v1";
export const DISMISSED_SITE_SUPPORT_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_TRACKED_HOSTNAMES = 100;

interface SiteSupportPromptState {
  requestedHostnames: string[];
  dismissedUntilByHostname: Record<string, number>;
}

interface StoragePort {
  get(key: string, callback: (result: Record<string, unknown>) => void): void;
  set(value: Record<string, unknown>, callback: () => void): void;
}

interface RuntimeResponse {
  ok?: boolean;
  error?: string;
}

interface RuntimeMessagePort {
  addListener(
    listener: (
      message: Record<string, unknown>,
      sendResponse: (response: Record<string, unknown>) => void
    ) => void
  ): void;
}

export interface UnsupportedSitePromptOptions {
  hostname?: string;
  ignoreDismissal?: boolean;
  now?: () => number;
  send?: (message: Record<string, unknown>) => Promise<RuntimeResponse>;
  storage?: StoragePort;
}

export interface UnsupportedSitePromptInstallerOptions
  extends UnsupportedSitePromptOptions {
  runtimeMessages?: RuntimeMessagePort;
}

function emptyState(): SiteSupportPromptState {
  return { requestedHostnames: [], dismissedUntilByHostname: {} };
}

function normalizeState(value: unknown): SiteSupportPromptState {
  if (!value || typeof value !== "object") return emptyState();
  const candidate = value as Partial<SiteSupportPromptState>;
  const requestedHostnames = Array.isArray(candidate.requestedHostnames)
    ? candidate.requestedHostnames
        .map((hostname) =>
          typeof hostname === "string"
            ? normalizeSiteSupportHostname(hostname)
            : null
        )
        .filter((hostname): hostname is string => Boolean(hostname))
        .slice(-MAX_TRACKED_HOSTNAMES)
    : [];
  const dismissedUntilByHostname = Object.fromEntries(
    Object.entries(candidate.dismissedUntilByHostname ?? {})
      .map(([hostname, dismissedUntil]) => [
        normalizeSiteSupportHostname(hostname),
        dismissedUntil,
      ])
      .filter(
        (entry): entry is [string, number] =>
          typeof entry[0] === "string" &&
          typeof entry[1] === "number" &&
          Number.isFinite(entry[1])
      )
      .slice(-MAX_TRACKED_HOSTNAMES)
  );
  return { requestedHostnames, dismissedUntilByHostname };
}

function readState(storage: StoragePort): Promise<SiteSupportPromptState> {
  return new Promise((resolve) => {
    try {
      storage.get(SITE_SUPPORT_PROMPT_STATE_KEY, (result) => {
        resolve(normalizeState(result[SITE_SUPPORT_PROMPT_STATE_KEY]));
      });
    } catch {
      resolve(emptyState());
    }
  });
}

function writeState(
  storage: StoragePort,
  state: SiteSupportPromptState
): Promise<void> {
  return new Promise((resolve) => {
    try {
      storage.set({ [SITE_SUPPORT_PROMPT_STATE_KEY]: state }, () => resolve());
    } catch {
      resolve();
    }
  });
}

function sendRuntimeMessage(
  message: Record<string, unknown>
): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: RuntimeResponse) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response ?? { ok: true });
      });
    } catch {
      resolve({ ok: false, error: "Extension unavailable" });
    }
  });
}

function renderPrompt(hostname: string): {
  navbar: MarketsPanelNavbar;
  root: HTMLElement;
  search: MarketsPanelSearch;
} {
  const root = document.createElement("aside");
  root.id = "knoww-site-support-prompt-root";
  root.setAttribute("aria-label", "Knoww website support request");
  root.setAttribute("data-knoww-site-support-hostname", hostname);
  const navbar = createMarketsPanelNavbar();
  const search = createMarketsPanelSearch();
  navbar.closeButton.dataset.siteSupportDismiss = "";
  root.append(navbar.header, search.container);
  root.insertAdjacentHTML(
    "beforeend",
    `
    <div class="knoww-site-support-floating-section">
      <span class="knoww-site-support-floating-section-label">
        <span class="knoww-site-support-floating-dot" aria-hidden="true"></span>
        <span>Website not supported</span>
      </span>
      <span class="knoww-site-support-floating-badge">Request</span>
    </div>
    <div class="knoww-site-support-floating-body">
      <h2>Want Knoww here?</h2>
      <p class="knoww-site-support-floating-copy">Request prediction-market support for <strong data-site-support-hostname></strong>.</p>
      <button type="button" class="knoww-site-support-floating-submit" data-site-support-submit>Request support</button>
      <p class="knoww-site-support-floating-privacy">Sends only this domain — never the page address or its contents.</p>
    </div>
    <div class="knoww-site-support-floating-footer">
      <span class="knoww-site-support-floating-status-dot" aria-hidden="true"></span>
      <p class="knoww-site-support-floating-status" data-site-support-status role="status" aria-live="polite">Ready to request support</p>
    </div>`
  );
  const hostnameLabel = root.querySelector<HTMLElement>(
    "[data-site-support-hostname]"
  );
  if (hostnameLabel) hostnameLabel.textContent = hostname;
  return { navbar, root, search };
}

export async function mountUnsupportedSitePrompt(
  options: UnsupportedSitePromptOptions = {}
): Promise<HTMLElement | null> {
  if (isWebmailUrl(window.location.href)) return null;
  if (document.getElementById("knoww-site-support-prompt-root")) return null;

  const hostname = normalizeSiteSupportHostname(
    options.hostname ?? window.location.hostname
  );
  if (!hostname) return null;

  const storage = options.storage ?? chrome.storage.local;
  const send = options.send ?? sendRuntimeMessage;
  const now = options.now ?? Date.now;
  let state = await readState(storage);
  // Navigation or another mount can finish while storage is loading.
  if (isWebmailUrl(window.location.href)) return null;
  if (document.getElementById("knoww-site-support-prompt-root")) return null;
  if (
    state.requestedHostnames.includes(hostname) ||
    (!options.ignoreDismissal &&
      (state.dismissedUntilByHostname[hostname] ?? 0) > now())
  ) {
    return null;
  }

  const { navbar, root, search } = renderPrompt(hostname);
  const submit = root.querySelector<HTMLButtonElement>(
    "[data-site-support-submit]"
  );
  const dismiss = root.querySelector<HTMLButtonElement>(
    "[data-site-support-dismiss]"
  );
  const status = root.querySelector<HTMLElement>("[data-site-support-status]");
  let submitting = false;

  navbar.settingsButton.addEventListener("click", () => {
    void send({ type: "KNOWW_OPEN_EXTENSION_SETTINGS" });
  });

  navbar.sidebarButton.addEventListener("click", () => {
    void send({
      type: "KNOWW_OPEN_EXTENSION_SIDEPANEL",
      view: "markets",
    });
  });

  const setMinimized = (minimized: boolean) => {
    root.classList.toggle("knoww-stack-minimized", minimized);
    setMarketsPanelNavbarMinimized(navbar.minimizeButton, minimized);
  };
  navbar.minimizeButton.addEventListener("click", () => {
    setMinimized(!root.classList.contains("knoww-stack-minimized"));
  });
  navbar.title.addEventListener("click", () => {
    if (root.classList.contains("knoww-stack-minimized")) setMinimized(false);
  });

  const setSearchOpen = (open: boolean) => {
    search.container.classList.toggle("knoww-search-open", open);
    navbar.searchButton.classList.toggle("knoww-search-active", open);
    navbar.searchButton.setAttribute("aria-expanded", String(open));
    search.clearButton.style.display = open ? "flex" : "none";
    if (open) {
      search.input.focus();
      return;
    }
    search.input.value = "";
    search.results.replaceChildren();
  };

  navbar.searchButton.addEventListener("click", () => {
    if (root.classList.contains("knoww-stack-minimized")) setMinimized(false);
    setSearchOpen(!search.container.classList.contains("knoww-search-open"));
  });

  search.clearButton.addEventListener("click", () => {
    if (search.input.value.trim()) {
      search.input.value = "";
      search.results.replaceChildren();
      search.input.focus();
      return;
    }
    setSearchOpen(false);
  });

  search.input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const url = new URL("/search", "https://knoww.app");
    const query = search.input.value.trim();
    if (query) url.searchParams.set("q", query);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  });

  dismiss?.addEventListener("click", () => {
    state = {
      ...state,
      dismissedUntilByHostname: {
        ...state.dismissedUntilByHostname,
        [hostname]: now() + DISMISSED_SITE_SUPPORT_DURATION_MS,
      },
    };
    void writeState(storage, state);
    root.remove();
  });

  submit?.addEventListener("click", () => {
    if (submitting || state.requestedHostnames.includes(hostname)) return;
    submitting = true;
    submit.disabled = true;
    if (status) status.textContent = "Sending…";
    void send({ type: "site-support:request", hostname })
      .then(async (response) => {
        if (response.ok === false) throw new Error("request failed");
        state = {
          ...state,
          requestedHostnames: [
            ...state.requestedHostnames.filter((entry) => entry !== hostname),
            hostname,
          ].slice(-MAX_TRACKED_HOSTNAMES),
        };
        await writeState(storage, state);
        if (status) status.textContent = "Thanks — your request has been sent.";
      })
      .catch(() => {
        submit.disabled = false;
        if (status) status.textContent = "Couldn't send. Please try again.";
      })
      .finally(() => {
        submitting = false;
      });
  });

  document.documentElement.append(root);
  return root;
}

let disposePreviousInstallation: (() => void) | undefined;

export function installUnsupportedSitePrompt(
  options: UnsupportedSitePromptInstallerOptions = {}
): () => void {
  disposePreviousInstallation?.();
  document.getElementById("knoww-notification-stack")?.remove();
  const { runtimeMessages, ...promptOptions } = options;

  let active = true;
  let previousUrl = window.location.href;
  const updateRoute = () => {
    if (!active) return;
    const currentUrl = window.location.href;
    if (currentUrl === previousUrl) return;
    previousUrl = currentUrl;
    if (isWebmailUrl(currentUrl)) {
      document.getElementById("knoww-site-support-prompt-root")?.remove();
      return;
    }
    void mountUnsupportedSitePrompt(promptOptions);
  };
  // Unlike popstate, currententrychange also covers pushState/replaceState.
  const navigation = (window as Window & { navigation?: EventTarget })
    .navigation;
  navigation?.addEventListener("currententrychange", updateRoute);
  window.addEventListener("popstate", updateRoute);
  window.addEventListener("hashchange", updateRoute);
  const observer = new MutationObserver(updateRoute);
  if (!navigation) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
  const dispose = () => {
    active = false;
    observer.disconnect();
    navigation?.removeEventListener("currententrychange", updateRoute);
    window.removeEventListener("popstate", updateRoute);
    window.removeEventListener("hashchange", updateRoute);
  };
  disposePreviousInstallation = dispose;

  const messages: RuntimeMessagePort = runtimeMessages ?? {
    addListener(listener) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        listener(message as Record<string, unknown>, sendResponse);
      });
    },
  };
  messages.addListener((message, sendResponse) => {
    if (!active) return;
    if (message?.type !== OPEN_SITE_SUPPORT_PROMPT_MESSAGE) return;
    sendResponse({ ok: true, surface: "unsupported-site-prompt" });
    void mountUnsupportedSitePrompt({
      ...promptOptions,
      ignoreDismissal: message.reveal === true,
    });
  });

  if (isWebmailUrl(window.location.href)) {
    document.getElementById("knoww-site-support-prompt-root")?.remove();
  }
  void mountUnsupportedSitePrompt(promptOptions);
  return dispose;
}
