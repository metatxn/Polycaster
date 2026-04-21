import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Knoww (knoww.app) and the Knoww Extension.",
};

const LAST_UPDATED = "April 10, 2026";

const sections = [
  { id: "overview", title: "Overview" },
  { id: "what-we-collect", title: "Information We Collect" },
  { id: "how-we-use", title: "How We Use Information" },
  { id: "sharing", title: "Sharing & Third Parties" },
  { id: "extension", title: "Knoww Extension – Additional Details" },
  { id: "cookies", title: "Storage, Cookies & Similar Technologies" },
  { id: "security", title: "Security" },
  { id: "retention", title: "Data Retention" },
  { id: "your-rights", title: "Your Choices & Rights" },
  { id: "children", title: "Children’s Privacy" },
  { id: "changes", title: "Changes to This Policy" },
  { id: "contact", title: "Contact" },
] as const;

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-primary hover:underline underline-offset-4"
    >
      {children}
    </a>
  );
}
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/80">
        {children}
      </div>
    </section>
  );
}
export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
      <PageBackground />
      <Navbar />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-10">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-3 rounded-2xl bg-linear-to-br from-violet-500 to-blue-500 shadow-lg shadow-violet-500/20">
                <Image
                  src="/logo-256x256.png"
                  alt="Knoww"
                  width={28}
                  height={28}
                  className="rounded-md"
                />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  Privacy Policy
                </h1>
                <p className="text-sm text-foreground/70 font-medium">
                  Last updated: {LAST_UPDATED}
                </p>
              </div>
            </div>

            <p className="text-sm text-foreground/75 leading-relaxed max-w-3xl">
              This Privacy Policy explains how <strong>Knoww</strong> (“Knoww,”
              “we,” “us”) handles information when you use our website and web
              app at{" "}
              <ExternalLink href="https://knoww.app">knoww.app</ExternalLink>{" "}
              (the “Web App”) and our Chrome extension <strong>Knoww</strong>{" "}
              (also referred to as the <strong>Knoww Extension</strong>, the
              “Extension”).
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
            <aside className="lg:sticky lg:top-20 lg:self-start">
              <Card className="bg-card/80 backdrop-blur-sm border-border shadow-sm">
                <CardHeader className="py-4">
                  <CardTitle className="text-base">On this page</CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <nav aria-label="Privacy Policy table of contents">
                    <ul className="space-y-1.5 text-sm">
                      {sections.map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`#${s.id}`}
                            className="text-foreground/75 hover:text-foreground hover:underline underline-offset-4"
                          >
                            {s.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </nav>
                </CardContent>
              </Card>
            </aside>

            <Card className="bg-card/80 backdrop-blur-sm border-border shadow-sm">
              <CardContent className="pt-6 space-y-8">
                <Section id="overview" title="Overview">
                  <p>
                    Knoww is a product that helps you discover and interact with
                    prediction markets (including markets provided by third
                    parties) and related information. The Web App may connect to
                    blockchain wallets, display data associated with public
                    blockchain addresses, and provide trading- and comment-
                    related features that rely on third-party market providers.
                  </p>
                  <p>
                    The Extension enhances supported social websites by
                    detecting topics in on-screen content and surfacing
                    potentially relevant markets. Depending on your settings and
                    the feature being used, the Extension may process page
                    content locally, store local relevance/personalization data,
                    send excerpts of content to Knoww for AI-assisted matching,
                    and make network requests to market data providers to
                    retrieve results.
                  </p>
                </Section>

                <Section id="what-we-collect" title="Information We Collect">
                  <div className="space-y-2">
                    <p className="font-semibold text-foreground">
                      Information you provide
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>
                        <strong>Wallet information</strong>: if you connect a
                        wallet in the Web App, we and our wallet connectivity
                        providers may receive your public wallet address and
                        related connection metadata.
                      </li>
                      <li>
                        <strong>Comments and other submitted content</strong>:
                        if you post a comment or otherwise submit content
                        through Knoww, we process the content you submit and the
                        wallet-authentication data needed to send it to the
                        relevant provider.
                      </li>
                      <li>
                        <strong>Support communications</strong>: if you contact
                        us, you may provide your email address and the contents
                        of your message.
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="font-semibold text-foreground">
                      Information collected automatically
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>
                        <strong>Usage and device data</strong>: standard log
                        data such as IP address, browser type, pages viewed, and
                        timestamps may be processed by our hosting,
                        infrastructure, analytics, and wallet connectivity
                        providers.
                      </li>
                      <li>
                        <strong>Product analytics and diagnostics</strong>: the
                        Web App may capture feature-usage events, wallet-related
                        action metadata, market identifiers/titles, and client
                        error or exception diagnostics through analytics tooling
                        when enabled in our deployment configuration.
                      </li>
                      <li>
                        <strong>
                          Local app state, cookies, and similar technologies
                        </strong>
                        : the Web App stores certain preferences, wallet
                        connection state, and session state in your browser (see
                        “Storage, Cookies & Similar Technologies”).
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="font-semibold text-foreground">
                      Information processed by the Extension
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>
                        <strong>On-page text content</strong> from supported
                        sites may be read and processed to extract keywords and
                        topics for market discovery. This is used to determine
                        what market data queries to run.
                      </li>
                      <li>
                        <strong>
                          Extension settings and local preference data
                        </strong>{" "}
                        (for example enabled platforms/sources, learned
                        click/ignore preferences, local caches, and similar
                        state) are stored using Chrome extension storage and
                        related browser storage.
                      </li>
                      <li>
                        <strong>Extension session and trading state</strong>: if
                        you use wallet-connected extension features, the
                        Extension may store short-lived extension session tokens
                        and trading-related credentials/state in extension
                        storage for the current browser session.
                      </li>
                      <li>
                        <strong>Extension usage analytics</strong>: if enabled
                        in the Extension settings, we may collect product
                        analytics such as extension startup, supported-site
                        detection, market card impressions and clicks, trading
                        panel opens, settings changes, platform name, host, and
                        page URL/path. We do not design these analytics events
                        to include raw page text or full page content.
                      </li>
                      <li>
                        <strong>AI-assisted matching inputs</strong>: if
                        AI-assisted matching is enabled in the Extension,
                        normalized or truncated excerpts of page text and market
                        titles/tags may be sent to Knoww APIs so we can extract
                        topics or validate market relevance.
                      </li>
                    </ul>
                  </div>
                </Section>

                <Section id="how-we-use" title="How We Use Information">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <strong>Provide the product</strong>: operate the Web App,
                      show markets, support comments, and enable wallet-based
                      features.
                    </li>
                    <li>
                      <strong>Improve and debug</strong>: diagnose issues,
                      monitor errors, protect against abuse, and improve
                      reliability and performance.
                    </li>
                    <li>
                      <strong>Measure product usage</strong>: understand which
                      features, supported sites, and flows are used so we can
                      prioritize improvements.
                    </li>
                    <li>
                      <strong>Match markets to content</strong>: analyze text,
                      extract topics, rank candidates, and validate relevance so
                      the Extension can show more useful market suggestions.
                    </li>
                    <li>
                      <strong>Personalize results</strong>: if personalization
                      is enabled in the Extension, learn from your clicks and
                      ignores to adjust future ranking locally on your device.
                    </li>
                    <li>
                      <strong>Communicate</strong>: respond to support requests
                      and important updates.
                    </li>
                  </ul>
                </Section>

                <Section id="sharing" title="Sharing & Third Parties">
                  <p>
                    We do not sell your personal information. We may share
                    information in the following circumstances:
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <strong>Market, trading, and blockchain providers</strong>
                      : Knoww queries third-party services (for example,
                      Polymarket, Kalshi, bridge providers, RPC providers, and
                      related infrastructure) to fetch market information,
                      support trading, route deposits, fetch comments, and read
                      public blockchain data. Requests may include search terms,
                      wallet addresses, signatures, transaction details, or
                      standard network metadata as needed for the feature you
                      use.
                    </li>
                    <li>
                      <strong>Wallet connectivity providers</strong>: the Web
                      App integrates with wallet connection tooling (for
                      example, Reown / WalletConnect and wallet applications).
                      These services may process connection metadata according
                      to their own policies.
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
                      metadata may be processed by Knoww and AI providers acting
                      on our behalf (currently via OpenRouter and underlying
                      model providers) to extract topics or validate relevance.
                    </li>
                    <li>
                      <strong>Infrastructure providers</strong>: hosting,
                      caching, networking, and security providers may process
                      standard logs and request metadata to deliver the service.
                    </li>
                    <li>
                      <strong>Legal and safety</strong>: if required by law or
                      to protect users, the public, or our rights.
                    </li>
                  </ul>
                </Section>

                <Section
                  id="extension"
                  title="Knoww Extension – Additional Details"
                >
                  <p className="font-semibold text-foreground">
                    Supported sites
                  </p>
                  <p>
                    The Extension supports a broader set of sites than only X,
                    LinkedIn, and Reddit. Current supported platforms include
                    major social sites, forums, developer communities, and
                    crypto/news properties such as X/Twitter, LinkedIn, Reddit,
                    Quora, Hacker News, Stack Overflow / Stack Exchange, Product
                    Hunt, Slashdot, supported Lemmy and Mastodon instances,
                    Threads, Bluesky, Discord, Farcaster, CoinMarketCap,
                    Paragraph, CoinDesk, Cointelegraph, Decrypt, The Block,
                    Blockworks, Bankless, Bitcoin Magazine, BeInCrypto,
                    Unchained, and CryptoPanic. The list may change over time,
                    and the Extension settings are the best source for the
                    latest supported platforms.
                  </p>

                  <p className="font-semibold text-foreground mt-3">
                    What the Extension does with page content
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      The Extension reads visible content (such as post text) to
                      extract keywords/topics and match relevant markets.
                    </li>
                    <li>
                      If AI-assisted matching is enabled, the Extension may send
                      normalized or truncated text excerpts and market metadata
                      to Knoww APIs for topic extraction and relevance
                      validation.
                    </li>
                    <li>
                      The Extension uses those extracted keywords/tags to query
                      market data APIs (e.g., Polymarket and Kalshi) and display
                      results on the page.
                    </li>
                    <li>
                      The Extension stores user settings using Chrome’s{" "}
                      <code className="font-mono text-xs">storage</code>{" "}
                      permission, and may keep local preference data and local
                      embeddings on-device to improve relevance ranking.
                    </li>
                    <li>
                      If you enable usage analytics, the Extension sends only
                      product events needed to measure product adoption and
                      feature usage. These events may include host, page URL or
                      path, platform, and feature interaction metadata, but are
                      not designed to include raw page text.
                    </li>
                  </ul>

                  <p className="font-semibold text-foreground mt-3">
                    Data sent to Knoww
                  </p>
                  <p>
                    The Extension may communicate with{" "}
                    <ExternalLink href="https://knoww.app">
                      knoww.app
                    </ExternalLink>{" "}
                    to support AI-assisted matching, extension authentication,
                    analytics ingestion (if enabled), trading-related features,
                    and other Extension-backed functionality. Depending on the
                    feature, this may include wallet address, signed
                    authentication messages, short-lived session tokens, content
                    excerpts, market metadata, and product interaction metadata.
                  </p>
                </Section>

                <Section
                  id="cookies"
                  title="Storage, Cookies & Similar Technologies"
                >
                  <p>
                    The Web App uses browser storage and cookies to keep the app
                    usable and remember your preferences. Examples include:
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <strong>Theme and accent preferences</strong> stored in{" "}
                      <code className="font-mono text-xs">localStorage</code>.
                    </li>
                    <li>
                      <strong>Trading onboarding completion</strong> stored in{" "}
                      <code className="font-mono text-xs">localStorage</code>{" "}
                      (per wallet address).
                    </li>
                    <li>
                      <strong>Trading session state</strong> stored in{" "}
                      <code className="font-mono text-xs">localStorage</code>{" "}
                      (with expiration).
                    </li>
                    <li>
                      <strong>API credentials and read-only API keys</strong>{" "}
                      stored in{" "}
                      <code className="font-mono text-xs">sessionStorage</code>{" "}
                      and cleared when you close your browser.
                    </li>
                    <li>
                      <strong>
                        Recent searches, last-viewed markets, alert preferences,
                        and UI state
                      </strong>{" "}
                      stored in browser storage to support search,
                      notifications, and interface preferences.
                    </li>
                    <li>
                      <strong>Wallet connection state</strong> stored in cookies
                      and related storage used by the wallet connection stack.
                    </li>
                  </ul>
                  <p>
                    The Extension also stores settings in{" "}
                    <code className="font-mono text-xs">
                      chrome.storage.sync
                    </code>
                    , local preferences and some analytics queue/state in{" "}
                    <code className="font-mono text-xs">
                      chrome.storage.local
                    </code>
                    , short-lived auth/trading state in{" "}
                    <code className="font-mono text-xs">
                      chrome.storage.session
                    </code>
                    , and local embeddings/caches in browser storage such as{" "}
                    <code className="font-mono text-xs">IndexedDB</code>.
                  </p>
                  <p>
                    Third parties (such as wallet connectivity, analytics, and
                    hosting providers) may use their own cookies or similar
                    technologies as part of providing their services.
                  </p>
                </Section>

                <Section id="security" title="Security">
                  <p>
                    We use reasonable safeguards designed to protect
                    information. No method of transmission or storage is 100%
                    secure, and we cannot guarantee absolute security.
                  </p>
                </Section>

                <Section id="retention" title="Data Retention">
                  <p>
                    We retain information only for as long as needed for the
                    purposes described in this policy, unless a longer retention
                    period is required or permitted by law. Some data is stored
                    locally in your browser or extension and remains until it is
                    cleared or expires; some session data is cleared when the
                    browser session ends; and some server-side logs, caches, and
                    analytics records may be retained for a limited period as
                    needed to operate, secure, and improve the service.
                  </p>
                </Section>

                <Section id="your-rights" title="Your Choices & Rights">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <strong>Disconnect your wallet</strong>: you can
                      disconnect in the Web App and/or in your wallet provider.
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
                      <strong>Disable AI-assisted matching</strong>: you can
                      turn off AI-assisted matching in the Extension settings,
                      which stops those AI requests from the Extension.
                    </li>
                    <li>
                      <strong>Control local storage</strong>: you can clear site
                      data (local/session storage/cookies) in your browser
                      settings and clear Extension data in Chrome.
                    </li>
                    <li>
                      <strong>Request help</strong>: contact us to ask questions
                      about this policy or your information.
                    </li>
                  </ul>
                </Section>

                <Section id="children" title="Children’s Privacy">
                  <p>
                    Knoww is not intended for children or for people who are not
                    legally permitted to use prediction market or trading-
                    related products in their jurisdiction. We do not knowingly
                    collect personal information from children.
                  </p>
                </Section>

                <Section id="changes" title="Changes to This Policy">
                  <p>
                    We may update this policy from time to time. If we make
                    material changes, we will update the “Last updated” date and
                    may provide additional notice as appropriate.
                  </p>
                </Section>

                <Section id="contact" title="Contact">
                  <p>
                    If you have questions or requests about this Privacy Policy,
                    contact us at{" "}
                    <a
                      href="mailto:privacy@knoww.app"
                      className="font-semibold text-primary hover:underline underline-offset-4"
                    >
                      privacy@knoww.app
                    </a>
                    .
                  </p>
                </Section>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-border/30 py-6 bg-background/50 backdrop-blur-xl">
        <div className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-256x256.png"
              alt="Knoww Logo"
              width={24}
              height={24}
              className="rounded-md"
            />
            <span className="font-bold text-foreground">Knoww</span>
            <span>•</span>
            <span>
              <Link
                href="/privacy"
                className="hover:text-foreground hover:underline underline-offset-4"
              >
                Privacy
              </Link>
            </span>
          </div>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
