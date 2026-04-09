// ============================================
// KNOWW SETTINGS - Options Page
// ============================================

import { Fragment, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "./types/settings";

const SUPPORTED_HOST_PATTERNS = [
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)quora\.com$/i,
  /^news\.ycombinator\.com$/i,
  /(^|\.)stackoverflow\.com$/i,
  /(^|\.)stackexchange\.com$/i,
  /(^|\.)superuser\.com$/i,
  /(^|\.)serverfault\.com$/i,
  /(^|\.)askubuntu\.com$/i,
  /(^|\.)mathoverflow\.net$/i,
  /(^|\.)stackapps\.com$/i,
  /(^|\.)producthunt\.com$/i,
  /(^|\.)slashdot\.org$/i,
  /(^|\.)lemmy\.world$/i,
  /(^|\.)lemmy\.ml$/i,
  /(^|\.)sh\.itjust\.works$/i,
  /(^|\.)programming\.dev$/i,
  /(^|\.)beehaw\.org$/i,
  /(^|\.)feddit\.org$/i,
  /(^|\.)lemm\.ee$/i,
  /(^|\.)threads\.net$/i,
  /^bsky\.app$/i,
  /(^|\.)mastodon\.social$/i,
  /(^|\.)mstdn\.social$/i,
  /(^|\.)fosstodon\.org$/i,
  /(^|\.)hachyderm\.io$/i,
  /(^|\.)mas\.to$/i,
  /(^|\.)infosec\.exchange$/i,
  /(^|\.)discord\.com$/i,
  /(^|\.)farcaster\.xyz$/i,
  /(^|\.)coinmarketcap\.com$/i,
  /(^|\.)paragraph\.com$/i,
  /(^|\.)coindesk\.com$/i,
  /(^|\.)cointelegraph\.com$/i,
  /(^|\.)decrypt\.co$/i,
  /(^|\.)theblock\.co$/i,
  /(^|\.)blockworks\.com$/i,
  /(^|\.)bankless\.com$/i,
  /(^|\.)bitcoinmagazine\.com$/i,
  /(^|\.)beincrypto\.com$/i,
  /(^|\.)unchainedcrypto\.com$/i,
  /(^|\.)cryptopanic\.com$/i,
];

const PLATFORM_OPTIONS: Array<{
  key: keyof UserSettings["platforms"];
  label: string;
  description: string;
  icon: string;
}> = [
  {
    key: "twitter",
    label: "Twitter / X",
    description: "Show prediction markets on Twitter/X posts",
    icon: "𝕏",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    description: "Show prediction markets on LinkedIn posts",
    icon: "in",
  },
  {
    key: "reddit",
    label: "Reddit",
    description: "Show prediction markets on Reddit posts",
    icon: "📱",
  },
  {
    key: "quora",
    label: "Quora",
    description: "Show prediction markets on Quora answers",
    icon: "Q",
  },
  {
    key: "hackernews",
    label: "Hacker News",
    description: "Show prediction markets on Hacker News stories and comments",
    icon: "Y",
  },
  {
    key: "stackoverflow",
    label: "Stack Overflow",
    description:
      "Show prediction markets on Stack Overflow questions and answers",
    icon: "SO",
  },
  {
    key: "stackexchange",
    label: "Stack Exchange",
    description: "Show prediction markets on Stack Exchange network posts",
    icon: "SE",
  },
  {
    key: "producthunt",
    label: "Product Hunt",
    description: "Show prediction markets on Product Hunt posts and comments",
    icon: "PH",
  },
  {
    key: "slashdot",
    label: "Slashdot",
    description: "Show prediction markets on Slashdot stories and comments",
    icon: "SD",
  },
  {
    key: "lemmy",
    label: "Lemmy",
    description: "Show prediction markets on supported Lemmy instances",
    icon: "L",
  },
  {
    key: "threads",
    label: "Threads",
    description: "Show prediction markets on Threads posts",
    icon: "@",
  },
  {
    key: "bluesky",
    label: "Bluesky",
    description: "Show prediction markets on Bluesky posts",
    icon: "B",
  },
  {
    key: "mastodon",
    label: "Mastodon",
    description: "Show prediction markets on supported Mastodon instances",
    icon: "M",
  },
  {
    key: "discord",
    label: "Discord",
    description: "Show prediction markets on Discord messages",
    icon: "C",
  },
  {
    key: "farcaster",
    label: "Farcaster",
    description: "Show prediction markets on Farcaster casts and replies",
    icon: "FC",
  },
  {
    key: "coinmarketcap",
    label: "CoinMarketCap",
    description: "Show prediction markets on CoinMarketCap community posts",
    icon: "CMC",
  },
  {
    key: "paragraph",
    label: "Paragraph",
    description: "Show prediction markets on Paragraph posts and newsletters",
    icon: "P",
  },
  {
    key: "coindesk",
    label: "CoinDesk",
    description: "Show prediction markets on CoinDesk articles",
    icon: "CD",
  },
  {
    key: "cointelegraph",
    label: "Cointelegraph",
    description: "Show prediction markets on Cointelegraph articles",
    icon: "CT",
  },
  {
    key: "decrypt",
    label: "Decrypt",
    description: "Show prediction markets on Decrypt articles",
    icon: "D",
  },
  {
    key: "theblock",
    label: "The Block",
    description: "Show prediction markets on The Block stories",
    icon: "TB",
  },
  {
    key: "blockworks",
    label: "Blockworks",
    description: "Show prediction markets on Blockworks stories",
    icon: "BW",
  },
  {
    key: "bankless",
    label: "Bankless",
    description: "Show prediction markets on Bankless articles",
    icon: "BL",
  },
  {
    key: "bitcoinmagazine",
    label: "Bitcoin Magazine",
    description: "Show prediction markets on Bitcoin Magazine articles",
    icon: "BM",
  },
  {
    key: "beincrypto",
    label: "BeInCrypto",
    description: "Show prediction markets on BeInCrypto articles",
    icon: "BC",
  },
  {
    key: "unchained",
    label: "Unchained",
    description: "Show prediction markets on Unchained articles",
    icon: "UC",
  },
  {
    key: "cryptopanic",
    label: "CryptoPanic",
    description: "Show prediction markets on CryptoPanic news items",
    icon: "CP",
  },
];

function isSupportedSocialHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return SUPPORTED_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

// Toggle Switch Component
interface ToggleProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ id, checked, onChange }: ToggleProps) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span className="toggle-slider"></span>
    </label>
  );
}

// Setting Row Component
interface SettingRowProps {
  label: string;
  description: string;
  icon?: string;
  iconClass?: string;
  children: React.ReactNode;
}

function SettingRow({
  label,
  description,
  icon,
  iconClass,
  children,
}: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <div className="setting-label">
          {icon && <span className={iconClass || "platform-icon"}>{icon}</span>}
          {label}
        </div>
        <div className="setting-description">{description}</div>
      </div>
      {children}
    </div>
  );
}

// Section Component
interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="section">
      <div className="section-header">{title}</div>
      <div className="section-content">{children}</div>
    </div>
  );
}

// Divider Component
function Divider() {
  return <div className="divider"></div>;
}

// Main Options App Component
function OptionsApp() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [status, setStatus] = useState<string>("");
  const [statusVisible, setStatusVisible] = useState(false);
  const [version] = useState(() => chrome.runtime.getManifest().version);
  const [hasToken, setHasToken] = useState(false);

  // Load settings on mount
  useEffect(() => {
    chrome.storage.sync.get(
      { knowwSettings: DEFAULT_USER_SETTINGS },
      (result) => {
        if (chrome.runtime.lastError) {
          console.error("Failed to load settings:", chrome.runtime.lastError);
          return;
        }
        const storedSettings = result.knowwSettings as
          | Partial<UserSettings>
          | undefined;
        const loadedSettings: UserSettings = {
          ...DEFAULT_USER_SETTINGS,
          ...(storedSettings || {}),
          platforms: {
            ...DEFAULT_USER_SETTINGS.platforms,
            ...(storedSettings?.platforms || {}),
          },
          sources: {
            ...DEFAULT_USER_SETTINGS.sources,
            ...(storedSettings?.sources || {}),
          },
        };
        setSettings(loadedSettings);
      }
    );

    // Check if user is logged in
    chrome.runtime.sendMessage({ type: "auth:get-token" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "auth:get-token failed:",
          chrome.runtime.lastError.message
        );
        setHasToken(false);
        return;
      }
      if (response?.ok && response.data) {
        setHasToken(true);
      } else {
        setHasToken(false);
      }
    });
  }, []);

  // Show status message
  const showStatus = useCallback((message: string) => {
    setStatus(message);
    setStatusVisible(true);
    setTimeout(() => setStatusVisible(false), 2000);
  }, []);

  // Save settings
  const saveSettings = useCallback(() => {
    chrome.storage.sync.set({ knowwSettings: settings }, () => {
      showStatus("Settings saved!");

      if (settings.usageAnalyticsEnabled) {
        chrome.runtime.sendMessage({
          type: "analytics:track",
          event: "settings_updated",
          properties: {
            analyticsEnabled: settings.usageAnalyticsEnabled,
            notificationStackEnabled: settings.showNotificationStack,
            aiExtractionEnabled: settings.aiExtractionEnabled,
            personalizationEnabled: settings.personalizationEnabled,
          },
        });
      }

      // Notify content scripts
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id && isSupportedSocialHost(tab.url)) {
            chrome.tabs.sendMessage(
              tab.id,
              {
                type: "KNOWW_SETTINGS_UPDATED",
                settings,
              },
              () => {
                // Check for errors but don't throw - tab might not have content script loaded
                if (chrome.runtime.lastError) {
                  // Silently ignore - this is expected when tab doesn't have content script
                }
              }
            );
          }
        }
      });
    });
  }, [settings, showStatus]);

  // Reset settings
  const resetSettings = useCallback(() => {
    if (confirm("Reset all settings to defaults?")) {
      setSettings(DEFAULT_USER_SETTINGS);
      chrome.storage.sync.set({ knowwSettings: DEFAULT_USER_SETTINGS }, () => {
        showStatus("Settings reset to defaults!");
      });
    }
  }, [showStatus]);

  // Update nested settings
  const updatePlatform = useCallback(
    (platform: keyof UserSettings["platforms"], value: boolean) => {
      setSettings((prev) => ({
        ...prev,
        platforms: { ...prev.platforms, [platform]: value },
      }));
    },
    []
  );

  const updateSource = useCallback(
    (source: keyof UserSettings["sources"], value: boolean) => {
      setSettings((prev) => ({
        ...prev,
        sources: { ...prev.sources, [source]: value },
      }));
    },
    []
  );

  const handleDisconnectWallet = useCallback(() => {
    if (
      confirm(
        "Are you sure you want to disconnect your wallet? You will need to sign in again to trade."
      )
    ) {
      chrome.runtime.sendMessage({ type: "auth:logout" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "auth:logout failed:",
            chrome.runtime.lastError.message
          );
          setHasToken(false);
          return;
        }
        if (response?.ok) {
          chrome.runtime.sendMessage({
            type: "analytics:track",
            event: "options_wallet_disconnected",
            properties: {},
          });
          setHasToken(false);
          showStatus("Wallet disconnected");
        } else {
          console.error("auth:logout returned non-ok response:", response);
          setHasToken(false);
        }
      });
    }
  }, [showStatus]);

  return (
    <div className="container">
      {/* Header */}
      <div className="header">
        <div className="logo">
          {/* biome-ignore lint/performance/noImgElement: Not a Next.js app */}
          <img src="icons/icon-256.png" alt="Knoww Logo" />
        </div>
        <h1>Knoww Settings</h1>
        <span className="version">v{version}</span>
      </div>

      {/* Platforms Section */}
      <Section title="Platforms">
        {PLATFORM_OPTIONS.map((platform, index) => (
          <Fragment key={platform.key}>
            <SettingRow
              label={platform.label}
              description={platform.description}
              icon={platform.icon}
            >
              <Toggle
                id={`platform-${platform.key}`}
                checked={settings.platforms[platform.key]}
                onChange={(v) => updatePlatform(platform.key, v)}
              />
            </SettingRow>
            {index < PLATFORM_OPTIONS.length - 1 && <Divider />}
          </Fragment>
        ))}
      </Section>

      {/* Market Sources Section */}
      <Section title="Market Sources">
        <SettingRow
          label="Polymarket"
          description="Show markets from Polymarket"
          icon="P"
          iconClass="source-icon polymarket"
        >
          <Toggle
            id="source-polymarket"
            checked={settings.sources.polymarket}
            onChange={(v) => updateSource("polymarket", v)}
          />
        </SettingRow>

        <Divider />

        <SettingRow
          label="Kalshi"
          description="Show markets from Kalshi"
          icon="K"
          iconClass="source-icon kalshi"
        >
          <Toggle
            id="source-kalshi"
            checked={settings.sources.kalshi}
            onChange={(v) => updateSource("kalshi", v)}
          />
        </SettingRow>
      </Section>

      {/* Display Settings Section */}
      <Section title="Display Settings">
        <SettingRow
          label="Relevance Threshold"
          description={
            settings.relevanceThreshold <= 0.3
              ? "Shows more markets, but some might be loosely related to the post."
              : settings.relevanceThreshold >= 0.6
                ? "Shows fewer markets, but they will be highly accurate matches."
                : "Balanced: Shows a good mix of relevant markets."
          }
        >
          <div className="range-container">
            <input
              type="range"
              id="relevance-threshold"
              min="0.1"
              max="0.7"
              step="0.05"
              value={settings.relevanceThreshold}
              onInput={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  relevanceThreshold: parseFloat(
                    (e.target as HTMLInputElement).value
                  ),
                }))
              }
            />
            <span className="range-value" id="relevance-value">
              {settings.relevanceThreshold.toFixed(2)}
            </span>
          </div>
        </SettingRow>

        <Divider />

        <SettingRow
          label="Injection Frequency"
          description="Check for markets every N posts (lower = more frequent)"
        >
          <input
            type="number"
            id="cooldown-posts"
            min="1"
            max="20"
            value={settings.cooldownPosts}
            onChange={(e) => {
              let value = parseInt((e.target as HTMLInputElement).value, 10);
              if (Number.isNaN(value) || value < 1) value = 1;
              if (value > 20) value = 20;
              setSettings((prev) => ({ ...prev, cooldownPosts: value }));
            }}
          />
        </SettingRow>

        <Divider />

        <SettingRow
          label="Show Notification Panel"
          description='Display the floating "Markets" panel on the right side'
        >
          <Toggle
            id="show-notification-stack"
            checked={settings.showNotificationStack}
            onChange={(v) =>
              setSettings((prev) => ({ ...prev, showNotificationStack: v }))
            }
          />
        </SettingRow>

        <Divider />

        <SettingRow
          label="AI-Assisted Matching"
          description="When a market scores high but lacks keyword overlap, use AI to verify relevance"
        >
          <Toggle
            id="ai-extraction-enabled"
            checked={settings.aiExtractionEnabled}
            onChange={(v) =>
              setSettings((prev) => ({ ...prev, aiExtractionEnabled: v }))
            }
          />
        </SettingRow>

        <Divider />

        <SettingRow
          label="Personalization"
          description="Learn from your clicks to surface more relevant markets over time"
        >
          <Toggle
            id="personalization-enabled"
            checked={settings.personalizationEnabled}
            onChange={(v) =>
              setSettings((prev) => ({ ...prev, personalizationEnabled: v }))
            }
          />
        </SettingRow>
      </Section>

      {/* Wallet & Security Section */}
      <Section title="Wallet & Security">
        <SettingRow
          label="Trading Session"
          description={
            hasToken
              ? "Your wallet is currently connected for trading."
              : "No wallet connected. Connect via the inline trading panel on any supported site."
          }
        >
          {hasToken ? (
            <button
              type="button"
              className="reset-link"
              style={{ marginTop: 0, fontSize: "13px", color: "#e91e63" }}
              onClick={handleDisconnectWallet}
            >
              Disconnect
            </button>
          ) : (
            <span style={{ fontSize: "13px", color: "#888" }}>
              Disconnected
            </span>
          )}
        </SettingRow>
      </Section>

      {/* Advanced Section */}
      <Section title="Advanced">
        <SettingRow
          label="Theme"
          description="Override automatic theme detection"
        >
          <select
            id="theme-override"
            value={settings.themeOverride}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                themeOverride: (e.target as HTMLSelectElement)
                  .value as UserSettings["themeOverride"],
              }))
            }
          >
            <option value="auto">Auto-detect</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="dim">Dim (Twitter)</option>
          </select>
        </SettingRow>

        <Divider />

        <SettingRow
          label="Usage Analytics"
          description="Help us measure extension usage with anonymous product events. Raw page text is not sent."
        >
          <Toggle
            id="usage-analytics-enabled"
            checked={settings.usageAnalyticsEnabled}
            onChange={(v) =>
              setSettings((prev) => ({ ...prev, usageAnalyticsEnabled: v }))
            }
          />
        </SettingRow>

        <Divider />

        <SettingRow
          label="Debug Mode"
          description="Enable console logging for troubleshooting"
        >
          <Toggle
            id="debug-mode"
            checked={settings.debugMode}
            onChange={(v) => setSettings((prev) => ({ ...prev, debugMode: v }))}
          />
        </SettingRow>

        <Divider />

        <SettingRow
          label="Reset Personalization"
          description="Clear all learned preferences and start fresh"
        >
          <button
            type="button"
            className="reset-link"
            style={{ marginTop: 0, fontSize: "13px" }}
            onClick={() => {
              if (
                confirm(
                  "Clear all personalization data? This cannot be undone."
                )
              ) {
                chrome.storage.local.remove("knowwPreferences", () => {
                  showStatus("Personalization data cleared!");
                  chrome.tabs.query({}, (tabs) => {
                    for (const tab of tabs) {
                      if (tab.id && isSupportedSocialHost(tab.url)) {
                        chrome.tabs.sendMessage(
                          tab.id,
                          { type: "KNOWW_PREFERENCES_RESET" },
                          () => {
                            if (chrome.runtime.lastError) {
                              // Expected when tab doesn't have content script
                            }
                          }
                        );
                      }
                    }
                  });
                });
              }
            }}
          >
            Clear Data
          </button>
        </SettingRow>
      </Section>

      {/* Save Button */}
      <div className="save-container">
        <span
          className={`status ${statusVisible ? "visible" : ""}`}
          id="status"
        >
          {status}
        </span>
        <button
          type="button"
          className="save-btn"
          id="save-btn"
          onClick={saveSettings}
        >
          Save Settings
        </button>
      </div>

      <button
        type="button"
        className="reset-link"
        id="reset-btn"
        onClick={resetSettings}
      >
        Reset to defaults
      </button>
    </div>
  );
}

// Mount the app
let container = document.getElementById("app");
if (!container) {
  container = document.createElement("div");
  container.id = "app";
  document.body.appendChild(container);
}
createRoot(container).render(<OptionsApp />);
