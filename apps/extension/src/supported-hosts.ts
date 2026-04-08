/**
 * Single source of truth for all supported platform URL match patterns.
 *
 * Used by the background service worker to programmatically register
 * content scripts only on supported sites (via chrome.scripting API).
 *
 * When adding a new platform adapter, add its URL patterns here.
 * The content script itself still uses hostPatterns regexes for
 * fine-grained adapter detection at runtime.
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

  // Threads
  "https://threads.com/*",
  "https://www.threads.com/*",

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
];
