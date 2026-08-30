import brandIconUrl from "../../../icons/icon-128.png";

export interface MarketsPanelNavbar {
  header: HTMLElement;
  title: HTMLElement;
  settingsButton: HTMLButtonElement;
  sidebarButton: HTMLButtonElement;
  searchButton: HTMLButtonElement;
  minimizeButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
}

const MINIMIZE_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
`;

const EXPAND_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
`;

const PANEL_FONT_FACES_ID = "knoww-markets-panel-font-faces";

function resolveExtensionResourceUrl(path: string): string {
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return path;
  }
}

function ensureMarketsPanelFontFaces(): void {
  if (document.getElementById(PANEL_FONT_FACES_ID)) return;

  const style = document.createElement("style");
  style.id = PANEL_FONT_FACES_ID;
  style.textContent = `
    @font-face {
      font-family: "KnowwEditorial";
      font-style: italic;
      font-weight: 500;
      font-display: swap;
      src: url("${resolveExtensionResourceUrl("fonts/fraunces-italic-500.woff2")}") format("woff2");
    }
    @font-face {
      font-family: "KnowwMono";
      font-style: normal;
      font-weight: 500;
      font-display: swap;
      src: url("${resolveExtensionResourceUrl("fonts/jetbrains-mono-500.woff2")}") format("woff2");
    }
  `;
  (document.head ?? document.documentElement).append(style);
}

function createActionButton(options: {
  ariaLabel: string;
  className: string;
  html: string;
  id?: string;
  title: string;
}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${options.className} knoww-markets-panel-action`;
  if (options.id) button.id = options.id;
  button.title = options.title;
  button.setAttribute("aria-label", options.ariaLabel);
  button.innerHTML = options.html;
  return button;
}

export function setMarketsPanelNavbarMinimized(
  button: HTMLButtonElement,
  minimized: boolean
): void {
  button.innerHTML = minimized ? EXPAND_ICON_HTML : MINIMIZE_ICON_HTML;
  button.title = minimized ? "Expand" : "Minimize";
  button.setAttribute(
    "aria-label",
    minimized ? "Expand markets panel" : "Minimize markets panel"
  );
  button.setAttribute("aria-expanded", minimized ? "false" : "true");
}

export function createMarketsPanelNavbar(): MarketsPanelNavbar {
  ensureMarketsPanelFontFaces();

  const header = document.createElement("div");
  header.className = "knoww-stack-header knoww-markets-panel-navbar";

  const title = document.createElement("div");
  title.className = "knoww-stack-title";
  title.innerHTML = `
    <span class="knoww-stack-icon" aria-hidden="true">
      <img src="${brandIconUrl}" alt="" width="22" height="22" />
    </span>
    <span>Markets</span>
  `;

  const actions = document.createElement("div");
  actions.className = "knoww-stack-header-right";

  const settingsButton = createActionButton({
    className: "knoww-stack-settings",
    title: "Settings",
    ariaLabel: "Open extension settings",
    html: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.08a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 5a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
      </svg>
    `,
  });

  const sidebarButton = createActionButton({
    className: "knoww-stack-sidebar",
    title: "Move to browser sidebar",
    ariaLabel: "Move markets panel to browser sidebar",
    html: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2"/>
        <path d="M15 4v16"/>
        <path d="m10 9 3 3-3 3"/>
      </svg>
    `,
  });

  const searchButton = createActionButton({
    className: "knoww-search-toggle",
    id: "knoww-search-toggle",
    title: "Search markets",
    ariaLabel: "Search markets",
    html: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="M21 21l-4.35-4.35"></path>
      </svg>
    `,
  });
  searchButton.setAttribute("aria-expanded", "false");

  const minimizeButton = createActionButton({
    className: "knoww-stack-minimize",
    id: "knoww-stack-minimize",
    title: "Minimize",
    ariaLabel: "Minimize markets panel",
    html: MINIMIZE_ICON_HTML,
  });
  minimizeButton.setAttribute("aria-expanded", "true");

  const closeButton = createActionButton({
    className: "knoww-stack-close",
    id: "knoww-stack-close",
    title: "Close",
    ariaLabel: "Close markets panel",
    html: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12"/>
      </svg>
    `,
  });

  actions.append(
    settingsButton,
    sidebarButton,
    searchButton,
    minimizeButton,
    closeButton
  );
  header.append(title, actions);

  return {
    header,
    title,
    settingsButton,
    sidebarButton,
    searchButton,
    minimizeButton,
    closeButton,
  };
}
