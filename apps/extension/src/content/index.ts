// ============================================
// CONTENT SCRIPT ENTRY POINT
// Imports core modules in the correct order to preserve
// global variable initialization dependencies
// ============================================

// Core modules remain in their established dependency order. Platform
// adapters are loaded lazily by main.ts after user settings are available.

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

// 7. Kalshi adapter (market source)
import "./kalshi-adapter";

// 8. API functions (search, fetch, scoring)
import "./api";

// 9. Styles injection
import "./styles";

// 10. UI components (card creation, notification stack)
import "./ui/index";

// 11. Injection logic (feed watching, card injection)
import "./injection";

// 11.5. Streaming surface (single companion card for twitch/youtube/etc.)
import "./streaming/stream-markets";

// 12. Main entry point (starts the extension)
import "./main";
