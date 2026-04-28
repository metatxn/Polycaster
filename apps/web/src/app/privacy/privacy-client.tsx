"use client";

import Link from "next/link";
import { KnowwMark } from "@/components/knoww-mark";
import {
  KW_PAGE_CLASS,
  KwThemeToggle,
  useKwTheme,
} from "@/components/kw-theme";

const LAST_UPDATED = "April 10, 2026";

const SECTIONS = [
  { id: "overview", title: "Overview", roman: "i" },
  { id: "what-we-collect", title: "Information we collect", roman: "ii" },
  { id: "how-we-use", title: "How we use information", roman: "iii" },
  { id: "sharing", title: "Sharing & third parties", roman: "iv" },
  {
    id: "extension",
    title: "Knoww Extension — additional details",
    roman: "v",
  },
  {
    id: "cookies",
    title: "Storage, cookies & similar technologies",
    roman: "vi",
  },
  { id: "security", title: "Security", roman: "vii" },
  { id: "retention", title: "Data retention", roman: "viii" },
  { id: "your-rights", title: "Your choices & rights", roman: "ix" },
  { id: "children", title: "Children\u2019s privacy", roman: "x" },
  { id: "changes", title: "Changes to this policy", roman: "xi" },
  { id: "contact", title: "Contact", roman: "xii" },
] as const;

const PAGE_COUNT = SECTIONS.length;

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Section({
  id,
  title,
  roman,
  index,
  children,
}: {
  id: string;
  title: string;
  roman: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="kw-reveal scroll-mt-24 pt-16 first:pt-0 border-t border-(--kw-fg)/10 first:border-t-0"
    >
      <div className="flex items-baseline justify-between gap-4 pb-5 mb-8 border-b border-(--kw-fg)/10">
        <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
          § {roman}. {title}
        </h2>
        <span className="shrink-0 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/45 tabular-nums">
          {String(index).padStart(2, "0")} /{" "}
          {String(PAGE_COUNT).padStart(2, "0")}
        </span>
      </div>
      <div className="kw-legal">{children}</div>
    </section>
  );
}

export default function PrivacyClient() {
  const { theme, toggleTheme } = useKwTheme();

  return (
    <div
      className={`${KW_PAGE_CLASS} fixed inset-0 z-60 overflow-y-auto bg-(--kw-bg) text-(--kw-fg) font-sans`}
      data-theme={theme}
      style={{ colorScheme: theme }}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="border-b border-(--kw-fg)/10 bg-(--kw-bg)">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <KnowwMark />
              <span className="font-bold text-[15px] tracking-tight">
                Knoww
              </span>
            </Link>
            <span className="hidden md:inline-block text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/55 border-l border-(--kw-fg)/10 pl-6">
              Document · Privacy
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-[13px] text-(--kw-fg)/70 hover:text-(--kw-fg) transition-colors"
            >
              ← Back to home
            </Link>
            <KwThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="border-b border-(--kw-fg)/10">
        <div className="max-w-[1200px] mx-auto px-6 pt-20 md:pt-24 pb-16">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-10">
            <span className="w-1.5 h-1.5 bg-(--kw-accent) animate-pulse" />
            Issue № 01 — An editorial document
          </div>

          <h1 className="font-bold tracking-[-0.035em] leading-[0.95] text-[52px] sm:text-[72px] md:text-[88px] lg:text-[96px] mb-10 max-w-[960px]">
            On <span className="italic kw-editorial kw-tilt">privacy</span>
            ,<br />
            <span className="text-(--kw-fg)/55">and what we keep.</span>
          </h1>

          <p className="text-[17px] text-(--kw-fg)/75 max-w-[620px] leading-[1.55] mb-10">
            This policy explains how{" "}
            <strong className="text-(--kw-fg)">Knoww</strong>{" "}
            (&ldquo;Knoww,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) handles
            information when you use our web app at{" "}
            <a
              href="https://knoww.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-(--kw-accent-text) underline underline-offset-[3px] decoration-(--kw-accent)/40 hover:decoration-(--kw-accent)"
            >
              knoww.app
            </a>{" "}
            and our Chrome extension.
          </p>

          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pt-5 border-t border-(--kw-fg)/10 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
            <span>
              Last updated —{" "}
              <span className="kw-editorial italic normal-case tracking-normal text-[13px] text-(--kw-fg)/85">
                {LAST_UPDATED}
              </span>
            </span>
            <span className="text-(--kw-fg)/30">·</span>
            <span>{PAGE_COUNT} sections</span>
            <span className="text-(--kw-fg)/30">·</span>
            <span>≈ 6 minutes to read</span>
          </div>
        </div>
      </section>

      {/* ── Body with sticky TOC ────────────────────────────────────── */}
      <main>
        <div className="max-w-[1200px] mx-auto px-6 py-16 md:py-20 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-12 lg:gap-20">
          {/* TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-6">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4 pb-3 border-b border-(--kw-fg)/15">
                § Contents
              </div>
              <ol className="space-y-3">
                {SECTIONS.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-2.5">
                    <span className="kw-editorial italic text-[13px] text-(--kw-fg)/45 w-6 shrink-0 leading-none">
                      {s.roman}
                    </span>
                    <Link
                      href={`#${s.id}`}
                      className="text-[12px] text-(--kw-fg)/70 hover:text-(--kw-fg) transition-colors leading-[1.45]"
                    >
                      {s.title}
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          {/* Content */}
          <div>
            <Section id="overview" title="Overview" roman="i" index={1}>
              <p>
                Knoww is a product that helps you discover and interact with
                prediction markets (including markets provided by third parties)
                and related information. The Web App may connect to blockchain
                wallets, display data associated with public blockchain
                addresses, and provide trading- and comment-related features
                that rely on third-party market providers.
              </p>
              <p>
                The Extension enhances supported social websites by detecting
                topics in on-screen content and surfacing potentially relevant
                markets. Depending on your settings and the feature being used,
                the Extension may process page content locally, store local
                relevance/personalization data, send excerpts of content to
                Knoww for AI-assisted matching, and make network requests to
                market data providers to retrieve results.
              </p>
            </Section>

            <Section
              id="what-we-collect"
              title="Information we collect"
              roman="ii"
              index={2}
            >
              <p className="kw-legal-sub">Information you provide</p>
              <ul>
                <li>
                  <strong>Wallet information</strong>: if you connect a wallet
                  in the Web App, we and our wallet connectivity providers may
                  receive your public wallet address and related connection
                  metadata.
                </li>
                <li>
                  <strong>Comments and other submitted content</strong>: if you
                  post a comment or otherwise submit content through Knoww, we
                  process the content you submit and the wallet-authentication
                  data needed to send it to the relevant provider.
                </li>
                <li>
                  <strong>Support communications</strong>: if you contact us,
                  you may provide your email address and the contents of your
                  message.
                </li>
              </ul>

              <p className="kw-legal-sub">
                Information collected automatically
              </p>
              <ul>
                <li>
                  <strong>Usage and device data</strong>: standard log data such
                  as IP address, browser type, pages viewed, and timestamps may
                  be processed by our hosting, infrastructure, analytics, and
                  wallet connectivity providers.
                </li>
                <li>
                  <strong>Product analytics and diagnostics</strong>: the Web
                  App may capture feature-usage events, wallet-related action
                  metadata, market identifiers/titles, and client error or
                  exception diagnostics through analytics tooling when enabled
                  in our deployment configuration.
                </li>
                <li>
                  <strong>
                    Local app state, cookies, and similar technologies
                  </strong>
                  : the Web App stores certain preferences, wallet connection
                  state, and session state in your browser (see &ldquo;Storage,
                  Cookies &amp; Similar Technologies&rdquo;).
                </li>
              </ul>

              <p className="kw-legal-sub">
                Information processed by the Extension
              </p>
              <ul>
                <li>
                  <strong>On-page text content</strong> from supported sites may
                  be read and processed to extract keywords and topics for
                  market discovery. This is used to determine what market data
                  queries to run.
                </li>
                <li>
                  <strong>Extension settings and local preference data</strong>{" "}
                  (for example enabled platforms/sources, learned click/ignore
                  preferences, local caches, and similar state) are stored using
                  Chrome extension storage and related browser storage.
                </li>
                <li>
                  <strong>Extension session and trading state</strong>: if you
                  use wallet-connected extension features, the Extension may
                  store short-lived extension session tokens and trading-related
                  credentials/state in extension storage for the current browser
                  session.
                </li>
                <li>
                  <strong>Extension usage analytics</strong>: if enabled in the
                  Extension settings, we may collect product analytics such as
                  extension startup, supported-site detection, market card
                  impressions and clicks, trading panel opens, settings changes,
                  platform name, host, and page URL/path. We do not design these
                  analytics events to include raw page text or full page
                  content.
                </li>
                <li>
                  <strong>AI-assisted matching inputs</strong>: if AI-assisted
                  matching is enabled in the Extension, normalized or truncated
                  excerpts of page text and market titles/tags may be sent to
                  Knoww APIs so we can extract topics or validate market
                  relevance.
                </li>
              </ul>
            </Section>

            <Section
              id="how-we-use"
              title="How we use information"
              roman="iii"
              index={3}
            >
              <ul>
                <li>
                  <strong>Provide the product</strong>: operate the Web App,
                  show markets, support comments, and enable wallet-based
                  features.
                </li>
                <li>
                  <strong>Improve and debug</strong>: diagnose issues, monitor
                  errors, protect against abuse, and improve reliability and
                  performance.
                </li>
                <li>
                  <strong>Measure product usage</strong>: understand which
                  features, supported sites, and flows are used so we can
                  prioritize improvements.
                </li>
                <li>
                  <strong>Match markets to content</strong>: analyze text,
                  extract topics, rank candidates, and validate relevance so the
                  Extension can show more useful market suggestions.
                </li>
                <li>
                  <strong>Personalize results</strong>: if personalization is
                  enabled in the Extension, learn from your clicks and ignores
                  to adjust future ranking locally on your device.
                </li>
                <li>
                  <strong>Communicate</strong>: respond to support requests and
                  important updates.
                </li>
              </ul>
            </Section>

            <Section
              id="sharing"
              title="Sharing & third parties"
              roman="iv"
              index={4}
            >
              <p>
                We do not sell your personal information. We may share
                information in the following circumstances:
              </p>
              <ul>
                <li>
                  <strong>Market, trading, and blockchain providers</strong>:
                  Knoww queries third-party services (for example, Polymarket,
                  Kalshi, bridge providers, RPC providers, and related
                  infrastructure) to fetch market information, support trading,
                  route deposits, fetch comments, and read public blockchain
                  data. Requests may include search terms, wallet addresses,
                  signatures, transaction details, or standard network metadata
                  as needed for the feature you use.
                </li>
                <li>
                  <strong>Wallet connectivity providers</strong>: the Web App
                  integrates with wallet connection tooling (for example, Reown
                  / WalletConnect and wallet applications). These services may
                  process connection metadata according to their own policies.
                </li>
                <li>
                  <strong>Analytics providers</strong>: Knoww uses analytics
                  tooling (currently including PostHog) for Web App product
                  analytics, client diagnostics, and Extension analytics if
                  enabled.
                </li>
                <li>
                  <strong>AI providers</strong>: if AI-assisted matching is
                  enabled in the Extension, excerpts of page text and market
                  metadata may be processed by Knoww and AI providers acting on
                  our behalf (currently via OpenRouter and underlying model
                  providers) to extract topics or validate relevance.
                </li>
                <li>
                  <strong>Infrastructure providers</strong>: hosting, caching,
                  networking, and security providers may process standard logs
                  and request metadata to deliver the service.
                </li>
                <li>
                  <strong>Legal and safety</strong>: if required by law or to
                  protect users, the public, or our rights.
                </li>
              </ul>
            </Section>

            <Section
              id="extension"
              title="Knoww Extension — additional details"
              roman="v"
              index={5}
            >
              <p className="kw-legal-sub">Supported sites</p>
              <p>
                The Extension supports a broader set of sites than only X,
                LinkedIn, and Reddit. Current supported platforms include major
                social sites, forums, developer communities, and crypto/news
                properties such as X/Twitter, LinkedIn, Reddit, Quora, Hacker
                News, Stack Overflow / Stack Exchange, Product Hunt, Slashdot,
                supported Lemmy and Mastodon instances, Threads, Bluesky,
                Discord, Farcaster, CoinMarketCap, Paragraph, CoinDesk,
                Cointelegraph, Decrypt, The Block, Blockworks, Bankless, Bitcoin
                Magazine, BeInCrypto, Unchained, and CryptoPanic. The list may
                change over time, and the Extension settings are the best source
                for the latest supported platforms.
              </p>

              <p className="kw-legal-sub">
                What the Extension does with page content
              </p>
              <ul>
                <li>
                  The Extension reads visible content (such as post text) to
                  extract keywords/topics and match relevant markets.
                </li>
                <li>
                  If AI-assisted matching is enabled, the Extension may send
                  normalized or truncated text excerpts and market metadata to
                  Knoww APIs for topic extraction and relevance validation.
                </li>
                <li>
                  The Extension uses those extracted keywords/tags to query
                  market data APIs (e.g., Polymarket and Kalshi) and display
                  results on the page.
                </li>
                <li>
                  The Extension stores user settings using Chrome&rsquo;s{" "}
                  <code>storage</code> permission, and may keep local preference
                  data and local embeddings on-device to improve relevance
                  ranking.
                </li>
                <li>
                  If you enable usage analytics, the Extension sends only
                  product events needed to measure product adoption and feature
                  usage. These events may include host, page URL or path,
                  platform, and feature interaction metadata, but are not
                  designed to include raw page text.
                </li>
              </ul>

              <p className="kw-legal-sub">Data sent to Knoww</p>
              <p>
                The Extension may communicate with{" "}
                <ExternalLink href="https://knoww.app">knoww.app</ExternalLink>{" "}
                to support AI-assisted matching, extension authentication,
                analytics ingestion (if enabled), trading-related features, and
                other Extension-backed functionality. Depending on the feature,
                this may include wallet address, signed authentication messages,
                short-lived session tokens, content excerpts, market metadata,
                and product interaction metadata.
              </p>
            </Section>

            <Section
              id="cookies"
              title="Storage, cookies & similar technologies"
              roman="vi"
              index={6}
            >
              <p>
                The Web App uses browser storage and cookies to keep the app
                usable and remember your preferences. Examples include:
              </p>
              <ul>
                <li>
                  <strong>Theme and accent preferences</strong> stored in{" "}
                  <code>localStorage</code>.
                </li>
                <li>
                  <strong>Trading onboarding completion</strong> stored in{" "}
                  <code>localStorage</code> (per wallet address).
                </li>
                <li>
                  <strong>Trading session state</strong> stored in{" "}
                  <code>localStorage</code> (with expiration).
                </li>
                <li>
                  <strong>API credentials and read-only API keys</strong> stored
                  in <code>sessionStorage</code> and cleared when you close your
                  browser.
                </li>
                <li>
                  <strong>
                    Recent searches, last-viewed markets, alert preferences, and
                    UI state
                  </strong>{" "}
                  stored in browser storage to support search, notifications,
                  and interface preferences.
                </li>
                <li>
                  <strong>Wallet connection state</strong> stored in cookies and
                  related storage used by the wallet connection stack.
                </li>
              </ul>
              <p>
                The Extension also stores settings in{" "}
                <code>chrome.storage.sync</code>, local preferences and some
                analytics queue/state in <code>chrome.storage.local</code>,
                short-lived auth/trading state in{" "}
                <code>chrome.storage.session</code>, and local embeddings /
                caches in browser storage such as <code>IndexedDB</code>.
              </p>
              <p>
                Third parties (such as wallet connectivity, analytics, and
                hosting providers) may use their own cookies or similar
                technologies as part of providing their services.
              </p>
            </Section>

            <Section id="security" title="Security" roman="vii" index={7}>
              <p>
                We use reasonable safeguards designed to protect information. No
                method of transmission or storage is 100% secure, and we cannot
                guarantee absolute security.
              </p>
            </Section>

            <Section
              id="retention"
              title="Data retention"
              roman="viii"
              index={8}
            >
              <p>
                We retain information only for as long as needed for the
                purposes described in this policy, unless a longer retention
                period is required or permitted by law. Some data is stored
                locally in your browser or extension and remains until it is
                cleared or expires; some session data is cleared when the
                browser session ends; and some server-side logs, caches, and
                analytics records may be retained for a limited period as needed
                to operate, secure, and improve the service.
              </p>
            </Section>

            <Section
              id="your-rights"
              title="Your choices & rights"
              roman="ix"
              index={9}
            >
              <ul>
                <li>
                  <strong>Disconnect your wallet</strong>: you can disconnect in
                  the Web App and/or in your wallet provider.
                </li>
                <li>
                  <strong>Disable the Extension</strong>: you can disable or
                  uninstall the Extension at any time in Chrome.
                </li>
                <li>
                  <strong>Disable usage analytics</strong>: you can turn off
                  usage analytics in the Extension settings at any time.
                </li>
                <li>
                  <strong>Disable AI-assisted matching</strong>: you can turn
                  off AI-assisted matching in the Extension settings, which
                  stops those AI requests from the Extension.
                </li>
                <li>
                  <strong>Control local storage</strong>: you can clear site
                  data (local/session storage/cookies) in your browser settings
                  and clear Extension data in Chrome.
                </li>
                <li>
                  <strong>Request help</strong>: contact us to ask questions
                  about this policy or your information.
                </li>
              </ul>
            </Section>

            <Section
              id="children"
              title="Children&rsquo;s privacy"
              roman="x"
              index={10}
            >
              <p>
                Knoww is not intended for children or for people who are not
                legally permitted to use prediction market or trading-related
                products in their jurisdiction. We do not knowingly collect
                personal information from children.
              </p>
            </Section>

            <Section
              id="changes"
              title="Changes to this policy"
              roman="xi"
              index={11}
            >
              <p>
                We may update this policy from time to time. If we make material
                changes, we will update the &ldquo;Last updated&rdquo; date and
                may provide additional notice as appropriate.
              </p>
            </Section>

            <Section id="contact" title="Contact" roman="xii" index={12}>
              <p>
                If you have questions or requests about this Privacy Policy,
                contact us at{" "}
                <a href="mailto:privacy@knoww.app">privacy@knoww.app</a>.
              </p>
            </Section>
          </div>
        </div>
      </main>

      {/* ── Footer (matches landing) ────────────────────────────────── */}
      <footer className="border-t border-(--kw-fg)/10 bg-(--kw-bg-alt)">
        <div className="border-b border-(--kw-fg)/10">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex flex-col md:flex-row md:items-baseline md:justify-between gap-2 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/65">
            <span className="flex items-baseline gap-3">
              <span className="kw-editorial italic normal-case tracking-normal text-[13px] text-(--kw-fg)/80">
                № 01 — Winter 2026
              </span>
              <span className="text-(--kw-fg)/25">·</span>
              <span>A privacy document, issued with the inaugural product</span>
            </span>
            <span>knoww.app</span>
          </div>
        </div>

        <div className="max-w-[1200px] mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-3 gap-8 text-[13px]">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <KnowwMark size="sm" />
              <span className="font-bold text-[14px]">Knoww</span>
            </div>
            <p className="text-[12px] text-(--kw-fg)/60 leading-[1.55] max-w-[220px]">
              A prediction market layer for the{" "}
              <span className="kw-editorial italic text-(--kw-fg)/80">
                open internet
              </span>
              .
            </p>
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4">
              Product
            </div>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/markets"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Markets
                </Link>
              </li>
              <li>
                <a
                  href="https://chromewebstore.google.com/detail/knoww-prediction-markets/naoaonihikedoiemhbolbnolibpmojgf"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Extension
                </a>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4">
              Legal
            </div>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/privacy"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Privacy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-(--kw-fg)/10">
          <div className="max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
            <span>© 2026 Knoww</span>
            <span>Made for the prediction-literate</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
