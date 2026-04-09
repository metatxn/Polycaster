# Extension Permissions Explanation

This document explains why the Knoww extension requires specific permissions.

## Host Permissions

The extension requests permission to access the following specific domains (not all websites):

### Required APIs
- **`https://knoww.app/*`** - Knoww backend API for authentication, analytics, and order signing
- **`https://gamma-api.polymarket.com/*`** - Polymarket market data API (search, tags, events)
- **`https://clob.polymarket.com/*`** - Polymarket trading API (order placement, cancellation)
- **`https://bridge.polymarket.com/*`** - Polymarket bridge API for deposits
- **`https://relayer-v2.polymarket.com/*`** - Polymarket relayer for gasless transactions
- **`https://polygon-bor-rpc.publicnode.com/*`** - Polygon RPC provider for blockchain reads
- **`https://api.elections.kalshi.com/*`** - Kalshi market data API (currently disabled in production)

### Why not `<all_urls>`?

The previous version used `<all_urls>` which grants permission to **all websites**. This:
1. Creates a poor user experience (scary permission warning)
2. Expands attack surface unnecessarily
3. May cause Chrome Web Store rejection

### Content Script Injection

Content scripts are registered **programmatically** using `chrome.scripting` API only on supported platforms (Twitter, Reddit, LinkedIn, etc.). The extension never runs on sites outside this list.

The `web_accessible_resources` section lists all 100+ supported platforms, but these are NOT permission grants - they only specify where the extension's CSS/icons can be loaded.

## Other Permissions

- **`storage`** - Store user settings and analytics queue
- **`offscreen`** - Run ML models (embeddings, BM25) and wallet signing in background
- **`scripting`** - Dynamically register content scripts on supported platforms

## Privacy

- Analytics are **opt-in** (default: enabled, can be disabled in settings)
- No browsing history is collected
- Only market-related events are tracked (card views, trading actions)
- Full privacy policy: https://knoww.app/privacy
