/**
 * Single source of truth for all supported platform URL match patterns.
 *
 * Used by the background service worker to programmatically register
 * content scripts only on supported sites (via chrome.scripting API).
 *
 * When adding a new platform adapter, add its URL patterns here.
 * The content script itself still uses hostPatterns regexes for
 * fine-grained adapter detection at runtime.
 *
 * NOTE: These patterns are also consumed by webpack.config.js at build
 * time to generate the manifest's `host_permissions` array (union of
 * content-script sites + API domains). Keep this file importable by
 * both TypeScript (background SW) and plain Node (webpack).
 */
export const SUPPORTED_MATCH_PATTERNS: string[] = [
  // Twitter / X
  "https://x.com/*",
  "https://twitter.com/*",

  // LinkedIn
  "https://www.linkedin.com/*",

  // Reddit
  "https://www.reddit.com/*",
  "https://reddit.com/*",
  "https://old.reddit.com/*",
  "https://new.reddit.com/*",

  // Quora
  "https://www.quora.com/*",
  "https://quora.com/*",

  // Hacker News
  "https://news.ycombinator.com/*",

  // Stack Overflow
  "https://stackoverflow.com/*",
  "https://*.stackoverflow.com/*",

  // Stack Exchange network (disabled — not enough market coverage yet)
  // "https://*.stackexchange.com/*",
  // "https://superuser.com/*",
  // "https://*.superuser.com/*",
  // "https://serverfault.com/*",
  // "https://*.serverfault.com/*",
  // "https://askubuntu.com/*",
  // "https://*.askubuntu.com/*",
  // "https://mathoverflow.net/*",
  // "https://*.mathoverflow.net/*",
  // "https://stackapps.com/*",
  // "https://*.stackapps.com/*",

  // Product Hunt
  "https://www.producthunt.com/*",
  "https://producthunt.com/*",

  // Slashdot
  "https://slashdot.org/*",
  "https://*.slashdot.org/*",

  // Lemmy instances
  "https://lemmy.world/*",
  "https://lemmy.ml/*",
  "https://sh.itjust.works/*",
  "https://programming.dev/*",
  "https://beehaw.org/*",
  "https://feddit.org/*",
  "https://lemm.ee/*",

  // Threads (.net redirects to .com but cover both for cached/slow redirects)
  "https://threads.com/*",
  "https://www.threads.com/*",
  "https://threads.net/*",
  "https://www.threads.net/*",

  // Bluesky
  "https://bsky.app/*",

  // Mastodon instances
  "https://mastodon.social/*",
  "https://mstdn.social/*",
  "https://fosstodon.org/*",
  "https://hachyderm.io/*",
  "https://mas.to/*",
  "https://infosec.exchange/*",

  // Discord
  "https://discord.com/*",
  "https://ptb.discord.com/*",
  "https://canary.discord.com/*",

  // Farcaster
  "https://farcaster.xyz/*",
  "https://www.farcaster.xyz/*",

  // CoinMarketCap Community
  "https://coinmarketcap.com/*",
  "https://www.coinmarketcap.com/*",

  // Paragraph
  "https://paragraph.com/*",
  "https://*.paragraph.com/*",

  // Crypto media
  "https://coindesk.com/*",
  "https://www.coindesk.com/*",
  "https://cointelegraph.com/*",
  "https://www.cointelegraph.com/*",
  "https://decrypt.co/*",
  "https://www.decrypt.co/*",
  "https://theblock.co/*",
  "https://www.theblock.co/*",
  "https://blockworks.com/*",
  "https://www.blockworks.com/*",
  "https://bankless.com/*",
  "https://www.bankless.com/*",
  "https://bitcoinmagazine.com/*",
  "https://www.bitcoinmagazine.com/*",
  "https://beincrypto.com/*",
  "https://www.beincrypto.com/*",
  "https://unchainedcrypto.com/*",
  "https://www.unchainedcrypto.com/*",
  "https://cryptopanic.com/*",
  "https://www.cryptopanic.com/*",

  // Extended community / forum support
  // NOTE: tildes.net was removed because extended-community.ts has no
  // inline-card injection path for it — users would see the extension
  // listed as "enabled" with zero visible output. Re-add when we ship a
  // real Tildes adapter.
  "https://soylentnews.org/*",

  // Extended tech / news / finance / sports support
  "https://techcrunch.com/*",
  "https://www.wired.com/*",
  "https://www.theverge.com/*",
  "https://arstechnica.com/*",
  "https://www.engadget.com/*",
  "https://gizmodo.com/*",
  "https://9to5mac.com/*",
  "https://9to5google.com/*",
  "https://www.macrumors.com/*",
  "https://www.reuters.com/*",
  "https://apnews.com/*",
  "https://bbc.com/*",
  "https://www.bbc.com/*",
  "https://www.aljazeera.com/*",
  "https://www.theguardian.com/*",
  "https://www.politico.com/*",
  "https://www.axios.com/*",
  "https://ft.com/*",
  "https://www.ft.com/*",
  "https://www.bloomberg.com/*",
  "https://www.marketwatch.com/*",
  "https://www.investing.com/*",
  "https://seekingalpha.com/*",
  "https://finance.yahoo.com/*",
  "https://www.zerohedge.com/*",
  "https://dlnews.com/*",
  "https://www.dlnews.com/*",
  "https://www.nytimes.com/*",
  "https://www.wsj.com/*",
  "https://www.washingtonpost.com/*",
  "https://www.cnn.com/*",
  "https://edition.cnn.com/*",
  "https://www.usatoday.com/*",
  "https://time.com/*",
  "https://www.theatlantic.com/*",
  "https://*.indiatimes.com/*",
  "https://timesofindialive.com/*",
  "https://www.timesofindialive.com/*",
  "https://indianexpress.com/*",
  "https://thehindu.com/*",
  "https://www.thehindu.com/*",
  "https://hindustantimes.com/*",
  "https://www.hindustantimes.com/*",
  "https://cnbc.com/*",
  "https://www.cnbc.com/*",
  "https://www.forbes.com/*",
  "https://www.espn.com/*",
  "https://www.espn.in/*",
  "https://www.skysports.com/*",
  "https://www.sportingnews.com/*",
  "https://www.cbssports.com/*",
  "https://www.foxsports.com/*",
  "https://www.cnet.com/*",
  "https://www.zdnet.com/*",
  "https://www.pcworld.com/*",
  "https://www.tomshardware.com/*",

  // Prediction / market-native support
  "https://kalshi.com/*",
  "https://www.kalshi.com/*",
  "https://manifold.markets/*",
  "https://www.metaculus.com/*",
  "https://www.tradingview.com/*",
  "https://defillama.com/*",
];

/**
 * API domains the background service worker needs to reach directly.
 * These are added to `host_permissions` in addition to the content-script
 * site patterns so the browser enforces a scoped allowlist instead of
 * the overly broad `<all_urls>`.
 */
export const API_HOST_PERMISSIONS: string[] = [
  // Polymarket APIs
  "https://gamma-api.polymarket.com/*",
  "https://clob.polymarket.com/*",
  "https://data-api.polymarket.com/*",
  // Keep in sync with RELAYER_API_HOST_PERMISSION in @knoww/shared-types/polymarket.
  // webpack.config.js reads this file with a regex and cannot resolve imports.
  "https://relayer-v2.polymarket.com/*",
  "https://user-pnl-api.polymarket.com/*",

  // Polygon RPC
  "https://polygon-bor-rpc.publicnode.com/*",

  // WalletConnect / Reown mobile wallet pairing
  "https://*.walletconnect.com/*",
  "https://*.walletconnect.org/*",
  "https://*.reown.com/*",

  // Kalshi API
  "https://api.elections.kalshi.com/*",

  // Knoww backend
  "https://knoww.app/*",

  // HuggingFace model downloads (embedding model ONNX weights)
  "https://huggingface.co/*",
  "https://*.huggingface.co/*",
];
