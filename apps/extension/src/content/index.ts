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

// 4. Platform registry (must be before platform adapters)
import "./platform-registry";

// 5. Platform adapters (register themselves with the registry)
import "./platforms/twitter";
import "./platforms/linkedin";
import "./platforms/reddit";
import "./platforms/quora";

// 6. Kalshi adapter (market source)
import "./kalshi-adapter";

// 7. API functions (search, fetch, scoring)
import "./api";

// 8. Styles injection
import "./styles";

// 9. UI components (card creation, notification stack)
import "./ui";

// 10. Injection logic (feed watching, card injection)
import "./injection";

// 11. Main entry point (starts the extension)
import "./main";
