// ============================================
// STYLES INJECTION - Multi-Source Market Cards
// ============================================

/**
 * Styles API interface
 */
interface StylesApi {
  injectInlineStyles: () => void;
  injectMetamaskBridge: () => void;
}

/**
 * Safely resolve extension asset URLs.
 * Guards against "Extension context invalidated" after hot-reload/update.
 */
function getSafeRuntimeUrl(path: string): string | null {
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.getURL === "function"
    ) {
      return chrome.runtime.getURL(path);
    }
  } catch {
    // Extension context invalidated; caller should fall back.
  }
  return null;
}

/**
 * Inject CSS styles for inline market cards (supports multiple sources and platforms)
 * MEMORY: Loads CSS from external file via <link> instead of embedding ~1200 lines
 * in a JS template literal. This reduces JS heap usage by ~30-50KB.
 */
function injectInlineStyles(): void {
  try {
    if (document.getElementById("knoww-inline-styles")) return;

    // Try to load external CSS file (bundled via CopyPlugin)
    const cssUrl = getSafeRuntimeUrl("knoww-inline.css");

    if (cssUrl) {
      const link = document.createElement("link");
      link.id = "knoww-inline-styles";
      link.rel = "stylesheet";
      link.href = cssUrl;
      document.head.appendChild(link);
      return;
    }

    // Fallback: inline styles if chrome.runtime is not available (e.g., testing)
    const style = document.createElement("style");
    style.id = "knoww-inline-styles";
    style.textContent = `
      /* ============================================ */
      /* CSS VARIABLES - Platform-specific theming */
      /* ============================================ */
      :root {
        /* Default fallback values */
        --knoww-bg: rgb(0, 0, 0);
        --knoww-border: rgb(47, 51, 54);
        --knoww-text: rgb(231, 233, 234);
        --knoww-text-secondary: rgb(113, 118, 123);
        --knoww-accent: rgb(29, 155, 240);
        --knoww-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        --knoww-radius: 16px;
        --knoww-card-bg: rgb(32, 35, 39);
      }

      /* Twitter/X Dark Mode (default for Twitter) */
      .knoww-platform-twitter {
        --knoww-bg: rgb(0, 0, 0);
        --knoww-border: rgb(47, 51, 54);
        --knoww-text: rgb(231, 233, 234);
        --knoww-text-secondary: rgb(113, 118, 123);
        --knoww-accent: rgb(29, 155, 240);
        --knoww-font: "TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        --knoww-radius: 16px;
        --knoww-card-bg: rgb(32, 35, 39);
      }

      /* Twitter/X Light Mode */
      .knoww-platform-twitter.knoww-theme-light {
        --knoww-bg: rgb(255, 255, 255);
        --knoww-border: rgb(207, 217, 222);
        --knoww-text: rgb(15, 20, 25);
        --knoww-text-secondary: rgb(83, 100, 113);
        --knoww-card-bg: rgb(247, 249, 249);
      }

      /* Twitter/X Dim Mode (blue-tinted dark) */
      .knoww-platform-twitter.knoww-theme-dim {
        --knoww-bg: rgb(21, 32, 43);
        --knoww-border: rgb(56, 68, 77);
        --knoww-text: rgb(247, 249, 249);
        --knoww-text-secondary: rgb(139, 152, 165);
        --knoww-card-bg: rgb(30, 42, 56);
      }

      /* LinkedIn Light Mode */
      .knoww-platform-linkedin {
        --knoww-bg: rgb(255, 255, 255);
        --knoww-border: rgba(0, 0, 0, 0.08);
        --knoww-text: rgba(0, 0, 0, 0.9);
        --knoww-text-secondary: rgba(0, 0, 0, 0.6);
        --knoww-accent: #0a66c2;
        --knoww-font: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Fira Sans", Ubuntu, Oxygen, "Oxygen Sans", Cantarell, "Droid Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Lucida Grande", Helvetica, Arial, sans-serif;
        --knoww-radius: 8px;
        --knoww-card-bg: rgb(245, 245, 245);
      }

      /* LinkedIn Dark Mode */
      .artdeco-dark-mode .knoww-platform-linkedin,
      .theme--dark .knoww-platform-linkedin {
        --knoww-bg: rgb(30, 30, 30);
        --knoww-border: rgba(255, 255, 255, 0.08);
        --knoww-text: rgba(255, 255, 255, 0.9);
        --knoww-text-secondary: rgba(255, 255, 255, 0.6);
        --knoww-card-bg: rgb(45, 45, 45);
      }

      /* Reddit Light Mode (default) */
      .knoww-platform-reddit {
        --knoww-bg: rgb(255, 255, 255);
        --knoww-border: rgb(204, 204, 204);
        --knoww-text: rgb(28, 28, 28);
        --knoww-text-secondary: rgb(120, 124, 126);
        --knoww-accent: #ff4500;
        --knoww-font: IBMPlexSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        --knoww-radius: 8px;
        --knoww-card-bg: rgb(246, 247, 248);
      }

      /* Reddit Dark Mode */
      .theme-dark .knoww-platform-reddit,
      [data-theme="dark"] .knoww-platform-reddit,
      .knoww-platform-reddit.knoww-theme-dark {
        --knoww-bg: rgb(26, 26, 27);
        --knoww-border: rgb(52, 53, 54);
        --knoww-text: rgb(215, 218, 220);
        --knoww-text-secondary: rgb(129, 131, 132);
        --knoww-card-bg: rgb(39, 39, 41);
      }

      /* Quora Light Mode (default) */
      .knoww-platform-quora {
        --knoww-bg: rgb(255, 255, 255);
        --knoww-border: rgba(0, 0, 0, 0.12);
        --knoww-text: rgb(40, 40, 41);
        --knoww-text-secondary: rgb(99, 99, 100);
        --knoww-accent: #b92b27;
        --knoww-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        --knoww-radius: 12px;
        --knoww-card-bg: rgb(247, 247, 248);
      }

      /* Quora Dark Mode */
      .dark .knoww-platform-quora,
      [data-theme="dark"] .knoww-platform-quora,
      .knoww-platform-quora.knoww-theme-dark {
        --knoww-bg: rgb(38, 38, 39);
        --knoww-border: rgba(255, 255, 255, 0.12);
        --knoww-text: rgb(240, 240, 240);
        --knoww-text-secondary: rgba(255, 255, 255, 0.7);
        --knoww-card-bg: rgb(48, 48, 49);
      }

      /* Slashdot Light Mode (default) */
      .knoww-platform-slashdot {
        --knoww-bg: rgb(255, 255, 255);
        --knoww-border: rgba(0, 0, 0, 0.15);
        --knoww-text: rgb(34, 34, 34);
        --knoww-text-secondary: rgb(102, 102, 102);
        --knoww-accent: #026664;
        --knoww-font: Arial, Helvetica, sans-serif;
        --knoww-radius: 4px;
        --knoww-card-bg: rgb(246, 246, 246);
      }

      .knoww-platform-slashdot .knoww-market-card {
        max-width: 600px !important;
        font-size: 13px !important;
        border-radius: 4px !important;
        margin: 4px 0 0 0 !important;
      }

      .knoww-platform-slashdot .knoww-card-header {
        padding: 12px !important;
        gap: 10px !important;
      }

      .knoww-platform-slashdot .knoww-card-icon {
        width: 36px !important;
        height: 36px !important;
        border-radius: 4px !important;
      }

      .knoww-platform-slashdot .knoww-card-title {
        font-size: 13px !important;
        line-height: 1.3 !important;
      }

      .knoww-platform-slashdot .knoww-card-volume {
        font-size: 11px !important;
      }

      .knoww-platform-slashdot .knoww-card-outcomes {
        padding: 0 12px 10px 12px !important;
        gap: 6px !important;
      }

      .knoww-platform-slashdot .knoww-outcome-btn {
        padding: 6px 10px !important;
        font-size: 12px !important;
      }

      .knoww-platform-slashdot .knoww-card-footer {
        padding: 8px 12px !important;
      }

      /* Stacked cards container - for multi-source display */
      .knoww-stacked-cards {
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
      }
      
      .knoww-stacked-cards .knoww-market-card {
        margin: 0 !important; /* Remove margin when stacked, gap handles spacing */
      }
      
      .knoww-stacked-cards .knoww-market-card:first-child {
        margin-top: 0 !important;
      }

      /* Market card - Base styles with CSS variables */
      .knoww-market-card {
        background: var(--knoww-bg, rgb(0, 0, 0)) !important;
        border: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
        border-radius: var(--knoww-radius, 16px) !important;
        margin: 12px 0 0 0 !important;
        padding: 0 !important;
        font-family: var(--knoww-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif) !important;
        overflow: hidden !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      /* LinkedIn-specific card styles */
      .knoww-platform-linkedin .knoww-market-card {
        box-shadow: 0 0 0 1px var(--knoww-border) !important;
        border: none !important;
      }
      
      /* Source-specific card accents */
      .knoww-market-card.knoww-source-kalshi {
        border-color: rgba(245, 158, 11, 0.4) !important;
        border-left: 3px solid #f59e0b !important;
      }
      
      .knoww-market-card.knoww-source-polymarket {
        border-color: rgba(139, 92, 246, 0.3) !important;
        border-left: 3px solid #8b5cf6 !important;
      }

      .knoww-market-card * {
        box-sizing: border-box !important;
      }

      /* Header section */
      .knoww-card-header {
        display: flex !important;
        align-items: flex-start !important;
        padding: 16px !important;
        gap: 12px !important;
      }

      .knoww-card-icon {
        width: 48px !important;
        height: 48px !important;
        border-radius: 8px !important;
        background: var(--knoww-card-bg, rgb(32, 35, 39)) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 24px !important;
        flex-shrink: 0 !important;
        overflow: hidden !important;
      }

      .knoww-card-icon img {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }

      .knoww-card-title-section {
        flex: 1 !important;
        min-width: 0 !important;
      }

      .knoww-card-title {
        font-size: 15px !important;
        font-weight: 700 !important;
        color: var(--knoww-text, rgb(231, 233, 234)) !important;
        line-height: 1.4 !important;
        margin: 0 0 4px 0 !important;
      }

      .knoww-card-volume {
        font-size: 13px !important;
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
      }

      .knoww-card-volume span {
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
      }

      /* Yes/No outcome buttons */
      .knoww-card-outcomes {
        display: flex !important;
        gap: 8px !important;
        padding: 0 16px 12px 16px !important;
      }

      .knoww-outcome-btn {
        flex: 1 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 8px 12px !important;
        border-radius: 9999px !important;
        font-size: 14px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        border: none !important;
        transition: all 0.15s ease !important;
        min-width: 0 !important;
        overflow: hidden !important;
      }

      .knoww-outcome-btn.yes {
        background: rgba(0, 186, 124, 0.1) !important;
        color: rgb(0, 186, 124) !important;
      }

      .knoww-outcome-btn.yes:hover {
        background: rgba(0, 186, 124, 0.2) !important;
      }

      .knoww-outcome-btn.no {
        background: rgba(249, 24, 128, 0.1) !important;
        color: rgb(249, 24, 128) !important;
      }

      .knoww-outcome-btn.no:hover {
        background: rgba(249, 24, 128, 0.2) !important;
      }

      /* Multi-outcome buttons (non Yes/No) */
      .knoww-outcome-btn.option-1 {
        background: rgba(41, 98, 255, 0.1) !important;
        color: rgb(41, 98, 255) !important;
      }

      .knoww-outcome-btn.option-1:hover {
        background: rgba(41, 98, 255, 0.2) !important;
      }

      .knoww-outcome-btn.option-2 {
        background: rgba(156, 39, 176, 0.1) !important;
        color: rgb(156, 39, 176) !important;
      }

      .knoww-outcome-btn.option-2:hover {
        background: rgba(156, 39, 176, 0.2) !important;
      }

      .knoww-outcome-label {
        font-weight: 700 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        flex: 1 !important;
        min-width: 0 !important;
        text-align: left !important;
      }

      .knoww-outcome-price {
        font-weight: 700 !important;
        flex-shrink: 0 !important;
        margin-left: 8px !important;
      }

      /* Toggle options button */
      .knoww-toggle-options {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        padding: 12px 16px !important;
        background: transparent !important;
        border: none !important;
        border-top: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
        font-size: 13px !important;
        cursor: pointer !important;
        width: 100% !important;
        transition: background 0.15s ease !important;
      }

      .knoww-toggle-options:hover {
        background: rgba(255, 255, 255, 0.03) !important;
      }

      .knoww-platform-linkedin .knoww-toggle-options:hover {
        background: rgba(0, 0, 0, 0.03) !important;
      }

      .artdeco-dark-mode .knoww-platform-linkedin .knoww-toggle-options:hover,
      .theme--dark .knoww-platform-linkedin .knoww-toggle-options:hover {
        background: rgba(255, 255, 255, 0.03) !important;
      }

      .knoww-toggle-options svg {
        width: 16px !important;
        height: 16px !important;
        transition: transform 0.2s ease !important;
      }

      .knoww-toggle-options.expanded svg {
        transform: rotate(180deg) !important;
      }

      /* Expanded options list */
      .knoww-options-list {
        display: none !important;
        border-top: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
        padding: 8px 0 !important;
      }

      .knoww-options-list.visible {
        display: block !important;
      }

      .knoww-option-row {
        display: flex !important;
        align-items: center !important;
        padding: 8px 16px !important;
        gap: 12px !important;
        cursor: pointer !important;
        transition: background 0.15s ease !important;
      }

      .knoww-option-row:hover {
        background: rgba(255, 255, 255, 0.03) !important;
      }

      .knoww-platform-linkedin .knoww-option-row:hover {
        background: rgba(0, 0, 0, 0.03) !important;
      }

      .artdeco-dark-mode .knoww-platform-linkedin .knoww-option-row:hover,
      .theme--dark .knoww-platform-linkedin .knoww-option-row:hover {
        background: rgba(255, 255, 255, 0.03) !important;
      }

      .knoww-option-color {
        width: 4px !important;
        height: 24px !important;
        border-radius: 2px !important;
        flex-shrink: 0 !important;
      }

      .knoww-option-name {
        font-size: 15px !important;
        color: var(--knoww-text, rgb(231, 233, 234)) !important;
        flex: 1 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }

      .knoww-option-percent {
        font-size: 15px !important;
        font-weight: 400 !important;
        color: rgb(0, 186, 124) !important;
        min-width: 45px !important;
        text-align: right !important;
      }

      /* Footer */
      .knoww-card-footer {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 12px 16px !important;
        border-top: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
      }

      /* Source badge (Polymarket / Kalshi) */
      .knoww-source-badge {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 12px !important;
        font-weight: 500 !important;
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
      }

      .knoww-source-icon {
        width: 18px !important;
        height: 18px !important;
        border-radius: 4px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        color: white !important;
      }

      .knoww-source-badge.knoww-source-polymarket .knoww-source-icon {
        background: #7c3aed !important;
      }

      .knoww-source-badge.knoww-source-kalshi .knoww-source-icon {
        background: #f59e0b !important;
      }

      .knoww-source-badge.knoww-source-polymarket span {
        color: #7c3aed !important;
      }

      .knoww-source-badge.knoww-source-kalshi span {
        color: #f59e0b !important;
      }

      .knoww-brand {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 13px !important;
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
      }

      .knoww-brand-icon {
        width: 16px !important;
        height: 16px !important;
        border-radius: 4px !important;
        overflow: hidden !important;
        flex-shrink: 0 !important;
      }

      .knoww-brand-icon img {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }

      .knoww-view-market {
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
        color: var(--knoww-accent, rgb(29, 155, 240)) !important;
        font-size: 13px !important;
        font-weight: 400 !important;
        text-decoration: none !important;
        cursor: pointer !important;
        background: none !important;
        border: none !important;
        padding: 0 !important;
      }

      .knoww-view-market:hover {
        text-decoration: underline !important;
      }

      .knoww-view-market svg {
        width: 16px !important;
        height: 16px !important;
      }

      /* ============================================ */
      /* NOTIFICATION STACK STYLES */
      /* ============================================ */

      /* Main container - always fixed position on right side */
      .knoww-notification-stack {
        position: fixed !important;
        top: 12px !important;
        right: 20px !important;
        z-index: 9999 !important;
        background: var(--knoww-bg, rgb(0, 0, 0)) !important;
        border: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
        border-radius: var(--knoww-radius, 16px) !important;
        overflow: hidden !important;
        font-family: var(--knoww-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif) !important;
        width: 300px !important;
        max-width: calc(100vw - 40px) !important;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5) !important;
      }

      /* Twitter/X notification stack - Dark Mode (default) */
      .knoww-notification-stack-twitter {
        top: 54px !important; /* Account for Twitter's header */
        --knoww-bg: rgb(0, 0, 0) !important;
        --knoww-border: rgb(47, 51, 54) !important;
        --knoww-text: rgb(231, 233, 234) !important;
        --knoww-text-secondary: rgb(113, 118, 123) !important;
        --knoww-accent: rgb(29, 155, 240) !important;
        --knoww-card-bg: rgb(32, 35, 39) !important;
        font-family: "TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      }

      /* Twitter/X notification stack - Light Mode */
      .knoww-notification-stack-twitter.knoww-theme-light {
        --knoww-bg: rgb(255, 255, 255) !important;
        --knoww-border: rgb(207, 217, 222) !important;
        --knoww-text: rgb(15, 20, 25) !important;
        --knoww-text-secondary: rgb(83, 100, 113) !important;
        --knoww-card-bg: rgb(247, 249, 249) !important;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15) !important;
      }

      /* Twitter/X notification stack - Dim Mode */
      .knoww-notification-stack-twitter.knoww-theme-dim {
        --knoww-bg: rgb(21, 32, 43) !important;
        --knoww-border: rgb(56, 68, 77) !important;
        --knoww-text: rgb(247, 249, 249) !important;
        --knoww-text-secondary: rgb(139, 152, 165) !important;
        --knoww-card-bg: rgb(30, 42, 56) !important;
      }

      /* Drag cursor on the notification stack header */
      .knoww-notification-stack .knoww-stack-header {
        cursor: grab !important;
        user-select: none !important;
      }

      .knoww-notification-stack.knoww-dragging .knoww-stack-header {
        cursor: grabbing !important;
      }

      /* Subtle visual hint during drag */
      .knoww-notification-stack.knoww-dragging {
        opacity: 0.92 !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6) !important;
      }

      /* LinkedIn-specific notification stack styling */
      .knoww-notification-stack-linkedin {
        top: 60px !important; /* Account for LinkedIn's fixed navbar */
        --knoww-bg: rgb(30, 30, 30) !important;
        --knoww-border: rgba(255, 255, 255, 0.08) !important;
        --knoww-text: rgba(255, 255, 255, 0.9) !important;
        --knoww-text-secondary: rgba(255, 255, 255, 0.6) !important;
        --knoww-accent: #0a66c2 !important;
      }

      /* Reddit-specific notification stack styling - Light Mode (default) */
      .knoww-notification-stack-reddit {
        top: 56px !important; /* Account for Reddit's fixed navbar */
        width: 260px !important; /* Smaller width for Reddit's narrower sidebar */
        --knoww-bg: rgb(255, 255, 255) !important;
        --knoww-border: rgb(204, 204, 204) !important;
        --knoww-text: rgb(28, 28, 28) !important;
        --knoww-text-secondary: rgb(120, 124, 126) !important;
        --knoww-accent: #ff4500 !important;
        --knoww-radius: 8px !important;
        --knoww-card-bg: rgb(246, 247, 248) !important;
        border-radius: 8px !important;
        font-family: IBMPlexSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      }

      /* Reddit Dark Mode - detected via html/body classes or color scheme */
      .theme-dark .knoww-notification-stack-reddit,
      [data-theme="dark"] .knoww-notification-stack-reddit,
      .knoww-notification-stack-reddit.knoww-theme-dark {
        --knoww-bg: rgb(26, 26, 27) !important;
        --knoww-border: rgb(52, 53, 54) !important;
        --knoww-text: rgb(215, 218, 220) !important;
        --knoww-text-secondary: rgb(129, 131, 132) !important;
        --knoww-card-bg: rgb(39, 39, 41) !important;
      }

      .knoww-notification-stack-reddit .knoww-stack-badge {
        background: #ff4500 !important;
      }

      .knoww-notification-stack-reddit .knoww-stack-header {
        padding: 10px 12px !important;
      }

      .knoww-notification-stack-reddit .knoww-stack-item {
        padding: 10px 12px !important;
      }

      .knoww-notification-stack-reddit .knoww-stack-item-title {
        font-size: 13px !important;
      }

      .knoww-notification-stack-reddit .knoww-stack-item-outcomes {
        font-size: 11px !important;
      }

      /* Quora-specific notification stack styling */
      .knoww-notification-stack-quora {
        top: 60px !important;
        width: 280px !important;
        --knoww-bg: rgb(255, 255, 255) !important;
        --knoww-border: rgba(0, 0, 0, 0.12) !important;
        --knoww-text: rgb(40, 40, 41) !important;
        --knoww-text-secondary: rgb(99, 99, 100) !important;
        --knoww-accent: #b92b27 !important;
        --knoww-radius: 12px !important;
        --knoww-card-bg: rgb(247, 247, 248) !important;
        border-radius: 12px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      }

      .dark .knoww-notification-stack-quora,
      [data-theme="dark"] .knoww-notification-stack-quora,
      .knoww-notification-stack-quora.knoww-theme-dark {
        --knoww-bg: rgb(38, 38, 39) !important;
        --knoww-border: rgba(255, 255, 255, 0.12) !important;
        --knoww-text: rgb(240, 240, 240) !important;
        --knoww-text-secondary: rgba(255, 255, 255, 0.7) !important;
        --knoww-card-bg: rgb(48, 48, 49) !important;
      }

      .knoww-notification-stack-quora .knoww-stack-badge {
        background: #b92b27 !important;
      }

      /* Slashdot-specific notification stack styling */
      .knoww-notification-stack-slashdot {
        top: 12px !important;
        width: 260px !important;
        --knoww-bg: rgb(255, 255, 255) !important;
        --knoww-border: rgba(0, 0, 0, 0.15) !important;
        --knoww-text: rgb(34, 34, 34) !important;
        --knoww-text-secondary: rgb(102, 102, 102) !important;
        --knoww-accent: #026664 !important;
        --knoww-radius: 4px !important;
        --knoww-card-bg: rgb(246, 246, 246) !important;
        border-radius: 4px !important;
        font-family: Arial, Helvetica, sans-serif !important;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15) !important;
      }

      .knoww-notification-stack-slashdot .knoww-stack-badge {
        background: #026664 !important;
      }

      /* Slashdot trading panel light-theme overrides */
      .knoww-platform-slashdot .knoww-trading-panel {
        background: var(--knoww-bg, #fff) !important;
        border: 1px solid var(--knoww-border, rgba(0, 0, 0, 0.15)) !important;
        border-top: none !important;
        border-radius: 0 0 var(--knoww-radius, 4px) var(--knoww-radius, 4px) !important;
        margin: -1px 0 4px 0 !important;
        max-width: 600px !important;
      }
      .knoww-platform-slashdot .knoww-tp-form {
        padding: 10px 14px 14px !important;
        gap: 10px !important;
      }
      .knoww-platform-slashdot .knoww-tp-ordertype-toggle {
        background: rgba(0, 0, 0, 0.04) !important;
      }
      .knoww-platform-slashdot .knoww-tp-ordertype-btn.active {
        background: var(--knoww-bg, #fff) !important;
        color: var(--knoww-text, #222) !important;
        border-color: rgba(0, 0, 0, 0.1) !important;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06) !important;
      }
      .knoww-platform-slashdot .knoww-tp-more-btn {
        background: rgba(0, 0, 0, 0.04) !important;
      }
      .knoww-platform-slashdot .knoww-tp-more-btn:hover,
      .knoww-platform-slashdot .knoww-tp-more-btn.active {
        background: var(--knoww-bg, #fff) !important;
        border-color: rgba(0, 0, 0, 0.1) !important;
      }
      .knoww-platform-slashdot .knoww-tp-buysell-toggle {
        border-color: rgba(0, 0, 0, 0.12) !important;
      }
      .knoww-platform-slashdot .knoww-tp-buysell-btn.buy.active {
        background: rgba(0, 186, 124, 0.08) !important;
        color: rgb(0, 160, 107) !important;
      }
      .knoww-platform-slashdot .knoww-tp-buysell-btn.sell.active {
        background: rgba(249, 24, 128, 0.08) !important;
        color: rgb(220, 20, 110) !important;
      }
      .knoww-platform-slashdot .knoww-tp-outcome-btn {
        border-color: rgba(0, 0, 0, 0.1) !important;
        background: rgba(0, 0, 0, 0.02) !important;
      }
      .knoww-platform-slashdot .knoww-tp-outcome-btn.yes.active {
        background: rgba(0, 200, 83, 0.08) !important;
        border-color: rgb(0, 160, 67) !important;
        color: rgb(0, 140, 58) !important;
      }
      .knoww-platform-slashdot .knoww-tp-outcome-btn.no.active {
        background: rgba(255, 23, 68, 0.08) !important;
        border-color: rgb(220, 20, 60) !important;
        color: rgb(200, 18, 55) !important;
      }
      .knoww-platform-slashdot .knoww-tp-shares-btn {
        border-color: rgba(0, 0, 0, 0.12) !important;
      }
      .knoww-platform-slashdot .knoww-tp-shares-btn:hover:not(:disabled) {
        border-color: rgba(0, 0, 0, 0.25) !important;
        background: rgba(0, 0, 0, 0.03) !important;
      }
      .knoww-platform-slashdot .knoww-tp-shares-input {
        background: rgba(0, 0, 0, 0.02) !important;
        border-color: rgba(0, 0, 0, 0.12) !important;
      }
      .knoww-platform-slashdot .knoww-tp-shares-input:focus {
        border-color: var(--knoww-accent, #026664) !important;
        background: rgba(2, 102, 100, 0.03) !important;
      }
      .knoww-platform-slashdot .knoww-tp-submit:disabled {
        background: rgba(0, 0, 0, 0.06) !important;
        color: var(--knoww-text-secondary, #666) !important;
      }
      .knoww-platform-slashdot .knoww-tp-submit.loading {
        background: rgba(0, 0, 0, 0.06) !important;
        color: var(--knoww-text-secondary, #666) !important;
      }
      .knoww-platform-slashdot .knoww-tp-spinner {
        border-color: rgba(0, 0, 0, 0.1) !important;
        border-top-color: var(--knoww-accent, #026664) !important;
      }
      .knoww-platform-slashdot .knoww-tp-header-wallet {
        background: rgba(0, 0, 0, 0.04) !important;
        border-color: rgba(0, 0, 0, 0.1) !important;
      }
      .knoww-platform-slashdot .knoww-tp-close:hover {
        background: rgba(0, 0, 0, 0.06) !important;
      }
      .knoww-platform-slashdot .knoww-tp-portfolio-bar {
        background: rgba(0, 0, 0, 0.02) !important;
        border-bottom-color: rgba(0, 0, 0, 0.06) !important;
      }
      .knoww-platform-slashdot .knoww-tp-deposit-method-btn {
        border-color: rgba(0, 0, 0, 0.1) !important;
        background: rgba(0, 0, 0, 0.02) !important;
      }
      .knoww-platform-slashdot .knoww-tp-deposit-token-row {
        border-color: rgba(0, 0, 0, 0.08) !important;
        background: rgba(0, 0, 0, 0.02) !important;
      }
      .knoww-platform-slashdot .knoww-tp-deposit-search {
        border-color: rgba(0, 0, 0, 0.1) !important;
        background: rgba(0, 0, 0, 0.02) !important;
      }

      /* Header */
      .knoww-stack-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 12px 16px !important;
        border-bottom: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
      }

      .knoww-stack-title {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        font-size: 15px !important;
        font-weight: 700 !important;
        color: var(--knoww-text, rgb(231, 233, 234)) !important;
      }

      .knoww-stack-icon {
        width: 20px !important;
        height: 20px !important;
        border-radius: 4px !important;
        overflow: hidden !important;
        flex-shrink: 0 !important;
      }

      .knoww-stack-icon img {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }

      .knoww-stack-header-right {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
      }

      .knoww-stack-badge {
        min-width: 20px !important;
        height: 20px !important;
        padding: 0 6px !important;
        background: var(--knoww-accent, rgb(29, 155, 240)) !important;
        border-radius: 10px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        color: white !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      /* Search toggle button */
      .knoww-search-toggle {
        width: 28px !important;
        height: 28px !important;
        border-radius: 50% !important;
        background: transparent !important;
        border: none !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
        transition: all 0.15s ease !important;
      }

      .knoww-search-toggle:hover {
        background: rgba(29, 155, 240, 0.1) !important;
        color: var(--knoww-accent, rgb(29, 155, 240)) !important;
      }

      .knoww-search-toggle.knoww-search-active {
        background: rgba(29, 155, 240, 0.2) !important;
        color: var(--knoww-accent, rgb(29, 155, 240)) !important;
      }

      .knoww-search-toggle svg {
        width: 16px !important;
        height: 16px !important;
      }

      /* Search container */
      .knoww-search-container {
        display: none !important;
        padding: 12px !important;
        border-bottom: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
      }

      .knoww-search-container.knoww-search-open {
        display: block !important;
      }

      .knoww-search-input-wrapper {
        position: relative !important;
        display: flex !important;
        align-items: center !important;
      }

      .knoww-search-input {
        width: 100% !important;
        padding: 10px 36px 10px 12px !important;
        background: var(--knoww-card-bg, rgb(32, 35, 39)) !important;
        border: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
        border-radius: 20px !important;
        color: var(--knoww-text, rgb(231, 233, 234)) !important;
        font-size: 14px !important;
        outline: none !important;
        font-family: inherit !important;
      }

      .knoww-search-input:focus {
        border-color: var(--knoww-accent, rgb(29, 155, 240)) !important;
      }

      .knoww-search-input::placeholder {
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
      }

      .knoww-search-clear {
        position: absolute !important;
        right: 8px !important;
        width: 24px !important;
        height: 24px !important;
        border-radius: 50% !important;
        background: var(--knoww-border, rgb(47, 51, 54)) !important;
        border: none !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        color: var(--knoww-text, rgb(231, 233, 234)) !important;
        transition: background 0.15s ease !important;
      }

      .knoww-search-clear:hover {
        background: rgb(63, 67, 71) !important;
      }

      .knoww-search-clear svg {
        width: 14px !important;
        height: 14px !important;
      }

      /* Search results */
      .knoww-search-results {
        margin-top: 8px !important;
        max-height: 250px !important;
        overflow-y: auto !important;
      }

      .knoww-search-loading,
      .knoww-search-empty {
        padding: 16px !important;
        text-align: center !important;
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
        font-size: 13px !important;
      }

      .knoww-search-result-item {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 10px !important;
        border-radius: 8px !important;
        cursor: pointer !important;
        transition: background 0.15s ease !important;
        position: relative !important;
      }

      .knoww-search-result-item:hover {
        background: rgba(255, 255, 255, 0.03) !important;
      }

      /* Source indicator for search results */
      .knoww-search-source-indicator {
        width: 16px !important;
        height: 16px !important;
        border-radius: 4px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 9px !important;
        font-weight: 700 !important;
        color: white !important;
        flex-shrink: 0 !important;
      }
      
      .knoww-search-result-item.knoww-source-kalshi {
        border-left: 2px solid rgba(245, 158, 11, 0.5) !important;
      }
      
      .knoww-search-result-item.knoww-source-polymarket {
        border-left: 2px solid rgba(124, 58, 237, 0.5) !important;
      }

      .knoww-search-result-icon {
        width: 32px !important;
        height: 32px !important;
        border-radius: 6px !important;
        background: var(--knoww-card-bg, rgb(32, 35, 39)) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 16px !important;
        flex-shrink: 0 !important;
        overflow: hidden !important;
      }

      .knoww-search-result-icon img {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }

      .knoww-search-result-content {
        flex: 1 !important;
        min-width: 0 !important;
      }

      .knoww-search-result-title {
        font-size: 13px !important;
        font-weight: 500 !important;
        color: var(--knoww-text, rgb(231, 233, 234)) !important;
        line-height: 1.3 !important;
        margin-bottom: 2px !important;
      }

      .knoww-search-result-prices {
        display: flex !important;
        gap: 8px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
      }

      /* Multi-outcome search results - stacked layout */
      .knoww-search-result-prices.knoww-multi-outcome {
        flex-direction: column !important;
        gap: 3px !important;
      }

      .knoww-search-result-prices .knoww-outcome-row {
        display: flex !important;
        align-items: center !important;
        gap: 5px !important;
      }

      .knoww-search-result-prices .knoww-outcome-indicator {
        width: 2px !important;
        height: 10px !important;
        border-radius: 1px !important;
        flex-shrink: 0 !important;
      }

      .knoww-search-result-prices .knoww-outcome-indicator.option-1 {
        background: rgb(41, 98, 255) !important;
      }

      .knoww-search-result-prices .knoww-outcome-indicator.option-2 {
        background: rgb(156, 39, 176) !important;
      }

      .knoww-search-result-prices .knoww-outcome-name {
        flex: 1 !important;
        color: var(--knoww-text, rgb(231, 233, 234)) !important;
        font-weight: 400 !important;
        font-size: 10px !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        max-width: 100px !important;
      }

      .knoww-search-result-prices .knoww-outcome-percent {
        font-weight: 600 !important;
        font-size: 10px !important;
        min-width: 28px !important;
        text-align: right !important;
      }

      .knoww-search-result-prices .knoww-outcome-percent.option-1 {
        color: rgb(41, 98, 255) !important;
      }

      .knoww-search-result-prices .knoww-outcome-percent.option-2 {
        color: rgb(156, 39, 176) !important;
      }

      /* Items container */
      .knoww-stack-items {
        max-height: 400px !important;
        overflow: hidden !important;
      }

      .knoww-stack-items.knoww-has-overflow {
        overflow-y: auto !important;
      }

      .knoww-stack-items::-webkit-scrollbar {
        width: 4px !important;
      }

      .knoww-stack-items::-webkit-scrollbar-track {
        background: transparent !important;
      }

      .knoww-stack-items::-webkit-scrollbar-thumb {
        background: rgb(47, 51, 54) !important;
        border-radius: 2px !important;
      }

      /* Empty state */
      .knoww-stack-empty {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 24px 16px !important;
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
        font-size: 14px !important;
        text-align: center !important;
        gap: 4px !important;
      }

      .knoww-stack-empty.knoww-hidden {
        display: none !important;
      }

      .knoww-stack-empty-sub {
        font-size: 12px !important;
        opacity: 0.7 !important;
      }

      /* Notification item */
      .knoww-notification-item {
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        padding: 12px 16px !important;
        cursor: pointer !important;
        transition: background 0.15s ease !important;
        border-bottom: 1px solid var(--knoww-border, rgb(47, 51, 54)) !important;
        animation: knoww-slide-in 0.3s ease forwards;
        opacity: 1 !important;
        position: relative !important;
      }
      
      /* Source-specific notification styling */
      .knoww-notification-item.knoww-source-kalshi {
        border-left: 3px solid rgba(245, 158, 11, 0.6) !important;
      }
      
      .knoww-notification-item.knoww-source-polymarket {
        border-left: 3px solid rgba(124, 58, 237, 0.6) !important;
      }

      .knoww-notification-item:last-child {
        border-bottom: none !important;
      }

      .knoww-notification-item:hover {
        background: rgba(255, 255, 255, 0.03) !important;
      }

      .knoww-notification-item:active {
        background: rgba(255, 255, 255, 0.06) !important;
      }

      .knoww-notification-item.knoww-notification-unavailable {
        opacity: 0.5 !important;
      }

      .knoww-notification-item.knoww-notification-unavailable::after {
        content: "Scrolled away" !important;
        position: absolute !important;
        right: 12px !important;
        font-size: 10px !important;
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
      }

      @keyframes knoww-slide-in {
        from {
          opacity: 0;
          transform: translateX(20px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      /* Notification icon */
      .knoww-notification-icon {
        width: 36px !important;
        height: 36px !important;
        border-radius: 6px !important;
        background: var(--knoww-card-bg, rgb(32, 35, 39)) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 18px !important;
        flex-shrink: 0 !important;
        overflow: hidden !important;
      }

      .knoww-notification-icon img {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }

      /* Notification content */
      .knoww-notification-content {
        flex: 1 !important;
        min-width: 0 !important;
      }

      .knoww-notification-title {
        font-size: 13px !important;
        font-weight: 500 !important;
        color: var(--knoww-text, rgb(231, 233, 234)) !important;
        line-height: 1.3 !important;
        margin-bottom: 4px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        display: -webkit-box !important;
        -webkit-line-clamp: 2 !important;
        line-clamp: 2 !important;
        -webkit-box-orient: vertical !important;
      }

      .knoww-notification-prices {
        display: flex !important;
        gap: 8px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
      }

      /* Multi-outcome prices - stacked layout */
      .knoww-notification-prices.knoww-multi-outcome {
        flex-direction: column !important;
        gap: 4px !important;
      }

      .knoww-notification-prices .knoww-outcome-row {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }

      .knoww-notification-prices .knoww-outcome-indicator {
        width: 3px !important;
        height: 12px !important;
        border-radius: 2px !important;
        flex-shrink: 0 !important;
      }

      .knoww-notification-prices .knoww-outcome-indicator.option-1 {
        background: rgb(41, 98, 255) !important;
      }

      .knoww-notification-prices .knoww-outcome-indicator.option-2 {
        background: rgb(156, 39, 176) !important;
      }

      .knoww-notification-prices .knoww-outcome-name {
        flex: 1 !important;
        color: var(--knoww-text, rgb(231, 233, 234)) !important;
        font-weight: 400 !important;
        font-size: 11px !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        max-width: 120px !important;
      }

      .knoww-notification-prices .knoww-outcome-percent {
        font-weight: 600 !important;
        font-size: 11px !important;
        min-width: 32px !important;
        text-align: right !important;
      }

      .knoww-notification-prices .knoww-outcome-percent.option-1 {
        color: rgb(41, 98, 255) !important;
      }

      .knoww-notification-prices .knoww-outcome-percent.option-2 {
        color: rgb(156, 39, 176) !important;
      }

      .knoww-price-yes {
        color: rgb(0, 186, 124) !important;
      }

      .knoww-price-no {
        color: rgb(249, 24, 128) !important;
      }

      .knoww-price-option1 {
        color: rgb(41, 98, 255) !important;
      }

      .knoww-price-option2 {
        color: rgb(156, 39, 176) !important;
      }

      /* Arrow indicator */
      .knoww-notification-arrow {
        flex-shrink: 0 !important;
        color: var(--knoww-text-secondary, rgb(113, 118, 123)) !important;
        opacity: 0 !important;
        transform: translateX(-4px) !important;
        transition: all 0.15s ease !important;
      }

      .knoww-notification-item:hover .knoww-notification-arrow {
        opacity: 1 !important;
        transform: translateX(0) !important;
      }

      .knoww-notification-arrow svg {
        width: 16px !important;
        height: 16px !important;
      }

      /* Highlight animation for scrolled-to cards */
      .knoww-market-card.knoww-highlight {
        animation: knoww-highlight-pulse 2s ease !important;
      }

      @keyframes knoww-highlight-pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(29, 155, 240, 0.7);
        }
        25% {
          box-shadow: 0 0 0 8px rgba(29, 155, 240, 0.4);
        }
        50% {
          box-shadow: 0 0 0 12px rgba(29, 155, 240, 0.2);
        }
        75% {
          box-shadow: 0 0 0 8px rgba(29, 155, 240, 0.1);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(29, 155, 240, 0);
        }
      }

      /* LinkedIn-specific highlight uses LinkedIn blue */
      .knoww-platform-linkedin .knoww-market-card.knoww-highlight {
        animation: knoww-highlight-pulse-linkedin 2s ease !important;
      }

      @keyframes knoww-highlight-pulse-linkedin {
        0% {
          box-shadow: 0 0 0 0 rgba(10, 102, 194, 0.7);
        }
        25% {
          box-shadow: 0 0 0 8px rgba(10, 102, 194, 0.4);
        }
        50% {
          box-shadow: 0 0 0 12px rgba(10, 102, 194, 0.2);
        }
        75% {
          box-shadow: 0 0 0 8px rgba(10, 102, 194, 0.1);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(10, 102, 194, 0);
        }
      }

      /* Toast notification for scroll errors */
      .knoww-scroll-toast {
        position: fixed !important;
        bottom: 80px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: var(--knoww-accent, rgb(29, 155, 240)) !important;
        color: white !important;
        padding: 12px 20px !important;
        border-radius: 8px !important;
        font-size: 14px !important;
        font-weight: 500 !important;
        z-index: 10000 !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
        animation: knoww-toast-in 0.3s ease !important;
      }

      .knoww-scroll-toast.knoww-toast-hide {
        animation: knoww-toast-out 0.3s ease forwards !important;
      }

      @keyframes knoww-toast-in {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      @keyframes knoww-toast-out {
        from {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
        to {
          opacity: 0;
          transform: translateX(-50%) translateY(20px);
        }
      }
    `;
    document.head.appendChild(style);
  } catch (e) {
    console.error("[KnowwInline] Failed to inject styles:", e);
  }
}

// NOTE: The CSS above is a fallback. In production, the external
// knoww-inline.css file is loaded via <link> for better memory efficiency.

/**
 * Inject the page bridge script into the main world so the extension
 * can communicate with window.ethereum (MetaMask). The bridge uses
 * structured postMessage request/response with correlation IDs.
 *
 * Security: The bridge only allows a strict allowlist of wallet RPC
 * methods and every call requires explicit user approval in MetaMask.
 */
function injectMetamaskBridge(): void {
  try {
    if (document.getElementById("knoww-page-bridge")) return;
    const script = document.createElement("script");
    script.id = "knoww-page-bridge";
    script.type = "text/javascript";

    const nonce = crypto.randomUUID();
    script.dataset.knowwNonce = nonce;
    window.__KNOWW_BRIDGE_NONCE__ = nonce;

    try {
      script.src = chrome.runtime.getURL("page-bridge.js");
    } catch {
      return;
    }
    (document.documentElement || document.head || document.body).appendChild(
      script
    );
  } catch {
    // Extension context may be invalidated
  }
}

// Export styles functions
export const KNOWW_STYLES: StylesApi = {
  injectInlineStyles,
  injectMetamaskBridge,
};

window.KNOWW_STYLES = KNOWW_STYLES;
