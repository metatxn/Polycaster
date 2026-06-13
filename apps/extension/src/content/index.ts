// ============================================
// CONTENT SCRIPT ENTRY POINT
// Imports all modules in the correct order to preserve
// global variable initialization dependencies
// ============================================

// Import modules in the same order as manifest.json currently loads them
// This preserves the global variable initialization order (window.KNOWW_*)

// 1. DOM helpers
import "./inserter";

// 2. Configuration (must be early - other modules depend on KNOWW_CONFIG)
import "./config";

// 2.5. Preferences (personalization model — loads from chrome.storage.local)
import "./preferences";

// 3. Utilities (logging, text extraction, etc.)
import "./utils";

// 4. Analytics helpers
import "./analytics";

// 4.5. Local diagnostics (debug-mode only, no production console output)
import "./relevance-telemetry";

// 5. Platform registry (must be before platform adapters)
import "./platform-registry";

// 6. Platform adapters (register themselves with the registry)
import "./platforms/twitter";
import "./platforms/linkedin";
import "./platforms/reddit";
import "./platforms/quora";
import "./platforms/hackernews";
import "./platforms/stackoverflow";
import "./platforms/stackexchange";
import "./platforms/producthunt";
import "./platforms/slashdot";
import "./platforms/lemmy";
import "./platforms/threads";
import "./platforms/bluesky";
import "./platforms/mastodon";
import "./platforms/discord";
import "./platforms/farcaster";
// Streaming surfaces (single companion card, not feed injection)
import "./platforms/twitch";
import "./platforms/coinmarketcap";
import "./platforms/paragraph";
import "./platforms/coindesk";
import "./platforms/cointelegraph";
import "./platforms/decrypt";
import "./platforms/theblock";
import "./platforms/blockworks";
import "./platforms/bankless";
import "./platforms/bitcoinmagazine";
import "./platforms/beincrypto";
import "./platforms/unchained";
import "./platforms/cryptopanic";
import "./platforms/extended-editorial";
import "./platforms/extended-community";
import "./platforms/kalshi-website";
import "./platforms/manifold-markets";
import "./platforms/extended-markets";
import "./platforms/cnn";
import "./platforms/yahoo-finance";
import "./platforms/dlnews";
import "./platforms/nytimes";
import "./platforms/wsj";
import "./platforms/washington-post";
import "./platforms/thehindu";
import "./platforms/hindustan-times";
import "./platforms/cnbc";
import "./platforms/forbes";
import "./platforms/espncricinfo";
import "./platforms/skysports";
import "./platforms/sporting-news";
import "./platforms/fox-sports";
import "./platforms/cnet";
import "./platforms/zdnet";
import "./platforms/tomshardware";

// 7. Kalshi adapter (market source)
import "./kalshi-adapter";

// 8. API functions (search, fetch, scoring)
import "./api";

// 9. Styles injection
import "./styles";

// 10. UI components (card creation, notification stack)
import "./ui";

// 11. Injection logic (feed watching, card injection)
import "./injection";

// 11.5. Streaming surface (single companion card for twitch/youtube/etc.)
import "./streaming/stream-markets";

// 12. Main entry point (starts the extension)
import "./main";
